#!/usr/bin/env node
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL||'playwright');

const baseUrl=String(process.env.PREVIEW_BASE_URL||process.argv[2]||'').replace(/\/$/,'');
if(!/^https?:\/\//.test(baseUrl))throw new Error('Define PREVIEW_BASE_URL con la URL de Preview');
const profiles=[
  {label:'ACTIVO',name:'Cap. Alicia Activa',role:'MEMBER',kind:'home'},
  {label:'MOROSO',name:'FO Martín Moroso',role:'MEMBER',kind:'moroso'},
  {label:'JUBILADO',name:'Cap. Jaime Jubilado',role:'MEMBER',kind:'home'},
  {label:'MODO SIMPLE',name:'Cap. Sofía Simple',role:'MEMBER',kind:'simple'},
  {label:'FO CPT',name:'FO Felipe Operaciones',role:'MEMBER',kind:'home'},
  {label:'DIRECTORIO',name:'Cap. Daniela Directorio',role:'MEMBER',kind:'home'},
  {label:'CONGELADO',name:'FO Camilo Congelado',role:'MEMBER',kind:'frozen'},
  {label:'DESAFILIADO',name:'Diego Desafiliado',role:'MEMBER',kind:'inactive'},
  {label:'INFORMÁTICA',name:'INFORMÁTICA PREVIEW',email:'informatica@aspch.org',role:'ADMIN',kind:'admin'}
];
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.stack||error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`)});
  await page.goto(`${baseUrl}/`,{waitUntil:'domcontentloaded'});await page.locator('#profile-status.ready').waitFor();
  assert.equal(await page.locator('#whatsapp-fab,.whatsapp-fab,img[src*="whatsapp"]').count(),0,'El laboratorio no debe mostrar WhatsApp flotante');
  const checked=[];
  async function select(expected){
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-profile]')].every(b=>!b.disabled));
    const post=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/preview/impersonate'&&r.request().method()==='POST');
    const phoneMe=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/me'&&r.request().frame().parentFrame()!==null);
    const nav=page.waitForEvent('framenavigated',{predicate:f=>f.parentFrame()===page.mainFrame()&&new URL(f.url()).searchParams.get('preview')===expected.label});
    await page.locator(`[data-profile="${expected.label}"]`).click();
    const postResponse=await post;assert.equal(postResponse.status(),200,`${expected.label}: impersonate`);const selected=await postResponse.json();assert.equal(selected.member.name,expected.name);
    const [meResponse,frame]=await Promise.all([phoneMe,nav]);assert.equal(meResponse.status(),200,`${expected.label}: /api/me`);const me=await meResponse.json();assert.equal(me.member.name,expected.name);assert.equal(me.member.role,expected.role);if(expected.email)assert.equal(me.member.email,expected.email);
    assert.equal(new URL(frame.url()).origin,new URL(baseUrl).origin,`${expected.label}: origen del teléfono`);await page.locator('#phone-loading').waitFor({state:'hidden'});
    assert.equal(await frame.locator('#auth-screen').evaluate(el=>el.classList.contains('hidden')&&getComputedStyle(el).display==='none'),true,`${expected.label}: login oculto`);assert.equal(await frame.locator('#lock-screen').evaluate(el=>el.classList.contains('hidden')),true,`${expected.label}: PIN oculto`);
    assert.equal(await frame.locator('#whatsapp-fab,.whatsapp-fab,img[src*="whatsapp"]').count(),0,`${expected.label}: WhatsApp flotante ausente`);return {frame,me};
  }
  for(const expected of profiles){
    const {frame,me}=await select(expected);
    let rendererTypes=null;
    if(expected.kind==='inactive'){
      await frame.locator('#inactive-membership-screen').waitFor();assert.match(await frame.locator('#inactive-membership-screen').innerText(),/Membresía no activa/);assert.equal(await frame.locator('#app-shell').evaluate(el=>el.classList.contains('hidden')),true,'DESAFILIADO no debe entrar al shell');assert.equal(await frame.locator('#desktop-nav .nav-item,#mobile-nav .nav-item').count(),0,'DESAFILIADO no debe tener navegación funcional');
    }else{
      await frame.locator('#app-shell').waitFor({state:'visible'});
      rendererTypes=await frame.evaluate(()=>({profile:typeof renderProfile,membership:typeof renderMembership}));assert.deepEqual(rendererTypes,{profile:'function',membership:'function'},`${expected.label}: renderizadores globales`);
      if(expected.kind==='admin'){
        assert.match(new URL(frame.url()).pathname,/\/admin\.html$/);await frame.locator('.admin-dashboard-hero').waitFor({timeout:10000});assert.equal(await frame.evaluate(()=>typeof formatAdminDuration),'function','INFORMÁTICA: formatAdminDuration debe ser función');assert.equal(await page.evaluate(()=>document.body.classList.contains('admin-mode')),true,'INFORMÁTICA debe activar vista web');assert.ok((await page.locator('.phone').boundingBox()).width>=300,'Control Informática debe mantener usabilidad en viewport iPhone');const navText=await frame.locator('#desktop-nav').innerText();for(const name of ['Dashboard','Socios','Reservas','Contenido','Votaciones','Notificaciones','Integraciones','Seguridad','Auditoría','Sistema','Developer'])assert.match(navText,new RegExp(name));
        const adminViews=[['admin-dashboard','Estado general de Mi ASPCH'],['admin-members','Buscar por nombre'],['admin-finance','Finanzas'],['admin-reservations','Operación local de reservas'],['admin-content','Contenido'],['admin-votes','Votaciones'],['admin-notifications','Entregas y canales'],['admin-integrations','Estado y efecto operativo'],['admin-security','Sesiones y credenciales'],['admin-audit','Registro sanitizado'],['admin-system','Diagnóstico local acotado'],['developer','Developer Center']];
        for(const [view,marker] of adminViews){await frame.locator(`#desktop-nav [data-view="${view}"]`).evaluate(el=>el.click());await frame.waitForFunction(()=>{const text=document.querySelector('#view')?.innerText||'';return text&&!text.includes('Cargando…')},undefined,{timeout:15000});const text=await frame.locator('#view').innerText();assert.match(text,new RegExp(marker),`INFORMÁTICA: ${view}`);assert.doesNotMatch(text,/ReferenceError|is not defined/,`INFORMÁTICA: ${view} sin ReferenceError`)}
      }else if(expected.kind==='simple'){
        await frame.locator('.credential-wrap').waitFor({timeout:10000});assert.equal((await frame.locator('#page-title').innerText()).trim(),'Credencial digital');const navText=(await frame.locator('#desktop-nav,#mobile-nav').allInnerTexts()).join(' ');for(const allowed of ['Credencial','Estac.','Contacto'])assert.match(navText,new RegExp(allowed));for(const hidden of ['Reservas','Biblioteca','Noticias','Convenios','Votaciones','Cursos'])assert.doesNotMatch(navText,new RegExp(hidden));
      }else{
        await frame.locator('#view .hero h1').waitFor({timeout:10000});assert.doesNotMatch(await frame.locator('#view').innerText(),/Cargando…/);assert.match(await frame.locator('#view').innerText(),/Credencial vigente/);
        if(expected.kind==='moroso'){
          await frame.locator('.debt-alert-overlay').waitFor();const alertText=await frame.locator('.debt-alert-overlay').innerText();assert.match(alertText,/CONDICIÓN MOROSO/);assert.match(alertText,/3 cuotas pendientes/);assert.doesNotMatch(alertText,/\$|105[.]?000/,'No debe inventarse un monto');await frame.locator('#debt-alert-close').click();await frame.evaluate(()=>go('parking'));await frame.locator('.benefit-preview-overlay').waitFor();await frame.evaluate(()=>go('booking'));await frame.locator('.moroso-benefit-block').waitFor();assert.match(await frame.locator('.moroso-benefit-block').innerText(),/Servicio no disponible por cuotas pendientes/);
        }
        if(expected.kind==='frozen'){
          assert.equal(me.access?.parking,false);assert.equal(me.access?.simulatorView,false);assert.equal(me.access?.studyRoom,false);await frame.evaluate(()=>go('booking'));await frame.locator('.congelado-benefit-block').waitFor();const frozenText=await frame.locator('.congelado-benefit-block').innerText();assert.match(frozenText,/membresía congelada/i);assert.doesNotMatch(frozenText,/cuotas pendientes/i);
        }
        if(expected.label==='ACTIVO'){
          const homeText=await frame.locator('#view').innerText();assert.match(homeText,/Emergencia \/ IFALPA/i);assert.ok(await frame.locator('[data-testid="home-emergency"]').count());assert.equal(await frame.locator('[data-testid="home-emergency"] a[href*="ASPCH-EN-CASO-DE-ACCIDENTE-O-INCIDENTE.pdf"]').count(),0,'Inicio no debe desplegar el enlace PDF directamente');assert.equal(await frame.evaluate(()=>state.config.push.enabled),false,'Preview no debe usar Push real');await frame.locator('[data-testid="home-emergency"]').click();await frame.locator('.emergency-page').waitFor();assert.equal(await frame.locator('.emergency-page a[href*="ASPCH-EN-CASO-DE-ACCIDENTE-O-INCIDENTE.pdf"]').count(),1,'La vista dedicada de Emergencia debe contener el PDF oficial');
          await frame.evaluate(()=>go('simulators'));await frame.locator('.sim-tab[data-sim="a320pro"]').click();await frame.locator('[data-testid="a320pro-rate-2"]').waitFor();assert.match(await frame.locator('[data-testid="a320pro-rate-2"]').innerText(),/2 horas[\s\S]*\$75\.000/);assert.match(await frame.locator('[data-testid="a320pro-rate-4"]').innerText(),/4 horas[\s\S]*\$100\.000/);assert.equal(await frame.locator('#a320pro-request-form').count(),0,'A320Pro no debe tener formulario local intermedio');assert.equal(await frame.locator('#a320pro-request-link').count(),1);assert.equal(await frame.evaluate(()=>state.simulators.a320ProRequestUrl),'https://forms.gle/qzXaCUJgmTyufdKQA');const officialFormPage=context.waitForEvent('page');await frame.locator('#a320pro-request-link').click();const opened=await officialFormPage;await opened.waitForLoadState('domcontentloaded').catch(()=>{});assert.match(opened.url(),/^https:\/\/(?:forms\.gle\/qzXaCUJgmTyufdKQA|docs\.google\.com\/forms\/)/);await opened.close();
          await frame.evaluate(()=>go('contact'));await frame.locator('.contact-channels-grid').waitFor();assert.equal(await frame.locator('.contact-hero h2').count(),0);assert.equal(await frame.locator('.official-resources').count(),0,'Contacto no debe incluir recursos de Emergencia / IFALPA');assert.doesNotMatch(await frame.locator('#view').innerText(),/EMERGENCIA \/ IFALPA/,'Contacto no debe mencionar Emergencia / IFALPA');
        }
        if(expected.label==='ACTIVO')await frame.locator('#mobile-nav [data-view="profile"]').evaluate(el=>el.click());else await frame.evaluate(()=>go('profile'));await frame.locator('.profile-page').waitFor();assert.match(await frame.locator('.profile-page').innerText(),/Personalizar servicios/);if(expected.label==='ACTIVO'){await frame.locator('#top-avatar').evaluate(el=>el.click());await frame.locator('[data-account-view="membership"]').evaluate(el=>el.click())}else await frame.evaluate(()=>go('membership'));await frame.locator('#membership-view').waitFor();assert.doesNotMatch(await frame.locator('#view').innerText(),/Cargando…/);
        if(expected.label==='ACTIVO')for(const [view,selector] of [['security','.security-page'],['booking','.booking-hub'],['parking','.parking-head'],['credential','.credential-wrap'],['contact','.contact-channels-grid']]){await frame.evaluate(target=>go(target),view);await frame.locator(selector).waitFor({timeout:10000});assert.doesNotMatch(await frame.locator('#view').innerText(),/Cargando…/)}
      }
    }
    checked.push({profile:expected.label,member:me.member.name,kind:expected.kind,rendererTypes});
  }
  const back=await select(profiles[0]);await back.frame.locator('#view .hero h1').waitFor({timeout:10000});assert.equal(await page.evaluate(()=>document.body.classList.contains('admin-mode')),false,'Volver a MEMBER debe restaurar vista mobile');assert.ok((await page.locator('.phone').boundingBox()).width<500,'La vista MEMBER debe volver al teléfono');
  const cookie=(await context.cookies(baseUrl)).find(c=>c.name==='mi_aspch_preview_session');assert.ok(cookie);assert.equal(cookie.path,'/');assert.equal(cookie.domain,new URL(baseUrl).hostname);assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.httpOnly,true);assert.deepEqual(errors,[],`Errores JS graves:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ok:true,profiles:checked,memberAdminRoundTrip:true,cookie:{name:cookie.name,path:cookie.path,sameSite:cookie.sameSite,httpOnly:cookie.httpOnly}},null,2));
}finally{await browser.close()}
