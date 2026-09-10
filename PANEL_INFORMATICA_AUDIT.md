# Panel Informática — Auditoría (post-correcciones)

Fecha: 2026-09-10 · Commit base: `a7aa3fe` + cambios de este ciclo.
Ruta: `/informatica` (sirve `admin.html`, misma sesión ADMIN, switch Panel ↔ Mi ASPCH sin segundo login).
Regla: todo lo visible funciona con datos reales o declara "No configurado". Sin botones muertos, sin datos inventados.

## Estado por sección

| Sección | Estado | Por qué |
|---|---|---|
| Dashboard | ✅ funcional | `/api/admin/dashboard` real: salud, métricas, capacidades, últimos eventos. Tarjetas enlazan a su sección (con teclado). |
| Estacionamientos / Reservas | ✅ funcional | `/api/admin/reservations` + `POST /api/admin/parking/release` (confirmación doble, auditado, auto-refresh 30s). `SELF-CHECK ADMIN PARKING RELEASE OK`. |
| Socios | ✅ funcional | Búsqueda paginada, ficha (XLSM vs aplicado vs BD SOCIOS), PIN directo/reset, bloqueo local auditado (no toca XLSM), sesiones, passkeys, OTP. |
| Votaciones | ✅ funcional | CRUD borradores, abrir (congela padrón, irreversible, con confirmación), cerrar/archivar, padrón con filtros, export CSV, resultados. |
| Notificaciones | ✅ funcional | Solo lectura real (Push subs/errores/entregas, OTP emitido). Sin envío desde aquí; el envío controlado vive en Developer con plantillas y dry-run. |
| Integraciones | ✅ funcional | Snapshot real sin probes de red: Sheets/Calendar/Gmail/Push/VAPID con estado Configurado/No configurado/Error. Sin secretos. |
| Seguridad | ✅ funcional | Herramientas operacionales (sesiones, PIN, passkeys, OTP) sobre endpoints existentes. Auth/sesiones/WebAuthn/CSP intactos. |
| Auditoría | ✅ funcional | `audit_log` real con filtros fecha/acción/socio/categoría. Sin secretos. |
| Sistema | ✅ funcional | Versión, uptime, SQLite (quick_check solo lectura visible), tablas, backups, errores, jobs fallidos. Sin shell/SQL libre/archivos/.env. |
| Developer | ✅ funcional | Jobs predefinidos auditados, export CSV acotado, mantenimiento DB acotado, push con plantillas, CRUD contenido. Instagram fantasma eliminado (ver Fixes). |
| Finanzas | ✅ funcional | Nueva vista read-only: `GET /api/admin/finance` (XLSM diagnostic + deudores reales de `member_financial_status`). Si falta el archivo: "Fuente financiera no configurada" con diagnóstico. Carga XLSM bloqueada (403). |
| Contenido | ✅ funcional | Nueva vista con CRUD real: noticias, actividades, convenios, biblioteca (mismos endpoints auditados que Developer). |

## Fixes aplicados en este ciclo

1. **Botón muerto eliminado**: tarjeta "Instagram Sync" llamaba a `POST /api/admin/sync-instagram` inexistente → reemplazada por tarjeta honesta "No configurado"; función y estado huérfanos eliminados.
2. **Finanzas**: era placeholder → vista funcional read-only + endpoint `GET /api/admin/finance`.
3. **Contenido**: era placeholder → vista funcional con CRUD real (sin CMS inventado, sin persistencia paralela).
4. **Accesibilidad**: links del Dashboard ahora operables con Enter/Espacio.
5. **Self-check nuevo**: `tools/self_check_admin_panel.mjs` (`npm run admin:test`) — 12 secciones con renderer, 59 llamadas `/api/admin/*` con endpoint, sin ghost UI, guard 403 verificado.

## Autorización (verificado, sin cambios)

- `server.mjs`: todo `/api/admin/*` devuelve 403 a no-ADMIN antes del desbloqueo. Frontend redirige además a `home`.
- Bloqueo de socio = tabla local `member_access_blocks`, auditado; no modifica XLSM/Sheets.
- P0 seguridad: ninguno.

## Pendientes reales (externos / requieren Codex-Sol)

- Archivo XLSM financiero ausente en este entorno → Finanzas muestra "no configurada" hasta montar `FINANCIAL_XLSM_PATH`.
- APNs remoto iOS: no existe; solo Web Push PWA + notificación local.
- `self_check_auth.mjs` exige Node v22 (prod); en Mac con Node v26 falla por entorno, no por código.
- Instagram: no hay integración; si se quiere, requiere credenciales + backend nuevo (no existe).
