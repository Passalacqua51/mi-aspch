#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "${root_dir}/.env.preview" -f "${root_dir}/compose.preview.yaml")

case "${1:-status}" in
  start)
    "${compose[@]}" up -d --build preview
    ;;
  stop)
    "${compose[@]}" stop preview
    ;;
  status)
    "${compose[@]}" ps
    ;;
  restart)
    "${compose[@]}" restart preview
    ;;
  logs)
    "${compose[@]}" logs --tail="${2:-200}" -f preview
    ;;
  update)
    "${compose[@]}" build preview
    "${compose[@]}" up -d --no-deps preview
    ;;
  refresh-data)
    "${compose[@]}" stop preview || true
    "${compose[@]}" --profile maintenance run --rm --no-deps preview-seed
    "${compose[@]}" up -d --no-build preview
    ;;
  *)
    echo "Uso: $0 {start|stop|status|restart|logs [lineas]|update|refresh-data}" >&2
    exit 2
    ;;
esac
