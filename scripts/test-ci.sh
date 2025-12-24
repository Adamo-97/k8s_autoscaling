#!/usr/bin/env bash
set -euo pipefail

# Simple CI test runner used by `npm run test:ci` and GitHub Actions.
# - builds the project (expects dist/ to exist)
# - starts the server in background
# - polls /health until success
# - performs a final health check
# - kills server and exits with status

PORT=${PORT:-3000}
HEALTH_URL="http://localhost:${PORT}/health"

echo "Building (if not already built)..."
npm run build >/dev/null 2>&1 || true

echo "Starting server..."
node dist/server.js &
PID=$!

trap 'echo "Killing server..."; kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT

echo "Waiting for ${HEALTH_URL} to become available (timeout 30s)..."
for i in $(seq 1 30); do
  if curl -sSf ${HEALTH_URL} >/dev/null 2>&1; then
    echo "Health endpoint is responsive"
    break
  fi
  sleep 1
done

if ! curl -sSf ${HEALTH_URL} >/dev/null 2>&1; then
  echo "Health check failed after timeout"
  exit 2
fi

echo "Health check OK. Fetching body..."
curl -s ${HEALTH_URL}

echo "Tests passed (basic smoke)."
exit 0
