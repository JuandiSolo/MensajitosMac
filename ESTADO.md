# Estado del Proyecto - Mensajitos 💕

**Fecha:** 2026-11-22  
**Última sesión:** Decisiones A2 + B1 tomadas, iniciando H0/H1

---

## ✅ Lo que FUNCIONA

| Componente | Estado | Detalles |
|------------|--------|----------|
| **Server Express + Socket.io** | ✅ Corriendo | Puerto 3000 local |
| **API REST** | ✅ Operativa | `/api/send`, `/api/upload`, `/api/poll/:deviceId`, `/health` |
| **UI Web de envío** | ✅ Lista | `/send` inline en server.js |
| **Polling Electron → Server** | ✅ Funciona end-to-end | Logs confirman flujo completo |
| **Tray icon + menú** | ✅ Aparece | "Enviar prueba" / "Salir" / Device ID |
| **overlay.html** | ✅ Adaptado | Compatible Electron (IPC + fallback browser) |
| **electron/main.cjs** | ✅ Creado | Ventana overlay + tray + polling + IPC |
| **electron/preload.cjs** | ✅ Creado | contextBridge → renderer |
| **Electron build** | ✅ Funciona | `npm run build` genera `.app` funcional |
| **Device ID fijo** | ✅ `juan-macbook` | Compartido app + web UI |
| **serverUrl en config.json** | ✅ Persistente | `~/Library/Application Support/mensajitos/config.json` |
| **Visible en todos workspaces** | ✅ | Incluye fullscreen |
| **Single Instance Lock** | ✅ | Evita instancias múltiples |

---

## 🎯 Decisiones Tomadas (Sección 2 de MIGRACION-RENDER.md)

| Decisión | Opción | Razón |
|----------|--------|-------|
| **A. ¿Dónde vive `/send`?** | **A2: GitHub Pages** | Carga instantánea, banner "despertar" siempre visible, desacopla UI de API |
| **B. Pérdida en plan gratis** | **B1: Aceptar + avisar** | $0, simple. Mensajes con Mac apagado >15 min se pierden. Subir a B2/B3 solo si duele. |

---

## 📁 Carpeta Canónica: `/Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos/`

```
mensajitos/
├── server.js                     # Express + Socket.io (PUERTO 3000 local)
├── package.json                  # Dependencias Electron + server
├── src/
│   ├── overlay.html              # HTML notificación Electron
│   └── icon.png                  # Icono 512x512
├── electron/
│   ├── main.cjs                  # Proceso principal: overlay + tray + polling + config
│   └── preload.cjs               # contextBridge → renderer
├── uploads/                      # Imágenes subidas (efímero en Render gratis)
├── dist/
│   └── mac-arm64/
│       └── Mensajitos.app        # App funcional
├── .gitignore                    # node_modules, uploads, dist, config.json, .env
├── CLAUDE.md                     # Instrucciones para Claude Code (ESTE ARCHIVO)
├── ESTADO.md                     # Este archivo
├── POSTMORTEM.md                 # Lecciones aprendidas
├── COMO_USAR.md                  # Guía usuario final
└── MIGRACION-RENDER.md           # Plan de migración (referencia)
```

---

## 🔧 Código Clave

### `electron/main.cjs` — Polling actual
- **Intervalo:** 2s (`POLL_INTERVAL`)
- **Endpoint:** `GET ${serverUrl}/api/poll/${deviceId}?since=${lastSeq}`
- **Seq:** Monotónico, detección reset servidor (`maxSeq <= lastSeq → lastSeq = 0`)
- **Timeout:** **NINGUNO** (riesgo H-5)
- **Error handling:** Solo `console.error`, continúa

### `server.js` — Endpoints clave
- `POST /api/send` → `{to, from, avatar, text, image_url, image_type}` → entrega inmediata o cola
- `POST /api/upload` → multer → devuelve `{url, type, originalName}` (usa `PUBLIC_URL`)
- `GET /api/poll/:deviceId?since=` → mensajes con `seq > since` (ack implícito borra entregados)
- `GET /health` → `{ok: true, devices, pending}` (falta `ts: Date.now()`)

---

## 🚀 Próximos Hitos (MIGRACION-RENDER.md)

### H0: Higiene (COMPLETADO ✅)
- [x] `.gitignore` completo
- [x] `CLAUDE.md` creado
- [x] `ESTADO.md` actualizado
- [x] `POSTMORTEM.md` ya existe
- [x] `scripts/`: `start-server.sh`, `stop.sh`, `test-health.sh`
- [ ] **Fijar nombre servicio Render** (URL = `https://<nombre>.onrender.com`)

### H1: Código mínimo server (COMPLETADO ✅)
- [x] `PUBLIC_URL` leída en **un solo punto** (línea 11); URLs imagen completadas en **un solo punto** (línea 98)
- [x] Puerto: `process.env.PORT || 3000`, escuchando en `0.0.0.0` (línea 542)
- [x] `/health` devuelve `{ ok: true, ts: Date.now(), ... }` (línea 174)
- [x] `seq` inicia en `Date.now()` (línea 46)
- [x] `.env.example` con `PUBLIC_URL`, `NODE_ENV`
- *Commit:* `H0+H1: Higiene + código mínimo server (PUBLIC_URL centralizada, health con ts, puerto 0.0.0.0)` — 705f7e9

### H2: Deploy Render + GitHub Pages (API ✅ COMPLETADA)
- [x] Repo en GitHub: https://github.com/JuandiSolo/MensajitosMac.git (privado)
- [x] GitHub Pages sender: `docs/send.html` + `docs/send.js` (commit 8f4e71d)
- [x] CORS en server para `https://juandisol.github.io` + localhost
- [x] **Render: Servicio "mensajitos-api" FUNCIONANDO**
    - URL: `https://mensajitos-api.onrender.com`
    - Health: `{"ok":true,"ts":...}` ✅
    - Commit desplegado: `11f7409` (con package.json, electron/, src/)
- [ ] **GitHub Pages: Activar en Settings → Pages**
    - Source: Deploy from branch → master → /docs
    - URL resultante: `https://juandisol.github.io/MensajitosMac/send.html`
- [ ] Actualizar `<meta name="api-base">` en `docs/send.html` con URL real de Render
- *Commits:* `H2: GitHub Pages sender + CORS` (8f4e71d) → `fix: añadir package.json...` (11f7409)

### H3: Electron configurable + polling resiliente (COMPLETADO ✅)
- [x] `DEFAULT_SERVER_URL` en un solo lugar (línea 19); prioridad `config > env > DEFAULT`
- [x] Polling: timeout 10s (`POLL_TIMEOUT_MS`), ignorar no-JSON (try/catch + validar array), backoff 2s→5s→15s (`BACKOFF_STEPS`), vuelve a 2s al recuperar
- [x] Nunca cierra app ni muestra error al usuario por fallo de red (solo log + backoff)
- *Commit:* `H3: Electron configurable + polling resiliente (timeout, backoff, ignora HTML)` — ac8d6a3

### H4: Banner "servidor apagado" + botón "Despertar" (COMPLETADO ✅)
- [x] Ya implementado en `docs/send.js` (check adaptativo 15s/3s, botón despertar, sin recargar)
- *Integrado en H2*

### H5: Ensayo completo (COMPLETADO ✅ - 2026-11-23)
- [x] Texto: móvil (datos) → send.html → Render API → Electron overlay ✅
- [x] Foto/GIF: probado en flujos anteriores ✅
- [x] Servidor dormido >15 min → banner "Despertar" funciona ✅
- [x] Reinicio manual Render → Electron se recupera solo (backoff H3) ✅
- [x] Mac suspendido/reanudado → Electron se recupera solo ✅
- [x] Mensaje con Mac apagado: se pierde tras 15 min (decisión B1 confirmada) ✅
- *Resultado: Flujo completo validado por el usuario*

---

## 🔗 URLs (Actualizar tras H2)

| Entorno | URL | Estado |
|---------|-----|--------|
| Local server | `http://localhost:3000` | ✅ Funciona |
| Local `/send` | `http://localhost:3000/send` | ✅ Funciona |
| Local `/health` | `http://localhost:3000/health` | ✅ Funciona |
| **Render API** | `https://<nombre>.onrender.com` | ⏳ Pendiente H2 |
| **Render `/health`** | `https://<nombre>.onrender.com/health` | ⏳ Pendiente H2 |
| **GitHub Pages `/send`** | `https://<usuario>.github.io/<repo>/send.html` | ⏳ Pendiente H2 |

---

## 📋 Estado de Hipótesis (Sección 3 MIGRACION-RENDER.md)

| Hipótesis | Estado | Prueba pendiente |
|-----------|--------|------------------|
| **H-1** `process.env.PORT` en server | ✅ Confirmado (línea 541) | — |
| **H-2** Bug backtick `imageUrl` | ✅ No existe (`node --check` OK) | — |
| **H-3** Polling 2s evita cold start | 🟡 **No probado** | Deploy Render + dejar Electron >20 min |
| **H-4** Render devuelve HTML en cold start | ❓ **No probado** | `curl /health` tras >15 min inactivo |
| **H-5** Polling tolera HTML/timeouts | ⚠️ **RIESGO CONFIRMADO** — Fix en H3 | Sin timeout, `response.json()` lanza en HTML, solo `console.error` |
| **Render gratis duerme 15 min** | 🟡 Documentado | Confirmar en producción |
| **Precio Render pago / Supabase** | ❓ No verificado | Verificar si se escala a B2/B3 |

---

## 💤 Comandos de Retomar

```bash
# 1. Ver estado
cat ESTADO.md | head -80

# 2. Levantar server local
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos && node server.js

# 3. Test health local
curl -s http://localhost:3000/health | jq .

# 4. Build + test Electron
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos
npm run build
pkill -f "Mensajitos.app/Contents/MacOS"
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos

# 5. Enviar mensaje prueba (local)
curl -X POST http://localhost:3000/api/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"hola desde curl"}'
```

---

## ⚠️ Riesgos Abiertos

1. **H-5: Polling frágil** — Sin timeout, `fetch` puede colgarse; `response.json()` falla con HTML de Render cold start. **Fix en H3.**
2. **PUBLIC_URL en 2 lugares** — server.js:97 y electron/main.cjs:198. **Centralizar en H1.**
3. **GitHub Pages + CORS** — Server debe permitir origen GitHub Pages. **Configurar en H2.**
4. **Nombre servicio Render** — Si está tomado, Render añade sufijo. URL real solo se conoce en H2. **Definir nombre ya.**