#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/mnt/MediaCenter/aspch}"
HOST_PORT="${1:-8085}"
LOG="${APP_DIR}/data/trycloudflare-mi-aspch.log"
PIDFILE="${APP_DIR}/data/trycloudflare-mi-aspch.pid"
mkdir -p "${APP_DIR}/data"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared no está instalado." >&2
  exit 1
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")" || true
  sleep 1
fi

# Verifica primero que Mi ASPCH responda localmente.
if ! curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null; then
  echo "ERROR: Mi ASPCH no responde en http://127.0.0.1:${HOST_PORT}" >&2
  exit 1
fi

: > "$LOG"
nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${HOST_PORT}" >"$LOG" 2>&1 &
echo $! > "$PIDFILE"

URL=""
for _ in $(seq 1 40); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "ERROR: no apareció URL trycloudflare. Revisa $LOG" >&2
  exit 1
fi

# Espera a que la aplicación y el túnel estén listos. El script no modifica
# configuración, autenticación ni contenedores; expone solamente la instancia existente.
OK=""
for _ in $(seq 1 40); do
  if HEALTH="$(curl -fsS --max-time 8 "${URL}/api/health" 2>/dev/null)"; then
    if grep -q '"version":"0.6.16"' <<<"$HEALTH"; then
      OK=1; break
    fi
  fi
  sleep 1
done

if [[ -z "$OK" ]]; then
  echo "ERROR: el túnel existe pero Mi ASPCH v0.6.16 no pasó la verificación pública." >&2
  echo "Revisa: $LOG" >&2
  exit 1
fi

echo "$URL"
echo "PUBLIC_PREVIEW_URL=$URL"
echo "OK: Mi ASPCH v0.6.16 accesible por el túnel con su autenticación normal intacta."
echo "NOTA: Quick Tunnel temporal. Si cambia la URL, la passkey registrada en la URL anterior debe enrolarse nuevamente."
