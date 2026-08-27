# Historial de contexto IA

## 2026-08-27

- Se preparó `fix/remove-presentation-login` sin despliegue ni cambios de datos.
- Se retiraron los accesos de presentación, demo, RUT directo, correo-only y la
  exposición de OTP; RUT+OTP, PIN, Passkeys/WebAuthn y ADMIN quedan preservados.
- Se añadió una verificación HTTP aislada de autenticación y rutas retiradas.
- Se normalizaron `package-lock.json`, backend, PWA y documentación en `0.6.15`.
- Se creó `compose.yaml` fijado a la imagen productiva por tag y digest.
- Se declaró explícitamente el volumen externo `aspch_mi_aspch_data`.
- Se archivó el Compose v0.6.4 anterior sin aplicarlo.
- Se estableció `/home/casa/mi-aspch-source` como única fuente de código y documentación vigente.
- Se trasladó el contexto `.ai/` canónico a la carpeta oficial.
- Se registró producción actual `0.6.15`.
- Se clasificó `/mnt/MediaCenter/aspch` como legado/runtime, no como fuente de código.
- Se separó la documentación histórica bajo `docs/history/`.

## 2026-08-23

- Se creó el contexto persistente compartido para Mi ASPCH.
- Se verificó que el contenedor está saludable y que `npm run check` aprueba.
- Se registró que el proyecto aún no tiene repositorio Git inicializado en su ruta actual.
