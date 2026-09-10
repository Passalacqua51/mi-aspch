import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../lib/db.mjs';
import { initV050 } from '../lib/v050.mjs';
import { initV060 } from '../lib/v060.mjs';
import { createSession, sessionCookieName, memberFromRequest, setPin } from '../lib/auth.mjs';

const root=path.resolve(import.meta.dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-parking-'));
const dataDir=path.join(tmp,'data');
const adminEmail='admin@example.test';
const adminPin='8642';
const sessionSecret='parking-self-check-secret';
process.env.OTP_SECRET='otp-secret';
process.env.SESSION_SECRET=sessionSecret;

function sessionMember(db,member){const created=createSession(db,member);return memberFromRequest(db,{headers:{cookie:`${sessionCookieName()}=${created.token}`}});}
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
async function waitForHealth(base,child){
  for(let i=0;i<80;i++){
    if(child.exitCode!==null)throw new Error(`Servidor de prueba terminó con código ${child.exitCode}`);
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
  const memberInsert=db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,1,0,?)`).run('socio@example.test','SOCIO PARKING QA','11.222.333-4','MEMBER',now);
  const admin=db.prepare('SELECT * FROM members WHERE email=?').get(adminEmail);
  assert.equal(setPin(db,sessionMember(db,admin),adminPin).ok,true,'PIN ADMIN debe configurarse');
  const future=new Date(Date.now()+86400*1000).toISOString().slice(0,10);
  const today=new Date().toISOString().slice(0,10);
  db.prepare(`INSERT INTO parking_spaces(id,label,building,board_only,active,sort_order,updated_at) VALUES ('QA-1','QA 1','87',0,1,1,?)`).run(now);
  db.prepare(`INSERT INTO parking_spaces(id,label,building,board_only,active,sort_order,updated_at) VALUES ('QA-2','QA 2','87',0,1,2,?)`).run(now);
  db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,source,created_at) VALUES (?,'QA-1',?,'ACTIVE','SHEET',?)`).run(today,memberInsert.lastInsertRowid,now);
  db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,source,created_at) VALUES (?,'QA-2',?,'ACTIVE','SHEET',?)`).run(future,memberInsert.lastInsertRowid,now);
  db.prepare('DELETE FROM sessions').run();
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
      SESSION_SECRET:sessionSecret,OTP_SECRET:'otp-secret',ADMIN_EMAIL:adminEmail,
      GOOGLE_ENABLED:'false',GOOGLE_SHEETS_READ:'false',GOOGLE_SHEETS_WRITE:'false',
      GOOGLE_CALENDAR_READ:'false',GOOGLE_CALENDAR_WRITE:'false',GOOGLE_GMAIL_OTP_SEND:'false',
      VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',
      PARKING_SHEET_SYNC:'false',FINANCIAL_XLSM_PATH:path.join(tmp,'missing.xlsm')
    }
  });
  child.stdout.on('data',chunk=>{logs+=chunk});child.stderr.on('data',chunk=>{logs+=chunk});
  await waitForHealth(base,child);

  const adminLogin=await request(base,'/api/auth/admin-login',{body:{email:adminEmail,pin:adminPin}});
  assert.equal(adminLogin.response.status,200,'El login ADMIN normal debe funcionar');
  assert.ok(adminLogin.cookie,'El login ADMIN normal debe emitir sesión');
  const cookie=adminLogin.cookie;

  const snap=await request(base,'/api/admin/reservations',{cookie});
  assert.equal(snap.response.status,200,'ADMIN debe poder leer /api/admin/reservations (panel Estacionamientos)');
  assert.ok(Array.isArray(snap.json.parking?.active)&&snap.json.parking.active.length>=2,'El panel debe listar reservas activas');
  const hoyRow=snap.json.parking.active.find(r=>r.reservationDate===today&&r.spaceId==='QA-1');
  assert.ok(hoyRow,'Debe existir una reserva activa de hoy para QA-1');
  const futRow=snap.json.parking.active.find(r=>r.reservationDate===future&&r.spaceId==='QA-2');
  assert.ok(futRow,'Debe existir una reserva activa futura para QA-2');

  const before=snap.json.summary.parkingActive;

  const missingConfirm=await request(base,'/api/admin/parking/release',{method:'POST',body:{date:today,spaceId:'QA-1'},cookie});
  assert.equal(missingConfirm.response.status,400,'Una liberación debe exigir confirmación exacta LIBERAR RESERVA');
  assert.equal(missingConfirm.json.error,'Confirmación requerida: LIBERAR RESERVA');

  const missingDate=await request(base,'/api/admin/parking/release',{method:'POST',body:{date:'',spaceId:'QA-1',confirm:'LIBERAR RESERVA'},cookie});
  assert.equal(missingDate.response.status,400,'Fecha y estacionamiento deben ser obligatorios');

  const release=await request(base,'/api/admin/parking/release',{method:'POST',body:{date:today,spaceId:'QA-1',confirm:'LIBERAR RESERVA'},cookie});
  assert.equal(release.response.status,200,'El panel Estacionamientos debe poder liberar un estacionamiento');
  assert.equal(release.json.changed,1,'La liberación debe afectar 1 reserva local ACTIVE');
  assert.equal(release.json.externalWrites,false,'Sin Google habilitado no debe declarar escrituras externas');

  const member=await request(base,'/api/admin/reservations',{cookie});
  assert.equal(member.response.status,200,'El panel debe poder releerse tras liberar');
  assert.equal(member.json.summary.parkingActive,before-1,'La reserva liberada debe desaparecer de las activas');
  assert.equal(member.json.parking.active.some(r=>r.spaceId==='QA-1'&&r.reservationDate===today),false,'La reserva de hoy liberada no debe seguir en reservas activas');
  assert.ok(member.json.parking.active.some(r=>r.spaceId==='QA-2'&&r.reservationDate===future),'La reserva futura aislada debe seguir activa');
  const spaceRow=member.json.parking.spaces.find(s=>s.id==='QA-1');
  assert.ok(spaceRow&&spaceRow.occupied===false,'El cupo QA-1 debe reflejarse Libre tras liberar');

  const verify=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const row=verify.prepare("SELECT status,vacated_at FROM parking_reservations WHERE space_id='QA-1' AND reservation_date=?").get(today);
  assert.ok(row&&row.status==='VACATED','La reserva liberada debe quedar VACATED en SQLite');
  assert.ok(row.vacated_at,'La reserva liberada debe registrar vacated_at');
  const auditRow=verify.prepare("SELECT action,actor_member_id,subject_member_id FROM audit_log WHERE action='ADMIN_PARKING_RELEASED' ORDER BY id DESC LIMIT 1").get();
  assert.ok(auditRow,'La liberación debe quedar registrada en Auditoría');
  assert.equal(auditRow.action,'ADMIN_PARKING_RELEASED');
  assert.equal(auditRow.actor_member_id,admin.id,'La Auditoría debe registrar quién liberó (ADMIN)');
  verify.close();

  const locked=await request(base,'/api/admin/parking/release',{method:'POST',body:{date:today,spaceId:'QA-1',confirm:'LIBERAR RESERVA'}});
  assert.ok([401,403].includes(locked.response.status),'Un cliente sin sesión ADMIN no debe poder liberar');

  console.log('SELF-CHECK ADMIN PARKING RELEASE OK: panel Estacionamientos libera reserva, cupo Libre, desaparece de activas, VACATED y auditado.');
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  fs.rmSync(tmp,{recursive:true,force:true});
}