# Estado actual

Última actualización: 2026-09-01 UTC

## Invalidación real del bundle Preview

- El `ReferenceError: renderProfile/renderMembership is not defined` fue
  reproducido en el origen 8086 con el bundle anterior retenido por caché.
- Las funciones reales estaban correctamente en scope global en el source y en
  la imagen nueva; el navegador podía conservar la URL fija de `app.js` durante
  una hora y el Service Worker mantenía el mismo namespace de caché.
- Preview ahora publica JavaScript con `Cache-Control: no-store`, `index.html` y
  `admin.html` apuntan a `app.js` mediante su SHA-256 y el caché PWA fue rotado.
- Playwright navegó por los botones reales a Perfil y Membresía y verificó
  `typeof renderProfile/renderMembership === 'function'` sin ReferenceError.

## Perfiles reales y vistas estables en Preview 8086

- Se restauraron las implementaciones reales separadas de Perfil, Membresía y
  Seguridad, además de Dashboard/Socios y sus helpers; ya no quedan rutas que
  llamen renderizadores eliminados.
- WhatsApp flotante y su asset fueron retirados de la app mobile y ADMIN.
- MOROSO entra a Inicio con alerta de cuotas, sin total cuando la fuente Preview
  no aporta evidencia de monto, y queda bloqueado en Estacionamiento,
  Simuladores y Sala de estudios con una explicación uniforme.
- MODO SIMPLE muestra solo Credencial, Estacionamiento y Contacto.
- DESAFILIADO conserva `active=0` y muestra exclusivamente `Membresía no activa`.
- INFORMÁTICA usa `informatica@aspch.org`, rol ADMIN, `admin.html` same-origin y
  Control Informática web a ancho completo; al volver a MEMBER reaparece el
  teléfono mobile.
- Playwright recorrió los nueve perfiles, Perfil/Membresía/Seguridad y la
  transición MEMBER ↔ ADMIN sin errores JS graves. Preview está healthy y 8085
  conserva su contenedor, imagen, inicio y cero reinicios.

## Laboratorio autenticado por perfiles en Preview 8086

- El laboratorio usa selector izquierdo y un solo teléfono mobile en Inicio.
- `POST /api/preview/impersonate` crea una sesión normal en la SQLite Preview,
  rota `mi_aspch_preview_session` y solo existe con `PREVIEW_MODE=true`.
- Los perfiles MEMBER son sintéticos `@preview.invalid`; INFORMÁTICA reutiliza
  solo en SQLite Preview el identificador administrativo solicitado. No se
  cambian estados de cuentas ni del snapshot productivo.
- DESAFILIADO puede visualizar la interfaz bloqueada únicamente mediante su
  sesión sintética Preview; la regla productiva de acceso de inactivos no cambia.
- Se retiraron el interceptor de fetch, el autologin por `?sim=`, el fallback
  ADMIN global y la anulación especial del Service Worker.
- Los nueve perfiles, la secuencia ACTIVO → MOROSO → JUBILADO, los accesos de
  reservas/mensualidad y el rol ADMIN Preview aprobaron en 8086. Producción 8085
  conserva contenedor, imagen, inicio, cero reinicios y health healthy.

## Resumen dinámico en Inicio de Mi ASPCH

- Inicio presenta exclusivamente el flujo dinámico compacto:
  1. Saludo compacto (hero con saludo del socio).
  2. Credencial vigente (abre Credencial digital).
  3. Próximo simulador (solo si existe -> abre Reservas > Simuladores).
  4. Estacionamiento activo (solo si existe -> abre Estacionamientos).
  5. Aviso ASPCH importante (solo si existe).
  6. Estado mensualidad compacto (LATAM Airlines/Grupo/Cargo muestra "Descuento por planilla"; otros muestran estado correspondiente sin sobrecarga -> abre Mensualidad).
  7. Contactar ASPCH (acceso discreto al final -> abre Contacto).
- No se muestran tarjetas de relleno ni catálogos innecesarios; Biblioteca, Convenios, Noticias, Sala, etc. permanecen en el menú desplegable.
- Preview 8086 actualizado y healthy; producción 8085 intacta y sincronizado con MediaCenter.

## UX de servicios en Preview

- Login light muestra el PNG institucional original sin filtros sobre fondo
  blanco y con textos de alto contraste; dark conserva su presentación previa.
- Inicio expone una sola entrada `Reservas`, cuya vista reúne Simuladores y Sala
  de estudios sin duplicarlos en el inicio.
- Cada socio puede guardar en SQLite qué servicios desea ver; Credencial y
  Perfil permanecen siempre visibles y la preferencia no cambia permisos.
- La configuración aparece tras el primer registro y puede omitirse o editarse
  posteriormente desde Perfil.
- Preview 8086 fue reconstruido y validado en 390x844; producción 8085 no fue
  modificada.

## Logo institucional oficial en Preview

- `public/logo-aspch-original.png` es una copia byte a byte del PNG oficial
  entregado, con SHA-256 `e0512f1fd75c2f5d74c566268c9deb16459b4b596c9460e0befff8a59063282f`.
- Login y desbloqueo usan exclusivamente ese archivo, centrado, responsive y
  sin filtros; dark mode añade solo una placa clara sutil detrás.
- Inicio conserva únicamente el saludo `Hola, Informática`, sin logo en el hero.
- Las referencias frontend/PWA a logos e iconos anteriores fueron retiradas.
- Preview 8086 fue reconstruido y validado healthy; producción 8085 conserva
  contenedor, imagen, inicio y cero reinicios.

## Sincronización segura XLSM → SQLite preparada

- `lib/financial-sync.mjs` construye un plan determinista exclusivamente con
  matches 1:1 por RUT válido y estados explícitos. El aplicador exige el
  `planId` exacto y una confirmación separada; no está conectado a endpoints,
  jobs ni schedulers.
- El sincronizador legado quedó deshabilitado porque modificaba identidad,
  infería deuda y escalaba MOROSO a DESAFILIADO.
- La política no modifica datos personales ni `is_board`. DESAFILIADO es el
  único estado que puede bajar `members.active`; una corrección solo reactiva
  bajas cuya propiedad esté marcada como financiera.
- Cada futura modificación real queda en tablas de corrida/cambio y en
  `audit_log`; los estados omitidos no producen escrituras.
- Dry-run real del 2026-08-31: 1.041 filas, 1.026 socios, 977 matches seguros,
  182 cambios aplicables, 49 socios sin match seguro, 3 RUT fuente inválidos,
  8 RUT SQLite inválidos y 843 filas `NO_CLASIFICADO`.
- Los 182 cambios propuestos son 11 CONGELADO, 22 DESAFILIADO, 29 MOROSO,
  113 JUBILADO y 7 DIRECTORIO. No hay ACTIVO explícitos en el XLSM actual.
- El reporte protegido está fuera de Git en `financial-source-test`; SQLite se
  leyó desde un backup coherente con `readonly`, `query_only` e `immutable` y
  conservó la misma huella.
- Producción, BD SOCIOS, Google, Gmail, Push y Calendar no fueron modificados.

## Fuentes canónicas

- Código: `/home/casa/mi-aspch-source`.
- Contexto IA: `/home/casa/mi-aspch-source/.ai`.
- Runtime: volumen Docker `aspch_mi_aspch_data` y mounts bajo `/mnt/MediaCenter/aspch`.

La ruta `/mnt/MediaCenter/aspch` es legado/runtime y no es fuente de código.

## Producción

- El contenedor `mi-aspch` está en ejecución y publica el puerto host 8085.
- Producción ejecuta Mi ASPCH `0.6.16` con healthcheck activo (`healthy`).
- `/test-notificaciones.html` está retirado y redirige a `/`; el caché PWA
  anterior se elimina al activar el Service Worker vigente.
- El código del host no está bind-mounted en el contenedor.
- SQLite, sesiones, passkeys y reservas permanecen en el volumen Docker `aspch_mi_aspch_data`.
- Retratos SIPA y fotos de perfil permanecen bajo `/mnt/MediaCenter/aspch`.

## Estado documental

- `.ai/` fue consolidado en la carpeta oficial de código.
- La documentación histórica fue separada bajo `docs/history/`.
- Git está inicializado en `main` con tags `v0.6.15-baseline` y `v0.6.16`.

## Release 0.6.16 desplegada

- `main` incluye la eliminación de accesos de presentación, demo, RUT directo,
  correo-only y exposición de OTP.
- El login normal RUT+OTP, PIN, Passkeys/WebAuthn y ADMIN permanecen activos.
- La versión de código, PWA y runtime productivo es `0.6.16`.
- Las variables obsoletas que aún puedan existir en `.env` se ignoran en runtime.
  Su limpieza requiere una tarea posterior y no debe exponer valores.

## Definición de despliegue

- `compose.yaml` es la única definición canónica y está aplicada en producción.
- Utiliza la imagen local inmutable `mi-aspch:v0.6.16-test-panel-retired` con
  digest SHA-256 fijado; deriva de la imagen `v0.6.16` y solo reemplaza
  `server.mjs` y `public/sw.js` para este hotfix.
- Declara `pull_policy: never`, red `bridge` y puerto `0.0.0.0:8085:8080`.
- Reutiliza como externo el volumen persistente `aspch_mi_aspch_data`.
- Conserva los tres bind mounts productivos y carga el `.env` vigente.
- Incluye healthcheck funcional sobre `/api/health`.

## Problemas conocidos

- Queda pendiente retirar en una tarea autorizada las variables de autenticación
  obsoletas del `.env` productivo, sin mostrar sus valores.

## Lectura financiera segura en preparación

- `lib/financial-reader.mjs` implementa un parser independiente del sincronizador
  existente; el Control Informática lo consume solo para diagnóstico read-only.
- El parser reconoce únicamente estados explícitos, valida el dígito verificador
  del RUT y conserva vacíos/textos libres como `NO_CLASIFICADO`.
- `tools/financial_dry_run.mjs` acepta una copia SQLite inmutable de solo lectura,
  compara huellas antes/después y genera un reporte JSON protegido fuera de Git.
- El dry-run real del XLSM 2026 produjo 977 matches seguros sobre 1.026 socios;
  la comparación histórica sin validar DV conserva 62/47 discrepancias.
- Las rutas de carga XLSM están cerradas y la lectura no persiste en SQLite,
  Google, identidades ni estados de membresía.

## Control Informática en preparación

- El worktree de `main` contiene la primera versión útil pendiente de revisión,
  sin commit, merge ni despliegue.
- Dashboard usa un GET ADMIN-only con salud, actividad, reservas, backups,
  SQLite, integraciones, alertas, errores y auditoría resumida; no escribe.
- Socios ofrece búsqueda paginada minimizada y ficha bajo demanda que compara
  XLSM, estado local aplicado y BD SOCIOS sin inferir ni cambiar membresía.
- La ficha permite refrescar diagnóstico, liberar estacionamiento, cancelar
  sala, cerrar sesiones, revocar passkeys, resetear PIN y generar OTP solo si su
  entrega está habilitada; todas las acciones completadas quedan auditadas.
- Backend confirma 403 para MEMBER, no expone PIN/OTP/credenciales y mantiene el
  XLSM exclusivamente en lectura diagnóstica.
- La batería Node 22 (`check`, `selfcheck`, `staticcheck`) y `git diff --check`
  aprueba en un contenedor efímero sin red ni mounts productivos.
- El Control Center existente conserva sus capacidades bajo Developer, salvo la
  carga XLSM retirada para mantener la garantía read-only.
- Reservas ya consolida estacionamientos, sala, espera y auditoría desde SQLite;
  las acciones reutilizan los controles ADMIN locales existentes.
- Integraciones muestra XLSM, BD SOCIOS, Sheets, Calendar, Gmail OTP y Push con
  estados controlados, última evidencia local e impacto, sin probes de red.
- Sistema muestra runtime, Node, `quick_check`, tamaño, tablas, backups y fallos;
  el estado del contenedor queda no disponible mientras no exista fuente segura.
- Notificaciones resume Push y Gmail OTP solo desde evidencia local, sin exponer
  códigos, tokens, endpoints, claves ni payloads.
- Seguridad resume sesiones, passkeys y PIN; declara explícitamente que intentos
  y bloqueos de cuenta no tienen fuente persistida, y reutiliza acciones ADMIN.
- Auditoría ofrece filtros y filas sanitizadas de `audit_log` sin `detail_json`.
- Finanzas, Contenido y Votaciones permanecen como estructura pendiente.
- El preview persistente `100.109.170.84:8086` corre en un Compose separado,
  enlazado solo a Tailscale, con healthcheck, reinicio automático y logs
  rotados. Usa una SQLite propia creada por snapshot read-only y sanitizado de
  producción; XLSM y fuentes SIPA se montan read-only.
- `PREVIEW_MODE` bloquea por código Sheets WRITE, Calendar WRITE, Gmail y Push,
  además de los flags de entorno. Producción 8085 permanece intacta.
- El teléfono del laboratorio completa el arranque autenticado: cada selección
  rota la sesión Preview, recarga el iframe 8086 y abre Inicio sin login ni PIN.
- La prueba Playwright verifica ACTIVO, MOROSO, JUBILADO, MODO SIMPLE e
  INFORMÁTICA contra `/api/me` dentro del iframe y confirma `#auth-screen` oculto.
- Inicio ya completa su render en Preview: el enrutador no evalúa pantallas
  ajenas antes de abrir Home y las tres fuentes secundarias tienen fallback de
  cinco segundos para impedir un “Cargando…” permanente.
- La unidad histórica `cloudflared-tunnel.service` sigue activa por falta de
  privilegios sudo, pero apunta a `localhost:8086` y no puede alcanzar el
  listener exclusivo Tailscale. Falta retirarla como endurecimiento adicional.
