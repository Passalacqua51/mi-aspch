import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../lib/db.mjs';
import { initV050 } from '../lib/v050.mjs';
import { initV060 } from '../lib/v060.mjs';
import { createSession, memberFromRequest, sessionCookieName, setPin } from '../lib/auth.mjs';

const root=path.resolve(import.meta.dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-auth-'));
const dataDir=path.join(tmp,'data');
const memberEmail='member@example.test';
const memberRut='12.345.678-5';
const boardOldEmail='board-old@example.test';
const boardNewEmail='board-new@example.test';
const boardRut='13.456.789-9';
const adminEmail='admin@example.test';
const memberPin='2468';
const adminPin='8642';
const otp='314159';
const otpSecret='self-check-otp-secret';
const sessionSecret='self-check-session-secret';
process.env.OTP_SECRET=otpSecret;
process.env.SESSION_SECRET=sessionSecret;

function sessionMember(db,member){
  const created=createSession(db,member);
  return memberFromRequest(db,{headers:{cookie:`${sessionCookieName()}=${created.token}`}});
}
function countSessions(){
  const check=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'));
  const n=Number(check.prepare('SELECT COUNT(*) n FROM sessions').get().n);
  check.close();
  return n;
}
function sessionCookieFor(email){
  const qa=openDb(dataDir);
  const member=qa.prepare('SELECT * FROM members WHERE email=?').get(email);
  const created=createSession(qa,member,{unlockedMs:60*60_000});
  qa.close();
  return `${sessionCookieName()}=${created.token}`;
}
function readOnlySnapshot(){
  const check=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const counts=Object.fromEntries(['members','member_financial_status','sessions','passkeys','otp_codes','push_subscriptions','parking_reservations','study_room_reservations','study_room_waitlist','notification_deliveries','audit_log'].map(table=>[table,Number(check.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)]));
  check.close();return counts;
}
function deepKeys(value,keys=new Set()){
  if(!value||typeof value!=='object')return keys;
  if(Array.isArray(value)){for(const item of value)deepKeys(item,keys);return keys}
  for(const [key,item] of Object.entries(value)){keys.add(key);deepKeys(item,keys)}
  return keys;
}
function assertNoSecrets(value,message){
  const keys=deepKeys(value),forbidden=['pin_hash','pin_salt','code_hash','credential_id','public_key','p256dh','auth','session_secret','otp_secret','token'];
  for(const key of forbidden)assert.equal(keys.has(key),false,`${message}: no debe exponer ${key}`);
}
function otpHash(email,code){
  return crypto.createHash('sha256').update(`${otpSecret}|${email.toLowerCase()}|${code}`).digest('hex');
}
async function freePort(){
  const socket=net.createServer();
  await new Promise((resolve,reject)=>socket.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  return port;
}
async function request(base,route,{body,cookie,method}={}){
  const response=await fetch(`${base}${route}`,{
    method:method||(body===undefined?'GET':'POST'),
    headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  let json={};try{json=await response.json()}catch{}
  return {response,json,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
}
async function waitForHealth(base,child,getLogs=()=> ''){
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw new Error(`Servidor de prueba terminó con código ${child.exitCode}: ${getLogs().trim()}`);
    try{const r=await fetch(`${base}/api/health`);if(r.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Servidor de prueba no respondió a tiempo');
}

let child;
try{
  const db=openDb(dataDir);
  initV050(db,{adminEmail});
  initV060(db);
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at)
    VALUES (?,?,?,?,1,0,?)`).run(memberEmail,'SOCIO AUTH QA',memberRut,'MEMBER',now);
  db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at)
    VALUES (?,?,?,?,1,1,?)`).run(boardOldEmail,'DIRECTORIO AUTH QA',boardRut,'MEMBER',now);
  db.prepare('UPDATE members SET phone=?,employer=? WHERE email=?').run('+56 9 1111 2222','LATAM Airlines',memberEmail);
  const statusFixtures=[
    ['moroso@example.test','SOCIO MOROSO QA','11.111.111-1',1,'MOROSO',3,180000],
    ['congelado@example.test','SOCIO CONGELADO QA','22.222.222-2',1,'CONGELADO',0,0],
    ['desafiliado@example.test','SOCIO DESAFILIADO QA','33.333.333-3',0,'DESAFILIADO',6,360000]
  ];
  for(const [email,name,rut,active,status,months,amount] of statusFixtures){
    const inserted=db.prepare(`INSERT INTO members(email,name,rut,phone,employer,role,active,is_board,updated_at) VALUES (?,?,?,?,?,'MEMBER',?,0,?)`).run(email,name,rut,'+56 9 0000 0000','Empleador QA',active,now);
    db.prepare(`INSERT INTO member_financial_status(member_id,rut,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at,deactivated_by_financial) VALUES (?,?,?,?,?,?,2026,?,?,?)`).run(Number(inserted.lastInsertRowid),rut,status,status,months,amount,now,now,status==='DESAFILIADO'?1:0);
  }
  const morosoFixture=db.prepare('SELECT id FROM members WHERE email=?').get('moroso@example.test'),futureDate=new Date(Date.now()+86400_000).toISOString().slice(0,10),studyStart=new Date(Date.now()+90000_000),studyEnd=new Date(studyStart.getTime()+3600_000);
  db.prepare(`INSERT INTO parking_spaces(id,label,building,board_only,active,sort_order,updated_at) VALUES ('QA-1','QA 1','87',0,1,1,?)`).run(now);
  db.prepare(`INSERT INTO parking_spaces(id,label,building,board_only,active,sort_order,updated_at) VALUES ('QA-BOARD','QA DIRECTORIO','103',1,1,2,?)`).run(now);
  db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,created_at) VALUES (?,'QA-1',?,'ACTIVE',?)`).run(futureDate,morosoFixture.id,now);
  const studyRoom=db.prepare('SELECT id FROM study_rooms ORDER BY id LIMIT 1').get();db.prepare(`INSERT INTO study_room_reservations(room_id,member_id,start_at,end_at,status,created_at) VALUES (?,?,?,?,'ACTIVE',?)`).run(studyRoom.id,morosoFixture.id,studyStart.toISOString(),studyEnd.toISOString(),now);
  db.prepare(`INSERT INTO study_room_waitlist(member_id,room_id,start_at,end_at,status,created_at) VALUES (?,?,?,?,'ACTIVE',?)`).run(morosoFixture.id,studyRoom.id,studyStart.toISOString(),studyEnd.toISOString(),now);
  db.prepare(`INSERT INTO passkeys(credential_id,member_id,webauthn_user_id,public_key,counter,created_at) VALUES ('qa-credential',?,'qa-user',?,0,?)`).run(morosoFixture.id,Buffer.from('qa-public-key'),now);
  db.prepare(`INSERT INTO push_subscriptions(member_id,endpoint,p256dh,auth,topics_json,user_agent,created_at,updated_at,last_error) VALUES (?,?,?,?,?,?,?,?,?)`).run(morosoFixture.id,'https://push.example.test/qa-sensitive-endpoint','qa-sensitive-p256dh','qa-sensitive-auth','[]','QA',now,now,'Fallo QA privado');
  db.prepare(`INSERT INTO notification_deliveries(member_id,notification_key,kind,title,body,status,sent_at,created_at) VALUES (?,?,?,?,?,'SENT',?,?)`).run(morosoFixture.id,'qa-delivery-sent','QA','Título QA','Payload QA',now,now);
  db.prepare(`INSERT INTO notification_deliveries(member_id,notification_key,kind,title,body,status,created_at) VALUES (?,?,?,?,?,'FAILED',?)`).run(morosoFixture.id,'qa-delivery-failed','QA','Título QA privado','Payload QA privado',now);
  const admin=db.prepare('SELECT * FROM members WHERE email=?').get(adminEmail);
  assert.equal(setPin(db,sessionMember(db,admin),adminPin).ok,true,'El PIN ADMIN debe poder configurarse');
  db.prepare('DELETE FROM sessions').run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM members WHERE email LIKE '%demo%' OR email LIKE '%presentacion%'").get().n,0,'No deben sembrarse usuarios demo/presentación');
  db.close();

  const port=await freePort();
  const base=`http://127.0.0.1:${port}`;
  let logs='';
  child=spawn(process.execPath,['--no-warnings','server.mjs'],{
    cwd:root,
    stdio:['ignore','pipe','pipe'],
    env:{
      ...process.env,
      PORT:String(port),SERVER_BIND_ADDRESS:'127.0.0.1',DATA_DIR:dataDir,
      APP_ORIGIN:base,APP_ORIGINS:base,PUBLIC_APP_URL:base,
      SIPA_PHOTOS_DIR:path.join(tmp,'sipa-fotos'),SIPA_PORTRAITS_DIR:path.join(tmp,'sipa-retratos'),
      PROFILE_PHOTOS_DIR:path.join(tmp,'profile-fotos'),BACKUP_DIR:path.join(tmp,'backups'),
      SESSION_SECRET:sessionSecret,OTP_SECRET:otpSecret,ADMIN_EMAIL:adminEmail,
      GOOGLE_ENABLED:'false',GOOGLE_SHEETS_READ:'false',GOOGLE_SHEETS_WRITE:'false',
      GOOGLE_CALENDAR_READ:'false',GOOGLE_CALENDAR_WRITE:'false',GOOGLE_GMAIL_OTP_SEND:'false',
      VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',
      PARKING_SHEET_SYNC:'false',FINANCIAL_XLSM_PATH:path.join(tmp,'missing.xlsm'),
      DEMO_MODE:'true',PRESENTATION_MODE:'true',PRESENTATION_ALLOW_REAL_WRITES:'true',
      PUBLIC_TRIAL_DIRECT_RUTS:memberRut,EMAIL_ONLY_USERS:memberEmail,
      PUBLIC_PREVIEW_RESTRICT_EMAIL_ONLY:'true'
    }
  });
  child.stdout.on('data',chunk=>{logs+=chunk});child.stderr.on('data',chunk=>{logs+=chunk});
  await waitForHealth(base,child,()=>logs);

  for(const route of ['/api/auth/presentation-login','/api/auth/demo-login','/api/auth/quick-login','/api/auth/trial-login']){
    const result=await request(base,route,{body:{profile:'test',email:memberEmail,rut:memberRut}});
    assert.equal(result.response.status,404,`${route} debe responder 404`);
    assert.equal(result.cookie,'',`${route} no debe emitir cookie`);
    assert.equal(countSessions(),0,`${route} no debe crear sesión`);
  }
  for(const route of ['/api/auth/request-code','/api/auth/verify-code']){
    const result=await request(base,route,{body:{email:memberEmail,code:otp}});
    assert.equal(result.response.status,404,`${route} legado debe responder 404`);
    assert.equal(result.cookie,'',`${route} legado no debe emitir cookie`);
  }
  const retiredFinancialUpload=await request(base,'/api/financial-source/upload',{method:'PUT',body:{test:true}});
  assert.equal(retiredFinancialUpload.response.status,403,'La carga XLSM con token debe permanecer deshabilitada');
  assert.equal(fs.existsSync(path.join(tmp,'missing.xlsm')),false,'La ruta XLSM retirada no debe crear ni reemplazar archivos');

  const invalidRut=await request(base,'/api/auth/register/start',{body:{rut:'',email:memberEmail}});
  assert.equal(invalidRut.response.status,400,'La lista email-only obsoleta no debe evitar la validación de RUT');
  assert.equal(countSessions(),0,'Un RUT inválido no debe crear sesión');

  const start=await request(base,'/api/auth/register/start',{body:{rut:memberRut,email:memberEmail}});
  assert.equal(start.response.status,200,'El inicio de registro normal debe funcionar');
  assert.equal(start.json.directAccess,undefined,'El registro normal no debe dar acceso directo');
  assert.equal(start.json.devCode,undefined,'El OTP nunca debe exponerse por API');
  assert.equal(start.cookie,'','Solicitar OTP no debe emitir sesión');
  assert.equal(countSessions(),0,'Solicitar OTP no debe crear sesión');

  const writer=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'));
  const member=writer.prepare('SELECT id FROM members WHERE email=?').get(memberEmail);
  const created=new Date().toISOString(),expires=new Date(Date.now()+600_000).toISOString();
  writer.prepare('INSERT INTO otp_codes(email,member_id,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)')
    .run(memberEmail,member.id,'register_primary',otpHash(memberEmail,otp),expires,created);
  writer.close();

  const verified=await request(base,'/api/auth/register/verify',{body:{rut:memberRut,email:memberEmail,code:otp}});
  assert.equal(verified.response.status,200,'El OTP normal debe verificarse');
  assert.ok(verified.cookie,'El flujo normal debe emitir una sesión solo después del OTP');
  assert.equal(countSessions(),1,'El login normal debe crear exactamente una sesión');

  const pinSet=await request(base,'/api/security/pin',{body:{pin:memberPin},cookie:verified.cookie});
  assert.equal(pinSet.response.status,200,'Debe poder configurarse PIN');
  const locked=await request(base,'/api/security/lock',{body:{},cookie:verified.cookie});
  assert.equal(locked.response.status,200,'Debe poder bloquearse la sesión');
  const unlocked=await request(base,'/api/security/unlock',{body:{pin:memberPin},cookie:verified.cookie});
  assert.equal(unlocked.response.status,200,'El PIN normal debe desbloquear la sesión');
  const firstMe=await request(base,'/api/me',{cookie:verified.cookie});
  assert.equal(firstMe.response.status,200);assert.equal(firstMe.json.uiPreferences.configured,false,'El primer registro debe comenzar con servicios visibles por defecto');assert.equal(firstMe.json.uiPreferences.simpleMode,false);assert.ok(Object.values(firstMe.json.uiPreferences.services).every(Boolean));assert.equal(firstMe.json.modules.activities.enabled,false);assert.equal(firstMe.json.modules.votes.enabled,false);
  const firstPersonalization=await request(base,'/api/profile/services',{method:'PUT',body:{services:{...firstMe.json.uiPreferences.services,library:false,simulators:false},simpleMode:true},cookie:verified.cookie});
  assert.equal(firstPersonalization.response.status,200,'El primer registro debe guardar personalización');assert.equal(firstPersonalization.json.uiPreferences.configured,true);assert.equal(firstPersonalization.json.uiPreferences.simpleMode,true);assert.equal(firstPersonalization.json.uiPreferences.services.library,false);assert.equal(firstPersonalization.json.uiPreferences.services.simulators,false);
  const laterPersonalization=await request(base,'/api/profile/services',{method:'PUT',body:{services:{...firstPersonalization.json.uiPreferences.services,library:true,agenda:false},simpleMode:false},cookie:verified.cookie});
  assert.equal(laterPersonalization.response.status,200,'Perfil debe permitir cambiar la personalización posteriormente');assert.equal(laterPersonalization.json.uiPreferences.simpleMode,false);assert.equal(laterPersonalization.json.uiPreferences.services.library,true);assert.equal(laterPersonalization.json.uiPreferences.services.agenda,false);
  const persistedMe=await request(base,'/api/me',{cookie:verified.cookie});assert.equal(persistedMe.json.uiPreferences.simpleMode,false);assert.equal(persistedMe.json.uiPreferences.services.agenda,false,'La preferencia debe persistir por socio en SQLite');
  const morosoCookie=sessionCookieFor('moroso@example.test'),frozenCookie=sessionCookieFor('congelado@example.test');
  const morosoSimulators=await request(base,'/api/simulators',{cookie:morosoCookie}),frozenSimulators=await request(base,'/api/simulators',{cookie:frozenCookie});
  assert.equal(morosoSimulators.response.status,403);assert.equal(frozenSimulators.response.status,403,'CONGELADO debe tener las mismas restricciones backend que MOROSO');
  assert.equal(morosoSimulators.json.reason,'MOROSO');assert.equal(frozenSimulators.json.reason,'CONGELADO');assert.match(frozenSimulators.json.error,/congelada/i);assert.doesNotMatch(frozenSimulators.json.error,/cuotas pendientes/i);
  const morosoStudy=await request(base,'/api/study-room',{cookie:morosoCookie}),frozenStudy=await request(base,'/api/study-room',{cookie:frozenCookie});
  assert.equal(morosoStudy.response.status,403);assert.equal(frozenStudy.response.status,403);assert.match(frozenStudy.json.error,/congelada/i);
  const morosoParking=await request(base,'/api/parking/reserve',{body:{date:futureDate,spaceId:'QA-1'},cookie:morosoCookie}),frozenParking=await request(base,'/api/parking/reserve',{body:{date:futureDate,spaceId:'QA-1'},cookie:frozenCookie});
  assert.equal(morosoParking.response.status,403);assert.equal(frozenParking.response.status,403);assert.match(frozenParking.json.error,/congelada/i);
  const boardStart=await request(base,'/api/auth/register/start',{body:{rut:boardRut,email:boardNewEmail}});
  assert.equal(boardStart.response.status,200,'Directorio debe poder usar el correo que ingresa');
  assert.equal(boardStart.json.emailChanged,false,'Directorio no debe recibir ni requerir OTP en el correo histórico');
  const boardWriter=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'));
  const boardMember=boardWriter.prepare('SELECT id FROM members WHERE rut=?').get(boardRut);
  const boardPurposes=boardWriter.prepare('SELECT purpose FROM otp_codes WHERE member_id=? AND used_at IS NULL ORDER BY id').all(boardMember.id).map(row=>row.purpose);
  assert.deepEqual(boardPurposes,['register_primary'],'Directorio debe generar un único OTP al correo ingresado');
  boardWriter.prepare('INSERT INTO otp_codes(email,member_id,purpose,code_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)')
    .run(boardNewEmail,boardMember.id,'register_primary',otpHash(boardNewEmail,otp),expires,new Date().toISOString());
  boardWriter.close();
  const boardVerified=await request(base,'/api/auth/register/verify',{body:{rut:boardRut,email:boardNewEmail,code:otp}});
  assert.equal(boardVerified.response.status,200,'El único OTP de Directorio debe completar el acceso');
  assert.ok(boardVerified.cookie,'El OTP de Directorio debe emitir sesión');
  const boardCheck=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const verifiedBoardMember=boardCheck.prepare('SELECT email,active,is_board FROM members WHERE id=?').get(boardMember.id);
  assert.equal(verifiedBoardMember.email,boardNewEmail,'Directorio debe conservar el correo elegido');
  assert.equal(verifiedBoardMember.active,1,'Directorio debe conservar acceso activo');
  assert.equal(verifiedBoardMember.is_board,1,'Directorio debe conservar su marca');
  boardCheck.close();
  const payrollMembership=await request(base,'/api/membership',{cookie:verified.cookie});assert.equal(payrollMembership.response.status,200);assert.equal(payrollMembership.json.paymentMethod,'PAYROLL');assert.equal(payrollMembership.json.transfer,null,'LATAM no debe recibir datos de transferencia');assert.equal(payrollMembership.json.membership.message,'Pago mediante descuento por planilla');
  const employerDb=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'));employerDb.prepare('UPDATE members SET employer=? WHERE id=?').run('Empleador QA',member.id);employerDb.close();
  const transferMembership=await request(base,'/api/membership',{cookie:verified.cookie});assert.equal(transferMembership.response.status,200);assert.equal(transferMembership.json.paymentMethod,'TRANSFER');assert.equal(transferMembership.json.transfer?.configured,true,'Otros empleadores deben conservar transferencia');
  const extraSessionDb=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'));extraSessionDb.prepare('INSERT INTO sessions(token_hash,member_id,expires_at,unlocked_until,created_at) VALUES (?,?,?,?,?)').run('qa-extra-session-hash',member.id,new Date(Date.now()+3600_000).toISOString(),new Date(Date.now()+3600_000).toISOString(),new Date().toISOString());extraSessionDb.close();
  const ownSessions=await request(base,'/api/security/sessions',{cookie:verified.cookie});assert.equal(ownSessions.response.status,200);assert.equal(ownSessions.json.sessions.length,2);assert.equal(ownSessions.json.sessions.filter(x=>x.current).length,1);assertNoSecrets(ownSessions.json,'Sesiones del socio');
  const closeOthers=await request(base,'/api/security/sessions',{method:'DELETE',body:{},cookie:verified.cookie});assert.equal(closeOthers.response.status,200);assert.equal(closeOthers.json.removed,1,'Seguridad debe cerrar otras sesiones sin cerrar la actual');
  const memberDashboard=await request(base,'/api/admin/dashboard',{cookie:verified.cookie});
  assert.equal(memberDashboard.response.status,403,'Un socio normal no puede leer el Dashboard ADMIN');
  const memberDeveloper=await request(base,'/api/admin/overview',{cookie:verified.cookie});
  assert.equal(memberDeveloper.response.status,403,'Un socio normal no puede acceder a los datos de Developer');
  const memberListForbidden=await request(base,'/api/admin/members/list',{cookie:verified.cookie});
  assert.equal(memberListForbidden.response.status,403,'Un socio normal no puede listar socios');
  const memberDetailForbidden=await request(base,'/api/admin/members/1',{cookie:verified.cookie});
  assert.equal(memberDetailForbidden.response.status,403,'Un socio normal no puede abrir fichas de socios');
  const memberActionForbidden=await request(base,'/api/admin/members/1/actions/close-sessions',{body:{confirm:'CERRAR SESIONES'},cookie:verified.cookie});
  assert.equal(memberActionForbidden.response.status,403,'Un socio normal no puede ejecutar acciones administrativas');
  for(const route of ['/api/admin/reservations','/api/admin/notifications','/api/admin/integrations','/api/admin/security','/api/admin/audit','/api/admin/system']){
    const forbidden=await request(base,route,{cookie:verified.cookie});assert.equal(forbidden.response.status,403,`Un socio normal no puede acceder a ${route}`);
  }

  const adminLogin=await request(base,'/api/auth/admin-login',{body:{email:adminEmail,pin:adminPin}});
  assert.equal(adminLogin.response.status,200,'El login ADMIN normal debe funcionar');
  assert.ok(adminLogin.cookie,'El login ADMIN normal debe emitir sesión');
  const informaticaEntry=await fetch(`${base}/informatica`);
  const informaticaHtml=await informaticaEntry.text();
  assert.equal(informaticaEntry.status,200,'La entrada pública /informatica debe estar disponible');
  assert.match(informaticaHtml,/\/app\.js\?v=/,'/informatica debe cargar el script externo compatible con CSP');
  assert.match(informaticaHtml,/admin-mode-switch/,'El panel debe permitir volver a Mi ASPCH con la misma sesión');
  const adminMe=await request(base,'/api/me',{cookie:adminLogin.cookie});
  assert.equal(adminMe.response.status,200,'ADMIN debe poder abrir Mi ASPCH con su sesión normal');
  assert.equal(adminMe.json.member?.role,'ADMIN','La sesión debe conservar el rol ADMIN');
  assert.equal(adminMe.json.member?.isBoard,true,'Informática debe recibir la experiencia efectiva de Directorio');
  const adminParking=await request(base,'/api/parking',{cookie:adminLogin.cookie});
  assert.equal(adminParking.response.status,200,'Informática debe poder abrir Estacionamientos como Directorio');
  assert.equal(adminParking.json.canSeeBoardParking,true,'Informática debe tener acceso efectivo a estacionamientos del Directorio');
  assert.ok(adminParking.json.spaces.some(space=>space.id==='QA-BOARD'&&space.boardOnly),'Informática debe ver los cupos exclusivos del Directorio');
  const adminDashboard=await request(base,'/api/admin/dashboard',{cookie:adminLogin.cookie});
  assert.equal(adminDashboard.response.status,200,'ADMIN debe poder leer el Dashboard');
  assert.equal(adminDashboard.json.health?.status,'CRITICAL','Dashboard debe alertar si falta la fuente XLSM autoritativa');
  assert.equal(adminDashboard.json.health?.ok,false,'Dashboard no debe ocultar una alerta crítica');
  assert.equal(adminDashboard.json.health?.version,'0.6.16','Dashboard debe informar la versión real');
  assert.ok(Number(adminDashboard.json.operational?.bdSocios?.records)>=2,'Dashboard debe usar el snapshot local de socios');
  assert.equal(adminDashboard.json.financial?.mode,'READ_ONLY_DIAGNOSTIC','Dashboard debe leer XLSM solo para diagnóstico');
  assert.deepEqual(adminDashboard.json.financial?.safety,{writesSqlite:false,writesGoogle:false,changesMemberState:false},'La lectura XLSM debe declarar que no escribe ni cambia membresía');
  assert.ok(Array.isArray(adminDashboard.json.audit),'Dashboard debe entregar auditoría resumida');
  assert.equal(adminDashboard.json.audit.some(x=>'detail_json' in x),false,'Dashboard no debe exponer detalle de auditoría');
  assertNoSecrets(adminDashboard.json,'Dashboard ADMIN');
  const adminDeveloper=await request(base,'/api/admin/overview',{cookie:adminLogin.cookie});
  assert.equal(adminDeveloper.response.status,200,'ADMIN debe conservar el acceso de lectura usado por Developer');
  const dashboardMutation=await request(base,'/api/admin/dashboard',{body:{},cookie:adminLogin.cookie});
  assert.equal(dashboardMutation.response.status,404,'Dashboard no debe aceptar mutaciones');
  const adminFinancialUpload=await request(base,'/api/admin/financial-upload',{method:'PUT',body:{test:true},cookie:adminLogin.cookie});
  assert.equal(adminFinancialUpload.response.status,403,'ADMIN tampoco debe poder cargar XLSM desde Control Maestro');

  const adminReservations=await request(base,'/api/admin/reservations',{cookie:adminLogin.cookie});
  assert.equal(adminReservations.response.status,200,'ADMIN debe poder leer Reservas');
  assert.ok(adminReservations.json.summary?.parkingActive>=1,'Reservas debe resumir estacionamientos activos');
  assert.ok(adminReservations.json.study?.active?.length>=1,'Reservas debe listar la Sala de estudios activa');
  assert.ok(adminReservations.json.study?.waitlist?.length>=1,'Reservas debe listar la espera de Sala de estudios');
  assert.equal(adminReservations.json.simulators?.status,'NO_RELIABLE_LOCAL_SOURCE','Reservas no debe inventar una fuente local de simuladores');
  assert.ok(Array.isArray(adminReservations.json.audit),'Reservas debe entregar auditoría acotada');assertNoSecrets(adminReservations.json,'Reservas ADMIN');
  const adminIntegrations=await request(base,'/api/admin/integrations',{cookie:adminLogin.cookie});
  assert.equal(adminIntegrations.response.status,200,'ADMIN debe poder leer Integraciones');
  assert.equal(adminIntegrations.json.externalProbePerformed,false,'Integraciones no debe ejecutar probes de red en cada carga');
  assert.deepEqual(new Set(adminIntegrations.json.items.map(x=>x.label)),new Set(['XLSM Arianna','BD SOCIOS','Google Sheets','Google Calendar','Gmail OTP','Push']),'Integraciones debe cubrir todas las fuentes pedidas');
  assert.ok(adminIntegrations.json.items.every(x=>['OK','ADVERTENCIA','DESHABILITADO','ERROR'].includes(x.status)),'Integraciones debe usar estados controlados');
  for(const id of ['google-sheets','calendar','gmail-otp','push'])assert.equal(adminIntegrations.json.items.find(x=>x.id===id)?.status,'DESHABILITADO',`${id} debe estar deshabilitado en QA`);assertNoSecrets(adminIntegrations.json,'Integraciones ADMIN');
  const adminSystem=await request(base,'/api/admin/system',{cookie:adminLogin.cookie});
  assert.equal(adminSystem.response.status,200,'ADMIN debe poder leer Sistema');
  assert.equal(adminSystem.json.runtime?.version,'0.6.16');assert.match(adminSystem.json.runtime?.node||'',/^v22\./,'Sistema debe informar Node 22');
  assert.equal(adminSystem.json.sqlite?.ok,true,'Sistema debe ejecutar quick_check local');assert.ok(Array.isArray(adminSystem.json.sqlite?.tables)&&adminSystem.json.sqlite.tables.length>10,'Sistema debe inventariar tablas');
  assert.equal(adminSystem.json.container?.sourceAvailable,false,'Sistema no debe inventar estado del contenedor sin fuente segura');assertNoSecrets(adminSystem.json,'Sistema ADMIN');
  const adminNotifications=await request(base,'/api/admin/notifications',{cookie:adminLogin.cookie});
  assert.equal(adminNotifications.response.status,200,'ADMIN debe poder leer Notificaciones');
  assert.equal(adminNotifications.json.push?.status,'DESHABILITADO','Push debe permanecer deshabilitado en QA');assert.equal(adminNotifications.json.gmailOtp?.status,'DESHABILITADO','Gmail OTP debe permanecer deshabilitado en QA');
  assert.equal(adminNotifications.json.push?.subscriptions,1);assert.equal(adminNotifications.json.push?.devicesWithError,1);assert.equal(adminNotifications.json.push?.delivered24h,1);assert.equal(adminNotifications.json.push?.failed24h,1);
  assert.equal(adminNotifications.json.push?.deadCleanupAvailable,false,'No debe inventarse una limpieza Push administrativa');assert.equal(JSON.stringify(adminNotifications.json).includes('qa-sensitive'),false,'Notificaciones no debe exponer endpoints, claves ni payloads');assertNoSecrets(adminNotifications.json,'Notificaciones ADMIN');
  const pushBefore=readOnlySnapshot();
  const invalidPushTemplate=await request(base,'/api/admin/push/send',{body:{template:'texto-libre',audience:'SELF',dryRun:false},cookie:adminLogin.cookie});
  assert.equal(invalidPushTemplate.response.status,400,'Push ADMIN debe aceptar solo plantillas allowlist');
  const pushDryRun=await request(base,'/api/admin/push/send',{body:{template:'parking_reminder',audience:'SELF'},cookie:adminLogin.cookie});
  assert.equal(pushDryRun.response.status,200,'Push ADMIN debe permitir simular el dispositivo propio');
  assert.equal(pushDryRun.json.dryRun,true);assert.equal(pushDryRun.json.audience,'SELF');assert.equal(pushDryRun.json.recipients?.length,1);
  const pushBoardDryRun=await request(base,'/api/admin/push/send',{body:{template:'parking_reminder',audience:'BOARD'},cookie:adminLogin.cookie});
  assert.equal(pushBoardDryRun.response.status,200);assert.equal(pushBoardDryRun.json.audience,'BOARD');assert.ok(Array.isArray(pushBoardDryRun.json.recipients));
  assert.deepEqual(readOnlySnapshot(),pushBefore,'La simulación Push no debe mutar datos ni auditoría');
  const pushSend=await request(base,'/api/admin/push/send',{body:{template:'simulator_reminder',audience:'SELF',dryRun:false},cookie:adminLogin.cookie});
  assert.equal(pushSend.response.status,200,'Push ADMIN debe devolver un resultado controlado');
  assert.equal(pushSend.json.summary?.noSubscription,1,'Sin suscripción debe quedar explícito y no intentar un envío externo en Preview');
  assert.equal(pushSend.json.summary?.failed,0);
  const beforeMemberReads=readOnlySnapshot();
  const adminSecurity=await request(base,'/api/admin/security',{cookie:adminLogin.cookie});
  assert.equal(adminSecurity.response.status,200,'ADMIN debe poder leer Seguridad');assert.equal(adminSecurity.json.admin?.configured,true);assert.equal(adminSecurity.json.admin?.pinConfigured,true);
  assert.equal(adminSecurity.json.attempts?.sourceAvailable,false,'Seguridad debe declarar la ausencia de telemetría persistida de intentos');assert.equal(adminSecurity.json.accountBlocks?.sourceAvailable,false,'Seguridad no debe inventar bloqueos persistidos');
  assert.ok(adminSecurity.json.summary?.passkeys>=1);assert.equal(adminSecurity.json.members.find(x=>x.id===morosoFixture.id)?.emailMasked.includes('moroso@example.test'),false,'Seguridad debe enmascarar emails');assertNoSecrets(adminSecurity.json,'Seguridad ADMIN');
  const adminAudit=await request(base,'/api/admin/audit?limit=25',{cookie:adminLogin.cookie});
  assert.equal(adminAudit.response.status,200,'ADMIN debe poder leer Auditoría');assert.ok(Array.isArray(adminAudit.json.rows));assert.equal(adminAudit.json.rows.some(x=>'detail_json' in x),false,'Auditoría nunca debe exponer detail_json');assertNoSecrets(adminAudit.json,'Auditoría ADMIN');
  const pagedMembers=await request(base,'/api/admin/members/list?page=1&limit=2',{cookie:adminLogin.cookie});
  assert.equal(pagedMembers.response.status,200,'ADMIN debe poder listar socios');
  assert.equal(pagedMembers.json.limit,2,'El listado debe respetar el límite solicitado');
  assert.ok(pagedMembers.json.pages>=2,'El listado debe estar paginado');
  assert.equal('email' in pagedMembers.json.members[0],false,'El listado no debe exponer el email completo');
  assert.equal('rut' in pagedMembers.json.members[0],false,'El listado no debe exponer el RUT completo');
  assert.ok(pagedMembers.json.members[0].emailMasked&&pagedMembers.json.members[0].rutMasked,'El listado debe entregar identificadores enmascarados');
  for(const [query,expected] of [['SOCIO MOROSO','MOROSO'],['11111111','MOROSO'],['moroso@example.test','MOROSO'],['SOCIO AUTH','ACTIVO'],['SOCIO CONGELADO','CONGELADO'],['SOCIO DESAFILIADO','DESAFILIADO']]){
    const result=await request(base,`/api/admin/members/list?q=${encodeURIComponent(query)}`,{cookie:adminLogin.cookie});
    assert.equal(result.response.status,200,`La búsqueda ADMIN debe funcionar para ${query}`);assert.equal(result.json.members[0]?.membershipState,expected,`Estado real esperado para ${query}`);
  }
  const morosoList=await request(base,'/api/admin/members/list?q=moroso%40example.test',{cookie:adminLogin.cookie});const morosoId=morosoList.json.members[0].id;
  const morosoDetail=await request(base,`/api/admin/members/${morosoId}`,{cookie:adminLogin.cookie});
  assert.equal(morosoDetail.response.status,200,'ADMIN debe poder abrir la ficha completa');
  assert.equal(morosoDetail.json.member.email,'moroso@example.test','El detalle debe entregar el email completo solo al abrir la ficha');
  assert.equal(morosoDetail.json.personal.email,'moroso@example.test','BD SOCIOS debe permanecer separado del diagnóstico de membresía');
  assert.equal(morosoDetail.json.member.membershipState,'MOROSO');assert.equal(morosoDetail.json.financial.monthsDue,3);assert.deepEqual(morosoDetail.json.reservations.map(x=>x.type).sort(),['PARKING','STUDY_ROOM']);assert.equal(typeof morosoDetail.json.security.activeSessions,'number');assert.equal(morosoDetail.json.security.passkeys,1);
  assert.equal(morosoDetail.json.realState.sourceReady,false,'Una fuente XLSM ausente debe quedar explícita y no inferirse');
  assert.equal(morosoDetail.json.diagnosis[0]?.code,'XLSM_NO_DISPONIBLE','La ficha debe diagnosticar la fuente ausente');
  assertNoSecrets(morosoDetail.json,'Ficha ADMIN de socio');
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const route of ['/api/admin/members/list',`/api/admin/members/${morosoId}`]){const denied=await request(base,route,{method,body:{},cookie:adminLogin.cookie});assert.ok([404,405].includes(denied.response.status),`${method} ${route} debe responder 404/405`)}
  assert.deepEqual(readOnlySnapshot(),beforeMemberReads,'Las búsquedas, fichas y métodos rechazados no deben escribir ni notificar');

  const parkingId=morosoDetail.json.reservations.find(x=>x.type==='PARKING').id,studyId=morosoDetail.json.reservations.find(x=>x.type==='STUDY_ROOM').id;
  const membershipBefore=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const membershipRowsBefore=membershipBefore.prepare('SELECT m.id,m.active,f.financial_status,f.months_due,f.amount_due FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.id IN (?,?) ORDER BY m.id').all(member.id,morosoId);
  const otpCountBefore=Number(membershipBefore.prepare('SELECT COUNT(*) n FROM otp_codes').get().n);membershipBefore.close();

  const missingConfirmation=await request(base,`/api/admin/members/${morosoId}/actions/release-parking`,{body:{reservationId:parkingId},cookie:adminLogin.cookie});
  assert.equal(missingConfirmation.response.status,400,'Una acción sensible debe exigir confirmación exacta');
  const releaseParking=await request(base,`/api/admin/members/${morosoId}/actions/release-parking`,{body:{reservationId:parkingId,confirm:'LIBERAR RESERVA'},cookie:adminLogin.cookie});
  assert.equal(releaseParking.response.status,200,'ADMIN debe poder liberar estacionamiento');assert.equal(releaseParking.json.changed,1);assertNoSecrets(releaseParking.json,'Liberar estacionamiento');
  const cancelStudy=await request(base,`/api/admin/members/${morosoId}/actions/cancel-study`,{body:{reservationId:studyId,confirm:'CANCELAR RESERVA'},cookie:adminLogin.cookie});
  assert.equal(cancelStudy.response.status,200,'ADMIN debe poder cancelar sala');assert.equal(cancelStudy.json.changed,1);assertNoSecrets(cancelStudy.json,'Cancelar sala');
  const revokePasskeys=await request(base,`/api/admin/members/${morosoId}/actions/revoke-passkeys`,{body:{confirm:'REVOCAR PASSKEYS'},cookie:adminLogin.cookie});
  assert.equal(revokePasskeys.response.status,200,'ADMIN debe poder revocar passkeys');assert.equal(revokePasskeys.json.removed,1);assertNoSecrets(revokePasskeys.json,'Revocar passkeys');
  const closeSessions=await request(base,`/api/admin/members/${member.id}/actions/close-sessions`,{body:{confirm:'CERRAR SESIONES'},cookie:adminLogin.cookie});
  assert.equal(closeSessions.response.status,200,'ADMIN debe poder cerrar sesiones');assert.ok(closeSessions.json.removed>=1);assertNoSecrets(closeSessions.json,'Cerrar sesiones');
  const directPin=await request(base,`/api/admin/members/${member.id}/actions/set-pin`,{body:{pin:'1357'},cookie:adminLogin.cookie});
  assert.equal(directPin.response.status,200,'ADMIN debe poder cambiar PIN directamente sin confirmación');assertNoSecrets(directPin.json,'Cambio directo de PIN');
  const resetPin=await request(base,`/api/admin/members/${member.id}/actions/reset-pin`,{body:{},cookie:adminLogin.cookie});
  assert.equal(resetPin.response.status,200,'ADMIN debe poder resetear PIN directamente sin confirmación');assertNoSecrets(resetPin.json,'Reset PIN');
  const refresh=await request(base,`/api/admin/members/${morosoId}/actions/refresh`,{body:{},cookie:adminLogin.cookie});
  assert.equal(refresh.response.status,200,'ADMIN debe poder refrescar el diagnóstico read-only');assert.equal(refresh.json.realState?.sourceReady,false);assertNoSecrets(refresh.json,'Refrescar diagnóstico');
  const disabledOtp=await request(base,`/api/admin/members/${morosoId}/actions/issue-otp`,{body:{confirm:'GENERAR OTP'},cookie:adminLogin.cookie});
  assert.equal(disabledOtp.response.status,503,'OTP administrativo no debe generarse si la entrega está deshabilitada');assertNoSecrets(disabledOtp.json,'OTP deshabilitado');
  const membershipChange=await request(base,`/api/admin/members/${morosoId}/actions/change-membership`,{body:{status:'ACTIVO'},cookie:adminLogin.cookie});
  assert.equal(membershipChange.response.status,404,'No debe existir una acción manual de membresía');

  const verifiedActions=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const parking=verifiedActions.prepare('SELECT status,cancelled_at FROM parking_reservations WHERE id=?').get(parkingId),study=verifiedActions.prepare('SELECT status,cancelled_at FROM study_room_reservations WHERE id=?').get(studyId);
  assert.equal(parking.status,'CANCELLED');assert.ok(parking.cancelled_at);assert.equal(verifiedActions.prepare("SELECT COUNT(*) n FROM parking_reservations WHERE id=? AND status='ACTIVE'").get(parkingId).n,0,'El estacionamiento liberado no debe seguir activo');
  assert.equal(study.status,'CANCELLED');assert.ok(study.cancelled_at);assert.equal(verifiedActions.prepare("SELECT COUNT(*) n FROM study_room_reservations WHERE id=? AND status='ACTIVE'").get(studyId).n,0,'La sala cancelada no debe seguir activa');
  assert.equal(verifiedActions.prepare('SELECT COUNT(*) n FROM passkeys WHERE member_id=?').get(morosoId).n,0,'Las passkeys revocadas deben desaparecer');
  const resetMember=verifiedActions.prepare('SELECT pin_hash,pin_salt FROM members WHERE id=?').get(member.id);assert.equal(resetMember.pin_hash,null);assert.equal(resetMember.pin_salt,null);assert.equal(verifiedActions.prepare('SELECT COUNT(*) n FROM sessions WHERE member_id=?').get(member.id).n,0,'Reset PIN no debe dejar sesiones del socio');
  assert.equal(verifiedActions.prepare('SELECT COUNT(*) n FROM otp_codes').get().n,otpCountBefore,'OTP deshabilitado no debe crear códigos');
  const membershipRowsAfter=verifiedActions.prepare('SELECT m.id,m.active,f.financial_status,f.months_due,f.amount_due FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.id IN (?,?) ORDER BY m.id').all(member.id,morosoId);assert.deepEqual(membershipRowsAfter,membershipRowsBefore,'Las acciones administrativas no deben cambiar membresía');
  const expectedAudits=['ADMIN_PARKING_RELEASED','ADMIN_STUDY_RESERVATION_CANCELLED','ADMIN_PASSKEYS_REVOKED','ALL_SESSIONS_REVOKED','ADMIN_PIN_CHANGED','ADMIN_PIN_RESET','ADMIN_MEMBER_SOURCE_REFRESHED'];
  const actionAudits=verifiedActions.prepare(`SELECT action,detail_json FROM audit_log WHERE action IN (${expectedAudits.map(()=>'?').join(',')})`).all(...expectedAudits);assert.deepEqual(new Set(actionAudits.map(x=>x.action)),new Set(expectedAudits),'Cada acción completada debe quedar auditada');
  for(const row of actionAudits)assertNoSecrets(row.detail_json?JSON.parse(row.detail_json):{},`Auditoría ${row.action}`);
  const filteredAudit=await request(base,`/api/admin/audit?category=SEGURIDAD&memberId=${member.id}&limit=50`,{cookie:adminLogin.cookie});
  assert.equal(filteredAudit.response.status,200,'Auditoría debe aceptar filtros controlados');assert.ok(filteredAudit.json.rows.length>=2,'El filtro debe recuperar acciones de seguridad del socio');assert.ok(filteredAudit.json.rows.every(x=>x.category==='SEGURIDAD'&&x.subjectId===member.id&&!('detail_json' in x)),'El filtro debe respetar categoría/socio y sanitizar filas');assertNoSecrets(filteredAudit.json,'Auditoría filtrada');
  verifiedActions.close();

  console.log('SELF-CHECK AUTH OK: ADMIN-only/403, Dashboard, ficha diagnóstica, XLSM read-only y acciones auditadas aprobados.');
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  fs.rmSync(tmp,{recursive:true,force:true});
}
