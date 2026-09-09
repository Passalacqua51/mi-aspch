# Pendientes

- [ ] Incorporar, tras verificación documental, los assets oficiales de
      emergencia/IFALPA y los datos oficiales de precio/formulario A320Pro en
      Preview; no usar sustitutos ni activar URLs no verificadas.

- [ ] Con privilegios sudo renovados, deshabilitar y enmascarar la unidad
      histórica `cloudflared-tunnel.service`; hoy no alcanza Preview porque
      apunta a localhost y el puerto 8086 escucha exclusivamente en Tailscale.
- [ ] Revisar y autorizar de forma separada el plan real de 182 cambios,
      especialmente las 22 desactivaciones por DESAFILIADO.
- [ ] Instalar/montar de forma read-only el XLSM de Arianna en la ruta runtime
      canónica antes de habilitar una automatización; actualmente la ruta del
      contenedor no contiene el archivo.
- [ ] Tras una primera sincronización controlada, decidir frecuencia y mecanismo
      del scheduler automático con el mismo dry-run, hash y auditoría.
- [ ] Definir una migración separada para runtime y backups, con rollback.
- [ ] Retirar en una tarea autorizada las variables de autenticación obsoletas
      del `.env` productivo, sin mostrar sus valores.
- [ ] Diseñar una fuente local segura y sincronizada para turnos de simulador.
- [ ] Definir una fuente segura si se requiere mostrar estado real del contenedor.
- [ ] Definir persistencia segura de intentos/fallos y bloqueos de acceso si esas
      métricas deben incorporarse a Seguridad.
- [ ] Evaluar un endpoint ADMIN acotado para limpiar Push muerto solo si el borrado
      automático 404/410 durante entregas resulta insuficiente.

# En curso

- Ninguna tarea documental en curso.

# Bloqueadas

- Ninguna tarea documental bloqueada.

# Completadas recientemente

- [x] Habilitar `/informatica` en el enlace Cloudflare canónico, compartir la
      sesión ADMIN y alternar entre Mi ASPCH con capacidades del Directorio y el
      panel de métricas con navegación compatible con Safari móvil.
- [x] Fijar como regla operativa el enlace de prueba del Directorio sin
      reiniciarlo, verificar sus siete cuentas activas, reforzar `active=1` en
      cada sincronización de Directorio y cubrir con pruebas el OTP único al
      correo ingresado; habilitar Face ID/Passkeys para ese mismo hostname y
      normalizar teléfonos nacionales sin el prefijo `56`.
- [x] Corregir en producción el bloqueo visual posterior al OTP: `.hidden`
      vuelve a ocultar la pantalla anterior en escritorio, el CSS quedó
      versionado por hash y las transiciones OTP/PIN/app aprobaron en Playwright
      para desktop y mobile.
- [x] Reproducir en 8086 el bundle obsoleto que omitía Perfil/Membresía,
      invalidar caché HTTP/PWA exclusivamente en Preview y validar por navegación
      real que ambos renderizadores son funciones globales.
- [x] Estabilizar las vistas Preview, retirar WhatsApp flotante y aplicar el
      comportamiento real de MOROSO, MODO SIMPLE, DESAFILIADO e INFORMÁTICA,
      validando nueve perfiles con Playwright y sin tocar producción 8085.
- [x] Sustituir el laboratorio simulado por nueve sesiones sintéticas reales y
      aisladas en SQLite Preview, con un solo teléfono autenticado y sin tocar 8085.
- [x] Implementar resumen dinámico compacto en Inicio de Mi ASPCH (Saludo, Credencial, Próximo simulador, Estacionamiento activo, Aviso ASPCH, Mensualidad con regla LATAM y Contacto discreto al final), desplegando solo Preview 8086 y sincronizando MediaCenter.
- [x] Corregir el login light, unificar Simuladores/Sala bajo Reservas y añadir
      personalización visual persistida por socio, desplegando solo Preview 8086.
- [x] Instalar el logo institucional original sin variantes, retirarlo del hero
      de Inicio, validar visualmente light/dark y actualizar solo Preview 8086.
- [x] Crear Preview persistente 8086 con Compose separado, SQLite sanitizada,
      fuentes reales read-only, login ADMIN exclusivo y efectos externos
      bloqueados por configuración y por código.
- [x] Implementar motor seguro y auditable XLSM → SQLite, deshabilitar el
      importador legado y ejecutar dry-run real sin escrituras productivas.
- [x] Completar Notificaciones, Seguridad y Auditoría con lecturas ADMIN-only,
      detalles sanitizados y acciones de seguridad ya existentes.
- [x] Completar Reservas, Integraciones y Sistema del Control Informática con
      lecturas ADMIN-only, acciones de reservas auditadas y cero probes externos.
- [x] Cerrar la primera versión útil del Control Informática maestro con
      Dashboard, ficha diagnóstica, acciones ADMIN auditadas y XLSM read-only.
- [x] Implementar la capa financiera independiente read-only/dry-run, sus pruebas
      de seguridad y el reporte real de discrepancias sin conectar producción.
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


## 2026-09-07 — Liquid Glass en capa iOS

- [x] Adaptar superficies y controles de la capa iOS a Liquid Glass y compilar DEBUG/RELEASE.
- [ ] Validar visualmente en iPhone claro/oscuro, teclado del login y menú nativo tras esta actualización.

## 2026-09-07 — Navegación inferior nativa iOS

- [x] Sustituir header nativo por navegación SwiftUI inferior basada en la web.
- [x] Persistir un WKWebView y sincronizar navegación sin loops ni recargas.
- [x] Compilar DEBUG/RELEASE firmados con deployment target 17.6.
- [x] Validar en Simulator navegación, sesión sintética, safe area y Face ID.
- [x] Instalar/abrir en iPhone 13 con Signing existente.
- [ ] Confirmar Face ID físico y navegación con sesión web real en iPhone.
- [ ] Validar visualmente en runtime iOS anterior a 26 cuando esté disponible.

## 2026-09-07 — Icono y apariencia, build 2

- [x] Renovar identidad del icono sin cambiar su imagen ni borrar la app/datos.
- [x] Sincronizar explícitamente apariencia SwiftUI → WKWebView sin recarga.
- [x] DEBUG/RELEASE y cuatro pruebas Simulator; instalar build 2 en «iPhone».
- [ ] Confirmar visualmente icono de inicio y modo oscuro en el iPhone del usuario.

## 2026-09-09 — Cierre funcional/visual iOS pre-GitHub

- [x] Retirar Liquid Glass de NativeNavigationBar y conservar cápsula, 5
      posiciones, acciones reales y selector animado.
- [x] Sincronizar Face ID nativo exitoso con el gate web sin recrear WKWebView.
- [x] Corregir fallback PIN nativo para ejecutar el desbloqueo en el mundo de la
      página y llamar `loginSuccess` real.
- [x] Mantener `WKWebsiteDataStore.default()`, cookies y sessionStorage en un
      único WKWebView persistente.
- [x] Ejecutar diagnósticos Xcode en archivos tocados y `git diff --check`.
- [x] Ejecutar BuildProject MCP correctamente.
- [x] Mejorar contraste de NativeNavigationBar en Dark Mode.
- [x] Evitar doble prompt Face ID → PIN: Face ID nativo solo se ofrece cuando
      el servidor sigue desbloqueado; si no, queda el PIN web existente.
- [x] Retirar texto `Sincronizado con ESTACIONAMIENTOS ASPCH`.
- [x] Restringir PIN de Mi ASPCH a exactamente 4 dígitos en web/API/iOS.
- [x] Simplificar pantalla nativa de reapertura a `Hola <nombre>` y botón
      principal `Acceder`, dejando PIN/logout solo para modo PIN.
- [ ] Reintentar build explícito Debug/Release cuando CoreSimulator/actool no
      esté bloqueado por ausencia de runtimes.
- [ ] Enlazar `MiASPCH.entitlements` al target desde Xcode y activar Push
      Notifications en Signing & Capabilities para obtener APNs device token.
- [ ] Implementar backend APNs antes de considerar Push remoto productivo
      completo; Web Push PWA no equivale a Push nativo dentro de WKWebView.
- [ ] Validar en iPhone físico los flujos A-K solicitados: sesión nueva,
      reapertura con Face ID, 3 fallos → PIN, background <30 s/>=30 s, logout,
      light/dark, barra inferior, Cmd+R y apertura manual sin debugger.
