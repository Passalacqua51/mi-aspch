import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.mjs';
import { initV050, financialSummary, benefitAccess, reserveStudyRoom, cancelStudyRoom, studyRoomAvailability, createMarketplaceListing, publicMarketplace, moderateMarketplace, marketplaceOwnerEdit } from '../lib/v050.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-v050-'));
const data=path.join(tmp,'data');fs.mkdirSync(data,{recursive:true});
const db=openDb(data);initV050(db,{adminEmail:'informatica@aspch.org'});
const now=new Date().toISOString();

function rutFor(i){return `${10000000+i}-${i%10}`}
for(let i=0;i<120;i++){
  db.prepare(`INSERT OR IGNORE INTO members(email,name,rut,employer,category,position,role,active,is_board,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(`qa${i}@example.test`,`SOCIO QA ${i}`,rutFor(i),'OLD AIR','Línea Aérea','FO','MEMBER',1,0,now);
}

// Fixture local: el importador XLSM legado está deliberadamente deshabilitado.
for(const [index,status,months,amount] of [[0,'MOROSO',2,30000],[1,'CONGELADO',0,0],[2,'MOROSO',6,90000],[3,'DIRECTORIO',0,0]]){
  const member=db.prepare('SELECT id,rut FROM members WHERE email=?').get(`qa${index}@example.test`);
  db.prepare(`INSERT INTO member_financial_status(member_id,rut,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at,deactivated_by_financial)
    VALUES (?,?,?,?,?,?,?,?,?,0)`).run(member.id,member.rut,status,status,months,amount,2026,now,now);
}
const m0=db.prepare("SELECT * FROM members WHERE email='qa0@example.test'").get();const f0=financialSummary(db,m0);assert.equal(f0.status,'MOROSO');assert.equal(f0.monthsDue,2);assert.equal(f0.amountDue,30000);assert.equal(benefitAccess(db,m0).parking,false);assert.equal(benefitAccess(db,m0).simulatorView,true);assert.equal(benefitAccess(db,m0).studyRoom,false);
const m1=db.prepare("SELECT * FROM members WHERE email='qa1@example.test'").get();assert.equal(financialSummary(db,m1).status,'CONGELADO');assert.equal(financialSummary(db,m1).monthsDue,0);assert.equal(benefitAccess(db,m1).parking,true);
const m2=db.prepare("SELECT * FROM members WHERE email='qa2@example.test'").get();assert.equal(financialSummary(db,m2).status,'MOROSO');assert.equal(db.prepare('SELECT active FROM members WHERE id=?').get(m2.id).active,1);
const m3=db.prepare("SELECT * FROM members WHERE email='qa3@example.test'").get();assert.equal(financialSummary(db,m3).status,'DIRECTORIO');
const m4=db.prepare("SELECT * FROM members WHERE email='qa4@example.test'").get();assert.equal(financialSummary(db,m4).status,'AL_DIA');assert.equal(financialSummary(db,m4).monthsDue,0);assert.equal(benefitAccess(db,m4).parking,true);
assert.equal(db.prepare("SELECT name FROM members WHERE email='qa0@example.test'").get().name,'SOCIO QA 0');

// Sala: 4h permitido, choque prohibido, múltiples bloques no superpuestos permitidos.
const start=new Date(Date.now()+86400_000);start.setUTCMinutes(0,0,0);const end=new Date(start.getTime()+4*3600_000);const id1=reserveStudyRoom(db,{memberId:m1.id,start:start.toISOString(),end:end.toISOString()});assert.ok(id1>0);
let clash=false;try{reserveStudyRoom(db,{memberId:m3.id,start:new Date(start.getTime()+3600_000).toISOString(),end:new Date(start.getTime()+2*3600_000).toISOString()})}catch{clash=true}assert.equal(clash,true);assert.equal(cancelStudyRoom(db,{memberId:m1.id,id:id1}),true);assert.equal(studyRoomAvailability(db,{from:start.toISOString(),to:new Date(end.getTime()+86400_000).toISOString(),memberId:m1.id}).reservations.length,0);

// Mercado: nace PENDING, admin aprueba, edición vuelve a PENDING.
const marketDir=path.join(data,'marketplace');fs.mkdirSync(marketDir,{recursive:true});const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const listing=createMarketplaceListing(db,{memberId:m1.id,title:'Producto QA',description:'Producto de prueba ASPCH',price:25000,contact:'Contacto QA',images:[png],dir:marketDir});assert.ok(listing.id>0);assert.equal(publicMarketplace(db,{memberId:m1.id})[0].status,'PENDING');assert.equal(moderateMarketplace(db,{id:listing.id,status:'ACTIVE'}),true);assert.equal(marketplaceOwnerEdit(db,{memberId:m1.id,id:listing.id,title:'Producto QA editado',description:'Producto de prueba editado',price:26000,contact:'Otro contacto'}),true);assert.equal(publicMarketplace(db,{memberId:m1.id})[0].status,'PENDING');

db.close();fs.rmSync(tmp,{recursive:true,force:true});
console.log('SELF-CHECK v0.5.0 OK: estados locales, MOROSO sin escalamiento, restricciones, Sala y Mercado.');
