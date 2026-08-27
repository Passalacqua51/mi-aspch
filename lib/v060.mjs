import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const nowIso=()=>new Date().toISOString();
const j=v=>{try{return JSON.stringify(v??{})}catch{return '{}'}};
const txt=(v,n=500)=>String(v??'').trim().slice(0,n);
const safeUrl=v=>{const s=txt(v,1200);if(!s)return null;try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.toString():null}catch{return null}};

export const MODULES=['parking','simulators','studyroom','marketplace','activities','agreements','library','news','votes','push'];

export function initV060(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      subject_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log(subject_member_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS module_states (
      module TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      message TEXT,
      updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_room_waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      room_id INTEGER NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      notified_at TEXT,
      cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_study_wait_window ON study_room_waitlist(room_id,start_at,end_at,status);

    CREATE TABLE IF NOT EXISTS marketplace_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
      reporter_member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      note TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by INTEGER REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_market_reports_status ON marketplace_reports(status,created_at DESC);

    CREATE TABLE IF NOT EXISTS agreements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      benefit TEXT,
      valid_until TEXT,
      url TEXT NOT NULL,
      logo_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'General',
      title TEXT NOT NULL,
      description TEXT,
      url TEXT NOT NULL,
      source TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_library_status ON library_items(status,category,sort_order,title);

    CREATE TABLE IF NOT EXISTS library_favorites (
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(member_id,item_id)
    );

    CREATE TABLE IF NOT EXISTS activity_registrations (
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'REGISTERED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(member_id,activity_id)
    );

    CREATE TABLE IF NOT EXISTS credential_status (
      member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      revoked INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT,
      status TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vote_elections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      secrecy TEXT NOT NULL DEFAULT 'SECRET',
      eligibility_rule TEXT NOT NULL DEFAULT 'ACTIVE_ALL',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      opens_at TEXT,
      closes_at TEXT,
      results_visibility TEXT NOT NULL DEFAULT 'AFTER_CLOSE',
      created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vote_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      election_id INTEGER NOT NULL REFERENCES vote_elections(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vote_eligibility (
      election_id INTEGER NOT NULL REFERENCES vote_elections(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      snapshot_status TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(election_id,member_id)
    );
    CREATE TABLE IF NOT EXISTS vote_participation (
      election_id INTEGER NOT NULL REFERENCES vote_elections(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      voted_at TEXT NOT NULL,
      PRIMARY KEY(election_id,member_id)
    );
    CREATE TABLE IF NOT EXISTS vote_ballots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      election_id INTEGER NOT NULL REFERENCES vote_elections(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES vote_options(id) ON DELETE CASCADE,
      voter_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      receipt_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vote_status ON vote_elections(status,opens_at,closes_at);
    CREATE INDEX IF NOT EXISTS idx_vote_ballots_election ON vote_ballots(election_id,option_id);
  `);
  const stamp=nowIso();
  for(const module of MODULES)db.prepare(`INSERT OR IGNORE INTO module_states(module,enabled,message,updated_at) VALUES (?,1,NULL,?)`).run(module,stamp);
  seedAgreement(db);
  seedLibrary(db);
}

function seedAgreement(db){
  const url='https://aspch.org/convenios/';
  if(db.prepare('SELECT 1 FROM agreements WHERE url=? LIMIT 1').get(url))return;
  const n=nowIso();db.prepare(`INSERT INTO agreements(title,description,benefit,url,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('Convenios ASPCH','Consulta los convenios vigentes publicados por la Asociación.','Beneficios para asociados',url,'ACTIVE',0,n,n);
}
function seedLibrary(db){
  const rows=[
    ['Institucional','Estatutos ASPCH','Estatutos de la Asociación de Pilotos de Chile.','https://aspch.org/estatutos/','ASPCH'],
    ['Institucional','Biblioteca ASPCH','Biblioteca oficial de ASPCH.','https://aspch.org/biblioteca/','ASPCH'],
    ['Normativa','Código Aeronáutico · Ley 18.916','Biblioteca del Congreso Nacional de Chile.','https://www.bcn.cl/leychile/navegar?idNorma=30287','BCN'],
    ['DGAC','AIP Chile · Volumen I','Publicación de Información Aeronáutica DGAC.','https://aipchile.dgac.gob.cl/aip/vol1','DGAC'],
    ['DGAC','AIP Chile · Volumen II','Cartas y procedimientos aeronáuticos DGAC.','https://aipchile.dgac.gob.cl/aip/vol2','DGAC']
  ];
  const ins=db.prepare(`INSERT INTO library_items(category,title,description,url,source,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`);
  let order=0;for(const r of rows){if(db.prepare('SELECT 1 FROM library_items WHERE url=? LIMIT 1').get(r[3]))continue;const n=nowIso();ins.run(...r,order++,n,n)}
}

export function audit(db,{actorId=null,subjectId=null,action,entityType=null,entityId=null,details=null}={}){
  if(!action)return;try{db.prepare(`INSERT INTO audit_log(actor_member_id,subject_member_id,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?)`).run(actorId,subjectId,txt(action,120),txt(entityType,80)||null,entityId==null?null:txt(entityId,120),details==null?null:j(details),nowIso())}catch{}
}
export function auditRows(db,{limit=200,memberId=null}={}){limit=Math.max(1,Math.min(1000,Number(limit)||200));if(memberId)return db.prepare(`SELECT a.*,m.name actor_name FROM audit_log a LEFT JOIN members m ON m.id=a.actor_member_id WHERE a.subject_member_id=? OR a.actor_member_id=? ORDER BY a.id DESC LIMIT ?`).all(memberId,memberId,limit);return db.prepare(`SELECT a.*,m.name actor_name,s.name subject_name FROM audit_log a LEFT JOIN members m ON m.id=a.actor_member_id LEFT JOIN members s ON s.id=a.subject_member_id ORDER BY a.id DESC LIMIT ?`).all(limit)}

export function moduleStates(db){return Object.fromEntries(db.prepare('SELECT module,enabled,message,updated_at FROM module_states ORDER BY module').all().map(r=>[r.module,{enabled:!!r.enabled,message:r.message||null,updatedAt:r.updated_at}]))}
export function moduleEnabled(db,module){const r=db.prepare('SELECT enabled FROM module_states WHERE module=?').get(String(module));return r?!!r.enabled:true}
export function setModuleState(db,{module,enabled,message='',actorId=null}){module=String(module||'').toLowerCase();if(!MODULES.includes(module))return false;db.prepare(`INSERT INTO module_states(module,enabled,message,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(module) DO UPDATE SET enabled=excluded.enabled,message=excluded.message,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(module,enabled?1:0,txt(message,240)||null,actorId,nowIso());audit(db,{actorId,action:'MODULE_STATE_CHANGED',entityType:'module',entityId:module,details:{enabled:!!enabled,message:txt(message,240)}});return true}

export function addStudyWaitlist(db,{memberId,start,end}){const a=new Date(start),b=new Date(end);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<=a)throw Object.assign(new Error('Horario inválido.'),{statusCode:400,expose:true});if(b-a>4*3600_000)throw Object.assign(new Error('La espera puede abarcar como máximo 4 horas.'),{statusCode:400,expose:true});const room=db.prepare('SELECT id FROM study_rooms WHERE active=1 ORDER BY id LIMIT 1').get();if(!room)throw Object.assign(new Error('Sala no disponible.'),{statusCode:503,expose:true});const exists=db.prepare(`SELECT id FROM study_room_waitlist WHERE member_id=? AND room_id=? AND start_at=? AND end_at=? AND status='ACTIVE'`).get(memberId,room.id,a.toISOString(),b.toISOString());if(exists)return Number(exists.id);const r=db.prepare(`INSERT INTO study_room_waitlist(member_id,room_id,start_at,end_at,status,created_at) VALUES (?,?,?,?, 'ACTIVE',?)`).run(memberId,room.id,a.toISOString(),b.toISOString(),nowIso());audit(db,{actorId:memberId,subjectId:memberId,action:'STUDY_WAITLIST_JOINED',entityType:'study_waitlist',entityId:r.lastInsertRowid,details:{start:a.toISOString(),end:b.toISOString()}});return Number(r.lastInsertRowid)}
export function cancelStudyWaitlist(db,{memberId,id}){const r=db.prepare(`UPDATE study_room_waitlist SET status='CANCELLED',cancelled_at=? WHERE id=? AND member_id=? AND status='ACTIVE'`).run(nowIso(),Number(id),memberId);if(Number(r.changes))audit(db,{actorId:memberId,subjectId:memberId,action:'STUDY_WAITLIST_CANCELLED',entityType:'study_waitlist',entityId:id});return !!Number(r.changes)}
export function memberStudyWaitlist(db,memberId){return db.prepare(`SELECT w.*,r.name room_name FROM study_room_waitlist w JOIN study_rooms r ON r.id=w.room_id WHERE w.member_id=? AND w.status='ACTIVE' ORDER BY w.start_at`).all(memberId)}
export function matchingStudyWaitlist(db,{roomId,start,end}){return db.prepare(`SELECT w.*,m.name,m.email FROM study_room_waitlist w JOIN members m ON m.id=w.member_id WHERE w.room_id=? AND w.status='ACTIVE' AND w.start_at<? AND w.end_at>? ORDER BY w.created_at`).all(roomId,end,start)}
export function markStudyWaitlistNotified(db,id){db.prepare(`UPDATE study_room_waitlist SET notified_at=? WHERE id=?`).run(nowIso(),Number(id))}

export function reportMarketplace(db,{listingId,memberId,reason}){reason=txt(reason,500);if(reason.length<3)throw Object.assign(new Error('Indica brevemente el motivo del reporte.'),{statusCode:400,expose:true});const listing=db.prepare(`SELECT id,member_id,status FROM marketplace_listings WHERE id=?`).get(Number(listingId));if(!listing||listing.status!=='ACTIVE')throw Object.assign(new Error('Publicación no disponible.'),{statusCode:404,expose:true});if(Number(listing.member_id)===Number(memberId))throw Object.assign(new Error('No puedes reportar tu propia publicación.'),{statusCode:400,expose:true});const existing=db.prepare(`SELECT id FROM marketplace_reports WHERE listing_id=? AND reporter_member_id=? AND status='OPEN'`).get(listingId,memberId);if(existing)return Number(existing.id);const r=db.prepare(`INSERT INTO marketplace_reports(listing_id,reporter_member_id,reason,status,created_at) VALUES (?,?,?,'OPEN',?)`).run(listingId,memberId,reason,nowIso());audit(db,{actorId:memberId,subjectId:listing.member_id,action:'MARKETPLACE_REPORTED',entityType:'marketplace',entityId:listingId,details:{reportId:Number(r.lastInsertRowid)}});return Number(r.lastInsertRowid)}
export function marketplaceReports(db){return db.prepare(`SELECT r.*,l.title,m.name reporter_name,o.name owner_name FROM marketplace_reports r JOIN marketplace_listings l ON l.id=r.listing_id JOIN members m ON m.id=r.reporter_member_id JOIN members o ON o.id=l.member_id ORDER BY CASE r.status WHEN 'OPEN' THEN 0 ELSE 1 END,r.id DESC LIMIT 500`).all()}
export function resolveMarketplaceReport(db,{id,actorId,status='RESOLVED',note=''}){status=String(status||'RESOLVED').toUpperCase();if(!['RESOLVED','DISMISSED'].includes(status))return false;const r=db.prepare(`UPDATE marketplace_reports SET status=?,note=?,resolved_at=?,resolved_by=? WHERE id=? AND status='OPEN'`).run(status,txt(note,500),nowIso(),actorId,Number(id));if(Number(r.changes))audit(db,{actorId,action:'MARKETPLACE_REPORT_RESOLVED',entityType:'marketplace_report',entityId:id,details:{status}});return !!Number(r.changes)}

export function agreements(db,{admin=false}={}){return admin?db.prepare(`SELECT * FROM agreements ORDER BY sort_order,title`).all():db.prepare(`SELECT * FROM agreements WHERE status='ACTIVE' ORDER BY sort_order,title`).all()}
export function upsertAgreement(db,{id=null,title,description='',benefit='',validUntil=null,url,logoUrl=null,status='ACTIVE',sortOrder=0,actorId=null}){title=txt(title,140);url=safeUrl(url);logoUrl=safeUrl(logoUrl);status=String(status||'ACTIVE').toUpperCase();if(!title||!url||!['ACTIVE','HIDDEN','EXPIRED'].includes(status))throw Object.assign(new Error('Convenio inválido.'),{statusCode:400,expose:true});const n=nowIso();let rid;if(id){const r=db.prepare(`UPDATE agreements SET title=?,description=?,benefit=?,valid_until=?,url=?,logo_url=?,status=?,sort_order=?,updated_at=? WHERE id=?`).run(title,txt(description,1500),txt(benefit,800),validUntil||null,url,logoUrl,status,Number(sortOrder)||0,n,Number(id));if(!Number(r.changes))return null;rid=Number(id)}else{const r=db.prepare(`INSERT INTO agreements(title,description,benefit,valid_until,url,logo_url,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(title,txt(description,1500),txt(benefit,800),validUntil||null,url,logoUrl,status,Number(sortOrder)||0,n,n);rid=Number(r.lastInsertRowid)}audit(db,{actorId,action:id?'AGREEMENT_UPDATED':'AGREEMENT_CREATED',entityType:'agreement',entityId:rid});return rid}
export function setAgreementStatus(db,{id,status,actorId}){status=String(status||'').toUpperCase();if(!['ACTIVE','HIDDEN','EXPIRED'].includes(status))return false;const r=db.prepare('UPDATE agreements SET status=?,updated_at=? WHERE id=?').run(status,nowIso(),Number(id));if(Number(r.changes))audit(db,{actorId,action:'AGREEMENT_STATUS_CHANGED',entityType:'agreement',entityId:id,details:{status}});return !!Number(r.changes)}

export function libraryItems(db,{memberId=null,admin=false,query='',category=''}={}){let rows=admin?db.prepare(`SELECT * FROM library_items ORDER BY category,sort_order,title`).all():db.prepare(`SELECT * FROM library_items WHERE status='ACTIVE' ORDER BY category,sort_order,title`).all();const q=String(query||'').trim().toLowerCase(),c=String(category||'').trim().toLowerCase();if(q)rows=rows.filter(r=>`${r.title} ${r.description||''} ${r.source||''} ${r.category||''}`.toLowerCase().includes(q));if(c)rows=rows.filter(r=>String(r.category||'').toLowerCase()===c);if(memberId){const fav=new Set(db.prepare('SELECT item_id FROM library_favorites WHERE member_id=?').all(memberId).map(x=>Number(x.item_id)));rows=rows.map(r=>({...r,favorite:fav.has(Number(r.id))}))}return rows}
export function toggleLibraryFavorite(db,{memberId,itemId,favorite}){const item=db.prepare(`SELECT id FROM library_items WHERE id=? AND status='ACTIVE'`).get(Number(itemId));if(!item)return false;if(favorite)db.prepare(`INSERT OR IGNORE INTO library_favorites(member_id,item_id,created_at) VALUES (?,?,?)`).run(memberId,itemId,nowIso());else db.prepare(`DELETE FROM library_favorites WHERE member_id=? AND item_id=?`).run(memberId,itemId);audit(db,{actorId:memberId,subjectId:memberId,action:favorite?'LIBRARY_FAVORITED':'LIBRARY_UNFAVORITED',entityType:'library_item',entityId:itemId});return true}
export function upsertLibraryItem(db,{id=null,category='General',title,description='',url,source='',status='ACTIVE',sortOrder=0,actorId=null}){title=txt(title,180);url=safeUrl(url);status=String(status||'ACTIVE').toUpperCase();if(!title||!url||!['ACTIVE','HIDDEN'].includes(status))throw Object.assign(new Error('Documento inválido.'),{statusCode:400,expose:true});const n=nowIso();let rid;if(id){const r=db.prepare(`UPDATE library_items SET category=?,title=?,description=?,url=?,source=?,status=?,sort_order=?,updated_at=? WHERE id=?`).run(txt(category,80)||'General',title,txt(description,1200),url,txt(source,100),status,Number(sortOrder)||0,n,Number(id));if(!Number(r.changes))return null;rid=Number(id)}else{const r=db.prepare(`INSERT INTO library_items(category,title,description,url,source,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(txt(category,80)||'General',title,txt(description,1200),url,txt(source,100),status,Number(sortOrder)||0,n,n);rid=Number(r.lastInsertRowid)}audit(db,{actorId,action:id?'LIBRARY_ITEM_UPDATED':'LIBRARY_ITEM_CREATED',entityType:'library_item',entityId:rid});return rid}

export function activityCenter(db,memberId){const rows=db.prepare(`SELECT a.*,r.status registration_status,r.updated_at registration_updated_at FROM activities a LEFT JOIN activity_registrations r ON r.activity_id=a.id AND r.member_id=? WHERE a.status!='REMOVED' ORDER BY COALESCE(a.starts_at,'9999') ASC,a.id DESC`).all(memberId);const now=Date.now();return rows.map(r=>{const ended=r.ends_at&&new Date(r.ends_at).getTime()<now;return {...r,phase:ended?'FINISHED':(r.status==='ACTIVE'?'UPCOMING':'CLOSED'),registered:r.registration_status==='REGISTERED'}})}
export function setActivityRegistration(db,{memberId,activityId,registered}){const a=db.prepare(`SELECT id FROM activities WHERE id=? AND status!='REMOVED'`).get(Number(activityId));if(!a)return false;const n=nowIso();if(registered)db.prepare(`INSERT INTO activity_registrations(member_id,activity_id,status,created_at,updated_at) VALUES (?,?,'REGISTERED',?,?) ON CONFLICT(member_id,activity_id) DO UPDATE SET status='REGISTERED',updated_at=excluded.updated_at`).run(memberId,activityId,n,n);else db.prepare(`DELETE FROM activity_registrations WHERE member_id=? AND activity_id=?`).run(memberId,activityId);audit(db,{actorId:memberId,subjectId:memberId,action:registered?'ACTIVITY_MARKED_REGISTERED':'ACTIVITY_UNREGISTERED',entityType:'activity',entityId:activityId});return true}

export function credentialStatus(db,memberId){const r=db.prepare('SELECT * FROM credential_status WHERE member_id=?').get(memberId);return{revoked:!!r?.revoked,reason:r?.reason||null,updatedAt:r?.updated_at||null}}
export function setCredentialRevoked(db,{memberId,revoked,reason='',actorId}){db.prepare(`INSERT INTO credential_status(member_id,revoked,reason,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET revoked=excluded.revoked,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(memberId,revoked?1:0,txt(reason,300)||null,actorId,nowIso());audit(db,{actorId,subjectId:memberId,action:revoked?'CREDENTIAL_REVOKED':'CREDENTIAL_RESTORED',entityType:'credential',entityId:memberId,details:{reason:txt(reason,300)}});return true}

export function memberHistory(db,memberId,{limit=100}={}){return auditRows(db,{limit,memberId}).map(r=>({id:r.id,action:r.action,entityType:r.entity_type,entityId:r.entity_id,details:parseJson(r.detail_json),createdAt:r.created_at,actorName:r.actor_name||null}))}
function parseJson(v){try{return JSON.parse(v||'null')}catch{return null}}


function normalizedVoteConfig({title,description='',secrecy='SECRET',eligibilityRule='ACTIVE_ALL',opensAt=null,closesAt=null,options=[]}={}){
  title=txt(title,180);secrecy=String(secrecy||'SECRET').toUpperCase();eligibilityRule=String(eligibilityRule||'ACTIVE_ALL').toUpperCase();
  if(!title||!['SECRET','IDENTIFIED'].includes(secrecy)||!['ACTIVE_ALL','AL_DIA_ONLY','BOARD_ONLY'].includes(eligibilityRule))throw Object.assign(new Error('Configuración de votación inválida.'),{statusCode:400,expose:true});
  const opts=[...new Set((options||[]).map(x=>txt(x,180)).filter(Boolean))];if(opts.length<2)throw Object.assign(new Error('La votación necesita al menos dos opciones.'),{statusCode:400,expose:true});
  const open=opensAt?new Date(opensAt):null,close=closesAt?new Date(closesAt):null;
  if(open&&!Number.isFinite(open.getTime()))throw Object.assign(new Error('Fecha de apertura inválida.'),{statusCode:400,expose:true});
  if(close&&!Number.isFinite(close.getTime()))throw Object.assign(new Error('Fecha de cierre inválida.'),{statusCode:400,expose:true});
  if(open&&close&&close<=open)throw Object.assign(new Error('El cierre debe ser posterior a la apertura.'),{statusCode:400,expose:true});
  return{title,description:txt(description,2000),secrecy,eligibilityRule,opensAt:open?open.toISOString():null,closesAt:close?close.toISOString():null,options:opts};
}
export function createVote(db,input={}){
  const actorId=input.actorId??null;const c=normalizedVoteConfig(input);const n=nowIso();
  db.exec('BEGIN IMMEDIATE');try{const r=db.prepare(`INSERT INTO vote_elections(title,description,secrecy,eligibility_rule,status,opens_at,closes_at,results_visibility,created_by,created_at,updated_at) VALUES (?,?,?,?,'DRAFT',?,?, 'AFTER_CLOSE',?,?,?)`).run(c.title,c.description,c.secrecy,c.eligibilityRule,c.opensAt,c.closesAt,actorId,n,n);const id=Number(r.lastInsertRowid);const ins=db.prepare(`INSERT INTO vote_options(election_id,label,sort_order) VALUES (?,?,?)`);c.options.forEach((x,i)=>ins.run(id,x,i));db.exec('COMMIT');audit(db,{actorId,action:'VOTE_CREATED',entityType:'vote',entityId:id,details:{title:c.title,secrecy:c.secrecy,eligibilityRule:c.eligibilityRule,options:c.options.length}});return id}catch(e){db.exec('ROLLBACK');throw e}
}
export function updateVoteDraft(db,input={}){
  const id=Number(input.id),actorId=input.actorId??null;const prior=db.prepare('SELECT * FROM vote_elections WHERE id=?').get(id);if(!prior)return null;if(prior.status!=='DRAFT')throw Object.assign(new Error('Solo se puede editar una votación en borrador.'),{statusCode:409,expose:true});const c=normalizedVoteConfig(input);const n=nowIso();
  db.exec('BEGIN IMMEDIATE');try{db.prepare(`UPDATE vote_elections SET title=?,description=?,secrecy=?,eligibility_rule=?,opens_at=?,closes_at=?,updated_at=? WHERE id=? AND status='DRAFT'`).run(c.title,c.description,c.secrecy,c.eligibilityRule,c.opensAt,c.closesAt,n,id);db.prepare('DELETE FROM vote_options WHERE election_id=?').run(id);const ins=db.prepare(`INSERT INTO vote_options(election_id,label,sort_order) VALUES (?,?,?)`);c.options.forEach((x,i)=>ins.run(id,x,i));db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}audit(db,{actorId,action:'VOTE_DRAFT_UPDATED',entityType:'vote',entityId:id,details:{title:c.title,options:c.options.length}});return id;
}
export function deleteVoteDraft(db,{id,actorId=null}={}){id=Number(id);const prior=db.prepare(`SELECT title,status FROM vote_elections WHERE id=?`).get(id);if(!prior)return false;if(prior.status!=='DRAFT')throw Object.assign(new Error('Solo se puede eliminar una votación en borrador.'),{statusCode:409,expose:true});db.prepare('DELETE FROM vote_elections WHERE id=?').run(id);audit(db,{actorId,action:'VOTE_DRAFT_DELETED',entityType:'vote',entityId:id,details:{title:prior.title}});return true;}
function voteEligibilityMembers(db,rule){
  if(rule==='BOARD_ONLY')return db.prepare(`SELECT m.id,COALESCE(f.financial_status,'AL_DIA') financial_status FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.active=1 AND m.is_board=1 AND m.role!='ADMIN' ORDER BY m.id`).all();
  if(rule==='AL_DIA_ONLY')return db.prepare(`SELECT m.id,COALESCE(f.financial_status,'AL_DIA') financial_status FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.active=1 AND m.role!='ADMIN' AND COALESCE(f.financial_status,'AL_DIA') NOT IN ('MOROSO','DESAFILIADO') ORDER BY m.id`).all();
  return db.prepare(`SELECT m.id,COALESCE(f.financial_status,'AL_DIA') financial_status FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.active=1 AND m.role!='ADMIN' AND COALESCE(f.financial_status,'AL_DIA')!='DESAFILIADO' ORDER BY m.id`).all();
}
export function setVoteStatus(db,{id,status,actorId=null}={}){
  id=Number(id);status=String(status||'').toUpperCase();
  if(!['OPEN','CLOSED','ARCHIVED'].includes(status))return null;
  const v=db.prepare('SELECT * FROM vote_elections WHERE id=?').get(id);if(!v)return null;
  const allowed={DRAFT:['OPEN'],OPEN:['CLOSED'],CLOSED:['ARCHIVED'],ARCHIVED:[]};
  if(!(allowed[String(v.status||'DRAFT').toUpperCase()]||[]).includes(status)){
    throw Object.assign(new Error(`Transición de votación no permitida: ${v.status} → ${status}.`),{statusCode:409,expose:true});
  }
  if(status==='OPEN'){
    const optionCount=Number(db.prepare('SELECT COUNT(*) n FROM vote_options WHERE election_id=?').get(id)?.n||0);
    if(optionCount<2)throw Object.assign(new Error('La votación necesita al menos dos opciones antes de abrirse.'),{statusCode:409,expose:true});
    const eligible=voteEligibilityMembers(db,v.eligibility_rule);
    if(!eligible.length)throw Object.assign(new Error('El padrón resultó vacío. Revisa la regla de elegibilidad antes de abrir.'),{statusCode:409,expose:true});
    db.exec('BEGIN IMMEDIATE');
    try{
      const existing=Number(db.prepare('SELECT COUNT(*) n FROM vote_eligibility WHERE election_id=?').get(id)?.n||0);
      if(existing)throw new Error('El padrón de esta votación ya fue congelado.');
      const ins=db.prepare(`INSERT INTO vote_eligibility(election_id,member_id,snapshot_status,created_at) VALUES (?,?,?,?)`);
      const n=nowIso();for(const m of eligible)ins.run(id,m.id,m.financial_status,n);
      db.prepare(`UPDATE vote_elections SET status='OPEN',opens_at=COALESCE(opens_at,?),updated_at=? WHERE id=?`).run(n,n,id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e}
    audit(db,{actorId,action:'VOTE_OPENED',entityType:'vote',entityId:id,details:{eligible:eligible.length,secrecy:v.secrecy,eligibilityRule:v.eligibility_rule}});
    return{ok:true,eligible:eligible.length,status:'OPEN'};
  }
  const n=nowIso();
  if(status==='CLOSED')db.prepare(`UPDATE vote_elections SET status='CLOSED',closes_at=COALESCE(closes_at,?),updated_at=? WHERE id=?`).run(n,n,id);
  else db.prepare(`UPDATE vote_elections SET status='ARCHIVED',updated_at=? WHERE id=?`).run(n,id);
  audit(db,{actorId,action:`VOTE_${status}`,entityType:'vote',entityId:id});return{ok:true,status};
}
export function voteResults(db,id){id=Number(id);const election=db.prepare('SELECT * FROM vote_elections WHERE id=?').get(id);if(!election)return null;const options=db.prepare(`SELECT o.id,o.label,o.sort_order,COUNT(b.id) votes FROM vote_options o LEFT JOIN vote_ballots b ON b.option_id=o.id AND b.election_id=o.election_id WHERE o.election_id=? GROUP BY o.id ORDER BY o.sort_order,o.id`).all(id);const eligible=Number(db.prepare('SELECT COUNT(*) n FROM vote_eligibility WHERE election_id=?').get(id).n||0),participation=Number(db.prepare('SELECT COUNT(*) n FROM vote_participation WHERE election_id=?').get(id).n||0);const receipts=db.prepare('SELECT receipt_code FROM vote_ballots WHERE election_id=? ORDER BY receipt_code').all(id).map(x=>x.receipt_code);return{election,options,eligible,participation,turnout:eligible?Math.round(participation*10000/eligible)/100:0,receipts};}
export function adminVotes(db){return db.prepare(`SELECT v.*,(SELECT COUNT(*) FROM vote_eligibility e WHERE e.election_id=v.id) eligible,(SELECT COUNT(*) FROM vote_participation p WHERE p.election_id=v.id) participation FROM vote_elections v ORDER BY v.id DESC`).all().map(v=>({...v,options:db.prepare('SELECT id,label,sort_order FROM vote_options WHERE election_id=? ORDER BY sort_order,id').all(v.id),results:voteResults(db,v.id)}))}
export function memberVotes(db,memberId){const now=Date.now();return db.prepare(`SELECT v.*,CASE WHEN p.member_id IS NULL THEN 0 ELSE 1 END voted,CASE WHEN e.member_id IS NULL THEN 0 ELSE 1 END eligible FROM vote_elections v LEFT JOIN vote_eligibility e ON e.election_id=v.id AND e.member_id=? LEFT JOIN vote_participation p ON p.election_id=v.id AND p.member_id=? WHERE v.status IN ('OPEN','CLOSED') ORDER BY CASE v.status WHEN 'OPEN' THEN 0 ELSE 1 END,v.id DESC`).all(memberId,memberId).map(v=>{const closed=v.status==='CLOSED'||(v.closes_at&&new Date(v.closes_at).getTime()<=now);const showResults=closed||v.results_visibility==='ALWAYS';return{...v,eligible:!!v.eligible,voted:!!v.voted,options:db.prepare('SELECT id,label,sort_order FROM vote_options WHERE election_id=? ORDER BY sort_order,id').all(v.id),results:showResults?voteResults(db,v.id):null}})}
export function castVote(db,{electionId,memberId,optionId}={}){electionId=Number(electionId);memberId=Number(memberId);optionId=Number(optionId);const v=db.prepare('SELECT * FROM vote_elections WHERE id=?').get(electionId);if(!v||v.status!=='OPEN')throw Object.assign(new Error('La votación no está abierta.'),{statusCode:409,expose:true});const now=Date.now();if(v.opens_at&&new Date(v.opens_at).getTime()>now)throw Object.assign(new Error('La votación aún no comienza.'),{statusCode:409,expose:true});if(v.closes_at&&new Date(v.closes_at).getTime()<=now)throw Object.assign(new Error('La votación ya cerró.'),{statusCode:409,expose:true});if(!db.prepare('SELECT 1 FROM vote_eligibility WHERE election_id=? AND member_id=?').get(electionId,memberId))throw Object.assign(new Error('No estás habilitado en el padrón de esta votación.'),{statusCode:403,expose:true});if(db.prepare('SELECT 1 FROM vote_participation WHERE election_id=? AND member_id=?').get(electionId,memberId))throw Object.assign(new Error('Tu participación ya fue registrada.'),{statusCode:409,expose:true});if(!db.prepare('SELECT 1 FROM vote_options WHERE id=? AND election_id=?').get(optionId,electionId))throw Object.assign(new Error('Opción inválida.'),{statusCode:400,expose:true});const receipt=crypto.randomBytes(10).toString('base64url').toUpperCase();const n=nowIso();const ballotTime=v.secrecy==='SECRET'?(v.opens_at||`${n.slice(0,10)}T00:00:00.000Z`):n;db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO vote_participation(election_id,member_id,voted_at) VALUES (?,?,?)').run(electionId,memberId,n);db.prepare('INSERT INTO vote_ballots(election_id,option_id,voter_member_id,receipt_code,created_at) VALUES (?,?,?,?,?)').run(electionId,optionId,v.secrecy==='IDENTIFIED'?memberId:null,receipt,ballotTime);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}if(v.secrecy==='IDENTIFIED')audit(db,{actorId:memberId,subjectId:memberId,action:'VOTE_CAST_IDENTIFIED',entityType:'vote',entityId:electionId});else audit(db,{actorId:memberId,subjectId:memberId,action:'VOTE_PARTICIPATED_SECRET',entityType:'vote',entityId:electionId,details:{choiceStoredSeparately:true}});return{ok:true,receipt,secrecy:v.secrecy};}

export function systemMetrics(db){
  const one=(sql,...args)=>Number(db.prepare(sql).get(...args)?.n||0);
  return {
    members:{active:one(`SELECT COUNT(*) n FROM members WHERE active=1`),total:one(`SELECT COUNT(*) n FROM members`),board:one(`SELECT COUNT(*) n FROM members WHERE active=1 AND is_board=1`),moroso:one(`SELECT COUNT(*) n FROM member_financial_status WHERE financial_status='MOROSO'`),desafiliado:one(`SELECT COUNT(*) n FROM member_financial_status WHERE financial_status='DESAFILIADO'`)},
    parking:{active:one(`SELECT COUNT(*) n FROM parking_reservations WHERE status='ACTIVE'`),today:one(`SELECT COUNT(*) n FROM parking_reservations WHERE status='ACTIVE' AND reservation_date=date('now','localtime')`)},
    study:{active:one(`SELECT COUNT(*) n FROM study_room_reservations WHERE status='ACTIVE' AND end_at>?`,nowIso()),waitlist:one(`SELECT COUNT(*) n FROM study_room_waitlist WHERE status='ACTIVE'`)},
    marketplace:{active:one(`SELECT COUNT(*) n FROM marketplace_listings WHERE status='ACTIVE'`),pending:one(`SELECT COUNT(*) n FROM marketplace_listings WHERE status='PENDING'`),reports:one(`SELECT COUNT(*) n FROM marketplace_reports WHERE status='OPEN'`)},
    votes:{open:one(`SELECT COUNT(*) n FROM vote_elections WHERE status='OPEN'`),total:one(`SELECT COUNT(*) n FROM vote_elections`)},
    push:{subscriptions:one(`SELECT COUNT(*) n FROM push_subscriptions`),deliveries:one(`SELECT COUNT(*) n FROM notification_deliveries WHERE status='SENT'`)},
    sessions:{active:one(`SELECT COUNT(*) n FROM sessions WHERE expires_at>?`,nowIso())},
    audit:{rows:one(`SELECT COUNT(*) n FROM audit_log`)}
  };
}
export function dbStats(db){const tables=db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(x=>x.name);return tables.map(name=>{try{return{name,count:Number(db.prepare(`SELECT COUNT(*) n FROM "${name.replace(/"/g,'""')}"`).get().n||0)}}catch{return{name,count:null}}})}

export function createBackup(db,{backupDir,retention=14,actorId=null}={}){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const fileName=`mi-aspch-${stamp}.sqlite`;const target=path.join(backupDir,fileName);try{db.exec(`VACUUM INTO '${target.replace(/'/g,"''")}'`);const size=fs.statSync(target).size;db.prepare(`INSERT INTO backup_runs(file_name,status,size_bytes,created_at) VALUES (?,'OK',?,?)`).run(fileName,size,nowIso());cleanupBackups(backupDir,retention);audit(db,{actorId,action:'BACKUP_CREATED',entityType:'backup',entityId:fileName,details:{size}});return{ok:true,fileName,size}}catch(err){db.prepare(`INSERT INTO backup_runs(file_name,status,size_bytes,error,created_at) VALUES (?,'ERROR',0,?,?)`).run(fileName,txt(err.message,600),nowIso());return{ok:false,error:err.message}}
}
export function backupRuns(db){return db.prepare(`SELECT * FROM backup_runs ORDER BY id DESC LIMIT 100`).all()}
function cleanupBackups(dir,retention){const files=fs.readdirSync(dir).filter(x=>/^mi-aspch-.*\.sqlite$/.test(x)).map(name=>({name,mtime:fs.statSync(path.join(dir,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);for(const f of files.slice(Math.max(1,Number(retention)||14)))try{fs.unlinkSync(path.join(dir,f.name))}catch{}}

export function invalidateOtherSessions(db,{memberId,currentSessionId,actorId}){const r=db.prepare(`DELETE FROM sessions WHERE member_id=? AND id<>?`).run(memberId,currentSessionId);audit(db,{actorId:actorId||memberId,subjectId:memberId,action:'OTHER_SESSIONS_REVOKED',entityType:'session',details:{removed:Number(r.changes||0)}});return Number(r.changes||0)}
export function invalidateMemberSessions(db,{memberId,actorId}){const r=db.prepare(`DELETE FROM sessions WHERE member_id=?`).run(memberId);audit(db,{actorId,subjectId:memberId,action:'ALL_SESSIONS_REVOKED',entityType:'session',details:{removed:Number(r.changes||0)}});return Number(r.changes||0)}

export function adminMemberSearch(db,q){q=String(q||'').trim();if(q.length<2)return[];const like=`%${q}%`;return db.prepare(`SELECT m.id,m.name,m.email,m.rut,m.employer,m.category,m.position,m.role,m.active,m.is_board,f.financial_status,f.months_due,f.amount_due,c.revoked AS credential_revoked,(SELECT COUNT(*) FROM sessions s WHERE s.member_id=m.id AND s.expires_at>?) AS active_sessions,(SELECT COUNT(*) FROM push_subscriptions p WHERE p.member_id=m.id) AS push_devices FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id LEFT JOIN credential_status c ON c.member_id=m.id WHERE m.name LIKE ? OR m.email LIKE ? OR m.rut LIKE ? ORDER BY m.name LIMIT 50`).all(nowIso(),like,like,like)}

export function diagnostics(db,{version,google,push,financial,moduleStates:mods,dataDir}={}){return{generatedAt:nowIso(),version,google,push,financial,modules:mods,metrics:systemMetrics(db),database:dbStats(db),storage:{dataDir:path.basename(dataDir||'data')},node:process.version,platform:process.platform,uptimeSeconds:Math.round(process.uptime()),memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}}}

export function toIcs({uid,title,start,end,description='',location='',url=''}){const f=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ASPCH//Mi ASPCH//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${esc(uid)}@mi-aspch`,`DTSTAMP:${f(new Date())}`,`DTSTART:${f(start)}`,`DTEND:${f(end)}`,`SUMMARY:${esc(title)}`,description?`DESCRIPTION:${esc(description)}`:'',location?`LOCATION:${esc(location)}`:'',url?`URL:${esc(url)}`:'','END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n')+'\r\n'}
