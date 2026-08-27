import crypto from 'node:crypto';
import { sendOtpEmail, gmailOtpSendEnabled } from './google.mjs';

const attempts = new Map();
const DEMO = () => String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true';
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const otpHash = (email, code) => sha(`${process.env.OTP_SECRET || 'dev'}|${String(email).toLowerCase()}|${code}`);
const sessionHash = token => sha(`${process.env.SESSION_SECRET || 'dev'}|${token}`);

export function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

export function rateLimitOtp(email, purpose='login') {
  const key = `${normalizeEmail(email)}|${purpose}`;
  const now = Date.now();
  const history = (attempts.get(key) || []).filter(t => now - t < 15 * 60_000);
  if (history.length >= 5) return false;
  history.push(now);
  attempts.set(key, history);
  return true;
}

export async function issueOtp(db, { memberId=null, email, purpose='login', mailKind='login' }) {
  email = normalizeEmail(email);
  if (!email || !email.includes('@')) return { ok:false, reason:'invalid_email' };
  if (!rateLimitOtp(email, purpose)) return { ok:false, reason:'rate_limited' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const created = new Date();
  const expires = new Date(created.getTime() + 10 * 60_000);
  db.prepare('INSERT INTO otp_codes(email,member_id,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)')
    .run(email, memberId, purpose, otpHash(email, code), expires.toISOString(), created.toISOString());

  let delivered = false;
  if (gmailOtpSendEnabled()) {
    await sendOtpEmail({ to: email, code, kind: mailKind });
    delivered = true;
  }
  return { ok:true, delivered, devCode:DEMO() ? code : undefined, expiresAt:expires.toISOString() };
}

export function verifyIssuedOtp(db, { memberId=null, email, code, purpose='login', consume=true }) {
  email = normalizeEmail(email);
  const row = memberId == null
    ? db.prepare(`SELECT * FROM otp_codes WHERE email=? AND purpose=? AND used_at IS NULL ORDER BY id DESC LIMIT 1`).get(email, purpose)
    : db.prepare(`SELECT * FROM otp_codes WHERE email=? AND purpose=? AND member_id=? AND used_at IS NULL ORDER BY id DESC LIMIT 1`).get(email, purpose, memberId);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return { ok:false, reason:'expired' };
  const a = Buffer.from(row.code_hash);
  const b = Buffer.from(otpHash(email, code));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok:false, reason:'invalid' };
  if (consume) consumeOtp(db, row.id);
  return { ok:true, row };
}

export function consumeOtp(db, id) {
  db.prepare('UPDATE otp_codes SET used_at=? WHERE id=? AND used_at IS NULL').run(new Date().toISOString(), id);
}

export function createSession(db, member, { unlockedMs=60*60_000 } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const unlockedUntil = unlockedMs > 0 ? new Date(Date.now() + unlockedMs).toISOString() : null;
  db.prepare('INSERT INTO sessions(token_hash,member_id,expires_at,unlocked_until,created_at) VALUES (?,?,?,?,?)')
    .run(sessionHash(token), member.id, expires.toISOString(), unlockedUntil, new Date().toISOString());
  return { token, expires, unlockedUntil };
}

// Compatibilidad con el login por correo de versiones previas.
export async function requestOtp(db, email) {
  email = normalizeEmail(email);
  const member = db.prepare('SELECT id,email,name,active FROM members WHERE email=?').get(email);
  if (!member || !member.active) return { ok:false, reason:'not_member' };
  return issueOtp(db, { memberId:member.id, email, purpose:'login', mailKind:'login' });
}

export function verifyOtp(db, email, code) {
  email = normalizeEmail(email);
  const member = db.prepare('SELECT * FROM members WHERE email=? AND active=1').get(email);
  if (!member) return { ok:false, reason:'not_member' };
  const verified = verifyIssuedOtp(db, { memberId:member.id, email, code, purpose:'login' });
  if (!verified.ok) return verified;
  const session = createSession(db, member, { unlockedMs:60*60_000 });
  return { ok:true, ...session, member };
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [decodeURIComponent(i < 0 ? v : v.slice(0, i)), decodeURIComponent(i < 0 ? '' : v.slice(i + 1))];
  }));
}

function sessionToken(req) { return parseCookies(req.headers.cookie || '').mi_aspch_session || ''; }

export function memberFromRequest(db, req) {
  const token = sessionToken(req);
  if (!token) return null;
  const row = db.prepare(`SELECT m.*, s.id AS session_id, s.expires_at AS session_expires, s.unlocked_until,
    (SELECT COUNT(*) FROM passkeys p WHERE p.member_id=m.id) AS passkey_count
    FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=?`).get(sessionHash(token));
  if (!row || !row.active || new Date(row.session_expires).getTime() < Date.now()) return null;
  return row;
}

export function isUnlocked(member) {
  const protectedByPin = !!member?.pin_hash;
  const protectedByPasskey = Number(member?.passkey_count || 0) > 0;
  if (!protectedByPin && !protectedByPasskey) return true;
  return !!member.unlocked_until && new Date(member.unlocked_until).getTime() > Date.now();
}

export function setPin(db, member, pin, currentPin = '') {
  pin = String(pin || '');
  if (!/^\d{4,6}$/.test(pin)) return { ok:false, reason:'format' };
  if (member.pin_hash && !verifyPinValue(member, currentPin)) return { ok:false, reason:'current_invalid' };
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(pin, salt, 32).toString('base64url');
  db.prepare('UPDATE members SET pin_salt=?, pin_hash=?, pin_updated_at=?, updated_at=? WHERE id=?')
    .run(salt, hash, new Date().toISOString(), new Date().toISOString(), member.id);
  db.prepare('UPDATE sessions SET unlocked_until=? WHERE id=?').run(new Date(Date.now()+8*60*60_000).toISOString(), member.session_id);
  return { ok:true };
}

function verifyPinValue(member, pin) {
  if (!member?.pin_hash || !member?.pin_salt) return false;
  const candidate = crypto.scryptSync(String(pin || ''), member.pin_salt, 32);
  const stored = Buffer.from(member.pin_hash, 'base64url');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export function unlockWithPin(db, member, pin) {
  if (!member.pin_hash) return { ok:false, reason:'not_set' };
  if (!verifyPinValue(member, pin)) return { ok:false, reason:'invalid' };
  const until = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  db.prepare('UPDATE sessions SET unlocked_until=? WHERE id=?').run(until, member.session_id);
  return { ok:true, unlockedUntil: until };
}

export function lockSession(db, member) {
  db.prepare('UPDATE sessions SET unlocked_until=NULL WHERE id=?').run(member.session_id);
}

export function logout(db, req) {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionHash(token));
}


const pinLoginAttempts = new Map();
function rateLimitPinLogin(email){
  const key=normalizeEmail(email),now=Date.now();
  const xs=(pinLoginAttempts.get(key)||[]).filter(t=>now-t<15*60_000);
  if(xs.length>=8)return false;xs.push(now);pinLoginAttempts.set(key,xs);return true;
}
export function createSessionWithPin(db,email,pin){
  email=normalizeEmail(email);
  if(!rateLimitPinLogin(email))return{ok:false,reason:'rate_limited'};
  const member=db.prepare("SELECT * FROM members WHERE email=? AND active=1 AND role='ADMIN'").get(email);
  if(!member)return{ok:false,reason:'not_admin'};
  if(!verifyPinValue(member,pin))return{ok:false,reason:'invalid'};
  const session=createSession(db,member,{unlockedMs:8*60*60_000});
  return{ok:true,...session,member};
}
