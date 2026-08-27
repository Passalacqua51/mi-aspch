# Reporte de Auditoría y Estado · Mi ASPCH (v0.6.15)

## 1. Errores Encontrados
1. **Filtro de Privacidad y Seguridad en Backend (`GET /api/parking`)**: La API no verificaba `access.parking` en el servidor, dependiendo solo de la interfaz para ocultar la grilla.
2. **Visualización Restringida de Morosos**: Se requería que los socios morosos pudiesen ver la disponibilidad general de turnos/cupos en gris difuminado (*blur preview*) para "ver lo que se pierden", sin poder reservar ni interactuar.
3. **Selector y Modo Vista iPhone**: Al visualizar la aplicación en pantallas de escritorio o proyectores de presentación, no se apreciaba el chasis de un iPhone y el botón flotante inferior se superponía con el botón flotante de WhatsApp.
4. **Parámetro URL para Modo Móvil**: No existía soporte para forzar la vista móvil mediante parámetros de consulta (`?device=iphone` o `?mode=iphone`).

## 2. Errores Corregidos
1. **Protección Backend (`server.mjs`)**:
   - `GET /api/parking` valida los permisos del socio activo y bloquea las reservas no autorizadas con código `HTTP 403 MEMBERSHIP_RESTRICTED`.
   - Se excluyó la etiqueta de prueba errónea `DISPONIBLES` de la sincronización de estacionamientos.
2. **Estilo de Restricción Difuminado (`styles.css` / `app.js`)**:
   - Se implementó la clase `.restricted-blur-preview` con `grayscale` y `blur` para Simuladores, Estacionamiento y Sala de estudios en socios morosos.
   - Banner explicativo superior con acceso directo a regularización de cuotas.
3. **Simulación de Chasis iPhone de Alta Fidelidad (`styles.css` / `app.js`)**:
   - En pantallas de escritorio (`>650px`), el modo iPhone (`body.ui-iphone`) renderiza un chasis físico de iPhone (395px de ancho, bordes curvados de 52px, Dynamic Island / notch superior, barra inferior de home indicator y fondo teatral oscuro).
   - En pantallas móviles reales (`<=650px`), se comporta como una aplicación PWA nativa a pantalla completa.
   - El botón flotante `📱 Vista iPhone` / `🖥️ Vista Web` se reubicó en la esquina superior derecha (`top: 14px; right: 16px; z-index: 99999`) con efecto frosted glass para no interferir con WhatsApp ni la barra de navegación.
4. **Soporte URL Directo**:
   - Ahora se puede abrir directamente `http://192.168.1.69:8085?device=iphone` (o `?mode=iphone`) y la aplicación activará automáticamente el chasis de iPhone.

## 3. Archivos Modificados
- `public/styles.css`: Chasis de iPhone en escritorio, reubicación del switcher a top-right, estilos de blur para morosos.
- `public/app.js`: Soporte de query param `?device=iphone`/`?mode=iphone`, alternador visual de modo.
- `public/index.html`: Actualización de etiquetas y cache buster a `v=0.6.15`.
- `public/sw.js`: Bump de caché de Service Worker a `mi-aspch-v0.6.15-static`.
- `server.mjs`: Versión `0.6.15`, protección en endpoints de beneficios.
- `package.json`: Versión `0.6.15`.

## 4. Tests y Verificaciones
- `npm run check`: Aprobado sin errores de sintaxis en todos los módulos JS.
- `PRAGMA integrity_check`: `ok` (base de datos SQLite intacta sin pérdida de registros).
- Docker: Contenedor `mi-aspch` recreado y saludable en puerto 8085.
- API Config: `/api/config` responde correctamente v0.6.15.
