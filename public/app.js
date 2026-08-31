const $=(q,r=document)=>r.querySelector(q); const $$=(q,r=document)=>[...r.querySelectorAll(q)];
const UI_SERVICE_DEFAULTS={parking:true,reservations:true,simulators:true,studyroom:true,library:true,agreements:true,news:true,agenda:true};
const state={member:null,membership:null,access:null,security:null,config:null,view:'home',news:[],parking:null,parkingWeekStart:null,parkingPollTimer:null,simulators:null,simFilter:'a320',simWeek:null,installPrompt:null,reminderTimer:null,simReminderTimer:null,uiMode:null,notifyPrefs:null,uiPreferences:{configured:false,simpleMode:false,services:{...UI_SERVICE_DEFAULTS}},registration:{rut:'',email:'',emailChanged:false},marketplace:null,modules:null,reservations:null,activityFilter:'UPCOMING',adminMembers:{query:'',page:1,limit:20,selectedId:null}};
const NAV=[['home','🏠','Inicio'],['parking','🚗','Estacionamiento'],['booking','🗓️','Reservas'],['profile','👤','Mi perfil'],['credential','🪪','Credencial'],['security','🔐','Seguridad'],['membership','💳','Mensualidad'],['convenios','🤝','Convenios'],['library','📚','Biblioteca'],['marketplace','🛒','Mercado ASPCH'],['activities','🎓','Cursos y charlas'],['votes','🗳️','Votaciones'],['contact','📞','Contacto'],['news','📰','Noticias']];
const ADMIN_NAV=[['admin-dashboard','📊','Dashboard'],['admin-members','👥','Socios'],['admin-finance','💳','Finanzas'],['admin-reservations','🗓️','Reservas'],['admin-content','📰','Contenido'],['admin-votes','🗳️','Votaciones'],['admin-notifications','🔔','Notificaciones'],['admin-integrations','🔗','Integraciones'],['admin-security','🛡️','Seguridad'],['admin-audit','🧾','Auditoría'],['admin-system','⚙️','Sistema'],['developer','🛠️','Developer']];
const ADMIN_VIEWS=new Set(['admin',...ADMIN_NAV.map(x=>x[0])]);
const ADMIN_PLACEHOLDERS={
  'admin-finance':['💳','Finanzas','La gestión financiera dedicada se incorporará en una próxima etapa.'],
  'admin-content':['📰','Contenido','La gestión de contenido se separará en una próxima etapa.'],
  'admin-votes':['🗳️','Votaciones','La administración dedicada de votaciones se incorporará en una próxima etapa.']
};

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#install-app')?.classList.remove('hidden')});
$('#install-app').addEventListener('click',async()=>{if(state.installPrompt){await state.installPrompt.prompt();state.installPrompt=null;$('#install-app').classList.add('hidden')}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

$('#identity-form').addEventListener('submit',startRegistration); $('#code-form').addEventListener('submit',verifyRegistration); $('#pin-setup-form').addEventListener('submit',setupInitialPin);
$('#login-rut').addEventListener('input',e=>{
  const value=String(e.target.value||'');
  if(/[a-z@]/i.test(value)){activateAdminIdentityMode(value.trim().toLowerCase()===state.config?.adminEmail);return}
  e.target.value=formatRutDisplay(value);activateAdminIdentityMode(false);
});
$('#retry-code')?.addEventListener('click',()=>$('#identity-form').requestSubmit());
$('#back-identity').addEventListener('click',()=>{clearAuthErrors();if($('#presets-list').children.length>0)$('#preview-presets').classList.remove('hidden');showAuthStep('identity')});
$('#logout')?.addEventListener('click',doLogout); $('#lock-logout').addEventListener('click',doLogout);
$('#unlock-form').addEventListener('submit',unlock); $('#biometric-button').addEventListener('click',unlockWithPasskey); $('#show-pin-button')?.addEventListener('click',showPinFallback);
initUiMode();
installEditableNumericInputs();
state.notifyPrefs=loadNotificationPrefs();
document.addEventListener('input',e=>{const form=e.target.closest?.('.auth-form');if(form)clearFormError(form)});
// En modo iPhone se comporta como una app instalada: sin pinch/double-tap zoom accidental.
for(const evt of ['gesturestart','gesturechange','gestureend']){
  document.addEventListener(evt,e=>{if(state.uiMode==='iphone')e.preventDefault()},{passive:false});
}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{const url=e.data?.url;if(url)openAppUrl(url)});
window.addEventListener('DOMContentLoaded',()=>{
  $('#more-menu-toggle')?.addEventListener('click',openMobileMenu);
  $('#mobile-more-close')?.addEventListener('click',closeMobileMenu);
  $('#mobile-more-backdrop')?.addEventListener('click',closeMobileMenu);
  $('#top-avatar')?.addEventListener('click',toggleAccountMenu);
  $('#account-menu-logout')?.addEventListener('click',doLogout);
  $('#account-menu-lock')?.addEventListener('click',()=>{closeAccountMenu();lockNow()});
  $$('[data-account-view]').forEach(button=>button.addEventListener('click',()=>{closeAccountMenu();go(button.dataset.accountView)}));
  document.addEventListener('click',e=>{if(!e.target.closest?.('.account-menu-wrap'))closeAccountMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMobileMenu();closeAccountMenu()}});
});

boot();

function initialView(){if(window.IS_ADMIN_PANEL) return 'developer'; return new URLSearchParams(location.search).get('view')||'home'}
function openAppUrl(url){try{const u=new URL(url,location.origin);const view=u.searchParams.get('view');if(view)go(view)}catch{}}
function initUiMode(){
  state.uiMode='iphone';
  document.body.classList.add('ui-iphone');
  document.body.classList.remove('ui-desktop');
}

async function boot(){
  try{
    state.config=await api('/api/config');
    const waf=$('#whatsapp-fab');if(waf&&state.config?.contact?.whatsappUrl)waf.href=state.config.contact.whatsappUrl;
    const data=await api('/api/me');
    state.member=data.member;state.membership=data.membership;state.access=data.access;state.security=data.security;state.modules=data.modules||null;state.uiPreferences=normalizedUiPreferences(data.uiPreferences);
    if(state.security?.pinSet && !state.security?.unlocked){
      return showLock();
    }
    sessionStorage.setItem('miAspchUnlocked','1');
    loginSuccess();
  }catch{await loadPresets();showAuth()}
}
async function loadPresets(){
  try{
    const r=await api('/api/preview/members');
    if(r?.members?.length>0){
      const presets=$('#preview-presets'),list=$('#presets-list');
      list.innerHTML='';
      r.members.forEach(m=>{
        const btn=document.createElement('button');
        btn.className='button secondary clean-btn';
        btn.type='button';
        btn.textContent=`${m.name||m.email} (${m.rut||'?'})`;
        btn.addEventListener('click',()=>presetLogin(m.id));
        list.appendChild(btn);
      });
      presets.classList.remove('hidden');
    }
  }catch{}
}
async function presetLogin(memberId){
  const presets=$('#preview-presets');
  try{
    setLoading(presets,true);
    const r=await api('/api/preview/login',{method:'POST',body:{memberId}});
    if(r?.ok){
      state.member=r.member;sessionStorage.setItem('miAspchUnlocked','1');
      const data=await api('/api/me');
      state.member=data.member;state.membership=data.membership;state.access=data.access;state.security=data.security;state.modules=data.modules||null;state.uiPreferences=normalizedUiPreferences(data.uiPreferences);
      // Usar loginSuccess() para setup completo, luego ir al perfil
      loginSuccess();
      setTimeout(()=>go('profile'),100);
    }else{
      toast(r?.error||'Error al iniciar sesión.',true);
    }
  }catch(err){
    toast(err.message||'Error al iniciar sesión.',true);
  }finally{
    setLoading(presets,false);
  }
}

function showAuthStep(step='identity'){
  $('#identity-form').classList.toggle('hidden',step!=='identity');
  $('#code-form').classList.toggle('hidden',step!=='code');
  $('#pin-setup-form').classList.toggle('hidden',step!=='pin');
  if(step==='identity')setTimeout(()=>$('#login-rut')?.focus(),50);
  if(step==='code')setTimeout(()=>$('#login-code')?.focus(),50);
  if(step==='pin')setTimeout(()=>$('#setup-pin')?.focus(),50);
}
function activateAdminIdentityMode(active){
  const input=$('#login-email'),label=$('#login-email-label');if(!input||!label)return;
  const wasActive=input.dataset.adminSecret==='1';if(wasActive===active)return;
  input.dataset.adminSecret=active?'1':'0';input.value='';
  label.childNodes[0].textContent=active?'Clave de Informática ':'Correo que quieres usar en Mi ASPCH ';
  input.type=active?'password':'email';input.inputMode=active?'numeric':'email';input.placeholder=active?'••••':'nombre@correo.cl';input.autocomplete=active?'current-password':'email';
  if(active){input.setAttribute('pattern','[0-9]*');input.maxLength=6;$('#identity-help').textContent='Acceso seguro al Control Center.'}
  else{input.removeAttribute('pattern');input.removeAttribute('maxlength');$('#identity-help').textContent='Si el correo es distinto al registrado, Mi ASPCH validará ambos correos antes de actualizar tu ficha ASPCH.'}
}
async function startRegistration(e){
  e.preventDefault();clearFormError(e.currentTarget);
  const rut=$('#login-rut').value.trim(),email=$('#login-email').value.trim();
  setLoading(e.currentTarget,true);
  try{
    if(rut.toLowerCase()===state.config?.adminEmail){
      await api('/api/auth/admin-login',{method:'POST',body:{email:rut,pin:email}});
      const me=await api('/api/me');state.member=me.member;state.membership=me.membership;state.access=me.access;state.security=me.security;state.modules=me.modules||state.modules;state.uiPreferences=normalizedUiPreferences(me.uiPreferences);sessionStorage.setItem('miAspchUnlocked','1');loginSuccess();return;
    }
    const r=await api('/api/auth/register/start',{method:'POST',body:{rut,email}});
    state.registration={rut,email,emailChanged:!!r.emailChanged};
    $('#code-primary-label').childNodes[0].textContent=`Código enviado a ${r.targetEmailMasked||'tu correo'} `;
    $('#code-old-wrap').classList.toggle('hidden',!r.emailChanged);
    $('#login-old-code').required=!!r.emailChanged;
    if(r.emailChanged)$('#code-old-label').childNodes[0].textContent=`Código de autorización enviado a ${r.currentEmailMasked||'tu correo registrado'} `;
    const help=r.emailChanged
      ? 'Para cambiar el correo necesitamos verificar el nuevo y autorizar el cambio desde el correo actualmente registrado.'
      : 'Revisa tu correo. El código vence en 10 minutos.';
    $('#code-help').textContent=help;
    showAuthStep('code');
  }catch(err){
    const adminMode=rut.toLowerCase()===state.config?.adminEmail;if(adminMode)$('#login-email').value='';
    showFormError(e.currentTarget,adminMode?`${err.message} Corrige la clave y vuelve a intentar.`:err.message,adminMode?'#login-email':'#login-rut');toast(err.message,true);
  }
  finally{setLoading(e.currentTarget,false)}
}
async function verifyRegistration(e){
  e.preventDefault();clearFormError(e.currentTarget);setLoading(e.currentTarget,true);
  try{
    const body={rut:state.registration.rut,email:state.registration.email,code:$('#login-code').value.trim(),oldCode:$('#login-old-code').value.trim()};
    const r=await api('/api/auth/register/verify',{method:'POST',body});
    const me=await api('/api/me');
    state.member=me.member;state.membership=me.membership;state.access=me.access;state.security=me.security;state.modules=me.modules||state.modules;state.uiPreferences=normalizedUiPreferences(me.uiPreferences);
    if(r.emailUpdated)toast('Correo verificado y actualizado en tu ficha ASPCH.');
    if(r.requiresPinSetup||!me.security.pinSet)return showPinSetup();
    sessionStorage.removeItem('miAspchUnlocked');
    showLock();
  }catch(err){const selector=/registrado/i.test(err.message)?'#login-old-code':'#login-code';$(selector).value='';showFormError(e.currentTarget,`${err.message} Corrige el código y vuelve a intentar.`,selector);toast(err.message,true)}
  finally{setLoading(e.currentTarget,false)}
}
function showPinSetup(){
  $('#auth-screen').classList.remove('hidden');$('#lock-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');
  showAuthStep('pin');
}
async function setupInitialPin(e){
  e.preventDefault();clearFormError(e.currentTarget);
  const pin=$('#setup-pin').value.trim(),confirm=$('#setup-pin-confirm').value.trim();
  if(pin!==confirm){const msg='Los PIN no coinciden. Corrígelos y vuelve a intentar.';toast(msg,true);return showFormError(e.currentTarget,msg,'#setup-pin-confirm')}
  if(!/^\d{4,6}$/.test(pin)){const msg='El PIN debe tener entre 4 y 6 dígitos.';toast(msg,true);return showFormError(e.currentTarget,msg,'#setup-pin')}
  setLoading(e.currentTarget,true);
  try{
    const r=await api('/api/security/pin',{method:'POST',body:{pin}});
    state.security=r.security;
    sessionStorage.setItem('miAspchUnlocked','1');
    $('#setup-pin').value='';$('#setup-pin-confirm').value='';
    loginSuccess();
    await promptFirstRunSetup();
    toast('Mi ASPCH quedó activado en este dispositivo.');
  }catch(err){showFormError(e.currentTarget,err.message,'#setup-pin');toast(err.message,true)}
  finally{setLoading(e.currentTarget,false)}
}
async function unlock(e){e.preventDefault();clearFormError(e.currentTarget);setLoading(e.currentTarget,true);try{const r=await api('/api/security/unlock',{method:'POST',body:{pin:$('#unlock-pin').value}});state.security=r.security;sessionStorage.setItem('miAspchUnlocked','1');$('#unlock-pin').value='';loginSuccess()}catch(err){$('#unlock-pin').value='';showFormError(e.currentTarget,`${err.message} Puedes intentarlo nuevamente.`,'#unlock-pin');toast(err.message,true)}finally{setLoading(e.currentTarget,false)}}
async function unlockWithPasskey(){
  const btn=$('#biometric-button');if(btn.disabled)return;btn.disabled=true;
  try{
    const options=await api('/api/security/passkey/auth/options',{method:'POST',body:{}});
    const response=await browserAuthenticatePasskey(options);
    const r=await api('/api/security/passkey/auth/verify',{method:'POST',body:{response}});
    state.security=r.security;sessionStorage.setItem('miAspchUnlocked','1');loginSuccess();
  }catch(err){if(err?.name!=='NotAllowedError')toast(err.message||'No fue posible usar la biometría.',true)}finally{showLockButtonState()}
}
function showLockButtonState(){if($('#lock-screen').classList.contains('hidden'))return;showLock()}
async function lockNow(){if(!state.security?.pinSet&&!state.security?.passkeySet){toast('Primero configura un PIN o Face ID/huella en Seguridad.');return go('security')}try{await api('/api/security/lock',{method:'POST',body:{}});state.security.unlocked=false;sessionStorage.removeItem('miAspchUnlocked');showLock()}catch(e){toast(e.message,true)}}
async function doLogout(){sessionStorage.removeItem('miAspchUnlocked');try{await api('/api/auth/logout',{method:'POST',body:{}})}catch{}location.reload()}
function showAuth(){$('#auth-screen').classList.remove('hidden');$('#lock-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');$('#preview-presets').classList.add('hidden');showAuthStep('identity')}
function showLock(){
  if(!state.member)return showAuth();
  $('#auth-screen').classList.add('hidden');$('#app-shell').classList.add('hidden');$('#lock-screen').classList.remove('hidden');
  $('#lock-greeting').textContent='Bienvenido';
  const btn=$('#biometric-button'),pinForm=$('#unlock-form');
  const browserOk=!!window.PublicKeyCredential&&!!navigator.credentials;
  const canUse=browserOk&&!!state.security?.passkeySet&&!!state.security?.biometricAvailable;
  btn.classList.toggle('hidden',!canUse);
  pinForm.classList.remove('hidden');
  setTimeout(()=>$('#unlock-pin')?.focus(),100);
}
function showPinFallback(){
  $('#unlock-form')?.classList.remove('hidden');
  $('#show-pin-button')?.classList.add('hidden');
  $('#biometric-button')?.classList.add('hidden');
  $('#biometric-help').textContent='Ingresa tu PIN personal para continuar.';
  setTimeout(()=>$('#unlock-pin')?.focus(),60);
}
function loginSuccess(){
  const m=state.member;applyMemberTheme(m);
  $('#auth-screen').classList.add('hidden');$('#lock-screen').classList.add('hidden');$('#app-shell').classList.remove('hidden');
  $('#sidebar-name').textContent=firstLast(m.name);$('#sidebar-role').textContent=m.role==='ADMIN'?'Administrador':(m.isBoard?'Directorio':(isHelicopterMember(m)?'Helicópteros':'Asociado'));
  $('#sidebar-avatar').textContent=initials(m.name);$('#top-avatar').textContent=initials(m.name);renderNav();go(initialView());
}


function renderNav(){
  const allItems=NAV.map(x=>[...x]),adminItems=(state.member?.role==='ADMIN' && window.IS_ADMIN_PANEL)?ADMIN_NAV.map(x=>[...x]):[];
  const primaryIds=['home','parking','booking','profile'];
  const primary=allItems.filter(x=>primaryIds.includes(x[0]));
  const secondary=allItems.filter(x=>!primaryIds.includes(x[0])&&navigationItemVisible(x[0]));
  const items=[...primary,...secondary];
  const admin=adminItems.length?`<details class="sidebar-more admin-navigation" open><summary>Administración</summary><div class="sidebar-more-items">${adminItems.map(x=>navItem(...x)).join('')}</div></details>`:'';
  $('#desktop-nav').innerHTML=`<div class="nav-section-label">Principal</div>${primary.map(([id,icon,label])=>navItem(id,icon,label)).join('')}<details class="sidebar-more" open><summary>Más servicios</summary><div class="sidebar-more-items">${secondary.map(([id,icon,label])=>navItem(id,icon,label)).join('')}</div></details>${admin}`;
  const mobileLabel={home:'Inicio',parking:'Estac.',booking:'Reservas',profile:'Perfil'};
  $('#mobile-nav').innerHTML=primary.map(([id,icon,label])=>navItem(id,icon,mobileLabel[id]||label)).join('');
  renderMobileMore(items,adminItems);
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
  $('#more-menu-toggle')?.classList.toggle('active',!primaryIds.includes(state.view));
}
function renderMobileMore(items,adminItems=[]){
  const byId=Object.fromEntries(items.map(x=>[x[0],x]));
  const groups=simpleModeEnabled()?
    [['Accesos simples',['credential','contact']]]:
    [['Tu cuenta',['credential']],['Servicios',['convenios','library','marketplace']],['Comunidad',['activities','votes','news']],['Contacto y Ayuda',['contact']]];
  const html=groups.map(([label,ids])=>`<section class="mobile-menu-group"><span>${label}</span>${ids.map(id=>byId[id]?navItem(...byId[id]):'').join('')}</section>`).join('');
  const admin=adminItems.length?`<section class="mobile-menu-group"><span>Administración</span>${adminItems.map(x=>navItem(...x)).join('')}</section>`:'';
  $('#mobile-more-nav').innerHTML=html+admin;
}
function openMobileMenu(){
  $('#mobile-more-drawer')?.classList.remove('hidden');$('#mobile-more-backdrop')?.classList.remove('hidden');document.body.classList.add('mobile-menu-open');
}
function closeMobileMenu(){
  $('#mobile-more-drawer')?.classList.add('hidden');$('#mobile-more-backdrop')?.classList.add('hidden');document.body.classList.remove('mobile-menu-open');
}
function toggleAccountMenu(){const menu=$('#account-menu');if(!menu)return;const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);$('#top-avatar')?.setAttribute('aria-expanded',opening?'true':'false')}
function closeAccountMenu(){$('#account-menu')?.classList.add('hidden');$('#top-avatar')?.setAttribute('aria-expanded','false')}

function navItem(id,icon,label){return `<button class="nav-item ${state.view===id?'active':''}" data-view="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`}
function normalizedUiPreferences(value){const saved=value?.services||{};return{configured:!!value?.configured,simpleMode:value?.simpleMode===true,updatedAt:value?.updatedAt||null,services:Object.fromEntries(Object.keys(UI_SERVICE_DEFAULTS).map(key=>[key,saved[key]!==false]))}}
function simpleModeEnabled(){return state.uiPreferences?.simpleMode===true}
function serviceVisible(key){return state.uiPreferences?.services?.[key]!==false}
function reservationsVisible(){return serviceVisible('reservations')&&(serviceVisible('simulators')||serviceVisible('studyroom'))}
function navigationItemVisible(id){
  if(id==='activities')return state.modules?.activities?.enabled===true;
  if(id==='votes')return state.modules?.votes?.enabled===true;
  if(simpleModeEnabled())return ['credential','contact'].includes(id);
  const keys={convenios:'agreements',library:'library',news:'news'};
  return keys[id]?serviceVisible(keys[id]):true;
}
async function go(view){
  clearTimeout(state.parkingPollTimer);closeMobileMenu();closeAccountMenu();
  if(view==='admin')view='developer';
  if(ADMIN_VIEWS.has(view)&&state.member?.role!=='ADMIN')view='home';
  state.view=view;renderNav();
  const titles={home:'Inicio',booking:'Reservas',reservations:'Mi agenda',credential:'Credencial digital',security:'Seguridad',membership:'Mensualidad',parking:'Estacionamiento',simulators:'Turnos de simulador',studyroom:'Sala de estudios',marketplace:'Mercado ASPCH',activities:'Cursos y charlas',votes:'Votaciones',advisors:'Contacto y asesorías',contact:'Contacto',convenios:'Convenios',library:'Biblioteca',news:'Noticias',profile:'Mi perfil','admin-dashboard':'Dashboard','admin-members':'Socios','admin-finance':'Finanzas','admin-reservations':'Reservas','admin-content':'Contenido','admin-votes':'Votaciones','admin-notifications':'Notificaciones','admin-integrations':'Integraciones','admin-security':'Seguridad','admin-audit':'Auditoría','admin-system':'Sistema',developer:'Developer'};
  $('#page-title').textContent=titles[view]||'Mi ASPCH';const v=$('#view');v.innerHTML='<div class="empty">Cargando…</div>';
  const routes={home:renderHome,booking:renderBookingHub,reservations:renderReservations,credential:renderCredential,security:renderSecurity,membership:renderMembership,parking:()=>renderParking(),simulators:renderSimulators,studyroom:renderStudyRoom,marketplace:renderMarketplace,activities:renderActivities,votes:renderVotes,advisors:renderContact,contact:renderContact,convenios:renderConvenios,library:renderLibrary,news:renderNews,profile:renderProfile,'admin-dashboard':renderAdminDashboard,'admin-members':renderAdminMembers,'admin-reservations':renderAdminReservations,'admin-notifications':renderAdminNotifications,'admin-integrations':renderAdminIntegrations,'admin-security':renderAdminSecurity,'admin-audit':renderAdminAudit,'admin-system':renderAdminSystem,developer:renderDeveloper,...Object.fromEntries(Object.keys(ADMIN_PLACEHOLDERS).map(id=>[id,()=>renderAdminPlaceholder(id)]))};
  try{if(!routes[view])return go('home');await routes[view]()}catch(err){if(err.code!=='LOCKED')v.innerHTML=`<div class="card empty">${escapeHtml(err.message)}</div>`}
}


function isLatamEmployer(value=''){
  const employer=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  return ['LATAM AIRLINES','LATAM GRUPO','LATAM CARGO'].some(name=>employer===name||employer.startsWith(`${name} `));
}

function homeMembershipRow(pay){
  const isLatam=isLatamEmployer(state.member?.employer)||pay?.paymentMethod==='PAYROLL'||pay?.membership?.paymentMethod==='PAYROLL';
  let subtitle='Descuento por planilla';
  let badgeClass='blue';
  let badgeText='Planilla →';

  if(!isLatam){
    const status=pay?.membership?.status||'PENDIENTE';
    const financial=pay?.membership?.financial||state.access?.financial;
    if(status==='EXENTO'){
      subtitle='Exento de mensualidad';
      badgeClass='green';
      badgeText='Exento →';
    }else if(status==='AL_DIA'){
      subtitle='Al día';
      badgeClass='green';
      badgeText='Al día →';
    }else if(status==='MOROSO'){
      const months=Number(financial?.monthsDue||0);
      subtitle=months>0?`Pagos pendientes · ${months} ${months===1?'mes':'meses'}`:'Pagos pendientes';
      badgeClass='amber';
      badgeText='Regularizar →';
    }else if(status==='PENDIENTE'){
      subtitle='Pendiente de pago';
      badgeClass='amber';
      badgeText='Pendiente →';
    }else if(status==='DESAFILIADO'){
      subtitle='Desafiliado';
      badgeClass='amber';
      badgeText='Revisar →';
    }else{
      subtitle=membershipStatusLabel(status);
      badgeClass='blue';
      badgeText='Ver →';
    }
  }

  return `<div class="card home-row-card" data-go="membership">
    <div class="home-row-left">
      <span class="home-row-icon">💳</span>
      <div class="home-row-copy">
        <strong>Mensualidad</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
    </div>
    <span class="badge ${badgeClass}">${badgeText}</span>
  </div>`;
}

async function renderHome(){
  const week=mondayOf(today());
  const fetches=[
    getParking(today()).catch(()=>({spaces:[],mineReservation:null})),
    getSimulators(week,addDays(week,4)).catch(()=>({occupancies:[]})),
    api('/api/membership')
  ];

  const [parking,sims,pay]=await Promise.all(fetches);
  state.membership=pay.membership;state.access=state.access||{};

  // 1. Saludo compacto
  const greeting=`<section class="hero hero-compact">
    <div class="hero-content">
      <span class="eyebrow">${isHelicopterMember(state.member)?'🚁 COMUNIDAD HELICÓPTEROS':'BIENVENIDO'}</span>
      <h1>${escapeHtml(welcomeText(state.member))}</h1>
    </div>
  </section>`;

  // 2. Credencial vigente
  const credentialCard=`<div class="card home-row-card" data-go="credential">
    <div class="home-row-left">
      <span class="home-row-icon">🪪</span>
      <div class="home-row-copy">
        <strong>Credencial vigente</strong>
        <span>${state.member?.active?'Socio activo · Toca para abrir':'Revisar estado de socio'}</span>
      </div>
    </div>
    <span class="badge ${state.member?.active?'green':'amber'}">${state.member?.active?'Vigente':'Revisar'} →</span>
  </div>`;

  // 3. Próximo simulador, solo si existe
  const myTurn=(sims.occupancies||[]).filter(o=>o.mine&&o.start.slice(0,10)>=today()).sort((a,b)=>a.start.localeCompare(b.start))[0];
  const simulatorCard=myTurn?`<div class="card home-row-card home-active-row" data-go="simulators">
    <div class="home-row-left">
      <span class="home-row-icon">✈️</span>
      <div class="home-row-copy">
        <span class="eyebrow">PRÓXIMO SIMULADOR</span>
        <strong>${escapeHtml(myTurn.simulator||myTurn.title||'Simulador')}</strong>
        <span>${shortDateTime(myTurn.start)}</span>
      </div>
    </div>
    <span class="badge green">Ver turno →</span>
  </div>`:'';

  // 4. Estacionamiento activo, solo si existe
  const mineParking=(parking.spaces||[]).find(s=>s.mine)||(parking.mineReservation?{building:parking.mineReservation.building,label:parking.mineReservation.label,checkedInAt:parking.mineReservation.checkedInAt}:null);
  const parkingCard=mineParking?`<div class="card home-row-card home-active-row" data-go="parking">
    <div class="home-row-left">
      <span class="home-row-icon">🚗</span>
      <div class="home-row-copy">
        <span class="eyebrow">ESTACIONAMIENTO ACTIVO</span>
        <strong>Padre Mariano ${escapeHtml(mineParking.building)} · Cupo ${escapeHtml(mineParking.label)}</strong>
        <span>${mineParking.checkedInAt?'Llegada marcada':'Reserva activa para hoy'}</span>
      </div>
    </div>
    <span class="badge green">Ver cupo →</span>
  </div>`:'';

  // 5. Aviso ASPCH importante, solo si existe
  maybeRetirementNotification(pay.membership);
  const specialNotice=pay.membership?.quote?.specialNotice?`<div class="card special-notice" style="margin-bottom:8px">
    <span class="eyebrow">📢 AVISO ASPCH</span>
    <h3>${escapeHtml(pay.membership.quote.specialNotice.title)}</h3>
    <p>${escapeHtml(pay.membership.quote.specialNotice.body)}</p>
  </div>`:'';

  // 6. Estado mensualidad compacto
  const membershipCard=homeMembershipRow(pay);

  // 7. Contactar ASPCH, acceso discreto al final
  const contactDiscreet=`<div class="home-contact-discreet" data-go="contact">
    <div class="home-contact-discreet-left">
      <span class="home-contact-icon">📞</span>
      <span>¿Necesitas ayuda o contactar a ASPCH?</span>
    </div>
    <strong>Contactar ASPCH →</strong>
  </div>`;

  $('#view').innerHTML=`${greeting}
  ${credentialCard}
  ${simulatorCard}
  ${parkingCard}
  ${specialNotice}
  ${membershipCard}
  ${contactDiscreet}`;

  $$('[data-go]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.go)));
}

function renderBookingHub(){
  const options=[];
  if(serviceVisible('simulators'))options.push(`<button class="card booking-choice" data-go="simulators"><span class="booking-choice-icon">✈️</span><span><strong>Simuladores</strong><small>Consulta turnos y solicita una reserva.</small></span><em>Entrar →</em></button>`);
  if(serviceVisible('studyroom'))options.push(`<button class="card booking-choice" data-go="studyroom"><span class="booking-choice-icon">📖</span><span><strong>Sala de estudios</strong><small>Revisa horarios y reserva un bloque.</small></span><em>Entrar →</em></button>`);
  $('#view').innerHTML=`<section class="booking-hub"><div class="card booking-hero"><span class="eyebrow">🗓️ RESERVAS</span><h2>¿Qué quieres reservar?</h2><p>Elige un servicio para continuar.</p></div><div class="booking-options">${options.join('')||'<div class="card empty">No tienes servicios de reserva visibles. Puedes cambiarlos desde Mi perfil.</div>'}</div></section>`;
  $$('[data-go]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.go)));
}




async function renderReservations(scope='upcoming'){
  const data=await api(`/api/reservations?scope=${encodeURIComponent(scope)}`);state.reservations=data;
  const tabs=[['upcoming','Próximas'],['history','Históricas'],['all','Todas']];
  $('#view').innerHTML=`<div class="card reservations-hero"><span class="eyebrow">🗓️ MI AGENDA</span><h2>Tus reservas, en un solo lugar</h2><p>Esta pantalla sirve para consultar, cancelar y añadir reservas al calendario. Para crear una nueva reserva entra directamente a Estacionamiento, Simuladores o Sala de estudios.</p><div class="segmented reservations-tabs">${tabs.map(([id,label])=>`<button class="reservation-tab ${scope===id?'active':''}" data-scope="${id}">${label}</button>`).join('')}</div></div>
  <section class="section"><div class="reservation-cards">${data.items?.length?data.items.map(reservationCard).join(''):'<div class="card empty">No hay reservas en esta vista.</div>'}</div></section>`;
  $$('.reservation-tab').forEach(b=>b.onclick=()=>renderReservations(b.dataset.scope));
  $$('.reservation-cancel').forEach(b=>b.onclick=()=>cancelUnifiedReservation(b.dataset.type,b.dataset.id,b.dataset.date));
  $$('.reservation-vacate').forEach(b=>b.onclick=()=>vacateUnifiedParking(b.dataset.date));
}
function reservationCard(x){
  const icon=x.type==='parking'?'🚗':x.type==='simulator'?'✈️':'📖';
  const type=x.type==='parking'?'Estacionamiento':x.type==='simulator'?'Simulador':'Sala de estudios';
  const status=({ACTIVE:'Activa',CONFIRMED:'Confirmado',UPCOMING:'Próxima',FINISHED:'Finalizada',VACATED:'Liberada',CANCELLED:'Cancelada',SOLD:'Finalizada'})[x.status]||x.status||x.phase;
  const badge=x.phase==='UPCOMING'?'green':x.phase==='CANCELLED'?'amber':'blue';
  const when=x.type==='parking'?humanDate(x.date||String(x.start).slice(0,10)):formatLocalDateTime(x.start)+(x.end&&x.end!==x.start?`–${hm(x.end)}`:'');
  return `<article class="card reservation-card"><div class="reservation-icon">${icon}</div><div class="reservation-main"><span class="eyebrow">${type}</span><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(when)}</p><span class="badge ${badge}">${escapeHtml(status)}</span></div><div class="reservation-actions">${x.icsUrl?`<a class="button ghost" href="${escapeHtml(x.icsUrl)}">＋ Calendario</a>`:''}${x.canVacate?`<button class="button primary reservation-vacate" data-date="${escapeHtml(x.date||'')}">Liberar cupo</button>`:''}${x.canCancel?`<button class="button ghost reservation-cancel" data-type="${escapeHtml(x.type)}" data-id="${escapeHtml(x.id)}" data-date="${escapeHtml(x.date||'')}">Cancelar</button>`:''}</div></article>`;
}
async function cancelUnifiedReservation(type,id,date){
  if(!confirm('¿Cancelar esta reserva?'))return;
  try{
    if(type==='parking')await api('/api/parking/reserve',{method:'DELETE',body:{date}});
    else if(type==='studyroom')await api('/api/study-room/reserve',{method:'DELETE',body:{id:Number(id)}});
    else if(type==='simulator'){const d=date||today();const from=mondayOf(d);await api('/api/simulators/cancel',{method:'POST',body:{eventRef:id,from,to:addDays(from,4)}})}
    toast('Reserva cancelada.');renderReservations(state.reservations?.scope||'upcoming');
  }catch(err){toast(err.message,true)}
}
async function vacateUnifiedParking(date){try{await api('/api/parking/vacate',{method:'POST',body:{date:date||today()}});toast('Estacionamiento liberado.');renderReservations(state.reservations?.scope||'upcoming')}catch(err){toast(err.message,true)}}

async function renderCredential(){
  const r=await api('/api/credential');const c=r.credential;
  const photo=c.hasPhoto?`<img src="/api/credential/photo?v=${Date.now()}" alt="Fotografía del socio">`:`<span>${initials(c.name)}</span>`;
  $('#view').innerHTML=`<div class="credential-wrap">
    <div class="digital-card">
      <div class="credential-top"><img src="/logo-aspch-original.png" class="credential-logo" alt="Asociación de Pilotos de Chile"><span class="credential-live">● ${c.active?'SOCIO ACTIVO':'REVISAR'}</span></div>
      <div class="credential-main">
        <div class="credential-photo">${photo}</div>
        <div class="credential-data"><span class="eyebrow">CREDENCIAL DIGITAL</span><h2>${escapeHtml(titleName(c.name))}</h2><div class="credential-fields"><div><span>RUT</span><strong>${escapeHtml(c.rut||'—')}</strong></div><div><span>Cargo</span><strong>${escapeHtml(c.position||'—')}</strong></div><div><span>Categoría</span><strong>${escapeHtml(c.category||'Socio ASPCH')}</strong></div></div></div>
      </div>
      <div class="credential-bottom"><div><strong>www.aspch.org</strong><span>Credencial verificable Mi ASPCH</span></div><div class="credential-qr-shell"><img class="credential-qr" src="/api/credential/qr?v=${Date.now()}" alt="QR de verificación de credencial"></div></div>
    </div>
    <div class="credential-actions">
      <input id="credential-photo-input" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/*">
      <button id="change-credential-photo" class="button ghost" type="button">Cambiar foto</button>
      ${c.photoSource==='PROFILE'?'<button id="restore-sipa-photo" class="button ghost" type="button">Volver a foto SIPA</button>':''}
      ${c.appleWalletReady?'<a class="button primary" href="/api/credential/wallet">Agregar a Apple Wallet</a>':'<button class="button ghost" type="button" disabled title="Requiere certificado Apple Pass Type ID">Apple Wallet · pendiente certificado</button>'}
    </div>
    <p class="hint credential-note">El QR valida la credencial sin publicar correo, teléfono ni fotografía. Puedes usar una foto personal; el retrato SIPA original no se modifica.</p>
  </div>`;
  $('#change-credential-photo').addEventListener('click',()=>$('#credential-photo-input').click());
  $('#credential-photo-input').addEventListener('change',uploadCredentialPhoto);
  $('#restore-sipa-photo')?.addEventListener('click',restoreSipaPhoto);
}
async function uploadCredentialPhoto(e){
  const file=e.target.files?.[0];if(!file)return;
  try{
    const dataUrl=await resizePhotoForCredential(file);
    await api('/api/credential/photo',{method:'POST',body:{dataUrl}});
    toast('Foto de la credencial actualizada.');
    await renderCredential();
  }catch(err){toast(err.message||'No fue posible actualizar la foto.',true)}
  finally{e.target.value=''}
}
async function restoreSipaPhoto(){
  try{await api('/api/credential/photo',{method:'DELETE'});toast('Se restauró la fotografía SIPA.');await renderCredential()}catch(err){toast(err.message,true)}
}
function resizePhotoForCredential(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      try{
        const maxW=1200,maxH=1600,scale=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight);
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const out=canvas.toDataURL('image/jpeg',.88);URL.revokeObjectURL(url);resolve(out);
      }catch(err){URL.revokeObjectURL(url);reject(err)}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('La imagen seleccionada no se pudo leer.'))};
    img.src=url;
  });
}

async function renderParking(date=state.parking?.date||today()){
  const selected=date||today(),weekStart=state.parkingWeekStart||mondayOf(selected);state.parkingWeekStart=weekStart;
  const data=await getParking(selected,true);state.parking=data;
  const allowed=data.access?.allowed??state.access?.parking??true;
  const dates=Array.from({length:7},(_,i)=>addDays(weekStart,i)),group87=data.spaces.filter(s=>s.building==='87'),group103=data.spaces.filter(s=>s.building==='103'),mine=data.mineReservation;
  const syncLabel=data.sync?.live?'<span class="parking-sync-status ok">● Sincronizado con ESTACIONAMIENTOS ASPCH</span>':(data.sync?.enabled?'<span class="parking-sync-status warn">● Sincronización temporalmente no disponible</span>':'');
  const previewStart=!allowed?`<div class="benefit-preview-shell"><div class="card benefit-preview-overlay" role="status"><span class="benefit-preview-lock">🔒</span><span class="eyebrow">VISTA PREVIA</span><h2>Estacionamiento bloqueado</h2><p>Puedes ver los cupos disponibles detrás de esta pantalla, pero no reservar mientras tu membresía esté morosa.</p><button class="button primary" data-go="profile">Ver situación y pago</button></div><div class="benefit-preview-content" inert aria-hidden="true">`:'';
  const previewEnd=!allowed?'</div></div>':'';
  $('#view').innerHTML=`${previewStart}<div class="parking-head card"><div><span class="eyebrow">ESTACIONAMIENTO</span><h2>Reserva aquí tu estacionamiento</h2>${syncLabel}<div class="parking-legend"><span><i class="free-dot"></i>Libre · toca para reservar</span><span><i class="occupied-dot"></i>Ocupado</span><span><i class="mine-dot"></i>Tu reserva</span></div></div><label class="date-picker">Otra fecha<input id="parking-date" type="date" min="${today()}" value="${data.date}"></label></div>
  <div class="parking-week-toolbar"><button id="parking-prev-week" class="button ghost">←</button><strong>${weekLabel(weekStart)}</strong><button id="parking-next-week" class="button ghost">→</button></div>
  <div class="date-strip week-7">${dates.map(d=>`<button class="date-chip ${d===data.date?'active':''}" data-date="${d}"><span>${weekdayShort(d)}</span><strong>${dayNum(d)}</strong><em>${monthShort(d)}</em></button>`).join('')}</div>
  ${mine?mineReservationHtml(mine,data.date):''}
  ${data.canSeeBoardParking?`<section class="section board-parking board-parking-priority"><div class="section-head"><div><h3>Padre Mariano 103 · Directorio</h3><p>Cupos exclusivos del Directorio.</p></div><span class="badge blue">Directorio</span></div><div class="parking-grid">${group103.map(s=>parkingSpaceHtml(s,allowed)).join('')}</div></section>`:''}
  <section class="section"><div class="section-head"><div><h3>Padre Mariano 87</h3><p>${allowed?'Toca un cupo gris para reservarlo aquí mismo':'Puedes ver disponibilidad, pero las reservas están deshabilitadas'} para ${humanDate(data.date)}.</p></div></div><div class="parking-grid">${group87.map(s=>parkingSpaceHtml(s,allowed)).join('')}</div></section>${previewEnd}`;
  $('#parking-date').addEventListener('change',e=>{state.parkingWeekStart=mondayOf(e.target.value);renderParking(e.target.value)});$('#parking-prev-week').onclick=()=>{state.parkingWeekStart=addDays(state.parkingWeekStart,-7);renderParking(state.parkingWeekStart)};$('#parking-next-week').onclick=()=>{state.parkingWeekStart=addDays(state.parkingWeekStart,7);renderParking(state.parkingWeekStart)};
  $$('.date-chip').forEach(b=>b.onclick=()=>renderParking(b.dataset.date));$$('.parking-space.available').forEach(b=>b.onclick=()=>reserveParking(b.dataset.space));$('#cancel-reservation')?.addEventListener('click',cancelParking);$('#parking-checkin')?.addEventListener('click',checkInParking);$('#parking-vacate')?.addEventListener('click',vacateParking);$('#enable-parking-notifications')?.addEventListener('click',enableBrowserNotifications);$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  clearTimeout(state.parkingPollTimer);state.parkingPollTimer=setTimeout(()=>{if(state.view==='parking')renderParking(state.parking?.date||data.date)},45000);
}

function parkingSpaceHtml(s,allowed=true){const cls=s.mine?'mine':s.occupied?'occupied':allowed?'available':'restricted';const status=s.mine?'✓ Tu reserva':s.occupied?'Ocupado':allowed?'Libre · toca para reservar':'Libre · restringido';return `<button class="parking-space ${cls}" data-space="${s.id}" aria-label="Estacionamiento ${escapeHtml(s.label)}: ${escapeHtml(status)}" ${(!allowed||s.occupied&&!s.mine)?'disabled':''}><span class="parking-number">${escapeHtml(s.label)}</span><small>${escapeHtml(status)}</small></button>`}

function mineReservationHtml(m,date){
  const todayFlag=date===today(),checked=!!m.checkedInAt;
  return `<div class="card parking-current"><div><span class="eyebrow">TU RESERVA</span><h3>Padre Mariano ${escapeHtml(m.building)} · ${escapeHtml(m.label)}</h3><p>${humanDate(date)}${checked?` · Llegada marcada ${hm(m.checkedInAt)}`:''}</p></div><div class="parking-current-actions">${todayFlag&&!checked?`<button id="parking-checkin" class="button primary">Ya estacioné</button><span class="hint">Al marcar llegada, recibirás un recordatorio fijo cada 4 horas hasta liberar el cupo.</span>`:''}${checked?`<button id="parking-vacate" class="button primary">Marcar desocupado</button>${'Notification'in window&&Notification.permission!=='granted'?'<button id="enable-parking-notifications" class="button ghost">Activar recordatorios</button>':''}`:`<button id="cancel-reservation" class="button ghost">Cancelar reserva</button>`}</div></div>`;
}

async function reserveParking(spaceId){try{await api('/api/parking/reserve',{method:'POST',body:{date:state.parking.date,spaceId}});toast('Estacionamiento reservado');renderParking(state.parking.date)}catch(e){toast(e.message,true)}}
async function cancelParking(){try{await api('/api/parking/reserve',{method:'DELETE',body:{date:state.parking.date}});toast('Reserva cancelada');renderParking(state.parking.date)}catch(e){toast(e.message,true)}}
async function checkInParking(){try{await api('/api/parking/check-in',{method:'POST',body:{date:state.parking.date}});await enableBrowserNotifications(true);toast('Llegada marcada. Te recordaremos cada 4 horas hasta que liberes el estacionamiento.');renderParking(state.parking.date)}catch(e){toast(e.message,true)}}

async function vacateParking(){try{await api('/api/parking/vacate',{method:'POST',body:{date:state.parking.date}});clearTimeout(state.reminderTimer);toast('Estacionamiento marcado como desocupado');renderParking(state.parking.date)}catch(e){toast(e.message,true)}}
async function requestParkingNotifications(){if(!('Notification'in window))return toast('Este navegador no ofrece notificaciones.',true);const p=await Notification.requestPermission();toast(p==='granted'?'Recordatorios activados':'No se concedió permiso',p!=='granted')}
function maybeParkingReminder(){clearTimeout(state.reminderTimer)}

async function showParkingNotification(title,body){toast(`${title} ${body}`);if('Notification'in window&&Notification.permission==='granted'){try{const reg=await navigator.serviceWorker?.ready;if(reg)await reg.showNotification(title,{body,icon:'/logo-aspch-original.png',badge:'/logo-aspch-original.png',tag:'mi-aspch-parking',data:{url:'/?view=parking'}});else new Notification(title,{body,icon:'/logo-aspch-original.png'})}catch{}}}

function loadNotificationPrefs(){try{return {...{parking:true,simulators:true,studyroom:true,activities:true,agreements:true,news:true,membership:true,marketplace:true},...JSON.parse(localStorage.getItem('miAspchNotifyPrefs')||'{}')}}catch{return {parking:true,simulators:true,studyroom:true,activities:true,agreements:true,news:true,membership:true,marketplace:true}}}

function saveNotificationPrefs(){localStorage.setItem('miAspchNotifyPrefs',JSON.stringify(state.notifyPrefs||{}))}
function setNotificationPref(key,value){state.notifyPrefs={...(state.notifyPrefs||loadNotificationPrefs()),[key]:!!value};saveNotificationPrefs();syncPushSubscription().catch(()=>{});toast(`Notificaciones de ${key} ${value?'activadas':'desactivadas'}.`)}

function notificationPrefToggle(key,title,desc){const on=state.notifyPrefs?.[key]!==false;return `<label class="notif-item"><input class="notif-toggle" data-key="${key}" type="checkbox" ${on?'checked':''}><div><strong>${title}</strong><span>${desc}</span></div></label>`}
async function enableBrowserNotifications(silent=false){
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window)){if(!silent)toast('Este navegador no ofrece Web Push.',true);return false}
  const p=await Notification.requestPermission();if(p!=='granted'){if(!silent)toast('No se concedió permiso para notificaciones.',true);return false}
  try{await syncPushSubscription();if(!silent)toast('Notificaciones push activadas en este dispositivo.');return true}catch(err){if(!silent)toast(err.message||'No fue posible activar Web Push.',true);return false}
}


async function syncPushSubscription(){
  const cfg=await api('/api/push/public-key');if(!cfg.enabled||!cfg.publicKey)throw new Error('Web Push aún no está configurado en el servidor.');
  const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64urlToBytes(cfg.publicKey)});
  await api('/api/push/subscribe',{method:'POST',body:{subscription:sub.toJSON(),topics:state.notifyPrefs||loadNotificationPrefs()}});
  return sub;
}

async function showAppNotification(kind,title,body,url='/?view=home'){
  toast(`${title} ${body}`);
  if(!('Notification'in window) || Notification.permission!=='granted') return;
  try{const reg=await navigator.serviceWorker?.ready;const opts={body,icon:'/logo-aspch-original.png',badge:'/logo-aspch-original.png',tag:`mi-aspch-${kind}`,data:{url}};if(reg)await reg.showNotification(title,opts);else new Notification(title,{body,icon:'/logo-aspch-original.png'})}catch{}
}
function maybeSimulatorReminder(){clearTimeout(state.simReminderTimer)}

function maybeRetirementNotification(membership){
  const notice=membership?.quote?.specialNotice;
  if(!notice)return;
  const key=`retirement-congrats-${membership.year}-${state.member?.id||'member'}`;
  if(localStorage.getItem(key)==='1')return;
  localStorage.setItem(key,'1');
  setTimeout(()=>showAppNotification('retirement',notice.title,notice.body,'/?view=home'),700);
}
function whatsappLink(text=''){return `https://wa.me/56948825381?text=${encodeURIComponent(text)}`}
function paymentMessage(){return `Hola ASPCH, soy ${titleName(state.member?.name||'socio')} y quiero consultar/pagar mi mensualidad en Mi ASPCH.`}

async function renderSimulators(){
  if(!state.simWeek)state.simWeek=mondayOf(today());const data=await getSimulators(state.simWeek,addDays(state.simWeek,4),true);state.simulators=data;if(!data.simulators.some(s=>s.id===state.simFilter))state.simFilter=data.simulators[0]?.id||'a320';renderSimulatorsFromCache();
}
function renderSimulatorsFromCache(){
  const data=state.simulators,isA320=state.simFilter==='a320',requestAllowed=data.requestAllowed!==false;
  const requestButton=isA320?`<a class="button primary ${requestAllowed?'':'disabled-link'}" ${requestAllowed?`href="${escapeHtml(data.a320RequestUrl||state.config?.features?.simulatorA320RequestUrl||'https://forms.gle/qzXaCUJgmTyufdKQA')}" target="_blank" rel="noopener noreferrer"`:'aria-disabled="true"'}>Solicitar turno A320 Touch ↗</a>`:'';
  const previewStart=!requestAllowed?`<div class="benefit-preview-shell"><div class="card benefit-preview-overlay" role="status"><span class="benefit-preview-lock">🔒</span><span class="eyebrow">VISTA PREVIA</span><h2>Solicitud de turnos bloqueada</h2><p>Puedes ver la agenda detrás de esta pantalla, pero no solicitar ni operar turnos mientras tu membresía esté morosa.</p><button class="button primary" data-go="profile">Ver situación y pago</button></div><div class="benefit-preview-content" inert aria-hidden="true">`:'';
  const previewEnd=!requestAllowed?'</div></div>':'';
  $('#view').innerHTML=`${previewStart}<div class="section-head simulator-head"><div><h3>Simuladores</h3></div></div>
  <div class="week-toolbar"><button id="prev-week" class="button ghost">←</button><button id="this-week" class="button ghost">Semana actual</button><strong>${weekLabel(data.from)}</strong><button id="next-week" class="button ghost">→</button></div>
  <div class="simulator-tabs">${data.simulators.map(t=>`<button class="sim-tab ${state.simFilter===t.id?'active':''}" data-sim="${t.id}">${escapeHtml(t.label)}</button>`).join('')}</div>
  ${isA320?`<div class="sim-request-bar"><div><strong>A320 Touch</strong></div>${requestButton}</div>`:''}
  <div class="sim-grid-card">${simulatorGridHtml(data,state.simFilter)}</div>${previewEnd}`;
  $$('.sim-tab').forEach(b=>b.onclick=()=>{state.simFilter=b.dataset.sim;renderSimulatorsFromCache()});$('#prev-week').onclick=()=>changeWeek(-7);$('#next-week').onclick=()=>changeWeek(7);$('#this-week').onclick=()=>{state.simWeek=mondayOf(today());renderSimulators()};$$('.sim-cancel').forEach(b=>b.onclick=()=>cancelSimulatorTurn(b.dataset.event));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
}

function changeWeek(n){state.simWeek=addDays(state.simWeek,n);renderSimulators()}
function simulatorGridHtml(data,simId){
  const days=Array.from({length:5},(_,i)=>addDays(data.from,i));
  const dayNames=['Lunes','Martes','Miércoles','Jueves','Viernes'];
  let html='<div class="sim-schedule touch-layout"><div class="sim-corner"><strong>ASIGNADOS</strong></div>'+days.map((d,i)=>`<div class="sim-day-head"><strong>${dayNames[i]}</strong><span>${dayNum(d)} ${monthShort(d)}</span></div>`).join('');
  for(const period of ['AM','PM']){
    html+=`<div class="sim-shift">${period}</div>`;
    for(const d of days){
      const o=data.occupancies.find(x=>x.simulatorId===simId&&x.start.slice(0,10)===d&&(x.period===period||inferPeriod(x.start)===period));
      const [a,b]=slotTimeForDay(d,period);
      const label=o?(o.mine?'Tu turno':'Ocupado'):'Disponible';
      const cancel=o?.mine&&o?.canCancel&&data.cancellationEnabled?`<button class="sim-cancel" data-event="${escapeHtml(o.id)}" type="button">Cancelar turno</button>`:'';
      html+=`<div class="sim-slot ${o?(o.mine?'mine':'busy'):'free'}"><strong>${label}</strong><span class="sim-time">${o?`${hm(o.start)}–${hm(o.end)}`:`${a}–${b}`}</span>${o?.mine?`<small>Confirmado</small>${cancel}`:'<small>&nbsp;</small>'}</div>`;
    }
  }
  return html+'</div>';
}

async function cancelSimulatorTurn(eventRef){
  if(!eventRef)return;
  const ok=confirm('¿Cancelar este turno confirmado? ASPCH será notificado y, si hay un siguiente socio disponible en la agenda, también recibirá un aviso. El turno NO se reasignará automáticamente.');
  if(!ok)return;
  try{
    const r=await api('/api/simulators/cancel',{method:'POST',body:{eventRef,from:state.simulators?.from||state.simWeek,to:state.simulators?.to||addDays(state.simWeek,4)}});
    toast(r.message||'Turno cancelado.');
    state.simulators=null;
    await renderSimulators();
  }catch(e){toast(e.message||'No fue posible cancelar el turno.',true)}
}


async function renderStudyRoom(){
  if(state.access?.studyRoom===false){$('#view').innerHTML=`<div class="card restricted-benefit"><span class="eyebrow">📖 SALA DE ESTUDIOS</span><h2>Beneficio temporalmente restringido</h2><p>Los socios morosos no pueden reservar la Sala de estudios. Regulariza tu membresía para recuperar este beneficio.</p><button class="button primary" data-go="profile">Ver membresía</button></div>`;$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));return}
  const from=new Date().toISOString(),to=new Date(Date.now()+21*86400_000).toISOString();const [data,waitData]=await Promise.all([api(`/api/study-room?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),api('/api/study-room/waitlist')]);
  const mine=data.reservations.filter(r=>r.mine),occupied=data.reservations.filter(r=>!r.mine),waitlist=waitData.waitlist||[];
  $('#view').innerHTML=`<div class="card study-hero"><span class="eyebrow">📖 SALA DE ESTUDIOS</span><h2>Reserva tu bloque</h2><p>Una sala · bloques de hasta 4 horas · puedes mantener varias reservas futuras · cancelación disponible siempre.</p>
  <form id="study-form" class="study-form"><label>Fecha<input id="study-date" type="date" min="${today()}" value="${today()}" required></label><label>Desde<input id="study-start" type="time" required></label><label>Hasta<input id="study-end" type="time" required></label><div class="study-actions"><button class="button primary" data-action="reserve">Reservar</button><button class="button ghost" data-action="waitlist">Avísame si se libera</button></div></form></div>
  <section class="section"><div class="section-head"><div><h3>Tus reservas</h3></div></div><div class="reservation-list">${mine.length?mine.map(r=>`<div class="card reservation-row"><div><strong>${formatLocalDateTime(r.start)}–${hm(r.end)}</strong><span>Sala de estudios</span></div><button class="button ghost study-cancel" data-id="${r.id}">Cancelar</button></div>`).join(''):'<div class="card empty">No tienes reservas futuras.</div>'}</div></section>
  <section class="section"><div class="section-head"><div><h3>Avísame si se libera</h3><p>Te avisamos por push; nunca se asigna automáticamente.</p></div></div><div class="reservation-list">${waitlist.length?waitlist.map(r=>`<div class="reservation-row compact"><div><strong>${formatLocalDateTime(r.start_at)}–${hm(r.end_at)}</strong><span>${r.notified_at?'Ya se envió un aviso de liberación':'Esperando liberación'}</span></div><button class="button ghost study-wait-cancel" data-id="${r.id}">Quitar aviso</button></div>`).join(''):'<div class="card empty">No tienes avisos de disponibilidad activos.</div>'}</div></section>
  <section class="section"><div class="section-head"><div><h3>Horarios ocupados</h3><p>Por privacidad no mostramos quién reservó.</p></div></div><div class="reservation-list">${occupied.length?occupied.map(r=>`<div class="reservation-row compact"><strong>${formatLocalDateTime(r.start)}–${hm(r.end)}</strong><span class="badge amber">Ocupada</span></div>`).join(''):'<div class="card empty">Sin reservas ajenas en los próximos 21 días.</div>'}</div></section>`;
  $('#study-form').onsubmit=reserveStudy;$$('.study-cancel').forEach(b=>b.onclick=()=>cancelStudy(Number(b.dataset.id)));$$('.study-wait-cancel').forEach(b=>b.onclick=()=>cancelStudyWait(Number(b.dataset.id)));
}
async function reserveStudy(e){e.preventDefault();const d=$('#study-date').value,a=$('#study-start').value,b=$('#study-end').value;if(!d||!a||!b)return;const action=e.submitter?.dataset?.action||'reserve';try{if(action==='waitlist'){await api('/api/study-room/waitlist',{method:'POST',body:{date:d,startTime:a,endTime:b}});await enableBrowserNotifications(true);toast('Te avisaremos si ese horario se libera.')}else{await api('/api/study-room/reserve',{method:'POST',body:{date:d,startTime:a,endTime:b}});toast('Sala de estudios reservada.')}renderStudyRoom()}catch(err){toast(err.message,true)}}
async function cancelStudyWait(id){try{await api('/api/study-room/waitlist',{method:'DELETE',body:{id}});toast('Aviso de disponibilidad eliminado.');renderStudyRoom()}catch(err){toast(err.message,true)}}
async function cancelStudy(id){if(!confirm('¿Cancelar esta reserva de Sala de estudios?'))return;try{await api('/api/study-room/reserve',{method:'DELETE',body:{id}});toast('Reserva cancelada.');renderStudyRoom()}catch(err){toast(err.message,true)}}

async function renderMarketplace(){
  const data=await api('/api/marketplace');state.marketplace=data.listings||[];
  $('#view').innerHTML=`<div class="market-hero card"><div><span class="eyebrow">🛒 MERCADO ASPCH</span><h2>Productos entre asociados</h2><p>Solo productos. Cada aviso es revisado por ASPCH antes de publicarse y expira a los 60 días.</p></div><button id="market-new" class="button primary">Publicar producto</button></div>
  <form id="market-form" class="card market-form hidden"><h3>Nueva publicación</h3><input id="market-title" maxlength="100" placeholder="Producto" required><textarea id="market-description" maxlength="2000" placeholder="Descripción" required></textarea><div class="grid two"><label>Valor (CLP)<input id="market-price" type="number" min="0" step="1" required></label><label>Contacto<input id="market-contact" maxlength="200" placeholder="Teléfono, WhatsApp, correo u otro" required></label></div><label>Fotos (1 a 5)<input id="market-images" type="file" accept="image/*" multiple required></label><p class="hint">Las fotos se comprimen antes de subirlas.</p><button class="button primary">Enviar a aprobación</button></form>
  <section class="section"><div class="market-grid">${state.marketplace.length?state.marketplace.map(marketplaceCard).join(''):'<div class="card empty">Aún no hay publicaciones.</div>'}</div></section>`;
  $('#market-new').onclick=()=>$('#market-form').classList.toggle('hidden');$('#market-form').onsubmit=createMarketplace;$$('.market-action').forEach(b=>b.onclick=()=>marketplaceAction(Number(b.dataset.id),b.dataset.action));$$('.market-edit').forEach(b=>b.onclick=()=>editMarketplace(Number(b.dataset.id)));$$('.market-report').forEach(b=>b.onclick=()=>reportMarketplaceUi(Number(b.dataset.id)));
}
function marketplaceCard(x){const status={PENDING:'Pendiente de aprobación',ACTIVE:'Publicado',SOLD:'Vendido',EXPIRED:'Vencido',REMOVED:'Retirado'}[x.status]||x.status;return `<article class="card market-card">${x.images?.[0]?`<img src="${escapeHtml(x.images[0].url)}" alt="">`:'<div class="market-placeholder">📦</div>'}<div class="market-card-body"><div class="market-card-head"><h3>${escapeHtml(x.title)}</h3><strong>${formatClpClient(x.price)}</strong></div><p>${escapeHtml(x.description)}</p><span class="market-contact">Contacto: ${escapeHtml(x.contact)}</span><div class="market-status"><span class="badge ${x.status==='ACTIVE'?'green':x.status==='PENDING'?'amber':'blue'}">${escapeHtml(status)}</span>${x.mine?'<span>Tu publicación</span>':''}</div>${x.mine?`<div class="toolbar">${!['REMOVED','SOLD'].includes(x.status)?`<button class="button ghost market-edit" data-id="${x.id}">Editar</button>`:''}${x.status==='ACTIVE'?`<button class="button ghost market-action" data-id="${x.id}" data-action="SOLD">Marcar vendido</button>`:''}${x.status==='EXPIRED'?`<button class="button ghost market-action" data-id="${x.id}" data-action="RENEW">Renovar 60 días</button>`:''}${!['REMOVED','SOLD'].includes(x.status)?`<button class="button ghost market-action" data-id="${x.id}" data-action="DELETE">Retirar</button>`:''}</div>`:(x.status==='ACTIVE'?`<div class="toolbar"><button class="link-button market-report" data-id="${x.id}">Reportar publicación</button></div>`:'')}</div></article>`}
async function createMarketplace(e){e.preventDefault();const files=[...$('#market-images').files];if(files.length<1||files.length>5)return toast('Selecciona entre 1 y 5 fotos.',true);setLoading(e.currentTarget,true);try{const images=[];for(const f of files)images.push(await compressMarketplaceImage(f));await api('/api/marketplace',{method:'POST',body:{title:$('#market-title').value,description:$('#market-description').value,price:Number($('#market-price').value),contact:$('#market-contact').value,images}});toast('Publicación enviada a aprobación de ASPCH.');renderMarketplace()}catch(err){toast(err.message,true)}finally{setLoading(e.currentTarget,false)}}
async function editMarketplace(id){
  const x=(state.marketplace||[]).find(v=>Number(v.id)===Number(id));if(!x)return;
  const title=prompt('Producto',x.title);if(title===null)return;const description=prompt('Descripción',x.description);if(description===null)return;const price=prompt('Valor CLP',String(x.price));if(price===null)return;const contact=prompt('Contacto',x.contact);if(contact===null)return;
  try{const r=await api('/api/marketplace/edit',{method:'POST',body:{id,title,description,price:Number(price),contact}});toast(r.message||'Cambios guardados.');renderMarketplace()}catch(err){toast(err.message,true)}
}
async function marketplaceAction(id,action){if(!confirm('¿Confirmar esta acción?'))return;try{await api('/api/marketplace/action',{method:'POST',body:{id,action}});renderMarketplace()}catch(err){toast(err.message,true)}}
async function reportMarketplaceUi(id){const reason=prompt('¿Por qué quieres reportar esta publicación?');if(reason===null||reason.trim().length<3)return;try{await api('/api/marketplace/report',{method:'POST',body:{id,reason}});toast('Reporte enviado a Informática ASPCH.')}catch(err){toast(err.message,true)}}
function compressMarketplaceImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{try{const max=1400,scale=Math.min(1,max/img.naturalWidth,max/img.naturalHeight),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);let q=.82,out=c.toDataURL('image/jpeg',q);while(out.length>1_800_000&&q>.45){q-=.08;out=c.toDataURL('image/jpeg',q)}URL.revokeObjectURL(url);resolve(out)}catch(e){URL.revokeObjectURL(url);reject(e)}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('No se pudo leer una foto.'))};img.src=url})}

async function renderActivities(){
  const {activities}=await api('/api/activities');const filter=state.activityFilter||'UPCOMING';
  const visible=activities.filter(a=>filter==='REGISTERED'?a.registered:filter==='FINISHED'?a.phase==='FINISHED':a.phase==='UPCOMING');
  $('#view').innerHTML=`<div class="card"><span class="eyebrow">🎓 ACTIVIDADES ASPCH</span><h2>Cursos y charlas</h2><p>La actividad vive en Mi ASPCH y la inscripción abre el Google Form oficial cuando corresponde. Puedes marcarla como inscrita para que aparezca en tu agenda y recibir recordatorio el día anterior.</p><div class="segmented activity-tabs"><button class="activity-filter ${filter==='UPCOMING'?'active':''}" data-filter="UPCOMING">Próximos</button><button class="activity-filter ${filter==='REGISTERED'?'active':''}" data-filter="REGISTERED">Inscrito</button><button class="activity-filter ${filter==='FINISHED'?'active':''}" data-filter="FINISHED">Finalizados</button></div></div>
  <section class="section"><div class="activity-grid">${visible.length?visible.map(activityCard).join(''):'<div class="card empty">No hay actividades en esta vista.</div>'}</div></section>`;
  $$('.activity-filter').forEach(b=>b.onclick=()=>{state.activityFilter=b.dataset.filter;renderActivities()});$$('.activity-registration').forEach(b=>b.onclick=()=>toggleActivityRegistration(Number(b.dataset.id),b.dataset.registered!=='true'));
}
function activityCard(a){const type=a.type==='COURSE'?'Curso':a.type==='TALK'?'Charla':'Actividad';const phase=a.phase==='FINISHED'?'Finalizado':a.status==='CLOSED'?'Inscripción cerrada':'Próximo';return `<article class="card activity-card"><div class="activity-card-top"><span class="badge blue">${type}</span><span class="badge ${a.registered?'green':'blue'}">${a.registered?'✓ Inscrito':phase}</span></div><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.description||'')}</p>${a.starts_at?`<span>📅 ${formatLocalDateTime(a.starts_at)}</span>`:''}<div class="toolbar">${a.external_url&&a.phase==='UPCOMING'?`<a class="button primary" href="${escapeHtml(a.external_url)}" target="_blank" rel="noopener noreferrer">Abrir inscripción ↗</a>`:''}${a.phase!=='FINISHED'?`<button class="button ghost activity-registration" data-id="${a.id}" data-registered="${a.registered?'true':'false'}">${a.registered?'Quitar de inscritos':'Ya me inscribí'}</button>`:''}</div></article>`}
async function toggleActivityRegistration(id,registered){try{await api('/api/activities/registration',{method:'POST',body:{id,registered}});if(registered)await enableBrowserNotifications(true);toast(registered?'Actividad marcada como inscrita.':'Actividad quitada de tus inscritos.');renderActivities()}catch(err){toast(err.message,true)}}

async function renderVotes(){
  const {votes=[]}=await api('/api/votes');
  $('#view').innerHTML=`<div class="card vote-hero"><span class="eyebrow">🗳️ PARTICIPACIÓN ASPCH</span><h2>Votaciones</h2><p>Cuando Directorio abra una votación habilitada para ti, podrás participar una sola vez. El padrón se congela al abrirse.</p><div class="vote-privacy"><strong>Voto secreto</strong><span>Mi ASPCH registra que participaste, pero la papeleta secreta se guarda sin tu Member ID. No es un sistema criptográfico verificable contra un administrador con acceso directo a la base del servidor.</span></div></div><section class="section"><div class="vote-list">${votes.length?votes.map(voteMemberCard).join(''):'<div class="card empty">No hay votaciones abiertas o cerradas visibles.</div>'}</div></section>`;
  $$('.vote-cast').forEach(b=>b.onclick=()=>castVoteUi(Number(b.dataset.election),Number(b.dataset.option)));
  $$('.vote-verify').forEach(b=>b.onclick=()=>verifyVoteReceiptUi(Number(b.dataset.election)));
}
function voteMemberCard(v){
  const open=v.status==='OPEN',eligible=!!v.eligible,voted=!!v.voted,secret=v.secrecy==='SECRET';
  const receipt=localStorage.getItem(`miAspchVoteReceipt:${v.id}`)||'';
  const options=(v.options||[]).map(o=>`<button class="button ${open&&eligible&&!voted?'secondary':'ghost'} vote-cast" data-election="${v.id}" data-option="${o.id}" ${open&&eligible&&!voted?'':'disabled'}>${escapeHtml(o.label)}</button>`).join('');
  const result=v.results?`<div class="vote-results">${(v.results.options||[]).map(o=>`<div><span>${escapeHtml(o.label)}</span><strong>${o.votes}</strong></div>`).join('')}<p>${v.results.participation||0} de ${v.results.eligible||0} participaron · ${v.results.turnout||0}%</p></div>`:'';
  return `<article class="card vote-card"><div class="section-head"><div><span class="eyebrow">${secret?'VOTO SECRETO':'VOTO IDENTIFICADO'} · ${escapeHtml(v.status)}</span><h3>${escapeHtml(v.title)}</h3><p>${escapeHtml(v.description||'')}</p></div><span class="badge ${voted?'green':eligible?'blue':'amber'}">${voted?'✓ Participaste':eligible?'Habilitado':'Fuera del padrón'}</span></div>${open&&eligible&&!voted?`<p class="hint">Selecciona una opción. La participación es definitiva y no se puede cambiar.</p><div class="vote-options">${options}</div>`:''}${open&&!eligible?'<div class="notice amber"><strong>No estás habilitado en el padrón de esta votación.</strong></div>':''}${voted&&receipt?`<div class="vote-receipt"><span>Tu comprobante guardado en este dispositivo</span><code>${escapeHtml(receipt)}</code>${v.status!=='OPEN'?`<button class="button ghost vote-verify" data-election="${v.id}">Verificar comprobante</button>`:''}</div>`:''}${result}</article>`;
}
async function castVoteUi(electionId,optionId){if(!confirm('Tu voto se registrará de forma definitiva. ¿Confirmar esta opción?'))return;try{const r=await api('/api/votes/cast',{method:'POST',body:{electionId,optionId}});if(r.receipt)localStorage.setItem(`miAspchVoteReceipt:${electionId}`,r.receipt);toast('Participación registrada. Guarda tu comprobante.');renderVotes()}catch(e){toast(e.message,true)}}
async function verifyVoteReceiptUi(electionId){const receipt=localStorage.getItem(`miAspchVoteReceipt:${electionId}`)||'';if(!receipt)return toast('Este dispositivo no conserva el comprobante.',true);try{const r=await api(`/api/votes/receipt?electionId=${electionId}&receipt=${encodeURIComponent(receipt)}`);toast(r.found?'Comprobante incluido en el escrutinio.':'Comprobante no encontrado.',!r.found)}catch(e){toast(e.message,true)}}

function renderContact(){
  $('#view').innerHTML = `<div class="card contact-hero">
    <h2>Contacto</h2>
  </div>
  <div class="contact-channels-grid" style="margin-top:1.5rem;">
    <a class="card contact-card" href="tel:+56222358612"><span class="contact-icon">☎️</span><div><strong>Oficina ASPCH 1</strong><span>2 2235 8612</span></div><span class="button primary compact">Llamar</span></a>
    <a class="card contact-card" href="tel:+56222359821"><span class="contact-icon">☎️</span><div><strong>Oficina ASPCH 2</strong><span>2 2235 9821</span></div><span class="button primary compact">Llamar</span></a>
    <a class="card contact-card" href="mailto:aspch@aspch.org"><span class="contact-icon">✉️</span><div><strong>Correo</strong><span>aspch@aspch.org</span></div><span class="button ghost compact">Enviar correo</span></a>
    <a class="card contact-card" href="https://maps.apple.com/?q=Padre+Mariano+103,+Providencia" target="_blank" rel="noopener noreferrer"><span class="contact-icon">📍</span><div><strong>Dirección</strong><span>Padre Mariano 103, oficina 405</span></div><span class="button ghost compact">Ver dirección</span></a>
  </div>`;
}
function renderAdvisors(){ return renderContact(); }
async function renderConvenios(){const {agreements}=await api('/api/agreements');const official=state.config?.features?.conveniosUrl||'https://aspch.org/convenios/';$('#view').innerHTML=`<div class="card convenio-card"><span class="eyebrow">🤝 CONVENIOS ASPCH</span><h2>Beneficios para asociados</h2><p>Convenios administrados desde Mi ASPCH. La página oficial sigue disponible como fuente institucional.</p><a class="button ghost" href="${escapeHtml(official)}" target="_blank" rel="noopener noreferrer">Página oficial ↗</a></div><section class="section"><div class="agreement-grid">${agreements.length?agreements.map(a=>`<article class="card agreement-card">${a.logo_url?`<img src="${escapeHtml(a.logo_url)}" alt="">`:''}<span class="eyebrow">CONVENIO</span><h3>${escapeHtml(a.title)}</h3>${a.benefit?`<strong>${escapeHtml(a.benefit)}</strong>`:''}<p>${escapeHtml(a.description||'')}</p>${a.valid_until?`<span class="hint">Vigencia: ${escapeHtml(a.valid_until)}</span>`:''}<a class="button primary" href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">Ver convenio ↗</a></article>`).join(''):'<div class="card empty">No hay convenios cargados.</div>'}</div></section>`}

function libraryDoc(icon,title,meta,url,badge='Documento'){
  return `<a class="library-item" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><div class="library-icon">${icon}</div><div class="library-copy"><div class="library-title-row"><strong>${escapeHtml(title)}</strong><span class="library-badge">${escapeHtml(badge)}</span></div><span>${escapeHtml(meta)}</span><em>Abrir documento ↗</em></div></a>`;
}
async function renderLibrary(query='',category=''){
  const qs=new URLSearchParams();if(query)qs.set('q',query);if(category)qs.set('category',category);const {items}=await api('/api/library'+(qs.toString()?`?${qs}`:''));
  const categories=[...new Set(items.map(x=>x.category).filter(Boolean))].sort();
  $('#view').innerHTML=`<div class="library-hero card"><div><span class="eyebrow">📚 BIBLIOTECA ASPCH</span><h2>Documentos para asociados</h2><p>Busca por título, fuente o categoría y guarda tus referencias frecuentes como favoritas.</p></div><a class="button ghost" href="https://aspch.org/biblioteca/" target="_blank" rel="noopener noreferrer">Biblioteca oficial ↗</a></div>
    <form id="library-search-form" class="library-search card"><input id="library-q" value="${escapeHtml(query)}" placeholder="Buscar en Biblioteca ASPCH"><select id="library-category"><option value="">Todas las categorías</option>${categories.map(c=>`<option ${c===category?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select><button class="button primary">Buscar</button><button id="library-favorites-only" class="button ghost" type="button">★ Mis favoritos</button></form>
    <section class="section"><div class="library-grid">${items.length?items.map(libraryApiCard).join(''):'<div class="card empty">No encontramos documentos con ese filtro.</div>'}</div></section>`;
  $('#library-search-form').onsubmit=e=>{e.preventDefault();renderLibrary($('#library-q').value.trim(),$('#library-category').value)};
  $('#library-favorites-only').onclick=()=>renderLibraryFavorites();$$('.library-favorite').forEach(b=>b.onclick=()=>toggleLibraryFavoriteUi(Number(b.dataset.id),b.dataset.favorite!=='true'));
}
function libraryApiCard(x){return `<article class="library-item card"><div class="library-icon">${x.favorite?'★':'📄'}</div><div class="library-copy"><div class="library-title-row"><strong>${escapeHtml(x.title)}</strong><span class="library-badge">${escapeHtml(x.category||x.source||'Documento')}</span></div><span>${escapeHtml(x.description||'')}</span><div class="toolbar"><a class="link-button" href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a><button class="link-button library-favorite" data-id="${x.id}" data-favorite="${x.favorite?'true':'false'}">${x.favorite?'★ Quitar favorito':'☆ Favorito'}</button></div></div></article>`}
async function renderLibraryFavorites(){const {items}=await api('/api/library');const fav=items.filter(x=>x.favorite);$('#view').innerHTML=`<div class="library-hero card"><div><span class="eyebrow">★ FAVORITOS</span><h2>Tu Biblioteca</h2><p>Referencias que guardaste para encontrarlas rápido.</p></div><button id="back-library" class="button ghost">Volver a Biblioteca</button></div><section class="section"><div class="library-grid">${fav.length?fav.map(libraryApiCard).join(''):'<div class="card empty">Aún no tienes favoritos.</div>'}</div></section>`;$('#back-library').onclick=()=>renderLibrary();$$('.library-favorite').forEach(b=>b.onclick=()=>toggleLibraryFavoriteUi(Number(b.dataset.id),false))}
async function toggleLibraryFavoriteUi(id,favorite){try{await api('/api/library/favorite',{method:'POST',body:{id,favorite}});toast(favorite?'Guardado en favoritos.':'Quitado de favoritos.');renderLibrary()}catch(err){toast(err.message,true)}}

async function renderNews(){const news=await getNews(true);$('#view').innerHTML=`<div class="card"><div class="section-head"><div><h3>Noticias / Instagram</h3></div></div><div class="news-list">${news.length?news.map(newsHtml).join(''):'<div class="empty">Sin publicaciones.</div>'}</div></div>`}
function adminMembersTable(rows){
  if(!rows.length)return '<div class="empty">No se encontraron socios.</div>';
  return `<div class="admin-members-table" role="table" aria-label="Socios"><div class="admin-members-table-head" role="row"><span>Socio</span><span>RUT</span><span>Email</span><span>Estado</span></div>${rows.map(m=>`<button class="admin-member-row" type="button" role="row" data-id="${m.id}"><strong>${escapeHtml(m.name||'No disponible')}</strong><span data-label="RUT">${escapeHtml(m.rutMasked||'No disponible')}</span><span data-label="Email">${escapeHtml(m.emailMasked||'No disponible')}</span>${adminMemberStateBadge(m.membershipState)}</button>`).join('')}</div>`;
}
async function loadAdminMemberDetail(id){
  const box=$('#admin-member-detail');if(!box)return;state.adminMembers.selectedId=id;box.innerHTML='<div class="empty compact-empty">Cargando ficha…</div>';
  try{const detail=await api(`/api/admin/members/${id}`);if(state.adminMembers.selectedId!==id)return;box.innerHTML=adminMemberDetailHtml(detail);bindAdminMemberActions(detail)}catch(err){box.innerHTML=`<div class="empty">${escapeHtml(err.message)}</div>`}
}
function showAdminMemberDetailEmpty(){const box=$('#admin-member-detail');if(box)box.innerHTML='<div class="admin-member-detail-empty"><span>👤</span><strong>Selecciona un socio</strong><p>La información personal completa se carga únicamente al abrir una ficha.</p></div>'}
function adminMemberStateBadge(status){const label=status||'No disponible',tone=['ACTIVO','JUBILADO','DIRECTORIO'].includes(status)?'green':status==='MOROSO'?'amber':status==='CONGELADO'?'blue':status==='DESAFILIADO'?'red':'';return `<span class="badge ${tone}"><i class="dot"></i>${escapeHtml(label)}</span>`}
function availableAdminValue(value){return value===null||value===undefined||String(value).trim()===''?'No disponible':String(value)}
function adminMemberDetailHtml(d){
  const m=d.member||{},real=d.realState||{},applied=d.appliedState||{},personal=d.personal||{},security=d.security||{},updates=d.lastUpdate||{},reservations=d.reservations||[],diagnosis=d.diagnosis||[],actions=d.actions||{};
  const parking=reservations.filter(r=>r.type==='PARKING'),study=reservations.filter(r=>r.type==='STUDY_ROOM');
  return `<div class="admin-member-detail-head"><div><span class="eyebrow">FICHA DE SOCIO</span><h3>${escapeHtml(availableAdminValue(m.name))}</h3></div>${adminMemberStateBadge(m.membershipState)}</div>
  <div class="admin-member-diagnosis">${diagnosis.map(adminMemberDiagnosisHtml).join('')}</div>
  <div class="admin-member-detail-section source-real"><div class="admin-section-title"><div><span class="eyebrow">FUENTE AUTORITATIVA</span><h4>Estado XLSM</h4></div>${adminMemberStateBadge(real.status)}</div><div class="admin-member-detail-fields">${field('Estado explícito',availableAdminValue(real.status))}${field('Valor original',availableAdminValue(real.originalComment))}${field('Nombre en fuente',availableAdminValue(real.sourceName))}${field('Fila fuente',real.sourceRow||'No disponible')}${field('Última lectura',real.lastReadAt?formatLocalDateTime(real.lastReadAt):'No disponible')}${field('Archivo modificado',real.sourceModifiedAt?formatLocalDateTime(real.sourceModifiedAt):'No disponible')}</div>${real.matchIssue?`<p class="hint warning-copy">Diagnóstico: ${escapeHtml(real.matchIssue.replaceAll('_',' '))}. No se infirió ningún estado.</p>`:''}</div>
  <div class="admin-member-detail-section source-applied"><div class="admin-section-title"><div><span class="eyebrow">SQLITE MI ASPCH</span><h4>Estado aplicado por Mi ASPCH</h4></div>${adminMemberStateBadge(applied.state)}</div><div class="admin-member-detail-fields">${field('Estado usado',availableAdminValue(applied.state))}${field('Estado financiero local',availableAdminValue(applied.financialState))}${field('Indicador active',applied.activeFlag?'Sí':'No')}${field('Restricciones activas',(applied.blockedModules||[]).join(', ')||'Ninguna')}</div><p class="hint">Causa: ${escapeHtml(applied.cause||'No disponible')}</p><div class="admin-access-columns"><div><strong>Módulos permitidos</strong><p>${escapeHtml((applied.allowedModules||[]).join(', ')||'Ninguno')}</p></div><div><strong>Módulos bloqueados</strong><p>${escapeHtml((applied.blockedModules||[]).join(', ')||'Ninguno')}</p></div></div></div>
  <div class="admin-member-detail-section"><span class="eyebrow">BD SOCIOS</span><h4>Datos personales</h4><div class="admin-member-detail-fields">${field('RUT',availableAdminValue(personal.rut))}${field('Email',availableAdminValue(personal.email))}${field('Teléfono',availableAdminValue(personal.phone))}${field('Empresa / institución',availableAdminValue(personal.employer))}${field('Categoría',availableAdminValue(personal.category))}${field('Cargo',availableAdminValue(personal.position))}</div><p class="hint">Última actualización del snapshot: ${personal.lastSyncAt?formatLocalDateTime(personal.lastSyncAt):'No disponible'}. BD SOCIOS aporta datos personales, no autoridad de membresía.</p></div>
  <div class="admin-member-detail-section"><span class="eyebrow">SQLITE MI ASPCH</span><h4>Estado operativo</h4><div class="admin-member-detail-fields">${field('Sesiones activas',Number(security.activeSessions||0))}${field('Passkeys',Number(security.passkeys||0))}${field('PIN',security.pinConfigured?'Configurado':'No configurado')}${field('OTP',security.otp?.pending?'Pendiente y vigente':'Sin OTP vigente')}${field('Último acceso',security.lastAccessAt?formatLocalDateTime(security.lastAccessAt):'No disponible')}${field('Último uso passkey',security.passkeyLastUsedAt?formatLocalDateTime(security.passkeyLastUsedAt):'No disponible')}</div><p class="hint">No se muestran PIN, hashes, tokens, credenciales WebAuthn ni OTP actuales.</p></div>
  <div class="admin-member-detail-section"><h4>Reservas activas</h4><div class="admin-member-reservations">${reservations.map(adminMemberReservationHtml).join('')||'<div class="empty compact-empty">Sin reservas activas relevantes en SQLite.</div>'}</div><p class="hint">Simuladores: no disponible sin una fuente local fiable.</p></div>
  <div class="admin-member-detail-section"><span class="eyebrow">ACCIONES AUDITADAS</span><h4>Operación segura</h4><form class="admin-direct-pin" data-member="${m.id}"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" placeholder="Nuevo PIN (4–6)" required><button class="button secondary" type="submit">Guardar PIN directo</button>${actions.resetPin?'<button class="button ghost admin-member-action" data-action="reset-pin" type="button">Resetear PIN</button>':''}</form><div class="admin-member-actions"><button class="button secondary admin-member-action" data-action="refresh">Refrescar diagnóstico</button>${actions.closeSessions?'<button class="button ghost admin-member-action" data-action="close-sessions">Cerrar sesiones</button>':''}${actions.revokePasskeys?'<button class="button ghost admin-member-action" data-action="revoke-passkeys">Revocar passkeys</button>':''}${actions.issueOtp?'<button class="button ghost admin-member-action" data-action="issue-otp">Generar y enviar nuevo OTP</button>':'<button class="button ghost" disabled title="Entrega OTP deshabilitada">OTP no disponible</button>'}</div><p class="hint">El cambio de PIN es directo y queda auditado sin mostrar el valor. No existe acción manual para cambiar membresía.</p></div>
  <div class="admin-member-detail-section"><h4>Marcas de actualización</h4><div class="admin-member-detail-fields">${field('BD SOCIOS local',updates.memberUpdatedAt?formatLocalDateTime(updates.memberUpdatedAt):'No disponible')}${field('Última sincronización',updates.financialSyncedAt?formatLocalDateTime(updates.financialSyncedAt):'No disponible')}${field('XLSM leído',real.lastReadAt?formatLocalDateTime(real.lastReadAt):'No disponible')}</div></div>`;
}
function adminMemberDiagnosisHtml(item){const tone=item.severity==='critical'?'red':item.severity==='warning'?'amber':item.severity==='ok'?'green':'blue';return `<div class="admin-diagnosis ${tone}"><span>${item.severity==='critical'?'!':item.severity==='ok'?'✓':'⚠'}</span><div><strong>${escapeHtml(item.title||'Diagnóstico')}</strong><p>${escapeHtml(item.message||'')}</p></div></div>`}
function adminMemberReservationHtml(r){if(r.type==='PARKING')return `<div><span>🚗</span><div><strong>Estacionamiento ${escapeHtml(r.label||'No disponible')}</strong><small>${escapeHtml(r.date||'No disponible')}${r.building?` · Padre Mariano ${escapeHtml(r.building)}`:''}</small></div><button class="button ghost admin-reservation-action" data-action="release-parking" data-id="${Number(r.id)}">Liberar</button></div>`;return `<div><span>📖</span><div><strong>${escapeHtml(r.label||'Sala de estudios')}</strong><small>${r.start?formatLocalDateTime(r.start):'No disponible'}${r.end?` → ${formatLocalDateTime(r.end)}`:''}</small></div><button class="button ghost admin-reservation-action" data-action="cancel-study" data-id="${Number(r.id)}">Cancelar</button></div>`}
function bindAdminMemberActions(detail){
  $$('.admin-member-action').forEach(button=>button.onclick=()=>adminMasterMemberAction(detail.member.id,button.dataset.action));
  $$('.admin-reservation-action').forEach(button=>button.onclick=()=>adminMasterMemberAction(detail.member.id,button.dataset.action,{reservationId:Number(button.dataset.id)}));
  $$('.admin-direct-pin').forEach(form=>form.onsubmit=e=>{e.preventDefault();const pin=new FormData(form).get('pin');adminMasterMemberAction(detail.member.id,'set-pin',{pin})});
}
async function adminMasterMemberAction(memberId,action,extra={}){
  const prompts={refresh:'Releer ahora el XLSM en modo diagnóstico y refrescar esta ficha?', 'release-parking':'Liberar esta reserva de estacionamiento? La acción quedará auditada.', 'cancel-study':'Cancelar esta reserva de sala? No se enviarán notificaciones externas.', 'close-sessions':'Cerrar todas las sesiones activas de este socio?', 'revoke-passkeys':'Revocar todas las passkeys de este socio? Deberá registrarlas nuevamente.', 'issue-otp':'Generar y enviar un OTP nuevo? El código actual no será mostrado.'};
  if(!['set-pin','reset-pin'].includes(action)&&!confirm(prompts[action]||'Confirmar acción administrativa?'))return;
  const confirmations={'release-parking':'LIBERAR RESERVA','cancel-study':'CANCELAR RESERVA','close-sessions':'CERRAR SESIONES','revoke-passkeys':'REVOCAR PASSKEYS','issue-otp':'GENERAR OTP'};
  try{await api(`/api/admin/members/${memberId}/actions/${action}`,{method:'POST',body:{...extra,confirm:confirmations[action]||''}});toast(action==='refresh'?'Diagnóstico actualizado.':'Acción administrativa completada y auditada.');await loadAdminMemberDetail(memberId)}catch(err){toast(err.message,true)}
}
async function renderAdminReservations(){
  if(state.member.role!=='ADMIN')return go('home');
  const d=await api('/api/admin/reservations'),s=d.summary||{},parking=d.parking||{},study=d.study||{},sim=d.simulators||{};
  const available=Math.max(0,Number(s.parkingSpaces||0)-Number(s.parkingToday||0));
  $('#view').innerHTML=`
  <section class="admin-module-hero card"><div><span class="eyebrow">CONTROL INFORMÁTICA · RESERVAS</span><h2>Operación local de reservas</h2><p>Vista consolidada de SQLite. Liberar estacionamiento y cancelar sala reutiliza acciones ADMIN confirmadas y auditadas, sin escrituras externas.</p></div><span class="badge blue">${escapeHtml(d.today||today())}</span></section>
  <div class="admin-summary-grid">
    ${adminSummaryCard('🚗','Estacionamientos hoy',s.parkingToday||0,`${available} cupos locales disponibles`)}
    ${adminSummaryCard('🗓️','Reservas activas',s.parkingActive||0,'estacionamientos hoy y futuros')}
    ${adminSummaryCard('📖','Sala de estudios',s.studyActive||0,'reservas activas')}
    ${adminSummaryCard('⏳','Lista de espera',s.waitlistActive||0,'solicitudes activas')}
  </div>
  <section class="section admin-master-grid">
    <div class="card admin-master-wide"><span class="eyebrow">ESTACIONAMIENTOS DE HOY</span><h3>Ocupación local</h3><div class="admin-operation-list">${(parking.today||[]).map(r=>adminParkingReservationRow(r,true)).join('')||'<div class="empty compact-empty">Sin reservas activas para hoy.</div>'}</div></div>
    <div class="card"><span class="eyebrow">ESTACIONAMIENTOS</span><h3>Reservas activas</h3><div class="admin-operation-list">${(parking.active||[]).map(r=>adminParkingReservationRow(r,false)).join('')||'<div class="empty compact-empty">Sin reservas activas.</div>'}</div></div>
    <div class="card"><span class="eyebrow">SALA DE ESTUDIOS</span><h3>Reservas activas</h3><div class="admin-operation-list">${(study.active||[]).map(adminStudyReservationRow).join('')||'<div class="empty compact-empty">Sin reservas activas de sala.</div>'}</div></div>
    <div class="card"><span class="eyebrow">LISTA DE ESPERA</span><h3>Solicitudes activas</h3><div class="admin-operation-list">${(study.waitlist||[]).map(adminStudyWaitlistRow).join('')||'<div class="empty compact-empty">Sin solicitudes en espera.</div>'}</div></div>
    <div class="card"><span class="eyebrow">SIMULADORES</span><h3>Fuente de ocupación</h3><div class="admin-alert amber"><span>⚠</span><div><strong>Fuente no disponible / local no fiable</strong><p>${escapeHtml(sim.impact||'No se muestran turnos hasta contar con una sincronización local segura.')}</p></div></div><p class="hint">Estado: ${escapeHtml(String(sim.status||'NO_RELIABLE_LOCAL_SOURCE').replaceAll('_',' '))}. Esta vista no consulta Calendar.</p></div>
    <div class="card"><span class="eyebrow">AUDITORÍA</span><h3>Acciones recientes de reservas</h3><div class="admin-event-list">${(d.audit||[]).map(adminReservationAuditRow).join('')||'<div class="empty compact-empty">Sin acciones ADMIN registradas.</div>'}</div></div>
  </section>`;
  $$('.admin-reservation-control').forEach(button=>button.onclick=()=>adminReservationControl(Number(button.dataset.member),button.dataset.action,Number(button.dataset.id)));
}
function adminParkingReservationRow(r,isToday){return `<div class="admin-operation-row"><span class="admin-operation-icon">🚗</span><div><strong>${escapeHtml(r.memberName||'Socio')}</strong><p>Est. ${escapeHtml(r.spaceLabel||r.spaceId||'—')} · Padre Mariano ${escapeHtml(r.building||'—')} · ${isToday?'Hoy':escapeHtml(r.reservationDate||'—')}</p><small>${escapeHtml(r.memberEmail||'')}</small></div><button class="button ghost admin-reservation-control" type="button" data-member="${r.memberId}" data-id="${r.id}" data-action="release-parking">Liberar</button></div>`}
function adminStudyReservationRow(r){return `<div class="admin-operation-row"><span class="admin-operation-icon">📖</span><div><strong>${escapeHtml(r.memberName||'Socio')}</strong><p>${escapeHtml(r.roomName||'Sala de estudios')} · ${formatLocalDateTime(r.startAt)} – ${hm(r.endAt)}</p><small>${escapeHtml(r.memberEmail||'')}</small></div><button class="button ghost admin-reservation-control" type="button" data-member="${r.memberId}" data-id="${r.id}" data-action="cancel-study">Cancelar</button></div>`}
function adminStudyWaitlistRow(r){return `<div class="admin-operation-row"><span class="admin-operation-icon">⏳</span><div><strong>${escapeHtml(r.memberName||'Socio')}</strong><p>${escapeHtml(r.roomName||'Sala de estudios')} · ${formatLocalDateTime(r.startAt)} – ${hm(r.endAt)}</p><small>${r.notifiedAt?'Aviso local registrado '+formatLocalDateTime(r.notifiedAt):'Aún sin aviso registrado'}</small></div><span class="badge amber">EN ESPERA</span></div>`}
function adminReservationAuditRow(r){const label=r.action==='ADMIN_PARKING_RELEASED'?'Estacionamiento liberado':'Sala cancelada';return `<div class="admin-dashboard-event"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(r.actorName||'ADMIN')} → ${escapeHtml(r.subjectName||'Socio')}</span></div><time>${formatLocalDateTime(r.createdAt)}</time></div>`}
async function adminReservationControl(memberId,action,reservationId){
  const parking=action==='release-parking',message=parking?'¿Liberar esta reserva de estacionamiento? La acción quedará auditada.':'¿Cancelar esta reserva de sala? No se enviarán notificaciones externas.';
  if(!confirm(message))return;
  const confirmText=parking?'LIBERAR RESERVA':'CANCELAR RESERVA';
  try{await api(`/api/admin/members/${memberId}/actions/${action}`,{method:'POST',body:{reservationId,confirm:confirmText}});toast('Reserva actualizada y auditada.');await renderAdminReservations()}catch(err){toast(err.message,true)}
}
async function renderAdminNotifications(){
  if(state.member.role!=='ADMIN')return go('home');
  const d=await api('/api/admin/notifications'),push=d.push||{},otp=d.gmailOtp||{},errors=d.recentErrors||[];
  $('#view').innerHTML=`<section class="admin-module-hero card"><div><span class="eyebrow">CONTROL INFORMÁTICA · NOTIFICACIONES</span><h2>Entregas y canales</h2><p>Estado local de Push y Gmail OTP. No se muestran códigos, tokens, endpoints, claves ni payloads de notificación.</p></div>${adminControlStatusBadge(push.status)}</section>
  <div class="admin-summary-grid">
    ${adminSummaryCard('📱','Suscripciones Push',push.subscriptions||0,`${push.subscribers||0} socios con dispositivo`)}
    ${adminSummaryCard('⚠','Dispositivos con error',push.devicesWithError||0,'sin exponer endpoints')}
    ${adminSummaryCard('✓','Entregas 24 h',push.delivered24h||0,push.lastSentAt?`Último ${formatLocalDateTime(push.lastSentAt)}`:'Sin envío registrado')}
    ${adminSummaryCard('!','Fallos 24 h',push.failed24h||0,'entregas con estado FAILED')}
  </div>
  <section class="section admin-master-grid">
    <div class="card"><div class="admin-section-title"><div><span class="eyebrow">WEB PUSH</span><h3>Estado del canal</h3></div>${adminControlStatusBadge(push.status)}</div><div class="admin-member-detail-fields">${field('Configurado',push.enabled?'Sí':'No')}${field('Suscripciones activas',push.subscriptions||0)}${field('Dispositivos con error',push.devicesWithError||0)}${field('Último envío',push.lastSentAt?formatLocalDateTime(push.lastSentAt):'No disponible')}</div><p class="hint">Las suscripciones 404/410 se eliminan automáticamente durante una entrega. No existe limpieza ADMIN manual segura.</p></div>
    <div class="card"><div class="admin-section-title"><div><span class="eyebrow">GMAIL OTP</span><h3>Verificación de acceso</h3></div>${adminControlStatusBadge(otp.status)}</div><div class="admin-member-detail-fields">${field('Emitidos 24 h',otp.issued24h||0)}${field('Pendientes',otp.pending||0)}${field('Expirados',otp.expired||0)}${field('Última emisión',otp.lastIssuedAt?formatLocalDateTime(otp.lastIssuedAt):'No disponible')}</div><p class="hint">La vista solo cuenta registros; no muestra ni genera códigos.</p></div>
    <div class="card admin-master-wide"><span class="eyebrow">ERRORES RECIENTES</span><h3>Push y entregas</h3><div class="admin-error-list">${errors.map(adminNotificationErrorRow).join('')||'<div class="empty compact-empty">Sin errores de notificaciones registrados.</div>'}</div></div>
    <div class="card admin-master-wide"><div class="section-head"><div><span class="eyebrow">ACCIONES</span><h3>OTP por socio</h3><p>La reemisión permanece en la ficha o en Seguridad y exige confirmación; solo está disponible si Gmail OTP está habilitado.</p></div><button class="button secondary" id="admin-notification-members" type="button">Abrir fichas de socios</button></div></div>
  </section>`;
  $('#admin-notification-members').onclick=()=>go('admin-members');
}
function adminNotificationErrorRow(row){return `<div class="admin-error-row"><div><strong>${escapeHtml(row.source||'NOTIFICACIÓN')}</strong><p>${escapeHtml(row.summary||'Error de entrega')}${row.memberName?` · ${escapeHtml(row.memberName)}`:''}</p></div><time>${row.createdAt?formatLocalDateTime(row.createdAt):'Sin fecha'}</time></div>`}
async function renderAdminSecurity(){
  if(state.member.role!=='ADMIN')return go('home');
  const d=await api('/api/admin/security'),s=d.summary||{},admin=d.admin||{},members=d.members||[],events=d.events||[];
  $('#view').innerHTML=`<section class="admin-module-hero card"><div><span class="eyebrow">CONTROL INFORMÁTICA · SEGURIDAD</span><h2>Sesiones y credenciales</h2><p>Resumen operativo sin hashes, salts, tokens, credenciales WebAuthn ni códigos OTP. No crea accesos alternativos.</p></div>${adminControlStatusBadge(admin.configured&&admin.active&&admin.pinConfigured?'OK':'ADVERTENCIA')}</section>
  <div class="admin-summary-grid">
    ${adminSummaryCard('🔐','Sesiones activas',s.activeSessions||0,`${s.usersWithMultipleSessions||0} usuarios con múltiples`)}
    ${adminSummaryCard('🔒','Sesiones bloqueadas',s.lockedSessions||0,'PIN/passkey aún requerido')}
    ${adminSummaryCard('🗝️','Passkeys',s.passkeys||0,s.lastPasskeyUse?`Último uso ${formatLocalDateTime(s.lastPasskeyUse)}`:'Sin uso registrado')}
    ${adminSummaryCard('••••','PIN configurado',s.pinConfigured||0,`${s.pinMissing||0} socios sin PIN`)}
  </div>
  <section class="section admin-master-grid">
    <div class="card"><span class="eyebrow">ADMIN</span><h3>Configuración administrativa</h3><div class="admin-member-detail-fields">${field('Cuenta configurada',admin.configured?'Sí':'No')}${field('Cuenta activa',admin.active?'Sí':'No')}${field('Email coincide',admin.emailMatches?'Sí':'No')}${field('PIN ADMIN',admin.pinConfigured?'Configurado':'No configurado')}</div></div>
    <div class="card"><span class="eyebrow">TELEMETRÍA DE ACCESO</span><h3>Disponibilidad de fuente</h3><div class="admin-alert amber"><span>ℹ</span><div><strong>Intentos y bloqueos no persistidos</strong><p>${escapeHtml(d.attempts?.detail||'Sin fuente disponible.')} ${escapeHtml(d.accountBlocks?.detail||'')}</p></div></div></div>
    <div class="card admin-master-wide"><span class="eyebrow">SOCIOS CON CONFIGURACIÓN DE SEGURIDAD</span><h3>Acciones confirmadas y auditadas</h3><div class="admin-security-list">${members.map(m=>adminSecurityMemberRow(m,d.gmailOtpEnabled)).join('')||'<div class="empty compact-empty">Sin sesiones, PIN, passkeys u OTP activos en socios.</div>'}</div></div>
    <div class="card admin-master-wide"><span class="eyebrow">EVENTOS RECIENTES</span><h3>Seguridad y OTP</h3><div class="admin-audit-list">${events.map(adminAuditViewRow).join('')||'<div class="empty compact-empty">Sin eventos de seguridad auditados.</div>'}</div></div>
  </section>`;
  $$('.admin-security-action').forEach(button=>button.onclick=()=>adminSecurityAction(Number(button.dataset.member),button.dataset.action));
  $$('.admin-security-pin').forEach(form=>form.onsubmit=e=>{e.preventDefault();const pin=new FormData(form).get('pin');adminSecurityAction(Number(form.dataset.member),'set-pin',{pin})});
}
function adminSecurityMemberRow(m,otpEnabled){return `<div class="admin-security-row"><div><strong>${escapeHtml(m.name||'Socio')}</strong><span>${escapeHtml(m.emailMasked||'')} · ${m.active?'Activo':'Inactivo'}</span><small>${m.activeSessions} sesión(es) · ${m.lockedSessions} bloqueada(s) · ${m.passkeys} passkey(s) · PIN ${m.pinConfigured?'sí':'no'}${m.lastPasskeyUse?` · último uso ${formatLocalDateTime(m.lastPasskeyUse)}`:''}</small></div><form class="admin-security-pin" data-member="${m.id}"><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" placeholder="Nuevo PIN" required><button class="button secondary" type="submit">Guardar PIN</button></form><div class="toolbar">${m.activeSessions?`<button class="button ghost admin-security-action" data-member="${m.id}" data-action="close-sessions">Cerrar sesiones</button>`:''}${m.passkeys?`<button class="button ghost admin-security-action" data-member="${m.id}" data-action="revoke-passkeys">Revocar passkeys</button>`:''}${m.pinConfigured?`<button class="button ghost admin-security-action" data-member="${m.id}" data-action="reset-pin">Resetear PIN</button>`:''}<button class="button secondary admin-security-action" data-member="${m.id}" data-action="issue-otp" ${otpEnabled?'':'disabled'}>Regenerar OTP</button></div></div>`}
async function adminSecurityAction(memberId,action,extra={}){
  const prompts={'close-sessions':'¿Cerrar todas las sesiones activas de este socio?','revoke-passkeys':'¿Revocar todas las passkeys de este socio?','issue-otp':'¿Generar y enviar un OTP nuevo? El código no será mostrado.'},confirmations={'close-sessions':'CERRAR SESIONES','revoke-passkeys':'REVOCAR PASSKEYS','issue-otp':'GENERAR OTP'};
  if(!['set-pin','reset-pin'].includes(action)&&!confirm(prompts[action]||'¿Confirmar acción de seguridad?'))return;
  try{await api(`/api/admin/members/${memberId}/actions/${action}`,{method:'POST',body:{...extra,confirm:confirmations[action]||''}});toast('Acción de seguridad completada y auditada.');await renderAdminSecurity()}catch(err){toast(err.message,true)}
}
async function renderAdminAudit(filters={}){
  if(state.member.role!=='ADMIN')return go('home');
  const qs=new URLSearchParams();for(const [key,value] of Object.entries(filters))if(value)qs.set(key,value);qs.set('limit','200');
  const d=await api(`/api/admin/audit?${qs}`),f=d.filters||{},rows=d.rows||[];
  $('#view').innerHTML=`<section class="admin-module-hero card"><div><span class="eyebrow">CONTROL INFORMÁTICA · AUDITORÍA</span><h2>Registro sanitizado</h2><p>Eventos de audit_log con actor, acción, socio afectado, categoría y resultado. Los detalles se reducen a campos operativos permitidos.</p></div><span class="badge blue">${d.total||0} resultado(s)</span></section>
  <form id="admin-audit-filters" class="card admin-audit-filters"><label>Desde<input id="admin-audit-from" type="date" value="${escapeHtml(filters.from||'')}"></label><label>Hasta<input id="admin-audit-to" type="date" value="${escapeHtml(filters.to||'')}"></label><label>Acción<select id="admin-audit-action"><option value="">Todas</option>${(f.actions||[]).map(action=>`<option value="${escapeHtml(action)}" ${filters.action===action?'selected':''}>${escapeHtml(action)}</option>`).join('')}</select></label><label>Socio<select id="admin-audit-member"><option value="">Todos</option>${(f.members||[]).map(member=>`<option value="${member.id}" ${String(filters.memberId||'')===String(member.id)?'selected':''}>${escapeHtml(member.name)}</option>`).join('')}</select></label><label>Categoría<select id="admin-audit-category"><option value="">Todas</option>${(f.categories||[]).map(category=>`<option value="${category}" ${filters.category===category?'selected':''}>${escapeHtml(category)}</option>`).join('')}</select></label><div class="admin-audit-filter-actions"><button class="button secondary" type="submit">Aplicar filtros</button><button class="button ghost" id="admin-audit-clear" type="button">Limpiar</button></div></form>
  <section class="section card"><div class="admin-audit-table"><div class="admin-audit-head"><span>Fecha</span><span>Actor / socio</span><span>Acción</span><span>Categoría</span><span>Resultado</span><span>Resumen</span></div>${rows.map(adminAuditViewRow).join('')||'<div class="empty compact-empty">No hay eventos para estos filtros.</div>'}</div>${Number(d.total||0)>Number(d.limit||200)?`<p class="hint">Se muestran los ${d.limit} eventos más recientes del filtro.</p>`:''}</section>`;
  $('#admin-audit-filters').onsubmit=e=>{e.preventDefault();renderAdminAudit({from:$('#admin-audit-from').value,to:$('#admin-audit-to').value,action:$('#admin-audit-action').value,memberId:$('#admin-audit-member').value,category:$('#admin-audit-category').value})};
  $('#admin-audit-clear').onclick=()=>renderAdminAudit();
}
function adminAuditViewRow(row){return `<div class="admin-audit-view-row"><time>${row.createdAt?formatLocalDateTime(row.createdAt):'Sin fecha'}</time><div><strong>${escapeHtml(row.actorName||'Sistema')}</strong><small>${row.subjectName?`→ ${escapeHtml(row.subjectName)}`:'Sin socio afectado'}</small></div><code>${escapeHtml(row.action||'EVENTO')}</code><span>${escapeHtml(row.category||'OTROS')}</span>${adminControlStatusBadge(row.result||'OK')}<p>${escapeHtml(row.summary||'Sin detalle operativo adicional.')}</p></div>`}
async function renderAdminIntegrations(){
  if(state.member.role!=='ADMIN')return go('home');
  const d=await api('/api/admin/integrations');
  $('#view').innerHTML=`<section class="admin-module-hero card"><div><span class="eyebrow">CONTROL INFORMÁTICA · INTEGRACIONES</span><h2>Estado y efecto operativo</h2><p>Capacidades configuradas y última evidencia local conocida. Esta carga no ejecuta probes de red ni dispara sincronizaciones.</p></div><span class="badge green">SIN PROBES EXTERNOS</span></section>
  <section class="section admin-integration-grid">${(d.items||[]).map(adminIntegrationCard).join('')}</section>
  <p class="hint">Generado ${formatLocalDateTime(d.generatedAt)} · Probe externo ejecutado: ${d.externalProbePerformed?'sí':'no'}.</p>`;
}
function adminControlStatusBadge(status){const value=String(status||'ADVERTENCIA'),tone=value==='OK'?'green':value==='ERROR'?'red':value==='DESHABILITADO'?'blue':'amber';return `<span class="badge ${tone}"><i class="dot"></i>${escapeHtml(value)}</span>`}
function adminIntegrationCard(item){return `<article class="card admin-integration-card"><div class="admin-section-title"><div><span class="eyebrow">INTEGRACIÓN</span><h3>${escapeHtml(item.label||item.id)}</h3></div>${adminControlStatusBadge(item.status)}</div><p>${escapeHtml(item.summary||'Sin información local.')}</p><div class="admin-integration-impact"><strong>Funcionalidad afectada</strong><span>${escapeHtml(item.affects||'No informada.')}</span></div><div class="admin-integration-meta"><strong>${escapeHtml(item.lastKnownLabel||'Última evidencia')}</strong><span>${item.lastKnownAt?formatLocalDateTime(item.lastKnownAt):'No disponible'}</span><small>${escapeHtml(item.probe||'')}</small></div></article>`}
async function renderAdminSystem(){
  if(state.member.role!=='ADMIN')return go('home');
  const d=await api('/api/admin/system'),runtime=d.runtime||{},sqlite=d.sqlite||{},backups=d.backups||[],errors=d.recentErrors||[],failed=d.failedJobs||[],container=d.container||{};
  $('#view').innerHTML=`<section class="admin-module-hero card"><div><span class="eyebrow">CONTROL INFORMÁTICA · SISTEMA</span><h2>Diagnóstico local acotado</h2><p>Runtime, integridad SQLite, tablas, backups y fallos registrados. Sin shell, SQL libre, navegador de archivos ni editor de configuración.</p></div>${adminControlStatusBadge(sqlite.ok?'OK':'ERROR')}</section>
  <div class="admin-summary-grid">
    ${adminSummaryCard('🏷️','Versión',runtime.version||'—',`Node ${runtime.node||'—'}`)}
    ${adminSummaryCard('⏱️','Uptime',formatAdminDuration(runtime.uptimeSeconds),'proceso actual')}
    ${adminSummaryCard('🗄️','SQLite',sqlite.ok?'OK':'ERROR',sqlite.sizeBytes==null?'Tamaño no disponible':formatBytes(sqlite.sizeBytes))}
    ${adminSummaryCard('📋','Tablas',(sqlite.tables||[]).length,`${errors.length} errores recientes`)}
  </div>
  <section class="section admin-master-grid">
    <div class="card"><span class="eyebrow">SQLITE</span><h3>Integridad y tamaño</h3><div class="admin-member-detail-fields">${field('quick_check',sqlite.ok?'OK':(sqlite.quickCheck||[]).join(', ')||'No disponible')}${field('Tamaño DB',sqlite.sizeBytes==null?'No disponible':formatBytes(sqlite.sizeBytes))}${field('Tablas',(sqlite.tables||[]).length)}${field('Motor','node:sqlite')}</div></div>
    <div class="card"><span class="eyebrow">CONTENEDOR</span><h3>Estado de runtime</h3><div class="admin-alert amber"><span>ℹ</span><div><strong>${escapeHtml(container.status||'NO DISPONIBLE')}</strong><p>${escapeHtml(container.detail||'No existe una fuente segura configurada.')}</p></div></div><p class="hint">No se consulta Docker desde la aplicación.</p></div>
    <div class="card"><span class="eyebrow">BACKUPS</span><h3>Copias recientes</h3><div class="admin-backup-list">${backups.map(adminMasterBackup).join('')||'<div class="empty compact-empty">Sin backups registrados.</div>'}</div></div>
    <div class="card"><span class="eyebrow">ERRORES RECIENTES</span><h3>Registro local resumido</h3><div class="admin-error-list">${errors.map(adminMasterError).join('')||'<div class="empty compact-empty">Sin errores recientes registrados.</div>'}</div></div>
    <div class="card admin-master-wide"><span class="eyebrow">JOBS Y SYNCS FALLIDOS</span><h3>Fallos conocidos</h3><div class="admin-error-list">${failed.map(adminMasterError).join('')||'<div class="empty compact-empty">Sin jobs o sincronizaciones fallidas registradas.</div>'}</div></div>
    <div class="card admin-master-wide"><span class="eyebrow">TABLAS SQLITE</span><h3>Inventario y filas</h3><div class="admin-table-stats">${(sqlite.tables||[]).map(t=>`<div><span>${escapeHtml(t.name)}</span><strong>${t.count==null?'—':Number(t.count).toLocaleString('es-CL')}</strong></div>`).join('')}</div></div>
  </section>`;
}
function renderAdminPlaceholder(id){
  if(state.member.role!=='ADMIN')return go('home');
  const [icon,title,description]=ADMIN_PLACEHOLDERS[id];
  $('#view').innerHTML=`<div class="card admin-placeholder"><span>${icon}</span><span class="eyebrow">ESTRUCTURA ADMIN</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><strong>Pendiente · sin funciones ni datos adicionales</strong></div>`;
}
async function renderAdmin(){return renderDeveloper()}
async function renderDeveloper(){
  if(state.member.role!=='ADMIN')return go('home');
  const o=await api('/api/admin/overview'),caps=o.google||{},m=o.metrics||{};
  const pending=(o.marketplace||[]).filter(x=>x.status==='PENDING');
  const reports=(o.marketplaceReports||[]).filter(x=>x.status==='OPEN');
  const modules=o.modules||{};
  state.instagramSync=o.instagram||{};
  const metrics=[
    ['Socios activos',m.members?.active||0,'👥'],['Morosos',m.members?.moroso||0,'💳'],['Directorio',m.members?.board||0,'⭐'],['Estac. activas',m.parking?.active||0,'🚗'],
    ['Sala activa',m.study?.active||0,'📖'],['Lista espera',m.study?.waitlist||0,'⏳'],['Mercado pendiente',m.marketplace?.pending||0,'🛒'],['Reportes abiertos',m.marketplace?.reports||0,'🚩'],
    ['Votaciones abiertas',m.votes?.open||0,'🗳️'],['Push devices',m.push?.subscriptions||0,'🔔'],['Sesiones',m.sessions?.active||0,'🔐'],['Auditoría',m.audit?.rows||0,'🧾']
  ];
  $('#view').innerHTML=`
  <div class="developer-hero card"><div><span class="eyebrow">🛠️ DEVELOPER</span><h2>Developer Center</h2><p>Control Center existente para operación, contenido, seguridad, mantenimiento, sincronización, auditoría y diagnóstico. Las herramientas de alto riesgo permanecen limitadas a acciones predefinidas: no se expone shell, SQL libre ni secretos por web.</p></div><div class="dev-version"><strong>v${escapeHtml(state.config?.version||'0.6.16')}</strong><span>${escapeHtml(state.member.email||'ADMIN')}</span></div></div>
  <div class="dev-metric-grid">${metrics.map(x=>`<div class="card dev-metric"><span>${x[2]}</span><strong>${x[1]}</strong><small>${x[0]}</small></div>`).join('')}</div>

  
  <details class="dev-section card" open><summary>📸 Noticias e Instagram</summary><div class="dev-section-body">
    <div class="admin-status-grid">
      <div>
        <span class="eyebrow">INSTAGRAM SYNC</span>
        <h3 id="ig-status">Estado: ${escapeHtml(state.instagramSync?.status || 'No sincronizado')}</h3>
        <p class="hint">Última sincr: ${escapeHtml(state.instagramSync?.lastSync || '—')}</p>
        <p class="hint">Publicaciones encontradas: ${escapeHtml(state.instagramSync?.count || '0')}</p>
        <button class="button primary" style="margin-top:0.5rem;" onclick="adminSyncInstagram()">Sincronizar ahora</button>
      </div>
    </div>
  </div></details>

  <details class="dev-section card"><summary>⚙️ Sistema, Google y mantenimiento</summary><div class="dev-section-body">
    <div class="admin-status-grid">
      <div><span class="eyebrow">GOOGLE WORKSPACE</span><h3>Modo híbrido</h3><div class="capability-grid">${cap('Sheets READ',caps.sheets?.read)}${cap('Sheets WRITE',caps.sheets?.write)}${cap('Calendar READ',caps.calendar?.read)}${cap('Calendar WRITE',caps.calendar?.write)}${cap('Gmail OTP',caps.gmail?.otp)}${cap('Gmail NOTIF',caps.gmail?.notifications)}</div><p class="hint">OTP y correos automáticos están separados. Durante QA puedes tener datos reales sin despachar notificaciones por email.</p></div>
      <div><span class="eyebrow">MÓDULOS</span><h3>Mantenimiento selectivo</h3><div class="module-list">${Object.entries(modules).map(([k,v])=>moduleAdminRow(k,v)).join('')}</div></div>
    </div>
    <div class="toolbar dev-toolbar"><button class="button primary dev-job" data-job="sync_all">Sync TODO</button><button class="button secondary dev-job" data-job="members_sync">Sync socios</button><button class="button secondary dev-job" data-job="parking_sync">Sync estacionamientos</button><button class="button secondary dev-job" data-job="financial_sync">Releer XLSM</button><button class="button ghost dev-job" data-job="notification_cycle">Ejecutar ciclo notificaciones</button><button class="button ghost dev-job" data-job="marketplace_expire">Expirar Mercado</button><button class="button ghost dev-job" data-job="cleanup_sessions">Limpiar sesiones vencidas</button><button class="button ghost" id="dev-clear-cache">Vaciar cachés runtime</button></div>
  </div></details>

  <details class="dev-section card" open><summary>📊 Base Arianna, sincronización y backups</summary><div class="dev-section-body">
    <div class="grid two"><div><span class="eyebrow">ESTADO PAGO 2026</span><h3>Fuente financiera</h3><p>XLSM habilitado únicamente para lectura diagnóstica. No carga archivos, no persiste estados y no cambia membresías.</p><div class="finance-counts">${Object.entries(o.finance?.counts||{}).map(([k,v])=>`<span><strong>${v}</strong>${escapeHtml(k)} local</span>`).join('')}</div><div class="toolbar"><button class="button ghost" id="sync-financial">Releer XLSM en diagnóstico</button></div></div>
    <div><span class="eyebrow">BACKUPS SQLITE</span><h3>Copias automáticas y manuales</h3><div class="toolbar"><button class="button primary" id="dev-backup-now">Crear backup ahora</button></div><div class="dev-list compact">${(o.backups||[]).slice(0,8).map(b=>`<div><strong>${escapeHtml(b.file_name||'—')}</strong><span>${escapeHtml(b.status)} · ${formatBytes(Number(b.size_bytes||0))} · ${formatLocalDateTime(b.created_at)}</span></div>`).join('')||'<div class="empty">Aún no hay backups registrados.</div>'}</div><p class="hint">La restauración no se expone por web para evitar destruir la base en producción. El README incluye el procedimiento controlado.</p></div></div>
  </div></details>

  <details class="dev-section card" open><summary>🔔 Push developer</summary><div class="dev-section-body">
    <div class="grid two"><div><span class="eyebrow">ESTE DISPOSITIVO</span><h3>${o.push?.subscriptions||0} suscripciones registradas</h3><p>${o.push?.enabled?'VAPID configurado.':'VAPID no configurado.'}</p><div class="toolbar"><button class="button secondary" id="admin-enable-push">Activar push aquí</button><button class="button ghost" id="dev-test-self-push">Prueba a Informática</button></div></div>
    <form id="dev-push-form" class="admin-form"><span class="eyebrow">ENVÍO CONTROLADO</span><input id="dev-push-member" type="number" min="1" placeholder="Member ID (vacío = todos)"><input id="dev-push-title" value="Mi ASPCH" placeholder="Título"><textarea id="dev-push-body" placeholder="Mensaje" required></textarea><input id="dev-push-url" value="/?view=home" placeholder="Ruta al tocar"><div class="toolbar"><button class="button ghost" type="button" id="dev-push-dry">Simular audiencia</button><button class="button primary" type="submit">Enviar</button></div><label class="danger-confirm"><input id="dev-push-all-confirm" placeholder="Para broadcast: ENVIAR A TODOS"></label></form></div>
  </div></details>

  <details class="dev-section card" open><summary>👥 Inspector de socios y seguridad</summary><div class="dev-section-body">
    <form id="dev-member-search" class="dev-search"><input id="dev-member-q" placeholder="Nombre, email o RUT" minlength="2" required><button class="button secondary">Buscar</button></form><div id="dev-member-results" class="dev-member-results"><div class="empty">Busca un socio para revisar estado, dispositivos, sesiones y credencial.</div></div>
  </div></details>

  <details class="dev-section card" open><summary>🛒 Mercado ASPCH y reportes</summary><div class="dev-section-body">
    <h3>Aprobación (${pending.length})</h3><div class="market-grid">${pending.length?pending.map(adminMarketCard).join(''):'<div class="card empty">Sin publicaciones pendientes.</div>'}</div>
    <h3 style="margin-top:22px">Reportes abiertos (${reports.length})</h3><div class="dev-list">${reports.length?reports.map(reportAdminRow).join(''):'<div class="empty">Sin reportes abiertos.</div>'}</div>
  </div></details>

  <details class="dev-section card" open><summary>🗳️ Votaciones</summary><div class="dev-section-body"><div class="grid two"><form id="vote-admin-form" class="admin-form"><input id="vote-id" type="hidden"><h3 id="vote-form-title">Nueva votación</h3><input id="vote-title" placeholder="Título" required><textarea id="vote-desc" placeholder="Descripción / pregunta"></textarea><select id="vote-secrecy"><option value="SECRET">Secreta</option><option value="IDENTIFIED">Identificada</option></select><select id="vote-eligibility"><option value="ACTIVE_ALL">Todos los socios activos</option><option value="AL_DIA_ONLY">Solo al día / exentos</option><option value="BOARD_ONLY">Solo Directorio</option></select><label>Apertura programada (opcional)<input id="vote-opens" type="datetime-local"></label><label>Cierre programado (opcional)<input id="vote-closes" type="datetime-local"></label><textarea id="vote-options" placeholder="Una opción por línea&#10;Sí&#10;No" required></textarea><div class="toolbar"><button class="button primary" id="vote-save-button">Crear borrador</button><button class="button ghost hidden" type="button" id="vote-cancel-edit">Cancelar edición</button></div><p class="hint">Al abrir se congela el padrón. Flujo irreversible: Borrador → Abierta → Cerrada → Archivada.</p></form><div><h3>Administrar</h3><div class="dev-list">${(o.votes||[]).map(voteAdminRow).join('')||'<div class="empty">Sin votaciones.</div>'}</div></div></div></div></details>

  <details class="dev-section card"><summary>📖 Sala de estudios</summary><div class="dev-section-body"><div class="grid two"><div><h3>Próximas reservas</h3><div class="reservation-list">${(o.study?.reservations||[]).map(r=>`<div class="reservation-row compact"><div><strong>${formatLocalDateTime(r.start)}</strong><span>${escapeHtml(r.member_name||'')} · ${escapeHtml(r.member_email||'')}</span></div><button class="button ghost admin-study-cancel" data-id="${r.id}">Cancelar</button></div>`).join('')||'<div class="empty">Sin reservas.</div>'}</div></div><div><h3>Lista de espera</h3><div class="dev-list compact">${(o.study?.waitlist||[]).map(w=>`<div><strong>${escapeHtml(w.member_name||'')}</strong><span>${formatLocalDateTime(w.start_at)} → ${formatLocalDateTime(w.end_at)}</span></div>`).join('')||'<div class="empty">Sin espera activa.</div>'}</div></div></div></div></details>

  <details class="dev-section card"><summary>🎓 Cursos, charlas y actividades</summary><div class="dev-section-body"><div class="grid two"><form id="activity-form" class="admin-form"><h3>Nueva actividad</h3><select id="activity-type"><option value="COURSE">Curso</option><option value="TALK">Charla</option><option value="EVENT">Actividad</option></select><input id="activity-title" placeholder="Título" required><textarea id="activity-desc" placeholder="Descripción"></textarea><label>Inicio<input id="activity-start" type="datetime-local"></label><label>Término<input id="activity-end" type="datetime-local"></label><input id="activity-url" type="url" placeholder="https://forms.gle/..." required><button class="button primary">Publicar</button></form><div><h3>Administrar</h3><div class="dev-list">${(o.activities||[]).map(activityAdminRow).join('')||'<div class="empty">Sin actividades.</div>'}</div></div></div></div></details>

  <details class="dev-section card"><summary>🤝 Convenios</summary><div class="dev-section-body"><div class="grid two"><form id="agreement-form" class="admin-form"><input id="agreement-id" type="hidden"><input id="agreement-title" placeholder="Nombre convenio" required><textarea id="agreement-desc" placeholder="Descripción"></textarea><textarea id="agreement-benefit" placeholder="Beneficio"></textarea><input id="agreement-url" type="url" placeholder="https://..." required><input id="agreement-logo" type="url" placeholder="Logo URL (opcional)"><input id="agreement-valid" type="date"><button class="button primary">Guardar convenio</button></form><div class="dev-list">${(o.agreements||[]).map(agreementAdminRow).join('')||'<div class="empty">Sin convenios.</div>'}</div></div></div></details>

  <details class="dev-section card"><summary>📚 Biblioteca</summary><div class="dev-section-body"><div class="grid two"><form id="library-admin-form" class="admin-form"><input id="library-admin-id" type="hidden"><input id="library-admin-category" placeholder="Categoría" value="General" required><input id="library-admin-title" placeholder="Título" required><textarea id="library-admin-desc" placeholder="Descripción"></textarea><input id="library-admin-url" type="url" placeholder="https://..." required><input id="library-admin-source" placeholder="Fuente"><button class="button primary">Guardar documento</button></form><div class="dev-list">${(o.library||[]).map(libraryAdminRow).join('')||'<div class="empty">Sin documentos.</div>'}</div></div></div></details>

  <details class="dev-section card"><summary>📰 Noticias</summary><div class="dev-section-body"><div class="grid two"><form id="news-form" class="admin-form"><h3>Nueva noticia</h3><input id="news-title" placeholder="Título" required><textarea id="news-body" placeholder="Contenido" required></textarea><label><input id="news-pinned" type="checkbox"> Destacar</label><button class="button primary">Publicar</button></form><div class="dev-list">${(o.news||[]).map(n=>`<div><div><strong>${escapeHtml(n.title)}</strong><span>${formatLocalDateTime(n.published_at)}${n.pinned?' · Destacada':''}</span></div><button class="button ghost admin-news-delete" data-id="${n.id}">Eliminar</button></div>`).join('')||'<div class="empty">Sin noticias.</div>'}</div></div></div></details>

  <details class="dev-section card"><summary>🧾 Auditoría, base de datos y diagnósticos</summary><div class="dev-section-body">
    <div class="toolbar"><button class="button secondary" id="dev-diagnostics">Cargar diagnóstico</button><button class="button ghost" id="dev-copy-diagnostics">Copiar diagnóstico</button><button class="button ghost dev-db-action" data-action="quick_check">DB quick_check</button><button class="button ghost dev-db-action" data-action="optimize">PRAGMA optimize</button><button class="button ghost dev-db-action" data-action="wal_checkpoint">WAL checkpoint</button></div><pre id="dev-diagnostics-box" class="dev-code">Pulsa “Cargar diagnóstico”.</pre><div class="dev-export"><select id="dev-export-dataset"><option value="members">Socios</option><option value="finance">Finanzas</option><option value="parking">Estacionamientos</option><option value="study">Sala de estudios</option><option value="marketplace">Mercado</option><option value="activities">Actividades</option><option value="votes">Votaciones</option><option value="audit">Auditoría</option></select><button class="button secondary" id="dev-export-data">Exportar CSV</button></div>
    <h3>Tablas SQLite</h3><div class="db-stat-grid">${(o.dbStats||[]).map(x=>`<div><strong>${escapeHtml(x.name)}</strong><span>${x.count??'—'}</span></div>`).join('')}</div>
    <h3>Últimas acciones</h3><div class="audit-table">${(o.audit||[]).map(auditAdminRow).join('')||'<div class="empty">Sin auditoría.</div>'}</div>
  </div></details>`;

  $('#sync-financial').onclick=adminFinancialSync;
  $('#admin-enable-push').onclick=()=>enableBrowserNotifications(); $('#dev-test-self-push').onclick=adminPushSelfTest;
  $('#dev-push-dry').onclick=()=>adminPushSend(true); $('#dev-push-form').onsubmit=e=>{e.preventDefault();adminPushSend(false)};
  $('#dev-member-search').onsubmit=adminMemberSearchUi;
  $('#dev-backup-now').onclick=()=>adminRunJob('backup'); $('#dev-clear-cache').onclick=adminClearCache;
  $$('.dev-job').forEach(b=>b.onclick=()=>adminRunJob(b.dataset.job)); $$('.module-toggle').forEach(b=>b.onclick=()=>adminToggleModule(b.dataset.module,b.dataset.enabled!=='true'));
  $$('.market-moderate').forEach(b=>b.onclick=()=>adminModerate(Number(b.dataset.id),b.dataset.status)); $$('.market-report-resolve').forEach(b=>b.onclick=()=>adminResolveReport(Number(b.dataset.id),b.dataset.status));
  $$('.admin-study-cancel').forEach(b=>b.onclick=()=>adminStudyCancel(Number(b.dataset.id)));
  $('#vote-admin-form').onsubmit=adminCreateVote; $('#vote-cancel-edit').onclick=resetVoteAdminForm; $$('.vote-admin-edit').forEach(b=>b.onclick=()=>fillVoteAdminForm(Number(b.dataset.id),o.votes||[])); $$('.vote-admin-delete').forEach(b=>b.onclick=()=>adminDeleteVoteDraft(Number(b.dataset.id))); $$('.vote-admin-status').forEach(b=>b.onclick=()=>adminVoteStatus(Number(b.dataset.id),b.dataset.status)); $$('.vote-admin-results').forEach(b=>b.onclick=()=>adminVoteResults(Number(b.dataset.id)));
  $('#activity-form').onsubmit=adminCreateActivity; $$('.activity-status').forEach(b=>b.onclick=()=>adminActivityStatus(Number(b.dataset.id),b.dataset.status)); $$('.activity-edit').forEach(b=>b.onclick=()=>adminEditActivityPrompt(Number(b.dataset.id),o.activities||[]));
  $('#agreement-form').onsubmit=adminSaveAgreement; $$('.agreement-edit').forEach(b=>b.onclick=()=>fillAgreementForm(Number(b.dataset.id),o.agreements||[])); $$('.agreement-status').forEach(b=>b.onclick=()=>adminAgreementStatus(Number(b.dataset.id),b.dataset.status));
  $('#library-admin-form').onsubmit=adminSaveLibrary; $$('.library-admin-edit').forEach(b=>b.onclick=()=>fillLibraryAdminForm(Number(b.dataset.id),o.library||[])); $$('.library-admin-status').forEach(b=>b.onclick=()=>adminLibraryStatus(Number(b.dataset.id),b.dataset.status));
  $('#news-form').onsubmit=publishNews; $$('.admin-news-delete').forEach(b=>b.onclick=()=>adminDeleteNews(Number(b.dataset.id)));
  $('#dev-diagnostics').onclick=loadAdminDiagnostics; $('#dev-copy-diagnostics').onclick=copyAdminDiagnostics; $$('.dev-db-action').forEach(b=>b.onclick=()=>adminDbMaintenance(b.dataset.action)); $('#dev-export-data').onclick=adminExportData;
}

function moduleAdminRow(k,v){return `<div class="module-row"><div><strong>${escapeHtml(k)}</strong><span>${escapeHtml(v.message||'Operativo')}</span></div><button class="button ${v.enabled?'secondary':'ghost'} module-toggle" data-module="${escapeHtml(k)}" data-enabled="${v.enabled?'true':'false'}">${v.enabled?'ON':'OFF'}</button></div>`}
function adminMarketCard(x){return `<article class="card market-card">${x.images?.[0]?`<img src="${x.images[0].url}" alt="">`:'<div class="market-placeholder">🛒</div>'}<div class="market-card-body"><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.description)}</p><strong>${formatClpClient(x.price)}</strong><span>${escapeHtml(x.owner_name||'')}</span><div class="toolbar"><button class="button primary market-moderate" data-id="${x.id}" data-status="ACTIVE">Aprobar</button><button class="button ghost market-moderate" data-id="${x.id}" data-status="REMOVED">Rechazar</button></div></div></article>`}
function reportAdminRow(r){return `<div><div><strong>🚩 ${escapeHtml(r.title||'Publicación')}</strong><span>${escapeHtml(r.reason||'')} · reporta ${escapeHtml(r.reporter_name||'')} · vendedor ${escapeHtml(r.owner_name||'')}</span></div><div class="toolbar"><button class="button secondary market-report-resolve" data-id="${r.id}" data-status="RESOLVED">Resolver</button><button class="button ghost market-report-resolve" data-id="${r.id}" data-status="DISMISSED">Descartar</button></div></div>`}
function voteAdminRow(v){const next=v.status==='DRAFT'?'OPEN':v.status==='OPEN'?'CLOSED':v.status==='CLOSED'?'ARCHIVED':null;const label={OPEN:'Abrir y congelar padrón',CLOSED:'Cerrar',ARCHIVED:'Archivar'}[next]||'';return `<div class="vote-admin-row"><div><strong>${escapeHtml(v.title)}</strong><span>${escapeHtml(v.secrecy)} · ${escapeHtml(v.eligibility_rule)} · ${escapeHtml(v.status)} · ${v.participation||0}/${v.eligible||0}${v.opens_at?' · abre '+formatLocalDateTime(v.opens_at):''}${v.closes_at?' · cierra '+formatLocalDateTime(v.closes_at):''}</span></div><div class="toolbar">${v.status==='DRAFT'?`<button class="button ghost vote-admin-edit" data-id="${v.id}">Editar</button><button class="button ghost vote-admin-delete" data-id="${v.id}">Eliminar</button>`:''}${next?`<button class="button ${next==='OPEN'?'primary':'ghost'} vote-admin-status" data-id="${v.id}" data-status="${next}">${label}</button>`:''}${v.status!=='DRAFT'?`<button class="button secondary vote-admin-results" data-id="${v.id}">Resultados</button>`:''}</div></div>`}

function activityAdminRow(a){return `<div><div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.type)} · ${escapeHtml(a.status)}${a.starts_at?' · '+formatLocalDateTime(a.starts_at):''}</span></div><div class="toolbar"><button class="button ghost activity-edit" data-id="${a.id}">Editar</button>${a.status==='ACTIVE'?`<button class="button ghost activity-status" data-id="${a.id}" data-status="CLOSED">Cerrar</button>`:`<button class="button secondary activity-status" data-id="${a.id}" data-status="ACTIVE">Reabrir</button>`}<button class="button ghost activity-status" data-id="${a.id}" data-status="REMOVED">Ocultar</button></div></div>`}
function agreementAdminRow(a){return `<div><div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.status)}${a.valid_until?' · hasta '+escapeHtml(a.valid_until):''}</span></div><div class="toolbar"><button class="button ghost agreement-edit" data-id="${a.id}">Editar</button>${a.status==='ACTIVE'?`<button class="button ghost agreement-status" data-id="${a.id}" data-status="HIDDEN">Ocultar</button>`:`<button class="button secondary agreement-status" data-id="${a.id}" data-status="ACTIVE">Activar</button>`}</div></div>`}
function libraryAdminRow(a){return `<div><div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.category||'General')} · ${escapeHtml(a.status)}</span></div><div class="toolbar"><button class="button ghost library-admin-edit" data-id="${a.id}">Editar</button>${a.status==='ACTIVE'?`<button class="button ghost library-admin-status" data-id="${a.id}" data-status="HIDDEN">Ocultar</button>`:`<button class="button secondary library-admin-status" data-id="${a.id}" data-status="ACTIVE">Activar</button>`}</div></div>`}
function auditAdminRow(a){let d='';try{const x=JSON.parse(a.detail_json||'null');d=x?JSON.stringify(x):''}catch{}return `<div class="audit-row"><div><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(a.actor_name||'Sistema')}${a.subject_name?' → '+escapeHtml(a.subject_name):''} · ${formatLocalDateTime(a.created_at)}</span></div>${d?`<code title="${escapeHtml(d)}">${escapeHtml(d.slice(0,120))}</code>`:''}</div>`}
function formatBytes(n){if(!n)return '0 B';const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i?1:0)} ${u[i]}`}


function cap(label,on){return `<span class="cap ${on?'on':'off'}"><i></i>${label}: ${on?'ON':'OFF'}</span>`}

async function adminRunJob(job){try{const r=await api('/api/admin/jobs/run',{method:'POST',body:{job}});toast(`Job ${job}: OK`);if(job!=='notification_cycle')renderAdmin();return r}catch(e){toast(e.message,true)}}
async function adminClearCache(){try{await api('/api/admin/cache/clear',{method:'POST',body:{}});toast('Cachés runtime vaciadas.')}catch(e){toast(e.message,true)}}
async function adminToggleModule(module,enabled){const msg=enabled?'':(prompt('Mensaje que verán los socios mientras esté en mantenimiento:','Módulo temporalmente en mantenimiento. Intenta nuevamente más tarde.')||'Módulo temporalmente en mantenimiento.');if(!enabled&&!msg)return;try{await api('/api/admin/modules',{method:'POST',body:{module,enabled,message:msg}});toast(`${module}: ${enabled?'ON':'OFF'}`);renderAdmin()}catch(e){toast(e.message,true)}}
async function adminPushSelfTest(){try{const r=await api('/api/admin/push/test-self',{method:'POST',body:{}});toast(`Push prueba: ${r.sent||0} enviado(s).`)}catch(e){toast(e.message,true)}}
async function adminPushSend(dryRun){const memberId=Number($('#dev-push-member')?.value||0),title=$('#dev-push-title')?.value||'Mi ASPCH',body=$('#dev-push-body')?.value||'',url=$('#dev-push-url')?.value||'/?view=home',confirmText=$('#dev-push-all-confirm')?.value||'';if(!body.trim())return toast('Escribe el mensaje.',true);if(!dryRun&&!memberId&&!confirm('Vas a intentar enviar este push a TODOS los dispositivos elegibles. ¿Continuar?'))return;try{const r=await api('/api/admin/push/send',{method:'POST',body:{memberId:memberId||null,title,body,url,dryRun,confirm:confirmText}});toast(dryRun?`Audiencia estimada: ${r.eligible||0}`:`Push: ${r.sent||0} entrega(s), ${r.recipients||0} destinatario(s).`)}catch(e){toast(e.message,true)}}
async function adminMemberSearchUi(e){e.preventDefault();const q=$('#dev-member-q').value.trim();try{const r=await api(`/api/admin/members?q=${encodeURIComponent(q)}`);const rows=r.members||[];$('#dev-member-results').innerHTML=rows.length?rows.map(adminMemberCard).join(''):'<div class="empty">Sin resultados.</div>';$$('.dev-member-sessions').forEach(b=>b.onclick=()=>adminRevokeMemberSessions(Number(b.dataset.id)));$$('.dev-member-credential').forEach(b=>b.onclick=()=>adminCredentialToggle(Number(b.dataset.id),b.dataset.revoked!=='true'));$$('.dev-member-push').forEach(b=>b.onclick=()=>{const id=Number(b.dataset.id);$('#dev-push-member').value=String(id);toast('Member ID cargado en Push developer.');window.scrollTo({top:0,behavior:'smooth'})})}catch(err){toast(err.message,true)}}
function adminMemberCard(m){const st=m.financial_status||'SIN ESTADO';return `<article class="card dev-member-card"><div class="dev-member-head"><div><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.email||'')} · ${escapeHtml(m.rut||'sin RUT')}</span></div><span class="badge ${st==='MOROSO'?'amber':m.active?'green':'red'}">${escapeHtml(st)}</span></div><div class="profile-grid compact-grid">${field('Rol',m.role||'MEMBER')}${field('Institución',m.employer||'—')}${field('Cargo',m.position||'—')}${field('Sesiones',m.active_sessions||0)}${field('Push devices',m.push_devices||0)}${field('Deuda',m.amount_due?formatClpClient(m.amount_due):'—')}</div><div class="toolbar"><button class="button ghost dev-member-sessions" data-id="${m.id}">Revocar sesiones</button><button class="button ghost dev-member-credential" data-id="${m.id}" data-revoked="${m.credential_revoked?'true':'false'}">${m.credential_revoked?'Reactivar credencial':'Suspender credencial'}</button><button class="button secondary dev-member-push" data-id="${m.id}">Preparar Push</button></div></article>`}
async function adminRevokeMemberSessions(id){if(!confirm('¿Revocar las sesiones activas de este usuario?'))return;try{const r=await api('/api/admin/member/sessions/revoke',{method:'POST',body:{memberId:id}});toast(`Sesiones revocadas: ${r.removed||0}`)}catch(e){toast(e.message,true)}}
async function adminCredentialToggle(id,revoked){let reason='';if(revoked){reason=prompt('Motivo de suspensión de credencial:','Suspensión administrativa')||'';if(!reason)return}try{await api('/api/admin/member/credential',{method:'POST',body:{memberId:id,revoked,reason}});toast(revoked?'Credencial suspendida.':'Credencial reactivada.');$('#dev-member-search')?.requestSubmit()}catch(e){toast(e.message,true)}}
async function adminResolveReport(id,status){const note=prompt(status==='RESOLVED'?'Nota de resolución (opcional):':'Motivo para descartar (opcional):','')||'';try{await api('/api/admin/marketplace/report/resolve',{method:'POST',body:{id,status,note}});toast('Reporte actualizado.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminDeleteNews(id){if(!confirm('¿Eliminar esta noticia?'))return;try{await api('/api/admin/news/delete',{method:'POST',body:{id}});toast('Noticia eliminada.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminSaveAgreement(e){e.preventDefault();try{await api('/api/admin/agreements',{method:'POST',body:{id:Number($('#agreement-id').value)||null,title:$('#agreement-title').value,description:$('#agreement-desc').value,benefit:$('#agreement-benefit').value,url:$('#agreement-url').value,logoUrl:$('#agreement-logo').value||null,validUntil:$('#agreement-valid').value||null,status:'ACTIVE'}});toast('Convenio guardado.');renderAdmin()}catch(err){toast(err.message,true)}}
function fillAgreementForm(id,rows){const a=rows.find(x=>Number(x.id)===id);if(!a)return;$('#agreement-id').value=a.id;$('#agreement-title').value=a.title||'';$('#agreement-desc').value=a.description||'';$('#agreement-benefit').value=a.benefit||'';$('#agreement-url').value=a.url||'';$('#agreement-logo').value=a.logo_url||'';$('#agreement-valid').value=a.valid_until||'';$('#agreement-title').focus()}
async function adminAgreementStatus(id,status){try{await api('/api/admin/agreements/status',{method:'POST',body:{id,status}});toast('Convenio actualizado.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminSaveLibrary(e){e.preventDefault();try{await api('/api/admin/library',{method:'POST',body:{id:Number($('#library-admin-id').value)||null,category:$('#library-admin-category').value,title:$('#library-admin-title').value,description:$('#library-admin-desc').value,url:$('#library-admin-url').value,source:$('#library-admin-source').value,status:'ACTIVE'}});toast('Documento guardado.');renderAdmin()}catch(err){toast(err.message,true)}}
function fillLibraryAdminForm(id,rows){const a=rows.find(x=>Number(x.id)===id);if(!a)return;$('#library-admin-id').value=a.id;$('#library-admin-category').value=a.category||'General';$('#library-admin-title').value=a.title||'';$('#library-admin-desc').value=a.description||'';$('#library-admin-url').value=a.url||'';$('#library-admin-source').value=a.source||'';$('#library-admin-title').focus()}
async function adminLibraryStatus(id,status){try{await api('/api/admin/library/status',{method:'POST',body:{id,status}});toast('Biblioteca actualizada.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminEditActivityPrompt(id,rows){const a=rows.find(x=>Number(x.id)===id);if(!a)return;const title=prompt('Título:',a.title||'');if(title===null)return;const description=prompt('Descripción:',a.description||'');if(description===null)return;const externalUrl=prompt('URL Forms / inscripción:',a.external_url||'');if(externalUrl===null)return;try{await api('/api/admin/activities/update',{method:'POST',body:{id,title,description,externalUrl,type:a.type,startsAt:a.starts_at,endsAt:a.ends_at}});toast('Actividad editada.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminDbMaintenance(action){if(action!=='quick_check'&&!confirm(`Ejecutar ${action} en SQLite ahora?`))return;try{const r=await api('/api/admin/db/maintenance',{method:'POST',body:{action}});$('#dev-diagnostics-box').textContent=JSON.stringify(r,null,2);toast(`DB ${action}: OK`)}catch(e){toast(e.message,true)}}
function adminExportData(){const d=$('#dev-export-dataset')?.value||'members';window.location.href=`/api/admin/export?dataset=${encodeURIComponent(d)}`}
async function loadAdminDiagnostics(){try{const d=await api('/api/admin/diagnostics');$('#dev-diagnostics-box').textContent=JSON.stringify(d,null,2)}catch(e){toast(e.message,true)}}
async function copyAdminDiagnostics(){const t=$('#dev-diagnostics-box')?.textContent||'';if(!t||t.startsWith('Pulsa'))await loadAdminDiagnostics();try{await navigator.clipboard.writeText($('#dev-diagnostics-box')?.textContent||'');toast('Diagnóstico copiado.')}catch{toast('No se pudo copiar.',true)}}

async function adminFinancialSync(){try{const r=await api('/api/admin/sync-financial',{method:'POST',body:{}}),result=r.result||{};toast(result.sourceReady?`XLSM leído en modo diagnóstico: ${result.status||'OK'}.`:(result.error||'Fuente XLSM no disponible.'),!result.sourceReady);renderAdmin()}catch(e){toast(e.message,true)}}
async function adminModerate(id,status){try{await api('/api/admin/marketplace/moderate',{method:'POST',body:{id,status}});toast(status==='ACTIVE'?'Publicación aprobada.':'Publicación rechazada.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminActivityStatus(id,status){try{await api('/api/admin/activities/status',{method:'POST',body:{id,status}});toast('Actividad actualizada.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminStudyCancel(id){if(!confirm('¿Cancelar esta reserva de Sala de estudios?'))return;try{await api('/api/admin/study-room/cancel',{method:'POST',body:{id}});toast('Reserva cancelada.');renderAdmin()}catch(e){toast(e.message,true)}}
async function adminCreateVote(e){e.preventDefault();const id=Number($('#vote-id').value)||null,options=$('#vote-options').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),body={id,title:$('#vote-title').value,description:$('#vote-desc').value,secrecy:$('#vote-secrecy').value,eligibilityRule:$('#vote-eligibility').value,opensAt:localInputToIso($('#vote-opens').value),closesAt:localInputToIso($('#vote-closes').value),options};try{const r=await api(id?'/api/admin/votes/update':'/api/admin/votes',{method:'POST',body});toast(id?`Votación #${r.id} actualizada.`:`Votación #${r.id} creada como borrador.`);renderAdmin()}catch(err){toast(err.message,true)}}
function isoToLocalInput(v){if(!v)return'';const d=new Date(v);if(!Number.isFinite(d.getTime()))return'';const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
function fillVoteAdminForm(id,rows){const v=rows.find(x=>Number(x.id)===id);if(!v||v.status!=='DRAFT')return;$('#vote-id').value=v.id;$('#vote-form-title').textContent=`Editar borrador #${v.id}`;$('#vote-title').value=v.title||'';$('#vote-desc').value=v.description||'';$('#vote-secrecy').value=v.secrecy||'SECRET';$('#vote-eligibility').value=v.eligibility_rule||'ACTIVE_ALL';$('#vote-opens').value=isoToLocalInput(v.opens_at);$('#vote-closes').value=isoToLocalInput(v.closes_at);$('#vote-options').value=(v.options||[]).map(x=>x.label).join('\n');$('#vote-save-button').textContent='Guardar cambios';$('#vote-cancel-edit').classList.remove('hidden');$('#vote-title').focus()}
function resetVoteAdminForm(){$('#vote-admin-form').reset();$('#vote-id').value='';$('#vote-form-title').textContent='Nueva votación';$('#vote-save-button').textContent='Crear borrador';$('#vote-cancel-edit').classList.add('hidden')}
async function adminDeleteVoteDraft(id){if(!confirm('¿Eliminar definitivamente este borrador de votación?'))return;try{await api('/api/admin/votes/delete',{method:'POST',body:{id}});toast('Borrador eliminado.');renderAdmin()}catch(e){toast(e.message,true)}}

async function adminVoteStatus(id,status){const msg=status==='OPEN'?'Abrir congelará el padrón y ya no podrás editarlo ni volver a borrador. ¿Continuar?':status==='CLOSED'?'Cerrar impedirá nuevos votos. ¿Continuar?':status==='ARCHIVED'?'Archivar esta votación?':'¿Continuar?';if(!confirm(msg))return;try{const r=await api('/api/admin/votes/status',{method:'POST',body:{id,status}});toast(status==='OPEN'?`Votación abierta · padrón: ${r.eligible||0}`:`Votación ${status.toLowerCase()}.`);renderAdmin()}catch(e){toast(e.message,true)}}
async function adminVoteResults(id){try{const r=await api(`/api/admin/votes/results?id=${id}`);const lines=(r.options||[]).map(x=>`${x.label}: ${x.votes}`).join('\n');alert(`${r.election?.title||'Votación'}\n\n${lines}\n\nParticipación: ${r.participation||0}/${r.eligible||0} (${r.turnout||0}%)\n\nComprobantes emitidos: ${(r.receipts||[]).length}`)}catch(e){toast(e.message,true)}}

async function adminCreateActivity(e){e.preventDefault();try{await api('/api/admin/activities',{method:'POST',body:{type:$('#activity-type').value,title:$('#activity-title').value,description:$('#activity-desc').value,startsAt:localInputToIso($('#activity-start').value),endsAt:localInputToIso($('#activity-end')?.value),externalUrl:$('#activity-url').value}});toast('Actividad publicada.');e.target.reset();renderAdmin()}catch(err){toast(err.message,true)}}

async function adminSync(url,label){try{const r=await api(url,{method:'POST',body:{}});toast(`Sincronizados: ${r.count} ${label}${r.board!==undefined?` · ${r.board} Directorio`:''}`);const me=await api('/api/me');state.member=me.member;state.security=me.security}catch(e){toast(e.message,true)}}
async function publishNews(e){e.preventDefault();try{await api('/api/admin/news',{method:'POST',body:{title:$('#news-title').value,body:$('#news-body').value,pinned:$('#news-pinned').checked}});toast('Noticia publicada');e.target.reset()}catch(err){toast(err.message,true)}}

async function getNews(force=false){if(state.news.length&&!force)return state.news;const r=await api('/api/news');state.news=r.news;return state.news}
async function getParking(date,force=false){if(!force&&state.parking?.date===date)return state.parking;const r=await api(`/api/parking?date=${encodeURIComponent(date)}`);state.parking=r;return r}
async function getSimulators(from,to,force=false){if(!force&&state.simulators?.from===from&&state.simulators?.to===to)return state.simulators;const r=await api(`/api/simulators?from=${from}&to=${to}`);state.simulators=r;return r}

async function api(url,opts={}){const o={credentials:'same-origin',...opts,headers:{...(opts.headers||{})}};if(opts.body&&typeof opts.body!=='string'){o.headers['content-type']='application/json';o.body=JSON.stringify(opts.body)}const res=await fetch(url,o);let data={};try{data=await res.json()}catch{}if(!res.ok){const e=new Error(data.error||`Error ${res.status}`);e.status=res.status;e.code=data.code;if(res.status===423&&data.code==='LOCKED'){state.security={...(state.security||{}),unlocked:false};showLock()}if(res.status===428&&data.code==='PIN_REQUIRED'){showPinSetup()}throw e}return data}
function b64urlToBytes(value){const s=String(value||'').replace(/-/g,'+').replace(/_/g,'/');const pad=s+'='.repeat((4-s.length%4)%4);const raw=atob(pad);return Uint8Array.from(raw,c=>c.charCodeAt(0))}
function bytesToB64url(value){if(value==null)return null;const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer||value,value.byteOffset||0,value.byteLength||value.length);let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function creationOptionsFromJSON(o){return{...o,challenge:b64urlToBytes(o.challenge),user:{...o.user,id:b64urlToBytes(o.user.id)},excludeCredentials:(o.excludeCredentials||[]).map(c=>({...c,id:b64urlToBytes(c.id)}))}}
function requestOptionsFromJSON(o){return{...o,challenge:b64urlToBytes(o.challenge),allowCredentials:(o.allowCredentials||[]).map(c=>({...c,id:b64urlToBytes(c.id)}))}}
async function browserRegisterPasskey(options){
  if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('Este navegador no soporta passkeys.');
  const cred=await navigator.credentials.create({publicKey:creationOptionsFromJSON(options)});if(!cred)throw new Error('No se creó la passkey.');
  const r=cred.response;return{id:cred.id,rawId:bytesToB64url(cred.rawId),type:cred.type,authenticatorAttachment:cred.authenticatorAttachment||undefined,response:{clientDataJSON:bytesToB64url(r.clientDataJSON),attestationObject:bytesToB64url(r.attestationObject),transports:typeof r.getTransports==='function'?r.getTransports():[],publicKeyAlgorithm:typeof r.getPublicKeyAlgorithm==='function'?r.getPublicKeyAlgorithm():undefined,publicKey:typeof r.getPublicKey==='function'&&r.getPublicKey()?bytesToB64url(r.getPublicKey()):undefined,authenticatorData:typeof r.getAuthenticatorData==='function'?bytesToB64url(r.getAuthenticatorData()):undefined},clientExtensionResults:cred.getClientExtensionResults()};
}
async function browserAuthenticatePasskey(options){
  if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('Este navegador no soporta passkeys.');
  const cred=await navigator.credentials.get({publicKey:requestOptionsFromJSON(options)});if(!cred)throw new Error('No se obtuvo la passkey.');
  const r=cred.response;return{id:cred.id,rawId:bytesToB64url(cred.rawId),type:cred.type,authenticatorAttachment:cred.authenticatorAttachment||undefined,response:{clientDataJSON:bytesToB64url(r.clientDataJSON),authenticatorData:bytesToB64url(r.authenticatorData),signature:bytesToB64url(r.signature),userHandle:r.userHandle?bytesToB64url(r.userHandle):null},clientExtensionResults:cred.getClientExtensionResults()};
}

function installEditableNumericInputs(root=document){
  const selector='.otp-input,#setup-pin,#setup-pin-confirm,#unlock-pin,#current-pin,#new-pin';
  $$(selector,root).forEach(el=>{
    if(el.dataset.numericEditing==='1')return;
    el.dataset.numericEditing='1';
    el.addEventListener('input',()=>{
      const raw=String(el.value||'');
      const max=Number(el.maxLength)>0?Number(el.maxLength):6;
      const clean=raw.replace(/\D/g,'').slice(0,max);
      if(clean===raw)return;
      const cursor=el.selectionStart??raw.length;
      const removedBefore=raw.slice(0,cursor).replace(/\d/g,'').length;
      el.value=clean;
      const next=Math.max(0,Math.min(clean.length,cursor-removedBefore));
      try{el.setSelectionRange(next,next)}catch{}
    });
  });
}
function focusEditableNumeric(selector){
  const el=$(selector);if(!el)return;
  el.disabled=false;
  setTimeout(()=>{el.focus();try{el.setSelectionRange(el.value.length,el.value.length)}catch{}},30);
}
function setLoading(el,on){
  el.classList.toggle('loading',on);
  $$('button',el).forEach(button=>{
    if(on){button.dataset.loadingWasDisabled=button.disabled?'1':'0';button.disabled=true}
    else{button.disabled=button.dataset.loadingWasDisabled==='1';delete button.dataset.loadingWasDisabled}
  });
}
function clearFormError(form){if(!form)return;const box=$('.auth-error',form);if(box){box.textContent='';box.classList.add('hidden')}$$('[aria-invalid="true"]',form).forEach(x=>x.removeAttribute('aria-invalid'))}
function clearAuthErrors(){$$('.auth-form').forEach(clearFormError)}
function showFormError(form,message,selector){clearFormError(form);const box=$('.auth-error',form);if(box){box.textContent=message;box.classList.remove('hidden')}const input=$(selector);if(input){input.disabled=false;input.setAttribute('aria-invalid','true');focusEditableNumeric(selector)}}
function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='toast',3200)}
function stat(icon,label,value,color){return `<div class="card stat-card"><div class="stat-icon">${icon}</div><div class="stat-copy"><span>${label}</span><strong>${escapeHtml(value)}</strong><div><span class="badge ${color}"><i class="dot"></i>${color==='green'?'Activo':'Ver detalle'}</span></div></div></div>`}
function quick(id,icon,title,desc){return `<div class="card quick-card" data-quick="${id}"><div class="quick-icon">${icon}</div><div><strong>${title}</strong><span>${desc}</span><em>Abrir →</em></div></div>`}
function newsHtml(n) {
  if (n.source === 'instagram') {
    return `<article class="card news-item instagram-card" style="padding:0; overflow:hidden; margin-bottom:1rem; border:1px solid #eaeaea;">
      ${n.image_url ? `<img src="${escapeHtml(n.image_url)}" loading="lazy" style="width:100%; height:auto; display:block;" alt="Instagram post">` : ''}
      <div style="padding:1rem;">
        <div class="news-meta" style="margin-bottom:0.5rem; color:#888; font-size:0.85rem;">
          <span>📸 Instagram · ${formatDateLong(n.published_at.slice(0,10))}</span>
        </div>
        <p style="margin:0 0 1rem 0; white-space:pre-wrap; font-size:0.95rem; line-height:1.4;">${escapeHtml(n.body)}</p>
        <a href="${escapeHtml(n.external_url)}" target="_blank" rel="noopener noreferrer" class="button secondary" style="width:100%; text-align:center; display:block;">Ver publicación</a>
      </div>
    </article>`;
  }
  return `<article class="card news-item" style="padding:1.5rem; margin-bottom:1rem;"><div class="news-meta">${n.pinned?'<span class="badge blue">DESTACADO</span>':''}<span>${formatDateLong(n.published_at.slice(0,10))}</span></div><h4 style="margin:0.5rem 0;">${escapeHtml(n.title)}</h4><p style="white-space:pre-wrap;">${escapeHtml(n.body)}</p></article>`;
}
function field(k,v){return `<div class="profile-field"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v??'—'))}</strong></div>`}
function matrix(seed){let h=0;for(const c of seed)h=(h*31+c.charCodeAt(0))>>>0;let html='<div class="code-matrix" aria-label="Código visual">';for(let i=0;i<81;i++){h=(h*1664525+1013904223)>>>0;const finder=(i<18&&i%9<3)||(i>62&&i%9>5);html+=`<i class="${finder||h%3===0?'on':''}"></i>`}return html+'</div>'}

function localInputToIso(v){if(!v)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null}
function formatLocalDateTime(iso){return new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso))}

function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function addDays(d,n){const x=new Date(`${d}T12:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
function mondayOf(d){const x=new Date(`${d}T12:00:00Z`),wd=x.getUTCDay();return addDays(d,wd===0?-6:1-wd)}
function formatDateLong(d){return new Intl.DateTimeFormat('es-CL',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(`${d}T12:00:00Z`))}
function humanDate(d){return new Intl.DateTimeFormat('es-CL',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(new Date(`${d}T12:00:00Z`))}
function shortDate(d){return new Intl.DateTimeFormat('es-CL',{timeZone:'UTC',day:'2-digit',month:'short'}).format(new Date(`${d}T12:00:00Z`))}
function weekdayShort(d){return titleWord(new Intl.DateTimeFormat('es-CL',{timeZone:'UTC',weekday:'short'}).format(new Date(`${d}T12:00:00Z`)).replace('.',''))}
function dayNum(d){return new Date(`${d}T12:00:00Z`).getUTCDate()}
function monthShort(d){return new Intl.DateTimeFormat('es-CL',{timeZone:'UTC',month:'short'}).format(new Date(`${d}T12:00:00Z`)).replace('.','')}
function hm(iso){return new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso))}
function shortDateTime(iso){return new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',weekday:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
function inferPeriod(iso){return Number(hm(iso).slice(0,2))<13?'AM':'PM'}
function slotTimeForDay(d,p){const friday=new Date(`${d}T12:00:00Z`).getUTCDay()===5;return p==='AM'?(friday?['09:00','12:30']:['09:00','13:00']):(friday?['12:30','16:00']:['13:00','17:00'])}
function weekLabel(from){return `${dayNum(from)} ${monthShort(from)} – ${dayNum(addDays(from,4))} ${monthShort(addDays(from,4))}`}
function formatRutDisplay(v=''){const c=String(v).toUpperCase().replace(/[^0-9K]/g,'');if(c.length<2)return c;const body=c.slice(0,-1),dv=c.slice(-1),dots=body.replace(/\B(?=(\d{3})+(?!\d))/g,'.');return `${dots}-${dv}`}
function initials(n=''){return n.trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'A'}
async function promptFirstRunSetup(){
  if(state.uiPreferences?.configured)return;
  return openServicePersonalization({firstRun:true});
}
function servicePreferenceRows(){
  const p=state.uiPreferences?.services||UI_SERVICE_DEFAULTS;
  const row=(key,icon,label,nested=false)=>`<label class="service-pref-row ${nested?'nested':''}"><span><i>${icon}</i>${label}</span><input type="checkbox" data-service-pref="${key}" ${p[key]!==false?'checked':''}></label>`;
  return `${row('parking','🚗','Estacionamiento')}
    <div class="service-pref-group"><label class="service-pref-row"><span><i>🗓️</i>Reservas</span><input type="checkbox" data-service-pref="reservations" ${p.reservations!==false?'checked':''}></label>
      ${row('simulators','✈️','Simuladores',true)}${row('studyroom','📖','Sala de estudios',true)}</div>
    ${row('library','📚','Biblioteca')}${row('agreements','🤝','Convenios')}${row('news','📰','Noticias')}`;
}
function openServicePersonalization({firstRun=false}={}){
  return new Promise(resolve=>{
    $('.service-preferences-overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.className='setup-overlay service-preferences-overlay';
    overlay.innerHTML=`<section class="setup-card service-preferences-card" role="dialog" aria-modal="true" aria-labelledby="service-preferences-title">
      <span class="eyebrow">TU EXPERIENCIA</span>
      <h2 id="service-preferences-title">Personaliza Mi ASPCH</h2>
      <p>Elige qué servicios quieres tener a la vista. Puedes cambiar esto después.</p>
      <div class="service-pref-list">${servicePreferenceRows()}</div>
      <p class="service-pref-fixed">Credencial y Perfil siempre estarán disponibles.</p>
      <div class="service-pref-actions"><button class="button primary" id="service-pref-save" type="button">Guardar preferencias</button><button class="button ghost" id="service-pref-skip" type="button">${firstRun?'Omitir por ahora':'Cancelar'}</button></div>
    </section>`;
    document.body.appendChild(overlay);
    const parent=overlay.querySelector('[data-service-pref="reservations"]'),children=[...overlay.querySelectorAll('[data-service-pref="simulators"],[data-service-pref="studyroom"]')];
    const syncChildren=()=>children.forEach(input=>{input.disabled=!parent.checked;input.closest('.service-pref-row').classList.toggle('disabled',!parent.checked)});parent.addEventListener('change',syncChildren);syncChildren();
    const close=()=>{overlay.remove();resolve()};
    overlay.querySelector('#service-pref-skip').addEventListener('click',close);
    overlay.querySelector('#service-pref-save').addEventListener('click',async e=>{
      const services={...UI_SERVICE_DEFAULTS};overlay.querySelectorAll('[data-service-pref]').forEach(input=>{services[input.dataset.servicePref]=input.checked});
      e.currentTarget.disabled=true;
      try{const result=await api('/api/profile/services',{method:'PUT',body:{services,simpleMode:simpleModeEnabled()}});state.uiPreferences=normalizedUiPreferences(result.uiPreferences);renderNav();overlay.remove();if(state.view==='home')await renderHome();toast('Preferencias guardadas.');resolve()}catch(err){e.currentTarget.disabled=false;toast(err.message,true)}
    });
  });
}
function preferredName(member=state.member){
  return String(member?.preferredName||'').trim();
}
function welcomeText(member=state.member){
  const p=preferredName(member)||(member?.name?titleName(member.name).split(' ')[0]:'');
  return p ? `Hola, ${p}` : 'Hola';
}
function preferredNameEditorHtml(scope){
  const p=preferredName();
  if(p)return `<div class="welcome-name-set"><span>Te llamamos <strong>${escapeHtml(p)}</strong></span><button id="preferred-name-edit-${scope}" class="link-button" type="button">Cambiar</button></div><form id="preferred-name-form-${scope}" class="preferred-name-form hidden"><label>¿Cómo quieres que te llamemos?<input name="preferredName" type="text" maxlength="40" autocomplete="nickname" value="${escapeHtml(p)}" placeholder="Ej. Eduardo"></label><div class="toolbar"><button class="button secondary" type="submit">Guardar</button><button id="preferred-name-cancel-${scope}" class="button ghost" type="button">Cancelar</button></div></form>`;
  return `<form id="preferred-name-form-${scope}" class="preferred-name-form"><label>¿Cómo quieres que te llamemos?<input name="preferredName" type="text" maxlength="40" autocomplete="nickname" placeholder="Ej. Eduardo" required></label><button class="button secondary" type="submit">Guardar nombre de saludo</button><p class="hint">Solo cambia cómo te saludamos. Tu nombre oficial y credencial no se modifican.</p></form>`;
}
function preferredNameProfileHtml(){
  const p=preferredName();
  return `<div class="preferred-name-profile"><span class="eyebrow">NOMBRE DE USO</span><form id="preferred-name-form-profile" class="preferred-name-form inline"><input name="preferredName" type="text" maxlength="40" autocomplete="nickname" value="${escapeHtml(p)}" placeholder="Ej. Eduardo" required><button class="button secondary" type="submit">Guardar</button></form><p class="hint">Se usa solamente en saludos y mensajes informales de Mi ASPCH.</p></div>`;
}
function togglePreferredNameEditor(scope,show){
  const form=$(`#preferred-name-form-${scope}`),set=$('.welcome-name-set');if(!form)return;form.classList.toggle('hidden',!show);set?.classList.toggle('hidden',show);if(show)setTimeout(()=>form.querySelector('input')?.focus(),40)
}
async function savePreferredName(e){
  e.preventDefault();
  const input=e.currentTarget.querySelector('[name="preferredName"]');
  const value=String(input?.value||'').trim();
  if(!value)return toast('Escribe cómo quieres que te llamemos.',true);
  setLoading(e.currentTarget,true);
  try{
    const r=await api('/api/profile/preferred-name',{method:'POST',body:{preferredName:value}});
    state.member=r.member;
    $('#sidebar-name').textContent=firstLast(state.member.name);
    toast(`Perfecto. Te llamaremos ${state.member.preferredName}.`);
    if(state.view==='profile')await renderProfile();else await renderHome();
  }catch(err){toast(err.message,true)}
  finally{setLoading(e.currentTarget,false)}
}
function firstName(n=''){return titleWord(n.trim().split(/\s+/)[0]||'Socio')}
function firstLast(n=''){const a=n.trim().split(/\s+/).filter(Boolean);return titleName(a.length>2?`${a[0]} ${a[a.length-1]}`:n)}
function titleName(n=''){return n.toLowerCase().replace(/(^|\s|[-'])\p{L}/gu,m=>m.toUpperCase())}
function titleWord(n=''){return n?n[0].toUpperCase()+n.slice(1).toLowerCase():''}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}


async function adminSyncInstagram(){
  try {
    const r = await api('/api/admin/sync-instagram', {method: 'POST', body: {}});
    if (r.error) throw new Error(r.error);
    toast('Sincronización finalizada. Nuevos: ' + r.synced);
    renderAdmin(); // re-render to update status
  } catch(e) {
    toast('Error: ' + e.message, true);
  }
}
