import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as _XLSX from 'xlsx';
const XLSX = _XLSX.default || _XLSX;
import { openDb } from '../lib/db.mjs';
import { initV050, syncFinancialWorkbook, financialSummary, benefitAccess, reserveStudyRoom, cancelStudyRoom, studyRoomAvailability, createMarketplaceListing, publicMarketplace, moderateMarketplace, marketplaceOwnerEdit } from '../lib/v050.mjs';
import { initV060, setModuleState, moduleStates, addStudyWaitlist, memberStudyWaitlist, reportMarketplace, marketplaceReports, resolveMarketplaceReport, upsertAgreement, agreements, upsertLibraryItem, libraryItems, toggleLibraryFavorite, setActivityRegistration, activityCenter, setCredentialRevoked, credentialStatus, audit, auditRows, createBackup, backupRuns, adminMemberSearch, createVote, updateVoteDraft, deleteVoteDraft, setVoteStatus, memberVotes, castVote, voteResults } from '../lib/v060.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-v050-'));
const data=path.join(tmp,'data');fs.mkdirSync(data,{recursive:true});
const db=openDb(data);initV050(db,{adminEmail:'informatica@aspch.org'});initV060(db);
const now=new Date().toISOString();

function rutFor(i){return `${10000000+i}-${i%10}`}
for(let i=0;i<120;i++){
  db.prepare(`INSERT OR IGNORE INTO members(email,name,rut,employer,category,position,role,active,is_board,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(`qa${i}@example.test`,`SOCIO QA ${i}`,rutFor(i),'OLD AIR','Línea Aérea','FO','MEMBER',1,0,now);
}

// Hoja con la misma geometría relevante de ESTADO PAGO 2026: encabezados fila 5, bloques M:CR.
const rows=Array.from({length:125},()=>Array(96).fill(null));
rows[4][2]='RUT';rows[4][3]='NOMBRE';rows[4][4]='CARGO';rows[4][5]='INSTITUCION';rows[4][11]='COMENTARIO';
for(let i=0;i<120;i++){
  const r=rows[5+i];r[2]=rutFor(i);r[3]=`NOMBRE MAESTRO ${i}`;r[4]=i%2?'FO':'CPT';r[5]=`AIRLINE ${i%3}`;
  if(i===0)r[11]='MOROSO';
  if(i===1)r[11]='CONGELADO';
  if(i===2)r[11]='MOROSO';
  if(i===3)r[11]='DIRECTORIO';
  // i=4 queda sin comentario financiero: aunque falte Pagado NO debe transformarse
  // automáticamente en MOROSO; el estado oficial lo entrega COMENTARIO.
  for(let m=0;m<12;m++){
    const c=12+m*7;r[c]=15000;r[c+5]=15000;r[c+6]=0;
  }
  // i=0: julio/agosto sin Pagado => moroso 2 meses al 21-agosto-2026.
  if(i===0){r[12+6*7]=null;r[12+7*7]=null}
  // i=1 congelado: todo sin pagar pero exento.
  if(i===1)for(let m=0;m<8;m++)r[12+m*7]=null;
  // i=2: seis meses vencidos => desafiliado.
  if(i===2)for(let m=0;m<6;m++)r[12+m*7]=null;
  if(i===4){r[12+6*7]=null;r[12+7*7]=null}
}
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'ESTADO PAGO 2026');const xlsm=path.join(tmp,'BASE DE DATOS.xlsm');XLSX.writeFile(wb,xlsm,{bookType:'xlsm'});
const sync=syncFinancialWorkbook(db,xlsm,{year:2026,sheetName:'ESTADO PAGO 2026'});
assert.equal(sync.rowsSeen,120);assert.equal(sync.matched,120);
const m0=db.prepare("SELECT * FROM members WHERE email='qa0@example.test'").get();const f0=financialSummary(db,m0);assert.equal(f0.status,'MOROSO');assert.equal(f0.monthsDue,2);assert.equal(f0.amountDue,30000);assert.equal(benefitAccess(db,m0).parking,false);assert.equal(benefitAccess(db,m0).simulatorView,true);assert.equal(benefitAccess(db,m0).studyRoom,false);
const m1=db.prepare("SELECT * FROM members WHERE email='qa1@example.test'").get();assert.equal(financialSummary(db,m1).status,'CONGELADO');assert.equal(financialSummary(db,m1).monthsDue,0);assert.equal(benefitAccess(db,m1).parking,true);
const m2=db.prepare("SELECT * FROM members WHERE email='qa2@example.test'").get();assert.equal(financialSummary(db,m2).status,'DESAFILIADO');assert.equal(db.prepare('SELECT active FROM members WHERE id=?').get(m2.id).active,0);
const m3=db.prepare("SELECT * FROM members WHERE email='qa3@example.test'").get();assert.equal(m3.is_board,1);
const m4=db.prepare("SELECT * FROM members WHERE email='qa4@example.test'").get();assert.equal(financialSummary(db,m4).status,'AL_DIA');assert.equal(financialSummary(db,m4).monthsDue,0);assert.equal(benefitAccess(db,m4).parking,true);
assert.equal(db.prepare("SELECT name FROM members WHERE email='qa0@example.test'").get().name,'NOMBRE MAESTRO 0');

// Sala: 4h permitido, choque prohibido, múltiples bloques no superpuestos permitidos.
const start=new Date(Date.now()+86400_000);start.setUTCMinutes(0,0,0);const end=new Date(start.getTime()+4*3600_000);const id1=reserveStudyRoom(db,{memberId:m1.id,start:start.toISOString(),end:end.toISOString()});assert.ok(id1>0);
let clash=false;try{reserveStudyRoom(db,{memberId:m3.id,start:new Date(start.getTime()+3600_000).toISOString(),end:new Date(start.getTime()+2*3600_000).toISOString()})}catch{clash=true}assert.equal(clash,true);assert.equal(cancelStudyRoom(db,{memberId:m1.id,id:id1}),true);assert.equal(studyRoomAvailability(db,{from:start.toISOString(),to:new Date(end.getTime()+86400_000).toISOString(),memberId:m1.id}).reservations.length,0);

// Mercado: nace PENDING, admin aprueba, edición vuelve a PENDING.
const marketDir=path.join(data,'marketplace');fs.mkdirSync(marketDir,{recursive:true});const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const listing=createMarketplaceListing(db,{memberId:m1.id,title:'Producto QA',description:'Producto de prueba ASPCH',price:25000,contact:'Contacto QA',images:[png],dir:marketDir});assert.ok(listing.id>0);assert.equal(publicMarketplace(db,{memberId:m1.id})[0].status,'PENDING');assert.equal(moderateMarketplace(db,{id:listing.id,status:'ACTIVE'}),true);assert.equal(marketplaceOwnerEdit(db,{memberId:m1.id,id:listing.id,title:'Producto QA editado',description:'Producto de prueba editado',price:26000,contact:'Otro contacto'}),true);assert.equal(publicMarketplace(db,{memberId:m1.id})[0].status,'PENDING');


// v0.6.0: mantenimiento por módulo.
assert.equal(moduleStates(db).parking.enabled,true);assert.equal(setModuleState(db,{module:'parking',enabled:false,message:'QA'}),true);assert.equal(moduleStates(db).parking.enabled,false);setModuleState(db,{module:'parking',enabled:true});
// Lista de espera sala: notify-only, no reserva automática.
const ws=new Date(Date.now()+3*86400_000);ws.setUTCMinutes(0,0,0);const we=new Date(ws.getTime()+2*3600_000);const wid=addStudyWaitlist(db,{memberId:m1.id,start:ws.toISOString(),end:we.toISOString()});assert.ok(wid>0);assert.equal(memberStudyWaitlist(db,m1.id).length,1);
// Mercado: reportes moderables.
moderateMarketplace(db,{id:listing.id,status:'ACTIVE'});const rid=reportMarketplace(db,{memberId:m3.id,listingId:listing.id,reason:'Prueba de reporte'});assert.ok(rid>0);assert.equal(marketplaceReports(db).filter(x=>x.status==='OPEN').length,1);assert.equal(resolveMarketplaceReport(db,{id:rid,actorId:m3.id,status:'RESOLVED',note:'OK'}),true);
// Convenios y biblioteca nativos.
const aid=upsertAgreement(db,{title:'Convenio QA',description:'Prueba',benefit:'10%',url:'https://aspch.org/convenios/'});assert.ok(aid>0);assert.ok(agreements(db,{admin:true}).some(x=>x.id===aid));
const lid=upsertLibraryItem(db,{category:'QA',title:'Documento QA',url:'https://aspch.org/estatutos/',source:'ASPCH'});assert.ok(lid>0);assert.equal(toggleLibraryFavorite(db,{memberId:m1.id,itemId:lid,favorite:true}),true);assert.equal(libraryItems(db,{memberId:m1.id}).find(x=>x.id===lid).favorite,true);
// Centro de actividades sin certificados.
const act=db.prepare("SELECT id FROM activities ORDER BY id DESC LIMIT 1").get();if(act){assert.equal(setActivityRegistration(db,{memberId:m1.id,activityId:act.id,registered:true}),true);assert.equal(activityCenter(db,m1.id).find(x=>x.id===act.id).registered,true)}
// Credencial revocable y auditoría.
setCredentialRevoked(db,{memberId:m1.id,revoked:true,reason:'QA',actorId:m3.id});assert.equal(credentialStatus(db,m1.id).revoked,true);setCredentialRevoked(db,{memberId:m1.id,revoked:false,actorId:m3.id});assert.equal(credentialStatus(db,m1.id).revoked,false);audit(db,{actorId:m3.id,subjectId:m1.id,action:'QA_AUDIT'});assert.ok(auditRows(db,{memberId:m1.id}).length>=1);
// Inspector y backups.
assert.ok(adminMemberSearch(db,'qa1').some(x=>x.id===m1.id));const backupDir=path.join(tmp,'backups');const br=createBackup(db,{backupDir,retention:3,actorId:m3.id});assert.equal(br.ok,true);assert.ok(fs.existsSync(path.join(backupDir,br.fileName)));assert.ok(backupRuns(db).length>=1);

// Borrador de votación editable y eliminable antes de abrir.
const tmpVote=createVote(db,{title:'Borrador temporal',secrecy:'SECRET',eligibilityRule:'ACTIVE_ALL',options:['A','B'],actorId:m3.id});updateVoteDraft(db,{id:tmpVote,title:'Borrador corregido',description:'QA',secrecy:'IDENTIFIED',eligibilityRule:'AL_DIA_ONLY',options:['1','2','3'],actorId:m3.id});assert.equal(db.prepare('SELECT title FROM vote_elections WHERE id=?').get(tmpVote).title,'Borrador corregido');assert.equal(deleteVoteDraft(db,{id:tmpVote,actorId:m3.id}),true);

// Votaciones completas: secreto sin voter_member_id, recibo, voto único, resultados y cierre irreversible.
const voteId=createVote(db,{title:'¿Aprobar prueba?',description:'QA',secrecy:'SECRET',eligibilityRule:'ACTIVE_ALL',options:['Sí','No'],actorId:m3.id});const openedVote=setVoteStatus(db,{id:voteId,status:'OPEN',actorId:m3.id});assert.ok(openedVote.eligible>=100);const voteOpts=db.prepare('SELECT id FROM vote_options WHERE election_id=? ORDER BY id').all(voteId);const casted=castVote(db,{electionId:voteId,memberId:m1.id,optionId:voteOpts[0].id});assert.ok(casted.receipt);assert.equal(db.prepare('SELECT voter_member_id FROM vote_ballots WHERE election_id=?').get(voteId).voter_member_id,null);assert.equal(memberVotes(db,m1.id).find(v=>v.id===voteId).voted,true);let dupVote=false;try{castVote(db,{electionId:voteId,memberId:m1.id,optionId:voteOpts[1].id})}catch{dupVote=true}assert.equal(dupVote,true);setVoteStatus(db,{id:voteId,status:'CLOSED',actorId:m3.id});assert.equal(voteResults(db,voteId).participation,1);let badReopen=false;try{setVoteStatus(db,{id:voteId,status:'OPEN',actorId:m3.id})}catch{badReopen=true}assert.equal(badReopen,true);setVoteStatus(db,{id:voteId,status:'ARCHIVED',actorId:m3.id});

db.close();fs.rmSync(tmp,{recursive:true,force:true});
console.log('SELF-CHECK v0.6.0 OK: v0.5 + reservas/finanzas, mantenimiento, espera sala, reportes, convenios, biblioteca, actividades, credencial, auditoría, inspector, backups y votaciones.');
