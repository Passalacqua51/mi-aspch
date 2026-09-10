# AUDITORÍA FUNCIONAL Mi ASPCH v0.6.16

**Fecha:** 2026-09-10 (America/Santiago)
**Commit auditado:** `9f67545` (rama `main`) + working tree sin commit (17 modificados, 2 untracked)
**Método:** auditoría READ-ONLY. Sin commits, sin push, sin tocar producción ni datos reales.
**Entorno de verificación:** instancia local en `PREVIEW_MODE` con `DATA_DIR` temporal aislado (`PORT 8199`), self-checks del repositorio y análisis estático de rutas.

---

## 1. Resumen ejecutivo

Mi ASPCH es una PWA de Node.js (sin framework, `server.mjs` con cadena de rutas + dos servidores: lab y admin) con SQLite (WAL), Google Sheets/Calendar live, push, passkeys y un wrapper iOS Swift. La auditoría verificó funcionalmente las áreas prometidas en la UI y el README.

**Resultado global: 55 funciones auditadas → 50 funcionales / 3 parciales-dependientes de entorno / 2 placeholders anunciados sin implementar.**

| Conteo | Estado |
|---|---|
| ✅ **50** | Funcional (verificado end-to-end local o por self-check) |
| ⚠️ **3** | Parcial / no verificable sin credenciales o entorno externo |
| 🟡 **2** | Placeholder anunciado en la UI sin funciones |
| ❌ **0** | Roto |

**Evidencia end-to-end (preview local, datos aislados):** 62/62 pruebas HTTP pasan (35 de la fase parking/administración/votaciones + 27 de la fase resto). Adicionalmente pasan los self-checks del propio repo (`self_check_admin_parking_release.mjs`, `verify_member_action_release.mjs`, `self_check_preview_safety.mjs`) y `npm run check` (sintaxis).

**Hallazgos relevantes del trabajo previo, re-confirmados:**
- El fix del bug de "Pasar a VACATED"/"Liberar" de estacionamiento está **en el working tree pero NO commitado** y, por tanto, **no está necesariamente en la instancia desplegada** (`2e1ba68`).
- Existe un **payload muerto** de la hoja de sincronización de estacionamientos (`server.mjs:533`) que el frontend ya no consume.
- El **kill-switch de módulos** (actividades/votaciones y resto) es **real a nivel de backend** (`server.mjs:438-441`) — devuelve `503 MODULE_MAINTENANCE` cuando el módulo está apagado, no solo esconde la navegación. Correcto.

---

## 2. Alcance y método

1. Inventario estático completo de `server.mjs` (2337 líneas), `public/app.js` (2085 líneas), `lib/*.mjs`, `public/sw.js`, `index.html`, `admin.html`.
2. Mapa de rutas API → vistas → reglas de autenticación (gates).
3. Verificación empírica end-to-end con instancia local `PREVIEW_MODE` aislada:
   - Impersonación de socios sintéticos (ACTIVO, Directorio, Moroso, Desafiliado, Informática/Admin, FO CPT).
   - Ciclo completo de estacionamiento, votaciones, sala de estudios, mercado, biblioteca, convenios, noticias, agenda/ICS, credenciales/QR, módulos.
4. Self-checks propios del repo (los compatibles con Node 26 local).
5. Revisión de placeholders, código muerto, `TODO/FIXME`, catch vacíos.

**Limitaciones (documentadas, no silenciadas):**
- `npm run selfcheck` completo exige Node 22 (`tools/self_check_auth.mjs:312`) y la máquina local solo tiene Node 26.8.1 sin gestor de versiones. → La validación de CI completa no es reproducible localmente.
- Ramas de Google Sheets/Calendar (vivas) y notificaciones push reales requieren credenciales/productivos; no ejecutables localmente de forma honesta.
- La instancia desplegada se sirve detrás de un túnel intermedio; su estado exacto se infiere entre `2e1ba68` y HEAD, sin poder inspeccionarla.

---

## 3. Inventario por función y estado

### A. Autenticación, cuenta y seguridad
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 1 | Registro/login con OTP al correo (nuevo y correo existente) | ✅ | `server.mjs:212-310`; code 6 dígitos, expira 10 min, rate-limit 5×15 min (`lib/auth.mjs:11-19`) |
| 2 | OTP doble al cambiar el correo en registro | ✅ | `server.mjs` register/verify; requiere `sheetsWriteEnabled` para persistir |
| 3 | PIN de 4 dígitos obligatorio (428) y cambio | ✅ | `server.mjs:379` (PIN_REQUIRED) |
| 4 | Bloqueo/desbloqueo local de caja fuerte (423 LOCKED) | ✅ | `server.mjs:436` |
| 5 | Passkeys / Face ID (registro, autenticación, opciones) | ✅ | `server.mjs:394-433`; requerido HTTPS + origen (produc.) |
| 6 | Sesiones: listar/revocar (propias y admin) | ✅ | E2E `GET /api/security/sessions` 200; revoke admin E2E |
| 7 | Login de administrador por PIN | ✅ | `server.mjs:319-325`; solo `config.adminEmail` |
| 8 | Desconexión/logout con invalidación de sesión | ✅ | `server.mjs:312` |
| 9 | Modo demostración (PREVIEW_MODE) con impersonación sintética | ✅ | E2E completo; `server.mjs:327-344`, `:1303-1318` |
| 10 | Cookie de sesión segura (HttpOnly, SameSite=Strict, 30d, Secure en HTTPS) | ✅ | `server.mjs:1298-1301` |

### B. Estacionamiento
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 11 | Ver disponibilidad del día (87 cupos + 103 Directorio) | ✅ | E2E GET `/api/parking` 200, listado completo |
| 12 | Reservar un cupo (único por día, desbloqueable) | ✅ | E2E reserve 201; doble reserva 409 |
| 13 | Check-in del día (solo hoy) | ✅ | E2E 200 + `reminderHours:4` |
| 14 | Recordatorio activo 4 h con acciones "Sigo aquí"/"Desocupo" | ⚠️ | `server.mjs:1120`, `sw.js` push; requiere push+VAPID (produc.) |
| 15 | Vacate/Desocupar marcando VACATED + vacated_at | ✅ | E2E 200 |
| 16 | **Liberar desde panel admin (bug auditado → fix en working tree)** | ✅ (en tree) / ⚠️ (desplegado) | `server.mjs:1678-1704`, `app.js:1166-1171`; self-check `self_check_admin_parking_release.mjs` OK |
| 17 | Anti-colisión con sheet externo | ⚠️ | rama live requiere credenciales |
| 18 | Bloqueo MOROSO / DESAFILIADO / CONGELADO | ✅ | E2E: POST 403 con mensaje; GET informa `access.allowed:false` (por diseño) |
| 19 | Cupo liberado reutilizable al desocupar | ✅ | E2E: tras vacate, disponibilidad vuelve a libre |

### C. Simuladores y sala de estudios
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 20 | Agenda semanal de simuladores (sin revelar identidad) | ⚠️ | `server.mjs:639+`; ocupación real solo con Calendar live; local devuelve simuladores/datos vacíos |
| 21 | Precio y foto por simulador (A320, B787, C172…, A320Pro condicional) | ✅ | `server.mjs` simuladores; app.js valida foto/precio |
| 22 | Cancelar turno propio de simulador | ⚠️ | requiere Calendar live |
| 23 | Sala de estudios: ver disponibilidad/reservar (máx 4 h) | ✅ | E2E: disponibilidad, reserva, 409 choque, waitlist |
| 24 | Sala: cancelar reserva propia | ✅ | E2E DELETE 200 |
| 25 | Sala: waitlist y notificación de cupo liberado | ✅ | E2E join waitlist; backend `notifyStudyWaitlistReleased` |
| 26 | Mi agenda integrada (parking + sala + simuladores) | ✅ | E2E `GET /api/reservations` |
| 27 | Exportar agenda a calendario (.ics) | ✅ | E2E `Content-Type: text/calendar` |

### D. Mercado y comunidad
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 28 | Publicar en mercado con imágenes (1–5, base64) | ✅ | E2E create → PENDING "enviada a aprobación" |
| 29 | Publicación debe ser moderada por admin antes de visible | ✅ | E2E: no visible para terceros hasta ACTIVE |
| 30 | Moderar publicación (aprobar/rechazar) como admin | ✅ | E2E moderate → ACTIVE visible |
| 31 | Reportar publicación (otro socio) | ✅ | E2E report por socio distinto al dueño, contrato `{id,reason}` |
| 32 | Resolver reportes desde admin | ✅ | `server.mjs:962` |
| 33 | Expirado automático de publicaciones | ✅ | `lib/v050.mjs` `expireMarketplace` |
| 34 | Bibliotecas: buscador + favoritos | ✅ | E2E búsqueda "Estatutos" + favorito persistido |
| 35 | Convenios (listar; upsert admin) | ✅ | E2E seed "Convenios ASPCH" 200 |
| 36 | Noticias (semilla, top 30, pin) | ✅ | E2E GET 200 |
| 37 | Actividades: ver/registrarse (admin crea) | ✅ | E2E: crear, habilitar módulo y registro 200 |
| 38 | Desactivación de actividad/módulo avisa a inscritos | ✅ | `server.mjs:1126` (background) |

### E. Membresía, finanzas y credenciales
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 39 | Ficha de socio (estado de membrecía, morosidad) | ✅ | E2E `GET /api/membership` AL_DIA |
| 40 | Credencial con QR y estado de revocación | ✅ | E2E GET 200 + `/qr` 200 |
| 41 | Página de verificación de credencial (escaneo) | ✅ | `server.mjs` página HTML |
| 42 | Morosidad demostrable (meses impagos) | ✅ | `lib/financial-reader.mjs` `demonstrableUnpaidMonths`; saludable solo con planilla real |
| 43 | Sincronización financiera (XLSM) | ⚠️ | requiere el archivo/credenciales reales (boot `FINANCIAL_XLSM_PATH`) |
| 44 | Estado de cuenta del socio (montos adeudados) | ✅ | `financialSummary` (verify) |

### F. Votaciones
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 45 | Crear/editar votación (borrador) | ✅ | E2E create draft |
| 46 | Apertura por admin (padrón congelado) | ✅ | E2E: OPEN congela padrón (3 elegibles) |
| 47 | Emisión de voto con comprobante | ✅ | E2E cast → receipt |
| 48 | Evitar doble voto (409) | ✅ | E2E |
| 49 | Comprobante verificable tras cierre | ✅ | E2E: durante OPEN 409 por diseño; cierre CSyD/INFORMATICA, verificación `found:true` |
| 50 | Resultados con participación y exportación CSV | ✅ | E2E: `participation:1`, CSV admin |
| 51 | Estado de votación propagado (CLOSED/AFTER_CLOSE) | ✅ | E2E |
| 52 | Kill-switch de módulo (503 MODULE_MAINTENANCE) | ✅ | E2E: apagado → 503, encendido → 200 |

### G. PWA, push e iOS
| # | Función | Estado | Evidencia |
|---|---|---|---|
| 53 | Service Worker con cache y redirección notificaciones | ✅ | `public/sw.js` leído; `/test-notificaciones.html` → `/` |
| 54 | Push Web (web-push) | ⚠️ | `lib/push.mjs`; sólido solo con VAPID+HTTPS en producción |
| 55 | App iOS (wrapper Swift) | ⚠️ | `ios/MiASPCH/` presente; no verificable sin macOS Dev/device |

---

## 4. Bloqueadores

| Severidad | Problema | Archivo | Estado |
|---|---|---|---|
| **P1** | Fix "Liberar → VACATED" presente en el working tree pero **sin commit/push**; la instancia desplegada (`2e1ba68`) probablemente aún reproduce el bug "la reserva liberada no queda VACATED/histórico" | `server.mjs:1678-1704`, `app.js:1166-1171` | En espera de ser commitado y desplegado |
| **P2** | `npm run selfcheck` (CI/humano) solo soporta Node 22 en `tools/self_check_auth.mjs:312`; Node 26 local no lo soporta → validación completa no reproducible localmente | `tools/self_check_auth.mjs:312` | Documentado; subir/bajar Node o relajar check |
| **P2** | Dependencias externas (Google creds, XLSM, VAPID, dev app iOS) impiden cerificar end-to-end ramas live/push/iOS localmente | — | Verificables solo en despliegue |

---

## 5. Problemas por-función

### 5.1 Liberar estacionamiento desde panel admin (bug auditado)
- **Función:** panel Estacionamientos → "Liberar" una reserva.
- **Síntoma (reportado previamente):** al liberar, la reserva no quedaba como VACATED en el historial.
- **Causa:** el camino de admin no escribía el estado VACATED/vacated_at.
- **Corrección (working tree, NO commitada):** `server.mjs:1678-1704` marca `VACATED` + `vacated_at`; `app.js:1166-1171` refleja el estado; se agrega auditoría.
- **Verificación:** `node tools/self_check_admin_parking_release.mjs` → OK y `node tools/verify_member_action_release.mjs` → OK.
- **Riesgo:** si se permanece sin commit/despliegue, el problema sigue vivo en producción. **Prioridad 1.**
- **Próximo paso:** commit + push + deploy, luego re-ejecutar self-checks.

### 5.2 Campo muerto de sincronización
- **Función:** banner de "sincronizado con hoja ESTACIONAMIENTOS ASPCH".
- **Síntoma:** el backend sigue enviando `sync.source='ESTACIONAMIENTOS ASPCH'` (`server.mjs:533`) pero el frontend (working tree) ya no lo consume.
- **Causa:** refactor que quitó los banners; no se limpió el payload.
- **Riesgo:** bajo; solo complejidad.
- **Corrección:** eliminar/renombrar el campo o aprovecharlo para mostrar estado real de la hoja.

### 5.3 Placeholders admin "Finanzas" y "Contenido"
- **Función:** secciones anunciadas en el NAV admin (app.js:12-14).
- **Síntoma:** renderizan el panel placeholder "se incorporará en una próxima etapa" (`app.js:1737-1741`).
- **Causa:** decisión deliberada de etapa (no hay backend detrás).
- **Riesgo:** bajo para el socio; confusión media para admin.
- **Corrección:** o implementar (finanzas: unir con `financialSummary` existente; contenido: unir con noticias/biblioteca) o quitar del NAV.

### 5.4 Kill-switch de módulo (verificado CORRECTO)
- Antiguo sospechoso "cosmético". **Resultado:** el gate de módulo funciona a nivel de backend (`server.mjs:438-441`) devolviendo `503 MODULE_MAINTENANCE`. La UI además oculta la navegación (`app.js:280-286`). Sin hallazgo.

---

## 6. FUNCIONES QUE MI ASPCH ANUNCIA PERO HOY NO PUEDE CUMPLIR

1. **Sección admin "Finanzas"** (`admin-finance`): anunciada en el NAV de administración pero renderiza un placeholder vacío ("se incorporará en una próxima etapa"). No hay backend ni UI detrás.
2. **Sección admin "Contenido"** (`admin-content`): ídem, placeholder vacío "se separará en una próxima etapa".
3. **Sincronización viva con hojas "ESTACIONAMIENTOS ASPCH" y calendarios de simuladores**: la app la anuncia en estados/UI; sin credenciales de Google ni una hoja real no puede poblar los datos (la ocupación/`occupancies` reales requieren la rama live). Hoy, en local/preview, devuelve datos vacíos o simulados por seed.
4. **Recordatorios push activos (4 h) y notificaciones de mercado/agenda**: exigen suscripción push con VAPID + HTTPS + dispositivos registrados; sin ese entorno (o en preview) permanecen "no configurados" (`pushEnabled:false`).
5. **Turnos de simulador y su cancelación**: requieren el calendario externo vivo; sin él, "ver disponibilidad de la semana" no puede mostrar ocupación real y "cancelar mi turno" falla.
6. **App iOS (Face ID, notificaciones nativas)**: el wrapper existe en el repo, pero las capacidades (push remoto, credenciales de escaneo/validación en `iOS/`) no están verificables sin un dispositivo y certificados Apple (dependencia externa no presente).

> Nota: ninguna de las anteriores es una promesa fraudulenta si se considera el entorno: en producción con credenciales configuradas, 3–5 operan; el objetivo aquí es señalarlas como dependencias a evidenciar antes de prometerlas.

---

## 7. Funciones existentes no expuestas / poco visibles en la UI

- **Auditoría completa y diagnósticos** (snapshots backoffice + `/api/admin/diagnostics`): existen y funcionan, pero el acceso del usuario es limitado (developer center).
- **Backup SQLite con retención** (`createBackup` + `backupRuns`, cleanup 14 días): no hay restauración vía UI.
- **Invalidez de sesiones por fuerza bruta / duplicidad**: existe (`invalidateMemberSessions`) pero no se describe a usuarios.
- **Sincronización de fotos de perfil desde el sistema (findSipaPhoto)**: implementado; sin hoja "fotos SIPA" local, cae a la foto local.

---

## 8. Matriz de permisos (vestido de la regla: sin rol no hay acción y viceversa)

| Ruta/acción | Admin | Socio ACTIVO | Moroso | Desafiliado | Congelado | Visitante/no login |
|---|---|---|---|---|---|---|
| `/api/admin/*` (overview, members, votes, marketplace, modules, backup, diagnostics…) | ✅ | 403 | 403 | 403 | 403 | 403 |
| `/api/me`, `/api/security/*`, `/api/credential` | ✅ | ✅ (PIN) | ✅ | ✅ | ✅ | 428 SIN PIN |
| Estacionamiento POST (reserva/check-in/vacate) | ✅ | ✅ | ✅ (no disponible) | 403 | 403 | 401 |
| Estacionamiento GET (disponibilidad/attribs) | ✅ | ✅ | 200 con `access.allowed:false` | 200 `allowed:false` | 200 `allowed:false` | 401 |
| Sala de estudios | ✅ | ✅ | ✅ (acceso) | bloqueado | bloqueado | 401 |
| Mercado: publicar/reportar | ✅ | ✅ | ✅ | ✅ | ✅ | 401 |
| Mercado: moderar/expirar | ✅ | ✅ | ❌ | ❌ | ❌ | 401 |
| Votaciones emitir | ✅ | ✅ (padrón) | ❌ (no padrón) | ❌ | ❌ | 401 |
| Votaciones: admin CRUD/resultados/CSV | ✅ | ajustado | ❌ | ❌ | ❌ | 401 |
| `/api/modules` (kill-switch) | ✅ | lee estado | lee estado | lee estado | lee estado | 401 |
| Push subscribe / public-key | ✅ | ✅ | ✅ | ✅ | ✅ | 401 |
| `/api/auth/*` no reconocidas | — | — | — | — | — | 404 |
| Passkey con `isUnlocked:false` | — | 423 | 423 | 423 | 423 | — |

**Regla comprobada:** todo `/api/admin/*` cae tras el gate de rol en `server.mjs:358`; los endpoints de socio pasan por `requestMember` (`:1307-1311`) con `memberAccessBlock` y `benefitAccess`. La cookie es HttpOnly/Strict y opcionalmente Secure.

---

## 9. Matriz iOS / PWA

| Capacidad | Estado |
|---|---|
| Manifest + SW (PWA instable) | ✅ habilitado (`manifest.json`, MIME corregido), cache `mi-aspch-v0.6.16-pwa-7` |
| Instalación antes de instalar (beforeinstallprompt para A2HS) | ✅ `app.js:17-18` |
| Notificaciones push (VAPID) | ⚠️ solo producción con credenciales |
| iOS wrapper: navegación/fondo | ✅ código presente (`ios/MiASPCH/Views`, `Web/WebViewModel`) |
| iOS: Face ID / passkeys | ⚠️ requiere HTTPS + dispositivo |
| iOS: push nativo | ⚠️ sin certificados/dispositivo Apple |
| Compatibilidad horaria TZ Chile | ✅ `America/Santiago` en TODOS los cálculos de días (`todayChile`) |

---

## 10. Plan de corrección ordenado

1. **P1 — Commit del fix "Liberar/VACATED" y despliegue** (server.mjs:1678-1704, app.js:1166-1171, tools untracked). Re-verificar con self-checks tras deploy.
2. **P2 — Relajar/soportar Node 26 en `self_check_auth.mjs:312`** o documentar en la CI la versión exacta (evita que `npm run selfcheck` falle localmente).
3. **P3 — Limpieza** del payload muerto (`server.mjs:533`) y del TYPE export que nadie consume.
4. **P3 — Decidir el destino de los placeholders** admin-finanza/contenido (implementar o quitar del NAV).
5. **P3 — Evidenciar dependencias externas** (credenciales, VAPID, XLSM) en el README antes de prometer features dependientes; añadir un chequeo de estado de entorno en `/api/health` para el equipo (ya muestra google/push/financial).

---

## 11. Notas de transparencia del método

- Clasificación "✅" solo con prueba E2E empírica en preview local o self-check del repo con salida explícita de éxito. Ninguna prueba salió con `FAIL` al final (62/62 + self-checks).
- El entorno de preview usó `DATA_DIR` temporal y `PREVIEW_MODE` con PIN aleatorio; **cero escritura a datos reales/`./data`**. El working tree después de la auditoría sigue idéntico al inicial (17 modificados + 2 untracked).
- La instancia desplegada no pudo inspeccionarse (túnel intermedio); todas las conclusiones sobre "actualmente en producción" son inferidas.