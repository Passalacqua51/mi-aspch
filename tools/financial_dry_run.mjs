#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runFinancialSyncDryRun } from '../lib/financial-sync.mjs';

function usage() {
  return [
    'Uso:',
    '  node tools/financial_dry_run.mjs --xlsm ARCHIVO --sqlite BASE --report REPORTE.json [--as-of YYYY-MM-DD]'
  ].join('\n');
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Argumento inesperado: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Falta valor para ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  if (!result.xlsm || !result.sqlite || !result.report) throw new Error(usage());
  return result;
}

function fileFingerprint(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return {
    size: stat.size,
    modifiedAtMs: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  };
}

function sqliteFingerprint(sqliteFile) {
  return Object.fromEntries([sqliteFile, `${sqliteFile}-wal`, `${sqliteFile}-shm`].map(file => [file, fileFingerprint(file)]));
}

function sameFingerprint(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function readMembersReadOnly(sqliteFile) {
  if (!fs.existsSync(sqliteFile)) throw new Error(`SQLite no encontrado: ${sqliteFile}`);
  const immutableUri = `${pathToFileURL(sqliteFile).href}?mode=ro&immutable=1`;
  const columnsOutput = execFileSync('sqlite3', [
    '-readonly',
    '-json',
    '-cmd', 'PRAGMA query_only=ON;',
    immutableUri,
    'PRAGMA table_info(member_financial_status)'
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const financialColumns = new Set(JSON.parse(columnsOutput || '[]').map(column => column.name));
  const amountEvidence = financialColumns.has('amount_evidence') ? 'f.amount_evidence' : "'LEGACY_UNKNOWN'";
  const output = execFileSync('sqlite3', [
    '-readonly',
    '-json',
    '-cmd', 'PRAGMA query_only=ON;',
    immutableUri,
    `SELECT m.id,m.rut,m.active,m.role,f.source_status,f.financial_status,f.months_due,f.amount_due,f.deactivated_by_financial,${amountEvidence} amount_evidence
       FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id
      WHERE m.role!='ADMIN' ORDER BY m.id`
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(output || '[]');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqliteFile = path.resolve(args.sqlite);
  const reportFile = path.resolve(args.report);
  if (!fs.existsSync(path.dirname(reportFile))) throw new Error(`Directorio de reporte inexistente: ${path.dirname(reportFile)}`);
  const sqliteBefore = sqliteFingerprint(sqliteFile);
  const members = readMembersReadOnly(sqliteFile);
  const report = runFinancialSyncDryRun({
    file: path.resolve(args.xlsm),
    members,
    asOf: args['as-of'] || new Date()
  });
  const sqliteAfter = sqliteFingerprint(sqliteFile);
  report.readOnlyVerification = {
    sqliteOpenedWithReadonlyFlag: true,
    sqliteQueryOnly: true,
    sqliteImmutableSnapshot: true,
    sqliteMustBeCoherentSnapshot: true,
    sqliteFilesUnchanged: sameFingerprint(sqliteBefore, sqliteAfter),
    sqliteBefore,
    sqliteAfter,
    googleAccessed: false
  };
  if (!report.readOnlyVerification.sqliteFilesUnchanged) throw new Error('La huella SQLite cambió durante el dry-run; se aborta el reporte.');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ mode: report.mode, report: reportFile, summary: report.summary, readOnlyVerification: report.readOnlyVerification }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
