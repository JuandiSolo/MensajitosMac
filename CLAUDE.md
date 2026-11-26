# Mensajitos — Instrucciones para Claude Code

> **Proyecto:** App de mensajería romántica en tiempo real  
> **Stack:** **Supabase (Postgres + Storage + Edge Functions)** | Vanilla JS + Electron 30 (desktop) | GitHub Pages (sender UI)  
> **Carpeta canónica:** `/Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos/`

---

## 🚀 Cómo correr el proyecto

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
# Verificar health Supabase
curl -s https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/ | jq .

# Enviar mensaje de prueba directo a Supabase
curl -X POST https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/messages \
  -H 'apikey: sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4' \
  -H 'Authorization: Bearer sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  -d '{"device_id":"juan-macbook","text":"hola desde curl"}'
```

---

## 🏗 Arquitectura Actual (Post-Migración Supabase)

```
┌──────────────────┐   INSERT (anon) + Storage   ┌─────────────────────────┐
│  GitHub Pages    │ ────────────────────────────► │        Supabase         │
│  docs/send.html  │                                │  Postgres: messages     │
│  (Valentina)     │                                │  Storage: bucket media  │
└──────────────────┘                                │  Edge Fn: cleanup (cron)│
                                                     └───────────┬─────────────┘
                                                                 │ RPC pull_messages / ack_messages
                                                                 │ (polling con secreto del receptor)
                                                     ┌───────────▼─────────────┐
                                                     │  Electron (Mac de Juan) │
                                                     │  overlay.html           │
                                                     └─────────────────────────┘
```

### Componentes clave

| Archivo | Responsabilidad |
|---------|-----------------|
| `docs/send.html` + `docs/send.js` | Sender UI (GitHub Pages). Sube imágenes a Storage + INSERT en `messages` via REST |
| `src/overlay.html` | Renderer Electron. IPC `new-message`, `hide-notification`, `resize-overlay` |
| `electron/main.cjs` | Main process: overlay window, tray, polling Supabase RPC, config, single-instance lock |
| `electron/preload.cjs` | contextBridge: expone `resizeOverlay`, `onNewMessage`, `notifyClicked`, `notifyClosed`, `setIgnoreMouse` |
| `supabase/migrations/0001_init.sql` | Tabla `messages`, RLS, schema `private`, RPC `pull_messages`/`ack_messages` |
| `supabase/functions/cleanup/index.ts` | Edge Function: borra mensajes entregados (>12h) y no entregados (>15d) + archivos Storage |

### Device ID
**FIJO:** `juan-macbook` (hardcodeado en `send.js` y `main.cjs`). Sin pairing, sin localStorage.

### Flujo de mensajes
1. **Valentina** (móvil, datos) → `send.html` → sube imagen a Storage (UUID) → `INSERT` en `messages` con `image_path` + `image_url`
2. **Electron** (polling 3s) → `POST /rest/v1/rpc/pull_messages` con `RECEIVER_SECRET` → recibe mensajes `delivered_at IS NULL`
3. **Dedupe** por `id` (Set en memoria) → `queueNotification` → muestra overlay
4. **ACK** tras encolar/mostrar → `POST /rest/v1/rpc/ack_messages` → `delivered_at = now()`
5. **Cleanup** (cron horario) → borra `delivered_at > 12h` o `created_at > 15d` sin entregar → elimina archivos Storage + filas

---

## ⚠️ Workarounds Conocidos (NO tocar sin razón)

| Issue | Workaround | Dónde |
|-------|------------|-------|
| `ELECTRON_RUN_AS_NODE=1` en shell de Claude | `env -u ELECTRON_RUN_AS_NODE` antes de ejecutar build/app | Todos los comandos de test |
| ESM falla en Electron 30+ main/preload | Usar **CommonJS** (`require`, `.cjs`) | `main.cjs`, `preload.cjs` |
| Code signing falla en build | `forceCodeSigning:false, hardenedRuntime:false` en `package.json` | Config build |
| Click-through bloquea toda ventana | `setIgnoreMouseEvents(true, {forward:true})` siempre; enable solo sobre `.card` via IPC | `main.cjs` + `overlay.html` |
| Ventana no aparece tras load | `show: false` en `BrowserWindow` + `show()` explícito tras `resize-overlay` IPC | `main.cjs` |
| Dos instancias = caos | `app.requestSingleInstanceLock()` al inicio de `main.cjs` | `main.cjs` |

---

## 🔐 Seguridad (Modelo simple, sin login)

- **Anon key** (pública, en `docs/send.html`): solo **INSERT** en `messages` + **upload** en bucket `media`. **No puede leer, actualizar ni borrar.**
- **Receptor (Mac)**: lee y confirma via **RPC `SECURITY DEFINER`** que exigen `RECEIVER_SECRET` (≥32 bytes). El secreto vive **solo** en `config.json` (userData) y en tabla `private.receiver` (hash). **Nunca en el repo.**
- **`service_role` key**: solo dentro de Edge Function `cleanup` (secreto de Supabase). **Nunca** en repo, Electron ni Pages.
- Límites en DB y Storage (largo texto ≤1000, tamaño imagen ≤10MB, MIME: jpeg/png/gif/webp).

---

## 🌐 Deploy: URLs de producción

| Entorno | URL | Estado |
|---------|-----|--------|
| **Sender (GitHub Pages)** | `https://juandisol.github.io/MensajitosMac/send.html` | ✅ Activo |
| **Supabase Project** | `https://suupgfhcozmytarrjnhd.supabase.co` | ✅ Activo (región `sa-east-1`) |
| **Supabase Dashboard** | `https://supabase.com/dashboard/project/suupgfhcozmytarrjnhd` | ✅ Activo |
| **Render (rollback)** | `https://mensajitos-api.onrender.com` | ⏳ Mantenido 1 semana |

### Variables de entorno (solo para referencia local)
```env
SUPABASE_URL=https://suupgfhcozmytarrjnhd.supabase.co
SUPABASE_ANON_KEY=sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4
RECEIVER_SECRET=8MnVwyYuoX5rCJi03Q9CIxD4sM+7zqeshKLg6IURU/A=
```

---

## 🔧 Reglas de Desarrollo

1. **Un cambio a la vez** → commit verificado → siguiente
2. **No hardcodear URLs** que cambian: config en `config.json` (prioridad: config > env > defaults públicos; secretos **nunca** tienen default en código)
3. **Polling resiliente:** timeout 10s, ignorar no-JSON, backoff (2s→5s→15s), volver a base al recuperar
4. **Single instance lock** siempre
5. **Test real = móvil (datos) → `send.html` → overlay Mac**. Logs no cuentan.
6. **No declarar "funciona" sin prueba visual completa** (texto + foto + GIF + Mac suspendido + app reiniciada)
7. **Secretos:** solo anon key/URL en repo. `service_role` y `RECEIVER_SECRET` jamás. Revisar `git diff` antes de cada commit.

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
5. Prueba real = móvil (datos) → `send.html` → overlay Mac. Logs no cuentan.

---

## 📋 Historial de Fases (Completado)

- ✅ **F0:** Preparación (Supabase init, link, RECEIVER_SECRET, config.json)
- ✅ **F1:** Base de datos + Storage (migración, bucket, policies, tests)
- ✅ **F2:** Sender (`send.html` + `send.js` → Supabase directo)
- ✅ **F3:** Electron (polling RPC, catch-up, dedupe, ACK, image_url absoluta)
- ✅ **F4:** Borrado automático (Edge Function cleanup + pg_cron schedule)
- ✅ **F5:** Ensayo completo cronometrado (todos los casos validados)
- ✅ **F6:** Retiro Render (package.json limpio, build sin server, legacy/)
- ✅ **F7:** Documentación (este archivo, ESTADO.md, COMO_USAR.md, POSTMORTEM.md)

---

## 💡 Comandos de Retomar Rápido

```bash
# 1. Ver estado
cat ESTADO.md | head -80

# 2. Build + test Electron
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos
npm run build
pkill -f "Mensajitos.app/Contents/MacOS"
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos

# 3. Test Supabase directo
curl -s https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/ | jq .

# 4. Ver logs cleanup
# En Supabase Dashboard → Edge Functions → cleanup → Logs
```