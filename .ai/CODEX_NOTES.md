# Notas de Codex para ChatGPT

## 2026-09-03 — Segunda pasada Preview

Se corrigieron tarifas A320Pro (2 h $75.000, 4 h $100.000) y se mantuvo el
formulario oficial indicado. Emergencia/IFALPA quedó visible en Inicio y
Contacto con enlace al PDF oficial verificado y acciones telefónicas; los
assets gráficos locales siguen ausentes y se informa así.

El gate ahora distingue passkey frente a sesión sin passkey al reabrir. Se
agregó `tools/self_check_auth_gate.mjs` para cubrir ambos casos. CONGELADO
comparte las restricciones backend de MOROSO con mensaje diferenciado.
`Dockerfile` valida Node 22 y `npm run check`; el E2E usa 390x844 y confirma
tarifas, emergencia, restricciones y Push bloqueado.

## 2026-09-03 — Requisitos Preview 8086

Se preparó únicamente el código fuente para Preview. La navegación mobile
mantiene cuatro acciones incluso en Modo simple; el arranque respeta
`unlocked_until` y limpia el marcador `sessionStorage` vencido. El consentimiento
Push del Directorio ya no suscribe automáticamente cuando el permiso nativo
estaba concedido: primero muestra `Sí, activar` / `No, gracias`.

La consola ADMIN de Push quedó limitada a plantillas oficiales y audiencias
Directorio activo o Informática/dispositivo actual. El endpoint no admite texto
libre, IDs de socios ni broadcast general, y devuelve estados enviada/falló/sin
suscripción. Se retiraron `request-code`/`verify-code` legado sin alterar
RUT+OTP ni ADMIN+PIN.

Contacto usa WhatsApp con nombres y números configurados. Los simuladores
sirven fotos solo desde archivos locales existentes; A320Pro expone precio y
formulario solo con configuración oficial. No hay assets locales IFALPA o de
emergencia, así que se dejó placeholder/integración pendiente y se documentó.

## 2026-09-03 — Reproducción de self-checks

Se reprodujeron los tres reportes. `setPin` recibía `member=null` porque el
fixture usaba una cookie fija distinta de `SESSION_COOKIE_NAME`; `2ad8c72`
ya lo corrigió usando `sessionCookieName()`. `preview_profiles` también quedó
corregido en `2ad8c72` para esperar `isBoard=true` en INFORMÁTICA, coherente con
la autorización efectiva del rol ADMIN.

`staticcheck` fallaba dentro de la imagen porque `.dockerignore` excluye
`.env.example` deliberadamente. Se ajustó el test para tratarlo como fixture
opcional, manteniendo sus aserciones cuando se ejecuta desde el checkout.
Preview 8086 está desplegado y healthy con `mi-aspch-preview:local`; los hashes
servidos de `app.js` y `sw.js` coinciden con el source. E2E browser no es
ejecutable en el entorno actual porque Playwright no está instalado ni en host
ni en la imagen Preview.

## 2026-09-02 — Regla permanente para pruebas del Directorio

El enlace `https://reviewer-stopping-wages-roland.trycloudflare.com` continúa
activo sobre producción 8085 y no se reinició. La unidad usa un Quick Tunnel
con `Restart=always`; por ello el hostname exacto depende de conservar el
proceso. AGENTS, SERVICES y DECISIONS prohíben reiniciarlo, sustituirlo o
publicar otra URL silenciosamente. Un enlace realmente durable tras reinicios
requiere una migración explícita a un hostname administrado.

SQLite confirma siete integrantes del Directorio, todos activos y AL_DIA. La
sincronización ahora fija `is_board=1, active=1` para la nómina vigente. La
prueba HTTP aislada verifica que un director con correo distinto genera solo
`register_primary` al correo ingresado, no pide correo histórico, completa el
registro con un OTP y conserva `active=1`.

Las cinco variables de origen público y WebAuthn se alinearon al enlace vigente
y se recreó solo `mi-aspch`; el PID de cloudflared no cambió. El endpoint público
informa `biometricReady=true`, `biometricMode=passkey` y la misma URL pública.
Las passkeys del hostname anterior, si existieran, deben registrarse nuevamente.
Además, `showLock()` ahora elimina `disabled` del botón biométrico cuando
`canUse=true`; antes podía mostrarlo pero la propia función de click retornaba
sin iniciar WebAuthn. Hay una cuenta de Directorio con una passkey existente,
por lo que deberá enrolarla nuevamente bajo el hostname vigente.

Por instrucción posterior se corrigió la ficha validada para que EMPLEADOR sea
`COMERCIAL`, CATEGORÍA sea `Comercial` y el teléfono se persista como número
nacional de nueve dígitos sin `56`. `normalizeProfilePhone()` elimina ahora ese
prefijo antes de cualquier escritura futura a SQLite y BD SOCIOS.

## 2026-09-02 — Bloqueo visual después del OTP

La evidencia SQLite del intento real mostró OTP consumido, cambio de correo
registrado y nueva sesión bloqueada, sin una llamada posterior a desbloqueo por
PIN. No falló Gmail ni la verificación backend: en viewport desktop la regla
del marco iPhone declaraba `display:flex!important` sobre las tres pantallas y
ganaba a `.hidden` por especificidad.

Se limitó el display forzado a `:not(.hidden)`, se versionó el CSS por SHA-256 y
se rotó el namespace PWA. Una nueva aserción estática protege el invariante.
Playwright confirmó autenticación visible/PIN oculto, luego PIN visible y
finalmente app visible en 1280x900 y 390x844, sin errores JS. El túnel público
sirve el mismo CSS verificado y 8085 permanece healthy sin reinicio.

## 2026-09-01 — Causa real de renderProfile/renderMembership ausentes

Source y `/app.js` servido ya contenían ambos renderizadores con SHA-256
`07cbcdd7bc0af08bc4fcbaeeaee64d763de5cc07ed823e28380d58cb939bf0cf`, pero
el HTML seguía usando una etiqueta de versión estable, JavaScript tenía
`max-age=3600` y el Service Worker no había rotado su caché. Un navegador con el
bundle anterior podía recargar el iframe y seguir ejecutando código sin esas
funciones.

Se reprodujo contra el origen 8086: Perfil arrojó el ReferenceError desde
`Object.profile → go → HTMLButtonElement` y Membresía desde
`Object.membership → go → HTMLButtonElement`. Se versionó el asset con su hash,
se aplicó `no-store` a JS solo bajo `PREVIEW_MODE` y se rotó el caché PWA.
Playwright confirmó por navegación UI que ambos `typeof` son `function`, ambas
vistas abren y no hay errores de consola. Solo se recreó Preview.

## 2026-09-01 — Estabilización integral de perfiles Preview

El commit de presets había eliminado los renderizadores reales de Perfil,
Membresía, Seguridad, Dashboard y Socios dejando referencias residuales. Se
restauraron como vistas separadas y funcionales, junto con sus helpers, y se
eliminó el botón/logo flotante de WhatsApp.

MOROSO conserva acceso a la app pero no a Estacionamiento, Simuladores ni Sala;
Inicio muestra sus cuotas y omite el monto porque el perfil sintético no tiene
evidencia financiera suficiente. MODO SIMPLE queda limitado a Credencial,
Estacionamiento y Contacto. DESAFILIADO renderiza una pantalla terminal sin
shell ni navegación. INFORMÁTICA usa `informatica@aspch.org` como ADMIN Preview
y cambia el laboratorio a `admin.html` web; regresar a MEMBER restaura el marco
mobile.

Las pruebas API y Playwright recorrieron los nueve perfiles, las vistas
principales y MEMBER ↔ INFORMÁTICA sin login, PIN, `Cargando…`, ReferenceError,
TypeError, rejections ni errores de consola. Solo se reconstruyó Preview 8086;
8085 no fue recreado ni reiniciado.

## 2026-09-01 — Laboratorio con sesiones Preview reales

Se reemplazaron los perfiles interceptados en cliente y los autologins globales
por `POST /api/preview/impersonate`. La ruta crea o actualiza únicamente miembros
sintéticos `@preview.invalid`, registra estado financiero y preferencias en la
SQLite Preview, crea una sesión normal desbloqueada y rota la cookie HttpOnly
`mi_aspch_preview_session`.

El laboratorio quedó reducido a selector izquierdo y un teléfono mobile que
abre Inicio después de crear la sesión. Los nueve perfiles aprobaron `/api/me`,
mensualidad, estacionamiento, mercado, autorización ADMIN y carga mobile; la
secuencia ACTIVO → MOROSO → JUBILADO rotó sesión y datos. DESAFILIADO conserva
`active=0` y puede visualizar su estado bloqueado solo por ser sintético Preview.
Con `PREVIEW_MODE=false`, la ruta devuelve 404. Se retiraron interceptor,
`?sim=`, presets de login, fallback ADMIN y Service Worker especial. Solo se
reconstruyó `mi-aspch-preview`; producción 8085 permaneció intacta.

## 2026-08-31 — Resumen dinámico compacto en Inicio

Se ajustó la vista Inicio de Mi ASPCH para cumplir el flujo ordenado y sin rellenos:
1. Saludo compacto
2. Credencial vigente
3. Próximo simulador (solo si existe -> abre `simulators`)
4. Estacionamiento activo (solo si existe -> abre `parking`)
5. Aviso ASPCH importante (solo si existe)
6. Estado mensualidad compacto (LATAM Airlines / Grupo / Cargo => "Descuento por planilla"; resto => estado correspondiente)
7. Contactar ASPCH (acceso discreto al final -> abre `contact`)

Sin Biblioteca, Convenios, Noticias, Sala, etc. en Inicio; todos conservados en el menú desplegable. Preview 8086 reconstruido y validado healthy; sincronizado con MediaCenter; producción 8085 no fue tocada.

## 2026-08-31 — Login light, Reservas y personalización

Se corrigió únicamente el tema light del login: fondo blanco, PNG oficial sin
filtros y textos contrastados. Dark conserva el mismo PNG y su placa clara. En
390x844 ambos temas mantienen la proporción natural 2481x603.

Inicio contiene una sola entrada Reservas y la vista hija ofrece Simuladores y
Sala de estudios. La selección de ocho servicios se persiste por socio en
`member_ui_preferences`; omitir mantiene todos visibles y Perfil permite editar.
Las pruebas HTTP verifican primer guardado y cambio posterior sin modificar
permisos. Preview fue actualizado; producción no se recreó.

## 2026-08-31 — Logo institucional oficial

El PNG recibido se copió sin transformación a `public/logo-aspch-original.png`;
origen, worktree, respuesta HTTP de Preview y copia MediaCenter conservan el
mismo SHA-256. Login/desbloqueo usan ese archivo con proporción natural y dark
mode añade una placa clara. El hero interno quedó solo con `Hola, Informática`.

Se retiraron las referencias frontend/PWA a los logos e iconos anteriores y se
añadió una regresión estática por hash. Playwright confirmó 2481×603 natural,
`object-fit: contain`, `filter: none` y render 280×68 light / 252×61 dark.
Preview 8086 fue reconstruido healthy; producción 8085 permaneció intacta.

## 2026-08-31 — Operación de Preview

- La definición canónica es `compose.preview.yaml`; operar únicamente mediante
  `tools/preview_ctl.sh` y consultar `docs/PREVIEW.md`.
- Nunca montar `aspch_mi_aspch_data` en el servicio `preview`. Solo
  `preview-seed`, sin red y con `/production:ro`, puede leerlo para generar una
  copia sanitizada bajo `runtime/preview`.
- Mantener `PREVIEW_MODE=true` y el bind exclusivo a la IP Tailscale. No añadir
  `0.0.0.0`, loopback, Tailscale Funnel ni un proxy público.
- La unidad histórica Cloudflare debe retirarse cuando se renueve sudo; mientras
  tanto no puede alcanzar el Preview porque `127.0.0.1:8086` está cerrado.

## 2026-08-31 — Motor seguro y dry-run XLSM → SQLite

Se añadió un planificador determinista con políticas explícitas para ACTIVO,
MOROSO, CONGELADO, DESAFILIADO, JUBILADO y DIRECTORIO. Solo acepta matches 1:1
por RUT con DV válido. Vacíos, texto libre, duplicados, RUT inválidos y no-match
se omiten. El aplicador existe detrás de `planId` exacto y confirmación, verifica
precondiciones y audita por corrida y socio, pero no fue conectado ni ejecutado.

El importador legado quedó deshabilitado: ya no puede tocar nombres, empleador,
cargo o `is_board`, inferir deuda desde fórmulas/celdas vacías ni convertir seis
meses MOROSO en DESAFILIADO. Control Informática mantiene Estado XLSM, Estado
aplicado por Mi ASPCH, Última sincronización, Causa y alertas de discrepancia.

El dry-run real sobre un backup SQLite coherente produjo 977 matches seguros y
182 cambios: 11 CONGELADO, 22 DESAFILIADO, 29 MOROSO, 113 JUBILADO y 7
DIRECTORIO. Quedan 49 socios sin match seguro, 11 RUT inválidos entre fuentes y
843 filas no clasificables. No hubo writes en producción ni en integraciones.

## 2026-08-28 — Notificaciones, Seguridad y Auditoría

Se retiraron los tres placeholders. Notificaciones informa estado y métricas de
Push/Gmail OTP desde SQLite sin endpoints, códigos, claves o payloads. Seguridad
resume sesiones, passkeys, PIN y configuración ADMIN, y reutiliza las acciones
confirmadas existentes; intentos y bloqueos se declaran sin fuente persistida.

Auditoría filtra por fecha, acción, socio y categoría, y nunca entrega
`detail_json`: solo un resumen construido con campos operativos permitidos. El
Dashboard recibió tres enlaces compactos. No se añadieron integraciones, probes,
envíos ni mutaciones genéricas.

El preview 8086 fue reiniciado sobre su SQLite ficticia y validó login ADMIN,
las tres rutas y las integraciones OFF. Las cuatro pruebas solicitadas aprobaron;
producción conservó contenedor, imagen, inicio, cero reinicios y health `healthy`.

## 2026-08-28 — Reservas, Integraciones y Sistema

Se retiraron los tres placeholders. Reservas consolida estacionamientos de hoy y
activos, sala, lista de espera, simuladores sin fuente fiable y auditoría; liberar
o cancelar reutiliza las acciones ADMIN locales existentes.

Integraciones informa seis fuentes con estados controlados, última evidencia e
impacto sin probes. Sistema expone versión, uptime, Node, quick_check, tamaño,
tablas, backups y fallos; no inventa estado del contenedor ni añade herramientas
genéricas. También se corrigió el orden de inicialización de la caché XLSM.

El preview 8086 quedó actualizado con SQLite ficticia, `.env` enmascarado y todas
las integraciones externas OFF. `check`, `selfcheck`, `staticcheck` y
`git diff --check` aprobaron en Node 22 sin red. Producción no fue modificada.

## 2026-08-28 — Primera versión útil de Control Informática maestro

Se completó en el worktree el Dashboard maestro y la ficha diagnóstica de socio.
El Dashboard es GET ADMIN-only y reúne salud, actividad, reservas, fuentes,
backups, SQLite, alertas, errores y auditoría resumida. La ficha separa XLSM,
estado aplicado y BD SOCIOS, muestra acceso operativo y no ofrece cambios de
membresía.

Funcionan refrescar diagnóstico, liberar estacionamiento, cancelar sala, cerrar
sesiones, revocar passkeys, resetear PIN y emitir OTP solo cuando la entrega está
habilitada. Las acciones exitosas quedan auditadas y las pruebas confirman las
transiciones locales de reservas, la preservación de membresía y la ausencia de
secretos en respuestas o auditoría.

Se retiraron la UI y las dos rutas de carga XLSM; la única operación restante es
relectura diagnóstica sin persistir estados. `npm run check`, `npm run selfcheck`,
`npm run staticcheck` y `git diff --check` aprobaron con Node 22 en un contenedor
efímero sin red ni mounts productivos. Producción conservó contenedor, imagen,
inicio y health `healthy`. No hubo commit, merge ni deploy.

## 2026-08-28 — Capa financiera read-only/dry-run

Se añadió un parser financiero puro e independiente que valida estructura M:CR,
RUT con DV, estados explícitos, evidencia mensual y errores de fórmula. Vacíos y
textos libres quedan `NO_CLASIFICADO`; MOROSO no escala y solo un `Total` mensual
positivo cuenta como monto directamente demostrable.

El CLI leyó una copia SQLite con `-readonly`, `query_only` e `immutable=1`. Las
huellas de SQLite/WAL/SHM no cambiaron. El XLSM real produjo 1.041 filas, 1.038
válidas, 977 matches seguros, 843 no clasificadas, 121 meses demostrables,
$506.120 directos y 5 errores de fórmula. El reporte protegido quedó fuera de
Git en `financial-source-test` y conserva el detalle histórico 62/47.

No se conectó el módulo al servidor, frontend ni sincronizador; no hubo cambios
de producción, SQLite, Google, identidades, estados o notificaciones.

## 2026-08-27 — Socios ADMIN de solo lectura

Se creó `feat/admin-members-readonly` sin commit ni despliegue. Socios ahora usa
endpoints GET dedicados para un listado paginado y un detalle bajo demanda. El
listado expone nombre, estado y RUT/email enmascarados; la ficha entrega PII
completa solo al abrirla, junto con estado financiero real disponible, meses
impagos, sesiones, passkeys, reservas SQLite y timestamps de actualización.

Los estados no se infieren con lógica financiera nueva: MOROSO, CONGELADO y
DESAFILIADO provienen de `member_financial_status`; ACTIVO requiere `members.active`.
Un inactivo sin estado autoritativo se informa como no disponible. Producción
contiene realmente 1026 socios no ADMIN: 1025 activos, un MOROSO, un CONGELADO
y un DESAFILIADO; 1023 no tienen resumen financiero local sincronizado.

Las verificaciones aisladas cubren búsqueda por nombre/RUT/email, paginación,
detalle, reservas, los cuatro estados, 403 para socios y 404/405 para
POST/PUT/PATCH/DELETE. No se escribieron fuentes ni se enviaron notificaciones.

## 2026-08-27 — Dashboard ADMIN y Developer

Se creó `feat/admin-dashboard-structure`. La navegación ADMIN ahora presenta
Dashboard, Socios, Finanzas, Reservas, Contenido, Votaciones, Notificaciones,
Integraciones, Seguridad, Auditoría, Sistema y Developer. Solo Dashboard y
Developer tienen funcionalidad: Dashboard es de solo lectura y usa datos reales
resumidos; Developer contiene el Control Center anterior sin ampliar capacidades.

Se agregó un GET ADMIN-only para el resumen y verificaciones que confirman 403
para socios, acceso ADMIN, rechazo de POST al Dashboard y conservación del
overview usado por Developer. `npm run check`, `npm run staticcheck` y
`npm run selfcheck` aprobaron; este último se ejecutó con Node 22 en un contenedor
efímero sin red ni mounts productivos. No hubo despliegue ni acceso de escritura
a datos o integraciones externas.

## 2026-08-27 00:24 UTC

### Trabajo realizado

Se normalizó el versionado documental y de manifiestos en `0.6.15`. Se creó
`compose.yaml` a partir de la inspección del contenedor real, fijando imagen por
tag y digest, volumen externo, red, puerto y mounts actuales. La definición no
fue aplicada.

El antiguo `docker-compose.yml` v0.6.4 se archivó como documentación histórica.
No se modificaron `.env`, dependencias, Docker ni datos persistentes.

### Validaciones

- `npm run check` aprobó para backend y PWA.
- `docker compose -f compose.yaml config -q` aprobó sin aplicar cambios.
- Las dependencias instaladas y el lockfile, excluyendo solo la versión raíz,
  conservaron exactamente la misma huella.
- El único cambio en `public/app.js` fue el fallback visible `0.6.2` → `0.6.15`.
- Las 84 variables declaradas por Compose coinciden con los valores del contenedor.
- Imagen, restart policy, red, usuario, working directory, comando, puerto y mounts
  coinciden semánticamente con producción.
- El contenedor conservó ID, imagen, estado y hora de inicio; `/api/health` respondió
  correctamente en `0.6.15`.
- `.env`, Docker y runtime permanecieron sin cambios.

## 2026-08-27 00:18 UTC

### Trabajo realizado

Se consolidó el contexto documental en `/home/casa/mi-aspch-source`. Esta ruta es
la única fuente de código; `.ai/` dentro de ella es el contexto canónico.
`/mnt/MediaCenter/aspch` queda como legado/runtime y no debe usarse para builds.

Se respaldó la documentación afectada antes de editarla y se trasladaron los
documentos históricos fuera de la raíz. No se modificaron código, `.env`, Docker,
SQLite, fotos, backups ni servicios.

### Validaciones

- La huella del código y `.env` no cambió.
- `npm run check` aprobó.
- El contenedor conservó ID, imagen, configuración, mounts y hora de inicio.
- `/api/health` respondió correctamente con versión `0.6.15`.
- `.ai/` contiene únicamente Markdown y no contiene patrones de credenciales.

## 2026-08-23 16:15 UTC

### Trabajo realizado

Se inspeccionó la antigua ruta `/mnt/MediaCenter/aspch` y se incorporó allí la estructura inicial de contexto persistente `.ai/` junto con `AGENTS.md`. Esta entrada es histórica; desde el 2026-08-27 el contexto canónico vive en `/home/casa/mi-aspch-source/.ai/`.

### Archivos modificados

Se crearon `AGENTS.md` y los siete archivos canónicos bajo `.ai/`.

### Validaciones

- Contenedor `mi-aspch`: `running`, `healthy`.
- `npm run check` dentro del contenedor: aprobado.
- Versión detectada entonces: 0.6.1.
- No existía `.git` en la antigua ruta inspeccionada.

### Pendiente

Configurar Google Drive mediante OAuth y decidir el repositorio Git privado.

### Notas para ChatGPT

La configuración actual tiene Google habilitado. No se copiaron ni inspeccionaron valores de credenciales. El endpoint productivo configurado usa actualmente un túnel temporal; el dominio final documentado es `app.aspch.org`.

## 2026-08-27 — Retiro de accesos alternativos

En `fix/remove-presentation-login` se retiraron frontend, backend, sembrado,
flags y helpers asociados a accesos demo, presentación, RUT directo y
correo-only. El OTP deja de exponerse por API. Se agregó un self-check HTTP
aislado que confirma 404 sin sesión en rutas antiguas y valida RUT+OTP, PIN y
ADMIN. Passkeys/WebAuthn no se modificó. No hubo despliegue ni cambios de datos.

## 2026-08-27 — Release 0.6.16

El cambio de seguridad fue integrado en `main` y versionado como `0.6.16` sin
modificaciones funcionales adicionales. Se actualizaron backend, PWA, caché,
metadatos npm, pruebas y Compose. La imagen no fue construida ni desplegada;
producción continúa en `0.6.15` y el digest de `0.6.16` queda pendiente.
## 2026-09-02 — Acceso dual de Informática en el enlace público

Se incorporó `/informatica` al mismo origen público de Mi ASPCH, sin crear una
autenticación alternativa: reutiliza el login ADMIN, cookie HttpOnly y controles
de autorización existentes. La portada ofrece `Acceso Informática` y, una vez
autenticado, ambas vistas permiten alternar entre `Mi ASPCH` y `Panel
Informática` sin cerrar sesión.

La cuenta ADMIN recibe las capacidades visibles del Directorio mediante una
regla explícita de rol, sin persistirla en la nómina ni impersonar a otra
persona. El panel conserva escritorio ancho desde 901 px y habilita navegación
móvil por métricas/secciones en Safari. El hostname y el proceso Cloudflare no
se modifican. La detección de la ruta ADMIN vive en `app.js`, no en JavaScript
inline, porque la CSP de producción admite únicamente scripts del mismo origen.

## 2026-09-02 — Cierre y validación final de acceso dual Informática

Se completó la verificación integral en producción y pruebas automatizadas:
- Se protegió `setLoading` contra elementos nulos (`if(!el)return;`) para evitar
  errores de `classList` cuando `e.currentTarget` se limpia al completar eventos
  asíncronos en navegadores reales.
- Se actualizaron los hashes de cache-busting: `app.js` (`b3753bcd3c83dd54`),
  alineado en `index.html`, `admin.html` y caché Service Worker
  `mi-aspch-v0.6.16-informatica-b3753bcd`.
- Smoke móvil Safari/iPhone (390x844) validado sin errores: Acceso Informática,
  RUT oculto, PIN password/numérico, ancho 390 px, sin overflowX, bandera
  adminPanelFlag=true.
- Flujo completo verificado vía Playwright: login Informática → Panel → Mi ASPCH →
  Panel, alternancia fluida de modo con la misma sesión ADMIN y sin deslogueo.
- Batería de pruebas: `git diff --check`, `npm run check`, `self_check_v0.6.0_static.mjs`,
  `self_check_v0.6.0_core.mjs`, `self_check_auth.mjs` y smoke HTTP 100% aprobados.
- Se conservaron intactos el túnel Cloudflare (PID 1089525), SQLite, `.env` y sesiones.
