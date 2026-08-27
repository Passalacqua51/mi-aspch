# Pendientes

- [ ] Definir una migración separada para runtime y backups, con rollback.
- [ ] Retirar en una tarea autorizada las variables de autenticación obsoletas
      del `.env` productivo, sin mostrar sus valores.

# En curso

- Ninguna tarea documental en curso.

# Bloqueadas

- Ninguna tarea documental bloqueada.

# Completadas recientemente

- [x] Preparar en `feat/admin-members-readonly` la vista ADMIN de Socios de solo
      lectura, con listado minimizado, ficha real y pruebas sin efectos externos.
- [x] Preparar en `feat/admin-dashboard-structure` la separación inicial de
      Dashboard ADMIN de solo lectura y Developer, sin despliegue.
- [x] Identificar `/home/casa/mi-aspch-source` como código de producción v0.6.15.
- [x] Copiar el contexto `.ai/` legado a la carpeta oficial.
- [x] Adoptar `/home/casa/mi-aspch-source/.ai/` como contexto compartido canónico.
- [x] Clasificar `/mnt/MediaCenter/aspch` como legado/runtime, no como código.
- [x] Separar documentación histórica de la documentación vigente.
- [x] Alinear `compose.yaml` con el contenedor productivo sin aplicarlo.
- [x] Corregir metadatos de `package-lock.json` a v0.6.15 sin cambiar dependencias.
- [x] Unificar el fallback visible de la PWA en v0.6.15.
- [x] Inicializar Git y crear el baseline anotado `v0.6.15-baseline`.
- [x] Eliminar del código los mecanismos de login de presentación/demo/directo.
- [x] Integrar `fix/remove-presentation-login` en `main` mediante merge no-FF.
- [x] Preparar la release `0.6.16` sin construir ni desplegar Docker.
- [x] Construir, fijar el digest SHA-256 inmutable y desplegar `mi-aspch:v0.6.16` en producción con healthcheck.
