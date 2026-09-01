import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../lib/db.mjs';
import { initV050 } from '../lib/v050.mjs';
import { initV060 } from '../lib/v060.mjs';
import { parseFinancialRows } from '../lib/financial-reader.mjs';
import { applyFinancialSyncPlan, buildFinancialSyncPlan, FINANCIAL_ACCESS_POLICY } from '../lib/financial-sync.mjs';

const MONTH_START = 12;
const MONTH_WIDTH = 7;

function rutFor(body) {
  const digits = String(body);
  let sum = 0;
  let multiplier = 2;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  const dv = result === 11 ? '0' : result === 10 ? 'K' : String(result);
  return `${digits}-${dv}`;
}

function fixtureRows() {
  const rows = Array.from({ length: 5 }, () => Array(96).fill(null));
  const headers = rows[4];
  headers[2] = 'RUT'; headers[3] = 'NOMBRE'; headers[4] = 'CARGO'; headers[5] = 'INSTITUCION';
  headers[6] = 'OTROS'; headers[7] = 'UF'; headers[8] = 'SEGUROS'; headers[9] = 'P. LICENCIA';
  headers[10] = 'PAGO'; headers[11] = 'COMENTARIO';
  const monthHeaders = ['Pagado', 'Otros', 'UF', 'Seguro', 'P. Lic', 'Total', 'Revisión'];
  for (let month = 0; month < 12; month += 1) {
    const start = MONTH_START + month * MONTH_WIDTH;
    monthHeaders.forEach((value, offset) => { headers[start + offset] = value; });
  }
  return rows;
}

function sourceRow(rut, status, name = 'NOMBRE XLSM NO AUTORITATIVO') {
  const row = Array(96).fill(null);
  row[2] = rut;
  row[3] = name;
  row[4] = 'CARGO XLSM';
  row[5] = 'EMPLEADOR XLSM';
  row[11] = status;
  for (let month = 0; month < 12; month += 1) {
    const start = MONTH_START + month * MONTH_WIDTH;
    row[start] = 1;
    row[start + 5] = 1;
  }
  return row;
}

function readMembers(db) {
  return db.prepare(`SELECT m.id,m.rut,m.active,f.source_status,f.financial_status,f.months_due,f.amount_due,f.deactivated_by_financial,
    'LEGACY_UNKNOWN' amount_evidence FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.role!='ADMIN' ORDER BY m.id`).all();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-aspch-financial-sync-'));
const db = openDb(tmp);
initV050(db, { adminEmail: 'informatica@example.test' });
initV060(db);
const now = '2026-08-31T12:00:00.000Z';
const statuses = ['ACTIVO', 'MOROSO', 'CONGELADO', 'DESAFILIADO', 'JUBILADO', 'DIRECTORIO'];
const ids = {};
for (let index = 0; index < statuses.length; index += 1) {
  const status = statuses[index];
  const inserted = db.prepare(`INSERT INTO members(email,name,rut,phone,employer,position,role,active,is_board,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    `${status.toLowerCase()}@example.test`, `NOMBRE SQLITE ${status}`, rutFor(10000000 + index),
    `+5690000000${index}`, `EMPLEADOR SQLITE ${index}`, `CARGO SQLITE ${index}`, 'MEMBER',
    status === 'ACTIVO' || status === 'JUBILADO' ? 0 : 1, status === 'DIRECTORIO' ? 0 : 0, now
  );
  ids[status] = Number(inserted.lastInsertRowid);
}
db.prepare(`INSERT INTO member_financial_status(member_id,rut,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at,deactivated_by_financial)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ids.ACTIVO, rutFor(10000000), 'DESAFILIADO', 'DESAFILIADO', 0, 0, 2026, now, now, 1);

const unclassifiedRut = rutFor(10000020);
db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,?,?,?)`).run('blank@example.test', 'BLANK', unclassifiedRut, 'MEMBER', 1, 0, now);
const duplicateSourceRut = rutFor(10000021);
db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,?,?,?)`).run('dupsource@example.test', 'DUP SOURCE', duplicateSourceRut, 'MEMBER', 1, 0, now);
const duplicateMemberRut = rutFor(10000022);
db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,?,?,?)`).run('dupmember1@example.test', 'DUP MEMBER 1', duplicateMemberRut, 'MEMBER', 1, 0, now);
db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,?,?,?)`).run('dupmember2@example.test', 'DUP MEMBER 2', duplicateMemberRut, 'MEMBER', 1, 0, now);

const rows = fixtureRows();
for (let index = 0; index < statuses.length; index += 1) rows.push(sourceRow(rutFor(10000000 + index), statuses[index]));
const moroso = rows[6];
moroso[MONTH_START] = null;
moroso[MONTH_START + 5] = 0;
moroso[MONTH_START + MONTH_WIDTH] = 0;
moroso[MONTH_START + MONTH_WIDTH + 5] = 15000;
rows.push(sourceRow(unclassifiedRut, ''));
rows.push(sourceRow(duplicateSourceRut, 'DIRECTORIO'));
rows.push(sourceRow(duplicateSourceRut, 'DESAFILIADO'));
rows.push(sourceRow(duplicateMemberRut, 'ACTIVO'));
rows.push(sourceRow('17.971.385-4', 'MOROSO'));

const parsed = parseFinancialRows(rows, { asOf: '2026-03-20' });
parsed.source = {
  file: path.join(tmp, 'BASE DE DATOS.xlsm'),
  sha256: 'fixture-sha256',
  modifiedAt: now,
  formulaErrors: []
};
const beforePersonal = db.prepare("SELECT id,email,name,rut,phone,employer,position,is_board,updated_at FROM members WHERE role!='ADMIN' ORDER BY id").all();
const plan = buildFinancialSyncPlan(parsed, readMembers(db), { generatedAt: now });

assert.equal(plan.summary.safeOneToOneMatches, 7, 'Solo los matches 1:1 deben considerarse seguros');
assert.equal(plan.summary.applicableMatches, 6, 'Solo seis estados explícitos son aplicables');
assert.equal(plan.summary.membersWithChanges, 6);
assert.equal(plan.summary.unclassifiableMatchedMembers, 1);
assert.equal(plan.summary.invalidSourceRuts, 1);
assert.equal(plan.summary.duplicateSourceRuts, 1);
assert.equal(plan.summary.duplicateMemberRuts, 1);
assert.equal(plan.changes.find(item => item.sourceStatus === 'MOROSO').next.financialStatus, 'MOROSO', 'MOROSO no escala a DESAFILIADO');
assert.equal(plan.changes.find(item => item.sourceStatus === 'MOROSO').next.amountDueDirect, 15000, 'Solo suma Total positivo explícito');
assert.equal(plan.changes.find(item => item.sourceStatus === 'MOROSO').next.amountEvidence, 'PARTIAL');
assert.equal(plan.changes.find(item => item.sourceStatus === 'ACTIVO').next.active, 1, 'Corrige una desactivación propiedad del XLSM');
assert.equal(plan.changes.find(item => item.sourceStatus === 'JUBILADO').next.active, 0, 'No reactiva una baja ajena al XLSM');
assert.equal(FINANCIAL_ACCESS_POLICY.DESAFILIADO.access, 'SIN_ACCESO_DE_SOCIO');

assert.throws(() => applyFinancialSyncPlan(db, plan, { planId: plan.planId, confirmation: 'NO' }), /Autorización insuficiente/);
assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='financial_membership_sync_runs'").get().n, 0, 'Una autorización inválida no debe crear tablas ni escribir');

const applied = applyFinancialSyncPlan(db, plan, {
  planId: plan.planId,
  confirmation: 'APLICAR SINCRONIZACION XLSM',
  appliedAt: '2026-08-31T12:05:00.000Z'
});
assert.equal(applied.stateChangesApplied, 6);
assert.equal(db.prepare('SELECT active FROM members WHERE id=?').get(ids.DESAFILIADO).active, 0);
assert.equal(db.prepare('SELECT active FROM members WHERE id=?').get(ids.ACTIVO).active, 1);
assert.equal(db.prepare('SELECT active FROM members WHERE id=?').get(ids.JUBILADO).active, 0);
assert.equal(db.prepare('SELECT is_board FROM members WHERE id=?').get(ids.DIRECTORIO).is_board, 0, 'DIRECTORIO no modifica is_board');
assert.equal(db.prepare('SELECT financial_status FROM member_financial_status WHERE member_id=?').get(ids.MOROSO).financial_status, 'MOROSO');
assert.equal(db.prepare('SELECT amount_due,amount_evidence FROM member_financial_status WHERE member_id=?').get(ids.MOROSO).amount_due, 15000);
assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_membership_sync_changes').get().n, 6);
assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='FINANCIAL_MEMBERSHIP_STATE_CHANGED'").get().n, 6);
assert.deepEqual(db.prepare("SELECT id,email,name,rut,phone,employer,position,is_board,updated_at FROM members WHERE role!='ADMIN' ORDER BY id").all(), beforePersonal, 'No debe modificar datos personales ni is_board');

const source = fs.readFileSync(new URL('../lib/financial-sync.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(source, /lib\/google|sheetsUpdate|sendWorkspaceEmail|sendMemberPush|listCalendarEvents/);

db.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('financial-sync self-check OK: mapeo explícito, match 1:1, autorización exacta, auditoría y cero writes externos');
