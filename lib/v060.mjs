import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const nowIso=()=>new Date().toISOString();
const j=v=>{try{return JSON.stringify(v??{})}catch{return '{}'}};
const txt=(v,n=500)=>String(v??'').trim().slice(0,n);
const safeUrl=v=>{const s=txt(v,1200);if(!s)return null;try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.toString():null}catch{return null}};

export const MODULES=['parking','simulators','studyroom','marketplace','activities','agreements','library','news','votes','push'];
export const UI_SERVICE_DEFAULTS=Object.freeze({parking:true,reservations:true,simulators:true,studyroom:true,library:true,agreements:true,news:true,agenda:true});
const MODULE_DEFAULTS=Object.freeze({activities:false,votes:false});

export function initV060(db){
  
    try { db.exec("ALTER TABLE news ADD COLUMN source TEXT DEFAULT 'manual'"); } catch(e){}
    try { db.exec("ALTER TABLE news ADD COLUMN external_id TEXT UNIQUE"); } catch(e){}
    try { db.exec("ALTER TABLE news ADD COLUMN image_url TEXT"); } catch(e){}
    try { db.exec("ALTER TABLE news ADD COLUMN external_url TEXT"); } catch(e){}
    
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

    CREATE TABLE IF NOT EXISTS member_ui_preferences (
      member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      services_json TEXT NOT NULL,
      configured_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS member_access_blocks (
      member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      blocked INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
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
  for(const module of MODULES){
    const enabled=MODULE_DEFAULTS[module]===false?0:1;
    db.prepare(`INSERT OR IGNORE INTO module_states(module,enabled,message,updated_at) VALUES (?,?,NULL,?)`).run(module,enabled,stamp);
    if(enabled===0)db.prepare(`UPDATE module_states SET enabled=0,message=NULL,updated_at=? WHERE module=? AND updated_by IS NULL`).run(stamp,module);
  }
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

export function memberUiPreferences(db,memberId){
  const row=db.prepare('SELECT services_json,configured_at,updated_at FROM member_ui_preferences WHERE member_id=?').get(Number(memberId));
  let saved={};try{saved=JSON.parse(row?.services_json||'{}')}catch{}
  const services=Object.fromEntries(Object.keys(UI_SERVICE_DEFAULTS).map(key=>[key,saved[key]!==false]));
  return{configured:!!row?.configured_at,simpleMode:saved.simpleMode===true,services,updatedAt:row?.updated_at||null};
}
export function setMemberUiPreferences(db,{memberId,services,simpleMode}={}){
  if(!services||typeof services!=='object'||Array.isArray(services))throw Object.assign(new Error('Preferencias inválidas.'),{statusCode:400,expose:true});
  const normalized=Object.fromEntries(Object.keys(UI_SERVICE_DEFAULTS).map(key=>[key,services[key]!==false]));
  const current=memberUiPreferences(db,memberId),normalizedSimple=simpleMode===undefined?current.simpleMode:simpleMode===true;
  const n=nowIso();
  db.prepare(`INSERT INTO member_ui_preferences(member_id,services_json,configured_at,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(member_id) DO UPDATE SET services_json=excluded.services_json,configured_at=COALESCE(member_ui_preferences.configured_at,excluded.configured_at),updated_at=excluded.updated_at`)
    .run(Number(memberId),j({...normalized,simpleMode:normalizedSimple}),n,n);
  audit(db,{actorId:Number(memberId),subjectId:Number(memberId),action:'UI_SERVICES_PERSONALIZED',entityType:'ui_preferences',entityId:memberId,details:{services:normalized,simpleMode:normalizedSimple}});
  return memberUiPreferences(db,memberId);
}

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
    setModuleState(db,{module:'votes',enabled:true,actorId});
    return{ok:true,eligible:eligible.length,status:'OPEN'};
  }
  const n=nowIso();
  if(status==='CLOSED')db.prepare(`UPDATE vote_elections SET status='CLOSED',closes_at=COALESCE(closes_at,?),updated_at=? WHERE id=?`).run(n,n,id);
  else db.prepare(`UPDATE vote_elections SET status='ARCHIVED',updated_at=? WHERE id=?`).run(n,id);
  audit(db,{actorId,action:`VOTE_${status}`,entityType:'vote',entityId:id});return{ok:true,status};
}
export function voteResults(db,id){id=Number(id);const election=db.prepare('SELECT * FROM vote_elections WHERE id=?').get(id);if(!election)return null;const options=db.prepare(`SELECT o.id,o.label,o.sort_order,COUNT(b.id) votes FROM vote_options o LEFT JOIN vote_ballots b ON b.option_id=o.id AND b.election_id=o.election_id WHERE o.election_id=? GROUP BY o.id ORDER BY o.sort_order,o.id`).all(id);const eligible=Number(db.prepare('SELECT COUNT(*) n FROM vote_eligibility WHERE election_id=?').get(id).n||0),participation=Number(db.prepare('SELECT COUNT(*) n FROM vote_participation WHERE election_id=?').get(id).n||0);const receipts=db.prepare('SELECT receipt_code FROM vote_ballots WHERE election_id=? ORDER BY receipt_code').all(id).map(x=>x.receipt_code);return{election,options,eligible,participation,pending:Math.max(0,eligible-participation),turnout:eligible?Math.round(participation*10000/eligible)/100:0,receipts};}
export function voteParticipants(db,id){id=Number(id);return db.prepare(`SELECT m.id,m.name,m.email,m.rut,e.snapshot_status "snapshotStatus",p.voted_at "votedAt" FROM vote_eligibility e JOIN members m ON m.id=e.member_id LEFT JOIN vote_participation p ON p.election_id=e.election_id AND p.member_id=e.member_id WHERE e.election_id=? ORDER BY CASE WHEN p.voted_at IS NOT NULL THEN 0 ELSE 1 END,p.voted_at DESC,m.name ASC`).all(id).map(r=>({id:r.id,name:r.name,email:r.email,rut:r.rut,status:r.snapshotStatus,voted:!!r.votedAt,votedAt:r.votedAt||null}))}
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

function safeDbCount(db,sql,...args){try{return Number(db.prepare(sql).get(...args)?.n||0)}catch{return 0}}
function safeDbValue(db,sql,...args){try{return db.prepare(sql).get(...args)?.value||null}catch{return null}}
function safeDbRows(db,sql,...args){try{return db.prepare(sql).all(...args)}catch{return[]}}

export function adminMasterSnapshot(db,{today,modules={}}={}){
  const now=nowIso(),since24h=new Date(Date.now()-24*60*60_000).toISOString();
  const quickCheck=safeDbRows(db,'PRAGMA quick_check').map(row=>Object.values(row)[0]);
  const recentErrors=[
    ...safeDbRows(db,"SELECT 'XLSM_MEMBERSHIP_SYNC' source,COALESCE(completed_at,started_at) created_at,error detail FROM financial_membership_sync_runs WHERE status='ERROR' ORDER BY id DESC LIMIT 6"),
    ...safeDbRows(db,"SELECT 'XLSM_SYNC' source,created_at,error detail FROM financial_sync_runs WHERE status='ERROR' ORDER BY id DESC LIMIT 6"),
    ...safeDbRows(db,"SELECT 'BACKUP' source,created_at,error detail FROM backup_runs WHERE status='ERROR' ORDER BY id DESC LIMIT 6"),
    ...safeDbRows(db,"SELECT 'PUSH' source,updated_at created_at,last_error detail FROM push_subscriptions WHERE last_error IS NOT NULL AND TRIM(last_error)<>'' ORDER BY updated_at DESC LIMIT 6")
  ].filter(row=>row.created_at).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,10).map(row=>({
    source:row.source,createdAt:row.created_at,detail:txt(row.detail||'Fallo sin detalle disponible.',240)
  }));
  const backups=safeDbRows(db,'SELECT file_name,status,size_bytes,error,created_at FROM backup_runs ORDER BY id DESC LIMIT 6').map(row=>({
    fileName:row.file_name||null,status:row.status,sizeBytes:Number(row.size_bytes||0),error:row.error?txt(row.error,240):null,createdAt:row.created_at
  }));
  return{
    sessions:{active:safeDbCount(db,'SELECT COUNT(*) n FROM sessions WHERE expires_at>?',now),activeUsers:safeDbCount(db,'SELECT COUNT(DISTINCT member_id) n FROM sessions WHERE expires_at>?',now)},
    activity24h:{events:safeDbCount(db,'SELECT COUNT(*) n FROM audit_log WHERE created_at>=?',since24h),activeUsers:safeDbCount(db,'SELECT COUNT(DISTINCT actor_member_id) n FROM audit_log WHERE created_at>=? AND actor_member_id IS NOT NULL',since24h)},
    parking:{today:safeDbCount(db,"SELECT COUNT(*) n FROM parking_reservations WHERE status='ACTIVE' AND reservation_date=?",today)},
    study:{active:safeDbCount(db,"SELECT COUNT(*) n FROM study_room_reservations WHERE status='ACTIVE' AND end_at>?",now),today:safeDbCount(db,"SELECT COUNT(*) n FROM study_room_reservations WHERE status='ACTIVE' AND substr(start_at,1,10)=?",today),waitlist:safeDbCount(db,"SELECT COUNT(*) n FROM study_room_waitlist WHERE status='ACTIVE'")},
    bdSocios:{records:safeDbCount(db,"SELECT COUNT(*) n FROM members WHERE role!='ADMIN'"),active:safeDbCount(db,"SELECT COUNT(*) n FROM members WHERE role!='ADMIN' AND active=1"),lastRecordUpdate:safeDbValue(db,"SELECT MAX(updated_at) value FROM members WHERE role!='ADMIN'")},
    otp:{pending:safeDbCount(db,'SELECT COUNT(*) n FROM otp_codes WHERE used_at IS NULL AND expires_at>?',now),issued24h:safeDbCount(db,'SELECT COUNT(*) n FROM otp_codes WHERE created_at>=?',since24h),lastIssuedAt:safeDbValue(db,'SELECT MAX(created_at) value FROM otp_codes')},
    push:{subscriptions:safeDbCount(db,'SELECT COUNT(*) n FROM push_subscriptions'),devicesWithError:safeDbCount(db,"SELECT COUNT(*) n FROM push_subscriptions WHERE last_error IS NOT NULL AND TRIM(last_error)<>''"),sent24h:safeDbCount(db,"SELECT COUNT(*) n FROM notification_deliveries WHERE status='SENT' AND created_at>=?",since24h),failed24h:safeDbCount(db,"SELECT COUNT(*) n FROM notification_deliveries WHERE status NOT IN ('SENT','SKIPPED') AND created_at>=?",since24h)},
    sqlite:{ok:quickCheck.length===1&&String(quickCheck[0]).toLowerCase()==='ok',quickCheck:quickCheck.slice(0,3),tables:safeDbCount(db,"SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")},
    modules:{disabled:Object.entries(modules).filter(([,value])=>!value?.enabled).map(([name,value])=>({name,message:value?.message||null}))},
    recentErrors,failedJobs24h:recentErrors.filter(row=>row.createdAt>=since24h).length,backups
  };
}

export function adminReservationsSnapshot(db,{today,liveParking=null}={}){
  const now=nowIso(),date=String(today||now.slice(0,10));
  const parkingRows=(where,args=[])=>safeDbRows(db,`SELECT r.id,r.member_id "memberId",r.reservation_date "reservationDate",r.status,r.created_at "createdAt",p.id "spaceId",p.label "spaceLabel",p.building,m.name "memberName",m.email "memberEmail" FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id JOIN members m ON m.id=r.member_id WHERE ${where} ORDER BY r.reservation_date,r.id`,...args).map(row=>({...row,id:Number(row.id),memberId:Number(row.memberId)}));
  const study=safeDbRows(db,`SELECT r.id,r.member_id "memberId",r.start_at "startAt",r.end_at "endAt",r.created_at "createdAt",rm.name "roomName",m.name "memberName",m.email "memberEmail" FROM study_room_reservations r JOIN study_rooms rm ON rm.id=r.room_id JOIN members m ON m.id=r.member_id WHERE r.status='ACTIVE' AND r.end_at>? ORDER BY r.start_at LIMIT 300`,now).map(row=>({...row,id:Number(row.id),memberId:Number(row.memberId)}));
  const waitlist=safeDbRows(db,`SELECT w.id,w.member_id "memberId",w.start_at "startAt",w.end_at "endAt",w.created_at "createdAt",w.notified_at "notifiedAt",rm.name "roomName",m.name "memberName",m.email "memberEmail" FROM study_room_waitlist w JOIN study_rooms rm ON rm.id=w.room_id JOIN members m ON m.id=w.member_id WHERE w.status='ACTIVE' ORDER BY w.start_at LIMIT 300`).map(row=>({...row,id:Number(row.id),memberId:Number(row.memberId)}));
  const parkingToday=parkingRows("r.status='ACTIVE' AND r.reservation_date=?",[date]);
  const parkingActive=parkingRows("r.status='ACTIVE' AND r.reservation_date>=?",[date]).slice(0,300);
  const rawSpaces=safeDbRows(db,"SELECT id,label,building,board_only \"boardOnly\",sort_order \"sortOrder\" FROM parking_spaces WHERE active=1 ORDER BY CAST(building AS INTEGER),sort_order,label");
  const localSpaces=rawSpaces.map(s=>{
    const res=parkingToday.find(r=>String(r.spaceId)===String(s.id))||null;
    return{
      id:s.id,label:s.label,building:s.building,boardOnly:!!s.boardOnly,
      occupied:!!res,
      reservation:res?{id:res.id,memberId:res.memberId,memberName:res.memberName,memberEmail:res.memberEmail,createdAt:res.createdAt,reservationDate:res.reservationDate}:null
    };
  });
  const audit=safeDbRows(db,`SELECT a.id,a.action,a.entity_type "entityType",a.entity_id "entityId",a.created_at "createdAt",actor.name "actorName",subject.name "subjectName" FROM audit_log a LEFT JOIN members actor ON actor.id=a.actor_member_id LEFT JOIN members subject ON subject.id=a.subject_member_id WHERE a.action IN ('ADMIN_PARKING_RELEASED','ADMIN_STUDY_RESERVATION_CANCELLED') ORDER BY a.id DESC LIMIT 20`).map(row=>({...row,id:Number(row.id)}));

  const isLive=!!(liveParking&&liveParking.live);
  const parkingData={
    live:isLive,
    source:liveParking?.source||'SQLITE_LOCAL',
    sourceLabel:liveParking?.sourceLabel||'SQLite local',
    readAt:liveParking?.readAt||now,
    warning:liveParking?.warning||null,
    today:isLive?liveParking.today:parkingToday,
    active:isLive?liveParking.active:parkingActive,
    spaces:isLive?liveParking.spaces:localSpaces
  };

  return{
    generatedAt:now,today:date,
    summary:{
      parkingSpaces:rawSpaces.filter(s=>!s.boardOnly).length,
      parkingToday:parkingData.today.length,
      parkingActive:isLive?parkingData.active.length:safeDbCount(db,"SELECT COUNT(*) n FROM parking_reservations WHERE status='ACTIVE' AND reservation_date>=?",date),
      studyActive:safeDbCount(db,"SELECT COUNT(*) n FROM study_room_reservations WHERE status='ACTIVE' AND end_at>?",now),
      waitlistActive:safeDbCount(db,"SELECT COUNT(*) n FROM study_room_waitlist WHERE status='ACTIVE'")
    },
    parking:parkingData,study:{active:study,waitlist},
    simulators:{status:'NO_RELIABLE_LOCAL_SOURCE',available:false,detail:'Fuente no disponible / local no fiable.',impact:'No se muestran ni administran turnos hasta contar con una sincronización local segura.'},
    audit
  };
}

function auditCategory(action='',entityType=''){
  const value=`${action} ${entityType}`.toUpperCase();
  if(/PUSH|NOTIFICATION|NOTIFICACION|OTP/.test(value))return'NOTIFICACIONES';
  if(/SESSION|PASSKEY|PIN|CREDENTIAL|SECURITY|AUTH|LOGIN|WEBAUTHN/.test(value))return'SEGURIDAD';
  if(/PARKING|STUDY|SIMULATOR|RESERV/.test(value))return'RESERVAS';
  if(/FINANC|XLSM|MEMBERSHIP|PAYMENT/.test(value))return'FINANZAS';
  if(/MARKET|ACTIVIT|NEWS|LIBRARY|AGREEMENT|VOTE|CONTENT/.test(value))return'CONTENIDO';
  if(/BACKUP|DATABASE|DB_|CACHE|JOB|MODULE|SYSTEM/.test(value))return'SISTEMA';
  if(/MEMBER|PROFILE|SOCIO/.test(value))return'SOCIOS';
  return'OTROS';
}
function auditResult(action=''){return/FAIL|ERROR|REJECT|DENIED/i.test(String(action))?'ERROR':'OK'}
function sanitizedAuditSummary(value){
  let details=null;try{details=JSON.parse(value||'null')}catch{}
  if(!details||typeof details!=='object'||Array.isArray(details))return'';
  const allowed=new Set(['removed','sessionsRemoved','status','enabled','source','mode','size','recipients','sent','rows','changed','delivered','externalWrites','externalNotifications','secretsExposed','expired','subscriptions']);
  return Object.entries(details).filter(([key,item])=>allowed.has(key)&&['string','number','boolean'].includes(typeof item)).slice(0,5).map(([key,item])=>`${key}: ${String(item).slice(0,80)}`).join(' · ');
}
function sanitizedAuditRow(row){return{id:Number(row.id),createdAt:row.created_at,actorName:row.actor_name||'Sistema',action:row.action,subjectId:row.subject_member_id==null?null:Number(row.subject_member_id),subjectName:row.subject_name||null,category:auditCategory(row.action,row.entity_type),result:auditResult(row.action),summary:sanitizedAuditSummary(row.detail_json),entityType:row.entity_type||null}}
function auditBaseRows(db,{from='',to='',action='',memberId=null}={}){
  const where=[],args=[];
  if(/^\d{4}-\d{2}-\d{2}$/.test(from)){where.push('a.created_at>=?');args.push(`${from}T00:00:00.000Z`)}
  if(/^\d{4}-\d{2}-\d{2}$/.test(to)){const end=new Date(`${to}T00:00:00.000Z`);end.setUTCDate(end.getUTCDate()+1);where.push('a.created_at<?');args.push(end.toISOString())}
  if(action){where.push('a.action=?');args.push(String(action).slice(0,120))}
  if(Number(memberId)>0){where.push('a.subject_member_id=?');args.push(Number(memberId))}
  return db.prepare(`SELECT a.id,a.created_at,a.action,a.entity_type,a.subject_member_id,a.detail_json,actor.name actor_name,subject.name subject_name FROM audit_log a LEFT JOIN members actor ON actor.id=a.actor_member_id LEFT JOIN members subject ON subject.id=a.subject_member_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY a.id DESC LIMIT 1000`).all(...args).map(sanitizedAuditRow);
}
export function adminAuditSnapshot(db,{from='',to='',action='',memberId=null,category='',limit=200}={}){
  limit=Math.max(1,Math.min(500,Number(limit)||200));category=String(category||'').toUpperCase();
  let rows=auditBaseRows(db,{from,to,action,memberId});if(category)rows=rows.filter(row=>row.category===category);const total=rows.length;rows=rows.slice(0,limit);
  const actions=safeDbRows(db,'SELECT DISTINCT action FROM audit_log ORDER BY action LIMIT 250').map(row=>row.action);
  const members=safeDbRows(db,`SELECT DISTINCT m.id,m.name FROM audit_log a JOIN members m ON m.id=a.subject_member_id ORDER BY m.name LIMIT 250`).map(row=>({id:Number(row.id),name:row.name}));
  return{generatedAt:nowIso(),total,limit,rows,filters:{actions,members,categories:['NOTIFICACIONES','SEGURIDAD','RESERVAS','FINANZAS','CONTENIDO','SISTEMA','SOCIOS','OTROS']}};
}
export function adminNotificationsSnapshot(db,{pushReady=false,gmailOtpReady=false}={}){
  const now=nowIso(),since24h=new Date(Date.now()-24*60*60_000).toISOString();
  const subscriptions=safeDbCount(db,'SELECT COUNT(*) n FROM push_subscriptions'),subscribers=safeDbCount(db,'SELECT COUNT(DISTINCT member_id) n FROM push_subscriptions'),devicesWithError=safeDbCount(db,"SELECT COUNT(*) n FROM push_subscriptions WHERE last_error IS NOT NULL AND TRIM(last_error)<>''");
  const delivered24h=safeDbCount(db,"SELECT COUNT(*) n FROM notification_deliveries WHERE status='SENT' AND created_at>=?",since24h),failed24h=safeDbCount(db,"SELECT COUNT(*) n FROM notification_deliveries WHERE status='FAILED' AND created_at>=?",since24h),lastSentAt=safeDbValue(db,"SELECT MAX(sent_at) value FROM notification_deliveries WHERE status='SENT'");
  const otp={issued24h:safeDbCount(db,'SELECT COUNT(*) n FROM otp_codes WHERE created_at>=?',since24h),pending:safeDbCount(db,'SELECT COUNT(*) n FROM otp_codes WHERE used_at IS NULL AND expires_at>?',now),expired:safeDbCount(db,'SELECT COUNT(*) n FROM otp_codes WHERE used_at IS NULL AND expires_at<=?',now),lastIssuedAt:safeDbValue(db,'SELECT MAX(created_at) value FROM otp_codes')};
  const pushErrors=safeDbRows(db,`SELECT p.updated_at created_at,m.name member_name FROM push_subscriptions p LEFT JOIN members m ON m.id=p.member_id WHERE p.last_error IS NOT NULL AND TRIM(p.last_error)<>'' ORDER BY p.updated_at DESC LIMIT 8`).map(row=>({source:'PUSH',createdAt:row.created_at,memberName:row.member_name||null,summary:'Dispositivo Push con error de entrega.'}));
  const deliveryErrors=safeDbRows(db,`SELECT d.created_at,d.kind,d.status,m.name member_name FROM notification_deliveries d LEFT JOIN members m ON m.id=d.member_id WHERE d.status='FAILED' ORDER BY d.id DESC LIMIT 8`).map(row=>({source:'ENTREGA',createdAt:row.created_at,memberName:row.member_name||null,summary:`Entrega ${txt(row.kind||'general',50)} no completada (${txt(row.status||'FAILED',30)}).`}));
  return{generatedAt:now,push:{enabled:!!pushReady,status:pushReady?(devicesWithError?'ADVERTENCIA':'OK'):'DESHABILITADO',subscriptions,subscribers,devicesWithError,delivered24h,failed24h,lastSentAt,deadCleanupAvailable:false},gmailOtp:{enabled:!!gmailOtpReady,status:gmailOtpReady?'OK':'DESHABILITADO',...otp},recentErrors:[...pushErrors,...deliveryErrors].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,12),actions:{issueOtpFromMember:gmailOtpReady,deadPushCleanup:false}};
}
function maskedSecurityEmail(email=''){const [local,domain]=String(email||'').toLowerCase().split('@');if(!local||!domain)return'';return`${local.slice(0,2)}${'*'.repeat(Math.max(1,Math.min(5,local.length-2)))}@${domain}`}
export function adminSecuritySnapshot(db,{adminEmail='',gmailOtpReady=false}={}){
  const now=nowIso();
  const members=safeDbRows(db,`SELECT m.id,m.name,m.email,m.active,CASE WHEN m.pin_hash IS NULL THEN 0 ELSE 1 END pin_configured,(SELECT COUNT(*) FROM sessions s WHERE s.member_id=m.id AND s.expires_at>?) active_sessions,(SELECT COUNT(*) FROM sessions s WHERE s.member_id=m.id AND s.expires_at>? AND (s.unlocked_until IS NULL OR s.unlocked_until<=?)) locked_sessions,(SELECT COUNT(*) FROM passkeys p WHERE p.member_id=m.id) passkeys,(SELECT MAX(p.last_used_at) FROM passkeys p WHERE p.member_id=m.id) last_passkey_use,(SELECT COUNT(*) FROM otp_codes o WHERE o.member_id=m.id AND o.used_at IS NULL AND o.expires_at>?) pending_otp FROM members m WHERE m.role!='ADMIN' ORDER BY active_sessions DESC,passkeys DESC,m.name LIMIT 150`,now,now,now,now).map(row=>({id:Number(row.id),name:row.name,emailMasked:maskedSecurityEmail(row.email),active:!!row.active,pinConfigured:!!row.pin_configured,activeSessions:Number(row.active_sessions||0),lockedSessions:Number(row.locked_sessions||0),passkeys:Number(row.passkeys||0),lastPasskeyUse:row.last_passkey_use||null,pendingOtp:Number(row.pending_otp||0)})).filter(row=>row.activeSessions||row.passkeys||row.pinConfigured||row.pendingOtp);
  const admin=db.prepare("SELECT id,email,active,CASE WHEN pin_hash IS NULL THEN 0 ELSE 1 END pin_configured FROM members WHERE role='ADMIN' AND email=?").get(String(adminEmail||'').toLowerCase());
  const securityEvents=auditBaseRows(db,{}).filter(row=>row.category==='SEGURIDAD'||row.category==='NOTIFICACIONES').slice(0,30);
  return{generatedAt:now,summary:{activeSessions:safeDbCount(db,'SELECT COUNT(*) n FROM sessions WHERE expires_at>?',now),usersWithMultipleSessions:safeDbCount(db,'SELECT COUNT(*) n FROM (SELECT member_id FROM sessions WHERE expires_at>? GROUP BY member_id HAVING COUNT(*)>1)',now),lockedSessions:safeDbCount(db,'SELECT COUNT(*) n FROM sessions WHERE expires_at>? AND (unlocked_until IS NULL OR unlocked_until<=?)',now,now),passkeys:safeDbCount(db,'SELECT COUNT(*) n FROM passkeys'),lastPasskeyUse:safeDbValue(db,'SELECT MAX(last_used_at) value FROM passkeys'),pinConfigured:safeDbCount(db,"SELECT COUNT(*) n FROM members WHERE role!='ADMIN' AND pin_hash IS NOT NULL"),pinMissing:safeDbCount(db,"SELECT COUNT(*) n FROM members WHERE role!='ADMIN' AND pin_hash IS NULL")},attempts:{sourceAvailable:false,detail:'Los intentos y fallos de acceso no se persisten actualmente.'},accountBlocks:{sourceAvailable:false,detail:'No existe un bloqueo persistente de cuentas; solo rate limiting en memoria.'},admin:{configured:!!admin,active:!!admin?.active,emailMatches:!!admin&&String(admin.email).toLowerCase()===String(adminEmail).toLowerCase(),pinConfigured:!!admin?.pin_configured},gmailOtpEnabled:!!gmailOtpReady,members,events:securityEvents};
}
export function dbStats(db){const tables=db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(x=>x.name);return tables.map(name=>{try{return{name,count:Number(db.prepare(`SELECT COUNT(*) n FROM "${name.replace(/"/g,'""')}"`).get().n||0)}}catch{return{name,count:null}}})}

export function createBackup(db,{backupDir,retention=14,actorId=null}={}){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const stamp=new Date().toISOString().replace(/[:.]/g,'-');const fileName=`mi-aspch-${stamp}.sqlite`;const target=path.join(backupDir,fileName);try{db.exec(`VACUUM INTO '${target.replace(/'/g,"''")}'`);const size=fs.statSync(target).size;db.prepare(`INSERT INTO backup_runs(file_name,status,size_bytes,created_at) VALUES (?,'OK',?,?)`).run(fileName,size,nowIso());cleanupBackups(backupDir,retention);audit(db,{actorId,action:'BACKUP_CREATED',entityType:'backup',entityId:fileName,details:{size}});return{ok:true,fileName,size}}catch(err){db.prepare(`INSERT INTO backup_runs(file_name,status,size_bytes,error,created_at) VALUES (?,'ERROR',0,?,?)`).run(fileName,txt(err.message,600),nowIso());return{ok:false,error:err.message}}
}
export function backupRuns(db){return db.prepare(`SELECT * FROM backup_runs ORDER BY id DESC LIMIT 100`).all()}
function cleanupBackups(dir,retention){const files=fs.readdirSync(dir).filter(x=>/^mi-aspch-.*\.sqlite$/.test(x)).map(name=>({name,mtime:fs.statSync(path.join(dir,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);for(const f of files.slice(Math.max(1,Number(retention)||14)))try{fs.unlinkSync(path.join(dir,f.name))}catch{}}

export function invalidateOtherSessions(db,{memberId,currentSessionId,actorId}){const r=db.prepare(`DELETE FROM sessions WHERE member_id=? AND id<>?`).run(memberId,currentSessionId);audit(db,{actorId:actorId||memberId,subjectId:memberId,action:'OTHER_SESSIONS_REVOKED',entityType:'session',details:{removed:Number(r.changes||0)}});return Number(r.changes||0)}
export function invalidateMemberSessions(db,{memberId,actorId}){const r=db.prepare(`DELETE FROM sessions WHERE member_id=?`).run(memberId);audit(db,{actorId,subjectId:memberId,action:'ALL_SESSIONS_REVOKED',entityType:'session',details:{removed:Number(r.changes||0)}});return Number(r.changes||0)}

export function memberAccessBlock(db,memberId){const id=Number(memberId);if(!Number.isSafeInteger(id)||id<=0)return{blocked:false,reason:null,updatedAt:null};const row=db.prepare('SELECT blocked,reason,updated_at FROM member_access_blocks WHERE member_id=?').get(id);return{blocked:Number(row?.blocked)===1,reason:row?.reason||null,updatedAt:row?.updated_at||null}}
export function setMemberAccessBlocked(db,{memberId,blocked,reason='',actorId}){const stamp=nowIso();db.prepare(`INSERT INTO member_access_blocks(member_id,blocked,reason,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(Number(memberId),blocked?1:0,blocked?(txt(reason,300)||'Bloqueo administrativo'):null,Number(actorId),stamp);audit(db,{actorId,subjectId:Number(memberId),action:blocked?'ADMIN_MEMBER_ACCESS_BLOCKED':'ADMIN_MEMBER_ACCESS_RESTORED',entityType:'member_access',entityId:Number(memberId),details:{reason:blocked?(txt(reason,300)||'Bloqueo administrativo'):null}});return memberAccessBlock(db,memberId)}

export function adminMemberSearch(db,q){q=String(q||'').trim();if(q.length<2)return[];const like=`%${q}%`;return db.prepare(`SELECT m.id,m.name,m.email,m.rut,m.employer,m.category,m.position,m.role,m.active,m.is_board,f.financial_status,f.months_due,f.amount_due,c.revoked AS credential_revoked,(SELECT COUNT(*) FROM sessions s WHERE s.member_id=m.id AND s.expires_at>?) AS active_sessions,(SELECT COUNT(*) FROM push_subscriptions p WHERE p.member_id=m.id) AS push_devices FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id LEFT JOIN credential_status c ON c.member_id=m.id WHERE m.name LIKE ? OR m.email LIKE ? OR m.rut LIKE ? ORDER BY m.name LIMIT 50`).all(nowIso(),like,like,like)}

const ADMIN_MEMBER_STATES=new Set(['ACTIVO','AL_DIA','MOROSO','CONGELADO','DESAFILIADO','JUBILADO','DIRECTORIO']);
function adminMemberState(row){
  const financial=String(row?.financial_status||'').trim().toUpperCase();
  if(ADMIN_MEMBER_STATES.has(financial))return financial==='AL_DIA'?'ACTIVO':financial;
  return Number(row?.active)===1?'ACTIVO':null;
}
function maskedRut(value){
  const clean=String(value||'').toUpperCase().replace(/[^0-9K]/g,'');
  if(clean.length<2)return null;
  const tail=clean.slice(-4,-1),dv=clean.slice(-1);
  return `•••${tail}-${dv}`;
}
function maskedEmail(value){
  const [local='',domain='']=String(value||'').trim().toLowerCase().split('@');
  if(!local||!domain)return null;
  const parts=domain.split('.'),tld=parts.length>1?`.${parts.at(-1)}`:'';
  return `${local.slice(0,1)}•••@${parts[0].slice(0,1)}•••${tld}`;
}
function likeValue(value){return `%${String(value||'').replace(/[\\%_]/g,'\\$&')}%`}
function latestIso(...values){
  return values.filter(value=>value&&Number.isFinite(new Date(value).getTime())).sort((a,b)=>new Date(b)-new Date(a))[0]||null;
}

export function adminMembersList(db,{query='',page=1,limit=20}={}){
  const q=String(query||'').trim().slice(0,120),safeLimit=Math.max(1,Math.min(50,Number(limit)||20)),safePage=Math.max(1,Math.floor(Number(page)||1));
  const where=["m.role!='ADMIN'"];const args=[];
  if(q){
    const like=likeValue(q),rutNeedle=q.toUpperCase().replace(/[^0-9K]/g,''),conditions=[`m.name LIKE ? ESCAPE '\\'`,`m.email LIKE ? ESCAPE '\\'`];args.push(like,like);
    if(rutNeedle){conditions.push(`REPLACE(REPLACE(REPLACE(UPPER(COALESCE(m.rut,'')),'.',''),'-',''),' ','') LIKE ?`);args.push(`%${rutNeedle}%`)}
    where.push(`(${conditions.join(' OR ')})`);
  }
  const clause=where.join(' AND '),total=Number(db.prepare(`SELECT COUNT(*) n FROM members m WHERE ${clause}`).get(...args).n||0),pages=Math.max(1,Math.ceil(total/safeLimit)),current=Math.min(safePage,pages),offset=(current-1)*safeLimit;
  const rows=db.prepare(`SELECT m.id,m.name,m.email,m.rut,m.active,f.financial_status,COALESCE(b.blocked,0) access_blocked FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id LEFT JOIN member_access_blocks b ON b.member_id=m.id WHERE ${clause} ORDER BY m.name COLLATE NOCASE,m.id LIMIT ? OFFSET ?`).all(...args,safeLimit,offset);
  return{query:q,page:current,limit:safeLimit,total,pages,members:rows.map(row=>({id:Number(row.id),name:row.name,rutMasked:maskedRut(row.rut),emailMasked:maskedEmail(row.email),membershipState:adminMemberState(row),accessBlocked:Number(row.access_blocked)===1}))};
}

const MEMBER_MODULE_LABELS={parking:'Estacionamiento',simulatorView:'Ver simuladores',simulatorRequest:'Solicitar simulador',studyRoom:'Sala de estudios',marketplace:'Mercado ASPCH'};
function canonicalMembershipState(value){
  const state=String(value||'').trim().toUpperCase();
  if(['ACTIVO','AL_DIA'].includes(state))return'ACTIVO';
  return state||null;
}
function membershipDiagnosis(authority,applied){
  if(!authority?.sourceReady)return[{severity:'warning',code:'XLSM_NO_DISPONIBLE',title:'Estado real no disponible',message:'No fue posible leer una fuente XLSM autoritativa para comparar este socio.'}];
  if(authority.matchIssue)return[{severity:'warning',code:authority.matchIssue,title:'Comparación no concluyente',message:authority.matchIssue==='RUT_DUPLICADO'?'El RUT aparece más de una vez en el XLSM; no se aplicó un estado autoritativo.':'No existe una coincidencia segura por RUT válido y único en el XLSM.'}];
  const source=canonicalMembershipState(authority.status==='NO_CLASIFICADO'?null:authority.status),current=canonicalMembershipState(applied.state);
  if(!source)return[{severity:'info',code:'XLSM_SIN_ESTADO_EXPLICITO',title:'Sin estado explícito',message:'El XLSM no declara un estado interpretable; Mi ASPCH no debe inferirlo.'}];
  if(source===current)return[{severity:'ok',code:'CONSISTENTE',title:'Fuentes consistentes',message:`XLSM y Mi ASPCH coinciden en ${source}.`}];
  const critical=source==='DESAFILIADO'&&current!=='DESAFILIADO';
  return[{severity:critical?'critical':'warning',code:'APP_DESACTUALIZADA',title:critical?'Inconsistencia crítica':'Inconsistencia: app desactualizada',message:`XLSM = ${source}; Mi ASPCH = ${current||'NO DISPONIBLE'}. No se corrigió automáticamente.`}];
}

export function adminMemberDetail(db,id,{authority=null,modules={},otpDeliveryEnabled=false}={}){
  id=Number(id);if(!Number.isSafeInteger(id)||id<=0)return null;
  const row=db.prepare(`SELECT m.id,m.name,m.preferred_name,m.rut,m.email,m.phone,m.employer,m.category,m.position,m.birth_date,m.joined_at,m.active,m.pin_hash,m.pin_updated_at,m.updated_at,f.source_status,f.financial_status,f.months_due,f.amount_due,f.amount_evidence,f.source_year,f.source_updated_at,f.synced_at,f.deactivated_by_financial FROM members m LEFT JOIN member_financial_status f ON f.member_id=m.id WHERE m.id=? AND m.role!='ADMIN'`).get(id);
  if(!row)return null;
  const now=nowIso(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),accessBlock=memberAccessBlock(db,id);
  const parking=db.prepare(`SELECT r.id,r.reservation_date,p.label,p.building FROM parking_reservations r JOIN parking_spaces p ON p.id=r.space_id WHERE r.member_id=? AND r.status='ACTIVE' AND r.reservation_date>=? ORDER BY r.reservation_date,r.id LIMIT 25`).all(id,today).map(r=>({type:'PARKING',id:Number(r.id),date:r.reservation_date,label:r.label,building:r.building}));
  const study=db.prepare(`SELECT r.id,r.start_at,r.end_at,rm.name room_name FROM study_room_reservations r JOIN study_rooms rm ON rm.id=r.room_id WHERE r.member_id=? AND r.status='ACTIVE' AND r.end_at>? ORDER BY r.start_at,r.id LIMIT 25`).all(id,now).map(r=>({type:'STUDY_ROOM',id:Number(r.id),start:r.start_at,end:r.end_at,label:r.room_name}));
  const hasFinancial=!!row.financial_status,appliedState=adminMemberState(row),restricted=row.financial_status==='MOROSO',inactive=row.financial_status==='DESAFILIADO'||Number(row.active)!==1;
  const access={parking:!restricted&&!inactive,simulatorView:!inactive,simulatorRequest:!restricted&&!inactive,studyRoom:!restricted&&!inactive,marketplace:!inactive};
  const globallyDisabled=new Set(Object.entries(modules).filter(([,value])=>!value?.enabled).map(([name])=>name));
  const moduleMap={parking:'parking',simulatorView:'simulators',simulatorRequest:'simulators',studyRoom:'studyroom',marketplace:'marketplace'};
  const allowedModules=[],blockedModules=[];
  for(const [key,label] of Object.entries(MEMBER_MODULE_LABELS))((access[key]&&!globallyDisabled.has(moduleMap[key]))?allowedModules:blockedModules).push(label);
  const sessions=db.prepare('SELECT created_at,expires_at,unlocked_until FROM sessions WHERE member_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 20').all(id,now);
  const passkeySummary=db.prepare('SELECT COUNT(*) n,MAX(created_at) last_created_at,MAX(last_used_at) last_used_at FROM passkeys WHERE member_id=?').get(id);
  const otp=db.prepare('SELECT created_at,expires_at,used_at FROM otp_codes WHERE member_id=? ORDER BY id DESC LIMIT 1').get(id)||null;
  const lastActivity=db.prepare('SELECT MAX(created_at) last_at FROM audit_log WHERE actor_member_id=?').get(id)?.last_at||null;
  const independentInactive=hasFinancial&&Number(row.active)!==1&&row.financial_status!=='DESAFILIADO'&&Number(row.deactivated_by_financial)!==1;
  const applied={state:appliedState,financialState:hasFinancial?row.financial_status:null,activeFlag:Number(row.active)===1,restrictions:blockedModules,allowedModules,blockedModules,cause:hasFinancial?`Estado ${row.financial_status} aplicado desde ${row.source_status||'fuente no registrada'}; última sincronización ${row.synced_at||'sin fecha'}.${independentInactive?' members.active=0 se conserva por una causa independiente del XLSM.':''}`:`Indicador members.active=${Number(row.active)===1?1:0}; no existe estado financiero local sincronizado.`};
  return{
    member:{id:Number(row.id),name:row.name,officialName:row.name,preferredName:row.preferred_name||null,rut:row.rut||null,email:row.email||null,phone:row.phone||null,employer:row.employer||null,membershipState:appliedState,accessBlocked:accessBlock.blocked,accessBlockReason:accessBlock.reason,accessBlockUpdatedAt:accessBlock.updatedAt},
    realState:{status:authority?.status||null,originalComment:authority?.originalComment??null,sourceName:authority?.sourceName||null,sourceRow:authority?.sourceRow||null,lastReadAt:authority?.lastReadAt||null,sourceModifiedAt:authority?.sourceModifiedAt||null,sourceReady:authority?.sourceReady===true,matchIssue:authority?.matchIssue||null},
    appliedState:applied,
    personal:{source:'BD SOCIOS',officialName:row.name||null,preferredName:row.preferred_name||null,rut:row.rut||null,email:row.email||null,phone:row.phone||null,employer:row.employer||null,category:row.category||null,position:row.position||null,birthDate:row.birth_date||null,joinedAt:row.joined_at||null,lastSyncAt:row.updated_at||null},
    financial:{status:hasFinancial?row.financial_status:null,sourceStatus:hasFinancial?(row.source_status||null):null,monthsDue:hasFinancial?Number(row.months_due||0):null,amountDue:hasFinancial?Number(row.amount_due||0):null,amountEvidence:hasFinancial?(row.amount_evidence||'LEGACY_UNKNOWN'):null,sourceYear:hasFinancial?(row.source_year||null):null},
    security:{activeSessions:sessions.length,sessions:sessions.map(session=>({createdAt:session.created_at,expiresAt:session.expires_at,unlocked:!!session.unlocked_until&&new Date(session.unlocked_until)>new Date()})),passkeys:Number(passkeySummary.n||0),passkeyLastCreatedAt:passkeySummary.last_created_at||null,passkeyLastUsedAt:passkeySummary.last_used_at||null,pinConfigured:!!row.pin_hash,pinUpdatedAt:row.pin_updated_at||null,otp:{pending:!!otp&&!otp.used_at&&new Date(otp.expires_at)>new Date(),lastIssuedAt:otp?.created_at||null,expiresAt:otp?.expires_at||null,deliveryEnabled:!!otpDeliveryEnabled},lastAccessAt:latestIso(lastActivity,passkeySummary.last_used_at,sessions[0]?.created_at)},
    reservations:[...parking,...study].sort((a,b)=>String(a.date||a.start).localeCompare(String(b.date||b.start))),
    diagnosis:membershipDiagnosis(authority,applied),
    actions:{closeSessions:sessions.length>0,revokePasskeys:Number(passkeySummary.n||0)>0,resetPin:!!row.pin_hash,issueOtp:!!otpDeliveryEnabled,releaseParking:parking.length>0,cancelStudy:study.length>0,blockUser:!accessBlock.blocked,unblockUser:accessBlock.blocked,refresh:true},
    lastUpdate:{memberUpdatedAt:row.updated_at||null,financialSyncedAt:hasFinancial?(row.synced_at||null):null,financialSourceUpdatedAt:hasFinancial?(row.source_updated_at||null):null,latestAvailable:latestIso(row.updated_at,hasFinancial?row.synced_at:null,hasFinancial?row.source_updated_at:null,authority?.lastReadAt)}
  };
}

export function diagnostics(db,{version,google,push,financial,moduleStates:mods,dataDir}={}){return{generatedAt:nowIso(),version,google,push,financial,modules:mods,metrics:systemMetrics(db),database:dbStats(db),storage:{dataDir:path.basename(dataDir||'data')},node:process.version,platform:process.platform,uptimeSeconds:Math.round(process.uptime()),memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}}}

export function toIcs({uid,title,start,end,description='',location='',url=''}){const f=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ASPCH//Mi ASPCH//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${esc(uid)}@mi-aspch`,`DTSTAMP:${f(new Date())}`,`DTSTART:${f(start)}`,`DTEND:${f(end)}`,`SUMMARY:${esc(title)}`,description?`DESCRIPTION:${esc(description)}`:'',location?`LOCATION:${esc(location)}`:'',url?`URL:${esc(url)}`:'','END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n')+'\r\n'}
