#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/mnt/MediaCenter/aspch}"
PIDFILE="${APP_DIR}/data/trycloudflare-mi-aspch.pid"
if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Quick Tunnel Mi ASPCH detenido (PID $PID)."
  else
    echo "El proceso ya no estaba activo."
  fi
  rm -f "$PIDFILE"
else
  echo "No hay PID registrado para el Quick Tunnel de Mi ASPCH."
fi
