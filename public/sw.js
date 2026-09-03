const CACHE='mi-aspch-v0.6.16-pwa-4';
const STATIC=['/','/informatica','/index.html','/admin.html','/styles.css','/auth-gate.js','/app.js','/manifest.json','/manifest.webmanifest','/logo-aspch-original.png','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;if(u.pathname==='/test-notificaciones.html'){e.respondWith(Response.redirect(new URL('/',location.origin).href,302));return}e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))))});
self.addEventListener('push',e=>{
  let payload={};try{payload=e.data?.json?.()||{body:e.data?.text?.()||''}}catch{payload={body:e.data?.text?.()||''}}
  const title=payload.title||'Mi ASPCH';
  const actions=Array.isArray(payload.actions)?payload.actions.slice(0,2).filter(a=>a&&a.action&&a.title).map(a=>({action:String(a.action),title:String(a.title)})):[];
  const options={body:payload.body||'',icon:payload.icon||'/icon-192.png',badge:payload.badge||'/icon-192.png',tag:payload.tag||`mi-aspch-${payload.kind||'notice'}`,renotify:false,data:{url:payload.url||'/?view=home',kind:payload.kind||'general'},actions};
  e.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',e=>{
  const action=e.action||'';const target=e.notification?.data?.url||'/';e.notification.close();
  e.waitUntil((async()=>{
    if(action==='keep-parking'){
      try{const r=await fetch('/api/parking/still-active',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});if(r.ok){await self.registration.showNotification('Mi ASPCH · Estacionamiento',{body:'Perfecto, mantendremos tu estacionamiento activo.',icon:'/icon-192.png',badge:'/icon-192.png',tag:'mi-aspch-parking-still-active',data:{url:'/?view=parking'}});return}}catch{}
    }
    if(action==='vacate-parking'){
      try{const r=await fetch('/api/parking/vacate',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});if(r.ok){await self.registration.showNotification('Mi ASPCH · Estacionamiento',{body:'Estacionamiento liberado correctamente.',icon:'/icon-192.png',badge:'/icon-192.png',tag:'mi-aspch-parking-vacated',data:{url:'/?view=parking'}})}}catch{}
    }
    const ws=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const w of ws){if('focus'in w){try{w.postMessage({type:'mi-aspch-open',url:target})}catch{};return w.focus()}}
    return clients.openWindow(target);
  })());
});
