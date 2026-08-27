# Decisiones

## 2026-08-27 — Release 0.6.16 sin despliegue

### Decisión

Publicar como `0.6.16` el código de `main` que elimina los accesos alternativos,
sin añadir cambios funcionales adicionales. Preparar Compose con la etiqueta
`mi-aspch:v0.6.16` sin reutilizar el digest de producción `0.6.15`.

### Consecuencias

- Backend, PWA, caché, manifiestos npm y pruebas reportan `0.6.16`.
- El digest quedará pendiente hasta construir la imagen en una tarea autorizada.
- Producción continúa en `0.6.15` y no se aplica Compose durante esta release.

### Estado

Activa

## 2026-08-27 — Un único flujo de autenticación para socios

### Decisión

Todo socio debe iniciar sesión mediante RUT y OTP. El acceso posterior conserva
PIN y Passkeys/WebAuthn. ADMIN conserva exclusivamente su login normal con PIN.

Se retiran perfiles de presentación o demo, acceso directo por RUT, excepciones
por correo, exposición de OTP y cualquier creación de sesión equivalente.

### Consecuencias

- Las rutas de autenticación desconocidas responden 404 antes de consultar o
  crear sesiones.
- Las variables antiguas dejan de afectar al código, aunque permanezcan en el
  `.env` productivo hasta una limpieza separada.
- No se eliminan usuarios, sesiones ni passkeys ya persistidos durante este
  cambio de código.

### Estado

Integrada en `main` para `0.6.16`; no desplegada

## 2026-08-27 — Definición canónica de despliegue v0.6.15

### Decisión

Usar únicamente `compose.yaml` para representar el despliegue. La imagen queda
fijada como `mi-aspch:v0.6.15` junto con el digest de la imagen productiva actual
y `pull_policy: never`.

El volumen se declara externo con el nombre exacto `aspch_mi_aspch_data`; el
puerto, la red, el `.env` y los bind mounts reflejan el contenedor inspeccionado.

### Consecuencias

- No se creará implícitamente un volumen vacío por cambiar el proyecto Compose.
- La definición no se aplica automáticamente y requiere autorización separada.
- El healthcheck quedará efectivo en una recreación futura; el contenedor actual
  permanece intacto y aún no lo tiene configurado.

### Estado

Activa

## 2026-08-27 — Fuente única de verdad

### Decisión

Usar `/home/casa/mi-aspch-source` como única fuente de código y documentación
vigente, y su subcarpeta `.ai/` como única fuente de contexto operativo y
decisiones para agentes.

`/mnt/MediaCenter/aspch` queda clasificado como legado/runtime. No es fuente de
código ni contexto de build.

### Consecuencias

- Los cambios de aplicación y documentación se preparan únicamente en la ruta oficial.
- Los archivos históricos se conservan bajo `docs/history/` y no son normativos.
- Runtime, SQLite, fotos y backups siguen fuera del árbol de código.

### Estado

Activa

## 2026-08-23 — Contexto compartido separado del código

### Decisión

Usar `.ai/` como fuente de verdad del contexto operativo y decisiones, sincronizando únicamente esos archivos con Google Drive. Git será la fuente de verdad versionada del código cuando el repositorio sea inicializado o enlazado explícitamente.

### Motivo

Permitir continuidad entre Codex, ChatGPT y el usuario sin copiar el código ni secretos a Drive.

### Consecuencias

Codex debe leer `/home/casa/mi-aspch-source/.ai/` antes de trabajo significativo y actualizarlo después. El sistema de sincronización aplica lista blanca y conserva conflictos.

### Estado

Actualizada por la decisión de fuente única del 2026-08-27

## 2026-08-23 — Preservar datos y credenciales durante despliegues

### Decisión

No reemplazar ni eliminar `.env`, SQLite, PIN, sesiones, retratos ni el volumen Docker persistente durante cambios o actualizaciones.

### Motivo

Son datos operativos existentes y parte de la continuidad del servicio.

### Consecuencias

Todo despliegue debe inspeccionar mounts y configuración real, respaldar lo necesario y validar el contenedor después del cambio.

### Estado

Activa
