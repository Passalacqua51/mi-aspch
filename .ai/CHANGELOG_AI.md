# Sala, fotos y nombres — 2026-09-11

- Sala de estudios: horario oficial chileno, validación backend y cancelación propia con refresco real.
- Perfil/credencial: picker nativo de fotos para WKWebView, conversión HEIC a JPEG y persistencia segura.
- Nombres: validación por capas y separación explícita del nombre oficial BD SOCIOS.
- Cache-busting actualizado y Service Worker rotado una sola vez.

# OLED Dark exclusivo del Panel Informática — 2026-09-09

- Tema OLED negro (bg `#000000`) aplicado solo a `/informatica`, `/informatica/`,
  `/admin` y `/admin.html` vía `class="informatica-panel"` en `<html>` de
  `admin.html`; la app normal conserva su tema estándar light/dark del sistema.
- Nuevas variables OLED scoped en `styles.css` (bg `#000`, surface `#050505/`#080808`,
  line `#1a1a1a`, text `#f5f5f5`, muted `#9ca3af`) manteniendo azul ASPCH para
  primarios/activos/links/selección, rojo solo errores y verde solo OK.
- Corregidos fondos hardcodeados del login/bloqueo en esencia: `.auth-screen`
  y `.clean-*` pasan a negro en el panel; `nav-item.active` pasa de rojo a azul.
- Lienzo nativo iOS: `MiASPCHWebView.applyInformaticaBackground` usa negro cuando
  el pathname es del panel y `systemBackground` en el resto, sin crear WKWebView
  nuevo ni tocar sesiones/auth (se re-aplica en `didFinish` y en cambios de colorScheme).
- `git diff --check` limpio y BUILD DEBUG iOS Simulator **SUCCEEDED**. Sin commit ni push.

# Navegación y vistas iOS — 2026-09-09

- Corregido Perfil→Credencial en Modo Simple y restaurados Inicio,
  Estacionamiento, Reservas y Perfil como destinos principales.
- Ordenado Más con Beneficios ASPCH y sin acciones de cuenta duplicadas.
- Simplificados Estacionamiento y Sala de estudios; Inicio incorpora votaciones
  e inscripciones abiertas a cursos, charlas y eventos.
- Conservada la firma con equipo personal sin Push entitlement; notificaciones
  locales DEBUG disponibles y APNs remoto documentado como pendiente de equipo
  Apple Developer de pago, perfil y backend.
- Conservado acceso ADMIN server-side al Panel Informática desde la app; sin
  despliegue, commit, backend APNs ni activación ficticia de integraciones.
- Añadido selector flotante ADMIN arriba a la derecha para alternar entre Mi
  ASPCH y Panel Informática dentro del mismo WKWebView y sesión.
- Corregida la simplificación pendiente de Estacionamiento: sin título global,
  sin cabecera/sincronización/`Otra fecha` y con siete fechas desde hoy.
- Retirada de toda UI la lista de espera/avisos y horarios ocupados de Sala.
- Navbar ADMIN reordenado a Estacionamientos, Socios, Votaciones y Auditoría;
  el panel abre en Estacionamientos y Socios permite bloquear/reactivar acceso
  con cierre de sesiones y auditoría, sin modificar la membresía.
- Reparado `Liberar` de estacionamientos ADMIN para reservas live sin ID local:
  ahora opera por fecha+cupo y sincroniza Google Sheets, proyección visible,
  SQLite y Auditoría.

# Preview 8086 — 2026-09-03

- Segunda pasada: A320Pro muestra 2 horas $75.000 y 4 horas $100.000 con el
  formulario oficial conservado.
- Reapertura con passkey vuelve al gate; sesión vigente sin passkey entra sin
  gate. Se añadieron pruebas dirigidas para ambos casos.
- CONGELADO comparte restricciones backend de MOROSO con mensaje diferenciado.
- Inicio y Contacto exponen el protocolo PDF oficial de emergencia ASPCH y
  acciones H24; se mantiene el reporte exacto de assets gráficos locales
  ausentes.
- Dockerfile comprueba Node 22 y `npm run check`; E2E real queda fijado en
  390x844 y confirma que Push real está bloqueado.

- Navegación mobile estable con cuatro acciones en Modo simple y boot semántico
  basado en `unlocked_until`/`sessionStorage`.
- Consentimiento Push explícito antes de suscribir y consola ADMIN acotada a
  plantillas allowlist para Directorio o Informática/dispositivo.
- Contactos WhatsApp con nombres reales configurados, formulario y precio
  A320Pro configurables, y placeholders para fotos/IFALPA/emergencia cuando no
  existe asset oficial local.
- Retirados endpoints de autenticación por correo legado y rotado el
  cache-busting de Preview.
- Self-checks corregidos para cookie Preview configurable, expectativa ADMIN de
  Directorio y ausencia legítima de `.env.example` en imágenes Docker.

# Regla de prueba y acceso del Directorio — 2026-09-02

- Conservado sin reinicio el enlace público vigente hacia producción 8085.
- Documentada en AGENTS, SERVICES y DECISIONS la prohibición de reemplazar el
  enlace o crear otro Quick Tunnel silenciosamente.
- Verificados siete integrantes del Directorio, todos activos y AL_DIA.
- La sincronización de Directorio ahora reafirma `is_board=1, active=1`.
- Añadida cobertura HTTP del OTP único al correo ingresado y de la actualización
  local de ese correo, sin autorización del correo histórico.
- Alineado WebAuthn al enlace vigente: Face ID/Passkeys aparece disponible en el
  endpoint público; se recreó solo la app y cloudflared conservó proceso y URL.
- Corregido el botón de Face ID/huella para habilitarse realmente cuando existe
  una passkey compatible, con aserción estática contra la regresión.
- Normalizado el teléfono editable a dígitos nacionales sin prefijo `56`, tanto
  para la ficha corregida como para futuras escrituras hacia BD SOCIOS.
- Convertido el recordatorio de estacionamiento en una confirmación Sí/No, con
  acciones nativas donde estén soportadas y diálogo interno al tocarlo en iOS.
- Corregidos manifiesto, metadatos Apple y notificaciones para usar los iconos
  cuadrados oficiales en vez del logotipo horizontal.
- Corregida la recuperación de onboarding cuando una sesión OTP válida queda sin
  PIN: al cargar o recibir `PIN_REQUIRED`, la UI abre directamente `Crear PIN`.
- Añadido consentimiento Push explícito Sí/No en el primer ingreso del
  Directorio por dispositivo, con baja efectiva al rechazar.

# Acceso dual de Informática — 2026-09-02

- Habilitado `/informatica` bajo el mismo origen, login ADMIN y cookie segura.
- Añadido cambio de modo entre Mi ASPCH y Panel Informática sin cerrar sesión.
- El rol ADMIN recibe la experiencia funcional del Directorio sin impersonación.
- Adaptado el panel de métricas a Safari móvil y corregida su detección mediante
  el JavaScript externo para respetar la CSP estricta de producción.

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


## 2026-09-07 — Liquid Glass en capa iOS

Adaptación visual de la capa iOS con navegación estándar, diagnóstico separado del formulario y accesibilidad de transparencias. Builds DEBUG/RELEASE aprobados; revisión visual de dispositivo pendiente.

## 2026-09-07 — Navegación inferior iOS

- Retirados NavigationStack/título/header superior y espacio web duplicado.
- Añadida barra SwiftUI con acciones reales web, sincronización DOM y un único
  WKWebView persistente; cookies y autenticación preservadas.
- Liquid Glass oficial en superficie inferior, fallback nativo y DEBUG overlay.
- DEBUG/RELEASE firmados y cuatro pruebas Simulator aprobadas (incluye Face ID).
- Instalación/lanzamiento en iPhone 13 sin cambios de Signing. Sin commit,
  despliegue, cambios backend, datos ni infraestructura.

## 2026-09-07 — Build 2 iOS

- Renovada identidad del asset del icono, preservando el PNG original.
- Apariencia SwiftUI transmitida explícitamente al WKWebView persistente.
- DEBUG muestra apariencia/build; DEBUG/RELEASE y pruebas aprobadas.
- Instalada build 2 en el iPhone confirmado, sin desinstalación ni cambios de datos.

## 2026-09-09 — Correcciones iOS pre-GitHub

- NativeNavigationBar deja de usar Liquid Glass y elimina el escalado del icono
  activo; conserva cápsula flotante, 5 posiciones, acciones reales y selector
  animado.
- Face ID nativo exitoso ahora completa el desbloqueo local del gate web en la
  misma instancia persistente de WKWebView.
- El PIN fallback nativo reutiliza `/api/security/unlock`, actualiza estado web
  y llama `loginSuccess` desde el mundo de la página; no guarda PIN local.
- Sin cambios a backend, Cloudflare, DNS, Docker, SQLite, usuarios, PINes,
  Signing, Bundle ID, AppIcon ni Push remoto.
- Validado con Xcode diagnostics, `git diff --check` y BuildProject MCP. Builds
  explícitos Debug/Release por `xcodebuild` bloqueados por CoreSimulator/actool
  sin runtimes disponibles para assets thinned.
- Segunda pasada: Dark Mode de la barra sube contraste, el lock nativo evita el
  doble prompt Face ID → PIN cuando la sesión servidor ya está bloqueada, y
  Estacionamientos deja de mostrar `Sincronizado con ESTACIONAMIENTOS ASPCH`.
- Se agregó archivo de entitlements APNs development, pendiente de enlazar al
  target desde Xcode por seguridad mientras el proyecto está abierto.
- PIN de Mi ASPCH restringido a 4 dígitos exactos en frontend, backend y UI
  nativa; pantalla de reapertura simplificada a saludo con nombre y botón
  principal `Acceder`.
- Pantalla nativa de reapertura reemplaza iconografía Face ID/candado por logo
  ASPCH y fuerza fallback PIN al alcanzar 3 fallos biométricos.
- Cualquier resultado no exitoso de Face ID en la pantalla nativa pasa al PIN
  de Mi ASPCH, evitando reintentos biométricos inesperados.
- 2026-09-10: Diagnóstico y verificación end-to-end de "Liberar estacionamiento" (Panel Informática). Reproducción del fallo sobre la baseline desplegada (404 del endpoint `/api/admin/parking/release`; fallo del flujo OLD con ids ausentes en vivo). Verificación del fix del working tree con `tools/self_check_admin_parking_release.mjs` (liberación panel) y alineación de `tools/self_check_auth.mjs` a `VACATED`/`vacated_at`.
- 2026-09-10: Panel Informática completado (auditoría + fixes + 2 vistas). Eliminado botón muerto Instagram Sync (sin backend); Finanzas read-only nueva (`GET /api/admin/finance`, deudores reales, 403 a carga XLSM intacto); Contenido nuevo con CRUD real (noticias/actividades/convenios/biblioteca); links Dashboard con teclado; self-check `tools/self_check_admin_panel.mjs` (`npm run admin:test`) OK; `PANEL_INFORMATICA_AUDIT.md` creado. P0 seguridad: ninguno (403 global /api/admin/* verificado).
