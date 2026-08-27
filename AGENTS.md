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
