# Registro de decisiones

## 2026-09-03 — Preview: Push administrativo acotado y assets verificados

### Decisión

La consola ADMIN solo puede enviar plantillas Push allowlist a dos audiencias:
Directorio activo o Informática en el dispositivo actual. No acepta texto libre,
IDs arbitrarios, broadcast general ni mutaciones de negocio; cada destinatario
informa `SENT`, `FAILED` o `NO_SUBSCRIPTION` y el envío queda auditado.

Las fotos de simuladores y los recursos de emergencia/IFALPA solo se sirven si
existe un archivo local verificado dentro de `public/`. En Preview no existen
esos assets oficiales, por lo que la interfaz muestra placeholders y deja la
integración pendiente sin inventar material ni teléfonos.

### Estado

Activa solo en Preview 8086; sin promoción a producción

## 2026-09-02 — Enlace y acceso exclusivos para pruebas del Directorio

### Decisión

El enlace canónico de prueba del Directorio es
`https://reviewer-stopping-wages-roland.trycloudflare.com`, conectado a
producción `8085`. No se reinicia, recrea ni sustituye su unidad
`cloudflared-tunnel.service`, ni se levanta otro Quick Tunnel, mientras este
enlace esté vigente. Si falla, se informa antes de cualquier cambio de URL.

Toda persona presente en la nómina vigente del Directorio se mantiene activa.
Su registro usa un único OTP enviado exclusivamente al correo ingresado en
pantalla; el correo histórico no recibe ni autoriza nada. Al validar se adopta
el correo ingresado localmente y se intenta sincronizar BD SOCIOS.

Los teléfonos editados desde Mi ASPCH se escriben como número nacional de
dígitos, sin signo `+` ni prefijo país `56`, para respetar el formato de BD
SOCIOS.

Los recordatorios de estacionamiento deben formular una pregunta explícita y
ofrecer `Sí, sigo aquí` y `No, ya desocupé`. Como iOS entrega Web Push pero no
muestra sus acciones personalizadas, al tocar la notificación se abre una
confirmación equivalente dentro de la PWA. Confirmar que sigue estacionado se
audita; confirmar que desocupó libera el cupo por el flujo existente.

Los metadatos instalables y las notificaciones usan los iconos ASPCH cuadrados.
Nunca se declara el logotipo horizontal como icono de aplicación.

En el primer ingreso de cada integrante del Directorio y en cada dispositivo se
debe pedir consentimiento explícito para Web Push mediante `Sí, activar` o
`No, gracias`. La opción afirmativa solicita el permiso nativo y crea la
suscripción; la negativa no deja una suscripción activa. La elección se puede
cambiar posteriormente desde Perfil.

Informática utiliza el mismo origen público y cookie de sesión que Mi ASPCH. La
ruta `/informatica` sirve el panel ADMIN y ambas vistas incorporan un selector
para alternar entre la experiencia del asociado y las métricas. La cuenta ADMIN
recibe las capacidades visibles del Directorio por autorización de rol, nunca
mediante impersonación o modificación de la nómina. El panel debe ser navegable
en Safari móvil además de mantener su disposición ancha en escritorio. La ruta
se detecta en el bundle externo; no se depende de scripts inline bloqueados por
la CSP de producción.

Face ID/huella se ofrece mediante Passkeys/WebAuthn y utiliza
`reviewer-stopping-wages-roland.trycloudflare.com` como RP ID y origen. Ese
hostname no se cambia durante la prueba: las credenciales WebAuthn pertenecen al
dominio donde fueron creadas y deben volver a registrarse si el dominio cambia.

### Razón

Los directores deben probar la misma app productiva mediante una URL conocida,
sin depender del correo histórico ni quedar inactivos por una sincronización de
socios anterior.

### Restricción operativa

La URL actual pertenece a un Quick Tunnel y solo puede conservarse mientras
permanezca vivo ese proceso. Hacerla durable tras reinicios exige una migración
separada y autorizada a un hostname administrado; ningún agente debe ocultar
esa limitación generando otra URL.

### Estado

Activa

## 2026-09-02 — `hidden` gobierna las pantallas de autenticación

### Decisión

El marco visual desktop puede forzar `display:flex` únicamente sobre
`#auth-screen`, `#lock-screen` y `.app-shell` cuando no tengan la clase
`hidden`. Ninguna regla responsive puede anular la visibilidad controlada por
el flujo JavaScript.

### Razón

Forzar display en los tres contenedores impedía que un OTP verificado avanzara
visualmente a la pantalla de PIN en viewport desktop, aunque el backend ya
hubiera creado la sesión correctamente.

### Estado

Activa en el código compartido y en producción. Preview la adoptará en su
próxima reconstrucción, ya que no monta `public/` desde el host.

## 2026-09-01 — JavaScript de Preview no usa caché HTTP persistente

### Decisión

Cuando `PREVIEW_MODE=true`, los assets JavaScript se responden con
`Cache-Control: no-store`. El HTML referencia `app.js` mediante el SHA-256 del
bundle y todo cambio incompatible rota también el namespace del Service Worker.

### Razón

El laboratorio cambia de sesión y recarga el iframe, pero una recarga no basta
si el navegador conserva durante una hora una URL estable cuyo bundle ya no
contiene los renderizadores actuales.

### Estado

Activa solo en Preview 8086; producción 8085 intacta

## 2026-09-01 — El laboratorio representa permisos, no acceso ficticio

### Decisión

Preview usa las mismas reglas funcionales del frontend/backend para representar
MOROSO y MODO SIMPLE. DESAFILIADO obtiene una sesión sintética únicamente para
renderizar una pantalla terminal sin navegación. INFORMÁTICA abre el Control
Informática real en `admin.html` sobre el mismo origen 8086.

Los meses pendientes pueden mostrarse cuando existen en la fuente financiera;
un monto solo se muestra con `amountDueAvailable=true`. El preset MOROSO no
declara evidencia de monto y por eso nunca fabrica un total.

### Estado

Activa solo en Preview 8086; producción 8085 intacta

## 2026-09-01 — Impersonación sintética exclusiva de Preview

### Decisión

El laboratorio 8086 crea sesiones backend normales mediante
`POST /api/preview/impersonate`, con cookie propia y miembros sintéticos
persistidos solo en la SQLite Preview. El laboratorio muestra un selector y un
único teléfono autenticado.

### Consecuencias

- La ruta responde 404 si `PREVIEW_MODE=false`.
- No se reutilizan socios reales para representar ni cambiar estados.
- DESAFILIADO tiene una excepción de lectura de sesión limitada al miembro
  sintético `@preview.invalid`; producción continúa rechazando inactivos.
- El estado financiero, modo simple, Directorio y ADMIN se evalúan mediante las
  mismas rutas y reglas de la app, sin mocks en el navegador.

### Estado

Activa en Preview 8086; producción 8085 intacta

## 2026-08-31 — Resumen dinámico compacto en Inicio

- **Decisión:** Inicio de Mi ASPCH contiene estrictamente el flujo de 7 elementos: Saludo, Credencial vigente, Próximo simulador (condicional), Estacionamiento activo (condicional), Aviso ASPCH (condicional), Estado mensualidad compacto (con discriminación LATAM / resto) y acceso discreto a Contactar ASPCH al final.
- **Razón:** Mantener la experiencia mobile limpia, concisa y sin elementos de relleno, dejando catálogos y servicios secundarios en el menú desplegable.
- **Impacto:** Menor sobrecarga cognitiva en mobile; cero peticiones redundantes en Inicio.

## 2026-08-31 — Servicios visibles son una preferencia por socio

### Decisión

Persistir en SQLite únicamente la selección visual de accesos del socio. La
selección puede ocultar servicios en Inicio/Más servicios, pero no altera roles,
permisos, membresía ni capacidades backend. Credencial y Perfil son fijos.

### Consecuencias

- La primera configuración puede omitirse y en ese caso todo continúa visible.
- Reservas agrupa Simuladores y Sala de estudios bajo una única entrada.
- Perfil permite cambiar posteriormente la selección.

### Estado

Activa en Preview 8086; producción 8085 intacta

## 2026-08-31 — Logo institucional único

### Decisión

Usar `public/logo-aspch-original.png` sin redibujar, recolorear, filtrar ni
generar variantes. Login y desbloqueo lo muestran directamente en light mode;
dark mode puede colocar una placa blanca sutil detrás para asegurar contraste.
El hero de Inicio no muestra logo y conserva solo el saludo personal.

### Consecuencias

- HTML, frontend, manifiesto, favicon y notificaciones apuntan al mismo PNG.
- Una prueba estática fija su SHA-256 y rechaza referencias a assets anteriores.
- El cambio se despliega únicamente en Preview 8086.

### Estado

Activa

## 2026-08-31 — Preview persistente y aislado

### Decisión

Operar Preview mediante `compose.preview.yaml`, separado de producción, con
listener exclusivo en la IP Tailscale `100.109.170.84:8086`, SQLite propia y
snapshot controlado desde el volumen productivo montado solo lectura en un
servicio de mantenimiento sin red.

`PREVIEW_MODE=true` es una barrera obligatoria de código que fuerza Gmail,
Push, Calendar WRITE y Google Sheets WRITE a OFF, independientemente del `.env`.

### Consecuencias

- El servicio reinicia automáticamente, tiene healthcheck y logs rotados.
- Producción 8085 y su volumen no se montan en el proceso de aplicación Preview.
- BD SOCIOS, Calendar y Sheets pueden leerse; XLSM y SIPA se montan read-only.
- El snapshot elimina sesiones, OTP, passkeys, suscripciones Push y PIN reales;
  solo crea la credencial administrativa solicitada para Preview.

### Estado

Activa

## 2026-08-31 — Membresía XLSM se aplica solo mediante plan autorizado

### Decisión

Separar lectura, planificación y aplicación. Solo ACTIVO, MOROSO, CONGELADO,
DESAFILIADO, JUBILADO y DIRECTORIO explícitos pueden generar candidatos. Vacíos,
texto libre, RUT inválidos, duplicados y matches no 1:1 se omiten sin escritura.

DESAFILIADO desactiva acceso y registra propiedad financiera. Los demás estados
solo revierten una desactivación cuando esa propiedad ya estaba registrada; una
baja independiente se conserva. DIRECTORIO no modifica `is_board` y ningún
estado modifica identidad o datos personales.

### Consecuencias

- MOROSO no escala por cantidad de meses.
- El monto se toma solo de `Total` positivo directo; evidencia parcial no se
  presenta como deuda total disponible.
- El aplicador requiere `planId` exacto, confirmación explícita, precondiciones
  SQLite sin cambios y una transacción completa.
- Cada cambio de estado tendrá auditoría por socio y por corrida.
- No existe conexión runtime ni aplicación automática hasta una autorización
  separada posterior al dry-run.

### Estado

Motor y dry-run real preparados en el worktree; sin aplicación, commit, merge ni despliegue

## 2026-08-28 — Seguridad y auditoría muestran solo evidencia persistida

### Decisión

Construir Notificaciones, Seguridad y Auditoría desde tablas locales existentes.
La auditoría transforma `detail_json` mediante una lista permitida de campos
operativos; Seguridad marca como no disponibles los intentos y bloqueos que hoy
no se persisten. No se crea una limpieza Push manual: los endpoints 404/410 se
eliminan únicamente en el flujo de entrega existente.

### Consecuencias

- No se exponen OTP, hashes, salts, tokens, endpoints Push, claves ni payloads.
- Cerrar sesiones, revocar passkeys, resetear PIN y regenerar OTP reutilizan las
  acciones ADMIN existentes con confirmación y auditoría exitosa.
- Gmail OTP deshabilitado mantiene la regeneración inactiva y no crea códigos.
- No se agregan probes, envíos masivos ni integraciones externas.

### Estado

Preparada en el worktree de `main`; sin commit, merge ni despliegue

## 2026-08-28 — Módulos operativos usan evidencia local y estados explícitos

### Decisión

Reservas, Integraciones y Sistema se alimentan únicamente de SQLite, runtime y
configuración ya cargada. Integraciones no ejecuta probes al abrir; simuladores y
contenedor se declaran no disponibles cuando no existe una fuente local segura.

### Consecuencias

- Reservas reutiliza las acciones ADMIN confirmadas y auditadas ya existentes.
- Integraciones usa `OK / ADVERTENCIA / DESHABILITADO / ERROR` y explica impacto.
- Sistema no expone shell, SQL libre, filesystem ni edición de `.env`.
- No se añaden escrituras externas, sincronizaciones ni capacidades Developer.

### Estado

Preparada en el worktree de `main`; sin commit, merge ni despliegue

## 2026-08-28 — Control Maestro separa diagnóstico y acciones operativas

### Decisión

Usar el XLSM solo como fuente diagnóstica read-only y mantener el estado aplicado
en SQLite como una evidencia separada. No ofrecer cambios manuales de membresía.
Limitar las acciones de ficha a reservas y credenciales/sesiones predefinidas,
con confirmación, autorización ADMIN y auditoría.

### Consecuencias

- Las rutas y la UI de carga XLSM quedan deshabilitadas; no hay persistencia
  automática XLSM → SQLite ni escrituras Google.
- MEMBER recibe 403 en toda ruta `/api/admin/` antes del desbloqueo.
- La ficha no entrega hashes, PIN, códigos OTP, tokens ni credenciales WebAuthn.
- Liberar estacionamiento y cancelar sala cambian únicamente la reserva local
  activa a `CANCELLED`, registran fecha y dejan auditoría.
- Dashboard permanece exclusivamente de lectura; Developer sigue separado.

### Estado

Preparada en el worktree de `main`; sin commit, merge ni despliegue

## 2026-08-28 — Parser financiero independiente y sin autoridad de escritura

### Decisión

Mantener la lectura del XLSM 2026 en un módulo separado del importador vigente.
Solo se reconocen estados explícitos, los RUT requieren DV válido y único, y todo
comentario vacío o libre queda como `NO_CLASIFICADO` conservando su texto.

Los meses impagos y montos se exponen como evidencias independientes: un monto
solo existe cuando el bloque mensual contiene un `Total` numérico positivo. No
se permite promover `MOROSO` a `DESAFILIADO` ni inferir deuda para congelados o
desafiliados.

### Consecuencias

- El módulo no importa SQLite ni Google y no modifica identidad o estado.
- El CLI usa una copia SQLite inmutable, consulta únicamente `SELECT` y comprueba
  huellas antes/después.
- La comparación 62/47 anterior queda disponible solo como auditoría histórica;
  el matching seguro usa exclusivamente RUT válido y único.
- No hay integración con servidor, frontend o sincronizador productivo.

### Estado

Preparada para auditoría AGY; sin commit, merge ni despliegue

## 2026-08-27 — Socios ADMIN usa detalle bajo demanda

### Decisión

Exponer Socios mediante dos GET ADMIN-only: un listado paginado con RUT y email
enmascarados, y una ficha completa cargada únicamente cuando el ADMIN la abre.
Usar el SQLite sincronizado existente sin leer ni escribir fuentes externas en
cada consulta.

### Consecuencias

- MOROSO, CONGELADO y DESAFILIADO proceden exclusivamente del estado financiero
  existente; ACTIVO exige el indicador real `members.active`.
- Un inactivo sin estado financiero autoritativo se muestra como no disponible.
- Las reservas mostradas se limitan a estacionamiento y sala de estudios activas
  en SQLite; los turnos de simulador no se presentan sin una fuente local fiable.
- No se incorporan edición, revocación, sincronización ni notificaciones.

### Estado

Preparada en `feat/admin-members-readonly`; no desplegada

## 2026-08-27 — Primera separación del Control Informática

### Decisión

Separar la navegación ADMIN en un Dashboard exclusivamente de lectura y un
Developer que conserva el Control Center existente. Mantener por ahora el mismo
rol y autorización backend, y representar las demás áreas objetivo únicamente
como placeholders explícitos.

### Consecuencias

- Dashboard consume un GET bajo `/api/admin/` y no contiene botones ni rutas de
  mutación.
- Developer no incorpora capacidades nuevas ni expone shell, SQL libre,
  secretos, `.env`, comandos o filesystem.
- La separación de permisos queda fuera de esta primera etapa.
- Producción no se despliega como parte de esta decisión.

### Estado

Preparada en `feat/admin-dashboard-structure`

## 2026-08-27 — Cierre de rotación de credencial Google

### Decisión

Dar por cerrada la rotación de la clave USER_MANAGED de la Service Account de
Mi ASPCH. La credencial nueva quedó instalada y validada contra las fuentes
reales antes de retirar definitivamente la clave anterior.

### Consecuencias

- Producción autentica con la clave nueva y la clave anterior ya no está
  publicada por Google.
- Se verificaron BD SOCIOS, el Sheet financiero, estacionamientos y Calendar
  READ reales, sin errores OAuth ni de Google API.
- Las 109 sesiones activas y las 2 passkeys permanecieron preservadas.
- Gmail, OTP y notificaciones Gmail continúan desactivados.
- La ausencia previa del XLSM financiero local permanece como una condición
  independiente de esta rotación; el Sheet financiero real continúa accesible.

### Estado

Completada

## 2026-08-27 — Release 0.6.16 sin despliegue

### Decisión

Publicar como `0.6.16` el código de `main` que elimina los accesos alternativos,
sin añadir cambios funcionales adicionales. Preparar Compose con la etiqueta
`mi-aspch:v0.6.16` sin reutilizar el digest de producción `0.6.15`.

### Consecuencias

- Backend, PWA, caché, manifiestos npm y pruebas reportan `0.6.16`.
- El digest quedará pendiente hasta construir la imagen en una tarea autorizada.
- Producción continúa en `0.6.15` y no se aplica Compose durante esta release.

### Estado

Activa

## 2026-08-27 — Un único flujo de autenticación para socios

### Decisión

Todo socio debe iniciar sesión mediante RUT y OTP. El acceso posterior conserva
PIN y Passkeys/WebAuthn. ADMIN conserva exclusivamente su login normal con PIN.

Se retiran perfiles de presentación o demo, acceso directo por RUT, excepciones
por correo, exposición de OTP y cualquier creación de sesión equivalente.

### Consecuencias

- Las rutas de autenticación desconocidas responden 404 antes de consultar o
  crear sesiones.
- Las variables antiguas dejan de afectar al código, aunque permanezcan en el
  `.env` productivo hasta una limpieza separada.
- No se eliminan usuarios, sesiones ni passkeys ya persistidos durante este
  cambio de código.

### Estado

Integrada en `main` para `0.6.16`; no desplegada

## 2026-08-27 — Definición canónica de despliegue v0.6.15

### Decisión

Usar únicamente `compose.yaml` para representar el despliegue. La imagen queda
fijada como `mi-aspch:v0.6.15` junto con el digest de la imagen productiva actual
y `pull_policy: never`.

El volumen se declara externo con el nombre exacto `aspch_mi_aspch_data`; el
puerto, la red, el `.env` y los bind mounts reflejan el contenedor inspeccionado.

### Consecuencias

- No se creará implícitamente un volumen vacío por cambiar el proyecto Compose.
- La definición no se aplica automáticamente y requiere autorización separada.
- El healthcheck quedará efectivo en una recreación futura; el contenedor actual
  permanece intacto y aún no lo tiene configurado.

### Estado

Activa

## 2026-08-27 — Fuente única de verdad

### Decisión

Usar `/home/casa/mi-aspch-source` como única fuente de código y documentación
vigente, y su subcarpeta `.ai/` como única fuente de contexto operativo y
decisiones para agentes.

`/mnt/MediaCenter/aspch` queda clasificado como legado/runtime. No es fuente de
código ni contexto de build.

### Consecuencias

- Los cambios de aplicación y documentación se preparan únicamente en la ruta oficial.
- Los archivos históricos se conservan bajo `docs/history/` y no son normativos.
- Runtime, SQLite, fotos y backups siguen fuera del árbol de código.

### Estado

Activa

## 2026-08-23 — Contexto compartido separado del código

### Decisión

Usar `.ai/` como fuente de verdad del contexto operativo y decisiones, sincronizando únicamente esos archivos con Google Drive. Git será la fuente de verdad versionada del código cuando el repositorio sea inicializado o enlazado explícitamente.

### Motivo

Permitir continuidad entre Codex, ChatGPT y el usuario sin copiar el código ni secretos a Drive.

### Consecuencias

Codex debe leer `/home/casa/mi-aspch-source/.ai/` antes de trabajo significativo y actualizarlo después. El sistema de sincronización aplica lista blanca y conserva conflictos.

### Estado

Actualizada por la decisión de fuente única del 2026-08-27

## 2026-08-23 — Preservar datos y credenciales durante despliegues

### Decisión

No reemplazar ni eliminar `.env`, SQLite, PIN, sesiones, retratos ni el volumen Docker persistente durante cambios o actualizaciones.

### Motivo

Son datos operativos existentes y parte de la continuidad del servicio.

### Consecuencias

Todo despliegue debe inspeccionar mounts y configuración real, respaldar lo necesario y validar el contenedor después del cambio.

### Estado

Activa
