# Mensajitos — Instrucciones para Claude Code

> **Proyecto:** App de mensajería romántica en tiempo real  
> **Stack:** Express + Socket.io (server) | Vanilla JS + Electron 30 (desktop) | GitHub Pages (sender UI)  
> **Carpeta canónica:** `/Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos/`

---

## 🚀 Cómo correr el proyecto

### Servidor local
```bash
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos
node server.js
# → http://localhost:3000/send
# → http://localhost:3000/health
```

### Electron (desarrollo)
```bash
# 1. Matar instancias previas (single instance lock)
pkill -f "Mensajitos.app/Contents/MacOS"

# 2. Compilar si hay cambios en main/preload
npm run build

# 3. Ejecutar app (LIMPIO: sin ELECTRON_RUN_AS_NODE)
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos
```

### Scripts útiles
```bash
# Verificar health
curl -s http://localhost:3000/health | jq .

# Enviar mensaje de prueba
curl -X POST http://localhost:3000/api/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"hola desde curl"}'
```

---

## 🏗 Arquitectura Actual

```
┌──────────────────┐     HTTPS      ┌─────────────────┐
│  GitHub Pages    │ ─────────────► │   Render API    │
│  (send.html)     │  POST /api/    │  (server.js)    │
└──────────────────┘  fetch         └────────┬────────┘
                                              │
                                              │ Polling 2s
                                              ▼
                                     ┌─────────────────┐
                                     │  Electron App   │
                                     │  (overlay.html) │
                                     └─────────────────┘
```

### Componentes clave

| Archivo | Responsabilidad |
|---------|-----------------|
| `server.js` | Express + Socket.io. REST: `/api/send`, `/api/upload`, `/api/poll/:deviceId`, `/health` |
| `src/overlay.html` | Renderer Electron. IPC `new-message`, `hide-notification`, `resize-overlay` |
| `electron/main.cjs` | Main process: overlay window, tray, polling, config, single-instance lock |
| `electron/preload.cjs` | contextBridge: expone `resizeOverlay`, `onNewMessage`, `notifyClicked`, `notifyClosed`, `setIgnoreMouse` |

### Device ID
**FIJO:** `juan-macbook` (hardcodeado en `server.js:115` y `main.cjs:15`). Sin pairing, sin localStorage.

### Sequence numbers (seq)
- Server: `globalSeq = Date.now()` → `nextSeq()` monotónico
- Cliente: `lastSeq` persistido en memoria, reset si `maxSeq <= lastSeq` (server restart)

---

## ⚠️ Workarounds Conocidos (NO tocar sin razón)

| Issue | Workaround | Dónde |
|-------|------------|-------|
| `ELECTRON_RUN_AS_NODE=1` en shell de Claude | `env -u ELECTRON_RUN_AS_NODE` antes de ejecutar build/app | Todos los comandos de test |
| ESM falla en Electron 30+ main/preload | Usar **CommonJS** (`require`, `.cjs`) | `main.cjs`, `preload.cjs` |
| Code signing falla en build | `forceCodeSigning:false, hardenedRuntime:false` en `package.json` | Config build |
| Click-through bloquea toda ventana | `setIgnoreMouseEvents(true, {forward:true})` siempre; enable solo sobre `.card` via IPC | `main.cjs` + `overlay.html` |
| Ventana no aparece tras load | `show: false` en `BrowserWindow` + `show()` explícito tras `resize-overlay` IPC | `main.cjs` |
| Dos instancias = caos | `app.requestSingleInstanceLock()` al inicio de `main.cjs` | `main.cjs:312` |

---

## 🌐 Deploy: Decisiones A2 + B1

| Decisión | Qué significa |
|----------|---------------|
| **A2: GitHub Pages** | `/send` es página estática en GitHub Pages. Llama a API en Render via fetch absoluto. CORS habilitado en server. |
| **B1: Aceptar pérdida** | Plan gratis Render: duerme a 15 min, disco efímero. Mensajes/imágenes con Mac apagado >15 min se pierden. Avisar a Valentina. |

### URLs de producción (actualizar tras deploy)
- **API (Render):** `https://<servicio>.onrender.com`
- **Sender (GitHub Pages):** `https://<usuario>.github.io/<repo>/send.html`
- **Health:** `https://<servicio>.onrender.com/health`

### Variables de entorno Render
```env
PUBLIC_URL=https://<servicio>.onrender.com
NODE_ENV=production
# PORT NO definir (Render lo inyecta)
```

---

## 🔧 Reglas de Desarrollo (guía global §7, §13)

1. **Un cambio a la vez** → commit verificado → siguiente
2. **No hardcodear URLs** que cambian: `DEFAULT_SERVER_URL` en un solo lugar, prioridad `config.serverUrl || process.env.MENSAJITOS_SERVER || DEFAULT_SERVER_URL`
3. **Polling resiliente:** timeout ~10s, ignorar no-JSON, backoff (2s→5s→15s), volver a 2s al recuperar
4. **Single instance lock** siempre
5. **Test real = móvil (datos) → `/send` → overlay Mac**. Logs no cuentan.
6. **No declarar "funciona" sin prueba visual completa** (texto + foto + GIF + servidor dormido + Mac suspendido)

---

## 📝 Archivos de Estado (actualizar CADA sesión)

- **ESTADO.md** — Checklist vivo, URLs reales, decisiones, hipótesis, comandos de retomar
- **POSTMORTEM.md** — Lecciones, bugs, decisiones para próximos proyectos
- **COMO_USAR.md** — 3 pasos para usuario final

---

## 🛑 Reglas de Parada (5 líneas)

1. Un objetivo por sesión.
2. No cambies nada hasta que usuario responda decisiones abiertas.
3. Un cambio a la vez → commit verificado → siguiente.
4. Si ≥3 hipótesis bloqueadas / ≥10 comandos sin avance → **Informe de atasco**.
5. Prueba real = móvil (datos) → `/send` → overlay Mac. Logs no cuentan.

---

## 📋 Próximos Hitos (MIGRACION-RENDER.md)

- [x] **H0:** Higiene (git, .gitignore, CLAUDE.md, scripts)
- [ ] **H1:** Código mínimo server (PUBLIC_URL, puerto 0.0.0.0, seq Date.now, health ts)
- [ ] **H2:** Deploy Render + GitHub Pages (URLs reales)
- [ ] **H3:** Electron configurable + polling resiliente
- [ ] **H4:** Banner "servidor apagado" + botón "Despertar" en `/send` (sin recargar)
- [ ] **H5:** Ensayo completo cronometrado (móvil + Mac)

---

## 💡 Comandos de Retomar Rápido

```bash
# 1. Ver estado
cat ESTADO.md | head -50

# 2. Ver hipótesis abiertas
grep -A2 "Hipótesis no verificadas" ESTADO.md

# 3. Levantar server local
node server.js

# 4. Test health
curl -s http://localhost:3000/health | jq .

# 5. Build + test Electron
npm run build && env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos
```