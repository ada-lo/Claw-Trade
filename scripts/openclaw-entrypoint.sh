#!/bin/sh
set -eu

mkdir -p /root/.openclaw /app/runtime/audit /app/runtime/keys /app/runtime/state

# Copy openclaw.json5 → openclaw.json on every start so config changes
# from the volume mount are picked up without a full rebuild
if [ -f /root/.openclaw/openclaw.json5 ]; then
  cp /root/.openclaw/openclaw.json5 /root/.openclaw/openclaw.json
  chmod 600 /root/.openclaw/openclaw.json || true
  echo "[claw-trade] openclaw.json5 loaded into openclaw.json"
fi

exec "$@"