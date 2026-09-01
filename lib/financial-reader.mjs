import crypto from 'node:crypto';
import fs from 'node:fs';
import * as _XLSX from 'xlsx';

const XLSX = _XLSX.default || _XLSX;

export const FINANCIAL_SHEET_2026 = 'ESTADO PAGO 2026';
export const FINANCIAL_YEAR = 2026;
export const RECOGNIZED_FINANCIAL_STATUSES = Object.freeze([
  'ACTIVO',
  'MOROSO',
  'CONGELADO',
  'DESAFILIADO',
  'JUBILADO',
  'DIRECTORIO'
]);

const RECOGNIZED_STATUS_SET = new Set(RECOGNIZED_FINANCIAL_STATUSES);
const MONTHS = Object.freeze([
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]);
const MONTH_START_COLUMN = 12; // M, índice cero.
const MONTH_WIDTH = 7;
const FINANCIAL_END_COLUMN = 95; // CR, índice cero.
const DATA_START_ROW = 6;
const PAYMENT_DUE_DAY = 10;

const text = value => String(value ?? '').trim();
const normalizedText = value => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .toUpperCase();
const hasValue = value => value !== null && value !== undefined && text(value) !== '';

function expectedRutCheckDigit(body) {
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return '0';
  if (result === 10) return 'K';
  return String(result);
}

export function inspectRut(value) {
  const raw = text(value);
  const compact = raw.toUpperCase().replace(/[^0-9K]/g, '');
  if (!compact) return { raw, normalized: null, valid: false, missing: true, reason: 'RUT_AUSENTE' };
  if (compact.length < 2) return { raw, normalized: null, valid: false, missing: false, reason: 'FORMATO_INVALIDO' };
  const bodyRaw = compact.slice(0, -1);
  const checkDigit = compact.slice(-1);
  if (!/^\d+$/.test(bodyRaw)) return { raw, normalized: null, valid: false, missing: false, reason: 'FORMATO_INVALIDO' };
  const body = bodyRaw.replace(/^0+(?=\d)/, '');
  const expected = expectedRutCheckDigit(body);
  return {
    raw,
    normalized: `${body}-${checkDigit}`,
    valid: checkDigit === expected,
    missing: false,
    reason: checkDigit === expected ? null : 'DIGITO_VERIFICADOR_INVALIDO',
    expectedCheckDigit: expected
  };
}

function legacyNormalizeRut(value) {
  const compact = text(value).toUpperCase().replace(/[^0-9K]/g, '');
  if (compact.length < 2) return null;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

export function classifyFinancialComment(value) {
  const original = text(value);
  const normalized = normalizedText(original);
  if (RECOGNIZED_STATUS_SET.has(normalized)) {
    return { status: normalized, originalComment: original, reason: 'ESTADO_EXPLICITO' };
  }
  return {
    status: 'NO_CLASIFICADO',
    originalComment: original,
    reason: original ? 'TEXTO_LIBRE' : 'COMENTARIO_VACIO'
  };
}

function asOfParts(asOf) {
  const date = asOf instanceof Date ? asOf : new Date(`${String(asOf)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Fecha de corte inválida: ${asOf}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function monthIsDue(year, month, asOf) {
  return year < asOf.year || (year === asOf.year && (month < asOf.month || (month === asOf.month && asOf.day > PAYMENT_DUE_DAY)));
}

function directUnpaidEvidence(record, year, asOf) {
  if (record.status !== 'MOROSO') return { months: [], directlyDemonstrableAmount: 0 };
  const months = [];
  let directlyDemonstrableAmount = 0;
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthNumber = monthIndex + 1;
    if (!monthIsDue(year, monthNumber, asOf)) continue;
    const start = MONTH_START_COLUMN + monthIndex * MONTH_WIDTH;
    const paidRaw = record.sourceValues[start];
    const unpaidEvidence = !hasValue(paidRaw) || (typeof paidRaw === 'number' && paidRaw === 0);
    if (!unpaidEvidence) continue;
    const totalRaw = record.sourceValues[start + 5];
    const directAmount = typeof totalRaw === 'number' && Number.isFinite(totalRaw) && totalRaw > 0
      ? Math.round(totalRaw)
      : null;
    if (directAmount !== null) directlyDemonstrableAmount += directAmount;
    months.push({
      month: monthNumber,
      monthName: MONTHS[monthIndex],
      paidCell: XLSX.utils.encode_cell({ r: record.sourceRow - 1, c: start }),
      evidence: hasValue(paidRaw) ? 'PAGADO_CERO' : 'PAGADO_VACIO',
      totalCell: XLSX.utils.encode_cell({ r: record.sourceRow - 1, c: start + 5 }),
      directAmount
    });
  }
  return { months, directlyDemonstrableAmount };
}

function validateWorkbookStructure(rows) {
  if (rows.length < DATA_START_ROW) throw new Error(`${FINANCIAL_SHEET_2026} no contiene filas suficientes.`);
  const expectedCore = new Map([
    [2, 'RUT'], [3, 'NOMBRE'], [4, 'CARGO'], [5, 'INSTITUCION'],
    [6, 'OTROS'], [7, 'UF'], [8, 'SEGUROS'], [9, 'P. LICENCIA'],
    [10, 'PAGO'], [11, 'COMENTARIO']
  ]);
  for (const [column, expected] of expectedCore) {
    if (normalizedText(rows[4]?.[column]) !== expected) {
      throw new Error(`Encabezado inválido en ${XLSX.utils.encode_col(column)}5: se esperaba ${expected}.`);
    }
  }
  const expectedMonthHeaders = ['PAGADO', 'OTROS', 'UF', 'SEGURO', 'P. LIC', 'TOTAL', 'REVISION'];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const start = MONTH_START_COLUMN + monthIndex * MONTH_WIDTH;
    const actual = rows[4].slice(start, start + MONTH_WIDTH).map(normalizedText);
    if (actual.join('|') !== expectedMonthHeaders.join('|')) {
      throw new Error(`Bloque mensual inválido en ${XLSX.utils.encode_col(start)}:${XLSX.utils.encode_col(start + 6)}.`);
    }
  }
}

function scanFormulaErrors(worksheet) {
  const errors = [];
  let formulaCount = 0;
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[address];
      if (!cell) continue;
      if (cell.f) formulaCount += 1;
      if (cell.t === 'e') errors.push({ cell: address, error: cell.w || String(cell.v), formula: cell.f || null });
    }
  }
  return { formulaCount, errors };
}

export function parseFinancialRows(rows, { year = FINANCIAL_YEAR, asOf = new Date() } = {}) {
  validateWorkbookStructure(rows);
  const cutoff = asOfParts(asOf);
  const records = [];
  const ignoredRows = [];
  for (let rowIndex = DATA_START_ROW - 1; rowIndex < rows.length; rowIndex += 1) {
    const sourceValues = rows[rowIndex] || [];
    const rut = inspectRut(sourceValues[2]);
    const sourceName = text(sourceValues[3]);
    const used = sourceValues.slice(1, FINANCIAL_END_COLUMN + 1).some(hasValue);
    if (!used) continue;
    if (!rut.raw && !sourceName) {
      ignoredRows.push({ sourceRow: rowIndex + 1, reason: 'SIN_IDENTIDAD' });
      continue;
    }
    const classification = classifyFinancialComment(sourceValues[11]);
    const record = {
      sourceRow: rowIndex + 1,
      sourceName,
      sourceValues,
      rutRaw: rut.raw,
      rut: rut.normalized,
      rutValid: rut.valid,
      rutIssue: rut.reason,
      status: classification.status,
      originalComment: classification.originalComment,
      classificationReason: classification.reason
    };
    const evidence = directUnpaidEvidence(record, year, cutoff);
    record.unpaidMonths = evidence.months;
    record.directlyDemonstrableAmount = evidence.directlyDemonstrableAmount;
    records.push(record);
  }
  return { records, ignoredRows, year, asOf: `${cutoff.year}-${String(cutoff.month).padStart(2, '0')}-${String(cutoff.day).padStart(2, '0')}` };
}

export function readFinancialWorkbook(file, options = {}) {
  if (!file || !fs.existsSync(file)) throw new Error(`Fuente XLSM no encontrada: ${file || '(sin ruta)'}`);
  const stat = fs.statSync(file);
  const workbook = XLSX.readFile(file, { cellDates: true, cellFormula: true, cellStyles: true, raw: true, bookVBA: true });
  const worksheet = workbook.Sheets[FINANCIAL_SHEET_2026];
  if (!worksheet) throw new Error(`No existe la hoja ${FINANCIAL_SHEET_2026}.`);
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null, blankrows: true });
  const parsed = parseFinancialRows(rows, options);
  const formula = scanFormulaErrors(worksheet);
  return {
    ...parsed,
    source: {
      file,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      sheet: FINANCIAL_SHEET_2026,
      range: worksheet['!ref'] || null,
      sheets: workbook.SheetNames,
      hasMacros: Boolean(workbook.vbaraw),
      formulaCount: formula.formulaCount,
      formulaErrors: formula.errors
    }
  };
}

function duplicateGroups(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return new Map([...groups].filter(([, values]) => values.length > 1));
}

function uniqueMap(items, keyOf, duplicates) {
  const result = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key && !duplicates.has(key)) result.set(key, item);
  }
  return result;
}

function financialDetail(record, reason = null) {
  return {
    sourceRow: record.sourceRow,
    rutRaw: record.rutRaw,
    rut: record.rut,
    sourceName: record.sourceName,
    status: record.status,
    originalComment: record.originalComment,
    reason
  };
}

function memberDetail(member, rut, reason = null) {
  return {
    memberId: member.id ?? null,
    rutRaw: text(member.rut),
    rut,
    name: text(member.name),
    active: member.active === undefined ? null : Number(member.active),
    reason
  };
}

function legacyMismatch(records, members) {
  const financialDuplicates = duplicateGroups(records, record => legacyNormalizeRut(record.rutRaw));
  const memberDuplicates = duplicateGroups(members, member => legacyNormalizeRut(member.rut));
  const financial = uniqueMap(records, record => legacyNormalizeRut(record.rutRaw), financialDuplicates);
  const member = uniqueMap(members, item => legacyNormalizeRut(item.rut), memberDuplicates);
  const financialWithoutMember = [...financial].filter(([rut]) => !member.has(rut)).map(([, record]) => financialDetail(record, 'SIN_SOCIO_LEGACY'));
  const membersWithoutFinancial = [...member].filter(([rut]) => !financial.has(rut)).map(([rut, item]) => memberDetail(item, rut, 'SIN_FILA_LEGACY'));
  return {
    exactMatches: [...financial.keys()].filter(rut => member.has(rut)).length,
    financialWithoutMember,
    membersWithoutFinancial
  };
}

export function buildFinancialDryRun(parsedWorkbook, members = []) {
  if (!parsedWorkbook?.records || !Array.isArray(members)) throw new Error('Entradas de dry-run inválidas.');
  const records = parsedWorkbook.records;
  const inspectedMembers = members.map(member => ({ member, rut: inspectRut(member.rut) }));
  const validFinancial = records.filter(record => record.rutValid);
  const invalidFinancial = records.filter(record => !record.rutValid);
  const validMembers = inspectedMembers.filter(item => item.rut.valid);
  const invalidMembers = inspectedMembers.filter(item => !item.rut.valid);
  const financialDuplicates = duplicateGroups(validFinancial, record => record.rut);
  const memberDuplicates = duplicateGroups(validMembers, item => item.rut.normalized);
  const financial = uniqueMap(validFinancial, record => record.rut, financialDuplicates);
  const member = uniqueMap(validMembers, item => item.rut.normalized, memberDuplicates);
  const exactKeys = [...financial.keys()].filter(rut => member.has(rut));
  const financialWithoutMember = [...financial]
    .filter(([rut]) => !member.has(rut))
    .map(([, record]) => financialDetail(record, 'RUT_VALIDO_SIN_SOCIO'));
  const membersWithoutFinancial = [...member]
    .filter(([rut]) => !financial.has(rut))
    .map(([rut, item]) => memberDetail(item.member, rut, 'SOCIO_VALIDO_SIN_FILA'));
  const statusCounts = Object.fromEntries([...RECOGNIZED_FINANCIAL_STATUSES, 'NO_CLASIFICADO'].map(status => [status, 0]));
  for (const record of records) statusCounts[record.status] += 1;
  const unpaidMonths = records.reduce((total, record) => total + record.unpaidMonths.length, 0);
  const directlyDemonstrableAmount = records.reduce((total, record) => total + record.directlyDemonstrableAmount, 0);
  const legacy = legacyMismatch(records, members);
  const duplicateFinancialDetail = [...financialDuplicates].map(([rut, values]) => ({ rut, rows: values.map(value => value.sourceRow) }));
  const duplicateMemberDetail = [...memberDuplicates].map(([rut, values]) => ({ rut, memberIds: values.map(value => value.member.id ?? null) }));
  return {
    mode: 'READ_ONLY_DRY_RUN',
    generatedAt: new Date().toISOString(),
    source: parsedWorkbook.source || null,
    summary: {
      totalRows: records.length,
      validRows: validFinancial.length,
      exactMatches: exactKeys.length,
      memberCount: members.length,
      coveragePercent: members.length ? Math.round((exactKeys.length / members.length) * 10000) / 100 : 0,
      validMemberCoveragePercent: validMembers.length ? Math.round((exactKeys.length / validMembers.length) * 10000) / 100 : 0,
      ...statusCounts,
      invalidFinancialRuts: invalidFinancial.length,
      invalidMemberRuts: invalidMembers.length,
      financialWithoutMember: financialWithoutMember.length,
      membersWithoutFinancial: membersWithoutFinancial.length,
      duplicateFinancialRuts: financialDuplicates.size,
      duplicateMemberRuts: memberDuplicates.size,
      unclassifiedStatuses: statusCounts.NO_CLASIFICADO,
      demonstrableUnpaidMonths: unpaidMonths,
      directlyDemonstrableAmount,
      formulaErrors: parsedWorkbook.source?.formulaErrors?.length || 0,
      legacyAuditExactMatches: legacy.exactMatches,
      legacyAuditFinancialWithoutMember: legacy.financialWithoutMember.length,
      legacyAuditMembersWithoutFinancial: legacy.membersWithoutFinancial.length
    },
    discrepancies: {
      invalidFinancialRuts: invalidFinancial.map(record => financialDetail(record, record.rutIssue)),
      invalidMemberRuts: invalidMembers.map(item => memberDetail(item.member, item.rut.normalized, item.rut.reason)),
      financialWithoutMember,
      membersWithoutFinancial,
      duplicateFinancialRuts: duplicateFinancialDetail,
      duplicateMemberRuts: duplicateMemberDetail,
      unclassifiedStatuses: records.filter(record => record.status === 'NO_CLASIFICADO').map(record => financialDetail(record, record.classificationReason)),
      legacyAudit: {
        description: 'Comparación sin validar dígito verificador; se conserva solo para reconciliar el hallazgo histórico 62/47 y no autoriza estados.',
        financialWithoutMember: legacy.financialWithoutMember,
        membersWithoutFinancial: legacy.membersWithoutFinancial
      }
    },
    evidence: {
      unpaidMonths: records.filter(record => record.unpaidMonths.length).map(record => ({
        sourceRow: record.sourceRow,
        rut: record.rut,
        status: record.status,
        months: record.unpaidMonths,
        directlyDemonstrableAmount: record.directlyDemonstrableAmount
      })),
      formulaErrors: parsedWorkbook.source?.formulaErrors || []
    },
    safety: {
      writesSqlite: false,
      writesGoogle: false,
      changesMemberIdentity: false,
      changesMemberState: false,
      sendsNotifications: false
    }
  };
}

export function runFinancialDryRun({ file, members, year = FINANCIAL_YEAR, asOf = new Date() }) {
  return buildFinancialDryRun(readFinancialWorkbook(file, { year, asOf }), members);
}
