import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function nowIso() { return new Date().toISOString(); }

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'mi-aspch.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      preferred_name TEXT,
      rut TEXT,
      birth_date TEXT,
      phone TEXT,
      employer TEXT,
      category TEXT,
      bp TEXT,
      joined_at TEXT,
      position TEXT,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      active INTEGER NOT NULL DEFAULT 1,
      is_board INTEGER NOT NULL DEFAULT 0,
      pin_salt TEXT,
      pin_hash TEXT,
      pin_updated_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL DEFAULT 'login',
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      unlocked_until TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL,
      created_by INTEGER REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parking_spaces (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      building TEXT NOT NULL DEFAULT '87',
      board_only INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parking_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_date TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES parking_spaces(id),
      member_id INTEGER NOT NULL REFERENCES members(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      cancelled_at TEXT,
      checked_in_at TEXT,
      reminder_after_hours INTEGER,
      last_reminder_at TEXT,
      vacated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_parking_space_day_active
      ON parking_reservations(reservation_date, space_id)
      WHERE status='ACTIVE';
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_parking_member_day_active
      ON parking_reservations(reservation_date, member_id)
      WHERE status='ACTIVE';

    CREATE TABLE IF NOT EXISTS membership_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      membership_year INTEGER NOT NULL,
      amount_clp INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      provider_order TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      paid_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      credential_id TEXT PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      webauthn_user_id TEXT NOT NULL,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_passkeys_member ON passkeys(member_id);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      challenge TEXT NOT NULL,
      webauthn_user_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_challenge_session ON webauthn_challenges(session_id,type,created_at DESC);

    CREATE TABLE IF NOT EXISTS member_email_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      old_email TEXT,
      new_email TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'SELF_REGISTRATION'
    );

    CREATE TABLE IF NOT EXISTS airline_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      previous_airline TEXT,
      new_airline TEXT NOT NULL,
      effective_date TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_LOCAL',
      external_sheet_row TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_airline_change_member ON airline_change_requests(member_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS simulator_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      event_ref TEXT NOT NULL,
      simulator_id TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      period TEXT,
      start_at TEXT NOT NULL,
      next_candidate_name TEXT,
      next_candidate_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_simulator_cancel_member ON simulator_cancellations(member_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_simulator_cancel_event ON simulator_cancellations(event_ref);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  migrate(db);
  seed(db);
  return db;
}

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
}
function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
function migrate(db) {
  addColumn(db, 'members', 'is_board INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'members', 'preferred_name TEXT');
  addColumn(db, 'members', 'pin_salt TEXT');
  addColumn(db, 'members', 'pin_hash TEXT');
  addColumn(db, 'members', 'pin_updated_at TEXT');
  addColumn(db, 'membership_payments', 'membership_month INTEGER');
  addColumn(db, 'otp_codes', 'member_id INTEGER REFERENCES members(id) ON DELETE CASCADE');
  addColumn(db, 'otp_codes', "purpose TEXT NOT NULL DEFAULT 'login'");
  addColumn(db, 'sessions', 'unlocked_until TEXT');
  addColumn(db, 'parking_spaces', "building TEXT NOT NULL DEFAULT '87'");
  addColumn(db, 'parking_spaces', 'board_only INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'parking_reservations', 'checked_in_at TEXT');
  addColumn(db, 'parking_reservations', 'reminder_after_hours INTEGER');
  addColumn(db, 'parking_reservations', 'last_reminder_at TEXT');
  addColumn(db, 'parking_reservations', 'vacated_at TEXT');
  addColumn(db, 'parking_reservations', "source TEXT NOT NULL DEFAULT 'APP'");
  addColumn(db, 'airline_change_requests', 'previous_phone TEXT');
  addColumn(db, 'airline_change_requests', 'new_phone TEXT');
  // Compatibilidad con v0.1: clasifica los cupos ya existentes sin cambiar sus IDs.
  db.prepare("UPDATE parking_spaces SET building='103', board_only=1 WHERE label IN ('15 (Motos)','16','17')").run();
  db.prepare("UPDATE parking_spaces SET building='87', board_only=0 WHERE label IN ('3','4','41','71','154-A','154-B','167')").run();
}

function seed(db) {
  const now = nowIso();
  const newsCount = db.prepare('SELECT COUNT(*) AS n FROM news').get().n;
  if (!newsCount) {
    const ins = db.prepare('INSERT INTO news(title,body,pinned,published_at) VALUES (?,?,?,?)');
    ins.run('Bienvenidos a Mi ASPCH', 'Esta es la primera versión de la aplicación para socios. Iremos incorporando y afinando funciones sobre esta misma base.', 1, now);
    ins.run('Turnos de simulador con privacidad', 'La disponibilidad se muestra sin revelar la identidad del socio que ocupa otro turno.', 0, now);
  }

  // La planilla real separa 103 (Directorio) y 87 (asociados).
  if (!db.prepare('SELECT COUNT(*) AS n FROM parking_spaces').get().n) {
    const spaces = [
      ['15 (Motos)','103',1], ['16','103',1], ['17','103',1],
      ['3','87',0], ['4','87',0], ['41','87',0], ['71','87',0], ['154-A','87',0], ['154-B','87',0], ['167','87',0]
    ];
    const ins = db.prepare('INSERT INTO parking_spaces(id,label,building,board_only,sort_order,updated_at) VALUES (?,?,?,?,?,?)');
    spaces.forEach(([label,building,boardOnly], i) => ins.run(spaceId(building,label), label, building, boardOnly, i + 1, now));
  }
}

export function slug(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export function normalizeRut(value) {
  const clean = String(value || '').trim().toUpperCase().replace(/[^0-9K]/g, '');
  if (clean.length < 2) return '';
  return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}
export function isValidRut(value) {
  const rut = normalizeRut(value);
  if (!/^\d{6,8}-[0-9K]$/.test(rut)) return false;
  const [body, dv] = rut.split('-');
  let sum = 0, factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const raw = 11 - (sum % 11);
  const expected = raw === 11 ? '0' : raw === 10 ? 'K' : String(raw);
  return dv === expected;
}
export function spaceId(building, label) { return slug(label); }

export function upsertMember(db, m) {
  const email = String(m.email || '').trim().toLowerCase();
  const rut = normalizeRut(m.rut);
  if (!email) return false;
  let existing = null;
  if (rut) {
    existing = db.prepare("SELECT id, role, email FROM members WHERE REPLACE(REPLACE(UPPER(COALESCE(rut,'')),'.',''),' ','')=?").get(rut);
  }
  if (!existing) existing = db.prepare('SELECT id, role, email FROM members WHERE email=?').get(email);
  const now = nowIso();
  if (existing) {
    const emailOwner = db.prepare('SELECT id FROM members WHERE email=? AND id<>?').get(email, existing.id);
    const emailToUse = emailOwner ? existing.email : email;
    db.prepare(`UPDATE members SET email=?, name=?, rut=?, birth_date=?, phone=?, employer=?, category=?, bp=?, joined_at=?, position=?, active=?, updated_at=? WHERE id=?`)
      .run(emailToUse, m.name || emailToUse, m.rut || rut || null, m.birthDate || null, m.phone || null, m.employer || null, m.category || null, m.bp || null, m.joinedAt || null, m.position || null, m.active === false ? 0 : 1, now, existing.id);
  } else {
    db.prepare(`INSERT INTO members(email,name,rut,birth_date,phone,employer,category,bp,joined_at,position,role,active,is_board,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(email, m.name || email, m.rut || rut || null, m.birthDate || null, m.phone || null, m.employer || null, m.category || null, m.bp || null, m.joinedAt || null, m.position || null, 'MEMBER', m.active === false ? 0 : 1, 0, now);
  }
  return true;
}

export function updatePreferredName(db, memberId, preferredName) {
  const value = String(preferredName || '').trim().replace(/\s+/g, ' ');
  if (!value) return { ok:false, reason:'empty' };
  if (value.length > 40) return { ok:false, reason:'too_long' };
  if (!/^[\p{L}\p{M} .'-]+$/u.test(value)) return { ok:false, reason:'invalid_chars' };
  const member = db.prepare('SELECT id FROM members WHERE id=?').get(memberId);
  if (!member) return { ok:false, reason:'not_found' };
  db.prepare('UPDATE members SET preferred_name=?, updated_at=? WHERE id=?').run(value, nowIso(), memberId);
  return { ok:true, preferredName:value };
}

export function updateMemberEmail(db, memberId, newEmail, source='SELF_REGISTRATION') {
  newEmail = String(newEmail || '').trim().toLowerCase();
  if (!newEmail || !newEmail.includes('@')) return { ok:false, reason:'invalid_email' };
  const member = db.prepare('SELECT id,email FROM members WHERE id=?').get(memberId);
  if (!member) return { ok:false, reason:'not_found' };
  const owner = db.prepare('SELECT id FROM members WHERE email=? AND id<>?').get(newEmail, memberId);
  if (owner) return { ok:false, reason:'email_in_use' };
  if (String(member.email).toLowerCase() === newEmail) return { ok:true, changed:false, oldEmail:member.email, newEmail };
  const now = nowIso();
  db.prepare('UPDATE members SET email=?, updated_at=? WHERE id=?').run(newEmail, now, memberId);
  db.prepare('INSERT INTO member_email_changes(member_id,old_email,new_email,changed_at,source) VALUES (?,?,?,?,?)')
    .run(memberId, member.email, newEmail, now, source);
  return { ok:true, changed:true, oldEmail:member.email, newEmail };
}

export function setBoardMembersByRut(db, ruts) {
  const normalized = [...new Set(ruts.map(normalizeRut).filter(Boolean))];
  const tx = db.transaction ? db.transaction : null;
  const run = () => {
    db.prepare('UPDATE members SET is_board=0').run();
    // La nómina vigente del Directorio es autoritativa también para acceso:
    // sus integrantes deben permanecer activos mientras estén en esa fuente.
    const stmt = db.prepare("UPDATE members SET is_board=1, active=1 WHERE REPLACE(REPLACE(UPPER(COALESCE(rut,'')),'.',''),' ','')=?");
    let count = 0;
    for (const rut of normalized) count += Number(stmt.run(rut).changes || 0);
    return count;
  };
  return tx ? tx(run)() : run();
}

export function upsertParkingSpaces(db, spaces) {
  const now = nowIso();
  const normalized = [];
  const seen = new Set();
  for (const item of spaces) {
    const label = String(typeof item === 'string' ? item : item.label || '').trim();
    const building = String(typeof item === 'string' ? '87' : item.building || '87').trim();
    if (!label || !['87','103'].includes(building)) continue;
    const id = spaceId(building, label);
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, label, building, boardOnly: typeof item === 'string' ? false : !!item.boardOnly });
  }
  db.prepare('UPDATE parking_spaces SET active=0').run();
  const stmt = db.prepare(`INSERT INTO parking_spaces(id,label,building,board_only,active,sort_order,updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label, building=excluded.building, board_only=excluded.board_only,
      active=1, sort_order=excluded.sort_order, updated_at=excluded.updated_at`);
  normalized.forEach((s, i) => stmt.run(s.id, s.label, s.building, s.boardOnly ? 1 : 0, 1, i + 1, now));
  return normalized.length;
}
