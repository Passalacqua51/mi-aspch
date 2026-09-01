import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFinancialDryRun,
  classifyFinancialComment,
  inspectRut,
  parseFinancialRows
} from '../lib/financial-reader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONTH_START = 12;
const MONTH_WIDTH = 7;

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

function financialRow(rut, name, comment) {
  const row = Array(96).fill(null);
  row[2] = rut; row[3] = name; row[11] = comment;
  for (let month = 0; month < 12; month += 1) {
    const start = MONTH_START + month * MONTH_WIDTH;
    row[start] = 1;
    row[start + 5] = 1;
  }
  return row;
}

const rows = fixtureRows();
const moroso = financialRow('8.732.133-9', 'SOCIO MOROSO', 'MOROSO');
moroso[6] = 50000; // No debe usarse para inferir deuda.
moroso[MONTH_START] = null;
moroso[MONTH_START + 5] = 0;
moroso[MONTH_START + MONTH_WIDTH] = 0;
moroso[MONTH_START + MONTH_WIDTH + 5] = 15000;
rows.push(moroso);

const congelado = financialRow('8.822.617-8', 'SOCIO CONGELADO', 'CONGELADO');
congelado[MONTH_START] = null;
congelado[MONTH_START + 5] = 99999;
rows.push(congelado);

const desafiliado = financialRow('15.385.336-3', 'SOCIO DESAFILIADO', 'DESAFILIADO');
desafiliado[MONTH_START] = 0;
desafiliado[MONTH_START + 5] = 88888;
rows.push(desafiliado);

rows.push(financialRow('22.842.460-9', 'SOCIO SIN COMENTARIO', ''));
rows.push(financialRow('12.404.248-8', 'SOCIO TEXTO LIBRE', 'Revisar cartola urgente'));
rows.push(financialRow('17.971.385-4', 'SOCIO RUT INVALIDO', 'MOROSO'));

const parsed = parseFinancialRows(rows, { asOf: '2026-03-20' });
parsed.source = { formulaErrors: [{ cell: 'BO99', error: '#VALUE!', formula: 'A1+B1' }] };
const members = [
  { id: 1, name: 'SOCIO MOROSO', rut: '8.732.133-9', active: 1 },
  { id: 2, name: 'SOCIO CONGELADO', rut: '8.822.617-8', active: 1 },
  { id: 3, name: 'SOCIO DESAFILIADO', rut: '15.385.336-3', active: 0 },
  { id: 4, name: 'SOCIO SIN COMENTARIO', rut: '22.842.460-9', active: 1 },
  { id: 5, name: 'SOCIO TEXTO LIBRE', rut: '12.404.248-8', active: 1 },
  { id: 6, name: 'SOCIO RUT INVALIDO', rut: '17.971.385-4', active: 1 }
];
const report = buildFinancialDryRun(parsed, members);

const morosoParsed = parsed.records[0];
assert.equal(morosoParsed.status, 'MOROSO', 'MOROSO nunca debe transformarse en DESAFILIADO');
assert.equal(morosoParsed.unpaidMonths.length, 2, 'Debe separar meses impagos demostrables');
assert.equal(morosoParsed.directlyDemonstrableAmount, 15000, 'Cero/vacío no debe generar monto de deuda');
assert.equal(parsed.records[1].unpaidMonths.length, 0, 'CONGELADO no debe generar deuda por inferencia');
assert.equal(parsed.records[1].directlyDemonstrableAmount, 0, 'CONGELADO no debe generar monto por inferencia');
assert.equal(parsed.records[2].unpaidMonths.length, 0, 'DESAFILIADO no debe generar deuda por inferencia');
assert.equal(parsed.records[2].directlyDemonstrableAmount, 0, 'DESAFILIADO no debe generar monto por inferencia');

assert.deepEqual(classifyFinancialComment(''), {
  status: 'NO_CLASIFICADO', originalComment: '', reason: 'COMENTARIO_VACIO'
}, 'Comentario vacío no debe convertirse en AL_DIA');
assert.equal(parsed.records[3].status, 'NO_CLASIFICADO');
assert.equal(parsed.records[4].status, 'NO_CLASIFICADO');
assert.equal(parsed.records[4].originalComment, 'Revisar cartola urgente', 'Texto libre debe conservarse literalmente');
assert.equal(report.summary.NO_CLASIFICADO, 2);
assert.equal('AL_DIA' in report.summary, false, 'El dry-run no debe producir AL_DIA');

assert.equal(inspectRut('17.971.385-4').valid, false);
assert.equal(report.summary.exactMatches, 5, 'Un RUT inválido no debe hacer matching');
assert.equal(report.summary.invalidFinancialRuts, 1);
assert.equal(report.summary.invalidMemberRuts, 1);
assert.equal(report.summary.formulaErrors, 1);
assert.equal(report.safety.writesSqlite, false);
assert.equal(report.safety.writesGoogle, false);

const duplicateRows = fixtureRows();
duplicateRows.push(financialRow('8.732.133-9', 'DUPLICADO UNO', 'DIRECTORIO'));
duplicateRows.push(financialRow('8.732.133-9', 'DUPLICADO DOS', 'DIRECTORIO'));
const duplicateReport = buildFinancialDryRun(parseFinancialRows(duplicateRows, { asOf: '2026-03-20' }), [members[0]]);
assert.equal(duplicateReport.summary.duplicateFinancialRuts, 1);
assert.equal(duplicateReport.summary.exactMatches, 0, 'Un RUT financiero duplicado no debe hacer matching exacto');

const moduleSource = fs.readFileSync(path.join(root, 'lib', 'financial-reader.mjs'), 'utf8');
const cliSource = fs.readFileSync(path.join(root, 'tools', 'financial_dry_run.mjs'), 'utf8');
assert.doesNotMatch(moduleSource, /node:sqlite|lib\/google|sheetsGet|sheetsUpdate|googleFetch/);
assert.match(cliSource, /'-readonly'/);
assert.match(cliSource, /PRAGMA query_only=ON/);
assert.match(cliSource, /immutable=1/);
assert.doesNotMatch(cliSource, /['"`]\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i, 'El CLI no debe contener SQL de escritura');

console.log('financial-reader self-check OK: parser puro, RUT válido y cero escrituras SQLite/Google');
