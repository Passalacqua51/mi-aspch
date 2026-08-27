import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

function cfg() {
  const publicUrl = new URL(process.env.PUBLIC_APP_URL || 'https://app.aspch.org');
  const rpID = process.env.WEBAUTHN_RP_ID || publicUrl.hostname;
  const origins = [...new Set([
    publicUrl.origin,
    ...String(process.env.WEBAUTHN_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
  ])];
  return { rpName: process.env.WEBAUTHN_RP_NAME || 'Mi ASPCH', rpID, origins, publicUrl: publicUrl.origin };
}

function nowIso() { return new Date().toISOString(); }
function expiresIso(minutes = 5) { return new Date(Date.now() + minutes * 60_000).toISOString(); }
function parseTransports(value) { try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

function passkeysForMember(db, memberId) {
  return db.prepare(`SELECT credential_id, public_key, counter, transports, device_type, backed_up, created_at, last_used_at
    FROM passkeys WHERE member_id=? ORDER BY created_at DESC`).all(memberId);
}

function replaceChallenge(db, sessionId, type, challenge, webauthnUserId = null) {
  db.prepare('DELETE FROM webauthn_challenges WHERE session_id=? AND type=?').run(sessionId, type);
  db.prepare(`INSERT INTO webauthn_challenges(session_id,type,challenge,webauthn_user_id,expires_at,created_at)
    VALUES (?,?,?,?,?,?)`).run(sessionId, type, challenge, webauthnUserId, expiresIso(), nowIso());
}

function takeChallenge(db, sessionId, type) {
  const row = db.prepare(`SELECT * FROM webauthn_challenges WHERE session_id=? AND type=? ORDER BY id DESC LIMIT 1`).get(sessionId, type);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM webauthn_challenges WHERE session_id=? AND type=?').run(sessionId, type);
    return null;
  }
  return row;
}

export function webauthnRequestInfo(requestOrigin, secure) {
  const { rpID, origins, publicUrl } = cfg();
  const originAllowed = !!requestOrigin && origins.includes(requestOrigin);
  return {
    available: !!secure && originAllowed,
    requiresHttps: !secure,
    wrongOrigin: !!secure && !originAllowed,
    rpID,
    publicUrl,
  };
}

export function webauthnSummary(db, member, requestOrigin, secure) {
  const { rpID, origins, publicUrl } = cfg();
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE member_id=?').get(member.id).n || 0);
  const originAllowed = !!requestOrigin && origins.includes(requestOrigin);
  return {
    passkeyCount: count,
    passkeySet: count > 0,
    biometricAvailable: secure && originAllowed,
    biometricRequiresHttps: !secure,
    biometricWrongOrigin: secure && !originAllowed,
    rpID,
    publicUrl,
  };
}

export async function registrationOptions(db, member) {
  const { rpName, rpID } = cfg();
  const existing = passkeysForMember(db, member.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: member.email,
    userDisplayName: member.name,
    userID: new TextEncoder().encode(`aspch-member:${member.id}`),
    attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: existing.map(p => ({ id: p.credential_id, transports: parseTransports(p.transports) })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
    preferredAuthenticatorType: 'localDevice',
  });
  replaceChallenge(db, member.session_id, 'registration', options.challenge, options.user.id);
  return options;
}

export async function finishRegistration(db, member, response) {
  const current = takeChallenge(db, member.session_id, 'registration');
  if (!current) return { ok: false, reason: 'challenge_expired' };
  const { rpID, origins } = cfg();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: current.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    return { ok: false, reason: 'verification_failed', detail: error?.message || String(error) };
  }
  if (!verification.verified || !verification.registrationInfo) return { ok: false, reason: 'not_verified' };
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  db.prepare(`INSERT INTO passkeys
    (credential_id,member_id,webauthn_user_id,public_key,counter,transports,device_type,backed_up,created_at,last_used_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(credential_id) DO UPDATE SET member_id=excluded.member_id,webauthn_user_id=excluded.webauthn_user_id,
      public_key=excluded.public_key,counter=excluded.counter,transports=excluded.transports,device_type=excluded.device_type,
      backed_up=excluded.backed_up,last_used_at=excluded.last_used_at`)
    .run(
      credential.id,
      member.id,
      current.webauthn_user_id,
      Buffer.from(credential.publicKey),
      Number(credential.counter || 0),
      JSON.stringify(credential.transports || response?.response?.transports || []),
      credentialDeviceType || null,
      credentialBackedUp ? 1 : 0,
      nowIso(),
      nowIso(),
    );
  db.prepare('DELETE FROM webauthn_challenges WHERE session_id=? AND type=?').run(member.session_id, 'registration');
  return { ok: true, count: Number(db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE member_id=?').get(member.id).n || 0) };
}

export async function authenticationOptions(db, member) {
  const { rpID } = cfg();
  const passkeys = passkeysForMember(db, member.id);
  if (!passkeys.length) return { ok: false, reason: 'no_passkey' };
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map(p => ({ id: p.credential_id, transports: parseTransports(p.transports) })),
    userVerification: 'required',
  });
  replaceChallenge(db, member.session_id, 'authentication', options.challenge);
  return { ok: true, options };
}

export async function finishAuthentication(db, member, response) {
  const current = takeChallenge(db, member.session_id, 'authentication');
  if (!current) return { ok: false, reason: 'challenge_expired' };
  const passkey = db.prepare('SELECT * FROM passkeys WHERE credential_id=? AND member_id=?').get(String(response?.id || ''), member.id);
  if (!passkey) return { ok: false, reason: 'credential_not_found' };
  const { rpID, origins } = cfg();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: current.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter || 0),
        transports: parseTransports(passkey.transports),
      },
      requireUserVerification: true,
    });
  } catch (error) {
    return { ok: false, reason: 'verification_failed', detail: error?.message || String(error) };
  }
  if (!verification.verified) return { ok: false, reason: 'not_verified' };
  const newCounter = Number(verification.authenticationInfo?.newCounter ?? passkey.counter ?? 0);
  db.prepare('UPDATE passkeys SET counter=?,last_used_at=? WHERE credential_id=?').run(newCounter, nowIso(), passkey.credential_id);
  const until = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  db.prepare('UPDATE sessions SET unlocked_until=? WHERE id=?').run(until, member.session_id);
  db.prepare('DELETE FROM webauthn_challenges WHERE session_id=? AND type=?').run(member.session_id, 'authentication');
  return { ok: true, unlockedUntil: until };
}

export function removeAllPasskeys(db, member) {
  const result = db.prepare('DELETE FROM passkeys WHERE member_id=?').run(member.id);
  db.prepare('DELETE FROM webauthn_challenges WHERE session_id=?').run(member.session_id);
  return Number(result.changes || 0);
}
