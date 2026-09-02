# Project Instructions

## Fuentes de verdad

- Código oficial: `/home/casa/mi-aspch-source`.
- Contexto operativo y decisiones IA: `/home/casa/mi-aspch-source/.ai`.
- Runtime y datos actuales: volumen Docker `aspch_mi_aspch_data` y mounts bajo `/mnt/MediaCenter/aspch`.

`/mnt/MediaCenter/aspch` es una ubicación de legado/runtime. No debe usarse como
fuente de código, contexto IA canónico ni contexto de build.

## Control de versiones

- Git está inicializado en `/home/casa/mi-aspch-source`.
- Rama principal: `main`.
- Git es la fuente de verdad versionada del código.
- No reescribir historial, hacer force-push, cambiar remotes ni realizar operaciones Git destructivas sin autorización explícita.
- Los cambios importantes deben quedar en commits pequeños y verificables.

## Roles de agentes

- **ChatGPT:** arquitecto/coordinador. Define prioridades, revisa resultados y prepara instrucciones para Codex.
- **Codex:** implementador principal. Realiza normalmente los cambios de código y ejecuta pruebas.
- **Antigravity:** auditor independiente en hitos importantes. Puede aplicar cambios exclusivamente documentales cuando el usuario/ChatGPT lo solicite explícitamente, pero no debe modificar código simultáneamente con Codex.
- **Claude:** revisor de metodología y consistencia documental. Revisa `AGENTS.md` y `.ai/`; no implementa código ni toca producción.

## Regla de concurrencia

- Solo un agente puede estar modificando el proyecto a la vez.
- Antes de modificar, revisar `.ai/TASKS.md`, especialmente la sección **En curso**.
- Si existe una intervención activa incompatible, NO continuar ni modificar archivos: detenerse y reportar el conflicto.

## Reglas permanentes de producción para el Directorio

- El enlace canónico de prueba para los integrantes del Directorio es
  `https://reviewer-stopping-wages-roland.trycloudflare.com` y apunta a la app
  productiva del puerto `8085`.
- No detener, reiniciar, recrear ni sustituir `cloudflared-tunnel.service`, ni
  levantar otro Quick Tunnel para esta prueba. Mientras el enlace esté activo,
  debe conservarse exactamente. Si deja de funcionar, no publicar otra URL de
  forma silenciosa: informar el bloqueo y solicitar una migración autorizada a
  un hostname permanente.
- Todo integrante presente en la fuente vigente del Directorio debe mantenerse
  con `members.is_board=1` y `members.active=1`.
- En el registro de un integrante del Directorio se envía y exige un solo OTP,
  exclusivamente al correo que esa persona ingresa en pantalla. Nunca se envía
  ni se exige autorización al correo histórico. Tras validar, ese correo pasa a
  ser el correo local vigente y se intenta sincronizar con BD SOCIOS.
- El onboarding debe completar siempre `OTP → Crear PIN → Cuenta`. No precargar
  PIN para integrantes que aún no han realizado su alta real. Maximiliano,
  María José y Jaime conservan su estado actual salvo instrucción explícita.
- En el primer ingreso del Directorio por dispositivo, preguntar claramente si
  desea recibir notificaciones mediante opciones `Sí, activar` y `No, gracias`;
  nunca solicitar ni crear una suscripción Push sin esa decisión del usuario.
- Los teléfonos editados desde Mi ASPCH se guardan en BD SOCIOS como dígitos
  nacionales, sin `+` ni prefijo país `56` (por ejemplo, `9XXXXXXXX`).
- Face ID/huella usa Passkeys/WebAuthn y está ligado al hostname del enlace. Para
  esta prueba, `APP_ORIGIN`, `PUBLIC_APP_URL`, `WEBAUTHN_RP_ID` y
  `WEBAUTHN_ORIGINS` deben conservar el hostname
  `reviewer-stopping-wages-roland.trycloudflare.com`. No cambiarlo sin una
  migración explícita, porque las passkeys registradas no son transferibles a
  otro dominio.

## Shared AI Context

Antes de realizar trabajo significativo en este repositorio:

1. Leer `.ai/PROJECT.md`.
2. Leer `.ai/CURRENT_STATE.md`.
3. Leer `.ai/DECISIONS.md`.
4. Leer `.ai/TASKS.md`.
5. Leer `.ai/CHATGPT_NOTES.md`.
6. Revisar las entradas recientes de `.ai/CODEX_NOTES.md`.

Estos archivos constituyen el contexto persistente compartido entre agentes y el usuario.

Después de realizar cambios significativos:

1. Actualizar `.ai/CURRENT_STATE.md`.
2. Actualizar `.ai/TASKS.md`.
3. Registrar nuevas decisiones relevantes en `.ai/DECISIONS.md`.
4. Registrar un resumen del trabajo en `.ai/CODEX_NOTES.md`.
5. Añadir cambios relevantes a `.ai/CHANGELOG_AI.md`.

## Registro de hallazgos

- No crear `CLAUDE_NOTES.md` ni archivos de notas por agente.
- Los hallazgos relevantes de Claude o Antigravity:
  - van a `.ai/DECISIONS.md` si cambian una regla o decisión;
  - van a `.ai/TASKS.md` si generan trabajo pendiente.
- Indicar el agente de origen cuando sea útil.
- No incluir contraseñas, API keys, cookies, tokens, claves privadas ni otros secretos dentro de `.ai/`.
