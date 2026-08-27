# Proyecto

ID: mi-aspch  
Nombre: Mi ASPCH  
Código oficial: `/home/casa/mi-aspch-source`  
Contexto IA oficial: `/home/casa/mi-aspch-source/.ai`  
Repositorio Git: inicializado, rama principal `main`, baseline `v0.6.15-baseline`
Producción actual: `0.6.15`  
Despliegue canónico: `/home/casa/mi-aspch-source/compose.yaml`  
Estado: operativo

## Descripción

PWA para socios de la Asociación de Pilotos de Chile. El backend Node.js vive en
`server.mjs` y `lib/`; el frontend estático vive en `public/`.

## Fuentes de verdad

- Código y documentación vigente: `/home/casa/mi-aspch-source`.
- Contexto operativo y decisiones: `/home/casa/mi-aspch-source/.ai`.
- Base SQLite y runtime: volumen Docker `aspch_mi_aspch_data`.
- Fotos y mounts actuales: `/mnt/MediaCenter/aspch`.

`/mnt/MediaCenter/aspch` contiene runtime, datos y material legado. No es fuente
de código, no debe usarse como contexto de build y su `.ai/` ya no es canónico.

## Arquitectura y dependencias

- Node.js 22 y contenedor `mi-aspch`.
- SQLite persistente en `/data/mi-aspch.sqlite` dentro del volumen Docker.
- Retratos SIPA montados en modo solo lectura y fotos de perfil en escritura.
- Integraciones opcionales con Google Sheets, Calendar y Gmail.
- Dependencias npm declaradas en `package.json`.
- Imagen productiva fijada como `mi-aspch:v0.6.15` con digest explícito.
- Volumen persistente declarado como externo con nombre `aspch_mi_aspch_data`.

## Restricciones

- Preservar `.env`, SQLite, PIN, sesiones, passkeys, fotos y backups.
- No copiar secretos, tokens o datos personales a `.ai/`, documentación o Git.
- No construir ni desplegar desde `/mnt/MediaCenter/aspch`.
- No aplicar `compose.yaml` sin autorización explícita de despliegue.
- No asumir que un Compose representa producción sin contrastarlo con Docker.
- Ejecutar `npm run check` después de cambios JavaScript relevantes.
- La autenticación de socios exige RUT y OTP; el acceso posterior usa PIN o
  Passkey/WebAuthn. No se permiten perfiles demo, login de presentación ni
  accesos directos que creen sesiones fuera de esos flujos.
