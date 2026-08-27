# Estado actual

Última actualización: 2026-08-27 UTC

## Fuentes canónicas

- Código: `/home/casa/mi-aspch-source`.
- Contexto IA: `/home/casa/mi-aspch-source/.ai`.
- Runtime: volumen Docker `aspch_mi_aspch_data` y mounts bajo `/mnt/MediaCenter/aspch`.

La ruta `/mnt/MediaCenter/aspch` es legado/runtime y no es fuente de código.

## Producción

- El contenedor `mi-aspch` está en ejecución y publica el puerto host 8085.
- Producción ejecuta Mi ASPCH `0.6.15`; el código oficial está preparado como
  `0.6.16` y todavía no fue desplegado.
- El código del host no está bind-mounted en el contenedor.
- SQLite, sesiones, passkeys y reservas permanecen en el volumen Docker.
- Retratos SIPA y fotos de perfil permanecen bajo `/mnt/MediaCenter/aspch`.

## Estado documental

- `.ai/` fue consolidado en la carpeta oficial de código.
- La documentación histórica fue separada bajo `docs/history/`.
- Git está inicializado con `main` y baseline anotado `v0.6.15-baseline`.

## Release 0.6.16 preparada

- `main` incluye la eliminación de accesos de presentación, demo, RUT directo,
  correo-only y exposición de OTP.
- El login normal RUT+OTP, PIN, Passkeys/WebAuthn y ADMIN permanecen.
- La versión de código y PWA es `0.6.16`; el contenedor y los datos productivos
  no fueron modificados.
- Las variables obsoletas que aún puedan existir en `.env` se ignoran. Su
  limpieza requiere una tarea posterior y no debe exponer valores.

## Definición de despliegue

- `compose.yaml` es la única definición canónica.
- Está preparado para la imagen `mi-aspch:v0.6.16`.
- El digest de `0.6.16` se fijará únicamente después de una construcción
  autorizada; no se reutiliza el digest de la imagen productiva `0.6.15`.
- Declara `pull_policy: never`, red `bridge` y puerto `0.0.0.0:8085:8080`.
- Reutiliza como externo el volumen existente `aspch_mi_aspch_data`.
- Conserva los tres bind mounts productivos y carga el `.env` vigente.
- Incluye un healthcheck sobre `/api/health`.
- La definición fue validada, pero no desplegada ni aplicada.

## Problemas conocidos

- El contenedor actual fue creado sin healthcheck ni etiquetas Compose; seguirá así
  hasta un despliegue futuro expresamente autorizado.
- La imagen `mi-aspch:v0.6.16` aún no fue construida y por ello su digest está
  pendiente. `compose.yaml` no debe aplicarse hasta completar ese paso.
