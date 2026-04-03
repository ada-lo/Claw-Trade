#!/bin/sh
set -eu

server_pid=""
gateway_pid=""

cleanup() {
  if [ -n "$gateway_pid" ]; then
    kill "$gateway_pid" 2>/dev/null || true
  fi

  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

node /app/src/server.js &
server_pid=$!

openclaw gateway run &
gateway_pid=$!

wait "$gateway_pid"
gateway_status=$?

wait "$server_pid" 2>/dev/null || true

exit "$gateway_status"
