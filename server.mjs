import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { openDb, upsertMember, upsertParkingSpaces, setBoardMembersByRut, normalizeRut, isValidRut, updateMemberEmail, updatePreferredName } from './lib/db.mjs';
import { requestOtp, verifyOtp, memberFromRequest, logout, normalizeEmail, isUnlocked, setPin, unlockWithPin, lockSession, issueOtp, verifyIssuedOtp, consumeOtp, createSession, createSessionWithPin } from './lib/auth.mjs';
import { googleEnabled, googleCapabilities, sheetsReadEnabled, sheetsWriteEnabled, calendarReadEnabled, calendarWriteEnabled, gmailOtpSendEnabled, gmailNotificationSendEnabled, sheetsGet, sheetsAppend, sheetsUpdate, ensureSheet, listCalendarEvents, deleteCalendarEvent, sendWorkspaceEmail } from './lib/google.mjs';
import { webauthnRequestInfo, webauthnSummary, registrationOptions, finishRegistration, authenticationOptions, finishAuthentication, removeAllPasskeys } from './lib/webauthn.mjs';
import { initV050, financialSummary, benefitAccess, latestFinancialSync, studyRoomAvailability, reserveStudyRoom, cancelStudyRoom, createMarketplaceListing, publicMarketplace, marketplaceImage, marketplaceOwnerAction, marketplaceOwnerEdit, moderateMarketplace, expireMarketplace, listActivities, adminActivities, createActivity, setActivityStatus, dueNotificationText } from './lib/v050.mjs';
import { pushEnabled, vapidPublicKey, upsertPushSubscription, removePushSubscription, sendMemberPush } from './lib/push.mjs';
import { initV060, audit, auditRows, moduleStates, moduleEnabled, setModuleState, memberUiPreferences, setMemberUiPreferences, addStudyWaitlist, cancelStudyWaitlist, memberStudyWaitlist, matchingStudyWaitlist, markStudyWaitlistNotified, reportMarketplace, marketplaceReports, resolveMarketplaceReport, agreements, upsertAgreement, setAgreementStatus, libraryItems, toggleLibraryFavorite, upsertLibraryItem, activityCenter, setActivityRegistration, credentialStatus, setCredentialRevoked, memberHistory, systemMetrics, adminMasterSnapshot, adminReservationsSnapshot, adminNotificationsSnapshot, adminSecuritySnapshot, adminAuditSnapshot, dbStats, createBackup, backupRuns, invalidateOtherSessions, invalidateMemberSessions, adminMemberSearch, adminMembersList, adminMemberDetail, diagnostics, toIcs, createVote, updateVoteDraft, deleteVoteDraft, setVoteStatus, voteResults, voteParticipants, adminVotes, memberVotes, castVote } from './lib/v060.mjs';
import { inspectRut, readFinancialWorkbook } from './lib/financial-reader.mjs';
import { buildFinancialSyncPlan } from './lib/financial-sync.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, '.env'));

const VERSION = '0.6.16';
const PREVIEW_MODE = bool(process.env.PREVIEW_MODE, false);
const SESSION_COOKIE_NAME = PREVIEW_MODE ? 'mi_aspch_preview_session' : (process.env.SESSION_COOKIE_NAME || 'mi_aspch_session');
if (PREVIEW_MODE) process.env.SESSION_COOKIE_NAME = SESSION_COOKIE_NAME;
const WHATSAPP_NUMBER = normalizePhoneDigits(process.env.ASPCH_WHATSAPP || '56948825381');
const PORT = Number(process.env.PORT || 8080);
const BIND_ADDRESS = process.env.SERVER_BIND_ADDRESS || '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR || './data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SIPA_PHOTOS_DIR = path.resolve(__dirname, process.env.SIPA_PHOTOS_DIR || './data/sipa-fotos');
const SIPA_PORTRAITS_DIR = path.resolve(__dirname, process.env.SIPA_PORTRAITS_DIR || './data/sipa-retratos');
const PROFILE_PHOTOS_DIR = path.resolve(__dirname, process.env.PROFILE_PHOTOS_DIR || './data/profile-fotos');
const MAX_PROFILE_PHOTO_BYTES = Math.max(250_000, Number(process.env.MAX_PROFILE_PHOTO_BYTES || 5_242_880));
const ALLOW_LEGACY_SIPA_PHOTOS = bool(process.env.ALLOW_LEGACY_SIPA_PHOTOS, false);
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const APP_ORIGINS = new Set([
  APP_ORIGIN,
  ...String(process.env.APP_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)
].map(origin => { try { return new URL(origin).origin; } catch { return null; } }).filter(Boolean));
const db = openDb(DATA_DIR);
const MARKETPLACE_DIR = path.resolve(DATA_DIR, process.env.MARKETPLACE_DIR || 'marketplace');
const FINANCIAL_DIR = path.resolve(DATA_DIR, process.env.FINANCIAL_DIR || 'financial');
const FINANCIAL_XLSM_PATH = path.resolve(process.env.FINANCIAL_XLSM_PATH || path.join(FINANCIAL_DIR,'BASE DE DATOS.xlsm'));
fs.mkdirSync(MARKETPLACE_DIR,{recursive:true}); fs.mkdirSync(FINANCIAL_DIR,{recursive:true});
const BACKUP_DIR=path.resolve(DATA_DIR,process.env.BACKUP_DIR||'backups');fs.mkdirSync(BACKUP_DIR,{recursive:true,mode:0o700});
initV050(db,{adminEmail:process.env.ADMIN_EMAIL||'informatica@aspch.org',adminPinSalt:process.env.ADMIN_BOOTSTRAP_PIN_SALT||'',adminPinHash:process.env.ADMIN_BOOTSTRAP_PIN_HASH||''});
initV060(db);
const ufCache = { key:null, date:null, value:null, fetchedAt:0, sourceUrl:null };
const UF_CACHE_MS = 40 * 24 * 60 * 60 * 1000;
const PARKING_SYNC_CACHE_MS = 12_000;
const parkingSyncCache = new Map();
let parkingLedgerReady = false;
fs.mkdirSync(PROFILE_PHOTOS_DIR, { recursive:true });

const config = {
  membersSheetId: process.env.MEMBERS_SHEET_ID || '1SrJi9TVKAklufiPvW-UOKbCFIuUOohdcrrDmRrCY-bo',
  membersTab: process.env.MEMBERS_SHEET_TAB || 'BD SOCIOS',
  boardSheetId: process.env.BOARD_SHEET_ID || '1GAjgas2C-bo_IFWo3rgjxLFLVpL1e3Y9PSLtHod_dhI',
  boardTab: process.env.BOARD_SHEET_TAB || 'ESTADO PAGO 2026',
  parkingSheetId: process.env.PARKING_SHEET_ID || '1mvBx_mFsUrkGMZAUwh_Bi6uGFpLOCSGv_DeX25BTDn0',
  parkingTab: process.env.PARKING_SHEET_TAB || 'ESTACIONAMIENTO',
  calendarId: process.env.CALENDAR_ID || 'aspch@aspch.org',
  simulatorCancelEnabled: bool(process.env.SIMULATOR_CANCEL_ENABLED, true),
  simulatorCancelNotifyEmail: normalizeEmail(process.env.SIMULATOR_CANCEL_NOTIFY_EMAIL || 'informatica@aspch.org'),
  simulatorQueueSheetId: process.env.SIMULATOR_QUEUE_SHEET_ID || '1trwizgXYfK3sjtXi4ordiDBGJeoidE9wyseffYIUnvs',
  simulatorQueueSimulatorId: process.env.SIMULATOR_QUEUE_SIMULATOR_ID || 'a320',
  simulatorCancelLogTab: process.env.SIMULATOR_CANCEL_LOG_TAB || 'CANCELACIONES_MI_ASPCH',
  parkingSync: bool(process.env.PARKING_SHEET_SYNC, true),
  parkingLogTab: process.env.PARKING_LOG_TAB || 'APP_RESERVAS',
  parkingReservationsTab: process.env.PARKING_RESERVATIONS_TAB || 'RESERVAS_MI_ASPCH',
  simulators: parseSimulators(process.env.SIMULATORS_JSON),
  adminEmail: normalizeEmail(process.env.ADMIN_EMAIL || 'informatica@aspch.org'),
  simulatorRequestUrl: process.env.SIMULATOR_REQUEST_A320_URL || 'https://forms.gle/qzXaCUJgmTyufdKQA',
  simulatorCancelCalendarSendUpdates: process.env.SIMULATOR_CANCEL_CALENDAR_SEND_UPDATES || 'none',
  parkingReminderHours: 4,
  conveniosUrl: process.env.ASPCH_CONVENIOS_URL || 'https://aspch.org/convenios/',
  financialSyncMinutes: Math.max(1,Number(process.env.FINANCIAL_SYNC_MINUTES||5)),
  backupRetention:Math.max(3,Number(process.env.BACKUP_RETENTION||14)),
  dailyBackupHour:Math.max(0,Math.min(23,Number(process.env.DAILY_BACKUP_HOUR||3))),
  dailyBackupMinute:Math.max(0,Math.min(59,Number(process.env.DAILY_BACKUP_MINUTE||15)))
};

const PREVIEW_PROFILES = Object.freeze([
  { key:'ACTIVO',label:'ACTIVO',email:'preview.activo@preview.invalid',name:'Cap. Alicia Activa',preferredName:'Alicia',rut:'99000001-8',birthDate:'1984-04-12',phone:'+56900000001',employer:'LATAM Airlines',category:'Línea Aérea',position:'CPT B787',role:'MEMBER',active:true,isBoard:false,financialStatus:'AL_DIA',monthsDue:0,amountDue:0,paid:true,simpleMode:false },
  { key:'MOROSO',label:'MOROSO',email:'preview.moroso@preview.invalid',name:'FO Martín Moroso',preferredName:'Martín',rut:'99000002-6',birthDate:'1989-02-18',phone:'+56900000002',employer:'JetSMART',category:'Línea Aérea',position:'Primer Oficial A320',role:'MEMBER',active:true,isBoard:false,financialStatus:'MOROSO',monthsDue:3,amountDue:0,amountEvidence:'NONE',paid:false,simpleMode:false },
  { key:'JUBILADO',label:'JUBILADO',email:'preview.jubilado@preview.invalid',name:'Cap. Jaime Jubilado',preferredName:'Jaime',rut:'99000003-4',birthDate:'1958-07-21',phone:'+56900000003',employer:'Jubilado',category:'Jubilado',position:'Capitán Jubilado',role:'MEMBER',active:true,isBoard:false,financialStatus:'JUBILADO',monthsDue:0,amountDue:0,paid:false,simpleMode:false },
  { key:'MODO SIMPLE',label:'MODO SIMPLE',email:'preview.simple@preview.invalid',name:'Cap. Sofía Simple',preferredName:'Sofía',rut:'99000004-2',birthDate:'1982-11-08',phone:'+56900000004',employer:'LATAM Airlines',category:'Línea Aérea',position:'CPT A320',role:'MEMBER',active:true,isBoard:false,financialStatus:'AL_DIA',monthsDue:0,amountDue:0,paid:true,simpleMode:true },
  { key:'FO CPT',label:'FO CPT',email:'preview.fo-cpt@preview.invalid',name:'FO Felipe Operaciones',preferredName:'Felipe',rut:'99000005-0',birthDate:'1991-05-27',phone:'+56900000005',employer:'SKY Airline',category:'Línea Aérea',position:'Primer Oficial A320',role:'MEMBER',active:true,isBoard:false,financialStatus:'AL_DIA',monthsDue:0,amountDue:0,paid:true,simpleMode:false },
  { key:'DIRECTORIO',label:'DIRECTORIO',email:'preview.directorio@preview.invalid',name:'Cap. Daniela Directorio',preferredName:'Daniela',rut:'99000006-9',birthDate:'1977-01-14',phone:'+56900000006',employer:'LATAM Airlines',category:'Línea Aérea',position:'Directora Tesorera',role:'MEMBER',active:true,isBoard:true,financialStatus:'DIRECTORIO',monthsDue:0,amountDue:0,paid:false,simpleMode:false },
  { key:'CONGELADO',label:'CONGELADO',email:'preview.congelado@preview.invalid',name:'FO Camilo Congelado',preferredName:'Camilo',rut:'99000007-7',birthDate:'1987-09-03',phone:'+56900000007',employer:'Particular',category:'Línea Aérea',position:'Primer Oficial',role:'MEMBER',active:true,isBoard:false,financialStatus:'CONGELADO',monthsDue:0,amountDue:0,paid:false,simpleMode:false },
  { key:'DESAFILIADO',label:'DESAFILIADO',email:'preview.desafiliado@preview.invalid',name:'Diego Desafiliado',preferredName:'Diego',rut:'99000008-5',birthDate:'1980-12-30',phone:'+56900000008',employer:'Ex asociado',category:'Desafiliado',position:'Ex piloto',role:'MEMBER',active:false,isBoard:false,financialStatus:'DESAFILIADO',monthsDue:0,amountDue:0,paid:false,simpleMode:false },
  { key:'INFORMATICA',label:'INFORMÁTICA',email:'informatica@aspch.org',name:'INFORMÁTICA PREVIEW',preferredName:'Informática',rut:'99000009-3',birthDate:null,phone:'+56900000009',employer:'ASPCH Preview',category:'Administración',position:'ADMIN Preview',role:'ADMIN',active:true,isBoard:false,financialStatus:'AL_DIA',monthsDue:0,amountDue:0,paid:true,simpleMode:false }
]);

let financialReadCache={mtimeMs:null,public:null,recordsByRut:new Map(),duplicateRuts:new Set()};
initializeExternalData().catch(err=>console.error('[Mi ASPCH] Inicialización externa:',err.message));
startV060Schedulers();

async function initializeExternalData(){
  if(sheetsReadEnabled()){
    try{await syncGoogleStartup()}catch(err){console.error('[Mi ASPCH] Sync inicial Google:',err.message)}
  }
  await readFinancialSafe({force:true});
}

async function handleRequest(req, res, isLabPort, isAdminPort) {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, effectiveRequestOrigin(req) || APP_ORIGIN);
    req.isAdminPort = isAdminPort;
    req.isLabPort = isLabPort;

    if (url.pathname.startsWith('/api/')) {
      if (['POST','PUT','PATCH','DELETE'].includes(req.method)) enforceOrigin(req);
      return await routeApi(req, res, url);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/verify/')) return serveCredentialVerification(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, err.statusCode || 500, { error: err.expose ? err.message : 'Error interno del servidor' });
    else res.end();
  }
}

const server = http.createServer((req, res) => handleRequest(req, res, true, false));

const ADMIN_PORT = PORT + 2;
const adminServer = http.createServer((req, res) => handleRequest(req, res, false, true));

adminServer.listen(ADMIN_PORT, BIND_ADDRESS, () => console.log(`Admin Panel v${VERSION} → http://${BIND_ADDRESS}:${ADMIN_PORT}`));
server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Mi ASPCH v${VERSION} → http://${BIND_ADDRESS}:${PORT}`);
  const caps=googleCapabilities();
  console.log(`Google Workspace: ${caps.enabled?'ACTIVO':'OFF'} · Sheets R:${caps.sheets.read?'ON':'OFF'} W:${caps.sheets.write?'ON':'OFF'} · Calendar R:${caps.calendar.read?'ON':'OFF'} W:${caps.calendar.write?'ON':'OFF'} · Gmail OTP:${caps.gmail.otp?'ON':'OFF'} · Gmail NOTIF:${caps.gmail.notifications?'ON':'OFF'}`);
  console.log(`Push: ${pushEnabled()?'ON':'OFF'} · Finanzas: ${FINANCIAL_XLSM_PATH}`);
});

async function routeApi(req, res, url) {
  const p = url.pathname;
  if (!PREVIEW_MODE && p.startsWith('/api/preview/')) return json(res, 404, { error:'Ruta no encontrada.' });
  if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok:true, version:VERSION, preview:{enabled:PREVIEW_MODE,sqlite:'ISOLATED',externalEffects:PREVIEW_MODE?'BLOCKED':'CONFIGURED'}, google:googleCapabilities(), googleLegacy:googleEnabled(), push:{enabled:pushEnabled()}, financial:{sourceReady:fs.existsSync(FINANCIAL_XLSM_PATH),lastSync:latestFinancialSync(db)}, modules:moduleStates(db) });
  if (req.method === 'GET' && p === '/api/config') {
    const w = webauthnRequestInfo(effectiveRequestOrigin(req), isSecureRequest(req));
    return json(res, 200, {
      appName: process.env.APP_NAME || 'Mi ASPCH', version:VERSION,
      publicAppUrl: w.publicUrl,
      contact: {
        whatsappNumber: WHATSAPP_NUMBER,
        whatsappUrl: whatsappUrl('', 'Hola ASPCH, necesito ayuda con Mi ASPCH.')
      },
      adminEmail:config.adminEmail,
      features:{studyRoom:true,marketplace:true,activities:true,agreements:true,librarySearch:true,myReservations:true,conveniosUrl:config.conveniosUrl,simulatorA320RequestUrl:config.simulatorRequestUrl},
      push:{enabled:pushEnabled(),publicKey:pushEnabled()?vapidPublicKey():null},
      advisors:{legal:{name:'Abogado Tito Muñoz',phone:'+56 9 9196 4314',tel:'tel:+56991964314'},tax:{name:'Contador Manuel Paillafil',phone:'+56 9 9237 1806',tel:'tel:+56992371806'}},
      biometricReady: w.available,
      biometricMode: w.available ? 'passkey' : (w.requiresHttps ? 'requires-https' : 'wrong-origin')
    });
  }

  if (req.method === 'POST' && p === '/api/auth/register/start') {
    const body = await readJson(req);
    const rut = normalizeRut(body.rut);
    const email = normalizeEmail(body.email);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Ingresa un correo válido.' });
    if (!isValidRut(rut)) return json(res, 400, { error: 'Ingresa un RUT chileno válido.' });

    let member = findMemberByRut(rut);
    if (!member && sheetsReadEnabled()) {
      await syncMembersFromGoogle(); await syncBoardFromGoogle();
      member = findMemberByRut(rut);
    }
    if (!member || !member.active) return json(res, 403, { error: 'El RUT no figura como socio habilitado en ASPCH.' });

    const owner = db.prepare('SELECT id FROM members WHERE email=? AND id<>?').get(email, member.id);
    if (owner) return json(res, 409, { error: 'Ese correo ya está asociado a otro socio. Contacta a ASPCH.' });

    const currentEmail = normalizeEmail(member.email);
    const isBoard = !!member.is_board;
    const emailChanged = currentEmail !== email;
    if (emailChanged && !isBoard && !sheetsWriteEnabled()) {
      return json(res, 503, { error: 'La actualización de correo requiere conexión con BD SOCIOS. Intenta más tarde.' });
    }

    const primary = await issueOtp(db, {
      memberId: member.id, email,
      purpose: (emailChanged && !isBoard) ? 'register_new' : 'register_primary',
      mailKind: (emailChanged && !isBoard) ? 'email_new' : 'register'
    });
    if (!primary.ok) {
      if (primary.reason === 'rate_limited') return json(res, 429, { error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' });
      return json(res, 400, { error: 'No fue posible enviar el código de verificación.' });
    }

    let old = null;
    if (emailChanged && !isBoard) {
      old = await issueOtp(db, { memberId:member.id, email:currentEmail, purpose:'register_old', mailKind:'email_old' });
      if (!old.ok) {
        if (old.reason === 'rate_limited') return json(res, 429, { error: 'Demasiados intentos para validar el correo actual. Intenta más tarde.' });
        return json(res, 400, { error: 'No fue posible enviar la autorización al correo actualmente registrado.' });
      }
    }

    return json(res, 200, {
      ok:true, emailChanged: emailChanged && !isBoard,
      targetEmailMasked:maskEmail(email),
      currentEmailMasked:(emailChanged && !isBoard) ? maskEmail(currentEmail) : null
    });
  }

  if (req.method === 'POST' && p === '/api/auth/register/verify') {
    const body = await readJson(req);
    const rut = normalizeRut(body.rut);
    const email = normalizeEmail(body.email);
    if (!isValidRut(rut)) return json(res, 400, { error:'RUT inválido.' });
    let member = findMemberByRut(rut);
    if (!member || !member.active) return json(res, 403, { error:'No fue posible validar al socio.' });

    const currentEmail = normalizeEmail(member.email);
    const isBoard = !!member.is_board;
    const emailChanged = currentEmail !== email;
    const primaryPurpose = (emailChanged && !isBoard) ? 'register_new' : 'register_primary';
    const primary = verifyIssuedOtp(db, { memberId:member.id, email, code:String(body.code || ''), purpose:primaryPurpose, consume:false });
    if (!primary.ok) return json(res, 401, { error:primary.reason === 'expired' ? 'El código del correo ingresado venció.' : 'El código del correo ingresado es incorrecto.' });

    let old = null;
    if (emailChanged) {
      if (!isBoard) {
        old = verifyIssuedOtp(db, { memberId:member.id, email:currentEmail, code:String(body.oldCode || ''), purpose:'register_old', consume:false });
        if (!old.ok) return json(res, 401, { error:old.reason === 'expired' ? 'El código del correo registrado venció.' : 'El código del correo registrado es incorrecto.' });
      }

      const owner = db.prepare('SELECT id FROM members WHERE email=? AND id<>?').get(email, member.id);
      if (owner) return json(res, 409, { error:'Ese correo ya quedó asociado a otro socio.' });

      if (sheetsWriteEnabled()) {
        try { await updateMemberEmailInGoogle(rut, email); } catch(err) { console.warn('[register] sheets update failed:', err?.message || err); if (!isBoard) return json(res, 503, { error:'No pude actualizar BD SOCIOS en este momento.' }); }
      } else if (!isBoard) {
        return json(res, 503, { error:'No pude actualizar BD SOCIOS en este momento.' });
      }

      const changed = updateMemberEmail(db, member.id, email, isBoard ? 'BOARD_REGISTRATION' : 'SELF_REGISTRATION');
      if (!changed.ok) return json(res, 409, { error:'No fue posible actualizar el correo del socio.' });
      if (old) consumeOtp(db, old.row.id);
      member = db.prepare('SELECT * FROM members WHERE id=?').get(member.id);
    }
    consumeOtp(db, primary.row.id);

    // Si ya existe PIN, la nueva sesión parte bloqueada y lo solicita.
    // Si es la primera activación, queda temporalmente abierta solo para crear el PIN.
    const session = createSession(db, member, { unlockedMs:member.pin_hash ? 0 : 30*60_000 });
    setSessionCookie(req, res, session.token);
    return json(res, 200, {
      ok:true,
      emailUpdated:emailChanged,
      requiresPinSetup:!member.pin_hash,
      member:publicMember(member)
    });
  }

  if (req.method === 'POST' && p === '/api/auth/request-code') {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    let member = db.prepare('SELECT id FROM members WHERE email=? AND active=1').get(email);
    if (!member && sheetsReadEnabled()) {
      await syncMembersFromGoogle(); await syncBoardFromGoogle();
      member = db.prepare('SELECT id FROM members WHERE email=? AND active=1').get(email);
    }
    if (!member) return json(res, 403, { error: 'Este correo no figura como socio habilitado.' });
    const result = await requestOtp(db, email);
    if (!result.ok) {
      if (result.reason === 'rate_limited') return json(res, 429, { error: 'Demasiados intentos. Intenta más tarde.' });
      return json(res, 403, { error: 'No fue posible autorizar ese correo.' });
    }
    return json(res, 200, { ok: true, delivered: result.delivered });
  }

  if (req.method === 'POST' && p === '/api/auth/verify-code') {
    const body = await readJson(req);
    const result = verifyOtp(db, body.email, String(body.code || ''));
    if (!result.ok) return json(res, 401, { error: result.reason === 'expired' ? 'El código venció.' : 'Código incorrecto.' });
    setSessionCookie(req, res, result.token);
    return json(res, 200, { ok: true, member: publicMember(result.member) });
  }

  if (req.method === 'POST' && p === '/api/auth/logout') {
    logout(db, req);
    const secure = isSecureRequest(req);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/auth/admin-login') {
    const body=await readJson(req);const email=normalizeEmail(body.email);const pin=String(body.pin||'');
    if(email!==config.adminEmail)return json(res,403,{error:'Acceso administrativo no autorizado.'});
    const result=createSessionWithPin(db,email,pin);
    if(!result.ok){if(result.reason==='rate_limited')return json(res,429,{error:'Demasiados intentos. Intenta más tarde.'});return json(res,401,{error:'Correo o clave de administración incorrectos.'})}
    setSessionCookie(req,res,result.token);return json(res,200,{ok:true,member:publicMember(result.member)});
  }

  if (PREVIEW_MODE && req.method === 'POST' && p === '/api/preview/impersonate') {
    const body = await readJson(req);
    const profile = previewProfile(body.profile || body.type);
    if (!profile) return json(res, 400, { error:'Perfil Preview no válido.' });
    logout(db, req);
    const member = upsertPreviewMember(profile);
    db.prepare('DELETE FROM sessions WHERE member_id=?').run(member.id);
    const session = createSession(db, member, { unlockedMs: 24 * 60 * 60_000 });
    setSessionCookie(req, res, session.token);
    return json(res, 200, {
      ok:true,
      profile:profile.label,
      member:publicMember(member),
      membership:await membershipSummary(member),
      access:benefitAccess(db,member),
      uiPreferences:memberUiPreferences(db,member.id)
    });
  }

  // Toda ruta de autenticación no reconocida se rechaza antes de consultar o
  // crear una sesión. Esto mantiene retirados de forma segura los endpoints antiguos.
  if (p.startsWith('/api/auth/')) return json(res, 404, { error:'Ruta de autenticación no encontrada.' });

  if (req.method === 'PUT' && p === '/api/financial-source/upload') {
    return json(res,403,{error:'Carga XLSM deshabilitada: la fuente se usa únicamente en lectura/diagnóstico.'});
  }

  let member = requestMember(req);
  if (!member) return json(res, 401, { error: 'Debes iniciar sesión.' });
  // La autorización ADMIN se evalúa antes del estado de desbloqueo para que
  // cualquier MEMBER reciba siempre 403 en toda la superficie maestra.
  if (p.startsWith('/api/admin/') && member.role !== 'ADMIN') return json(res, 403, { error: 'Acceso de administrador requerido.' });

  if (req.method === 'GET' && p === '/api/me') {
    return json(res, 200, {
      member: publicMember(member), membership: await membershipSummary(member), access:benefitAccess(db,member),
      security: securitySummary(member, req), modules:moduleStates(db), uiPreferences:memberUiPreferences(db,member.id)
    });
  }

  if (req.method === 'POST' && p === '/api/security/pin') {
    const body = await readJson(req);
    const result = setPin(db, member, body.pin, body.currentPin);
    if (!result.ok) {
      if (result.reason === 'format') return json(res, 400, { error: 'El PIN debe tener entre 4 y 6 dígitos.' });
      return json(res, 401, { error: 'El PIN actual no es correcto.' });
    }
    member = requestMember(req);
    return json(res, 200, { ok:true, security: securitySummary(member, req) });
  }

  // El PIN es obligatorio al terminar la activación inicial.
  if (!member.pin_hash) return json(res, 428, { error:'Crea tu PIN personal para terminar de activar Mi ASPCH.', code:'PIN_REQUIRED' });

  if (req.method === 'POST' && p === '/api/security/unlock') {
    const body = await readJson(req);
    const result = unlockWithPin(db, member, body.pin);
    if (!result.ok) return json(res, 401, { error: result.reason === 'not_set' ? 'Aún no has creado un PIN.' : 'PIN incorrecto.' });
    member = requestMember(req);
    return json(res, 200, { ok:true, security: securitySummary(member, req) });
  }

  if (req.method === 'POST' && p === '/api/security/lock') {
    lockSession(db, member);
    return json(res, 200, { ok:true });
  }

  if (req.method === 'POST' && p === '/api/security/passkey/auth/options') {
    ensurePasskeyAllowed(req);
    const result = await authenticationOptions(db, member);
    if (!result.ok) return json(res, 404, { error: 'Aún no has registrado Face ID, huella o una passkey en esta cuenta.' });
    return json(res, 200, result.options);
  }

  if (req.method === 'POST' && p === '/api/security/passkey/auth/verify') {
    ensurePasskeyAllowed(req);
    const body = await readJson(req, 250_000);
    const result = await finishAuthentication(db, member, body.response || body);
    if (!result.ok) return json(res, 401, { error: passkeyError(result) });
    member = requestMember(req);
    return json(res, 200, { ok:true, security: securitySummary(member, req) });
  }

  if (req.method === 'POST' && p === '/api/security/passkey/register/options') {
    ensurePasskeyAllowed(req);
    if (!isUnlocked(member)) return json(res, 423, { error: 'Desbloquea Mi ASPCH antes de registrar biometría.', code:'LOCKED' });
    const options = await registrationOptions(db, member);
    return json(res, 200, options);
  }

  if (req.method === 'POST' && p === '/api/security/passkey/register/verify') {
    ensurePasskeyAllowed(req);
    if (!isUnlocked(member)) return json(res, 423, { error: 'Desbloquea Mi ASPCH antes de registrar biometría.', code:'LOCKED' });
    const body = await readJson(req, 250_000);
    const result = await finishRegistration(db, member, body.response || body);
    if (!result.ok) return json(res, 400, { error: passkeyError(result) });
    member = requestMember(req);
    return json(res, 200, { ok:true, count:result.count, security:securitySummary(member, req) });
  }

  if (req.method === 'DELETE' && p === '/api/security/passkeys') {
    ensurePasskeyAllowed(req);
    if (!isUnlocked(member)) return json(res, 423, { error: 'Desbloquea Mi ASPCH para modificar la biometría.', code:'LOCKED' });
    const removed = removeAllPasskeys(db, member);
    member = requestMember(req);
    return json(res, 200, { ok:true, removed, security:securitySummary(member, req) });
  }

  // Si el socio creó PIN, todo el contenido privado exige desbloqueo local.
  if (!isUnlocked(member)) return json(res, 423, { error: 'Desbloquea Mi ASPCH para continuar.', code:'LOCKED' });

  if (!p.startsWith('/api/admin/')) {
    const moduleName=moduleForApiPath(p);
    if(moduleName&&!moduleEnabled(db,moduleName)){const st=moduleStates(db)[moduleName];return json(res,503,{error:st?.message||'Este módulo está temporalmente en mantenimiento.',code:'MODULE_MAINTENANCE',module:moduleName});}
  }

  if (req.method === 'POST' && p === '/api/profile/preferred-name') {
    const body = await readJson(req);
    const result = updatePreferredName(db, member.id, body.preferredName);
    if (!result.ok) {
      const messages = {
        empty:'Escribe cómo quieres que te llamemos.',
        too_long:'Usa un nombre de hasta 40 caracteres.',
        invalid_chars:'El nombre puede contener letras, espacios, punto, guion o apóstrofe.'
      };
      return json(res, 400, { error: messages[result.reason] || 'No fue posible guardar el nombre de uso.' });
    }
    member = requestMember(req);
    return json(res, 200, { ok:true, member:publicMember(member) });
  }

  if (req.method === 'PUT' && p === '/api/profile/services') {
    const body = await readJson(req);
    const uiPreferences=setMemberUiPreferences(db,{memberId:member.id,services:body.services,simpleMode:body.simpleMode});
    return json(res,200,{ok:true,uiPreferences});
  }

  if(req.method==='GET'&&p==='/api/security/sessions'){
    const rows=db.prepare('SELECT id,created_at,expires_at,unlocked_until FROM sessions WHERE member_id=? AND expires_at>? ORDER BY created_at DESC').all(member.id,new Date().toISOString());
    return json(res,200,{sessions:rows.map(row=>({current:Number(row.id)===Number(member.session_id),createdAt:row.created_at,expiresAt:row.expires_at,unlocked:!!row.unlocked_until&&new Date(row.unlocked_until)>new Date()}))});
  }
  if(req.method==='DELETE'&&p==='/api/security/sessions'){
    const removed=invalidateOtherSessions(db,{memberId:member.id,currentSessionId:member.session_id,actorId:member.id});
    return json(res,200,{ok:true,removed});
  }

  if (req.method === 'POST' && p === '/api/profile/airline-data') {
    if (!isAirlineMember(member)) return json(res, 403, { error:'Esta actualización está disponible para socios de Línea Aérea.' });
    const body = await readJson(req);
    const employer = String(body.employer || '').trim().replace(/\s+/g,' ');
    const phone = normalizeProfilePhone(body.phone || member.phone || '');
    if (employer.length < 2 || employer.length > 80) return json(res, 400, { error:'Ingresa una aerolínea válida.' });
    if (phone && phone.length < 8) return json(res, 400, { error:'Ingresa un teléfono válido.' });
    const previousEmployer = String(member.employer || '').trim();
    const previousPhone = String(member.phone || '').trim();
    let synced = false;
    if (sheetsWriteEnabled()) {
      await updateMemberFieldsInGoogle(member.rut, { employer, phone });
      synced = true;
    } else {
      return json(res, 503, { error:'La actualización de datos requiere conexión con BD SOCIOS.' });
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE members SET employer=?, phone=?, updated_at=? WHERE id=?').run(employer, phone || previousPhone || null, now, member.id);
    db.prepare(`INSERT INTO airline_change_requests(member_id,previous_airline,new_airline,previous_phone,new_phone,status,created_at,sent_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(member.id, previousEmployer || null, employer, previousPhone || null, phone || previousPhone || null, 'SYNCED_BD_SOCIOS', now, now);
    member = requestMember(req);
    return json(res, 200, { ok:true, synced, member:publicMember(member), message:'Datos actualizados en BD SOCIOS.' });
  }

  if (req.method === 'GET' && p === '/api/news') {
    const rows = db.prepare('SELECT id,title,body,pinned,published_at FROM news ORDER BY pinned DESC, published_at DESC LIMIT 30').all();
    return json(res, 200, { news: rows.map(r => ({ ...r, pinned: !!r.pinned })) });
  }

  if (req.method === 'GET' && p === '/api/parking') {
    const access=benefitAccess(db,member);
    const date = validDate(url.searchParams.get('date')) || todayChile();
    let sheetOccupancy = new Map();
    let googleLive = false;
    let syncWarning = null;
    if (config.parkingSync && sheetsReadEnabled()) {
      try {
        sheetOccupancy = await syncParkingDateFromGoogle(date);
        googleLive = true;
      } catch (e) {
        syncWarning = e.message;
        console.error('[Mi ASPCH] Parking sync GET:', e.message);
      }
    }
    const spaces = db.prepare(`SELECT id,label,building,board_only FROM parking_spaces
      WHERE active=1 AND (board_only=0 OR ?=1) ORDER BY CAST(building AS INTEGER),sort_order,label`).all(member.is_board ? 1 : 0);
    const rows = db.prepare(`SELECT r.id,r.space_id,r.member_id,r.checked_in_at,r.reminder_after_hours,r.last_reminder_at,r.created_at,p.label,p.building
      FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id
      WHERE r.reservation_date=? AND r.status='ACTIVE'`).all(date);
    const mineRow = rows.find(r => r.member_id === member.id) || null;
    const occupiedSet = new Set(rows.map(r => r.space_id));
    for (const [spaceId, occ] of sheetOccupancy) if (!occ.memberId || occ.memberId !== member.id || !mineRow) occupiedSet.add(spaceId);
    const sheetMine = [...sheetOccupancy.entries()].find(([,occ]) => occ.memberId === member.id);
    const mineSpaceId = mineRow?.space_id || sheetMine?.[0] || null;
    return json(res, 200, {
      date,
      access:{allowed:access.parking,reason:access.reason},
      canSeeBoardParking: !!member.is_board,
      mine: mineSpaceId,
      mineReservation: mineRow ? parkingPublicReservation(mineRow) : (sheetMine ? parkingPublicReservation({ id:`sheet-${date}-${sheetMine[0]}`,space_id:sheetMine[0],label:sheetMine[1].label,building:sheetMine[1].building,checked_in_at:null,reminder_after_hours:null }) : null),
      sync: { enabled: !!config.parkingSync, google: sheetsReadEnabled(), live: googleLive, source:'ESTACIONAMIENTOS ASPCH', warning: syncWarning },
      spaces: spaces.map(s => ({ id:s.id,label:s.label,building:s.building,boardOnly:!!s.board_only,occupied:occupiedSet.has(s.id)||sheetOccupancy.has(s.id),mine:s.id===mineSpaceId }))
    });
  }

  if (req.method === 'POST' && p === '/api/parking/reserve') {
    if(!benefitAccess(db,member).parking)return json(res,403,{error:'Este beneficio está temporalmente limitado por tu estado de membresía.',code:'MEMBERSHIP_RESTRICTED'});
    const body = await readJson(req);
    const date = validDate(body.date);
    const spaceId = String(body.spaceId || '');
    if (!date || date < todayChile()) return json(res, 400, { error: 'Fecha inválida.' });
    const space = db.prepare('SELECT * FROM parking_spaces WHERE id=? AND active=1').get(spaceId);
    if (!space) return json(res, 404, { error: 'Estacionamiento no encontrado.' });
    if (space.board_only && !member.is_board) return json(res, 403, { error: 'Ese estacionamiento está reservado para integrantes del Directorio.' });
    if (config.parkingSync && sheetsReadEnabled()) {
      const live = await syncParkingDateFromGoogle(date, { force:true });
      const occupied = live.get(spaceId);
      if (occupied && occupied.memberId !== member.id) return json(res, 409, { error: 'Ese estacionamiento acaba de ser ocupado en ESTACIONAMIENTOS ASPCH.' });
      if (occupied && occupied.memberId === member.id) return json(res, 200, { ok:true, already:true });
    }
    let reservationId = null;
    try {
      const result = db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,source,created_at) VALUES (?,?,?,?,?,?)`)
        .run(date, spaceId, member.id, 'ACTIVE', 'APP', new Date().toISOString());
      reservationId = Number(result.lastInsertRowid);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return json(res, 409, { error: 'Ese cupo ya fue reservado o ya tienes una reserva para ese día.' });
      throw e;
    }
    try {
      if (config.parkingSync && sheetsWriteEnabled()) await publishParkingReservationToGoogle(date, space, member, 'MI_ASPCH');
    } catch (e) {
      if (reservationId) db.prepare(`UPDATE parking_reservations SET status='CANCELLED',cancelled_at=? WHERE id=?`).run(new Date().toISOString(), reservationId);
      throw friendlyError(502, `No pude sincronizar la reserva con ESTACIONAMIENTOS ASPCH: ${e.message}`);
    }
    await safeParkingLog('RESERVA', date, space, member);
    audit(db,{actorId:member.id,subjectId:member.id,action:'PARKING_RESERVED',entityType:'parking',entityId:reservationId,details:{date,space:space.label,building:space.building}});
    parkingSyncCache.delete(date);
    return json(res, 201, { ok: true });
  }

  if (req.method === 'DELETE' && p === '/api/parking/reserve') {
    const body = await readJson(req);
    const date = validDate(body.date);
    if (!date) return json(res, 400, { error: 'Fecha inválida.' });
    const row = db.prepare(`SELECT r.id,r.checked_in_at,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id
      WHERE r.reservation_date=? AND r.member_id=? AND r.status='ACTIVE'`).get(date, member.id);
    if (!row) return json(res, 404, { error: 'No tienes una reserva activa ese día.' });
    if (row.checked_in_at) return json(res, 409, { error: 'Ya marcaste que estás estacionado. Usa “Marcar desocupado”.' });
    db.prepare(`UPDATE parking_reservations SET status='CANCELLED',cancelled_at=? WHERE id=?`).run(new Date().toISOString(), row.id);
    if (config.parkingSync && sheetsWriteEnabled()) {
      await setParkingReservationGoogleStatus(date, row, member, 'CANCELADO');
      if (date === todayChile()) await clearVisibleParkingIfOwned(row, member);
      parkingSyncCache.delete(date);
    }
    await safeParkingLog('CANCELA', date, row, member);
    audit(db,{actorId:member.id,subjectId:member.id,action:'PARKING_CANCELLED',entityType:'parking',entityId:row.id,details:{date,space:row.label}});
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/parking/check-in') {
    if(!benefitAccess(db,member).parking)return json(res,403,{error:'Este beneficio está temporalmente limitado por tu estado de membresía.',code:'MEMBERSHIP_RESTRICTED'});
    const body = await readJson(req);
    const date = validDate(body.date) || todayChile();
    if (date !== todayChile()) return json(res, 400, { error: 'Solo puedes marcar llegada en la fecha de hoy.' });
    const hours = 4;
    const row = db.prepare(`SELECT r.id,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id
      WHERE r.reservation_date=? AND r.member_id=? AND r.status='ACTIVE'`).get(date, member.id);
    if (!row) return json(res, 404, { error: 'No tienes reserva activa para hoy.' });
    const now = new Date().toISOString();
    db.prepare(`UPDATE parking_reservations SET checked_in_at=COALESCE(checked_in_at,?), reminder_after_hours=? WHERE id=?`).run(now, hours, row.id);
    await safeParkingLog('LLEGA', date, row, member);
    audit(db,{actorId:member.id,subjectId:member.id,action:'PARKING_CHECKED_IN',entityType:'parking',entityId:row.id,details:{date,space:row.label}});
    return json(res, 200, { ok:true, reminderHours:hours });
  }

  if (req.method === 'POST' && p === '/api/parking/vacate') {
    const body = await readJson(req);
    const date = validDate(body.date) || todayChile();
    const row = db.prepare(`SELECT r.id,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id
      WHERE r.reservation_date=? AND r.member_id=? AND r.status='ACTIVE'`).get(date, member.id);
    if (!row) return json(res, 404, { error: 'No tienes una reserva activa ese día.' });
    const now = new Date().toISOString();
    db.prepare(`UPDATE parking_reservations SET status='VACATED',vacated_at=? WHERE id=?`).run(now, row.id);
    if (config.parkingSync && sheetsWriteEnabled()) {
      await setParkingReservationGoogleStatus(date, row, member, 'DESOCUPADO');
      if (date === todayChile()) await clearVisibleParkingIfOwned(row, member);
      parkingSyncCache.delete(date);
    }
    await safeParkingLog('DESOCUPA', date, row, member);
    audit(db,{actorId:member.id,subjectId:member.id,action:'PARKING_VACATED',entityType:'parking',entityId:row.id,details:{date,space:row.label}});
    return json(res, 200, { ok:true });
  }

  if (req.method === 'GET' && p === '/api/simulators') {
    const access=benefitAccess(db,member);
    if(!access.simulatorView)return json(res,403,{error:'Tu cuenta no está activa como socio ASPCH.'});
    const from = validDate(url.searchParams.get('from')) || mondayOf(todayChile());
    const to = validDate(url.searchParams.get('to')) || addDays(from, 4);
    const occupancies = calendarReadEnabled() ? await calendarPrivacyView(member, from, to) : [];
    return json(res, 200, { simulators: config.simulators.map(({ id,label }) => ({ id,label })), from, to, occupancies,
      cancellationEnabled:config.simulatorCancelEnabled && calendarWriteEnabled(), requestAllowed:access.simulatorRequest,
      restrictionReason:access.reason, a320RequestUrl:access.simulatorRequest?config.simulatorRequestUrl:null });
  }

  if (req.method === 'POST' && p === '/api/simulators/cancel') {
    if (!config.simulatorCancelEnabled) return json(res, 403, { error:'La cancelación de turnos está deshabilitada temporalmente.' });
    if (!calendarWriteEnabled()) return json(res, 503, { error:'Calendar WRITE está deshabilitado temporalmente.' });
    const body = await readJson(req);
    const eventRef = String(body.eventRef || '').trim();
    const from = validDate(body.from) || mondayOf(todayChile());
    const to = validDate(body.to) || addDays(from, 4);
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(eventRef)) return json(res, 400, { error:'Turno inválido.' });

    const found = await findCancelableCalendarEvent(member, eventRef, from, to);
    if (!found) return json(res, 404, { error:'No encontré ese turno confirmado a tu nombre.' });

    let nextCandidate = null;
    try { nextCandidate = await nextSimulatorCandidate(found, member); }
    catch (err) { console.error('[Mi ASPCH] Lista de espera simulador:', err.message); }

    try {
      await deleteCalendarEvent({ calendarId:config.calendarId, eventId:found.googleEventId, sendUpdates:config.simulatorCancelCalendarSendUpdates });
    } catch (err) {
      if (/unauthorized_client|insufficient|forbidden|403/i.test(err.message)) {
        return json(res, 503, { error:'Falta autorizar el permiso de cancelación de Google Calendar para Mi ASPCH.' });
      }
      throw err;
    }

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO simulator_cancellations(member_id,event_ref,simulator_id,slot_date,period,start_at,next_candidate_name,next_candidate_email,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(member.id,eventRef,found.simulatorId,found.start.slice(0,10),found.period,found.start,nextCandidate?.name||null,nextCandidate?.email||null,now);

    audit(db,{actorId:member.id,subjectId:member.id,action:'SIMULATOR_CANCELLED',entityType:'simulator',entityId:eventRef,details:{simulator:found.simulator,start:found.start,nextCandidate:nextCandidate?.name||null}});
    const notices = await notifySimulatorCancellation({ member, found, nextCandidate });
    await safeSimulatorCancellationLog({ member, found, nextCandidate, notices, now });
    return json(res, 200, {
      ok:true,
      message:'Turno cancelado. ASPCH fue informado' + (notices.nextCandidateNotified ? ' y se avisó al siguiente socio disponible.' : '.'),
      staffNotified:notices.staffNotified,
      nextCandidateNotified:notices.nextCandidateNotified
    });
  }

  if (req.method === 'GET' && p === '/api/reservations') {
    const scope=String(url.searchParams.get('scope')||'upcoming').toLowerCase();
    const result=await unifiedReservations(member,{scope});
    return json(res,200,result);
  }
  if (req.method === 'GET' && p === '/api/reservations/ics') {
    const type=String(url.searchParams.get('type')||'');const id=String(url.searchParams.get('id')||'');const date=String(url.searchParams.get('date')||'');
    const event=await reservationForIcs(member,{type,id,date});if(!event)return json(res,404,{error:'Reserva no encontrada.'});
    const ics=toIcs(event);res.statusCode=200;res.setHeader('Content-Type','text/calendar; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="mi-aspch-${type}-${String(id).replace(/[^A-Za-z0-9_-]/g,'')}.ics"`);res.setHeader('Cache-Control','private, no-store');return res.end(ics);
  }

  if (req.method === 'GET' && p === '/api/credential') {
    const code = credentialCode(member.id);
    const profilePhoto = findProfilePhoto(member.id);
    const sipaPhoto = findSipaPhoto(member.rut);
    const appleWalletConfigured = bool(process.env.APPLE_WALLET_ENABLED,false) && !!process.env.APPLE_WALLET_PASS_TYPE_ID && !!process.env.APPLE_WALLET_TEAM_ID;
    const credState=credentialStatus(db,member.id);
    return json(res, 200, { credential: {
      name:member.name,rut:visibleMemberRut(member),category:member.category,position:member.position,active:!!member.active&&!credState.revoked,revoked:credState.revoked,revocationReason:credState.reason,
      code, verifyPath:`/verify/${code}`, hasPhoto:!!(profilePhoto||sipaPhoto), photoSource:profilePhoto?'PROFILE':(sipaPhoto?'SIPA':'NONE'),
      appleWalletReady:false, appleWalletConfigured
    }});
  }

  if (req.method === 'GET' && p === '/api/credential/photo') {
    const photo = findCredentialPhoto(member);
    if (!photo) return json(res, 404, { error:'No hay fotografía disponible para este socio.' });
    return sendFile(res, photo, 'private, no-store');
  }

  if (req.method === 'POST' && p === '/api/credential/photo') {
    const body = await readJson(req, Math.ceil(MAX_PROFILE_PHOTO_BYTES * 1.55));
    const saved = saveProfilePhoto(member.id, body.dataUrl);
    return json(res, 200, { ok:true, source:'PROFILE', bytes:saved.bytes });
  }

  if (req.method === 'DELETE' && p === '/api/credential/photo') {
    removeProfilePhoto(member.id);
    return json(res, 200, { ok:true, source:findSipaPhoto(member.rut)?'SIPA':'NONE' });
  }

  if (req.method === 'GET' && p === '/api/credential/qr') {
    const code = credentialCode(member.id);
    const verifyUrl = credentialVerifyUrl(req, code);
    const svg = await QRCode.toString(verifyUrl, { type:'svg', errorCorrectionLevel:'M', margin:1, width:256, color:{dark:'#14224b',light:'#ffffff'} });
    res.statusCode=200;res.setHeader('Content-Type','image/svg+xml; charset=utf-8');res.setHeader('Cache-Control','private, no-store');return res.end(svg);
  }

  if (req.method === 'GET' && p === '/api/credential/wallet') {
    return json(res, 503, { error:'Apple Wallet requiere configurar el Pass Type ID y el certificado de firma de ASPCH antes de emitir pases.' });
  }

  if (req.method === 'GET' && p === '/api/membership') {
    const payroll=isLatamPayrollEmployer(member.employer);
    return json(res, 200, { membership: await membershipSummary(member), payments: db.prepare('SELECT membership_year,membership_month,amount_clp,status,paid_at FROM membership_payments WHERE member_id=? ORDER BY membership_year DESC,membership_month DESC,id DESC').all(member.id), contact:{ whatsappNumber: WHATSAPP_NUMBER, whatsappUrl: whatsappUrl('', 'Hola ASPCH, necesito ayuda con Mi ASPCH.') }, transfer:payroll?null:transferSummary(), paymentMethod:payroll?'PAYROLL':'TRANSFER' });
  }

  if(req.method==='GET'&&p==='/api/history')return json(res,200,{history:memberHistory(db,member.id,{limit:Number(url.searchParams.get('limit')||100)})});
  if(req.method==='GET'&&p==='/api/modules')return json(res,200,{modules:moduleStates(db)});

  if(req.method==='GET'&&p==='/api/push/public-key')return json(res,200,{enabled:pushEnabled(),publicKey:pushEnabled()?vapidPublicKey():null});
  if(req.method==='POST'&&p==='/api/push/subscribe'){
    if(!pushEnabled())return json(res,503,{error:'Web Push aún no está configurado.'});const body=await readJson(req,250_000);
    upsertPushSubscription(db,{memberId:member.id,subscription:body.subscription,topics:body.topics,userAgent:req.headers['user-agent']||''});return json(res,200,{ok:true});
  }
  if(req.method==='DELETE'&&p==='/api/push/subscribe'){const body=await readJson(req);return json(res,200,{ok:true,removed:removePushSubscription(db,{memberId:member.id,endpoint:body.endpoint})})}

  if(req.method==='GET'&&p==='/api/study-room'){
    const access=benefitAccess(db,member);if(!access.studyRoom)return json(res,403,{error:'La Sala de estudios no está disponible mientras tu membresía esté morosa.',code:'MEMBERSHIP_RESTRICTED'});
    const from=url.searchParams.get('from')||new Date().toISOString(),to=url.searchParams.get('to')||new Date(Date.now()+14*86400_000).toISOString();
    return json(res,200,{...studyRoomAvailability(db,{from,to,memberId:member.id}),maxHours:4});
  }
  if(req.method==='POST'&&p==='/api/study-room/reserve'){
    const access=benefitAccess(db,member);if(!access.studyRoom)return json(res,403,{error:'La Sala de estudios no está disponible mientras tu membresía esté morosa.',code:'MEMBERSHIP_RESTRICTED'});
    const body=await readJson(req);const start=body.date&&body.startTime?chileLocalIso(body.date,body.startTime):body.start;const end=body.date&&body.endTime?chileLocalIso(body.date,body.endTime):body.end;const id=reserveStudyRoom(db,{memberId:member.id,start,end});audit(db,{actorId:member.id,subjectId:member.id,action:'STUDY_RESERVED',entityType:'study_reservation',entityId:id,details:{start,end}});return json(res,201,{ok:true,id});
  }
  if(req.method==='DELETE'&&p==='/api/study-room/reserve'){
    const body=await readJson(req);const rid=Number(body.id);const prior=db.prepare("SELECT * FROM study_room_reservations WHERE id=? AND member_id=? AND status='ACTIVE'").get(rid,member.id);
    if(!cancelStudyRoom(db,{memberId:member.id,id:rid}))return json(res,404,{error:'Reserva no encontrada.'});
    audit(db,{actorId:member.id,subjectId:member.id,action:'STUDY_RESERVATION_CANCELLED',entityType:'study_reservation',entityId:rid,details:prior||{}});
    if(prior)await notifyStudyWaitlistReleased(prior);
    return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&p==='/api/study-room/waitlist')return json(res,200,{waitlist:memberStudyWaitlist(db,member.id)});
  if(req.method==='POST'&&p==='/api/study-room/waitlist'){
    const access=benefitAccess(db,member);if(!access.studyRoom)return json(res,403,{error:'La Sala de estudios no está disponible mientras tu membresía esté morosa.',code:'MEMBERSHIP_RESTRICTED'});
    const body=await readJson(req);const start=body.date&&body.startTime?chileLocalIso(body.date,body.startTime):body.start;const end=body.date&&body.endTime?chileLocalIso(body.date,body.endTime):body.end;
    const id=addStudyWaitlist(db,{memberId:member.id,start,end});return json(res,201,{ok:true,id,message:'Te avisaremos si ese bloque se libera. No se reserva automáticamente.'});
  }
  if(req.method==='DELETE'&&p==='/api/study-room/waitlist'){const body=await readJson(req);if(!cancelStudyWaitlist(db,{memberId:member.id,id:Number(body.id)}))return json(res,404,{error:'Espera no encontrada.'});return json(res,200,{ok:true})}

  if(req.method==='GET'&&p==='/api/marketplace'){
    if(!benefitAccess(db,member).marketplace)return json(res,403,{error:'Mercado ASPCH no disponible para esta cuenta.'});return json(res,200,{listings:publicMarketplace(db,{memberId:member.id})});
  }
  if(req.method==='POST'&&p==='/api/marketplace'){
    if(!benefitAccess(db,member).marketplace)return json(res,403,{error:'Mercado ASPCH no disponible para esta cuenta.'});const body=await readJson(req,12_000_000);const r=createMarketplaceListing(db,{memberId:member.id,...body,dir:MARKETPLACE_DIR});audit(db,{actorId:member.id,subjectId:member.id,action:'MARKETPLACE_CREATED',entityType:'marketplace',entityId:r.id,details:{title:body.title}});return json(res,201,{ok:true,...r,message:'Publicación enviada a aprobación de ASPCH.'});
  }
  if(req.method==='POST'&&p==='/api/marketplace/action'){const body=await readJson(req);if(!marketplaceOwnerAction(db,{memberId:member.id,id:Number(body.id),action:String(body.action||'').toUpperCase()}))return json(res,404,{error:'Publicación no encontrada o acción inválida.'});return json(res,200,{ok:true})}
  if(req.method==='POST'&&p==='/api/marketplace/edit'){const body=await readJson(req);if(!marketplaceOwnerEdit(db,{memberId:member.id,id:Number(body.id),title:body.title,description:body.description,price:body.price,contact:body.contact}))return json(res,404,{error:'Publicación no encontrada.'});return json(res,200,{ok:true,message:'Cambios enviados a nueva aprobación.'})}
  if(req.method==='POST'&&p==='/api/marketplace/report'){const body=await readJson(req);const id=reportMarketplace(db,{listingId:Number(body.id),memberId:member.id,reason:body.reason});return json(res,201,{ok:true,id,message:'Reporte enviado a Informática ASPCH.'})}
  if(req.method==='GET'&&p.startsWith('/api/marketplace/image/')){const id=Number(p.split('/').pop());const file=marketplaceImage(db,id,MARKETPLACE_DIR,{memberId:member.id,admin:member.role==='ADMIN'});if(!file)return json(res,404,{error:'Imagen no encontrada.'});return sendFile(res,file,'private, max-age=3600')}

  if(req.method==='GET'&&p==='/api/votes')return json(res,200,{votes:memberVotes(db,member.id)});
  if(req.method==='POST'&&p==='/api/votes/cast'){const body=await readJson(req);const result=castVote(db,{electionId:Number(body.electionId),memberId:member.id,optionId:Number(body.optionId)});return json(res,201,result)}
  if(req.method==='GET'&&p==='/api/votes/receipt'){const electionId=Number(url.searchParams.get('electionId'));const receipt=String(url.searchParams.get('receipt')||'').trim().toUpperCase();if(!electionId||!receipt)return json(res,400,{error:'Comprobante inválido.'});const election=db.prepare('SELECT status FROM vote_elections WHERE id=?').get(electionId);if(!election)return json(res,404,{error:'Votación no encontrada.'});if(election.status!=='CLOSED'&&election.status!=='ARCHIVED')return json(res,409,{error:'El comprobante puede verificarse cuando la votación esté cerrada.'});const found=!!db.prepare('SELECT 1 FROM vote_ballots WHERE election_id=? AND receipt_code=?').get(electionId,receipt);return json(res,200,{ok:true,found})}

  if(req.method==='GET'&&p==='/api/activities')return json(res,200,{activities:activityCenter(db,member.id)});
  if(req.method==='POST'&&p==='/api/activities/registration'){const body=await readJson(req);if(!setActivityRegistration(db,{memberId:member.id,activityId:Number(body.id),registered:body.registered!==false}))return json(res,404,{error:'Actividad no encontrada.'});return json(res,200,{ok:true})}
  if(req.method==='GET'&&p==='/api/agreements')return json(res,200,{agreements:agreements(db)});
  if(req.method==='GET'&&p==='/api/library'){return json(res,200,{items:libraryItems(db,{memberId:member.id,query:url.searchParams.get('q')||'',category:url.searchParams.get('category')||''})})}
  if(req.method==='POST'&&p==='/api/library/favorite'){const body=await readJson(req);if(!toggleLibraryFavorite(db,{memberId:member.id,itemId:Number(body.id),favorite:body.favorite!==false}))return json(res,404,{error:'Documento no encontrado.'});return json(res,200,{ok:true})}

  if (p.startsWith('/api/admin/')) {
    if(req.method==='GET'&&p==='/api/admin/dashboard'){
      const modules=moduleStates(db),today=chileClock().date,operational=adminMasterSnapshot(db,{today,modules}),financial=await readFinancialSafe(),caps=googleCapabilities();
      const sqliteFile=path.join(DATA_DIR,'mi-aspch.sqlite'),sqliteSize=fs.existsSync(sqliteFile)?fs.statSync(sqliteFile).size:null;
      const alerts=masterAlerts({financial,operational,caps,pushReady:pushEnabled()});
      const events=auditRows(db,{limit:8}).map(x=>({id:x.id,action:x.action,entityType:x.entity_type||null,actorName:x.actor_name||'Sistema',createdAt:x.created_at}));
      return json(res,200,{generatedAt:new Date().toISOString(),health:{ok:!alerts.some(x=>x.severity==='critical'),status:alerts.some(x=>x.severity==='critical')?'CRITICAL':alerts.length?'WARNING':'OPERATIVE',version:VERSION,uptimeSeconds:Math.round(process.uptime())},operational,financial,integrations:{bdSocios:{status:operational.bdSocios.records?'LOCAL_SNAPSHOT_READY':'NO_LOCAL_DATA',...operational.bdSocios},googleSheets:{status:caps.sheets?.read?'CONFIGURED_NOT_PROBED':'DISABLED',read:!!caps.sheets?.read,write:!!caps.sheets?.write},googleCalendar:{status:caps.calendar?.read?'CONFIGURED_NOT_PROBED':'DISABLED',read:!!caps.calendar?.read,write:!!caps.calendar?.write},otp:{status:caps.gmail?.otp?'DELIVERY_ENABLED':'DELIVERY_DISABLED',...operational.otp},push:{status:pushEnabled()?'ENABLED':'DISABLED',enabled:pushEnabled(),...operational.push},simulators:{status:'NO_RELIABLE_LOCAL_SOURCE',available:false,impact:'Ocupación no mostrada; Calendar no se consulta automáticamente desde este dashboard.'}},sqlite:{...operational.sqlite,sizeBytes:sqliteSize},modules,alerts,audit:events});
    }
    if(req.method==='GET'&&p==='/api/admin/reservations'){
      const today=chileClock().date;
      const liveParking=await getAdminLiveParking(today);
      return json(res,200,adminReservationsSnapshot(db,{today,liveParking}));
    }
    if(req.method==='GET'&&p==='/api/admin/integrations')return json(res,200,await adminIntegrationsSnapshot());
    if(req.method==='GET'&&p==='/api/admin/system')return json(res,200,adminSystemSnapshot());
    if(req.method==='GET'&&p==='/api/admin/notifications')return json(res,200,adminNotificationsSnapshot(db,{pushReady:pushEnabled(),gmailOtpReady:gmailOtpSendEnabled()}));
    if(req.method==='GET'&&p==='/api/admin/security')return json(res,200,adminSecuritySnapshot(db,{adminEmail:config.adminEmail,gmailOtpReady:gmailOtpSendEnabled()}));
    if(req.method==='GET'&&p==='/api/admin/audit')return json(res,200,adminAuditSnapshot(db,{from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',action:url.searchParams.get('action')||'',memberId:url.searchParams.get('memberId'),category:url.searchParams.get('category')||'',limit:url.searchParams.get('limit')}));
    if(req.method==='GET'&&p==='/api/admin/members/list')return json(res,200,{generatedAt:new Date().toISOString(),...adminMembersList(db,{query:url.searchParams.get('q')||'',page:url.searchParams.get('page'),limit:url.searchParams.get('limit')})});
    const memberActionMatch=p.match(/^\/api\/admin\/members\/(\d+)\/actions\/(refresh|release-parking|cancel-study|close-sessions|revoke-passkeys|issue-otp|reset-pin|set-pin)$/);
    if(req.method==='POST'&&memberActionMatch){
      const targetId=Number(memberActionMatch[1]),action=memberActionMatch[2],target=db.prepare("SELECT * FROM members WHERE id=? AND role!='ADMIN'").get(targetId);
      if(!target)return json(res,404,{error:'Socio no encontrado.'});
      const body=await readJson(req),confirmations={'release-parking':'LIBERAR RESERVA','cancel-study':'CANCELAR RESERVA','close-sessions':'CERRAR SESIONES','revoke-passkeys':'REVOCAR PASSKEYS','issue-otp':'GENERAR OTP'};
      if(confirmations[action]&&String(body.confirm||'')!==confirmations[action])return json(res,400,{error:`Confirmación requerida: ${confirmations[action]}`});
      let result={ok:true};
      if(action==='refresh'){
        const authority=await financialAuthorityForMember(target.rut,{force:true});
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_MEMBER_SOURCE_REFRESHED',entityType:'member',entityId:targetId,details:{source:'XLSM_READ_ONLY'}});
        return json(res,200,{ok:true,...adminMemberDetail(db,targetId,{authority,modules:moduleStates(db),otpDeliveryEnabled:gmailOtpSendEnabled()})});
      }
      if(action==='release-parking'){
        const id=Number(body.reservationId),prior=db.prepare("SELECT id,reservation_date,space_id FROM parking_reservations WHERE id=? AND member_id=? AND status='ACTIVE'").get(id,targetId);
        if(!prior)return json(res,404,{error:'Reserva de estacionamiento activa no encontrada.'});
        const changed=db.prepare("UPDATE parking_reservations SET status='CANCELLED',cancelled_at=? WHERE id=? AND member_id=? AND status='ACTIVE'").run(new Date().toISOString(),id,targetId);result={ok:true,changed:Number(changed.changes||0)};
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_PARKING_RELEASED',entityType:'parking',entityId:id,details:{date:prior.reservation_date,spaceId:prior.space_id,externalWrites:false}});
      }else if(action==='cancel-study'){
        const id=Number(body.reservationId),prior=db.prepare("SELECT id,start_at,end_at FROM study_room_reservations WHERE id=? AND member_id=? AND status='ACTIVE'").get(id,targetId);
        if(!prior)return json(res,404,{error:'Reserva de sala activa no encontrada.'});
        const changed=db.prepare("UPDATE study_room_reservations SET status='CANCELLED',cancelled_at=? WHERE id=? AND member_id=? AND status='ACTIVE'").run(new Date().toISOString(),id,targetId);result={ok:true,changed:Number(changed.changes||0)};
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_STUDY_RESERVATION_CANCELLED',entityType:'study_reservation',entityId:id,details:{start:prior.start_at,end:prior.end_at,externalNotifications:false}});
      }else if(action==='close-sessions')result={ok:true,removed:invalidateMemberSessions(db,{memberId:targetId,actorId:member.id})};
      else if(action==='revoke-passkeys'){
        db.exec('BEGIN IMMEDIATE');let removed=0;try{db.prepare('DELETE FROM webauthn_challenges WHERE session_id IN (SELECT id FROM sessions WHERE member_id=?)').run(targetId);removed=Number(db.prepare('DELETE FROM passkeys WHERE member_id=?').run(targetId).changes||0);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_PASSKEYS_REVOKED',entityType:'passkey',entityId:targetId,details:{removed}});result={ok:true,removed};
      }else if(action==='issue-otp'){
        if(!gmailOtpSendEnabled())return json(res,503,{error:'Entrega OTP deshabilitada; no se generó ningún código.'});
        const issued=await issueOtp(db,{memberId:targetId,email:target.email,purpose:'login',mailKind:'login'});if(!issued.ok)return json(res,issued.reason==='rate_limited'?429:400,{error:'No fue posible generar y enviar un nuevo OTP.'});
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_OTP_REISSUED',entityType:'otp',entityId:targetId,details:{delivered:issued.delivered,expiresAt:issued.expiresAt}});result={ok:true,delivered:issued.delivered,expiresAt:issued.expiresAt};
      }else if(action==='reset-pin'){
        db.exec('BEGIN IMMEDIATE');let sessionsRemoved=0;try{db.prepare('UPDATE members SET pin_salt=NULL,pin_hash=NULL,pin_updated_at=NULL,updated_at=? WHERE id=?').run(new Date().toISOString(),targetId);sessionsRemoved=Number(db.prepare('DELETE FROM sessions WHERE member_id=?').run(targetId).changes||0);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_PIN_RESET',entityType:'security',entityId:targetId,details:{sessionsRemoved,secretsExposed:false}});result={ok:true,sessionsRemoved};
      }else if(action==='set-pin'){
        const pin=String(body.pin||'');if(!/^\d{4,6}$/.test(pin))return json(res,400,{error:'El PIN debe tener entre 4 y 6 dígitos.'});
        const salt=crypto.randomBytes(16).toString('base64url'),hash=crypto.scryptSync(pin,salt,32).toString('base64url'),stamp=new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');let sessionsRemoved=0;try{db.prepare('UPDATE members SET pin_salt=?,pin_hash=?,pin_updated_at=?,updated_at=? WHERE id=?').run(salt,hash,stamp,stamp,targetId);sessionsRemoved=Number(db.prepare('DELETE FROM sessions WHERE member_id=?').run(targetId).changes||0);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
        audit(db,{actorId:member.id,subjectId:targetId,action:'ADMIN_PIN_CHANGED',entityType:'security',entityId:targetId,details:{sessionsRemoved,secretsExposed:false}});result={ok:true,sessionsRemoved};
      }
      return json(res,200,result);
    }
    const memberDetailMatch=p.match(/^\/api\/admin\/members\/(\d+)$/);
    if(req.method==='GET'&&memberDetailMatch){const targetId=Number(memberDetailMatch[1]),target=db.prepare("SELECT rut FROM members WHERE id=? AND role!='ADMIN'").get(targetId);if(!target)return json(res,404,{error:'Socio no encontrado.'});const authority=await financialAuthorityForMember(target.rut);const detail=adminMemberDetail(db,targetId,{authority,modules:moduleStates(db),otpDeliveryEnabled:gmailOtpSendEnabled()});return json(res,200,{generatedAt:new Date().toISOString(),...detail})}
    if (req.method === 'POST' && p === '/api/admin/sync-members') {
      if (!sheetsReadEnabled()) return json(res, 400, { error: 'Google Sheets READ no está habilitado.' });
      const count = await syncMembersFromGoogle(); const board = await syncBoardFromGoogle(); const financial=await readFinancialSafe({force:true});
      return json(res, 200, { ok:true,count,board,financial });
    }
    if (req.method === 'POST' && p === '/api/admin/sync-parking') {
      if (!sheetsReadEnabled()) return json(res, 400, { error: 'Google Sheets READ no está habilitado.' });
      const count = await syncParkingSpacesFromGoogle();
      return json(res, 200, { ok: true, count });
    }
    if (req.method === 'POST' && p === '/api/admin/news') {
      const body = await readJson(req);
      const title = String(body.title || '').trim(); const text = String(body.body || '').trim();
      if (!title || !text) return json(res, 400, { error: 'Título y contenido son obligatorios.' });
      const result = db.prepare('INSERT INTO news(title,body,pinned,published_at,created_by) VALUES (?,?,?,?,?)').run(title,text,body.pinned?1:0,new Date().toISOString(),member.id);
      await broadcastTopic('news',{keyBase:`news:${result.lastInsertRowid}`,title:'Mi ASPCH · Noticias',body:title,url:'/?view=news'});
      return json(res, 201, { ok:true,id:Number(result.lastInsertRowid) });
    }
    if(req.method==='POST'&&p==='/api/admin/news/delete'){const body=await readJson(req);const id=Number(body.id);const prior=db.prepare('SELECT * FROM news WHERE id=?').get(id);if(!prior)return json(res,404,{error:'Noticia no encontrada.'});db.prepare('DELETE FROM news WHERE id=?').run(id);audit(db,{actorId:member.id,action:'ADMIN_NEWS_DELETED',entityType:'news',entityId:id,details:{title:prior.title}});return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/admin/sync-financial'){const result=await readFinancialSafe({force:true});audit(db,{actorId:member.id,action:'ADMIN_XLSM_REREAD',entityType:'financial_source',details:{mode:'READ_ONLY_DIAGNOSTIC',status:result.status}});return json(res,200,{ok:result.sourceReady,result})}
    if(req.method==='PUT'&&p==='/api/admin/financial-upload')return json(res,403,{error:'Carga XLSM deshabilitada en Control Maestro: la fuente se usa únicamente en lectura/diagnóstico.'});
    if(req.method==='GET'&&p==='/api/admin/overview'){
      const finance={lastSync:latestFinancialSync(db),counts:Object.fromEntries(db.prepare('SELECT financial_status,COUNT(*) n FROM member_financial_status GROUP BY financial_status').all().map(x=>[x.financial_status,Number(x.n)]))};
      const studyRows=db.prepare(`SELECT r.id,r.start_at AS start,r.end_at AS end,r.status,m.name AS member_name,m.email AS member_email FROM study_room_reservations r JOIN members m ON m.id=r.member_id WHERE r.status='ACTIVE' AND r.end_at>? ORDER BY r.start_at LIMIT 300`).all(new Date().toISOString());
      return json(res,200,{google:googleCapabilities(),push:{enabled:pushEnabled(),subscriptions:Number(db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n)},finance,marketplace:publicMarketplace(db,{memberId:member.id,admin:true}),marketplaceReports:marketplaceReports(db),activities:adminActivities(db),news:db.prepare('SELECT * FROM news ORDER BY pinned DESC,published_at DESC,id DESC LIMIT 100').all(),study:{reservations:studyRows,waitlist:db.prepare("SELECT w.*,m.name member_name,m.email member_email FROM study_room_waitlist w JOIN members m ON m.id=w.member_id WHERE w.status='ACTIVE' ORDER BY w.start_at LIMIT 300").all()},modules:moduleStates(db),metrics:systemMetrics(db),agreements:agreements(db,{admin:true}),library:libraryItems(db,{admin:true}),votes:adminVotes(db),backups:backupRuns(db),audit:auditRows(db,{limit:150}),dbStats:dbStats(db)});
    }
    if(req.method==='POST'&&p==='/api/admin/marketplace/moderate'){
      const body=await readJson(req),id=Number(body.id),status=String(body.status||'').toUpperCase();const listing=db.prepare('SELECT member_id,title FROM marketplace_listings WHERE id=?').get(id);
      if(!moderateMarketplace(db,{id,status,note:body.note}))return json(res,400,{error:'No fue posible moderar la publicación.'});
      if(listing){await sendMemberPush(db,listing.member_id,{key:`market-moderation:${id}:${status}:${Date.now()}`,kind:'marketplace',title:'Mi ASPCH · Mercado',body:status==='ACTIVE'?`Tu publicación “${listing.title}” fue aprobada y ya está visible.`:`Tu publicación “${listing.title}” no fue aprobada. Revisa o comunícate con ASPCH.`,url:'/?view=marketplace'})}
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&p==='/api/admin/study-room/cancel'){const body=await readJson(req);const id=Number(body.id);const prior=db.prepare("SELECT * FROM study_room_reservations WHERE id=? AND status='ACTIVE'").get(id);const r=db.prepare("UPDATE study_room_reservations SET status='CANCELLED',cancelled_at=? WHERE id=? AND status='ACTIVE'").run(new Date().toISOString(),id);if(Number(r.changes)){audit(db,{actorId:member.id,subjectId:prior?.member_id||null,action:'ADMIN_STUDY_RESERVATION_CANCELLED',entityType:'study_reservation',entityId:id,details:prior||{}});if(prior)await notifyStudyWaitlistReleased(prior)}return json(res,Number(r.changes)?200:404,{ok:!!Number(r.changes),error:Number(r.changes)?undefined:'Reserva no encontrada.'})}
    if(req.method==='POST'&&p==='/api/admin/activities'){const body=await readJson(req);const id=createActivity(db,body);await broadcastTopic('activities',{keyBase:`activity:${id}`,title:'Mi ASPCH · Nueva actividad',body:String(body.title||'Nueva actividad ASPCH').slice(0,220),url:'/?view=activities'});return json(res,201,{ok:true,id})}
    if(req.method==='POST'&&p==='/api/admin/activities/update'){const body=await readJson(req);const id=Number(body.id);const prior=db.prepare('SELECT * FROM activities WHERE id=?').get(id);if(!prior)return json(res,404,{error:'Actividad no encontrada.'});const type=String(body.type||prior.type||'EVENT').toUpperCase();if(!['COURSE','TALK','EVENT'].includes(type))return json(res,400,{error:'Tipo inválido.'});const title=String(body.title??prior.title).trim();const externalUrl=String(body.externalUrl??prior.external_url).trim();if(!title||!/^https:\/\//i.test(externalUrl))return json(res,400,{error:'Título y URL https son obligatorios.'});db.prepare('UPDATE activities SET type=?,title=?,description=?,starts_at=?,ends_at=?,registration_open_at=?,registration_close_at=?,external_url=?,updated_at=? WHERE id=?').run(type,title,String(body.description??prior.description??'').trim(),body.startsAt??prior.starts_at,body.endsAt??prior.ends_at,body.registrationOpenAt??prior.registration_open_at,body.registrationCloseAt??prior.registration_close_at,externalUrl,new Date().toISOString(),id);audit(db,{actorId:member.id,action:'ADMIN_ACTIVITY_UPDATED',entityType:'activity',entityId:id,details:{title}});return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/admin/activities/status'){const body=await readJson(req);if(!setActivityStatus(db,{id:Number(body.id),status:body.status}))return json(res,400,{error:'No fue posible cambiar la actividad.'});return json(res,200,{ok:true})}
    if(req.method==='GET'&&p==='/api/admin/votes')return json(res,200,{votes:adminVotes(db)});
    if(req.method==='POST'&&p==='/api/admin/votes'){const body=await readJson(req);const id=createVote(db,{...body,actorId:member.id});return json(res,201,{ok:true,id})}
    if(req.method==='POST'&&p==='/api/admin/votes/update'){const body=await readJson(req);const id=updateVoteDraft(db,{...body,id:Number(body.id),actorId:member.id});if(!id)return json(res,404,{error:'Votación no encontrada.'});return json(res,200,{ok:true,id})}
    if(req.method==='POST'&&p==='/api/admin/votes/delete'){const body=await readJson(req);if(!deleteVoteDraft(db,{id:Number(body.id),actorId:member.id}))return json(res,404,{error:'Votación no encontrada.'});return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/admin/votes/status'){const body=await readJson(req);const r=setVoteStatus(db,{id:Number(body.id),status:body.status,actorId:member.id});if(!r)return json(res,404,{error:'Votación no encontrada o estado inválido.'});if(String(body.status||'').toUpperCase()==='OPEN'){const vote=db.prepare('SELECT opens_at FROM vote_elections WHERE id=?').get(Number(body.id));if(!vote?.opens_at||new Date(vote.opens_at).getTime()<=Date.now())await broadcastVoteOpen(Number(body.id));}return json(res,200,r)}
    if(req.method==='GET'&&p==='/api/admin/votes/results'){const r=voteResults(db,Number(url.searchParams.get('id')));if(!r)return json(res,404,{error:'Votación no encontrada.'});return json(res,200,r)}
    if(req.method==='GET'&&p==='/api/admin/votes/voters'){const id=Number(url.searchParams.get('id'));if(!id)return json(res,400,{error:'ID requerido.'});return json(res,200,{id,voters:voteParticipants(db,id)})}
    if(req.method==='GET'&&p==='/api/admin/votes/export'){
      const id=Number(url.searchParams.get('id'));
      const r=voteResults(db,id);
      if(!r)return json(res,404,{error:'Votación no encontrada.'});
      const e=r.election;
      const lines=[
        ['VOTACION_ID','TITULO','ESTADO','SECRETO','PADRON','APERTURA','CIERRE','HABILITADOS','PARTICIPACION','PENDIENTES','QUORUM_PORCENTAJE'],
        [e.id,`"${(e.title||'').replace(/"/g,'""')}"`,e.status,e.secrecy,e.eligibility_rule,e.opens_at||'',e.closes_at||'',r.eligible,r.participation,(r.eligible-r.participation),`${r.turnout}%`],
        [],
        ['OPCION_ID','OPCION_LABEL','VOTOS','PORCENTAJE_VOTOS'],
        ...(r.options||[]).map(o=>[o.id,`"${(o.label||'').replace(/"/g,'""')}"`,o.votes,r.participation?`${Math.round(o.votes*10000/r.participation)/100}%`:'0%'])
      ];
      const csv=lines.map(row=>row.join(',')).join('\r\n');
      res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="votacion-${e.id}-resultados.csv"`});
      return res.end('\uFEFF'+csv);
    }
    if(req.method==='POST'&&p==='/api/admin/modules'){const body=await readJson(req);if(!setModuleState(db,{module:body.module,enabled:body.enabled!==false,message:body.message,actorId:member.id}))return json(res,400,{error:'Módulo inválido.'});return json(res,200,{ok:true,modules:moduleStates(db)})}
    if(req.method==='POST'&&p==='/api/admin/backup'){const result=createBackup(db,{backupDir:BACKUP_DIR,retention:config.backupRetention,actorId:member.id});return json(res,result.ok?200:500,result)}
    if(req.method==='GET'&&p==='/api/admin/diagnostics')return json(res,200,diagnostics(db,{version:VERSION,google:googleCapabilities(),push:{enabled:pushEnabled()},financial:{sourceReady:fs.existsSync(FINANCIAL_XLSM_PATH),lastSync:latestFinancialSync(db)},moduleStates:moduleStates(db),dataDir:DATA_DIR}));
    if(req.method==='GET'&&p==='/api/admin/members')return json(res,200,{members:adminMemberSearch(db,url.searchParams.get('q')||'')});
    if(req.method==='POST'&&p==='/api/admin/member/sessions/revoke'){const body=await readJson(req);const target=Number(body.memberId);if(!target)return json(res,400,{error:'Socio inválido.'});const removed=target===member.id?invalidateOtherSessions(db,{memberId:target,currentSessionId:member.session_id,actorId:member.id}):invalidateMemberSessions(db,{memberId:target,actorId:member.id});return json(res,200,{ok:true,removed})}
    if(req.method==='POST'&&p==='/api/admin/member/credential'){const body=await readJson(req);const target=Number(body.memberId);if(!db.prepare('SELECT 1 FROM members WHERE id=?').get(target))return json(res,404,{error:'Socio no encontrado.'});setCredentialRevoked(db,{memberId:target,revoked:body.revoked===true,reason:body.reason,actorId:member.id});return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/admin/push/test-self'){const body=await readJson(req);const r=await sendMemberPush(db,member.id,{key:`admin-self-test:${Date.now()}`,kind:'general',title:String(body.title||'Mi ASPCH · Prueba developer').slice(0,100),body:String(body.body||'Notificación de prueba enviada solo a Informática ASPCH.').slice(0,350),url:'/?view=admin',force:true});audit(db,{actorId:member.id,subjectId:member.id,action:'ADMIN_PUSH_SELF_TEST',entityType:'push',details:{sent:r.sent}});return json(res,200,r)}
    if(req.method==='POST'&&p==='/api/admin/push/send'){
      const body=await readJson(req),target=Number(body.memberId||0),title=String(body.title||'Mi ASPCH').slice(0,100),text=String(body.body||'').slice(0,350),kind=String(body.kind||'general').slice(0,50),targetUrl=String(body.url||'/?view=home').slice(0,300);
      if(!text)return json(res,400,{error:'Mensaje obligatorio.'});
      if(body.dryRun!==false)return json(res,200,{ok:true,dryRun:true,target:target||'ALL',eligible:target?Number(db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE member_id=?').get(target).n):Number(db.prepare('SELECT COUNT(DISTINCT member_id) n FROM push_subscriptions').get().n)});
      let sent=0,recipients=0;if(target){const r=await sendMemberPush(db,target,{key:`admin-push:${Date.now()}:${target}`,kind,title,body:text,url:targetUrl,force:true});sent+=r.sent;recipients=1}else{if(String(body.confirm||'')!=='ENVIAR A TODOS')return json(res,400,{error:'Para enviar a todos escribe exactamente ENVIAR A TODOS.'});const ids=db.prepare('SELECT DISTINCT member_id FROM push_subscriptions').all();for(const x of ids){const r=await sendMemberPush(db,x.member_id,{key:`admin-broadcast:${Date.now()}:${x.member_id}`,kind,title,body:text,url:targetUrl,force:true});sent+=r.sent;recipients++}}
      audit(db,{actorId:member.id,action:'ADMIN_PUSH_SENT',entityType:'push',details:{target:target||'ALL',recipients,sent,title}});return json(res,200,{ok:true,recipients,sent});
    }
    if(req.method==='POST'&&p==='/api/admin/marketplace/report/resolve'){const body=await readJson(req);if(!resolveMarketplaceReport(db,{id:Number(body.id),actorId:member.id,status:body.status,note:body.note}))return json(res,404,{error:'Reporte abierto no encontrado.'});return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/admin/agreements'){const body=await readJson(req),isNew=!Number(body.id||0);const id=upsertAgreement(db,{...body,actorId:member.id});if(isNew&&String(body.status||'ACTIVE').toUpperCase()==='ACTIVE')await broadcastTopic('agreements',{keyBase:`agreement:${id}`,title:'Mi ASPCH · Nuevo convenio',body:String(body.title||'Nuevo convenio ASPCH').slice(0,220),url:'/?view=agreements'});return json(res,201,{ok:true,id})}
    if(req.method==='POST'&&p==='/api/admin/agreements/status'){const body=await readJson(req);if(!setAgreementStatus(db,{id:Number(body.id),status:body.status,actorId:member.id}))return json(res,400,{error:'No fue posible actualizar el convenio.'});return json(res,200,{ok:true})}
    if(req.method==='POST'&&p==='/api/admin/library'){const body=await readJson(req);const id=upsertLibraryItem(db,{...body,actorId:member.id});return json(res,201,{ok:true,id})}
    if(req.method==='POST'&&p==='/api/admin/library/status'){const body=await readJson(req);const item=db.prepare('SELECT * FROM library_items WHERE id=?').get(Number(body.id));if(!item)return json(res,404,{error:'Documento no encontrado.'});const id=upsertLibraryItem(db,{...item,id:item.id,status:body.status,actorId:member.id});return json(res,200,{ok:true,id})}
    if(req.method==='POST'&&p==='/api/admin/jobs/run'){
      const body=await readJson(req),job=String(body.job||'');let result;
      if(job==='sync_all')result={members:await syncMembersFromGoogle(),board:await syncBoardFromGoogle(),parking:await syncParkingSpacesFromGoogle(),finance:await readFinancialSafe({force:true})};
      else if(job==='financial_sync')result=await readFinancialSafe({force:true});
      else if(job==='members_sync')result={members:await syncMembersFromGoogle(),board:await syncBoardFromGoogle()};
      else if(job==='parking_sync')result={spaces:await syncParkingSpacesFromGoogle()};
      else if(job==='marketplace_expire')result={expired:expireMarketplace(db)};
      else if(job==='notification_cycle'){await runBackgroundJobs();result={ok:true};}
      else if(job==='backup')result=createBackup(db,{backupDir:BACKUP_DIR,retention:config.backupRetention,actorId:member.id});
      else if(job==='cleanup_sessions'){const r=db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());result={removed:Number(r.changes||0)};}
      else return json(res,400,{error:'Job developer no permitido.'});
      audit(db,{actorId:member.id,action:'ADMIN_JOB_RUN',entityType:'job',entityId:job,details:result});return json(res,200,{ok:true,result});
    }
    if(req.method==='GET'&&p==='/api/admin/export'){
      const dataset=String(url.searchParams.get('dataset')||'members');let rows=[];
      if(dataset==='members')rows=db.prepare(`SELECT id,name,email,rut,employer,category,position,role,active,is_board,updated_at FROM members ORDER BY name`).all();
      else if(dataset==='finance')rows=db.prepare(`SELECT m.name,m.email,m.rut,f.financial_status,f.months_due,f.amount_due,f.source_year,f.synced_at FROM member_financial_status f JOIN members m ON m.id=f.member_id ORDER BY m.name`).all();
      else if(dataset==='parking')rows=db.prepare(`SELECT r.id,r.reservation_date,r.status,r.checked_in_at,r.vacated_at,p.label,p.building,m.name,m.email FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id JOIN members m ON m.id=r.member_id ORDER BY r.reservation_date DESC,r.id DESC`).all();
      else if(dataset==='study')rows=db.prepare(`SELECT r.id,r.start_at,r.end_at,r.status,r.created_at,r.cancelled_at,m.name,m.email FROM study_room_reservations r JOIN members m ON m.id=r.member_id ORDER BY r.start_at DESC`).all();
      else if(dataset==='marketplace')rows=db.prepare(`SELECT l.id,l.title,l.price,l.contact,l.status,l.created_at,l.updated_at,l.expires_at,m.name owner_name,m.email owner_email FROM marketplace_listings l JOIN members m ON m.id=l.member_id ORDER BY l.id DESC`).all();
      else if(dataset==='activities')rows=db.prepare(`SELECT id,type,title,starts_at,ends_at,external_url,status,created_at,updated_at FROM activities ORDER BY id DESC`).all();
      else if(dataset==='votes')rows=db.prepare(`SELECT v.id,v.title,v.secrecy,v.eligibility_rule,v.status,v.opens_at,v.closes_at,(SELECT COUNT(*) FROM vote_eligibility e WHERE e.election_id=v.id) eligible,(SELECT COUNT(*) FROM vote_participation p WHERE p.election_id=v.id) participation FROM vote_elections v ORDER BY v.id DESC`).all();
      else if(dataset==='audit')rows=auditRows(db,{limit:1000});
      else return json(res,400,{error:'Dataset no permitido.'});
      audit(db,{actorId:member.id,action:'ADMIN_DATA_EXPORTED',entityType:'export',entityId:dataset,details:{rows:rows.length}});return sendCsv(res,`mi-aspch-${dataset}-${new Date().toISOString().slice(0,10)}.csv`,rows);
    }
    if(req.method==='POST'&&p==='/api/admin/db/maintenance'){
      const body=await readJson(req),action=String(body.action||'');let result;
      if(action==='quick_check')result=db.prepare('PRAGMA quick_check').all();
      else if(action==='optimize'){db.exec('PRAGMA optimize');result={ok:true};}
      else if(action==='wal_checkpoint')result=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
      else return json(res,400,{error:'Acción DB no permitida.'});
      audit(db,{actorId:member.id,action:'ADMIN_DB_MAINTENANCE',entityType:'database',entityId:action,details:result});return json(res,200,{ok:true,result});
    }
    if(req.method==='POST'&&p==='/api/admin/cache/clear'){parkingSyncCache.clear();ufCache.key=null;ufCache.date=null;ufCache.value=null;ufCache.fetchedAt=0;ufCache.sourceUrl=null;audit(db,{actorId:member.id,action:'RUNTIME_CACHES_CLEARED',entityType:'system'});return json(res,200,{ok:true})}
  }

  return json(res, 404, { error: 'Ruta no encontrada.' });
}


let backgroundBusy=false;
async function readFinancialSafe({force=false}={}){
  try{
    if(!fs.existsSync(FINANCIAL_XLSM_PATH)){
      const result={mode:'READ_ONLY_DIAGNOSTIC',sourceReady:false,status:'MISSING',fileName:path.basename(FINANCIAL_XLSM_PATH),lastReadAt:new Date().toISOString(),error:'Fuente XLSM no encontrada.',safety:{writesSqlite:false,writesGoogle:false,changesMemberState:false}};
      financialReadCache={mtimeMs:null,public:result,recordsByRut:new Map(),duplicateRuts:new Set()};return result;
    }
    const st=fs.statSync(FINANCIAL_XLSM_PATH);if(!force&&financialReadCache.public&&st.mtimeMs===financialReadCache.mtimeMs)return financialReadCache.public;
    const parsed=readFinancialWorkbook(FINANCIAL_XLSM_PATH,{year:Number(process.env.FINANCIAL_YEAR||2026)}),groups=new Map(),counts={};
    for(const record of parsed.records){counts[record.status]=(counts[record.status]||0)+1;if(record.rutValid){if(!groups.has(record.rut))groups.set(record.rut,[]);groups.get(record.rut).push(record)}}
    const duplicateRuts=new Set([...groups].filter(([,records])=>records.length>1).map(([rut])=>rut)),recordsByRut=new Map([...groups].filter(([rut,records])=>!duplicateRuts.has(rut)&&records.length===1).map(([rut,records])=>[rut,records[0]]));
    const members=db.prepare(`SELECT m.id,m.rut,m.active,f.source_status,f.financial_status,f.months_due,f.amount_due,f.deactivated_by_financial
      FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.role!='ADMIN' ORDER BY m.id`).all();
    const dryRun=buildFinancialSyncPlan(parsed,members);
    const result={mode:'READ_ONLY_DIAGNOSTIC',sourceReady:true,status:parsed.source.formulaErrors.length?'WARNING':'OK',fileName:path.basename(FINANCIAL_XLSM_PATH),sheet:parsed.source.sheet,lastReadAt:new Date().toISOString(),sourceModifiedAt:parsed.source.modifiedAt,rows:parsed.records.length,validRows:parsed.records.filter(record=>record.rutValid).length,uniqueMatchesAvailable:recordsByRut.size,duplicateRuts:duplicateRuts.size,formulaErrors:parsed.source.formulaErrors.length,counts,dryRun:{planId:dryRun.planId,summary:dryRun.summary,mapping:dryRun.mapping,safety:dryRun.safety},safety:{writesSqlite:false,writesGoogle:false,changesMemberState:false}};
    financialReadCache={mtimeMs:st.mtimeMs,public:result,recordsByRut,duplicateRuts};
    console.log(`[Mi ASPCH] XLSM diagnóstico read-only: ${result.validRows}/${result.rows} filas válidas · ${result.duplicateRuts} RUT duplicados`);return result;
  }catch(err){
    const result={mode:'READ_ONLY_DIAGNOSTIC',sourceReady:false,status:'ERROR',fileName:path.basename(FINANCIAL_XLSM_PATH),lastReadAt:new Date().toISOString(),error:String(err.message||err).slice(0,300),safety:{writesSqlite:false,writesGoogle:false,changesMemberState:false}};
    financialReadCache={mtimeMs:null,public:result,recordsByRut:new Map(),duplicateRuts:new Set()};console.error('[Mi ASPCH] Lectura XLSM:',err.message);return result;
  }
}
async function financialAuthorityForMember(rut,{force=false}={}){
  const source=await readFinancialSafe({force}),inspected=inspectRut(rut),base={sourceReady:source.sourceReady,lastReadAt:source.lastReadAt,sourceModifiedAt:source.sourceModifiedAt||null};
  if(!source.sourceReady)return{...base,matchIssue:'XLSM_NO_DISPONIBLE'};
  if(!inspected.valid)return{...base,matchIssue:'RUT_SOCIO_INVALIDO'};
  if(financialReadCache.duplicateRuts.has(inspected.normalized))return{...base,matchIssue:'RUT_DUPLICADO'};
  const record=financialReadCache.recordsByRut.get(inspected.normalized);if(!record)return{...base,matchIssue:'SIN_COINCIDENCIA_XLSM'};
  return{...base,status:record.status,originalComment:record.originalComment,sourceName:record.sourceName,sourceRow:record.sourceRow,matchIssue:null};
}
function masterAlerts({financial,operational,caps,pushReady}){
  const alerts=[];
  if(!operational.sqlite.ok)alerts.push({severity:'critical',what:'SQLite no supera quick_check',since:null,impact:'Estado operativo de toda Mi ASPCH.'});
  if(!financial.sourceReady)alerts.push({severity:'critical',what:'XLSM Arianna no disponible',since:financial.lastReadAt,impact:'No se puede verificar el estado real de membresía.'});
  else if(financial.status==='WARNING')alerts.push({severity:'warning',what:`XLSM con ${financial.formulaErrors} errores de fórmula`,since:financial.sourceModifiedAt,impact:'Algunos diagnósticos financieros pueden requerir revisión.'});
  const pendingMembershipChanges=Number(financial.dryRun?.summary?.membersWithChanges||0);
  if(pendingMembershipChanges)alerts.push({severity:'warning',what:`${pendingMembershipChanges} estados XLSM difieren de SQLite`,since:financial.lastReadAt,impact:'Mi ASPCH conserva el estado operativo actual hasta que se autorice y audite una sincronización.'});
  if(!caps.sheets?.read)alerts.push({severity:'warning',what:'Google Sheets READ deshabilitado',since:null,impact:'BD SOCIOS y estacionamientos no pueden refrescarse desde Google.'});
  if(!caps.calendar?.read)alerts.push({severity:'warning',what:'Google Calendar READ deshabilitado',since:null,impact:'No hay fuente fiable para ocupación de simuladores.'});
  if(!caps.gmail?.otp)alerts.push({severity:'warning',what:'Entrega OTP deshabilitada',since:null,impact:'No se pueden generar y enviar OTP administrativos.'});
  if(!pushReady)alerts.push({severity:'warning',what:'Push deshabilitado',since:null,impact:'Los avisos push no se entregarán.'});
  if(operational.push.devicesWithError)alerts.push({severity:'warning',what:`${operational.push.devicesWithError} dispositivo(s) Push con error`,since:operational.recentErrors.find(row=>row.source==='PUSH')?.createdAt||null,impact:'Parte de las notificaciones puede no llegar.'});
  if(operational.failedJobs24h)alerts.push({severity:'warning',what:`${operational.failedJobs24h} fallo(s) reciente(s)`,since:operational.recentErrors[0]?.createdAt||null,impact:'Revisar fuentes, sincronizaciones o backups afectados.'});
  if(!operational.backups.some(backup=>backup.status==='OK'))alerts.push({severity:'warning',what:'Sin backup SQLite exitoso registrado',since:null,impact:'No hay una copia reciente confirmada desde la app.'});
  for(const disabled of operational.modules.disabled)alerts.push({severity:'warning',what:`Módulo ${disabled.name} desactivado`,since:null,impact:disabled.message||'Funcionalidad no disponible para socios.'});
  return alerts.slice(0,12);
}
async function adminIntegrationsSnapshot(){
  const caps=googleCapabilities(),financial=await readFinancialSafe(),lastFinancialSync=latestFinancialSync(db);
  const bd=db.prepare("SELECT COUNT(*) records,SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active,MAX(updated_at) last_update FROM members WHERE role!='ADMIN'").get();
  const otp=db.prepare("SELECT SUM(CASE WHEN used_at IS NULL AND expires_at>? THEN 1 ELSE 0 END) pending,MAX(created_at) last_issued FROM otp_codes").get(new Date().toISOString());
  const push=db.prepare("SELECT COUNT(*) subscriptions,SUM(CASE WHEN last_error IS NOT NULL AND TRIM(last_error)<>'' THEN 1 ELSE 0 END) errors,MAX(updated_at) last_update FROM push_subscriptions").get();
  const lastPush=db.prepare("SELECT MAX(COALESCE(sent_at,created_at)) last_delivery FROM notification_deliveries").get();
  const configuredState=enabled=>enabled?'ADVERTENCIA':'DESHABILITADO';
  const xlsmStatus=!financial.sourceReady||financial.status==='ERROR'?'ERROR':financial.status==='WARNING'?'ADVERTENCIA':'OK';
  const items=[
    {id:'xlsm',label:'XLSM Arianna',status:xlsmStatus,summary:financial.sourceReady?`${Number(financial.validRows||0)} RUT válidos de ${Number(financial.rows||0)} filas; lectura diagnóstica.`:(financial.error||'Fuente no disponible.'),lastKnownAt:financial.lastReadAt||lastFinancialSync?.created_at||null,lastKnownLabel:'Última lectura local',affects:'Diagnóstico del estado real de membresía y comparación financiera.',probe:'Lectura local con caché por modificación; sin escrituras.'},
    {id:'bd-socios',label:'BD SOCIOS',status:Number(bd.records||0)>0?'OK':'ADVERTENCIA',summary:`${Number(bd.records||0)} socios en snapshot SQLite; ${Number(bd.active||0)} activos.`,lastKnownAt:bd.last_update||null,lastKnownLabel:'Última actualización local conocida',affects:'Identidad, datos personales, búsqueda de socios y elegibilidad local.',probe:'Snapshot local; no consulta Google en esta carga.'},
    {id:'google-sheets',label:'Google Sheets',status:configuredState(!!caps.sheets?.read||!!caps.sheets?.write),summary:`READ ${caps.sheets?.read?'habilitado':'deshabilitado'} · WRITE ${caps.sheets?.write?'habilitado':'deshabilitado'}.`,lastKnownAt:bd.last_update||null,lastKnownLabel:'Última evidencia local; no prueba conectividad',affects:'Actualización de BD SOCIOS, Directorio y estacionamientos.',probe:'Sin probe de red en esta carga.'},
    {id:'calendar',label:'Google Calendar',status:configuredState(!!caps.calendar?.read||!!caps.calendar?.write),summary:`READ ${caps.calendar?.read?'habilitado':'deshabilitado'} · WRITE ${caps.calendar?.write?'habilitado':'deshabilitado'}.`,lastKnownAt:null,lastKnownLabel:'Sin sync local fiable registrado',affects:'Ocupación y cancelación de turnos de simulador.',probe:'Sin probe de red en esta carga.'},
    {id:'gmail-otp',label:'Gmail OTP',status:configuredState(!!caps.gmail?.otp),summary:caps.gmail?.otp?'Entrega configurada; conectividad no probada en esta carga.':'Entrega de OTP deshabilitada.',lastKnownAt:otp.last_issued||null,lastKnownLabel:'Último OTP registrado localmente',affects:'Primer acceso, verificación de correo y reemisión administrativa de OTP.',probe:'No envía correos ni genera OTP al abrir esta vista.',metrics:{pending:Number(otp.pending||0)}},
    {id:'push',label:'Push',status:pushEnabled()?(Number(push.errors||0)>0?'ADVERTENCIA':'OK'):'DESHABILITADO',summary:pushEnabled()?`${Number(push.subscriptions||0)} suscripciones; ${Number(push.errors||0)} con error.`:'Web Push deshabilitado.',lastKnownAt:lastPush.last_delivery||push.last_update||null,lastKnownLabel:'Última entrega o actualización local',affects:'Recordatorios, avisos y difusión a dispositivos.',probe:'No envía notificaciones al abrir esta vista.'}
  ];
  return{generatedAt:new Date().toISOString(),externalProbePerformed:false,items};
}
function adminSystemSnapshot(){
  const modules=moduleStates(db),operational=adminMasterSnapshot(db,{today:chileClock().date,modules});
  const sqliteFile=path.join(DATA_DIR,'mi-aspch.sqlite'),sqliteSize=fs.existsSync(sqliteFile)?fs.statSync(sqliteFile).size:null;
  return{
    generatedAt:new Date().toISOString(),
    runtime:{version:VERSION,uptimeSeconds:Math.round(process.uptime()),node:process.version},
    sqlite:{...operational.sqlite,sizeBytes:sqliteSize,tables:dbStats(db)},
    backups:operational.backups,
    recentErrors:operational.recentErrors,
    failedJobs:operational.recentErrors.filter(row=>['XLSM_SYNC','BACKUP','PUSH'].includes(row.source)),
    container:{sourceAvailable:false,status:'NO_DISPONIBLE',detail:'La aplicación no dispone de una fuente local segura para consultar el runtime del contenedor.'}
  };
}
function chileLocalIso(dateIso,timeHm){
  const m=String(dateIso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/),t=String(timeHm||'').match(/^(\d{1,2}):(\d{2})$/);if(!m||!t)throw friendlyError(400,'Fecha u hora inválida.');
  const target=Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(t[1]),Number(t[2]),0);
  let guess=target;
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(guess)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const shown=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour)%24,Number(parts.minute),0);guess+=target-shown;
  }
  return new Date(guess).toISOString();
}
function chileClock(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return{year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute),date:`${parts.year}-${parts.month}-${parts.day}`};
}
async function runBackgroundJobs(){
  if(backgroundBusy)return;backgroundBusy=true;
  try{
    const c=chileClock(),now=new Date();
    // Vence publicaciones a 60 días y pide renovación una sola vez.
    const expiring=db.prepare("SELECT id,member_id,title FROM marketplace_listings WHERE status='ACTIVE' AND expires_at IS NOT NULL AND expires_at<=?").all(now.toISOString());
    expireMarketplace(db);
    for(const l of expiring)await sendMemberPush(db,l.member_id,{key:`market-expired:${l.id}`,kind:'marketplace',title:'Mi ASPCH · Mercado',body:`Tu publicación “${l.title}” cumplió 60 días. Entra a Mercado ASPCH si quieres renovarla.`,url:'/?view=marketplace'});

    // Morosidad: días 4 y 20, desde las 10:00; deduplicado por fecha.
    if((c.day===4||c.day===20)&&c.hour>=Number(process.env.DEBT_PUSH_HOUR||10)){
      const rows=db.prepare("SELECT m.id,f.months_due,f.amount_due FROM member_financial_status f JOIN members m ON m.id=f.member_id WHERE f.financial_status='MOROSO' AND m.active=1").all();
      for(const r of rows){const msg=dueNotificationText(r);await sendMemberPush(db,r.id,{key:`membership:${c.date}:${r.id}`,kind:'membership',...msg,url:'/?view=profile'})}
    }

    // Estacionamiento: recordatorio el día anterior a las 20:00.
    if(c.hour===20){const tomorrow=addDays(c.date,1);const rs=db.prepare("SELECT r.id,r.member_id,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.reservation_date=? AND r.status='ACTIVE'").all(tomorrow);for(const r of rs)await sendMemberPush(db,r.member_id,{key:`parking-eve:${r.id}:${tomorrow}`,kind:'parking',title:'Mi ASPCH · Estacionamiento',body:`Mañana tienes reservado el estacionamiento ${r.label} en Padre Mariano ${r.building}.`,url:'/?view=parking'})}

    // Estacionamiento: cada 4 horas desde el check-in, mientras siga ACTIVE.
    const active=db.prepare("SELECT r.id,r.member_id,r.checked_in_at,p.label FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.status='ACTIVE' AND r.checked_in_at IS NOT NULL").all();
    for(const r of active){const elapsed=now-new Date(r.checked_in_at),idx=Math.floor(elapsed/(4*3600_000));if(idx>=1&&moduleEnabled(db,'parking'))await sendMemberPush(db,r.member_id,{key:`parking-active:${r.id}:${idx}`,kind:'parking',title:`Estacionamiento ${r.label}`,body:'Recuerda liberar tu estacionamiento cuando termines de utilizarlo.',url:'/?view=parking',actions:[{action:'vacate-parking',title:'Liberar cupo'}]})}

    // Simulador: recordatorio el día anterior a las 19:00, leyendo Calendar real.
    if(c.hour===19&&calendarReadEnabled())await pushTomorrowSimulatorReminders(c.date);

    // Cursos/charlas marcados como inscritos: recordatorio el día anterior a las 18:00.
    if(c.hour===18&&moduleEnabled(db,'activities')){
      const tomorrow=addDays(c.date,1);const rows=db.prepare(`SELECT a.id,a.title,a.starts_at,r.member_id FROM activity_registrations r JOIN activities a ON a.id=r.activity_id WHERE r.status='REGISTERED' AND a.status!='REMOVED' AND substr(a.starts_at,1,10)=?`).all(tomorrow);
      for(const r of rows)await sendMemberPush(db,r.member_id,{key:`activity-eve:${r.id}:${r.member_id}:${tomorrow}`,kind:'activities',title:'Mi ASPCH · Actividad',body:`Mañana: ${r.title}. Revisa los detalles en Mi ASPCH.`,url:'/?view=activities'});
    }

    // Votaciones programadas: al abrir se congela el padrón; al cerrar no se aceptan más votos.
    if(moduleEnabled(db,'votes')){
      const dueDrafts=db.prepare(`SELECT id FROM vote_elections WHERE status='DRAFT' AND opens_at IS NOT NULL AND opens_at<=? ORDER BY id`).all(now.toISOString());
      for(const v of dueDrafts){try{setVoteStatus(db,{id:v.id,status:'OPEN'});await broadcastVoteOpen(v.id)}catch(err){console.error(`[Mi ASPCH] Apertura votación ${v.id}:`,err.message)}}
      const unannounced=db.prepare(`SELECT v.id FROM vote_elections v WHERE v.status='OPEN' AND (v.opens_at IS NULL OR v.opens_at<=?) AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type='vote' AND a.entity_id=CAST(v.id AS TEXT) AND a.action='VOTE_OPEN_PUSH_SENT') ORDER BY v.id`).all(now.toISOString());
      for(const v of unannounced)await broadcastVoteOpen(v.id);
      const dueClose=db.prepare(`SELECT id FROM vote_elections WHERE status='OPEN' AND closes_at IS NOT NULL AND closes_at<=? ORDER BY id`).all(now.toISOString());
      for(const v of dueClose){try{setVoteStatus(db,{id:v.id,status:'CLOSED'})}catch(err){console.error(`[Mi ASPCH] Cierre votación ${v.id}:`,err.message)}}
    }

    // Backup diario consistente de SQLite, una vez por día.
    if(c.hour===config.dailyBackupHour&&c.minute>=config.dailyBackupMinute&&lastDailyBackupDate!==c.date){const r=createBackup(db,{backupDir:BACKUP_DIR,retention:config.backupRetention});if(r.ok)lastDailyBackupDate=c.date;}

  }catch(err){console.error('[Mi ASPCH] Jobs:',err.message)}finally{backgroundBusy=false}
}
async function pushTomorrowSimulatorReminders(today){
  const tomorrow=addDays(today,1);
  // Construir los límites desde America/Santiago evita hardcodear -03/-04 y
  // mantiene correcto el recordatorio incluso durante cambios de horario legal.
  const events=await listCalendarEvents({calendarId:config.calendarId,timeMin:chileLocalIso(tomorrow,'00:00'),timeMax:chileLocalIso(addDays(tomorrow,1),'00:00')});
  for(const ev of events){const sim=matchSimulator(ev.summary||'');if(!sim||ev.status==='cancelled')continue;const start=ev.start?.dateTime||ev.start?.date;if(!start)continue;for(const a of (ev.attendees||[])){const email=normalizeEmail(a.email);if(!email)continue;const m=db.prepare('SELECT id FROM members WHERE email=? AND active=1').get(email);if(!m)continue;await sendMemberPush(db,m.id,{key:`sim-eve:${ev.id}:${m.id}`,kind:'simulators',title:`Mi ASPCH · ${sim.label}`,body:`Mañana tienes un turno a las ${new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(start))}.`,url:'/?view=simulators'})}}
}

async function broadcastTopic(kind,{keyBase,title,body,url}){
  const ids=db.prepare('SELECT DISTINCT member_id FROM push_subscriptions ORDER BY member_id').all().map(x=>Number(x.member_id)).filter(Boolean);let sent=0,recipients=0;
  for(let i=0;i<ids.length;i+=20){const batch=ids.slice(i,i+20);const results=await Promise.allSettled(batch.map(id=>sendMemberPush(db,id,{key:`${keyBase}:${id}`,kind,title,body,url})));for(const r of results){recipients++;if(r.status==='fulfilled')sent+=Number(r.value?.sent||0)}}
  return{recipients,sent};
}

async function broadcastVoteOpen(electionId){
  const vote=db.prepare(`SELECT id,title,status,opens_at FROM vote_elections WHERE id=?`).get(Number(electionId));if(!vote||vote.status!=='OPEN')return{recipients:0,sent:0};
  const already=db.prepare(`SELECT 1 FROM audit_log WHERE entity_type='vote' AND entity_id=? AND action='VOTE_OPEN_PUSH_SENT' LIMIT 1`).get(String(vote.id));if(already)return{recipients:0,sent:0,deduped:true};
  const ids=db.prepare(`SELECT e.member_id FROM vote_eligibility e JOIN members m ON m.id=e.member_id WHERE e.election_id=? AND m.active=1 ORDER BY e.member_id`).all(vote.id).map(x=>Number(x.member_id)).filter(Boolean);let sent=0,recipients=0;
  for(let i=0;i<ids.length;i+=20){const batch=ids.slice(i,i+20);const results=await Promise.allSettled(batch.map(id=>sendMemberPush(db,id,{key:`vote-open:${vote.id}:${id}`,kind:'votes',title:'Mi ASPCH · Votación disponible',body:String(vote.title||'Nueva votación ASPCH').slice(0,220),url:'/?view=votes'})));for(const r of results){recipients++;if(r.status==='fulfilled')sent+=Number(r.value?.sent||0)}}
  audit(db,{action:'VOTE_OPEN_PUSH_SENT',entityType:'vote',entityId:vote.id,details:{recipients,sent}});return{recipients,sent};
}

function moduleForApiPath(p){
  const map=[['/api/parking','parking'],['/api/simulators','simulators'],['/api/study-room','studyroom'],['/api/marketplace','marketplace'],['/api/activities','activities'],['/api/agreements','agreements'],['/api/library','library'],['/api/news','news'],['/api/votes','votes'],['/api/push','push']];
  return map.find(([prefix])=>p===prefix||p.startsWith(prefix+'/'))?.[1]||null;
}

async function notifyStudyWaitlistReleased(reservation){
  const rows=matchingStudyWaitlist(db,{roomId:reservation.room_id,start:reservation.start_at,end:reservation.end_at});
  for(const w of rows){
    const r=await sendMemberPush(db,w.member_id,{key:`study-release:${reservation.id}:${w.id}`,kind:'studyroom',title:'Mi ASPCH · Sala de estudios',body:'Se liberó un horario que coincide con tu espera. Entra a Mi ASPCH para reservarlo si todavía está disponible.',url:'/?view=studyroom'});
    if(r.sent>0)markStudyWaitlistNotified(db,w.id);
  }
}

async function unifiedReservations(member,{scope='upcoming'}={}){
  const now=new Date(),today=todayChile();const items=[];
  const parking=db.prepare(`SELECT r.*,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.member_id=? ORDER BY r.reservation_date DESC LIMIT 500`).all(member.id);
  for(const r of parking){
    const start=chileLocalIso(r.reservation_date,'00:00'),end=chileLocalIso(addDays(r.reservation_date,1),'00:00');
    const phase=r.status==='ACTIVE'?(r.reservation_date>=today?'UPCOMING':'FINISHED'):r.status;
    items.push({type:'parking',id:String(r.id),date:r.reservation_date,title:`Estacionamiento ${r.label} · Padre Mariano ${r.building}`,start,end,status:r.status,phase,canCancel:r.status==='ACTIVE'&&r.reservation_date>=today,canVacate:r.status==='ACTIVE'&&!!r.checked_in_at,icsUrl:`/api/reservations/ics?type=parking&id=${r.id}`});
  }
  const study=db.prepare(`SELECT r.*,rm.name room_name FROM study_room_reservations r JOIN study_rooms rm ON rm.id=r.room_id WHERE r.member_id=? ORDER BY r.start_at DESC LIMIT 500`).all(member.id);
  for(const r of study){const endMs=new Date(r.end_at).getTime();const phase=r.status==='ACTIVE'?(endMs>=Date.now()?'UPCOMING':'FINISHED'):r.status;items.push({type:'studyroom',id:String(r.id),title:r.room_name||'Sala de estudios',start:r.start_at,end:r.end_at,status:r.status,phase,canCancel:r.status==='ACTIVE'&&endMs>=Date.now(),icsUrl:`/api/reservations/ics?type=studyroom&id=${r.id}`})}
  if(calendarReadEnabled()){
    try{
      const from=scope==='history'?addDays(today,-180):scope==='all'?addDays(today,-180):today;const to=scope==='history'?today:addDays(today,365);
      const events=await listCalendarEvents({calendarId:config.calendarId,timeMin:chileLocalIso(from,'00:00'),timeMax:chileLocalIso(addDays(to,1),'00:00')});
      for(const ev of events){if(ev.status==='cancelled'||ev.transparency==='transparent')continue;const sim=matchSimulator(ev.summary||'');if(!sim)continue;const mine=Array.isArray(ev.attendees)&&ev.attendees.some(a=>normalizeEmail(a.email)===normalizeEmail(member.email));if(!mine)continue;const start=ev.start?.dateTime||ev.start?.date,end=ev.end?.dateTime||ev.end?.date;if(!start||!end)continue;const ref=calendarEventRef(ev.id);items.push({type:'simulator',id:ref,date:String(start).slice(0,10),title:sim.label,start,end,status:'CONFIRMED',phase:new Date(end).getTime()>=Date.now()?'UPCOMING':'FINISHED',canCancel:new Date(end).getTime()>=Date.now()&&config.simulatorCancelEnabled&&calendarWriteEnabled(),icsUrl:`/api/reservations/ics?type=simulator&id=${encodeURIComponent(ref)}&date=${encodeURIComponent(String(start).slice(0,10))}`})}
    }catch(err){console.error('[Mi ASPCH] Mis reservas Calendar:',err.message)}
  }
  const cancels=db.prepare(`SELECT * FROM simulator_cancellations WHERE member_id=? ORDER BY created_at DESC LIMIT 300`).all(member.id);for(const c of cancels)items.push({type:'simulator',id:`cancel-${c.id}`,title:config.simulators.find(x=>x.id===c.simulator_id)?.label||c.simulator_id,start:c.start_at,end:c.start_at,status:'CANCELLED',phase:'CANCELLED',canCancel:false,icsUrl:null});
  const filtered=items.filter(x=>scope==='all'||(scope==='history'?(x.phase!=='UPCOMING'):(x.phase==='UPCOMING'))).sort((a,b)=>scope==='history'?String(b.start).localeCompare(String(a.start)):String(a.start).localeCompare(String(b.start)));
  return{scope,items:filtered,counts:{upcoming:items.filter(x=>x.phase==='UPCOMING').length,history:items.filter(x=>x.phase!=='UPCOMING').length}};
}

async function reservationForIcs(member,{type,id,date}){
  if(type==='parking'){
    const r=db.prepare(`SELECT r.*,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.id=? AND r.member_id=?`).get(Number(id),member.id);if(!r)return null;
    return{uid:`parking-${r.id}-${member.id}`,title:`Estacionamiento ${r.label} · ASPCH`,start:chileLocalIso(r.reservation_date,'00:00'),end:chileLocalIso(addDays(r.reservation_date,1),'00:00'),description:'Reserva de estacionamiento Mi ASPCH.',location:`Padre Mariano ${r.building}`,url:config.conveniosUrl.replace('/convenios/','/')};
  }
  if(type==='studyroom'){
    const r=db.prepare(`SELECT r.*,rm.name room_name FROM study_room_reservations r JOIN study_rooms rm ON rm.id=r.room_id WHERE r.id=? AND r.member_id=?`).get(Number(id),member.id);if(!r)return null;
    return{uid:`study-${r.id}-${member.id}`,title:r.room_name||'Sala de estudios ASPCH',start:r.start_at,end:r.end_at,description:'Reserva de Sala de estudios · Mi ASPCH.',location:'ASPCH'};
  }
  if(type==='simulator'&&date){
    const ev=await findMemberCalendarEventByRef(member,id,date);if(!ev)return null;return{uid:`sim-${id}-${member.id}`,title:`${ev.simulator} · Mi ASPCH`,start:ev.start,end:ev.end,description:'Turno confirmado de simulador ASPCH.'};
  }
  return null;
}
async function findMemberCalendarEventByRef(member,eventRef,date){
  if(!calendarReadEnabled()||!validDate(date))return null;const events=await listCalendarEvents({calendarId:config.calendarId,timeMin:chileLocalIso(date,'00:00'),timeMax:chileLocalIso(addDays(date,1),'00:00')});
  for(const ev of events){if(!ev?.id||calendarEventRef(ev.id)!==eventRef||ev.status==='cancelled')continue;const sim=matchSimulator(ev.summary||'');if(!sim)continue;const mine=Array.isArray(ev.attendees)&&ev.attendees.some(a=>normalizeEmail(a.email)===normalizeEmail(member.email));if(!mine)continue;const start=ev.start?.dateTime||ev.start?.date,end=ev.end?.dateTime||ev.end?.date;if(start&&end)return{simulator:sim.label,start,end}}
  return null;
}

let lastDailyBackupDate='';
function startV060Schedulers(){
  const syncMs=config.financialSyncMinutes*60_000;setInterval(()=>readFinancialSafe().catch(()=>{}),syncMs).unref?.();
  setInterval(()=>runBackgroundJobs().catch(()=>{}),60_000).unref?.();setTimeout(()=>runBackgroundJobs().catch(()=>{}),8_000).unref?.();
}

async function syncGoogleStartup() {
  const members = await syncMembersFromGoogle();
  const board = await syncBoardFromGoogle();
  const parking = await syncParkingSpacesFromGoogle();
  let parkingReservations='desactivado';
  if (config.parkingSync) {
    await ensureParkingReservationsSheet();
    await migrateExistingParkingReservationsToGoogle();
    const live=await syncParkingDateFromGoogle(todayChile(), { force:true });
    parkingReservations=`${live.size} ocupados hoy`;
  }
  console.log(`[Mi ASPCH] Sync Google: ${members} socios · ${board} Directorio · ${parking} estacionamientos · ${parkingReservations}`);
}

function findMemberByRut(rut) {
  rut = normalizeRut(rut);
  if (!rut) return null;
  return db.prepare("SELECT * FROM members WHERE REPLACE(REPLACE(UPPER(COALESCE(rut,'')),'.',''),' ','')=?").get(rut) || null;
}

function maskEmail(email) {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!local || !domain) return 'correo registrado';
  const shown = local.length <= 2 ? local[0] + '*' : local.slice(0,2) + '*'.repeat(Math.min(5, local.length-2));
  return `${shown}@${domain}`;
}

function columnLetter(n) {
  let out='';
  while (n > 0) { n--; out=String.fromCharCode(65 + (n % 26)) + out; n=Math.floor(n/26); }
  return out;
}

async function updateMemberFieldsInGoogle(rut, { employer, phone }) {
  const range = `'${config.membersTab.replace(/'/g, "''")}'!A1:L2000`;
  const data = await sheetsGet(config.membersSheetId, range);
  const rows = data.values || [];
  if (!rows.length) throw friendlyError(502, 'BD SOCIOS no respondió al actualizar los datos.');
  const headers = rows[0].map(v => String(v || '').trim().toUpperCase().replace(/\s+/g,' '));
  const rutIdx = headers.findIndex(h => h === 'RUT');
  const phoneIdx = headers.findIndex(h => ['CELULAR','TELÉFONO','TELEFONO'].includes(h));
  const employerIdx = headers.findIndex(h => ['EMPLEADOR','AEROLÍNEA','AEROLINEA'].includes(h));
  if (rutIdx < 0 || phoneIdx < 0 || employerIdx < 0) throw friendlyError(502, 'No encontré RUT, CELULAR o EMPLEADOR en BD SOCIOS.');
  const target = normalizeRut(rut);
  const rowIndex = rows.findIndex((r,i) => i>0 && normalizeRut(r[rutIdx]) === target);
  if (rowIndex < 0) throw friendlyError(404, 'No encontré el RUT en BD SOCIOS.');
  const rowNumber = rowIndex + 1;
  await sheetsUpdate(config.membersSheetId, `'${config.membersTab.replace(/'/g, "''")}'!${columnLetter(phoneIdx+1)}${rowNumber}`, [[phone]]);
  await sheetsUpdate(config.membersSheetId, `'${config.membersTab.replace(/'/g, "''")}'!${columnLetter(employerIdx+1)}${rowNumber}`, [[employer]]);
  return { row:rowNumber };
}

async function updateMemberEmailInGoogle(rut, newEmail) {
  const range = `'${config.membersTab.replace(/'/g, "''")}'!A1:L2000`;
  const data = await sheetsGet(config.membersSheetId, range);
  const rows = data.values || [];
  if (!rows.length) throw friendlyError(502, 'BD SOCIOS no respondió al intentar actualizar el correo.');
  const headers = rows[0].map(v => String(v || '').trim().toUpperCase().replace(/\s+/g,' '));
  const rutIdx = headers.findIndex(h => h === 'RUT');
  const emailIdx = headers.findIndex(h => ['E-MAIL','EMAIL','CORREO','CORREO ELECTRÓNICO','CORREO ELECTRONICO'].includes(h));
  if (rutIdx < 0 || emailIdx < 0) throw friendlyError(502, 'No encontré las columnas RUT/E-MAIL en BD SOCIOS.');
  const target = normalizeRut(rut);
  const rowIndex = rows.findIndex((r,i) => i>0 && normalizeRut(r[rutIdx]) === target);
  if (rowIndex < 0) throw friendlyError(404, 'No encontré el RUT en BD SOCIOS para actualizar el correo.');
  const a1 = `'${config.membersTab.replace(/'/g, "''")}'!${columnLetter(emailIdx+1)}${rowIndex+1}`;
  await sheetsUpdate(config.membersSheetId, a1, [[newEmail]]);
  return { row:rowIndex+1, range:a1 };
}

function setSessionCookie(req, res, token) {
  const secure = isSecureRequest(req);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30*24*3600}${secure ? '; Secure' : ''}`);
}

function isPreviewSyntheticMember(member) {
  return PREVIEW_MODE && String(member?.email || '').toLowerCase().endsWith('@preview.invalid');
}

function requestMember(req) {
  return memberFromRequest(db, req, { allowInactive:member => isPreviewSyntheticMember(member) });
}

function previewProfile(value) {
  const key=String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
  return PREVIEW_PROFILES.find(profile => profile.key === key) || null;
}

function upsertPreviewMember(profile) {
  const safeSynthetic=String(profile?.email||'').endsWith('@preview.invalid')||(profile?.role==='ADMIN'&&normalizeEmail(profile.email)===config.adminEmail);
  if (!PREVIEW_MODE || !profile || !safeSynthetic) throw friendlyError(403,'Impersonación Preview no disponible.');
  const stamp=new Date().toISOString();
  const pinSalt=crypto.randomBytes(16).toString('base64url');
  const pinHash=crypto.scryptSync(crypto.randomBytes(24).toString('base64url'),pinSalt,32).toString('base64url');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO members(email,name,preferred_name,rut,birth_date,phone,employer,category,position,role,active,is_board,pin_salt,pin_hash,pin_updated_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET name=excluded.name,preferred_name=excluded.preferred_name,rut=excluded.rut,birth_date=excluded.birth_date,
      phone=excluded.phone,employer=excluded.employer,category=excluded.category,position=excluded.position,role=excluded.role,active=excluded.active,
      is_board=excluded.is_board,pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,pin_updated_at=excluded.pin_updated_at,updated_at=excluded.updated_at`)
      .run(profile.email,profile.name,profile.preferredName,profile.rut,profile.birthDate,profile.phone,profile.employer,profile.category,profile.position,profile.role,profile.active?1:0,profile.isBoard?1:0,pinSalt,pinHash,stamp,stamp);
    const member=db.prepare('SELECT * FROM members WHERE email=?').get(profile.email);
    db.prepare(`INSERT INTO member_financial_status(member_id,rut,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at,deactivated_by_financial,amount_evidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET rut=excluded.rut,source_status=excluded.source_status,
      financial_status=excluded.financial_status,months_due=excluded.months_due,amount_due=excluded.amount_due,source_year=excluded.source_year,
      source_updated_at=excluded.source_updated_at,synced_at=excluded.synced_at,deactivated_by_financial=excluded.deactivated_by_financial,amount_evidence=excluded.amount_evidence`)
      .run(member.id,profile.rut,'PREVIEW_SYNTHETIC',profile.financialStatus,profile.monthsDue,profile.amountDue,Number(stamp.slice(0,4)),stamp,stamp,profile.financialStatus==='DESAFILIADO'?1:0,profile.amountEvidence||'COMPLETE');
    db.prepare('DELETE FROM membership_payments WHERE member_id=?').run(member.id);
    if (profile.paid) {
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit'}).formatToParts(new Date());
      const year=Number(parts.find(part=>part.type==='year').value),month=Number(parts.find(part=>part.type==='month').value);
      db.prepare(`INSERT INTO membership_payments(member_id,membership_year,membership_month,amount_clp,provider,provider_order,status,paid_at,created_at)
        VALUES (?,?,?,?,?,?, 'PAID',?,?)`).run(member.id,year,month,0,'PREVIEW',profile.key,stamp,stamp);
    }
    db.prepare('DELETE FROM passkeys WHERE member_id=?').run(member.id);
    setMemberUiPreferences(db,{memberId:member.id,services:{parking:true,reservations:true,simulators:true,studyroom:true,library:true,agreements:true,news:true,agenda:true},simpleMode:profile.simpleMode});
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM members WHERE id=?').get(member.id);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function friendlyError(statusCode, message) {
  const e = new Error(message); e.statusCode=statusCode; e.expose=true; return e;
}

async function syncMembersFromGoogle() {
  const range = `'${config.membersTab.replace(/'/g, "''")}'!A1:L2000`;
  const data = await sheetsGet(config.membersSheetId, range);
  const rows = data.values || [];
  if (!rows.length) return 0;
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const email = normalizeEmail(r[4]);
    if (!email || !email.includes('@')) continue;
    const activeRaw = String(r[10] ?? '').trim().toLowerCase();
    const active = !['falso','false','0','no'].includes(activeRaw);
    if (upsertMember(db, { name:r[1],rut:r[2],birthDate:r[3],email,phone:r[5],employer:r[6],category:r[7],bp:r[8],joinedAt:r[9],active,position:r[11] })) count++;
  }
  return count;
}

async function syncBoardFromGoogle() {
  const range = `'${config.boardTab.replace(/'/g, "''")}'!B5:L1200`;
  const data = await sheetsGet(config.boardSheetId, range);
  const rows = data.values || [];
  if (!rows.length) return 0;
  const headers = rows[0].map(v => String(v || '').trim().toUpperCase());
  const rutIdx = headers.findIndex(h => h === 'RUT');
  const commentIdx = headers.findIndex(h => h === 'COMENTARIO');
  if (rutIdx < 0 || commentIdx < 0) throw new Error('No encontré RUT/COMENTARIO en la base de Directorio.');
  const ruts = rows.slice(1).filter(r => /DIRECTORIO/i.test(String(r[commentIdx] || ''))).map(r => r[rutIdx]);
  return setBoardMembersByRut(db, ruts);
}

async function syncParkingSpacesFromGoogle() {
  const range = `'${config.parkingTab.replace(/'/g, "''")}'!B1:C50`;
  const data = await sheetsGet(config.parkingSheetId, range);
  const rows = data.values || [];
  const spaces = [];
  let building = '';
  for (const r of rows) {
    const b = String(r[0] || '').trim(); const label = String(r[1] || '').trim();
    if (/^(87|103)$/.test(b)) building = b;
    if (!label || /^est$/i.test(label) || !['87','103'].includes(building)) continue;
    spaces.push({ label, building, boardOnly: building === '103' });
  }
  return upsertParkingSpaces(db, spaces);
}

async function safeParkingLog(action, date, spot, member) {
  if (!config.parkingSync || !sheetsWriteEnabled()) return;
  try {
    await ensureSheet(config.parkingSheetId, config.parkingLogTab);
    await sheetsAppend(config.parkingSheetId, `'${config.parkingLogTab}'!A:G`, [[new Date().toISOString(), action, date, spot.building || '', spot.label, member.email, member.name]]);
  } catch (e) { console.error('Parking sheet sync:', e.message); }
}

const PARKING_LEDGER_HEADERS = ['FECHA','EDIFICIO','ESTACIONAMIENTO','RUT','NOMBRE','EMAIL','ORIGEN','ESTADO','ACTUALIZADO_EN','VALIDACION'];

function parkingTabRange(tab, range) {
  return `'${String(tab || '').replace(/'/g, "''")}'!${range}`;
}
function normalizePersonName(value='') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function memberByEmail(email='') {
  email = normalizeEmail(email);
  return email ? (db.prepare('SELECT * FROM members WHERE email=? AND active=1').get(email) || null) : null;
}
function memberFromParkingIdentity({ rut='', email='', name='', validation='' }={}) {
  const candidates = [rut, ...String(validation || '').split('|')];
  for (const raw of candidates) {
    const normalized = normalizeRut(raw);
    if (normalized && isValidRut(normalized)) {
      const found = findMemberByRut(normalized);
      if (found?.active) return found;
    }
  }
  const byEmail = memberByEmail(email);
  if (byEmail) return byEmail;
  const target = normalizePersonName(name);
  if (!target) return null;
  const exact = db.prepare('SELECT * FROM members WHERE active=1').all().filter(m => normalizePersonName(m.name) === target || normalizePersonName(m.preferred_name) === target);
  if (exact.length === 1) return exact[0];
  const tokens = target.split(' ').filter(t => t.length > 1);
  if (tokens.length < 2) return null;
  const fuzzy = db.prepare('SELECT * FROM members WHERE active=1').all().filter(m => {
    const memberTokens = new Set(normalizePersonName(m.name).split(' ').filter(Boolean));
    return tokens.every(t => memberTokens.has(t));
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}
function formatRutForSheet(value='') {
  const normalized = normalizeRut(value);
  if (!normalized) return '';
  const [body,dv] = normalized.split('-');
  const dotted = body.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  return `${dotted}-${dv}`;
}
function parkingValidationForMember(member) {
  if (!member) return '';
  const board = member.is_board ? ' (Directorio)' : '';
  return `✅ Socio${board}  |  ${formatRutForSheet(member.rut)}  |  ${member.name}`;
}
function parkingSpaceByBuildingLabel(building, label) {
  return db.prepare('SELECT * FROM parking_spaces WHERE active=1 AND building=? AND label=?').get(String(building || '').trim(), String(label || '').trim()) || null;
}
function parkingProjectionSetting(date) { return `parking_projection_${date}`; }
function getSetting(key) { return db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value || null; }
function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, String(value), new Date().toISOString());
}

async function ensureParkingReservationsSheet() {
  if (parkingLedgerReady) return;
  await ensureSheet(config.parkingSheetId, config.parkingReservationsTab);
  const range = parkingTabRange(config.parkingReservationsTab, 'A1:J2');
  const data = await sheetsGet(config.parkingSheetId, range);
  const first = (data.values?.[0] || []).map(v => String(v || '').trim().toUpperCase());
  if (first.join('|') !== PARKING_LEDGER_HEADERS.join('|')) {
    await sheetsUpdate(config.parkingSheetId, parkingTabRange(config.parkingReservationsTab, 'A1:J1'), [PARKING_LEDGER_HEADERS]);
  }
  parkingLedgerReady = true;
}

async function readParkingLedgerRows(date=null, { includeInactive=false }={}) {
  await ensureParkingReservationsSheet();
  const data = await sheetsGet(config.parkingSheetId, parkingTabRange(config.parkingReservationsTab, 'A2:J20000'));
  const out=[];
  (data.values || []).forEach((r, index) => {
    const rowDate = validDate(r[0]);
    if (!rowDate || (date && rowDate !== date)) return;
    const building = String(r[1] || '').trim();
    const label = String(r[2] || '').trim();
    const space = parkingSpaceByBuildingLabel(building, label);
    if (!space) return;
    const status = String(r[7] || 'ACTIVO').trim().toUpperCase() || 'ACTIVO';
    const active = !['CANCELADO','CANCELLED','DESOCUPADO','VACATED','ANULADO'].includes(status);
    if (!includeInactive && !active) return;
    const member = memberFromParkingIdentity({ rut:r[3], name:r[4], email:r[5], validation:r[9] });
    out.push({
      rowNumber:index+2,date:rowDate,building,label,spaceId:space.id,rut:String(r[3]||'').trim(),name:String(r[4]||'').trim(),email:normalizeEmail(r[5]||''),
      origin:String(r[6]||'').trim(),status,active,updatedAt:String(r[8]||'').trim(),validation:String(r[9]||'').trim(),memberId:member?.id||null,member
    });
  });
  return out;
}

async function getAdminLiveParking(date) {
  if (!sheetsReadEnabled()) {
    return {
      live: false,
      source: 'SQLITE_SNAPSHOT_FALLBACK',
      sourceLabel: 'SQLite local (snapshot)',
      warning: 'Lectura de Google Sheets no habilitada.'
    };
  }
  try {
    const rawData = await sheetsGet(config.parkingSheetId, parkingTabRange(config.parkingReservationsTab, 'A2:J20000'));
    const rawSpaces = db.prepare("SELECT id, label, building, board_only AS boardOnly, sort_order AS sortOrder FROM parking_spaces WHERE active=1 ORDER BY CAST(building AS INTEGER), sort_order, label").all();
    const liveToday = [];
    const liveActive = [];
    (rawData.values || []).forEach(r => {
      const rowDate = validDate(r[0]);
      if (!rowDate) return;
      const building = String(r[1] || '').trim();
      const label = String(r[2] || '').trim();
      const space = rawSpaces.find(s => s.building === building && s.label === label);
      if (!space) return;
      const status = String(r[7] || 'ACTIVO').trim().toUpperCase() || 'ACTIVO';
      const active = !['CANCELADO','CANCELLED','DESOCUPADO','VACATED','ANULADO'].includes(status);
      if (!active) return;
      const member = memberFromParkingIdentity({ rut: r[3], name: r[4], email: r[5], validation: r[9] });
      const item = {
        spaceId: space.id,
        spaceLabel: space.label,
        building: space.building,
        reservationDate: rowDate,
        memberName: member?.name || String(r[4] || '').trim() || 'Reserva Google Sheets',
        memberEmail: member?.email || normalizeEmail(r[5] || ''),
        memberRut: member?.rut || String(r[3] || '').trim(),
        memberId: member?.id || null,
        origin: String(r[6] || '').trim(),
        status,
        createdAt: String(r[8] || '').trim()
      };
      if (rowDate >= date) liveActive.push(item);
      if (rowDate === date) liveToday.push(item);
    });

    const spaces = rawSpaces.map(s => {
      const res = liveToday.find(r => String(r.spaceId) === String(s.id)) || null;
      return {
        id: s.id,
        label: s.label,
        building: s.building,
        boardOnly: !!s.boardOnly,
        occupied: !!res,
        reservation: res ? {
          memberName: res.memberName,
          memberEmail: res.memberEmail,
          memberId: res.memberId,
          createdAt: res.createdAt,
          reservationDate: res.reservationDate,
          origin: res.origin
        } : null
      };
    });

    return {
      live: true,
      source: 'GOOGLE_SHEETS_LIVE',
      sourceLabel: `Google Sheets (${config.parkingReservationsTab})`,
      readAt: new Date().toISOString(),
      spaces,
      today: liveToday,
      active: liveActive
    };
  } catch (err) {
    console.error('[Mi ASPCH] getAdminLiveParking error:', err.message);
    return {
      live: false,
      source: 'SQLITE_SNAPSHOT_FALLBACK',
      sourceLabel: 'SQLite local (snapshot de respaldo)',
      warning: `Sin conexión con Google Sheets (${err.message})`
    };
  }
}

async function writeParkingLedger({ date, space, member=null, name='', validation='', origin='MI_ASPCH', status='ACTIVO' }) {
  await ensureParkingReservationsSheet();
  const all = await readParkingLedgerRows(date, { includeInactive:true });
  const same = all.filter(r => r.spaceId === space.id).sort((a,b)=>b.rowNumber-a.rowNumber)[0] || null;
  const resolvedName = member?.name || String(name || '').trim();
  const resolvedValidation = validation || parkingValidationForMember(member);
  const values = [[
    date, space.building, space.label, member ? formatRutForSheet(member.rut) : '', resolvedName, member?.email || '', origin, status,
    new Date().toISOString(), resolvedValidation
  ]];
  if (same) await sheetsUpdate(config.parkingSheetId, parkingTabRange(config.parkingReservationsTab, `A${same.rowNumber}:J${same.rowNumber}`), values);
  else await sheetsAppend(config.parkingSheetId, parkingTabRange(config.parkingReservationsTab, 'A:J'), values);
  parkingSyncCache.delete(date);
}

async function setParkingReservationGoogleStatus(date, spot, member, status) {
  const space = parkingSpaceByBuildingLabel(spot.building, spot.label) || db.prepare('SELECT * FROM parking_spaces WHERE id=?').get(spot.space_id || spot.id);
  if (!space) return;
  await writeParkingLedger({ date, space, member, origin:'MI_ASPCH', status });
}

async function readVisibleParkingToday() {
  const data = await sheetsGet(config.parkingSheetId, parkingTabRange(config.parkingTab, 'B2:E50'));
  const out = new Map();
  let building='';
  (data.values || []).forEach((r,index) => {
    const maybeBuilding = String(r[0] || '').trim();
    if (['87','103'].includes(maybeBuilding)) building=maybeBuilding;
    const label=String(r[1] || '').trim();
    const space=parkingSpaceByBuildingLabel(building,label);
    if (!space) return;
    const name=String(r[2] || '').trim();
    const validation=String(r[3] || '').trim();
    if (!name && !validation) return;
    const member=memberFromParkingIdentity({ name, validation });
    out.set(space.id,{ rowNumber:index+2,spaceId:space.id,label:space.label,building:space.building,name:name || member?.name || 'Reserva manual',validation,memberId:member?.id||null,member,source:'ESTACIONAMIENTO' });
  });
  return out;
}

async function visibleParkingRowsMap() {
  const data = await sheetsGet(config.parkingSheetId, parkingTabRange(config.parkingTab, 'B2:C50'));
  const out = new Map();
  let building='';
  (data.values || []).forEach((r,index) => {
    const maybeBuilding=String(r[0]||'').trim();
    if (['87','103'].includes(maybeBuilding)) building=maybeBuilding;
    const label=String(r[1]||'').trim();
    const space=parkingSpaceByBuildingLabel(building,label);
    if (space) out.set(space.id,{ rowNumber:index+2,space });
  });
  return out;
}

async function writeVisibleParking(space, member=null, name='', validation='') {
  const rows=await visibleParkingRowsMap();
  const target=rows.get(space.id);
  if (!target) throw new Error(`No encontré el estacionamiento ${space.label} en la pestaña ${config.parkingTab}.`);
  const displayName=member ? memberDisplayNameForParking(member) : String(name || '').trim();
  const displayValidation=validation || parkingValidationForMember(member);
  await sheetsUpdate(config.parkingSheetId, parkingTabRange(config.parkingTab, `D${target.rowNumber}:E${target.rowNumber}`), [[displayName,displayValidation]]);
}
function memberDisplayNameForParking(member) {
  const p=String(member?.preferred_name || '').trim();
  if (p) {
    const surname=String(member?.name || '').trim().split(/\s+/)[0] || '';
    return `${p} ${titleCaseWord(surname)}`.trim();
  }
  const words=String(member?.name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return member?.email || 'Socio ASPCH';
  return words.slice(0,2).map(titleCaseWord).join(' ');
}
function titleCaseWord(v=''){const s=String(v||'').toLocaleLowerCase('es-CL');return s ? s[0].toLocaleUpperCase('es-CL')+s.slice(1) : ''}

async function clearVisibleParkingIfOwned(spot, member) {
  const space=parkingSpaceByBuildingLabel(spot.building,spot.label) || db.prepare('SELECT * FROM parking_spaces WHERE id=?').get(spot.space_id || spot.id);
  if (!space) return;
  const rows=await visibleParkingRowsMap();
  const target=rows.get(space.id);
  if (!target) return;
  const data=await sheetsGet(config.parkingSheetId, parkingTabRange(config.parkingTab, `D${target.rowNumber}:E${target.rowNumber}`));
  const current=data.values?.[0] || [];
  if (!String(current[0]||'').trim() && !String(current[1]||'').trim()) return;
  const currentMember=memberFromParkingIdentity({name:current[0],validation:current[1]});
  if (currentMember && currentMember.id !== member.id) return;
  await sheetsUpdate(config.parkingSheetId, parkingTabRange(config.parkingTab, `D${target.rowNumber}:E${target.rowNumber}`), [['','']]);
}

function ensureLocalParkingReservation(date, space, member, source='SHEET') {
  if (!member?.id) return null;
  const existingMember=db.prepare(`SELECT * FROM parking_reservations WHERE reservation_date=? AND member_id=? AND status='ACTIVE'`).get(date,member.id);
  if (existingMember?.space_id === space.id) return existingMember;
  const now=new Date().toISOString();
  if (existingMember) db.prepare(`UPDATE parking_reservations SET status='CANCELLED',cancelled_at=? WHERE id=?`).run(now,existingMember.id);
  const existingSpace=db.prepare(`SELECT * FROM parking_reservations WHERE reservation_date=? AND space_id=? AND status='ACTIVE'`).get(date,space.id);
  if (existingSpace && existingSpace.member_id !== member.id) db.prepare(`UPDATE parking_reservations SET status='CANCELLED',cancelled_at=? WHERE id=?`).run(now,existingSpace.id);
  try {
    const result=db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,source,created_at) VALUES (?,?,?,?,?,?)`).run(date,space.id,member.id,'ACTIVE',source,now);
    return db.prepare('SELECT * FROM parking_reservations WHERE id=?').get(Number(result.lastInsertRowid));
  } catch { return db.prepare(`SELECT * FROM parking_reservations WHERE reservation_date=? AND member_id=? AND status='ACTIVE'`).get(date,member.id) || null; }
}
function cancelLocalParkingBySpace(date, spaceId) {
  const now=new Date().toISOString();
  db.prepare(`UPDATE parking_reservations SET status='CANCELLED',cancelled_at=? WHERE reservation_date=? AND space_id=? AND status='ACTIVE'`).run(now,date,spaceId);
}

async function migrateExistingParkingReservationsToGoogle() {
  const key='parking_v043_migrated';
  if (getSetting(key)==='1') return;
  await ensureParkingReservationsSheet();
  const rows=db.prepare(`SELECT r.reservation_date,r.space_id,r.member_id,p.label,p.building,m.* FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id JOIN members m ON m.id=r.member_id WHERE r.status='ACTIVE' AND r.reservation_date>=? ORDER BY r.reservation_date`).all(todayChile());
  for (const r of rows) {
    const space=parkingSpaceByBuildingLabel(r.building,r.label); if (!space) continue;
    await writeParkingLedger({date:r.reservation_date,space,member:r,origin:'MI_ASPCH',status:'ACTIVO'});
  }
  setSetting(key,'1');
}

async function projectTodayParkingFromLedgerOnce(date) {
  const key=parkingProjectionSetting(date);
  if (getSetting(key)==='1') return;
  const ledger=await readParkingLedgerRows(date);
  const visible=await readVisibleParkingToday();
  for (const item of ledger) {
    if (visible.has(item.spaceId)) continue;
    const space=parkingSpaceByBuildingLabel(item.building,item.label); if (!space) continue;
    await writeVisibleParking(space,item.member,item.name,item.validation);
  }
  setSetting(key,'1');
}

async function syncParkingDateFromGoogle(date, { force=false }={}) {
  if (!config.parkingSync || !sheetsReadEnabled()) return new Map();
  const cached=parkingSyncCache.get(date);
  if (!force && cached && cached.at>Date.now()-PARKING_SYNC_CACHE_MS) return new Map(cached.items.map(([k,v])=>[k,{...v}]));
  await ensureParkingReservationsSheet();
  if (date === todayChile()) await projectTodayParkingFromLedgerOnce(date);
  const ledger=await readParkingLedgerRows(date);
  const ledgerBySpace=new Map(ledger.map(r=>[r.spaceId,r]));
  let occupancy=new Map();
  if (date === todayChile()) {
    const visible=await readVisibleParkingToday();
    for (const [spaceId,item] of visible) {
      const space=parkingSpaceByBuildingLabel(item.building,item.label); if (!space) continue;
      const existing=ledgerBySpace.get(spaceId);
      const sameIdentity=existing && ((item.memberId && existing.memberId===item.memberId) || (!item.memberId && normalizePersonName(existing.name)===normalizePersonName(item.name)));
      if (!sameIdentity) await writeParkingLedger({date,space,member:item.member,name:item.name,validation:item.validation,origin:'PERSONAL_SHEET',status:'ACTIVO'});
      if (item.member) ensureLocalParkingReservation(date,space,item.member,'SHEET');
      occupancy.set(spaceId,item);
    }
    for (const item of ledger) {
      if (visible.has(item.spaceId)) continue;
      const space=parkingSpaceByBuildingLabel(item.building,item.label); if (!space) continue;
      await writeParkingLedger({date,space,member:item.member,name:item.name,validation:item.validation,origin:item.origin||'PERSONAL_SHEET',status:'CANCELADO'});
      cancelLocalParkingBySpace(date,item.spaceId);
    }
  } else {
    occupancy=new Map(ledger.map(item=>[item.spaceId,{...item,source:'RESERVAS_MI_ASPCH'}]));
    for (const item of ledger) {
      const space=parkingSpaceByBuildingLabel(item.building,item.label); if (space && item.member) ensureLocalParkingReservation(date,space,item.member,item.origin==='MI_ASPCH'?'APP':'SHEET');
    }
    const activeIds=new Set(ledger.map(r=>r.spaceId));
    const local=db.prepare(`SELECT space_id FROM parking_reservations WHERE reservation_date=? AND status='ACTIVE'`).all(date);
    for (const r of local) if (!activeIds.has(r.space_id)) cancelLocalParkingBySpace(date,r.space_id);
  }
  parkingSyncCache.set(date,{at:Date.now(),items:[...occupancy.entries()].map(([k,v])=>[k,{spaceId:v.spaceId,label:v.label,building:v.building,memberId:v.memberId||null,name:v.name||'',source:v.source||''}])});
  return occupancy;
}

async function publishParkingReservationToGoogle(date, space, member, origin='MI_ASPCH') {
  await writeParkingLedger({date,space,member,origin,status:'ACTIVO'});
  if (date === todayChile()) await writeVisibleParking(space,member);
  parkingSyncCache.delete(date);
}

async function calendarPrivacyView(member, from, to) {
  const timeMin = `${from}T00:00:00-04:00`;
  const timeMax = `${addDays(to, 1)}T00:00:00-03:00`;
  const events = await listCalendarEvents({ calendarId: config.calendarId, timeMin, timeMax });
  const output = [];
  for (const ev of events) {
    if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
    const parsed = matchSimulator(ev.summary || ''); if (!parsed) continue;
    const start = ev.start?.dateTime || ev.start?.date; const end = ev.end?.dateTime || ev.end?.date;
    if (!start || !end) continue;
    const mine = Array.isArray(ev.attendees) && ev.attendees.some(a => normalizeEmail(a.email) === normalizeEmail(member.email));
    const period = /\bAM\b/i.test(ev.summary||'')?'AM':/\bPM\b/i.test(ev.summary||'')?'PM':inferSimulatorPeriod(start);
    output.push({
      id:calendarEventRef(ev.id),
      simulatorId:parsed.id, simulator:parsed.label, start,end, period,
      occupied:true,mine, canCancel:mine && config.simulatorCancelEnabled
    });
  }
  return output;
}

function calendarEventRef(eventId) {
  return crypto.createHmac('sha256',process.env.SESSION_SECRET||'dev').update(String(eventId)).digest('base64url').slice(0,16);
}

function inferSimulatorPeriod(start) {
  const m = String(start || '').match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) < 12 ? 'AM' : 'PM';
}

async function findCancelableCalendarEvent(member, eventRef, from, to) {
  const timeMin = `${from}T00:00:00-04:00`;
  const timeMax = `${addDays(to, 1)}T00:00:00-03:00`;
  const events = await listCalendarEvents({ calendarId:config.calendarId, timeMin, timeMax });
  for (const ev of events) {
    if (!ev?.id || calendarEventRef(ev.id) !== eventRef || ev.status === 'cancelled') continue;
    const parsed = matchSimulator(ev.summary || '');
    if (!parsed) continue;
    const mine = Array.isArray(ev.attendees) && ev.attendees.some(a => normalizeEmail(a.email) === normalizeEmail(member.email));
    if (!mine) continue;
    const start = ev.start?.dateTime || ev.start?.date;
    const end = ev.end?.dateTime || ev.end?.date;
    if (!start || !end) continue;
    const period = /\bAM\b/i.test(ev.summary||'')?'AM':/\bPM\b/i.test(ev.summary||'')?'PM':inferSimulatorPeriod(start);
    return { googleEventId:ev.id, simulatorId:parsed.id, simulator:parsed.label, start, end, period, summary:ev.summary || '' };
  }
  return null;
}

function normalizeQueuePersonName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function simulatorWeekTab(dateIso) {
  const monday = mondayOf(dateIso);
  const [y,m,d] = monday.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `Lunes ${String(d).padStart(2,'0')}-${months[m-1]}`;
}

function simulatorDayInfo(dateIso) {
  const names = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const [y,m,d] = dateIso.split('-').map(Number);
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  return { name:names[day], column:({1:10,2:11,3:12,4:13,5:14})[day] ?? null };
}

function applicantMapFromSimulatorSheet(values) {
  const map = new Map();
  for (const row of values) {
    const name = String(row?.[1] || '').trim();
    const email = normalizeEmail(row?.[2] || '');
    if (!name || !email || !email.includes('@')) continue;
    map.set(normalizeQueuePersonName(name), { name, email, priority:Number(row?.[4] || 999), requestedAt:String(row?.[0] || ''), options:String(row?.[5] || '') });
  }
  return map;
}

function assignedNamesFromSimulatorSheet(values) {
  const assigned = new Set();
  const header = values.findIndex(r => String(r?.[9] || '').trim().toUpperCase() === 'ASIGNADOS');
  if (header < 0) return assigned;
  for (let i=header+1;i<Math.min(values.length,header+4);i++) {
    const shift = String(values[i]?.[9] || '').trim().toUpperCase();
    if (!['AM','PM'].includes(shift)) continue;
    for (let c=10;c<=14;c++) {
      const name = String(values[i]?.[c] || '').trim();
      if (name) assigned.add(normalizeQueuePersonName(name));
    }
  }
  return assigned;
}

function candidateNamesForSlot(values, dayColumn, period) {
  if (dayColumn == null) return [];
  const header = values.findIndex(r => String(r?.[9] || '').trim().toUpperCase() === 'DÍAS Y HORARIO' || String(r?.[9] || '').trim().toUpperCase() === 'DIAS Y HORARIO');
  if (header >= 0) {
    for (let i=header+1;i<Math.min(values.length,header+5);i++) {
      if (String(values[i]?.[9] || '').trim().toUpperCase() !== period) continue;
      return String(values[i]?.[dayColumn] || '').split(/\n+/).map(x=>x.trim()).filter(Boolean);
    }
  }
  return [];
}

function chooseNextSimulatorCandidate(values, { dateIso, period, memberEmail, memberName }) {
  const day = simulatorDayInfo(dateIso);
  const applicants = applicantMapFromSimulatorSheet(values);
  const assigned = assignedNamesFromSimulatorSheet(values);
  const cancelEmail = normalizeEmail(memberEmail);
  const cancelName = normalizeQueuePersonName(memberName);
  const listed = candidateNamesForSlot(values, day.column, period);
  for (const listedName of listed) {
    const key = normalizeQueuePersonName(listedName);
    const person = applicants.get(key);
    if (!person || assigned.has(key) || key === cancelName || person.email === cancelEmail) continue;
    return { ...person, source:'slot-list', day:day.name, period };
  }
  const optionNeedle = `${day.name} ${period}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const fallback = [...applicants.values()].filter(person => {
    const opts = person.options.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const key = normalizeQueuePersonName(person.name);
    return opts.includes(optionNeedle) && !assigned.has(key) && key !== cancelName && person.email !== cancelEmail;
  }).sort((a,b)=>(a.priority-b.priority)||a.requestedAt.localeCompare(b.requestedAt));
  return fallback[0] ? { ...fallback[0], source:'options-fallback', day:day.name, period } : null;
}

async function nextSimulatorCandidate(found, member) {
  if (found.simulatorId !== config.simulatorQueueSimulatorId || !config.simulatorQueueSheetId || !sheetsReadEnabled()) return null;
  const dateIso=found.start.slice(0,10),tab=simulatorWeekTab(dateIso),day=simulatorDayInfo(dateIso),needle=`${day.name} ${found.period}`;
  const [week,failsData,streakData,groupsData]=await Promise.all([
    sheetsGet(config.simulatorQueueSheetId,`'${tab}'!A1:O160`),
    sheetsGet(config.simulatorQueueSheetId,"'NoAsignados'!A2:D2000").catch(()=>({values:[]})),
    sheetsGet(config.simulatorQueueSheetId,"'AsignadosStreaks'!A2:F2000").catch(()=>({values:[]})),
    sheetsGet(config.simulatorQueueSheetId,"'Grupos'!A2:B1000").catch(()=>({values:[]}))
  ]);
  const values=week.values||[],assigned=assignedNamesFromSimulatorSheet(values),cancelEmail=normalizeEmail(member.email),cancelName=normalizeQueuePersonName(member.name);
  const failMap=new Map((failsData.values||[]).map(r=>[String(r?.[0]||'').trim(),Number(r?.[3]||0)]));
  const streakMap=new Map((streakData.values||[]).map(r=>[String(r?.[0]||'').trim(),Number(r?.[3]||0)+Number(r?.[5]||0)]));
  const groupMap=new Map();for(const r of (groupsData.values||[])){const id=String(r?.[0]||'').trim(),g=String(r?.[1]||'').trim();if(!id||!g)continue;groupMap.set(normalizeQueuePersonName(id),g);if(id.includes('@'))groupMap.set(normalizeEmail(id),g)}
  const assignedGroups=new Set();for(const n of assigned){const g=groupMap.get(n);if(g)assignedGroups.add(g)}
  const candidates=[];
  for(let i=1;i<values.length;i++){
    const r=values[i]||[],name=String(r[1]||'').trim(),email=normalizeEmail(r[2]||''),options=String(r[5]||'');if(!name||!email)continue;
    const nk=normalizeQueuePersonName(name),pk=`${name} <${email}>`;if(nk===cancelName||email===cancelEmail||assigned.has(nk))continue;
    const pairs=options.split(';').map(x=>x.trim()).filter(Boolean);const prefIdx=pairs.findIndex(x=>normalizeQueuePersonName(x)===normalizeQueuePersonName(needle));if(prefIdx<0)continue;
    const group=groupMap.get(nk)||groupMap.get(email)||null;if(group&&assignedGroups.has(group))continue;
    const priority=Number(r[4]||99),fails=Number(failMap.get(pk)||0),streak=Number(streakMap.get(pk)||0);
    let adjusted=priority;if(fails>=2)adjusted=Math.max(1,adjusted-1);if(streak>=3)adjusted=Math.min(4,adjusted+1);
    candidates.push({name,email,priority,priorityAdjusted:adjusted,fails,streak,prefIdx,requestedAt:String(r[0]||''),rowIndex:i+1,options,group,source:'touch-ranking',day:day.name,period:found.period});
  }
  candidates.sort((a,b)=>(a.priorityAdjusted-b.priorityAdjusted)||(a.prefIdx-b.prefIdx)||a.requestedAt.localeCompare(b.requestedAt)||a.email.localeCompare(b.email)||a.rowIndex-b.rowIndex);
  return candidates[0]?{...candidates[0],tab}:null;
}

function simulatorSlotLabel(found) {
  const dateIso = found.start.slice(0,10);
  const day = simulatorDayInfo(dateIso).name;
  return `${day} ${found.period || ''}`.trim();
}

async function notifySimulatorCancellation({ member, found, nextCandidate }) {
  const slot=simulatorSlotLabel(found),dateIso=found.start.slice(0,10);let staffNotified=false,nextCandidateNotified=false;const errors=[];
  const admin=db.prepare("SELECT id FROM members WHERE email=? AND role='ADMIN' AND active=1").get(config.adminEmail);
  if(admin){const r=await sendMemberPush(db,admin.id,{key:`sim-cancel-staff:${found.googleEventId}`,kind:'simulators',title:`Cancelación ${found.simulator} · ${slot}`,body:`${member.name} canceló su turno del ${dateIso}. ${nextCandidate?`Siguiente candidato Touch: ${nextCandidate.name}.`:'No se detectó candidato siguiente.'}`,url:'/?view=admin'});staffNotified=staffNotified||r.sent>0}
  if(nextCandidate?.email){const nextMember=db.prepare('SELECT id FROM members WHERE email=? AND active=1').get(nextCandidate.email);if(nextMember){const r=await sendMemberPush(db,nextMember.id,{key:`sim-cancel-next:${found.googleEventId}:${nextMember.id}`,kind:'simulators',title:`Se liberó un turno ${found.simulator}`,body:`Se liberó ${slot} del ${dateIso} y tu solicitud aparece como siguiente opción según A320 Touch. Este aviso no confirma asignación; ASPCH debe confirmarla.`,url:'/?view=simulators'});nextCandidateNotified=nextCandidateNotified||r.sent>0}}
  if(gmailNotificationSendEnabled()){
    if(config.simulatorCancelNotifyEmail){try{await sendWorkspaceEmail({to:config.simulatorCancelNotifyEmail,subject:`Cancelación simulador · ${found.simulator} · ${slot}`,lines:[`${member.name} (${member.rut||'RUT no disponible'}) canceló su turno confirmado.`,`Fecha: ${dateIso} · ${slot}`,nextCandidate?`Siguiente candidato A320 Touch: ${nextCandidate.name} <${nextCandidate.email}>.`:'No se encontró candidato siguiente.','Mi ASPCH no reasignó el turno automáticamente.']});staffNotified=true}catch(err){errors.push(`personal:${err.message}`)}}
    if(nextCandidate?.email){try{await sendWorkspaceEmail({to:nextCandidate.email,subject:`Se liberó un turno de simulador ${found.simulator} · ${slot}`,lines:[`Hola ${nextCandidate.name},`,`Se liberó el turno ${slot} del ${dateIso}.`,`Tu solicitud aparece como siguiente opción según la prioridad de A320 Touch.`,'Este aviso NO confirma una asignación automática. ASPCH debe confirmar el turno.']});nextCandidateNotified=true}catch(err){errors.push(`siguiente:${err.message}`)}}
  }
  return{staffNotified,nextCandidateNotified,errors,gmail:gmailNotificationSendEnabled()};
}

async function safeSimulatorCancellationLog({ member, found, nextCandidate, notices, now }) {
  if (!config.simulatorQueueSheetId) return;
  try {
    await ensureSheet(config.simulatorQueueSheetId, config.simulatorCancelLogTab);
    const existing = await sheetsGet(config.simulatorQueueSheetId, `'${config.simulatorCancelLogTab}'!A1:J2`);
    if (!(existing.values || []).length) {
      await sheetsUpdate(config.simulatorQueueSheetId, `'${config.simulatorCancelLogTab}'!A1:J1`, [[
        'Fecha cancelación','Socio','RUT','Email','Simulador','Fecha turno','Turno','Siguiente candidato','Email siguiente','Notificaciones'
      ]]);
    }
    await sheetsAppend(config.simulatorQueueSheetId, `'${config.simulatorCancelLogTab}'!A:J`, [[
      now,member.name,member.rut||'',member.email,found.simulator,found.start.slice(0,10),simulatorSlotLabel(found),
      nextCandidate?.name||'',nextCandidate?.email||'',`Personal:${notices.staffNotified?'SI':'NO'} · Siguiente:${notices.nextCandidateNotified?'SI':'NO'}`
    ]]);
  } catch (err) { console.error('[Mi ASPCH] Log cancelación simulador:', err.message); }
}

function matchSimulator(summary) {
  const u = summary.toUpperCase();
  const sims = [...config.simulators].sort((a,b) => Math.max(...b.match.map(x=>x.length))-Math.max(...a.match.map(x=>x.length)));
  for (const sim of sims) if (sim.match.some(m => u.includes(String(m).toUpperCase()))) return sim;
  return null;
}

function parkingPublicReservation(r) {
  const reminderDue = r.checked_in_at ? new Date(new Date(r.checked_in_at).getTime()+4*3600_000).toISOString() : null;
  return { id:r.id,spaceId:r.space_id,label:r.label,building:r.building,checkedInAt:r.checked_in_at||null,reminderHours:4,reminderDue };
}
async function membershipSummary(member) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  const year=Number(parts.find(p=>p.type==='year')?.value||new Date().getFullYear());
  const month=Number(parts.find(p=>p.type==='month')?.value||new Date().getMonth()+1);
  const paid=db.prepare(`SELECT * FROM membership_payments WHERE member_id=? AND membership_year=? AND COALESCE(membership_month,?)=? AND status='PAID' ORDER BY id DESC LIMIT 1`).get(member.id,year,month,month);
  const uf=await getBillingUfReference();
  const plan=membershipPlanFor(member, uf);
  const exempt=plan.exempt===true || plan.monthlyClp===0;
  const financial=financialSummary(db,member);
  let status=exempt?'EXENTO':(paid?'AL_DIA':'PENDIENTE');
  if(financial?.status==='MOROSO')status='MOROSO';
  if(financial?.status==='CONGELADO')status='EXENTO';
  if(financial?.status==='DESAFILIADO')status='DESAFILIADO';
  const payroll=isLatamPayrollEmployer(member.employer);
  let message=exempt?'Esta categoría está exenta de mensualidad.':(paid?'Mensualidad del mes registrada como pagada.':payroll?'Pago mediante descuento por planilla':'Puedes pagar mediante transferencia bancaria usando los datos de ASPCH.');
  if(financial?.status==='MOROSO')message=`Tienes ${financial.monthsDue} ${financial.monthsDue===1?'mes pendiente':'meses pendientes'}. Por favor regulariza lo antes posible o comunícate con nosotros.`;
  if(financial?.status==='CONGELADO')message='Tu membresía está congelada y exenta de pago durante el período informado por ASPCH.';
  if(financial?.status==='DESAFILIADO')message='Tu registro figura como desafiliado. Comunícate con ASPCH si necesitas revisar tu situación.';
  return {
    year,month,
    periodLabel:new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',month:'long',year:'numeric'}).format(new Date()),
    status,paymentEnabled:false,paymentMethod:payroll?'PAYROLL':'TRANSFER',periodicity:'MENSUAL',message,quote:plan,uf,financial,
    lastPaymentAt:paid?.paid_at||null
  };
}
function isLatamPayrollEmployer(value=''){
  const employer=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  return ['LATAM AIRLINES','LATAM GRUPO','LATAM CARGO'].some(name=>employer===name||employer.startsWith(`${name} `));
}
function normalizePhoneDigits(value=''){return String(value||'').replace(/\D+/g,'')}
function whatsappUrl(topic='', text=''){
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  const params = new URLSearchParams();
  if (text) params.set('text', text);
  return params.toString() ? `${base}?${params.toString()}` : base;
}
function formatClp(amount){
  if(amount===null||amount===undefined||Number.isNaN(Number(amount)))return '—';
  return new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(Math.round(Number(amount)));
}
function isAirlineMember(member){return /L[IÍ]NEA\s*A[EÉ]REA/i.test(String(member.category||''))}
function normalizeProfilePhone(value=''){
  const raw=String(value||'').trim();
  const digits=raw.replace(/\D+/g,'');
  if(!digits)return '';
  if(digits.startsWith('56'))return `+${digits}`;
  if(digits.length===9)return `+56${digits}`;
  return raw.slice(0,30);
}
function parseMemberBirthDate(rawValue){
  const raw=String(rawValue||'').trim();
  if(!raw || /^PENDIENTE$/i.test(raw)) return null;
  let y,m,d;
  let hit=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(hit){ d=Number(hit[1]); m=Number(hit[2]); y=Number(hit[3]); }
  else {
    hit=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(hit){ y=Number(hit[1]); m=Number(hit[2]); d=Number(hit[3]); }
  }
  if(!y||!m||!d||m<1||m>12||d<1||d>31) return null;
  const dt=new Date(Date.UTC(y,m-1,d,12,0,0));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d) return null;
  return {y,m,d};
}
function memberAgeOn(dateIso, birthDate){
  const b=parseMemberBirthDate(birthDate); if(!b) return null;
  const [ry,rm,rd]=String(dateIso).split('-').map(Number);
  let age=ry-b.y;
  if(rm<b.m || (rm===b.m && rd<b.d)) age--;
  return age;
}
function retirementStatus(member){
  const today=todayChile();
  const position=String(member.position||'').trim().toUpperCase();
  const category=String(member.category||'').trim().toUpperCase();
  const employer=String(member.employer||'').trim().toUpperCase();
  const explicit=/JUB|JUBILAD/.test(category)||/JUB|JUBILAD/.test(position)||/JUB|JUBILAD/.test(employer);
  const pilotRetirementEligible=/L[IÍ]NEA\s*A[EÉ]REA/.test(category)||/HELIC/.test(category)||/HELIC/.test(position);
  const age=memberAgeOn(today, member.birth_date);
  const byAge=pilotRetirementEligible&&Number.isFinite(age)&&age>=65;
  const birth=parseMemberBirthDate(member.birth_date);
  const [,tm,td]=today.split('-').map(Number);
  const turning65Today=pilotRetirementEligible&&!!birth && birth.m===tm && birth.d===td && age===65;
  return { isRetired: explicit || byAge, explicit, byAge, age, turning65Today, pilotRetirementEligible };
}
function membershipPlanFor(member, uf){
  const position = String(member.position || '').trim().toUpperCase();
  const category = String(member.category || '').trim().toUpperCase();
  const employer = String(member.employer || '').trim().toUpperCase();
  const retirement = retirementStatus(member);
  const isRetired = retirement.isRetired;
  const isHelicopter = /HELIC/.test(category) || /HELIC/.test(position);
  const isCorporate = /CORP/.test(category) || /CORP/.test(position);
  const isCommercial = /COMERCIAL/.test(category) || /COMERCIAL/.test(employer) || /COMERCIAL/.test(position);
  const isFO = /(^|\b)(FO|F\/O|PRIMER OFICIAL)(\b|$)/.test(position);
  const isCaptain = /(^|\b)(CPT|CAPT|CAPITAN|CAPITÁN)(\b|$)/.test(position);
  const base = { code:'GENERAL', label:'Socio ASPCH', icon:'👤', formula:'Por definir', monthlyClp:null, monthlyDisplay:'Por definir', note:'Falta parametrizar esta categoría.' };
  if (member.is_board) return { code:'DIRECTORIO', label:'Directorio', icon:'⭐', formula:'Exento de mensualidad', monthlyClp:0, monthlyDisplay:'Sin mensualidad', exempt:true, note:'Los integrantes del Directorio están exentos de mensualidad.', specialNotice:retirement.turning65Today?{ title:'¡Felicitaciones por tus 65 años! 🎉', body:'Hoy comienzas una nueva etapa. Te invitamos a acercarte a las oficinas ASPCH para ayudarte con tus trámites y acompañarte en esta nueva vida.' }:null };
  if (isRetired) return { code:'JUBILADO', label:'Jubilado', icon:'🧓', formula:'Exento de mensualidad', monthlyClp:0, monthlyDisplay:'Sin mensualidad', exempt:true, note:'Los asociados jubilados no pagan mensualidad.', specialNotice:retirement.turning65Today?{ title:'¡Felicitaciones por tus 65 años! 🎉', body:'Hoy comienzas una nueva etapa y tu membresía queda exenta de pago. Te invitamos a acercarte a las oficinas ASPCH para ayudarte con tus trámites y acompañarte en esta nueva vida.' }:null };
  if (isCommercial) return { code:'COMERCIAL', label:'Comercial', icon:'💼', formula:'$15.000 cuota', baseFeeClp:15000, lossLicenseContributionClp:0, monthlyClp:15000, monthlyDisplay:formatClp(15000), note:'Mensualidad fija de $15.000.' };
  if (isCorporate) return { code:'CORPORATIVO', label:'Corporativo', icon:'🏢', formula:'$15.000 cuota + $12.000 aporte pérdida de licencia', baseFeeClp:15000, lossLicenseContributionClp:12000, monthlyClp:27000, monthlyDisplay:formatClp(27000), note:'Total mensual: $27.000.' };
  if (isHelicopter || isFO) {
    const code=isHelicopter?'HELICOPTERO':'FO';
    const label=isHelicopter?'Helicóptero':'Primer Oficial';
    const icon=isHelicopter?'🚁':'🛫';
    if(!uf?.available) return { code,label,icon,formula:'0,75 UF + $12.000', ufFactor:0.75, baseFeeClp:0, monthlyClp:null, monthlyDisplay:'UF SII no disponible', ufReference:null, lossLicenseContributionClp:12000, note:'No se pudo leer la UF oficial de cobro del SII para este mes.' };
    const amount = (0.75 * uf.value) + 12000;
    return { code,label,icon,formula:'0,75 UF + $12.000', ufFactor:0.75, baseFeeClp:0, monthlyClp:Math.round(amount), monthlyDisplay:formatClp(amount), ufReference:uf.value, ufDate:uf.date, lossLicenseContributionClp:12000, note:`Calculado con la UF oficial de cobro SII ${formatClp(uf.value)} correspondiente al cierre del ${formatChileDate(uf.date)}.` };
  }
  if (isCaptain) {
    if(!uf?.available) return { code:'CPT', label:'Capitán', icon:'👨‍✈️', formula:'0,99 UF + $12.000', ufFactor:0.99, baseFeeClp:0, monthlyClp:null, monthlyDisplay:'UF SII no disponible', ufReference:null, lossLicenseContributionClp:12000, note:'No se pudo leer la UF oficial de cobro del SII para este mes.' };
    const amount = (0.99 * uf.value) + 12000;
    return { code:'CPT', label:'Capitán', icon:'👨‍✈️', formula:'0,99 UF + $12.000', ufFactor:0.99, baseFeeClp:0, monthlyClp:Math.round(amount), monthlyDisplay:formatClp(amount), ufReference:uf.value, ufDate:uf.date, lossLicenseContributionClp:12000, note:`Calculado con la UF oficial de cobro SII ${formatClp(uf.value)} correspondiente al cierre del ${formatChileDate(uf.date)}.` };
  }
  return base;
}
function previousMonthEnd(dateChile=todayChile()){
  const [y,m]=dateChile.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,0,12,0,0));
  return dt.toISOString().slice(0,10);
}
async function getBillingUfReference(){
  const date=previousMonthEnd(todayChile());
  const key=`UF:${date}`;
  const stored=db.prepare('SELECT value,updated_at FROM app_settings WHERE key=?').get(key);
  if(stored){
    try{
      const saved=JSON.parse(stored.value);
      if(Number.isFinite(Number(saved.value)) && Number(saved.value)>10000){
        ufCache.key=key;ufCache.date=date;ufCache.value=Number(saved.value);ufCache.fetchedAt=Date.now();ufCache.sourceUrl=saved.sourceUrl||null;
        return {available:true,value:Number(saved.value),date,source:'SII',sourceUrl:saved.sourceUrl||null,cached:true,persistent:true};
      }
    }catch{}
  }
  if(ufCache.key===key && ufCache.value && Date.now()-ufCache.fetchedAt<UF_CACHE_MS){
    return {available:true,value:ufCache.value,date,source:'SII',sourceUrl:ufCache.sourceUrl,cached:true};
  }
  const year=Number(date.slice(0,4));
  const month=Number(date.slice(5,7));
  const day=Number(date.slice(8,10));
  const sourceUrl=`https://www.sii.cl/valores_y_fechas/uf/uf${year}.htm`;
  try{
    const response=await fetch(sourceUrl,{headers:{'user-agent':'MiASPCH/0.4.5 (+https://aspch.org)'}});
    if(!response.ok)throw new Error(`SII HTTP ${response.status}`);
    const html=await response.text();
    const months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthName=months[month-1];
    const headingRe=new RegExp(`<h2[^>]*>\\s*${monthName}\\s*<\\/h2>`,'i');
    const heading=headingRe.exec(html);
    if(!heading) throw new Error(`No encontré ${monthName} en SII`);
    const tail=html.slice(heading.index+heading[0].length);
    const nextHeading=tail.search(/<h2[^>]*>/i);
    const htmlSection=nextHeading>=0?tail.slice(0,nextHeading):tail;
    const section=htmlSection.replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
    const dayPattern=new RegExp(`(?:^|\\s)${day}\\s+([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2})(?:\\s|$)`,'g');
    const values=[...section.matchAll(dayPattern)];
    if(!values.length) throw new Error(`No encontré UF para ${date}`);
    const value=Number(values[values.length-1][1].replace(/\./g,'').replace(',','.'));
    if(!Number.isFinite(value)||value<10000)throw new Error('Valor UF inválido');
    ufCache.key=key;ufCache.date=date;ufCache.value=value;ufCache.fetchedAt=Date.now();ufCache.sourceUrl=sourceUrl;
    db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(key,JSON.stringify({value,sourceUrl,date}),new Date().toISOString());
    return {available:true,value,date,source:'SII',sourceUrl,cached:false,persistent:true};
  }catch(err){
    console.error('[Mi ASPCH] UF SII:',err.message);
    return {available:false,value:null,date,source:'SII',sourceUrl,error:'No fue posible obtener la UF oficial del SII.'};
  }
}
function formatChileDate(date){
  try{return new Intl.DateTimeFormat('es-CL',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${date}T12:00:00Z`))}catch{return date}
}
function transferSummary(){
  const data={
    bank:String(process.env.TRANSFER_BANK||'Scotiabank').trim(),
    accountType:String(process.env.TRANSFER_ACCOUNT_TYPE||'Cuenta Corriente').trim(),
    accountNumber:String(process.env.TRANSFER_ACCOUNT_NUMBER||'972670782').trim(),
    holder:String(process.env.TRANSFER_ACCOUNT_HOLDER||'ASOCIACIÓN DE PILOTOS DE CHILE').trim(),
    rut:String(process.env.TRANSFER_ACCOUNT_RUT||'82.760.200-0').trim(),
    email:String(process.env.TRANSFER_ACCOUNT_EMAIL||'tesoreria@aspch.org').trim()
  };
  const configured=!!(data.bank&&data.accountType&&data.accountNumber&&data.holder&&data.rut);
  return {configured,...data,message:configured?'Datos de transferencia ASPCH.':'Datos de transferencia pendientes de configurar por ASPCH.'};
}
function securitySummary(m,req){
  const w=webauthnSummary(db,m,effectiveRequestOrigin(req),isSecureRequest(req));
  return {pinSet:!!m.pin_hash,unlocked:isUnlocked(m),unlockedUntil:m.unlocked_until||null,...w};
}
function visibleMemberRut(m){return m?.rut||null}
function publicMember(m){ return {id:m.id,email:m.email,name:m.name,preferredName:m.preferred_name||null,rut:visibleMemberRut(m),phone:m.phone,employer:m.employer,category:m.category,position:m.position,role:m.role,active:!!m.active,isBoard:!!m.is_board,birthDate:m.birth_date||null}; }

function credentialCode(memberId) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev').update(`member:${memberId}`).digest('base64url').slice(0,18).toUpperCase();
}
function credentialVerifyUrl(req, code) {
  let origin='';
  const configured=String(process.env.PUBLIC_APP_URL||'').trim();if(configured){try{origin=new URL(configured).origin}catch{}}
  if(!origin)origin=effectiveRequestOrigin(req)||APP_ORIGIN;
  return `${origin}/verify/${encodeURIComponent(code)}`;
}
function findProfilePhoto(memberId) {
  for(const ext of ['.jpg','.jpeg','.png','.webp']){const f=path.join(PROFILE_PHOTOS_DIR,`member-${Number(memberId)}${ext}`);if(fs.existsSync(f)&&fs.statSync(f).isFile())return f}
  return null;
}
function findCredentialPhoto(member){return findProfilePhoto(member.id)||findSipaPhoto(member.rut)}
function removeProfilePhoto(memberId){
  for(const ext of ['.jpg','.jpeg','.png','.webp']){const f=path.join(PROFILE_PHOTOS_DIR,`member-${Number(memberId)}${ext}`);try{fs.unlinkSync(f)}catch{}}
}
function saveProfilePhoto(memberId,dataUrl){
  const m=String(dataUrl||'').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(!m){const e=new Error('Formato de imagen no permitido. Usa JPG, PNG o WebP.');e.statusCode=400;e.expose=true;throw e}
  const type=m[1].toLowerCase()==='jpg'?'jpeg':m[1].toLowerCase();const buf=Buffer.from(m[2].replace(/\s/g,''),'base64');
  if(!buf.length||buf.length>MAX_PROFILE_PHOTO_BYTES){const e=new Error('La foto es demasiado grande.');e.statusCode=413;e.expose=true;throw e}
  const valid=(type==='jpeg'&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)||(type==='png'&&buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))||(type==='webp'&&buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP');
  if(!valid){const e=new Error('El archivo no parece ser una imagen válida.');e.statusCode=400;e.expose=true;throw e}
  removeProfilePhoto(memberId);const ext=type==='jpeg'?'.jpg':`.${type}`;const target=path.join(PROFILE_PHOTOS_DIR,`member-${Number(memberId)}${ext}`);const temp=`${target}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(temp,buf,{mode:0o600});fs.renameSync(temp,target);return{file:target,bytes:buf.length};
}
function findMemberByCredentialCode(code){
  const normalized=String(code||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{12,32}$/.test(normalized))return null;
  const members=db.prepare('SELECT id,name,category,position,active FROM members WHERE active=1').all();
  const found=members.find(m=>credentialCode(m.id)===normalized)||null;if(!found)return null;const st=credentialStatus(db,found.id);return st.revoked?{...found,credential_revoked:1,credential_reason:st.reason}:found;
}
function serveCredentialVerification(req,res,pathname){
  const code=decodeURIComponent(pathname.slice('/verify/'.length)).trim();const member=findMemberByCredentialCode(code);
  const ok=!!member&&!member.credential_revoked;res.statusCode=ok?200:404;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
  const title=ok?'Credencial ASPCH válida':'Credencial no válida',name=ok?escapeHtmlText(titleCaseName(member.name)):'';
  const category=ok?escapeHtmlText(member.category||'Socio ASPCH'):'';
  return res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>${title}</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0b0d12;color:#f4f6fb;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.v{width:min(420px,100%);background:#12151c;border:1px solid #29313e;border-radius:26px;padding:28px;box-sizing:border-box}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${ok?'#61d4a2':'#ff8b92'};margin-right:8px}h1{font-size:28px;margin:14px 0 22px}strong{font-size:22px}.meta{color:#9ba6b8;margin-top:8px}.small{font-size:12px;color:#9ba6b8;margin-top:28px;line-height:1.5}</style></head><body><main class="v"><div><span class="dot"></span>${title}</div>${ok?`<h1>${name}</h1><strong>${category}</strong><div class="meta">Estado: socio activo</div>`:'<h1>No pudimos validar este código.</h1>'}<p class="small">Esta verificación no publica RUT, correo, teléfono ni fotografía del asociado.</p></main></body></html>`);
}
function titleCaseName(v=''){return String(v).toLowerCase().replace(/(^|\s|[-'])\p{L}/gu,m=>m.toUpperCase())}
function escapeHtmlText(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function findSipaPhoto(rut) {
  const n=normalizeRut(rut); if(!n)return null;
  const variants=[n,n.replace('-','')]; const exts=['.png','.jpg','.jpeg','.webp'];
  // Fuente oficial para Mi ASPCH: retratos SIPA aislados de cualquier
  // frente/archivo de credencial generado. Esto evita mostrar una credencial
  // completa recortada como si fuese la fotografía del socio.
  const dirs=[SIPA_PORTRAITS_DIR];
  if(ALLOW_LEGACY_SIPA_PHOTOS)dirs.push(SIPA_PHOTOS_DIR);
  for(const dir of dirs)for(const base of variants)for(const ext of exts){
    const f=path.join(dir,base+ext);
    if(fs.existsSync(f)&&fs.statSync(f).isFile())return f;
  }
  return null;
}
function sendFile(res,file,cache='no-store') {
  const ext=path.extname(file).toLowerCase(); const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext]||'application/octet-stream';
  res.statusCode=200;res.setHeader('Content-Type',mime);res.setHeader('Cache-Control',cache);fs.createReadStream(file).pipe(res);
}
function serveStatic(req,res,pathname){
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Método no permitido.'});
  if(pathname==='/test-notificaciones.html'){
    res.statusCode=302;res.setHeader('Location','/');res.setHeader('Cache-Control','no-store');return res.end();
  }
  if(req.isAdminPort && pathname==='/') pathname='/admin.html';
  else if(req.isLabPort && PREVIEW_MODE && pathname==='/') pathname='/lab.html';
  else if(pathname==='/' || pathname==='/mobile') pathname='/index.html';
  let target=path.normalize(path.join(PUBLIC_DIR,pathname)); if(!target.startsWith(PUBLIC_DIR))return json(res,403,{error:'Ruta inválida.'});
  if(!fs.existsSync(target)||fs.statSync(target).isDirectory())target=path.join(PUBLIC_DIR,'index.html');
  const ext=path.extname(target).toLowerCase(); const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'}[ext]||'application/octet-stream';
  const cacheControl=ext==='.html'||(PREVIEW_MODE&&ext==='.js')?'no-store':'public, max-age=3600';
  res.statusCode=200;res.setHeader('Content-Type',mime);res.setHeader('Cache-Control',cacheControl); if(req.method==='HEAD')return res.end();
  fs.createReadStream(target).pipe(res);
}
function setSecurityHeaders(res){
  res.setHeader('X-Content-Type-Options','nosniff');if (!PREVIEW_MODE) res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy', PREVIEW_MODE ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'" : "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}
function effectiveRequestOrigin(req){const host=String(req.headers.host||'').trim();if(!host)return null;const fp=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();const proto=fp==='https'||fp==='http'?fp:(req.socket?.encrypted?'https':'http');try{return new URL(`${proto}://${host}`).origin}catch{return null}}
function isSecureRequest(req){return effectiveRequestOrigin(req)?.startsWith('https://')||false}
function enforceOrigin(req){const raw=req.headers.origin;if(!raw)return;let origin;try{origin=new URL(String(raw)).origin}catch{const e=new Error('Origen no autorizado');e.statusCode=403;e.expose=true;throw e}if(origin!==effectiveRequestOrigin(req)&&!APP_ORIGINS.has(origin)){const e=new Error('Origen no autorizado');e.statusCode=403;e.expose=true;throw e}}
function ensurePasskeyAllowed(req){
  const info=webauthnRequestInfo(effectiveRequestOrigin(req),isSecureRequest(req));
  if(!info.available){
    const e=new Error(info.requiresHttps?'Face ID/huella requiere HTTPS.':'La biometría solo está habilitada en el dominio oficial de Mi ASPCH.');
    e.statusCode=400;e.expose=true;throw e;
  }
}
function passkeyError(result){
  if(result?.reason==='challenge_expired')return 'La solicitud biométrica venció. Intenta nuevamente.';
  if(result?.reason==='credential_not_found')return 'Esta passkey no está registrada para tu cuenta.';
  if(result?.reason==='verification_failed')return 'No fue posible verificar la biometría/passkey.';
  return 'No fue posible completar la autenticación biométrica.';
}
async function readRaw(req,max=30_000_000){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max){const e=new Error('Solicitud demasiado grande');e.statusCode=413;e.expose=true;throw e}chunks.push(chunk)}return Buffer.concat(chunks)}
async function readJson(req,max=100_000){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max){const e=new Error('Solicitud demasiado grande');e.statusCode=413;e.expose=true;throw e}chunks.push(chunk)}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{const e=new Error('JSON inválido');e.statusCode=400;e.expose=true;throw e}}
function sendCsv(res,fileName,rows){const list=Array.isArray(rows)?rows:[];const cols=[...new Set(list.flatMap(r=>Object.keys(r||{})))];const esc=v=>{if(v==null)return '';const s=typeof v==='object'?JSON.stringify(v):String(v);return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};const out='\uFEFF'+[cols.join(','),...list.map(r=>cols.map(c=>esc(r?.[c])).join(','))].join('\r\n');res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${String(fileName).replace(/[^a-zA-Z0-9._-]/g,'_')}"`);res.setHeader('Cache-Control','no-store');res.end(out)}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data))}
function parseSimulators(raw){
  try{
    const x=JSON.parse(raw||'null');
    if(Array.isArray(x)&&x.length)return x.map((s,i)=>{
      let id=String(s.id||`sim${i+1}`), label=String(s.label||`Simulador ${i+1}`), match=Array.isArray(s.match)&&s.match.length?s.match.map(String):[label];
      // Compatibilidad con el .env de v0.1.1: migra automáticamente sim3/sim4.
      if(id==='sim3'||/simulador\s*3/i.test(label)){id='b787';label='Boeing 787';match=['BOEING 787','B787','787',...match]}
      if(id==='sim4'||/simulador\s*4/i.test(label)){id='c172';label='Cessna 172';match=['CESSNA 172','CESSNA172','C172',...match]}
      return{id,label,match};
    });
  }catch{}
  return[
    {id:'a320',label:'A320',match:['A320']},
    {id:'a320pro',label:'A320Pro',match:['A320PRO','A320 PRO']},
    {id:'b787',label:'Boeing 787',match:['BOEING 787','B787','787']},
    {id:'c172',label:'Cessna 172',match:['CESSNA 172','CESSNA172','C172']}
  ]
}
function loadEnv(file){if(!fs.existsSync(file))return;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){if(!line||/^\s*#/.test(line))continue;const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(process.env[m[1]]===undefined)process.env[m[1]]=v}}
function bool(v,d=false){if(v==null)return d;return['1','true','yes','si','sí','on'].includes(String(v).toLowerCase())}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null}
function addDays(date,days){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function todayChile(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function weekdayIndex(date){return new Date(`${date}T12:00:00Z`).getUTCDay()}
function mondayOf(date){const wd=weekdayIndex(date);return addDays(date,wd===0?-6:1-wd)}
