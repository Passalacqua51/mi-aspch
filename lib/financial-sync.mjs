import crypto from 'node:crypto';
import path from 'node:path';
import { FINANCIAL_YEAR, inspectRut, readFinancialWorkbook } from './financial-reader.mjs';

const text = value => String(value ?? '').trim();
const integer = value => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
const boolInt = value => Number(value) === 1 ? 1 : 0;

export const FINANCIAL_ACCESS_POLICY = Object.freeze({
  ACTIVO: Object.freeze({
    appliedStatus: 'ACTIVO',
    activeRule: 'RESTAURAR_SOLO_SI_DESACTIVADO_POR_XLSM',
    access: 'NORMAL',
    allowed: Object.freeze(['parking', 'simulatorView', 'simulatorRequest', 'studyRoom', 'marketplace']),
    blocked: Object.freeze([]),
    payment: 'ORDINARIO'
  }),
  MOROSO: Object.freeze({
    appliedStatus: 'MOROSO',
    activeRule: 'RESTAURAR_SOLO_SI_DESACTIVADO_POR_XLSM',
    access: 'RESTRINGIDO_POR_MOROSIDAD',
    allowed: Object.freeze(['simulatorView', 'marketplace']),
    blocked: Object.freeze(['parking', 'simulatorRequest', 'studyRoom']),
    payment: 'DEUDA_SOLO_CON_EVIDENCIA_DIRECTA'
  }),
  CONGELADO: Object.freeze({
    appliedStatus: 'CONGELADO',
    activeRule: 'RESTAURAR_SOLO_SI_DESACTIVADO_POR_XLSM',
    access: 'NORMAL_SI_MEMBERS_ACTIVE',
    allowed: Object.freeze(['parking', 'simulatorView', 'simulatorRequest', 'studyRoom', 'marketplace']),
    blocked: Object.freeze([]),
    payment: 'EXENTO'
  }),
  DESAFILIADO: Object.freeze({
    appliedStatus: 'DESAFILIADO',
    activeRule: 'DESACTIVAR_Y_MARCAR_PROPIEDAD_XLSM',
    access: 'SIN_ACCESO_DE_SOCIO',
    allowed: Object.freeze([]),
    blocked: Object.freeze(['parking', 'simulatorView', 'simulatorRequest', 'studyRoom', 'marketplace']),
    payment: 'NO_INFERIR_DEUDA'
  }),
  JUBILADO: Object.freeze({
    appliedStatus: 'JUBILADO',
    activeRule: 'RESTAURAR_SOLO_SI_DESACTIVADO_POR_XLSM',
    access: 'NORMAL_SI_MEMBERS_ACTIVE',
    allowed: Object.freeze(['parking', 'simulatorView', 'simulatorRequest', 'studyRoom', 'marketplace']),
    blocked: Object.freeze([]),
    payment: 'EXENTO'
  }),
  DIRECTORIO: Object.freeze({
    appliedStatus: 'DIRECTORIO',
    activeRule: 'RESTAURAR_SOLO_SI_DESACTIVADO_POR_XLSM',
    access: 'NORMAL_SI_MEMBERS_ACTIVE',
    allowed: Object.freeze(['parking', 'simulatorView', 'simulatorRequest', 'studyRoom', 'marketplace']),
    blocked: Object.freeze([]),
    payment: 'EXENTO'
  })
});

export const UNCLASSIFIED_ACCESS_POLICY = Object.freeze({
  appliedStatus: null,
  activeRule: 'NO_MODIFICAR',
  access: 'CONSERVAR_ESTADO_SQLITE',
  allowed: Object.freeze([]),
  blocked: Object.freeze([]),
  payment: 'NO_INFERIR_DEUDA',
  cause: 'El comentario vacío, libre u otro estado no clasificable no autoriza ninguna escritura.'
});

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

function currentState(member) {
  return {
    financialStatus: text(member.financial_status).toUpperCase() || null,
    sourceStatus: text(member.source_status).toUpperCase() || null,
    active: boolInt(member.active),
    deactivatedByFinancial: boolInt(member.deactivated_by_financial),
    monthsDue: integer(member.months_due),
    amountDueDirect: integer(member.amount_due),
    amountEvidence: text(member.amount_evidence).toUpperCase() || 'LEGACY_UNKNOWN'
  };
}

function desiredState(record, member, policy) {
  const prior = currentState(member);
  const directMonths = record.status === 'MOROSO' ? record.unpaidMonths : [];
  const directAmountCount = directMonths.filter(month => month.directAmount !== null).length;
  let amountEvidence = 'NONE';
  if (directMonths.length && directAmountCount === directMonths.length) amountEvidence = 'COMPLETE';
  else if (directAmountCount) amountEvidence = 'PARTIAL';

  let active = prior.active;
  let deactivatedByFinancial = prior.deactivatedByFinancial;
  let activeCause = 'members.active se conserva porque su estado no era gestionado por la sincronización XLSM.';
  if (record.status === 'DESAFILIADO') {
    if (prior.active === 1) {
      active = 0;
      deactivatedByFinancial = 1;
      activeCause = 'DESAFILIADO explícito desactiva acceso y registra que la desactivación pertenece al XLSM.';
    } else if (prior.deactivatedByFinancial === 1) {
      active = 0;
      deactivatedByFinancial = 1;
      activeCause = 'Se mantiene una desactivación previamente gestionada por el XLSM.';
    } else {
      active = 0;
      deactivatedByFinancial = 0;
      activeCause = 'El socio ya estaba inactivo por otra causa; la sincronización no reclama propiedad de esa desactivación.';
    }
  } else if (prior.deactivatedByFinancial === 1) {
    active = 1;
    deactivatedByFinancial = 0;
    activeCause = `La corrección explícita ${record.status} revierte únicamente la desactivación que había aplicado el XLSM.`;
  }

  return {
    financialStatus: policy.appliedStatus,
    sourceStatus: record.status,
    active,
    deactivatedByFinancial,
    monthsDue: directMonths.length,
    amountDueDirect: record.status === 'MOROSO' ? integer(record.directlyDemonstrableAmount) : 0,
    amountEvidence,
    activeCause
  };
}

function changedFields(prior, next) {
  const comparable = ['financialStatus', 'sourceStatus', 'active', 'deactivatedByFinancial', 'monthsDue', 'amountDueDirect', 'amountEvidence'];
  return comparable.filter(key => prior[key] !== next[key]);
}

function sourceDetail(record, reason) {
  return {
    sourceRow: record.sourceRow,
    rut: record.rut,
    rutRaw: record.rutRaw,
    status: record.status,
    originalComment: record.originalComment,
    reason
  };
}

function memberDetail(item, reason) {
  return {
    memberId: item.member.id ?? null,
    rut: item.rut.normalized,
    rutRaw: text(item.member.rut),
    currentFinancialStatus: text(item.member.financial_status).toUpperCase() || null,
    active: boolInt(item.member.active),
    reason
  };
}

function planHash(plan) {
  const stable = {
    sourceSha256: plan.source?.sha256 || null,
    sourceModifiedAt: plan.source?.modifiedAt || null,
    members: plan.candidates.map(candidate => ({
      memberId: candidate.memberId,
      rut: candidate.rut,
      sourceRow: candidate.sourceRow,
      prior: candidate.prior,
      next: candidate.next
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

export function buildFinancialSyncPlan(parsedWorkbook, members = [], { generatedAt = new Date().toISOString() } = {}) {
  if (!parsedWorkbook?.records || !Array.isArray(members)) throw new Error('Entradas de sincronización inválidas.');
  const records = parsedWorkbook.records;
  const inspectedMembers = members.map(member => ({ member, rut: inspectRut(member.rut) }));
  const validSource = records.filter(record => record.rutValid);
  const invalidSource = records.filter(record => !record.rutValid);
  const validMembers = inspectedMembers.filter(item => item.rut.valid);
  const invalidMembers = inspectedMembers.filter(item => !item.rut.valid);
  const sourceDuplicates = duplicateGroups(validSource, record => record.rut);
  const memberDuplicates = duplicateGroups(validMembers, item => item.rut.normalized);
  const sourceByRut = uniqueMap(validSource, record => record.rut, sourceDuplicates);
  const memberByRut = uniqueMap(validMembers, item => item.rut.normalized, memberDuplicates);
  const safeRuts = [...sourceByRut.keys()].filter(rut => memberByRut.has(rut)).sort();
  const candidates = [];
  const unclassifiedMatches = [];

  for (const rut of safeRuts) {
    const record = sourceByRut.get(rut);
    const item = memberByRut.get(rut);
    const policy = FINANCIAL_ACCESS_POLICY[record.status];
    if (!policy) {
      unclassifiedMatches.push({ ...sourceDetail(record, record.classificationReason || 'ESTADO_NO_DEFINIDO'), memberId: item.member.id ?? null });
      continue;
    }
    const prior = currentState(item.member);
    const next = desiredState(record, item.member, policy);
    const fields = changedFields(prior, next);
    candidates.push({
      memberId: Number(item.member.id),
      rut,
      sourceRow: record.sourceRow,
      sourceStatus: record.status,
      originalComment: record.originalComment,
      policy: {
        appliedStatus: policy.appliedStatus,
        access: policy.access,
        activeRule: policy.activeRule,
        allowed: [...policy.allowed],
        blocked: [...policy.blocked],
        payment: policy.payment
      },
      prior,
      next,
      changedFields: fields,
      changesState: fields.length > 0,
      cause: `Estado ${record.status} explícito en fila ${record.sourceRow}; match 1:1 por RUT válido. ${next.activeCause}`
    });
  }

  const membersWithoutSource = [...memberByRut]
    .filter(([rut]) => !sourceByRut.has(rut))
    .map(([, item]) => memberDetail(item, 'SOCIO_VALIDO_SIN_FILA_XLSM'));
  const sourceWithoutMember = [...sourceByRut]
    .filter(([rut]) => !memberByRut.has(rut))
    .map(([, record]) => sourceDetail(record, 'RUT_VALIDO_SIN_SOCIO_SQLITE'));
  const memberStatusCounts = {};
  const transitions = {};
  for (const candidate of candidates) {
    memberStatusCounts[candidate.sourceStatus] = (memberStatusCounts[candidate.sourceStatus] || 0) + 1;
    if (candidate.changesState) {
      const from = candidate.prior.financialStatus || (candidate.prior.active ? 'ACTIVO_SIN_ESTADO_FINANCIERO' : 'INACTIVO_SIN_ESTADO_FINANCIERO');
      const key = `${from} -> ${candidate.next.financialStatus}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
  }
  const changes = candidates.filter(candidate => candidate.changesState);
  const report = {
    mode: 'READ_ONLY_DRY_RUN',
    generatedAt,
    year: parsedWorkbook.year || FINANCIAL_YEAR,
    source: parsedWorkbook.source || null,
    mapping: {
      explicit: FINANCIAL_ACCESS_POLICY,
      otherOrUnclassified: UNCLASSIFIED_ACCESS_POLICY
    },
    summary: {
      sourceRows: records.length,
      sqliteMembers: members.length,
      safeOneToOneMatches: safeRuts.length,
      applicableMatches: candidates.length,
      membersWithChanges: changes.length,
      statusChanges: changes.filter(candidate => candidate.prior.financialStatus !== candidate.next.financialStatus).length,
      activeFlagChanges: changes.filter(candidate => candidate.prior.active !== candidate.next.active).length,
      unchangedMatches: candidates.length - changes.length,
      membersWithoutSafeMatch: members.length - safeRuts.length,
      validMembersWithoutSource: membersWithoutSource.length,
      validSourceWithoutMember: sourceWithoutMember.length,
      invalidSourceRuts: invalidSource.length,
      invalidMemberRuts: invalidMembers.length,
      duplicateSourceRuts: sourceDuplicates.size,
      duplicateMemberRuts: memberDuplicates.size,
      unclassifiableSourceRows: records.filter(record => !FINANCIAL_ACCESS_POLICY[record.status]).length,
      unclassifiableMatchedMembers: unclassifiedMatches.length,
      formulaErrors: parsedWorkbook.source?.formulaErrors?.length || 0,
      matchedExplicitStates: memberStatusCounts,
      transitions
    },
    candidates,
    changes,
    skipped: {
      invalidSourceRuts: invalidSource.map(record => sourceDetail(record, record.rutIssue)),
      invalidMemberRuts: invalidMembers.map(item => memberDetail(item, item.rut.reason)),
      duplicateSourceRuts: [...sourceDuplicates].map(([rut, values]) => ({ rut, rows: values.map(value => value.sourceRow), reason: 'RUT_DUPLICADO_XLSM' })),
      duplicateMemberRuts: [...memberDuplicates].map(([rut, values]) => ({ rut, memberIds: values.map(value => value.member.id ?? null), reason: 'RUT_DUPLICADO_SQLITE' })),
      membersWithoutSource,
      sourceWithoutMember,
      unclassifiedMatches
    },
    authorization: {
      readyForExplicitAuthorization: true,
      requiresExactPlanId: true,
      applyWiredToRuntime: false,
      blockers: [],
      note: 'El motor de aplicación existe, pero no hay endpoint, scheduler ni invocación automática. Debe autorizarse usando exactamente este plan.'
    },
    safety: {
      writesSqlite: false,
      writesBdSocios: false,
      writesGoogle: false,
      changesMemberIdentity: false,
      changesMemberState: false,
      sendsGmail: false,
      sendsPush: false,
      writesCalendar: false
    }
  };
  report.planId = planHash(report);
  return report;
}

export function runFinancialSyncDryRun({ file, members, year = FINANCIAL_YEAR, asOf = new Date(), generatedAt } = {}) {
  return buildFinancialSyncPlan(readFinancialWorkbook(file, { year, asOf }), members, { generatedAt });
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all().some(item => item.name === column);
}

function initAuditSchema(db) {
  if (!columnExists(db, 'member_financial_status', 'amount_evidence')) {
    db.exec("ALTER TABLE member_financial_status ADD COLUMN amount_evidence TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN'");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_membership_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL UNIQUE,
      source_file TEXT NOT NULL,
      source_sha256 TEXT,
      source_mtime TEXT,
      status TEXT NOT NULL,
      safe_matches INTEGER NOT NULL DEFAULT 0,
      changes_planned INTEGER NOT NULL DEFAULT 0,
      changes_applied INTEGER NOT NULL DEFAULT 0,
      skipped_invalid INTEGER NOT NULL DEFAULT 0,
      skipped_ambiguous INTEGER NOT NULL DEFAULT 0,
      skipped_unclassified INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS financial_membership_sync_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES financial_membership_sync_runs(id),
      member_id INTEGER NOT NULL REFERENCES members(id),
      rut TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      source_status TEXT NOT NULL,
      prior_financial_status TEXT,
      new_financial_status TEXT NOT NULL,
      prior_active INTEGER NOT NULL,
      new_active INTEGER NOT NULL,
      changed_fields_json TEXT NOT NULL,
      cause TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_financial_membership_changes_member
      ON financial_membership_sync_changes(member_id, created_at DESC);
  `);
}

function currentDbState(db, memberId) {
  const amountColumn = columnExists(db, 'member_financial_status', 'amount_evidence')
    ? 'f.amount_evidence'
    : "'LEGACY_UNKNOWN'";
  return db.prepare(`SELECT m.id,m.rut,m.active,f.source_status,f.financial_status,f.months_due,f.amount_due,f.deactivated_by_financial,${amountColumn} amount_evidence
    FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.id=? AND m.role!='ADMIN'`).get(memberId);
}

function samePrior(actual, prior) {
  if (!actual) return false;
  const normalized = currentState(actual);
  return ['financialStatus', 'sourceStatus', 'active', 'deactivatedByFinancial', 'monthsDue', 'amountDueDirect', 'amountEvidence']
    .every(key => normalized[key] === prior[key]);
}

export function applyFinancialSyncPlan(db, plan, { planId, confirmation, actorId = null, appliedAt = new Date().toISOString() } = {}) {
  if (!plan || plan.mode !== 'READ_ONLY_DRY_RUN') throw new Error('Solo puede aplicarse un plan generado por dry-run.');
  if (planId !== plan.planId || confirmation !== 'APLICAR SINCRONIZACION XLSM') {
    throw new Error('Autorización insuficiente: se requiere el planId exacto y la confirmación explícita.');
  }
  if (plan.authorization?.blockers?.length) throw new Error('El plan contiene bloqueos y no puede aplicarse.');
  for (const candidate of plan.candidates || []) {
    const policy = FINANCIAL_ACCESS_POLICY[candidate.sourceStatus];
    if (!policy || policy.appliedStatus !== candidate.next.financialStatus) {
      throw new Error(`Mapeo no definido o alterado para ${candidate.sourceStatus}; se aborta sin cambios.`);
    }
  }

  initAuditSchema(db);
  const startedAt = appliedAt;
  let runId = null;
  let applied = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const run = db.prepare(`INSERT INTO financial_membership_sync_runs(plan_id,source_file,source_sha256,source_mtime,status,safe_matches,changes_planned,skipped_invalid,skipped_ambiguous,skipped_unclassified,started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      plan.planId,
      path.basename(plan.source?.file || 'BASE DE DATOS.xlsm'),
      plan.source?.sha256 || null,
      plan.source?.modifiedAt || null,
      'APPLYING',
      integer(plan.summary?.safeOneToOneMatches),
      integer(plan.summary?.membersWithChanges),
      integer(plan.summary?.invalidSourceRuts) + integer(plan.summary?.invalidMemberRuts),
      integer(plan.summary?.duplicateSourceRuts) + integer(plan.summary?.duplicateMemberRuts),
      integer(plan.summary?.unclassifiableMatchedMembers),
      startedAt
    );
    runId = Number(run.lastInsertRowid);
    const upsert = db.prepare(`INSERT INTO member_financial_status(member_id,rut,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at,deactivated_by_financial,amount_evidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET
      rut=excluded.rut,source_status=excluded.source_status,financial_status=excluded.financial_status,
      months_due=excluded.months_due,amount_due=excluded.amount_due,source_year=excluded.source_year,
      source_updated_at=excluded.source_updated_at,synced_at=excluded.synced_at,
      deactivated_by_financial=excluded.deactivated_by_financial,amount_evidence=excluded.amount_evidence`);
    const auditChange = db.prepare(`INSERT INTO financial_membership_sync_changes(run_id,member_id,rut,source_row,source_status,prior_financial_status,new_financial_status,prior_active,new_active,changed_fields_json,cause,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const auditLog = tableExists(db, 'audit_log') ? db.prepare(`INSERT INTO audit_log(actor_member_id,subject_member_id,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?)`) : null;

    for (const candidate of plan.candidates) {
      const actual = currentDbState(db, candidate.memberId);
      if (!samePrior(actual, candidate.prior) || inspectRut(actual?.rut).normalized !== candidate.rut) {
        throw new Error(`SQLite cambió después del dry-run para member_id=${candidate.memberId}; se revierte toda la sincronización.`);
      }
      if (candidate.prior.active !== candidate.next.active) {
        db.prepare('UPDATE members SET active=? WHERE id=?').run(candidate.next.active, candidate.memberId);
      }
      upsert.run(
        candidate.memberId,
        candidate.rut,
        candidate.next.sourceStatus,
        candidate.next.financialStatus,
        candidate.next.monthsDue,
        candidate.next.amountDueDirect,
        Number(plan.year || FINANCIAL_YEAR),
        plan.source?.modifiedAt || null,
        appliedAt,
        candidate.next.deactivatedByFinancial,
        candidate.next.amountEvidence
      );
      if (!candidate.changesState) continue;
      applied += 1;
      auditChange.run(
        runId, candidate.memberId, candidate.rut, candidate.sourceRow, candidate.sourceStatus,
        candidate.prior.financialStatus, candidate.next.financialStatus,
        candidate.prior.active, candidate.next.active,
        JSON.stringify(candidate.changedFields), candidate.cause, appliedAt
      );
      auditLog?.run(
        actorId, candidate.memberId, 'FINANCIAL_MEMBERSHIP_STATE_CHANGED', 'financial_membership', String(candidate.memberId),
        JSON.stringify({
          runId,
          sourceRow: candidate.sourceRow,
          sourceStatus: candidate.sourceStatus,
          priorFinancialStatus: candidate.prior.financialStatus,
          newFinancialStatus: candidate.next.financialStatus,
          priorActive: candidate.prior.active,
          newActive: candidate.next.active,
          changedFields: candidate.changedFields,
          cause: candidate.cause,
          externalWrites: false
        }),
        appliedAt
      );
    }
    db.prepare("UPDATE financial_membership_sync_runs SET status='OK',changes_applied=?,completed_at=? WHERE id=?").run(applied, appliedAt, runId);
    db.exec('COMMIT');
    return { ok: true, runId, planId: plan.planId, candidatesApplied: plan.candidates.length, stateChangesApplied: applied, externalWrites: false };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    try {
      db.prepare(`INSERT OR IGNORE INTO financial_membership_sync_runs(plan_id,source_file,source_sha256,source_mtime,status,safe_matches,changes_planned,changes_applied,skipped_invalid,skipped_ambiguous,skipped_unclassified,started_at,completed_at,error)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        plan.planId,
        path.basename(plan.source?.file || 'BASE DE DATOS.xlsm'),
        plan.source?.sha256 || null,
        plan.source?.modifiedAt || null,
        'ERROR',
        integer(plan.summary?.safeOneToOneMatches),
        integer(plan.summary?.membersWithChanges),
        0,
        integer(plan.summary?.invalidSourceRuts) + integer(plan.summary?.invalidMemberRuts),
        integer(plan.summary?.duplicateSourceRuts) + integer(plan.summary?.duplicateMemberRuts),
        integer(plan.summary?.unclassifiableMatchedMembers),
        startedAt,
        new Date().toISOString(),
        text(error?.message || error).slice(0, 600)
      );
    } catch {}
    throw error;
  }
}
