# Mi ASPCH Preview persistente

## Arquitectura

`compose.preview.yaml` ejecuta `mi-aspch-preview` separado de producción:

- publica `8086` únicamente en la IP Tailscale `100.109.170.84`;
- usa `runtime/preview/mi-aspch.sqlite`, nunca el volumen SQLite productivo;
- monta SIPA y `BASE DE DATOS.xlsm` en solo lectura;
- permite Google Sheets y Calendar solamente en READ;
- fuerza `PREVIEW_MODE=true`, que anula Sheets WRITE, Calendar WRITE, Gmail y
  Push incluso si `.env` productivo contiene flags permisivos;
- usa `restart: unless-stopped`, healthcheck y logs `json-file` de 10 MB × 3;
- ejecuta root filesystem read-only, sin capabilities y con
  `no-new-privileges`.

El snapshot inicial se obtiene mediante backup SQLite con la fuente montada
read-only. Se eliminan sesiones, passkeys, OTP, suscripciones Push y entregas;
todos los PIN se limpian y solo se instala el PIN preview del ADMIN.

## Acceso

- URL: `http://100.109.170.84:8086`
- El selector izquierdo crea una sesión real exclusiva de Preview y abre un solo
  teléfono en Inicio, ya autenticado.
- Perfiles disponibles: ACTIVO, MOROSO, JUBILADO, MODO SIMPLE, FO CPT,
  DIRECTORIO, CONGELADO, DESAFILIADO e INFORMÁTICA.
- Los perfiles MEMBER son socios sintéticos `@preview.invalid`; INFORMÁTICA usa
  `informatica@aspch.org` únicamente dentro de SQLite Preview y es ADMIN Preview.
- `POST /api/preview/impersonate` existe solo con `PREVIEW_MODE=true`, persiste
  los estados en la SQLite Preview y rota la cookie HttpOnly
  `mi_aspch_preview_session`.
- No hay autologin global: fuera del laboratorio, una app sin sesión conserva el
  flujo de autenticación normal.

No existe bind en loopback, IP LAN, WAN o `0.0.0.0`. Un cliente debe pertenecer
al tailnet y tener permiso de red para llegar a la IP Tailscale.

## Operación

Desde `/home/casa/mi-aspch-source`:

```bash
# START
./tools/preview_ctl.sh start

# STOP
./tools/preview_ctl.sh stop

# STATUS
./tools/preview_ctl.sh status

# RESTART
./tools/preview_ctl.sh restart

# LOGS (200 líneas y seguimiento)
./tools/preview_ctl.sh logs

# Actualizar imagen y recrear solo preview después de cambios de código
./tools/preview_ctl.sh update

# Refrescar SQLite desde un nuevo snapshot productivo read-only y sanitizado
./tools/preview_ctl.sh refresh-data
```

`refresh-data` detiene únicamente preview mientras reemplaza su SQLite. No
detiene, reinicia ni escribe el contenedor/volumen productivo.

## Comprobaciones

```bash
curl -fsS http://100.109.170.84:8086/api/health
curl --fail --max-time 2 http://127.0.0.1:8086/api/health  # debe fallar
docker inspect mi-aspch-preview --format '{{.State.Health.Status}}'
docker logs --tail 200 mi-aspch-preview
```

La unidad histórica `cloudflared-tunnel.service` apunta a
`http://localhost:8086` y actualmente sigue activa porque deshabilitarla o
enmascararla requiere renovar privilegios `sudo`. No puede alcanzar este
preview: el bind exclusivo a la IP Tailscale mantiene `127.0.0.1:8086` cerrado
y la URL pública histórica falla. Cuando haya privilegios administrativos debe
retirarse como endurecimiento adicional con
`sudo systemctl disable --now cloudflared-tunnel.service` y
`sudo systemctl mask cloudflared-tunnel.service`.
