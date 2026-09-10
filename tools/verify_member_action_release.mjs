import assert from 'node:assert/strict';
import fs from 'node:fs';import net from 'node:net';import os from 'node:os';import path from 'node:path';import { spawn } from 'node:child_process';import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../lib/db.mjs';import { initV050 } from '../lib/v050.mjs';import { initV060 } from '../lib/v060.mjs';import { createSession, sessionCookieName, memberFromRequest, setPin } from '../lib/auth.mjs';
const root=path.resolve(import.meta.dirname,'..');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-memberaction-'));
const dataDir=path.join(tmp,'data');const adminEmail='admin@example.test';const adminPin='8642';const sessionSecret='m-x';
process.env.OTP_SECRET='o';process.env.SESSION_SECRET=sessionSecret;
function sessionMember(db,m){const c=createSession(db,m);return memberFromRequest(db,{headers:{cookie:`${sessionCookieName()}=${c.token}`}})}
async function freePort(){const s=net.createServer();await new Promise((r,j)=>s.once('error',j).listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
async function request(base,route,{body,cookie,method}={}){const response=await fetch(`${base}${route}`,{method:method||(body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});let json={};try{json=await response.json()}catch{}return{response,json}}
async function waitForHealth(base,child){for(let i=0;i<80;i++){if(child.exitCode!==null)throw new Error(`servidor ${child.exitCode}`);try{if((await fetch(`${base}/api/health`)).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw new Error('no health')}
let child;
try{
  const db=openDb(dataDir);initV050(db,{adminEmail});initV060(db);
  const now=new Date().toISOString();
  const memberId=db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,1,0,?)`).run('socio@example.test','SOCIO','11.222.333-4','MEMBER',now).lastInsertRowid;
  const morosoId=db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,1,0,?)`).run('moroso@example.test','MOROSO','22.333.444-5','MEMBER',now).lastInsertRowid;
  const admin=db.prepare('SELECT * FROM members WHERE email=?').get(adminEmail);assert.equal(setPin(db,sessionMember(db,admin),adminPin).ok,true);
  const today=new Date().toISOString().slice(0,10);
  db.prepare(`INSERT INTO parking_spaces(id,label,building,board_only,active,sort_order,updated_at) VALUES ('QA-1','QA 1','87',0,1,1,?)`).run(now);
  const parkingId=db.prepare(`INSERT INTO parking_reservations(reservation_date,space_id,member_id,status,source,created_at) VALUES (?,'QA-1',?,'ACTIVE','SHEET',?)`).run(today,morosoId,now).lastInsertRowid;
  db.prepare('DELETE FROM sessions').run();db.close();
  const port=await freePort();const base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['--no-warnings','server.mjs'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),SERVER_BIND_ADDRESS:'127.0.0.1',DATA_DIR:dataDir,APP_ORIGIN:base,APP_ORIGINS:base,PUBLIC_APP_URL:base,SIPA_PHOTOS_DIR:path.join(tmp,'a'),SIPA_PORTRAITS_DIR:path.join(tmp,'b'),PROFILE_PHOTOS_DIR:path.join(tmp,'c'),BACKUP_DIR:path.join(tmp,'d'),SESSION_SECRET:sessionSecret,OTP_SECRET:'o',ADMIN_EMAIL:adminEmail,GOOGLE_ENABLED:'false',GOOGLE_SHEETS_READ:'false',GOOGLE_SHEETS_WRITE:'false',GOOGLE_CALENDAR_READ:'false',GOOGLE_CALENDAR_WRITE:'false',GOOGLE_GMAIL_OTP_SEND:'false',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:'',PARKING_SHEET_SYNC:'false',FINANCIAL_XLSM_PATH:path.join(tmp,'x')}});
  await waitForHealth(base,child);
  const login=await request(base,'/api/auth/admin-login',{body:{email:adminEmail,pin:adminPin}});assert.equal(login.response.status,200);
  const cookie=login.response.headers.get('set-cookie')?.split(';')[0]||'';
  const r=await request(base,`/api/admin/members/${morosoId}/actions/release-parking`,{body:{reservationId:parkingId,confirm:'LIBERAR RESERVA'},cookie});
  assert.equal(r.response.status,200,'release-parking por ficha de socio debe responder 200');
  assert.equal(r.json.changed,1,'release-parking debe cambiar 1 reserva local');
  const db2=new DatabaseSync(path.join(dataDir,'mi-aspch.sqlite'),{readOnly:true});
  const row=db2.prepare('SELECT status,vacated_at FROM parking_reservations WHERE id=?').get(parkingId);db2.close();
  assert.equal(row.status,'VACATED','release-parking (ficha socio) debe dejar VACATED');
  assert.ok(row.vacated_at,'release-parking (ficha socio) debe registrar vacated_at');
  console.log('OK: ruta ficha de socio (self_check_auth:371) libera -> changed=1, VACATED, vacated_at. Alineado con la afirmación actualizada.');
}finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}fs.rmSync(tmp,{recursive:true,force:true})}