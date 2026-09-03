import webpush from 'web-push';

function env(name,fallback=''){return process.env[name]??fallback}
const flag=(name,fallback=false)=>['1','true','yes','si','sí','on'].includes(String(env(name,String(fallback))).toLowerCase());
export function pushEnabled(){return !flag('PREVIEW_MODE',false)&&!!env('VAPID_PUBLIC_KEY')&&!!env('VAPID_PRIVATE_KEY')}
export function vapidPublicKey(){return env('VAPID_PUBLIC_KEY')}
let configured=false;
function configure(){if(configured||!pushEnabled())return;webpush.setVapidDetails(env('VAPID_SUBJECT','mailto:informatica@aspch.org'),env('VAPID_PUBLIC_KEY'),env('VAPID_PRIVATE_KEY'));configured=true}
export function upsertPushSubscription(db,{memberId,subscription,topics,userAgent=''}){
  if(!subscription?.endpoint||!subscription?.keys?.p256dh||!subscription?.keys?.auth)throw new Error('Suscripción push inválida.');
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO push_subscriptions(member_id,endpoint,p256dh,auth,topics_json,user_agent,created_at,updated_at,last_error)
    VALUES (?,?,?,?,?,?,?,?,NULL) ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id,p256dh=excluded.p256dh,auth=excluded.auth,topics_json=excluded.topics_json,user_agent=excluded.user_agent,updated_at=excluded.updated_at,last_error=NULL`)
    .run(memberId,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,JSON.stringify(topics||{}),String(userAgent||'').slice(0,300),now,now);
  return true;
}
export function removePushSubscription(db,{memberId,endpoint}){return Number(db.prepare('DELETE FROM push_subscriptions WHERE member_id=? AND endpoint=?').run(memberId,String(endpoint||'')).changes||0)}
export function hasDelivery(db,key){return !!db.prepare('SELECT 1 FROM notification_deliveries WHERE notification_key=?').get(key)}
export function recordDelivery(db,{memberId,key,kind,title,body,status,sentAt=null}){
  try{db.prepare(`INSERT INTO notification_deliveries(member_id,notification_key,kind,title,body,status,sent_at,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(memberId,key,kind,title,body,status,sentAt,new Date().toISOString())}catch{}
}
export async function sendMemberPush(db,memberId,{key,kind='general',title,body,url='/?view=home',actions=[],tag=null,force=false}){
  if(!force&&key&&hasDelivery(db,key))return{ok:true,duplicate:true,status:'SENT',sent:0,failed:0,noSubscription:0};
  const rows=db.prepare('SELECT * FROM push_subscriptions WHERE member_id=?').all(memberId);
  let sent=0;let eligible=0;const errors=[];
  for(const r of rows){
    let topics={};try{topics=JSON.parse(r.topics_json||'{}')}catch{}
    if(kind&&topics[kind]===false)continue;
    eligible++;
  }
  if(!pushEnabled()){
    const status=eligible?'FAILED':'NO_SUBSCRIPTION';
    return{ok:false,reason:'disabled',status,sent:0,failed:status==='FAILED'?1:0,noSubscription:status==='NO_SUBSCRIPTION'?1:0};
  }
  configure();
  for(const r of rows){
    let topics={};try{topics=JSON.parse(r.topics_json||'{}')}catch{}
    if(kind&&topics[kind]===false)continue;
    const sub={endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth}};
    try{await webpush.sendNotification(sub,JSON.stringify({title,body,url,kind,actions:Array.isArray(actions)?actions.slice(0,2):[],tag:tag||undefined}),{TTL:86400,urgency:kind==='membership'?'normal':'high'});sent++;db.prepare('UPDATE push_subscriptions SET last_error=NULL,updated_at=? WHERE id=?').run(new Date().toISOString(),r.id)}
    catch(err){const status=Number(err?.statusCode||0);errors.push(String(err?.message||err));if(status===404||status===410)db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(r.id);else db.prepare('UPDATE push_subscriptions SET last_error=?,updated_at=? WHERE id=?').run(String(err?.message||err).slice(0,500),new Date().toISOString(),r.id)}
  }
  const status=sent?'SENT':(eligible?'FAILED':'NO_SUBSCRIPTION');
  if(key)recordDelivery(db,{memberId,key,kind,title,body,status,sentAt:sent?new Date().toISOString():null});
  return{ok:sent>0,status,sent,failed:status==='FAILED'?1:0,noSubscription:status==='NO_SUBSCRIPTION'?1:0,errors};
}
