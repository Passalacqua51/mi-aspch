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
async function request(base,route,{body,cookie}={}){
  const response=await fetch(`${base}${route}`,{
    method:body===undefined?'GET':'POST',
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

  const adminLogin=await request(base,'/api/auth/admin-login',{body:{email:adminEmail,pin:adminPin}});
  assert.equal(adminLogin.response.status,200,'El login ADMIN normal debe funcionar');
  assert.ok(adminLogin.cookie,'El login ADMIN normal debe emitir sesión');

  console.log('SELF-CHECK AUTH OK: rutas retiradas 404 sin sesión; RUT+OTP, PIN y ADMIN normales aprobados.');
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  fs.rmSync(tmp,{recursive:true,force:true});
}
