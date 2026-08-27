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
import { createSession, memberFromRequest, setPin } from '../lib/auth.mjs';

const root=path.resolve(import.meta.dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-auth-'));
const dataDir=path.join(tmp,'data');
const memberEmail='member@example.test';
const memberRut='12.345.678-5';
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
  return memberFromRequest(db,{headers:{cookie:`mi_aspch_session=${created.token}`}});
}
function countSessions(){
  const check=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'));
  const n=Number(check.prepare('SELECT COUNT(*) n FROM sessions').get().n);
  check.close();
  return n;
}
function readOnlySnapshot(){
  const check=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const counts=Object.fromEntries(['members','member_financial_status','sessions','passkeys','parking_reservations','study_room_reservations','notification_deliveries','audit_log'].map(table=>[table,Number(check.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)]));
  check.close();return counts;
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
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at)
    VALUES (?,?,?,?,1,0,?)`).run(memberEmail,'SOCIO AUTH QA',memberRut,'MEMBER',now);
  db.prepare('UPDATE members SET phone=?,employer=? WHERE email=?').run('+56 9 1111 2222','Aerolínea QA',memberEmail);
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
  db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,created_at) VALUES (?,'QA-1',?,'ACTIVE',?)`).run(futureDate,morosoFixture.id,now);
  const studyRoom=db.prepare('SELECT id FROM study_rooms ORDER BY id LIMIT 1').get();db.prepare(`INSERT INTO study_room_reservations(room_id,member_id,start_at,end_at,status,created_at) VALUES (?,?,?,?,'ACTIVE',?)`).run(studyRoom.id,morosoFixture.id,studyStart.toISOString(),studyEnd.toISOString(),now);
  db.prepare(`INSERT INTO passkeys(credential_id,member_id,webauthn_user_id,public_key,counter,created_at) VALUES ('qa-credential',?,'qa-user',?,0,?)`).run(morosoFixture.id,Buffer.from('qa-public-key'),now);
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
  const memberDashboard=await request(base,'/api/admin/dashboard',{cookie:verified.cookie});
  assert.equal(memberDashboard.response.status,403,'Un socio normal no puede leer el Dashboard ADMIN');
  const memberDeveloper=await request(base,'/api/admin/overview',{cookie:verified.cookie});
  assert.equal(memberDeveloper.response.status,403,'Un socio normal no puede acceder a los datos de Developer');
  const memberListForbidden=await request(base,'/api/admin/members/list',{cookie:verified.cookie});
  assert.equal(memberListForbidden.response.status,403,'Un socio normal no puede listar socios');
  const memberDetailForbidden=await request(base,'/api/admin/members/1',{cookie:verified.cookie});
  assert.equal(memberDetailForbidden.response.status,403,'Un socio normal no puede abrir fichas de socios');

  const adminLogin=await request(base,'/api/auth/admin-login',{body:{email:adminEmail,pin:adminPin}});
  assert.equal(adminLogin.response.status,200,'El login ADMIN normal debe funcionar');
  assert.ok(adminLogin.cookie,'El login ADMIN normal debe emitir sesión');
  const adminDashboard=await request(base,'/api/admin/dashboard',{cookie:adminLogin.cookie});
  assert.equal(adminDashboard.response.status,200,'ADMIN debe poder leer el Dashboard');
  assert.equal(adminDashboard.json.health?.ok,true,'Dashboard debe informar health operativo');
  assert.equal(adminDashboard.json.health?.version,'0.6.16','Dashboard debe informar la versión real');
  assert.ok(Number(adminDashboard.json.metrics?.members?.total)>=2,'Dashboard debe usar socios existentes');
  assert.ok(Array.isArray(adminDashboard.json.audit),'Dashboard debe entregar auditoría resumida');
  assert.equal(adminDashboard.json.audit.some(x=>'detail_json' in x),false,'Dashboard no debe exponer detalle de auditoría');
  const adminDeveloper=await request(base,'/api/admin/overview',{cookie:adminLogin.cookie});
  assert.equal(adminDeveloper.response.status,200,'ADMIN debe conservar el acceso de lectura usado por Developer');
  const dashboardMutation=await request(base,'/api/admin/dashboard',{body:{},cookie:adminLogin.cookie});
  assert.equal(dashboardMutation.response.status,404,'Dashboard no debe aceptar mutaciones');

  const beforeMemberReads=readOnlySnapshot();
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
  assert.equal(morosoDetail.json.member.membershipState,'MOROSO');assert.equal(morosoDetail.json.financial.monthsDue,3);assert.deepEqual(morosoDetail.json.reservations.map(x=>x.type).sort(),['PARKING','STUDY_ROOM']);assert.equal(typeof morosoDetail.json.security.activeSessions,'number');assert.equal(morosoDetail.json.security.passkeys,1);
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const route of ['/api/admin/members/list',`/api/admin/members/${morosoId}`]){const denied=await request(base,route,{method,body:{},cookie:adminLogin.cookie});assert.ok([404,405].includes(denied.response.status),`${method} ${route} debe responder 404/405`)}
  assert.deepEqual(readOnlySnapshot(),beforeMemberReads,'Las búsquedas, fichas y métodos rechazados no deben escribir ni notificar');

  console.log('SELF-CHECK AUTH OK: rutas retiradas 404; RUT+OTP, PIN y ADMIN aprobados; Dashboard y Socios protegidos y de solo lectura.');
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  fs.rmSync(tmp,{recursive:true,force:true});
}
