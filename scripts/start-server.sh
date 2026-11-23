#!/usr/bin/env bash
# Inicia el servidor local (Express + Socket.io)
# Uso: ./scripts/start-server.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "🚀 Iniciando servidor en http://localhost:3000"
echo "📱 Sender UI: http://localhost:3000/send"
echo "🔗 Health:    http://localhost:3000/health"
echo ""

node server.js