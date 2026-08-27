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

HOST="${URL#https://}"
ENVFILE="${APP_DIR}/.env"
python3 - "$ENVFILE" "$URL" "$HOST" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); url=sys.argv[2]; host=sys.argv[3]
s=p.read_text() if p.exists() else ''
# Si Google todavía está apagado, DEMO_MODE debe quedar true para que Jenny reciba
# el código de prueba en pantalla. Al activar Gmail API se puede volver a false.
google_enabled=False
for line in s.splitlines():
    if line.strip().upper().startswith('GOOGLE_ENABLED='):
        google_enabled=line.split('=',1)[1].strip().lower() in ('1','true','yes','on')
vals={
 'APP_ORIGIN':url,
 'APP_ORIGINS':url,
 'PUBLIC_APP_URL':url,
 'WEBAUTHN_RP_ID':host,
 'WEBAUTHN_ORIGINS':url,
 'PUBLIC_PREVIEW_RESTRICT_EMAIL_ONLY':'true',
 'EMAIL_ONLY_USERS':'jenny.pizarro@aspch.org',
}
if not google_enabled:
    vals['DEMO_MODE']='true'
lines=s.splitlines(); seen=set(); out=[]
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        k=line.split('=',1)[0].strip()
        if k in vals:
            out.append(f'{k}={vals[k]}'); seen.add(k); continue
    out.append(line)
for k,v in vals.items():
    if k not in seen: out.append(f'{k}={v}')
p.write_text('\n'.join(out).rstrip()+'\n')
PY

cd "$APP_DIR"
docker compose up -d --build >/dev/null

# Espera a que la aplicación reiniciada y el túnel estén listos.
OK=""
for _ in $(seq 1 40); do
  if HEALTH="$(curl -fsS --max-time 8 "${URL}/api/health" 2>/dev/null)" && CONFIG="$(curl -fsS --max-time 8 "${URL}/api/config" 2>/dev/null)"; then
    if grep -q '"version":"0.4.2"' <<<"$HEALTH" && grep -q '"emailOnlyPreview":true' <<<"$CONFIG"; then
      OK=1; break
    fi
  fi
  sleep 1
done

if [[ -z "$OK" ]]; then
  echo "ERROR: el túnel existe pero Mi ASPCH v0.4.2 no pasó la verificación pública." >&2
  echo "Revisa: $LOG" >&2
  exit 1
fi

echo "$URL"
echo "PUBLIC_PREVIEW_URL=$URL"
echo "OK: Mi ASPCH v0.4.2 accesible públicamente y restringida al correo de Jenny."
echo "NOTA: Quick Tunnel temporal. Si cambia la URL, la passkey registrada en la URL anterior debe enrolarse nuevamente."
