#!/bin/sh
set -eu

mkdir -p /root/.openclaw /app/runtime/audit /app/runtime/keys /app/runtime/state

PLUGIN_SRC="/app/openclaw-plugin/armorclaw-financial-guard"
PLUGIN_DST="/opt/claw-trade/plugins/armorclaw-financial-guard"

# Copy openclaw.json5 → openclaw.json on every start so config changes
# from the volume mount are picked up without a full rebuild
if [ -f /root/.openclaw/openclaw.json5 ]; then
  cp /root/.openclaw/openclaw.json5 /root/.openclaw/openclaw.json
  chmod 600 /root/.openclaw/openclaw.json || true
  echo "[claw-trade] openclaw.json5 loaded into openclaw.json"
fi

# Sync the plugin from the repo-mounted workspace into a container-owned path.
# Docker Desktop bind mounts on Windows often appear world-writable (777),
# and OpenClaw rejects those plugin directories for safety.
if [ -d "$PLUGIN_SRC" ]; then
  rm -rf "$PLUGIN_DST"
  mkdir -p "$PLUGIN_DST"
  cp -R "$PLUGIN_SRC"/. "$PLUGIN_DST"/
  chmod 755 /opt/claw-trade /opt/claw-trade/plugins "$PLUGIN_DST" || true
  find "$PLUGIN_DST" -type d -exec chmod 755 {} \; || true
  find "$PLUGIN_DST" -type f -exec chmod 644 {} \; || true
  echo "[claw-trade] synced plugin into container-owned path: $PLUGIN_DST"
fi

exec "$@"
