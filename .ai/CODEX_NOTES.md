# Notas de Codex para ChatGPT

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
