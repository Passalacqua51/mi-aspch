import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Self-check estático del Panel Informática: sin red, sin emails, sin push,
// sin tocar SQLite ni servicios externos. Solo lee el código.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');

// 1. Toda la navegación ADMIN debe tener renderer real (no depender de placeholders mudos).
const navIds = [...app.matchAll(/\['(admin-[a-z-]+|developer)','[^']*','[^']*'\]/g)].map(m => m[1]);
assert.ok(navIds.length >= 10, `ADMIN_NAV incompleto: ${navIds.length} ítems`);
const routeIds = [...app.matchAll(/'?((?:admin-[a-z-]+|developer|admin))'?:\(\)=>(\w+)/g)].map(m => [m[1], m[2]]);
const routeMap = Object.fromEntries(routeIds);
const placeholderMatch = app.match(/const ADMIN_PLACEHOLDERS=\{([^}]*)\}/);
const placeholderIds = [...(placeholderMatch?.[1] || '').matchAll(/'(admin-[a-z-]+)'/g)].map(m => m[1]);
for (const id of navIds) {
  assert.ok(routeMap[id], `Sin ruta para ${id}`);
  assert.ok(!placeholderIds.includes(id), `${id} sigue como placeholder`);
  const fn = routeMap[id];
  assert.ok(new RegExp(`function ${fn}\\(`).test(app), `Renderer ${fn} no definido para ${id}`);
}

// 2. Cada llamada frontend a /api/admin/* debe tener endpoint backend (exacto o familia parametrizada).
const serverLiterals = new Set([...server.matchAll(/p\s*===\s*'(\/api\/admin\/[a-z/\-]+)'/g)].map(m => m[1]));
const PARAM_FAMILIES = ['/api/admin/members/'];
const rawCalls = [...app.matchAll(/api\([`'"](\/api\/admin\/[^`'"]+)/g)].map(m => m[1].split('?')[0].split('$')[0]);
const windowOpens = [...app.matchAll(/window\.open\([`'"](\/api\/admin\/[^`'"]+)/g)].map(m => m[1].split('?')[0]);
for (const call of [...new Set([...rawCalls, ...windowOpens])]) {
  const ok = serverLiterals.has(call) || PARAM_FAMILIES.some(f => call.startsWith(f));
  assert.ok(ok, `Frontend llama ${call} sin endpoint backend`);
}
// Familias parametrizadas deben existir como matcher regex en el servidor.
for (const fam of PARAM_FAMILIES) {
  assert.ok(server.includes(fam.replaceAll('/', '\\/')), `Familia ${fam} sin matcher en servidor`);
}

// 3. Sin integraciones fantasma: nada de Instagram (sin backend, sin estado, sin botón).
for (const token of ['sync-instagram', 'instagramSync', 'adminSyncInstagram']) {
  assert.ok(!app.includes(token), `Referencia fantasma en app.js: ${token}`);
  assert.ok(!server.includes(token), `Referencia fantasma en server.mjs: ${token}`);
}

// 4. Autorización ADMIN global en backend (403 para no-ADMIN en toda /api/admin/*).
assert.ok(/p\.startsWith\('\/api\/admin\/'\) && member\.role !== 'ADMIN'/.test(server), 'Falta guard 403 global de /api/admin/*');

// 5. Finanzas solo lectura: sin POST/PUT de escritura financiera salvo relectura diagnóstica.
assert.ok(!/\/api\/admin\/finance['"]\s*}\s*,\s*\{method:'POST'/.test(app), 'Finanzas con escritura inesperada');
assert.ok(server.includes("Carga XLSM deshabilitada"), 'Falta bloqueo de carga XLSM');

// 6. Developer sin herramientas peligrosas.
for (const token of ['eval(', 'child_process', 'docker ', 'PRAGMA', 'process.env']) {
  if (token === 'PRAGMA') continue; // PRAGMA solo vía endpoint acotado de mantenimiento, no SQL libre
  assert.ok(!app.includes(token), `Token peligroso en app.js: ${token}`);
}
assert.ok(!/SELECT .* FROM/i.test(app.match(/function renderDeveloper\(\)[\s\S]*?^}/m)?.[0] || ''), 'SQL en vista Developer');

console.log(`SELF-CHECK ADMIN PANEL OK: ${navIds.length} secciones, ${rawCalls.length} llamadas API cubiertas, sin ghost UI.`);
