# Estado actual

Última actualización: 2026-08-27 00:24 UTC

## Fuentes canónicas

- Código: `/home/casa/mi-aspch-source`.
- Contexto IA: `/home/casa/mi-aspch-source/.ai`.
- Runtime: volumen Docker `aspch_mi_aspch_data` y mounts bajo `/mnt/MediaCenter/aspch`.

La ruta `/mnt/MediaCenter/aspch` es legado/runtime y no es fuente de código.

## Producción

- El contenedor `mi-aspch` está en ejecución y publica el puerto host 8085.
- Producción ejecuta Mi ASPCH `0.6.15` desde una imagen cuyo código coincide con
  `/home/casa/mi-aspch-source`.
- El código del host no está bind-mounted en el contenedor.
- SQLite, sesiones, passkeys y reservas permanecen en el volumen Docker.
- Retratos SIPA y fotos de perfil permanecen bajo `/mnt/MediaCenter/aspch`.

## Estado documental

- `.ai/` fue consolidado en la carpeta oficial de código.
- La documentación histórica fue separada bajo `docs/history/`.
- Git continúa sin inicializar por decisión explícita del usuario.

## Definición de despliegue

- `compose.yaml` es la única definición canónica.
- Usa la imagen `mi-aspch:v0.6.15` fijada también por digest.
- Declara `pull_policy: never`, red `bridge` y puerto `0.0.0.0:8085:8080`.
- Reutiliza como externo el volumen existente `aspch_mi_aspch_data`.
- Conserva los tres bind mounts productivos y carga el `.env` vigente.
- Incluye un healthcheck sobre `/api/health`.
- La definición fue validada, pero no desplegada ni aplicada.

## Problemas conocidos

- El contenedor actual fue creado sin healthcheck ni etiquetas Compose; seguirá así
  hasta un despliegue futuro expresamente autorizado.
- El digest fijado corresponde a una imagen local; debe conservarse su tag/digest
  o publicarse en un registro antes de migrar a otro host.
