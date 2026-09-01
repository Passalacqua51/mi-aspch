#!/usr/bin/env node
import assert from 'node:assert/strict';

const baseUrl=String(process.argv[2]||'').replace(/\/$/,'');
if(!/^https?:\/\//.test(baseUrl))throw new Error('Uso: self_check_preview_profiles.mjs URL_PREVIEW');

const profiles=[
  {label:'ACTIVO',name:'Cap. Alicia Activa',role:'MEMBER',active:true,board:false,financial:'AL_DIA',membership:'AL_DIA',simple:false,parking:true},
  {label:'MOROSO',name:'FO Martín Moroso',role:'MEMBER',active:true,board:false,financial:'MOROSO',membership:'MOROSO',simple:false,parking:false},
  {label:'JUBILADO',name:'Cap. Jaime Jubilado',role:'MEMBER',active:true,board:false,financial:'JUBILADO',membership:'EXENTO',simple:false,parking:true},
  {label:'MODO SIMPLE',name:'Cap. Sofía Simple',role:'MEMBER',active:true,board:false,financial:'AL_DIA',membership:'AL_DIA',simple:true,parking:true},
  {label:'FO CPT',name:'FO Felipe Operaciones',role:'MEMBER',active:true,board:false,financial:'AL_DIA',membership:'AL_DIA',simple:false,parking:true},
  {label:'DIRECTORIO',name:'Cap. Daniela Directorio',role:'MEMBER',active:true,board:true,financial:'DIRECTORIO',membership:'EXENTO',simple:false,parking:true},
  {label:'CONGELADO',name:'FO Camilo Congelado',role:'MEMBER',active:true,board:false,financial:'CONGELADO',membership:'EXENTO',simple:false,parking:true},
  {label:'DESAFILIADO',name:'Diego Desafiliado',role:'MEMBER',active:false,board:false,financial:'DESAFILIADO',membership:'DESAFILIADO',simple:false,parking:false},
  {label:'INFORMÁTICA',name:'INFORMÁTICA PREVIEW',email:'informatica@aspch.org',role:'ADMIN',active:true,board:false,financial:'AL_DIA',membership:'AL_DIA',simple:false,parking:true}
];

const anonymous=await fetch(`${baseUrl}/api/me`);
assert.equal(anonymous.status,401,'Preview no debe crear una sesión global sin impersonación');

const labResponse=await fetch(`${baseUrl}/`);
assert.equal(labResponse.status,200);
const labHtml=await labResponse.text();
assert.equal((labHtml.match(/<iframe\b/g)||[]).length,1,'El laboratorio debe contener un solo teléfono');
for(const profile of profiles)assert.match(labHtml,new RegExp(`data-profile="${profile.label}"`));
assert.doesNotMatch(labHtml,/\?sim=|lab-interceptor|sessionStorage/);

let cookie='';
let previousCookie='';
const checked=[];
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
for(const expected of profiles){
  const response=await fetch(`${baseUrl}/api/preview/impersonate`,{
    method:'POST',
    headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:JSON.stringify({profile:expected.label})
  });
  assert.equal(response.status,200,`${expected.label}: impersonate debe responder 200`);
  const setCookie=response.headers.get('set-cookie')||'';
  assert.match(setCookie,/^mi_aspch_preview_session=/,`${expected.label}: cookie Preview incorrecta`);
  cookie=setCookie.split(';',1)[0];
  assert.notEqual(cookie,previousCookie,`${expected.label}: la sesión debe rotar al cambiar perfil`);
  previousCookie=cookie;
  const selected=await response.json();
  assert.equal(selected.profile,expected.label);

  const meResponse=await fetch(`${baseUrl}/api/me`,{headers:{Cookie:cookie}});
  assert.equal(meResponse.status,200,`${expected.label}: /api/me debe quedar autenticado`);
  const me=await meResponse.json();
  assert.equal(me.member.name,expected.name);
  assert.equal(me.member.email,expected.email||me.member.email);
  if(!expected.email)assert.match(me.member.email,/@preview\.invalid$/);
  assert.equal(me.member.role,expected.role);
  assert.equal(me.member.active,expected.active);
  assert.equal(me.member.isBoard,expected.board);
  assert.equal(me.membership.status,expected.membership);
  assert.equal(me.access.financial.status,expected.financial);
  assert.equal(me.access.parking,expected.parking);
  assert.equal(me.access.simulatorView,expected.financial==='MOROSO'?false:expected.active);
  assert.equal(me.uiPreferences.configured,true);
  assert.equal(me.uiPreferences.simpleMode,expected.simple);
  assert.equal(me.security.pinSet,true);
  assert.equal(me.security.unlocked,true);

  const membershipResponse=await fetch(`${baseUrl}/api/membership`,{headers:{Cookie:cookie}});
  assert.equal(membershipResponse.status,200,`${expected.label}: mensualidad no debe pedir login/PIN`);
  const parkingResponse=await fetch(`${baseUrl}/api/parking?date=${date}`,{headers:{Cookie:cookie}});
  assert.equal(parkingResponse.status,200,`${expected.label}: estacionamientos debe cargar dentro de la sesión`);
  const parking=await parkingResponse.json();
  assert.equal(parking.access.allowed,expected.parking,`${expected.label}: restricción de estacionamiento incorrecta`);
  assert.equal(parking.canSeeBoardParking,expected.board,`${expected.label}: acceso a cupos de Directorio incorrecto`);
  const marketplaceResponse=await fetch(`${baseUrl}/api/marketplace`,{headers:{Cookie:cookie}});
  assert.equal(marketplaceResponse.status,expected.active?200:403,`${expected.label}: acceso a Mercado incorrecto`);
  const adminResponse=await fetch(`${baseUrl}/api/admin/dashboard`,{headers:{Cookie:cookie}});
  assert.equal(adminResponse.status,expected.role==='ADMIN'?200:403,`${expected.label}: autorización ADMIN incorrecta`);
  const mobileResponse=await fetch(`${baseUrl}/mobile?view=home`,{headers:{Cookie:cookie}});
  assert.equal(mobileResponse.status,200,`${expected.label}: vista mobile no debe redirigir a login`);
  const mobileHtml=await mobileResponse.text();
  assert.doesNotMatch(mobileHtml,/lab-interceptor|preview\/login|preview\/members/);
  checked.push({profile:expected.label,member:me.member.name,role:me.member.role,active:me.member.active,membership:me.membership.status,financial:me.access.financial.status,simpleMode:me.uiPreferences.simpleMode,unlocked:me.security.unlocked});
}

const retiredSequence=checked.slice(0,3).map(item=>item.profile);
assert.deepEqual(retiredSequence,['ACTIVO','MOROSO','JUBILADO']);
const removedRoute=await fetch(`${baseUrl}/api/preview/login`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});
assert.equal(removedRoute.status,404);

console.log(JSON.stringify({ok:true,cookie:'mi_aspch_preview_session',profiles:checked},null,2));
