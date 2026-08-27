# Historial de contexto IA

## 2026-08-27

- Se preparó `feat/admin-dashboard-structure` con una navegación ADMIN dividida
  en doce áreas objetivo.
- Dashboard quedó ADMIN-only, de solo lectura y alimentado por métricas reales
  resumidas; Developer conserva el Control Center existente.
- Las diez áreas restantes quedaron como placeholders explícitos sin datos ni
  capacidades nuevas. No se desplegó ni se ejecutaron efectos externos.
- Se sanearon 28 copias textuales de la credencial Google revocada: 1 archivo
  canónico ignorado por Git, 4 fuentes históricas, 2 archivos de runtime legado
  y 21 archivos dentro de backups. Cada secreto fue reemplazado sin eliminar el
  archivo ni alterar el resto de su contenido.
- La búsqueda posterior confirmó cero apariciones de la credencial revocada y
  mantuvo la credencial vigente únicamente en el `.env` canónico y su JSON
  protegido. Archivos SQLite y el archivo comprimido revisado no contenían la
  credencial afectada.
- `npm run check` aprobó y producción continuó en `0.6.16`, saludable y sin
  recreación del contenedor.
- Se cerró la rotación de la credencial Google de Mi ASPCH: la clave nueva fue
  validada con fuentes reales y la clave anterior quedó eliminada en Google.
- Se confirmaron `/api/health`, BD SOCIOS, Sheet financiero, estacionamientos,
  Calendar READ y sincronización de socios sin errores OAuth nuevos.
- Se preservaron 109 sesiones activas y 2 passkeys; Gmail, OTP y notificaciones
  Gmail permanecen desactivados.
- Se preparó la release `0.6.16` con el retiro de accesos alternativos ya
  integrado en `main`, sin cambios funcionales adicionales ni despliegue.
- Backend, PWA, caché, paquetes y Compose quedaron referenciados en `0.6.16`;
  el digest de imagen permanece pendiente hasta la construcción autorizada.
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
