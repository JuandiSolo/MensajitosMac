# Mensajitos — Guía Rápida (Producción)

## URLs de producción (fijas, no cambian)

| Componente | URL |
|------------|-----|
| **Sender (Valentina - móvil)** | `https://juandisolo.github.io/MensajitosMac/send.html` |
| **API (Render - servidor)** | `https://mensajitos-api.onrender.com` |
| **Health check** | `https://mensajitos-api.onrender.com/health` |

---

## Para Juan (Mac) — Una sola vez

### 1. Compilar la app (solo si cambias código Electron)
```bash
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos
npm run build
```

### 2. Ejecutar la app
```bash
# Mata instancias previas y lanza build nuevo
pkill -f "Mensajitos.app/Contents/MacOS"
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos
```

> **Nota:** La app usa por defecto `https://mensajitos-api.onrender.com`. Si quieres otra URL:
> ```bash
> MENSAJITOS_SERVER=https://tu-url.com env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos
> ```

### 3. Verificar que funciona
- En la barra de menú (arriba a la derecha) aparece 💕
- Click en 💕 → "Enviar prueba" → sale notificación en la Mac

---

## Para Valentina (Móvil) — Cada vez

### Abre en el navegador (usa **datos móviles**, no wifi de casa)
```
https://juandisolo.github.io/MensajitosMac/send.html
```

### Envía mensajes
1. Escribe texto o selecciona foto/GIF
2. "Enviar ahora"
3. Aparece en la Mac de Juan al instante

---

## Si el servidor está dormido (no hay tráfico >15 min)

Verás un banner: **"Servidor apagado. Espera un momento…"** + botón **"Despertar servidor"**

1. Pulsa **"Despertar servidor"**
2. Espera ~1 minuto (dice "Despertando… puede tardar ~1 min")
3. El banner desaparece **solo** cuando el servidor responde
4. Tu mensaje/foto **no se borra** — reintenta "Enviar ahora"

---

## Limitación conocida (Plan gratis Render)

| Situación | Qué pasa |
|-----------|----------|
| Mac encendido (app corriendo) | Mensajes esperan **indefinidamente** (polling cada 2s mantiene vivo el server) |
| Mac apagado >15 min sin que nadie abra send.html | Servidor duerme → **mensajes e imágenes se pierden** |
| Mac apagado, Valentina abre send.html cada <15 min | Servidor se mantiene despierto → mensajes esperan |

> **Solución práctica:** Si vas a enviar algo importante y Juan no está en el Mac, avísale por WhatsApp "enciende el Mac" 😄

---

## Comandos útiles

```bash
# Ver logs de la app (en terminal donde la ejecutaste)
# Verás: [Main] Queued notification: { seq: ..., text: '...', image_url: '...' }

# Verificar API health
curl -s https://mensajitos-api.onrender.com/health | jq .

# Enviar mensaje de prueba desde terminal
curl -X POST https://mensajitos-api.onrender.com/api/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"hola desde curl"}'

# Matar todo
pkill -f "Mensajitos.app/Contents/MacOS"

# Recompilar tras cambios en electron/main.cjs o electron/preload.cjs
npm run build
```

---

## Estructura del proyecto

```
mensajitos/
├── server.js                 # Express + Socket.io (API Render)
├── package.json              # Deps + scripts + build config
├── electron/
│   ├── main.cjs              # Proceso principal Electron (polling resiliente)
│   └── preload.cjs           # IPC bridge
├── src/
│   ├── overlay.html          # Renderer: notificación overlay
│   └── icon.png              # Tray icon
├── docs/
│   ├── send.html             # GitHub Pages sender (Valentina)
│   └── send.js               # Lógica sender (banner despertar, etc.)
├── scripts/
│   ├── start-server.sh       # Inicia server local
│   ├── stop.sh               # Mata procesos
│   └── test-health.sh        # Verifica health
├── CLAUDE.md                 # Instrucciones para Claude Code
├── ESTADO.md                 # Estado vivo del proyecto
├── POSTMORTEM.md             # Lecciones aprendidas
└── render.yaml               # Config deploy Render (Blueprint)
```

---

## Desarrollo local (opcional)

```bash
# Terminal 1: Server local
./scripts/start-server.sh
# → http://localhost:3000/send
# → http://localhost:3000/health

# Terminal 2: Electron dev (requiere server corriendo)
npm run electron:dev
```