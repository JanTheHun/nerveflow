#!/bin/sh
set -eu

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
PORT_VALUE="${PORT:-4190}"
WS_PATH_VALUE="${WS_PATH:-/api/runtime/ws}"
ENTRYPOINT_VALUE="${ENTRYPOINT_PATH:-}"
NO_AUTOSTART_VALUE="$(printf '%s' "${NO_AUTOSTART:-}" | tr '[:upper:]' '[:lower:]')"

if [ ! -d "$WORKSPACE_DIR" ]; then
  echo "nerve-runtime container error: workspace directory not found: $WORKSPACE_DIR" >&2
  exit 1
fi

cd "$WORKSPACE_DIR"

set -- node /app/bin/nerve-runtime.js start . --port "$PORT_VALUE" --ws-path "$WS_PATH_VALUE"

if [ -n "$ENTRYPOINT_VALUE" ]; then
  set -- "$@" --entrypoint "$ENTRYPOINT_VALUE"
fi

case "$NO_AUTOSTART_VALUE" in
  1|true|yes|on)
    set -- "$@" --no-autostart
    ;;
esac

exec "$@"