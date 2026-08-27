# Estado actual

Última actualización: 2026-08-27 UTC

## Fuentes canónicas

- Código: `/home/casa/mi-aspch-source`.
- Contexto IA: `/home/casa/mi-aspch-source/.ai`.
- Runtime: volumen Docker `aspch_mi_aspch_data` y mounts bajo `/mnt/MediaCenter/aspch`.

La ruta `/mnt/MediaCenter/aspch` es legado/runtime y no es fuente de código.

## Producción

- El contenedor `mi-aspch` está en ejecución y publica el puerto host 8085.
- Producción ejecuta Mi ASPCH `0.6.16` con healthcheck activo (`healthy`).
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
- Utiliza la imagen local inmutable `mi-aspch:v0.6.16` con digest SHA-256 fijado.
- Declara `pull_policy: never`, red `bridge` y puerto `0.0.0.0:8085:8080`.
- Reutiliza como externo el volumen persistente `aspch_mi_aspch_data`.
- Conserva los tres bind mounts productivos y carga el `.env` vigente.
- Incluye healthcheck funcional sobre `/api/health`.

## Problemas conocidos

- Queda pendiente retirar en una tarea autorizada las variables de autenticación
  obsoletas del `.env` productivo, sin mostrar sus valores.

## Control Informática en preparación

- `main` ya separa Dashboard y Developer; no hay despliegue posterior a esa
  integración.
- Dashboard usa un endpoint GET ADMIN-only con métricas reales resumidas y no
  contiene controles de escritura.
- El Control Center existente conserva sus capacidades bajo Developer.
- La rama `feat/admin-members-readonly` convierte Socios en búsqueda, listado
  paginado y ficha de solo lectura usando el SQLite sincronizado existente.
- Finanzas, Reservas, Contenido, Votaciones, Notificaciones, Integraciones,
  Seguridad, Auditoría y Sistema permanecen como estructura pendiente.
