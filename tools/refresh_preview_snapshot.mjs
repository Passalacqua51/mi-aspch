#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || !argv[index + 1]) throw new Error('Uso: --source SQLITE --target-dir DIRECTORIO');
    args[argv[index].slice(2)] = argv[index + 1];
  }
  if (!args.source || !args['target-dir']) throw new Error('Uso: --source SQLITE --target-dir DIRECTORIO');
  return args;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('base64url');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceFile = path.resolve(args.source);
  const targetDir = path.resolve(args['target-dir']);
  const adminEmail = String(process.env.PREVIEW_ADMIN_EMAIL || 'informatica@aspch.org').trim().toLowerCase();
  const adminPin = String(process.env.PREVIEW_ADMIN_PIN || '');
  if (!/^\d{4,12}$/.test(adminPin)) throw new Error('PREVIEW_ADMIN_PIN debe contener entre 4 y 12 dígitos.');
  if (!fs.existsSync(sourceFile)) throw new Error(`SQLite productiva no encontrada en mount read-only: ${sourceFile}`);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const nextFile = path.join(targetDir, '.mi-aspch-preview.next.sqlite');
  const targetFile = path.join(targetDir, 'mi-aspch.sqlite');
  if (fs.existsSync(nextFile)) fs.unlinkSync(nextFile);

  const source = new DatabaseSync(sourceFile, { readOnly: true });
  source.exec('PRAGMA query_only=ON');
  await backup(source, nextFile);
  const sourceMembers = Number(source.prepare("SELECT COUNT(*) n FROM members WHERE role!='ADMIN'").get().n || 0);
  source.close();

  const preview = new DatabaseSync(nextFile);
  preview.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE;');
  try {
    for (const table of ['sessions', 'webauthn_challenges', 'passkeys', 'otp_codes', 'push_subscriptions', 'notification_deliveries']) {
      if (tableExists(preview, table)) preview.prepare(`DELETE FROM "${table}"`).run();
    }
    preview.prepare('UPDATE members SET pin_salt=NULL,pin_hash=NULL,pin_updated_at=NULL').run();
    const admin = preview.prepare("SELECT id FROM members WHERE role='ADMIN' AND email=?").get(adminEmail);
    if (!admin) throw new Error('El snapshot no contiene el ADMIN requerido.');
    const salt = crypto.randomBytes(16).toString('base64url');
    preview.prepare("UPDATE members SET active=1,pin_salt=?,pin_hash=?,pin_updated_at=? WHERE id=?").run(
      salt, hashPin(adminPin, salt), new Date().toISOString(), admin.id
    );
    preview.exec(`CREATE TABLE IF NOT EXISTS preview_snapshot_meta (
      id INTEGER PRIMARY KEY CHECK(id=1),
      source_members INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      source_mode TEXT NOT NULL
    )`);
    preview.prepare(`INSERT INTO preview_snapshot_meta(id,source_members,created_at,source_mode)
      VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET source_members=excluded.source_members,created_at=excluded.created_at,source_mode=excluded.source_mode`)
      .run(sourceMembers, new Date().toISOString(), 'PRODUCTION_SQLITE_READ_ONLY_BACKUP_SANITIZED');
    preview.exec('COMMIT');
  } catch (error) {
    try { preview.exec('ROLLBACK'); } catch {}
    preview.close();
    try { fs.unlinkSync(nextFile); } catch {}
    throw error;
  }
  const check = preview.prepare('PRAGMA quick_check').get();
  const previewMembers = Number(preview.prepare("SELECT COUNT(*) n FROM members WHERE role!='ADMIN'").get().n || 0);
  const authResidue = Object.fromEntries(['sessions', 'passkeys', 'otp_codes', 'push_subscriptions'].map(table => [
    table, tableExists(preview, table) ? Number(preview.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n || 0) : 0
  ]));
  preview.close();
  fs.chmodSync(nextFile, 0o600);
  if (fs.existsSync(targetFile)) {
    const previous = path.join(targetDir, `mi-aspch.previous-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    fs.renameSync(targetFile, previous);
  }
  fs.renameSync(nextFile, targetFile);
  console.log(JSON.stringify({ ok: Object.values(check)[0] === 'ok', sourceMembers, previewMembers, authResidue, target: path.basename(targetFile) }));
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
