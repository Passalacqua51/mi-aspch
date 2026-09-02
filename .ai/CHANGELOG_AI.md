# Transición OTP → PIN en producción — 2026-09-02

- Confirmado en SQLite que el OTP real fue aceptado, el correo se actualizó y
  la sesión se creó; el fallo era exclusivamente de visibilidad en desktop.
- La maqueta iPhone ya no fuerza `display:flex` sobre pantallas con `hidden`.
- Versionado `styles.css` con su SHA-256 y rotado el caché del Service Worker.
- Añadida regresión estática y validación Playwright desktop/mobile de las tres
  pantallas, sin errores JavaScript.
- Producción 8085 y el túnel público sirven el hotfix; contenedor healthy y sin
  reinicio.

# Invalidación del bundle obsoleto en Preview 8086 — 2026-09-01

- Reproducidos en el origen real los stacks de `renderProfile` y
  `renderMembership` ausentes al ejecutar un bundle retenido.
- Confirmado que el bundle actual servido coincide byte a byte con source.
- `app.js` queda `no-store` únicamente en Preview, referenciado por SHA-256 en
  mobile/ADMIN, y el namespace del Service Worker fue rotado.
- Playwright navega por botones reales a Perfil/Membresía y exige que ambos
  símbolos sean funciones globales, sin ReferenceError.
- Reconstruido solo `mi-aspch-preview`; producción 8085 no fue recreada.

# Estabilización de perfiles y Control Informática Preview 8086 — 2026-09-01

- Restauradas Perfil, Membresía, Seguridad, Dashboard y Socios con sus helpers
  reales; eliminados `renderProfile/renderMembership is not defined` y errores
  derivados al navegar.
- Retirado de toda la UI el flotante/logo de WhatsApp y su asset PWA.
- MOROSO bloquea Estacionamiento y Reservas, muestra alerta de cuotas y no
  presenta montos sin evidencia financiera validada.
- MODO SIMPLE queda reducido a Credencial, Estacionamiento y Contacto;
  DESAFILIADO muestra `Membresía no activa` sin navegación.
- INFORMÁTICA abre el Control real en vista web same-origin con rol ADMIN y
  `informatica@aspch.org`; el retorno a MEMBER restaura el teléfono.
- Validados los nueve perfiles y vistas principales con Playwright sin errores
  JS graves. Reconstruido solo `mi-aspch-preview`; 8085 intacto.

# Retiro de test-notificaciones en producción 8085 — 2026-09-01

- Confirmado que el archivo ya no existía, pero el fallback SPA respondía 200
  con `index.html` manteniendo la URL temporal y una PWA antigua podía conservar
  el panel en caché.
- Añadida redirección 302 con `no-store` desde `/test-notificaciones.html` a `/`
  y rotado el caché del Service Worker para eliminar copias antiguas.
- Se guardó backup y se revisó el diff antes del deploy.
- La imagen hotfix deriva de la imagen productiva inmutable y sustituye solo
  `server.mjs` y `public/sw.js`; volumen, mounts, variables y datos se preservan.
- Validado con HTTP y Playwright: `/` abre Mi ASPCH, la ruta retirada termina en
  `/`, health healthy, cero reinicios y Preview 8086 intacto.

# Laboratorio autenticado Preview 8086 — 2026-09-01

- Añadido `POST /api/preview/impersonate`, disponible exclusivamente con
  `PREVIEW_MODE=true` y 404 en modo normal.
- Añadidos nueve socios sintéticos seguros con estados, preferencias y sesión
  normal en SQLite Preview mediante `mi_aspch_preview_session`.
- Reducido el laboratorio a selector izquierdo y un teléfono mobile en Inicio.
- Retirados `?sim=`, `lab-interceptor.js`, presets de login, fallback ADMIN
  global y la respuesta especial de Service Worker.
- Verificados los nueve perfiles, incluido DESAFILIADO bloqueado e INFORMÁTICA
  ADMIN, y la secuencia ACTIVO → MOROSO → JUBILADO.
- Reconstruido únicamente `mi-aspch-preview`; producción 8085 intacta.

# Corrección del arranque autenticado Preview 8086 — 2026-09-01

- Restaurados `isHelicopterMember` y `applyMemberTheme`, cuya ausencia lanzaba
  un `ReferenceError` después de que `/api/me` ya hubiera autenticado al socio.
- Renovada la versión del recurso `app.js` para que la recarga del teléfono no
  reutilice el JavaScript defectuoso del caché HTTP.
- Añadida una prueba Playwright de la secuencia completa click → impersonate →
  cookie → `/api/me` del iframe → Inicio para los cinco perfiles solicitados.
- Verificados cookie host-only en 8086, Path `/`, SameSite Strict, HttpOnly,
  iframe same-origin, Inicio visible y login/PIN ocultos.
- Reconstruido solo `mi-aspch-preview`; `mi-aspch` 8085 conservó contenedor,
  imagen, hora de inicio, cero reinicios y estado healthy.
- Corregido el overlay persistente del teléfono: el estado oculto ahora usa
  `display:none`, se renovaron las URLs de `lab.js`/`lab.css` y Playwright
  comprueba que la capa desaparece después de abrir Inicio.
- Corregido el “Cargando…” interno de Inicio: `go()` evaluaba referencias a
  renderizadores ausentes antes de llamar a `renderHome()` y lanzaba
  `ReferenceError: renderSecurity is not defined`.
- Las rutas ahora se resuelven de forma diferida y `renderHome()` aplica timeout
  con estado vacío a estacionamiento, simuladores y mensualidad.
- Playwright verificó ACTIVO, MOROSO, JUBILADO, MODO SIMPLE, FO CPT e
  INFORMÁTICA con contenido de Inicio visible, sin “Cargando…” ni errores JS.

# Corrección Selector de Perfiles (8086) — supersedida

- Eliminado el auto-login obligatorio de `informatica@aspch.org` para el puerto de Lab (8086).
- `server.mjs` ahora intercepta `?sim=` en el Lab y carga directamente el perfil real desde SQLite simulando una sesión limpia, sin alterar datos y aislando la cookie para este laboratorio.
- Modificado `lab-interceptor.js` para detener la interceptación de `/api/me` (ahora se nutre del backend real), conservando solo el mock 401 para la simulación de *login* (teléfono 1) y el pin lock (teléfono 2).
- Agregado el botón **INFORMÁTICA** al selector de la UI `lab.html`.
