import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as _XLSX from 'xlsx';
const XLSX = _XLSX.default || _XLSX;

const TZ='America/Santiago';
const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const EXEMPT_STATUS=new Set(['CONGELADO','JUBILADO','DIRECTORIO']);

const isoNow=()=>new Date().toISOString();
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
const normalizeRut=v=>{const c=String(v||'').toUpperCase().replace(/[^0-9K]/g,'');return c.length>1?`${c.slice(0,-1)}-${c.slice(-1)}`:''};
const chileParts=(date=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const numberValue=v=>{
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(v==null||v==='')return 0;
  let s=String(v).trim().replace(/\s/g,'').replace(/\$/g,'');
  if(!s)return 0;
  if(/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
  else if(/^[-+]?\d+(,\d+)$/.test(s))s=s.replace(',','.');
  else s=s.replace(/[^0-9.-]/g,'');
  const n=Number(s);return Number.isFinite(n)?n:0;
};

export function initV050(db,{adminEmail='informatica@aspch.org',adminPinSalt='',adminPinHash=''}={}){
  db.exec(`
    CREATE TABLE IF NOT EXISTS member_financial_status (
      member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      rut TEXT,
      source_status TEXT,
      financial_status TEXT NOT NULL DEFAULT 'AL_DIA',
      months_due INTEGER NOT NULL DEFAULT 0,
      amount_due INTEGER NOT NULL DEFAULT 0,
      source_year INTEGER,
      source_updated_at TEXT,
      synced_at TEXT NOT NULL,
      deactivated_by_financial INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS member_financial_months (
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      month_name TEXT NOT NULL,
      paid_amount INTEGER NOT NULL DEFAULT 0,
      due_amount INTEGER NOT NULL DEFAULT 0,
      overdue INTEGER NOT NULL DEFAULT 0,
      review TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(member_id,year,month)
    );
    CREATE TABLE IF NOT EXISTS financial_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_mtime TEXT,
      status TEXT NOT NULL,
      rows_seen INTEGER NOT NULL DEFAULT 0,
      members_matched INTEGER NOT NULL DEFAULT 0,
      morosos INTEGER NOT NULL DEFAULT 0,
      desafiliados INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      topics_json TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_push_member ON push_subscriptions(member_id);
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      notification_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT,
      body TEXT,
      status TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS study_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS study_room_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES study_rooms(id),
      member_id INTEGER NOT NULL REFERENCES members(id),
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_study_time ON study_room_reservations(room_id,start_at,end_at,status);
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL,
      contact TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      moderation_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      expires_at TEXT,
      sold_at TEXT
    );
    CREATE TABLE IF NOT EXISTS marketplace_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_market_status ON marketplace_listings(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      starts_at TEXT,
      ends_at TEXT,
      registration_open_at TEXT,
      registration_close_at TEXT,
      external_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT OR IGNORE INTO study_rooms(name,active,created_at) VALUES ('Sala de estudios',1,?)`).run(isoNow());
  const email=String(adminEmail||'').trim().toLowerCase();
  if(email){
    let m=db.prepare('SELECT * FROM members WHERE email=?').get(email);
    if(!m){
      db.prepare(`INSERT INTO members(email,name,preferred_name,rut,employer,category,position,role,active,is_board,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(email,'INFORMÁTICA ASPCH','Informática',null,'ASPCH','Administración','ADMIN','ADMIN',1,0,isoNow());
      m=db.prepare('SELECT * FROM members WHERE email=?').get(email);
    }else{
      db.prepare(`UPDATE members SET role='ADMIN',active=1,is_board=0,rut=NULL,name='INFORMÁTICA ASPCH',preferred_name=COALESCE(NULLIF(preferred_name,''),'Informática'),updated_at=? WHERE id=?`).run(isoNow(),m.id);
    }
    if(adminPinSalt&&adminPinHash&&!m?.pin_hash){
      db.prepare('UPDATE members SET pin_salt=?,pin_hash=?,pin_updated_at=?,updated_at=? WHERE email=?').run(adminPinSalt,adminPinHash,isoNow(),isoNow(),email);
    }
  }
}

export function financialSummary(db,member){
  if(!member)return null;
  const row=db.prepare('SELECT * FROM member_financial_status WHERE member_id=?').get(member.id);
  const status=member.role==='ADMIN'?'AL_DIA':String(row?.financial_status||'AL_DIA').toUpperCase();
  return {
    status,
    sourceStatus:row?.source_status||null,
    monthsDue:Number(row?.months_due||0),
    amountDue:Number(row?.amount_due||0),
    sourceYear:row?.source_year||null,
    syncedAt:row?.synced_at||null,
    moroso:status==='MOROSO',
    frozen:status==='CONGELADO',
    disaffiliated:status==='DESAFILIADO'
  };
}

export function benefitAccess(db,member){
  const f=financialSummary(db,member);
  if(member?.role==='ADMIN')return {parking:true,simulatorView:true,simulatorRequest:true,studyRoom:true,marketplace:true,reason:null,financial:f};
  const restricted=f?.status==='MOROSO';
  const inactive=f?.status==='DESAFILIADO'||!member?.active;
  return {
    parking:!restricted&&!inactive,
    simulatorView:!inactive,
    simulatorRequest:!restricted&&!inactive,
    studyRoom:!restricted&&!inactive,
    marketplace:!inactive,
    reason:inactive?'DESAFILIADO':restricted?'MOROSO':null,
    financial:f
  };
}

export function latestFinancialSync(db){return db.prepare('SELECT * FROM financial_sync_runs ORDER BY id DESC LIMIT 1').get()||null}

export function syncFinancialWorkbook(db,file,{year=2026,sheetName='ESTADO PAGO 2026'}={}){
  const started=isoNow();let rowsSeen=0,matched=0,morosos=0,desafiliados=0;
  try{
    if(!file||!fs.existsSync(file))throw new Error(`Fuente XLSM no encontrada: ${file||'(sin ruta)'}`);
    const stat=fs.statSync(file);
    const wb=XLSX.readFile(file,{cellDates:true,cellStyles:true,raw:true});
    const ws=wb.Sheets[sheetName];if(!ws)throw new Error(`No existe la hoja ${sheetName}`);
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:true});
    if(rows.length<6)throw new Error('ESTADO PAGO 2026 no contiene filas suficientes.');
    const validSourceRows=rows.slice(5).filter(r=>normalizeRut(r?.[2])&&String(r?.[3]||'').trim()).length;
    if(validSourceRows<100)throw new Error(`Fuente XLSM sospechosamente pequeña (${validSourceRows} filas válidas); no se acepta como fuente.`);
    const p=chileParts();const currentYear=Number(p.year),currentMonth=Number(p.month),currentDay=Number(p.day);
    const syncedAt=isoNow();
    db.exec('BEGIN IMMEDIATE');
    const stmtMember=db.prepare("SELECT * FROM members WHERE REPLACE(REPLACE(UPPER(COALESCE(rut,'')),'.',''),' ','')=?");
    const upStatus=db.prepare(`INSERT INTO member_financial_status(member_id,rut,source_status,financial_status,months_due,amount_due,source_year,source_updated_at,synced_at,deactivated_by_financial)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET rut=excluded.rut,source_status=excluded.source_status,financial_status=excluded.financial_status,months_due=excluded.months_due,amount_due=excluded.amount_due,source_year=excluded.source_year,source_updated_at=excluded.source_updated_at,synced_at=excluded.synced_at,deactivated_by_financial=excluded.deactivated_by_financial`);
    const upMonth=db.prepare(`INSERT INTO member_financial_months(member_id,year,month,month_name,paid_amount,due_amount,overdue,review,synced_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id,year,month) DO UPDATE SET paid_amount=excluded.paid_amount,due_amount=excluded.due_amount,overdue=excluded.overdue,review=excluded.review,synced_at=excluded.synced_at`);
    const authority=[];
    for(let i=5;i<rows.length;i++){
      const r=rows[i]||[];const rut=normalizeRut(r[2]);const name=String(r[3]||'').trim();
      if(!rut||!name)continue;rowsSeen++;
      const member=stmtMember.get(rut);if(!member)continue;matched++;
      const position=String(r[4]||'').trim();const employer=String(r[5]||'').trim();const sourceStatus=norm(r[11]);
      if(name||position||employer){
        db.prepare('UPDATE members SET name=COALESCE(NULLIF(?,\'\'),name),position=COALESCE(NULLIF(?,\'\'),position),employer=COALESCE(NULLIF(?,\'\'),employer),is_board=?,updated_at=? WHERE id=?').run(name,position,employer,sourceStatus==='DIRECTORIO'?1:0,syncedAt,member.id);
        authority.push({memberId:member.id,rut,name,position,employer});
      }
      let monthsDue=0,amountDue=0;
      const exempt=EXEMPT_STATUS.has(sourceStatus);
      const explicitMoroso=sourceStatus==='MOROSO';
      for(let mi=0;mi<12;mi++){
        const start=12+mi*7;const paid=numberValue(r[start]);
        const components=[r[start+1],r[start+2],r[start+3],r[start+4]].map(numberValue);
        const monthUf=numberValue(rows?.[2]?.[start]);
        // BASE DE DATOS.xlsm es la autoridad financiera. Algunos bloques mensuales
        // todavía tienen fórmulas/Total en 0 aunque el socio deba la cuota. Para un
        // MOROSO explícito calculamos el valor esperado usando la configuración
        // individual G:J (Otros + UF + Seguro + P. Licencia) y la UF del mes, y
        // nunca usamos un valor menor que el Total mensual ya calculado en el XLSM.
        const configuredDue=Math.round(
          numberValue(r[6]) +
          numberValue(r[7])*monthUf +
          numberValue(r[8])*monthUf +
          numberValue(r[9])
        );
        let dueAmount=Math.round(numberValue(r[start+5]));
        if(dueAmount<=0)dueAmount=Math.round(components.reduce((a,b)=>a+b,0));
        if(explicitMoroso)dueAmount=Math.max(dueAmount,configuredDue);
        const dueDatePassed=year<currentYear||(year===currentYear&&(mi+1<currentMonth||(mi+1===currentMonth&&currentDay>10)));
        // Regla ASPCH: el estado MOROSO lo determina explícitamente COMENTARIO.
        // Las celdas Pagado vacías sirven para contar/sumar SUS meses adeudados,
        // no para convertir automáticamente a cualquier socio en moroso.
        const overdue=explicitMoroso&&!exempt&&dueDatePassed&&paid<=0;
        if(overdue){monthsDue++;amountDue+=Math.max(0,dueAmount)}
        upMonth.run(member.id,year,mi+1,MONTHS[mi],Math.round(paid),Math.max(0,dueAmount),overdue?1:0,String(r[start+6]||''),syncedAt);
      }
      let financialStatus='AL_DIA';
      if(sourceStatus==='DESAFILIADO'||(sourceStatus==='MOROSO'&&monthsDue>=6))financialStatus='DESAFILIADO';
      else if(sourceStatus==='CONGELADO')financialStatus='CONGELADO';
      else if(sourceStatus==='JUBILADO')financialStatus='JUBILADO';
      else if(sourceStatus==='DIRECTORIO')financialStatus='DIRECTORIO';
      else if(sourceStatus==='MOROSO')financialStatus='MOROSO';
      if(financialStatus==='MOROSO')morosos++;
      if(financialStatus==='DESAFILIADO')desafiliados++;
      const old=db.prepare('SELECT deactivated_by_financial FROM member_financial_status WHERE member_id=?').get(member.id);
      let managed=Number(old?.deactivated_by_financial||0);
      if(financialStatus==='DESAFILIADO'){
        if(member.active)db.prepare('UPDATE members SET active=0,updated_at=? WHERE id=?').run(syncedAt,member.id);
        managed=1;
      }else if(managed){
        db.prepare('UPDATE members SET active=1,updated_at=? WHERE id=?').run(syncedAt,member.id);managed=0;
      }
      upStatus.run(member.id,rut,sourceStatus||null,financialStatus,monthsDue,Math.round(amountDue),year,stat.mtime.toISOString(),syncedAt,managed);
    }
    db.exec('COMMIT');
    db.prepare(`INSERT INTO financial_sync_runs(source,source_mtime,status,rows_seen,members_matched,morosos,desafiliados,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(file,stat.mtime.toISOString(),'OK',rowsSeen,matched,morosos,desafiliados,started);
    return {ok:true,rowsSeen,matched,morosos,desafiliados,sourceMtime:stat.mtime.toISOString(),authority};
  }catch(err){
    try{db.exec('ROLLBACK')}catch{}
    db.prepare(`INSERT INTO financial_sync_runs(source,status,rows_seen,members_matched,morosos,desafiliados,error,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(file||'', 'ERROR',rowsSeen,matched,morosos,desafiliados,String(err.message||err),started);
    throw err;
  }
}

export function studyRoomAvailability(db,{from,to,memberId}){
  const rooms=db.prepare('SELECT id,name FROM study_rooms WHERE active=1 ORDER BY id').all();
  const rows=db.prepare(`SELECT r.id,r.room_id,r.member_id,r.start_at,r.end_at,rm.name FROM study_room_reservations r JOIN study_rooms rm ON rm.id=r.room_id WHERE r.status='ACTIVE' AND r.end_at>? AND r.start_at<? ORDER BY r.start_at`).all(from,to);
  return {rooms,reservations:rows.map(r=>({id:r.id,roomId:r.room_id,room:r.name,start:r.start_at,end:r.end_at,mine:r.member_id===memberId,status:r.member_id===memberId?'Tu reserva':'Ocupada'}))};
}

export function reserveStudyRoom(db,{memberId,start,end}){
  const a=new Date(start),b=new Date(end);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<=a)throw Object.assign(new Error('Horario inválido.'),{statusCode:400,expose:true});
  const duration=b-a;if(duration>4*3600_000)throw Object.assign(new Error('La reserva puede durar como máximo 4 horas.'),{statusCode:400,expose:true});
  if(a.getTime()<Date.now()-60_000)throw Object.assign(new Error('No puedes reservar en el pasado.'),{statusCode:400,expose:true});
  const room=db.prepare("SELECT * FROM study_rooms WHERE active=1 ORDER BY id LIMIT 1").get();if(!room)throw Object.assign(new Error('Sala no disponible.'),{statusCode:503,expose:true});
  const clash=db.prepare(`SELECT id FROM study_room_reservations WHERE room_id=? AND status='ACTIVE' AND start_at<? AND end_at>? LIMIT 1`).get(room.id,b.toISOString(),a.toISOString());
  if(clash)throw Object.assign(new Error('Ese horario ya está ocupado.'),{statusCode:409,expose:true});
  const r=db.prepare(`INSERT INTO study_room_reservations(room_id,member_id,start_at,end_at,status,created_at) VALUES (?,?,?,?,?,?)`).run(room.id,memberId,a.toISOString(),b.toISOString(),'ACTIVE',isoNow());
  return Number(r.lastInsertRowid);
}
export function cancelStudyRoom(db,{memberId,id}){const row=db.prepare("SELECT * FROM study_room_reservations WHERE id=? AND member_id=? AND status='ACTIVE'").get(id,memberId);if(!row)return false;db.prepare("UPDATE study_room_reservations SET status='CANCELLED',cancelled_at=? WHERE id=?").run(isoNow(),id);return true}

function safeImageData(data){const m=String(data||'').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);if(!m)return null;const type=m[1].toLowerCase()==='jpg'?'jpeg':m[1].toLowerCase();const buf=Buffer.from(m[2],'base64');if(!buf.length||buf.length>1_500_000)return null;return{type,buf}}
export function createMarketplaceListing(db,{memberId,title,description,price,contact,images=[],dir}){
  title=String(title||'').trim();description=String(description||'').trim();contact=String(contact||'').trim();price=Math.max(0,Math.round(Number(price)||0));
  if(title.length<3||title.length>100||description.length<5||description.length>2000||!contact||price<0)throw Object.assign(new Error('Completa título, descripción, valor y contacto.'),{statusCode:400,expose:true});
  if(!Array.isArray(images)||images.length<1||images.length>5)throw Object.assign(new Error('Agrega entre 1 y 5 fotos.'),{statusCode:400,expose:true});
  const now=isoNow();const r=db.prepare(`INSERT INTO marketplace_listings(member_id,title,description,price,contact,status,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING',?,?)`).run(memberId,title,description,price,contact,now,now);const id=Number(r.lastInsertRowid);
  const folder=path.join(dir,String(id));fs.mkdirSync(folder,{recursive:true,mode:0o700});
  let saved=0;
  try{images.forEach((data,i)=>{const img=safeImageData(data);if(!img)throw new Error('Una foto no es válida o supera 1,5 MB después de compresión.');const ext=img.type==='jpeg'?'jpg':img.type;const name=`${i+1}.${ext}`;fs.writeFileSync(path.join(folder,name),img.buf,{mode:0o600});db.prepare('INSERT INTO marketplace_images(listing_id,file_name,sort_order) VALUES (?,?,?)').run(id,name,i);saved++});}
  catch(err){db.prepare('DELETE FROM marketplace_listings WHERE id=?').run(id);try{fs.rmSync(folder,{recursive:true,force:true})}catch{};throw Object.assign(err,{statusCode:400,expose:true})}
  return{id,saved};
}
export function publicMarketplace(db,{memberId,admin=false,status='ACTIVE'}){
  let rows;if(admin)rows=db.prepare(`SELECT l.*,m.name AS owner_name,m.email AS owner_email FROM marketplace_listings l JOIN members m ON m.id=l.member_id ORDER BY l.created_at DESC LIMIT 300`).all();
  else rows=db.prepare(`SELECT l.*,m.name AS owner_name FROM marketplace_listings l JOIN members m ON m.id=l.member_id WHERE l.status='ACTIVE' OR l.member_id=? ORDER BY l.created_at DESC LIMIT 200`).all(memberId);
  const imgs=db.prepare('SELECT id,file_name FROM marketplace_images WHERE listing_id=? ORDER BY sort_order,id');
  return rows.map(r=>({...r,mine:r.member_id===memberId,images:imgs.all(r.id).map(x=>({id:x.id,url:`/api/marketplace/image/${x.id}`}))}));
}
export function marketplaceImage(db,imageId,dir,{memberId=null,admin=false}={}){const x=db.prepare(`SELECT i.file_name,i.listing_id,l.status,l.member_id FROM marketplace_images i JOIN marketplace_listings l ON l.id=i.listing_id WHERE i.id=?`).get(imageId);if(!x)return null;if(x.status!=='ACTIVE'&&!admin&&Number(x.member_id)!==Number(memberId))return null;const f=path.resolve(dir,String(x.listing_id),x.file_name);if(!f.startsWith(path.resolve(dir)+path.sep)||!fs.existsSync(f))return null;return f}
export function marketplaceOwnerAction(db,{memberId,id,action}){const row=db.prepare('SELECT * FROM marketplace_listings WHERE id=? AND member_id=?').get(id,memberId);if(!row)return false;const now=isoNow();if(action==='SOLD')db.prepare("UPDATE marketplace_listings SET status='SOLD',sold_at=?,updated_at=? WHERE id=?").run(now,now,id);else if(action==='DELETE')db.prepare("UPDATE marketplace_listings SET status='REMOVED',updated_at=? WHERE id=?").run(now,id);else if(action==='RENEW'){const exp=new Date(Date.now()+60*86400_000).toISOString();db.prepare("UPDATE marketplace_listings SET status='PENDING',expires_at=?,approved_at=NULL,updated_at=? WHERE id=?").run(exp,now,id)}else return false;return true}
export function marketplaceOwnerEdit(db,{memberId,id,title,description,price,contact}){
  const row=db.prepare('SELECT * FROM marketplace_listings WHERE id=? AND member_id=?').get(id,memberId);if(!row)return false;
  title=String(title||'').trim();description=String(description||'').trim();contact=String(contact||'').trim();price=Math.max(0,Math.round(Number(price)||0));
  if(title.length<3||title.length>100||description.length<5||description.length>2000||!contact)throw Object.assign(new Error('Completa título, descripción, valor y contacto.'),{statusCode:400,expose:true});
  const now=isoNow();db.prepare("UPDATE marketplace_listings SET title=?,description=?,price=?,contact=?,status='PENDING',approved_at=NULL,moderation_note=NULL,updated_at=? WHERE id=?").run(title,description,price,contact,now,id);return true;
}
export function moderateMarketplace(db,{id,status,note=''}){if(!['ACTIVE','REMOVED'].includes(status))return false;const now=isoNow(),exp=status==='ACTIVE'?new Date(Date.now()+60*86400_000).toISOString():null;const r=db.prepare(`UPDATE marketplace_listings SET status=?,moderation_note=?,approved_at=CASE WHEN ?='ACTIVE' THEN ? ELSE approved_at END,expires_at=CASE WHEN ?='ACTIVE' THEN ? ELSE expires_at END,updated_at=? WHERE id=?`).run(status,String(note||'').slice(0,500),status,now,status,exp,now,id);return Number(r.changes)>0}
export function expireMarketplace(db){const now=isoNow();return Number(db.prepare("UPDATE marketplace_listings SET status='EXPIRED',updated_at=? WHERE status='ACTIVE' AND expires_at IS NOT NULL AND expires_at<=?").run(now,now).changes||0)}

export function listActivities(db){return db.prepare("SELECT * FROM activities WHERE status='ACTIVE' ORDER BY COALESCE(starts_at,'9999') ASC,id DESC").all()}
export function adminActivities(db){return db.prepare('SELECT * FROM activities ORDER BY id DESC').all()}
export function setActivityStatus(db,{id,status}){status=String(status||'').toUpperCase();if(!['ACTIVE','CLOSED','REMOVED'].includes(status))return false;return Number(db.prepare('UPDATE activities SET status=?,updated_at=? WHERE id=?').run(status,isoNow(),Number(id)).changes||0)>0}
export function createActivity(db,body){const type=String(body.type||'EVENT').toUpperCase();if(!['COURSE','TALK','EVENT'].includes(type))throw Object.assign(new Error('Tipo inválido.'),{statusCode:400,expose:true});const title=String(body.title||'').trim(),url=String(body.externalUrl||'').trim();if(!title||!/^https:\/\//i.test(url))throw Object.assign(new Error('Título y URL https son obligatorios.'),{statusCode:400,expose:true});const now=isoNow();const r=db.prepare(`INSERT INTO activities(type,title,description,starts_at,ends_at,registration_open_at,registration_close_at,external_url,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(type,title,String(body.description||'').trim(),body.startsAt||null,body.endsAt||null,body.registrationOpenAt||null,body.registrationCloseAt||null,url,'ACTIVE',now,now);return Number(r.lastInsertRowid)}

export function dueNotificationText(financial){const months=Number(financial?.monthsDue||0),amount=Number(financial?.amountDue||0);const money=new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(amount);return {title:'Mi ASPCH · Membresía',body:`Tienes ${months} ${months===1?'mes pendiente':'meses pendientes'} por un total de ${money}. Por favor regulariza lo antes posible o comunícate con nosotros. Los datos de transferencia están disponibles en Mi ASPCH.`}}

export function hashPin(pin,salt){return crypto.scryptSync(String(pin),salt,32).toString('base64url')}
