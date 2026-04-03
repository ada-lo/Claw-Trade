#!/bin/sh
set -eu

# Copy auth credentials to all agent directories so each agent
# can authenticate with the configured API providers
copy_agent_auth() {
  SRC="/root/.openclaw/agents/main/agent/auth-profiles.json"
  if [ -f "$SRC" ]; then
    for agent in planner data technical-analysis fundamental-analysis sentiment-analysis strategy risk; do
      mkdir -p "/root/.openclaw/agents/$agent/agent"
      cp "$SRC" "/root/.openclaw/agents/$agent/agent/auth-profiles.json"
    done
    echo "[claw-trade] Auth credentials copied to all 7 agent directories"
  else
    echo "[claw-trade] No auth-profiles.json found yet — run 'openclaw onboard' first"
  fi
}

copy_agent_auth

# Start the ArmorClaw pipeline server only.
# The OpenClaw gateway is NOT started automatically.
# To start the gateway manually run:
#   docker exec -it openclaw_runtime openclaw gateway run
echo "[claw-trade] Starting ArmorClaw pipeline server on port ${PORT:-1933}..."
exec node /app/src/server.js