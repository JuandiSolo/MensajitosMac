#!/usr/bin/env bash
# Mata procesos del proyecto: servidor Node + app Electron
# Uso: ./scripts/stop.sh

set -euo pipefail

echo "🛑 Deteniendo procesos..."

# Servidor Node (server.js)
pkill -f "node server.js" 2>/dev/null && echo "  ✓ node server.js" || echo "  ○ node server.js (no encontrado)"

# Electron app (build)
pkill -f "Mensajitos.app/Contents/MacOS" 2>/dev/null && echo "  ✓ Mensajitos.app" || echo "  ○ Mensajitos.app (no encontrado)"

# Electron dev (electron .)
pkill -f "electron ." 2>/dev/null && echo "  ✓ electron ." || echo "  ○ electron . (no encontrado)"

echo "✅ Listo"