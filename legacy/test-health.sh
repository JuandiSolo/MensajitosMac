#!/usr/bin/env bash
# Verifica health endpoint (local o remoto)
# Uso: ./scripts/test-health.sh [URL_BASE]
#   URL_BASE por defecto: http://localhost:3000
#   Ejemplo remoto: ./scripts/test-health.sh https://mi-servicio.onrender.com

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
HEALTH_URL="${BASE_URL}/health"

echo "🔍 Health check: ${HEALTH_URL}"
echo ""

# Con timeout, siguiendo redirects, mostrando headers y body
curl -sS -f --max-time 10 \
  -H 'Accept: application/json' \
  "${HEALTH_URL}" | jq . || {
    echo "❌ Falló health check"
    echo "   URL: ${HEALTH_URL}"
    exit 1
}

echo ""
echo "✅ Health OK"