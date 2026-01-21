#!/bin/bash
# Wait for SuperSync server to be ready at http://localhost:1901
# Retries for up to 90 seconds (accounts for PostgreSQL + SuperSync startup)

echo "Waiting for SuperSync server on http://localhost:1901..."

MAX_WAIT=90
elapsed=0
until curl -s http://localhost:1901/health > /dev/null 2>&1; do
  if [ $elapsed -ge $MAX_WAIT ]; then
    echo "Timeout: SuperSync server did not start within ${MAX_WAIT}s"
    echo "--- SuperSync logs ---"
    docker compose -f docker-compose.yaml -f docker-compose.supersync.yaml logs supersync
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

echo "SuperSync server is ready!"
