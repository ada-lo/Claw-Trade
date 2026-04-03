#!/bin/sh
set -eu

mkdir -p /root/.openclaw /app/runtime/audit /app/runtime/keys /app/runtime/state

if [ -f /root/.openclaw/openclaw.json5 ]; then
  cp /root/.openclaw/openclaw.json5 /root/.openclaw/openclaw.json
  chmod 600 /root/.openclaw/openclaw.json || true
fi

exec "$@"
