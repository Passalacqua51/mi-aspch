const buttons=[...document.querySelectorAll('[data-profile]')];
const frame=document.querySelector('#app-frame');
const status=document.querySelector('#profile-status');
const loading=document.querySelector('#phone-loading');
let requestSequence=0;

function setBusy(busy){
  buttons.forEach(button=>{button.disabled=busy});
  loading.classList.toggle('hidden',!busy);
}

async function selectProfile(profile){
  const sequence=++requestSequence;
  setBusy(true);
  status.className='profile-status';
  status.textContent=`Creando sesión ${profile}…`;
  try{
    const response=await fetch('/api/preview/impersonate',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({profile})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||`Error HTTP ${response.status}`);
    const meResponse=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'}),me=await meResponse.json().catch(()=>({}));
    if(!meResponse.ok||me.member?.email!==result.member?.email)throw new Error('La sesión Preview no quedó activa en el origen del teléfono.');
    if(sequence!==requestSequence)return;
    buttons.forEach(button=>button.classList.toggle('active',button.dataset.profile===profile));
    status.className='profile-status ready';
    status.textContent=`${result.profile} · ${result.member.name}`;
    const admin=result.member.role==='ADMIN';document.body.classList.toggle('admin-mode',admin);
    loading.textContent=admin?'Abriendo Control Informática…':`Abriendo Mi ASPCH como ${result.member.name}…`;
    const view=result.uiPreferences?.simpleMode?'credential':'home';
    frame.src=admin?`/admin.html?view=admin-dashboard&preview=${encodeURIComponent(result.profile)}&t=${Date.now()}`:`/mobile?view=${view}&preview=${encodeURIComponent(result.profile)}&t=${Date.now()}`;
  }catch(error){
    if(sequence!==requestSequence)return;
    status.className='profile-status error';
    status.textContent=error.message||'No fue posible crear la sesión Preview.';
    loading.textContent='No fue posible abrir Mi ASPCH.';
    setBusy(false);
  }
}

frame.addEventListener('load',()=>{
  if(frame.src==='about:blank')return;
  setBusy(false);
});
buttons.forEach(button=>button.addEventListener('click',()=>selectProfile(button.dataset.profile)));
selectProfile('ACTIVO');
