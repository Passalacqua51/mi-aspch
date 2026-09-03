import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/auth-gate.js',import.meta.url),'utf8');
const context={window:{}};
vm.runInNewContext(source,context,{filename:'public/auth-gate.js'});
const shouldGate=context.window.shouldGateOnReopen;
assert.equal(typeof shouldGate,'function');
const future=new Date(Date.now()+60_000).toISOString();
assert.equal(shouldGate({security:{unlocked:true,unlockedUntil:future,passkeySet:true},localUnlockMarker:false}),true,'Passkey: reapertura real debe volver al gate aunque unlocked_until siga vigente');
assert.equal(shouldGate({security:{unlocked:true,unlockedUntil:future,passkeySet:false},localUnlockMarker:false}),false,'Sin passkey: sesión vigente debe permitir entrar sin gate');
assert.equal(shouldGate({security:{unlocked:true,unlockedUntil:future,passkeySet:true},localUnlockMarker:true}),false,'Passkey: navegación dentro de la sesión ya desbloqueada no debe volver al gate');
assert.equal(shouldGate({security:{unlocked:true,unlockedUntil:new Date(Date.now()-60_000).toISOString(),passkeySet:false},localUnlockMarker:true}),true,'Sesión vencida siempre debe volver al gate');
console.log('SELF-CHECK AUTH GATE OK: passkey reapertura y sesión sin passkey cubiertas.');
