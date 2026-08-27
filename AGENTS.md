# Project Instructions

## Fuentes de verdad

- Código oficial: `/home/casa/mi-aspch-source`.
- Contexto operativo y decisiones IA: `/home/casa/mi-aspch-source/.ai`.
- Runtime y datos actuales: volumen Docker `aspch_mi_aspch_data` y mounts bajo `/mnt/MediaCenter/aspch`.

`/mnt/MediaCenter/aspch` es una ubicación de legado/runtime. No debe usarse como
fuente de código, contexto IA canónico ni contexto de build.

## Shared AI Context

Antes de realizar trabajo significativo en este repositorio:

1. Leer `.ai/PROJECT.md`.
2. Leer `.ai/CURRENT_STATE.md`.
3. Leer `.ai/DECISIONS.md`.
4. Leer `.ai/TASKS.md`.
5. Leer `.ai/CHATGPT_NOTES.md`.
6. Revisar las entradas recientes de `.ai/CODEX_NOTES.md`.

Estos archivos constituyen el contexto persistente compartido entre Codex, ChatGPT y el usuario.

Después de realizar cambios significativos:

1. Actualizar `.ai/CURRENT_STATE.md`.
2. Actualizar `.ai/TASKS.md`.
3. Registrar nuevas decisiones relevantes en `.ai/DECISIONS.md`.
4. Registrar un resumen del trabajo en `.ai/CODEX_NOTES.md`.
5. Añadir cambios relevantes a `.ai/CHANGELOG_AI.md`.

No incluir contraseñas, API keys, cookies, tokens, claves privadas ni otros secretos dentro de `.ai/`.

Cuando Git sea inicializado por decisión explícita del usuario, el repositorio de
esta carpeta será la fuente de verdad versionada del código. `.ai/` es la fuente de
verdad del contexto operativo y las decisiones del proyecto.

Este directorio aún no tiene un repositorio Git inicializado. No crear uno ni asociar un remote sin una decisión explícita del usuario.
