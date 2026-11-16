#!/bin/sh
# Run the Fiumicello e2e smoke suite against the running :test stack.
# Executes INSIDE the backend container (has node 22 + bcrypt + psql + DB creds).
# Usage:  ./e2e/run-smoke.sh        (uses the running fiumicello-backend)
#         E2E_BASE_URL=... ./e2e/run-smoke.sh   (override target)
set -e
CT="${FIUMICELLO_BACKEND_CONTAINER:-fiumicello-backend}"
SRC="$(cd "$(dirname "$0")" && pwd)/smoke.mjs"
echo "▶ Copiando suite a $CT"
docker cp "$SRC" "$CT:/app/smoke-e2e.mjs"
echo "▶ Ejecutando smoke e2e en $CT"
docker exec "$CT" node /app/smoke-e2e.mjs