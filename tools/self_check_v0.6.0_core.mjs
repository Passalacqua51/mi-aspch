import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openDb} from '../lib/db.mjs';
import {initV060,setModuleState,moduleStates,addStudyWaitlist,memberStudyWaitlist,reportMarketplace,marketplaceReports,resolveMarketplaceReport,upsertAgreement,agreements,upsertLibraryItem,libraryItems,toggleLibraryFavorite,setActivityRegistration,activityCenter,setCredentialRevoked,credentialStatus,audit,auditRows,createBackup,backupRuns,adminMemberSearch,adminMembersList,adminMemberDetail,systemMetrics,createVote,updateVoteDraft,deleteVoteDraft,setVoteStatus,memberVotes,castVote,voteResults} from '../lib/v060.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mi-aspch-v060-core-'));const data=path.join(tmp,'data');const db=openDb(data);const now=new Date().toISOString();
// Pre-requisitos creados por v0.5.0 en producción.
db.exec(`
CREATE TABLE IF NOT EXISTS member_financial_status(member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,rut TEXT,source_status TEXT,financial_status TEXT,months_due INTEGER DEFAULT 0,amount_due INTEGER DEFAULT 0,source_year INTEGER,source_updated_at TEXT,synced_at TEXT,deactivated_by_financial INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS push_subscriptions(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,endpoint TEXT UNIQUE,p256dh TEXT,auth TEXT);
CREATE TABLE IF NOT EXISTS notification_deliveries(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER,notification_key TEXT UNIQUE,kind TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS study_rooms(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,active INTEGER DEFAULT 1,created_at TEXT);
CREATE TABLE IF NOT EXISTS study_room_reservations(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id INTEGER,member_id INTEGER,start_at TEXT,end_at TEXT,status TEXT DEFAULT 'ACTIVE',created_at TEXT,cancelled_at TEXT);
CREATE TABLE IF NOT EXISTS marketplace_listings(id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER,title TEXT,description TEXT,price INTEGER,contact TEXT,status TEXT DEFAULT 'PENDING',created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,title TEXT,description TEXT,starts_at TEXT,ends_at TEXT,registration_open_at TEXT,registration_close_at TEXT,external_url TEXT,status TEXT DEFAULT 'ACTIVE',created_at TEXT,updated_at TEXT);
`);
db.prepare(`INSERT INTO study_rooms(name,active,created_at) VALUES ('Sala de estudios',1,?)`).run(now);
for(let i=1;i<=3;i++)db.prepare(`INSERT INTO members(email,name,rut,role,active,is_board,updated_at) VALUES (?,?,?,?,1,0,?)`).run(`core${i}@example.test`,`CORE ${i}`,`1000000${i}-${i}`,'MEMBER',now);
const m1=db.prepare(`SELECT * FROM members WHERE email='core1@example.test'`).get(),m2=db.prepare(`SELECT * FROM members WHERE email='core2@example.test'`).get();
db.prepare(`INSERT INTO member_financial_status(member_id,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at) VALUES (?,'MOROSO','MOROSO',2,30000,2026,?,?)`).run(m1.id,now,now);
initV060(db);
assert.equal(moduleStates(db).parking.enabled,true);setModuleState(db,{module:'parking',enabled:false,message:'QA',actorId:m2.id});assert.equal(moduleStates(db).parking.enabled,false);setModuleState(db,{module:'parking',enabled:true,actorId:m2.id});
const st=new Date(Date.now()+86400000),en=new Date(st.getTime()+3600000);const wid=addStudyWaitlist(db,{memberId:m1.id,start:st.toISOString(),end:en.toISOString()});assert.ok(wid);assert.equal(memberStudyWaitlist(db,m1.id).length,1);
const l=db.prepare(`INSERT INTO marketplace_listings(member_id,title,description,price,contact,status,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?)`).run(m1.id,'Producto','Desc',1000,'Contacto',now,now);const rep=reportMarketplace(db,{listingId:Number(l.lastInsertRowid),memberId:m2.id,reason:'Contenido incorrecto'});assert.ok(rep);assert.equal(marketplaceReports(db)[0].status,'OPEN');assert.equal(resolveMarketplaceReport(db,{id:rep,actorId:m2.id,status:'RESOLVED'}),true);
const ag=upsertAgreement(db,{title:'QA',url:'https://aspch.org/convenios/',actorId:m2.id});assert.ok(agreements(db,{admin:true}).some(x=>x.id===ag));
const li=upsertLibraryItem(db,{title:'Doc QA',url:'https://aspch.org/estatutos/',actorId:m2.id});toggleLibraryFavorite(db,{memberId:m1.id,itemId:li,favorite:true});assert.equal(libraryItems(db,{memberId:m1.id}).find(x=>x.id===li).favorite,true);
const ar=db.prepare(`INSERT INTO activities(type,title,external_url,status,created_at,updated_at) VALUES ('TALK','Charla QA','https://forms.gle/example','ACTIVE',?,?)`).run(now,now);assert.equal(setActivityRegistration(db,{memberId:m1.id,activityId:Number(ar.lastInsertRowid),registered:true}),true);assert.equal(activityCenter(db,m1.id)[0].registered,true);
setCredentialRevoked(db,{memberId:m1.id,revoked:true,reason:'QA',actorId:m2.id});assert.equal(credentialStatus(db,m1.id).revoked,true);setCredentialRevoked(db,{memberId:m1.id,revoked:false,actorId:m2.id});
audit(db,{actorId:m2.id,subjectId:m1.id,action:'CORE_TEST'});assert.ok(auditRows(db,{memberId:m1.id}).length>0);assert.equal(adminMemberSearch(db,'core1')[0].financial_status,'MOROSO');
const memberPage=adminMembersList(db,{query:'core',page:2,limit:1});assert.equal(memberPage.total,3);assert.equal(memberPage.pages,3);assert.equal(memberPage.page,2);assert.equal('email' in memberPage.members[0],false);assert.equal('rut' in memberPage.members[0],false);assert.ok(memberPage.members[0].emailMasked);assert.ok(memberPage.members[0].rutMasked);
const memberDetail=adminMemberDetail(db,m1.id);assert.equal(memberDetail.member.email,m1.email);assert.equal(memberDetail.member.membershipState,'MOROSO');assert.equal(memberDetail.financial.monthsDue,2);assert.equal(memberDetail.security.activeSessions,0);assert.equal(memberDetail.security.passkeys,0);assert.ok(Array.isArray(memberDetail.reservations));
const backupDir=path.join(data,'backups');const b=createBackup(db,{backupDir,retention:3,actorId:m2.id});assert.equal(b.ok,true);assert.ok(fs.existsSync(path.join(backupDir,b.fileName)));assert.ok(backupRuns(db).length>0);assert.ok(systemMetrics(db).members.total>=3);
// Borrador editable/eliminable antes de congelar padrón.
const draftId=createVote(db,{title:'Borrador QA',secrecy:'IDENTIFIED',eligibilityRule:'ACTIVE_ALL',options:['A','B'],actorId:m2.id});updateVoteDraft(db,{id:draftId,title:'Borrador QA editado',description:'Editado',secrecy:'SECRET',eligibilityRule:'AL_DIA_ONLY',options:['Uno','Dos','Tres'],actorId:m2.id});assert.equal(db.prepare('SELECT title FROM vote_elections WHERE id=?').get(draftId).title,'Borrador QA editado');assert.equal(db.prepare('SELECT COUNT(*) n FROM vote_options WHERE election_id=?').get(draftId).n,3);assert.equal(deleteVoteDraft(db,{id:draftId,actorId:m2.id}),true);assert.equal(db.prepare('SELECT 1 FROM vote_elections WHERE id=?').get(draftId),undefined);

// Votaciones: padrón congelado, voto único y transición irreversible.
const vid=createVote(db,{title:'Votación QA',description:'Prueba',secrecy:'SECRET',eligibilityRule:'ACTIVE_ALL',options:['Sí','No'],actorId:m2.id});
const opened=setVoteStatus(db,{id:vid,status:'OPEN',actorId:m2.id});assert.equal(opened.status,'OPEN');assert.ok(opened.eligible>=3);
const opts=db.prepare('SELECT id FROM vote_options WHERE election_id=? ORDER BY id').all(vid);const cast=castVote(db,{electionId:vid,memberId:m1.id,optionId:opts[0].id});assert.equal(cast.secrecy,'SECRET');assert.ok(cast.receipt);assert.equal(db.prepare('SELECT voter_member_id FROM vote_ballots WHERE election_id=?').get(vid).voter_member_id,null);assert.equal(memberVotes(db,m1.id).find(x=>x.id===vid).voted,true);
let duplicate=false;try{castVote(db,{electionId:vid,memberId:m1.id,optionId:opts[1].id})}catch{duplicate=true}assert.equal(duplicate,true);
setVoteStatus(db,{id:vid,status:'CLOSED',actorId:m2.id});const vr=voteResults(db,vid);assert.equal(vr.participation,1);assert.equal(vr.options.find(x=>x.id===opts[0].id).votes,1);let reopen=false;try{setVoteStatus(db,{id:vid,status:'OPEN',actorId:m2.id})}catch{reopen=true}assert.equal(reopen,true);setVoteStatus(db,{id:vid,status:'ARCHIVED',actorId:m2.id});

db.close();fs.rmSync(tmp,{recursive:true,force:true});console.log('SELF-CHECK CORE v0.6.0 OK');
