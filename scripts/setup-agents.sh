#!/bin/sh
set -eu

echo "Setting up agent workspaces..."

for agent in planner data technical-analysis fundamental-analysis sentiment-analysis strategy risk; do
  mkdir -p /app/.agents/$agent
  echo "# $agent Agent" > /app/.agents/$agent/AGENTS.md
  echo "## Rules" >> /app/.agents/$agent/AGENTS.md
  echo "- Only output structured JSON intents" >> /app/.agents/$agent/AGENTS.md
  echo "- Never execute trades directly" >> /app/.agents/$agent/AGENTS.md
  echo "- Always pass output through ArmorClaw pipeline" >> /app/.agents/$agent/AGENTS.md
  echo "Created workspace for $agent"
done

echo "Done."
