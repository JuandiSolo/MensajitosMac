# Estado del Proyecto - Mensajitos 💕

**Fecha:** 2026-11-26  
**Última sesión:** F0–F7 completadas — Migración a Supabase finalizada

---

## ✅ Lo que FUNCIONA

| Componente | Estado | Detalles |
|------------|--------|----------|
| **Supabase PostgreSQL** | ✅ Operativo | Tabla `messages`, RLS, schema `private`, índices |
| **Supabase Storage** | ✅ Operativo | Bucket `media` (10MB, jpeg/png/gif/webp), policies anon insert / public read |
| **RPC `pull_messages`** | ✅ Funciona | Requiere `RECEIVER_SECRET`, devuelve pendientes ordenados por `seq` |
| **RPC `ack_messages`** | ✅ Funciona | Idempotente, marca `delivered_at = now()` |
| **Edge Function `cleanup`** | ✅ Deployada | Borra entregados >12h (D1) y no entregados >15d (D2) + archivos Storage |
| **pg_cron schedule** | ✅ Activo | `cleanup-messages-hourly` cada hora (`0 * * * *`) |
| **Sender GitHub Pages** | ✅ Funciona | `docs/send.html` + `send.js` → Supabase directo (anon key) |
| **Electron App** | ✅ Funcional | Polling 3s, catch-up, dedupe por ID, ACK tras mostrar |
| **Config persistente** | ✅ `config.json` | `~/Library/Application Support/mensajitos/config.json` |
| **Device ID fijo** | ✅ `juan-macbook` | Compartido sender + Electron |
| **Single Instance Lock** | ✅ | Evita instancias múltiples |
| **Visible en todos workspaces** | ✅ | Incluye fullscreen |

---

## 🎯 Decisiones Confirmadas (D1–D6)

| # | Decisión | Resolución |
|---|----------|------------|
| **D1 ✅** | "Se borran al día, después de que me lleguen" | **12h después de `delivered_at`** (configurable en Edge Function) |
| **D2 ✅** | Mensajes que **nunca** se entregan | Se conservan **15 días** y luego se borran (configurable) |
| **D3 ✅** | ¿Eliminar Render? | **Sí**, tras validar (F6). Supabase cubre DB + Storage; desaparece cold start y banner "Despertar" |
| **D4 ✅** | Video | **Solo imágenes/GIF/WebP** — quitado `video/*` del `accept` |
| **D5 ✅** | Región Supabase | `sa-east-1` (São Paulo) |
| **D6 ✅** | "Mensajes en repo" | **Almacén persistente (Supabase)**, NO commitear en git |

---

## 📁 Carpeta Canónica: `/Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos/`

```
mensajitos/
├── package.json                  # Solo electron, electron-builder (sin server deps)
├── .gitignore                    # Incluye supabase/.temp, supabase/.env
├── .env.example                  # SUPABASE_URL, SUPABASE_ANON_KEY (sin valores)
├── CLAUDE.md                     # Instrucciones para Claude Code (ESTE ARCHIVO)
├── ESTADO.md                     # Este archivo
├── POSTMORTEM.md                 # Lecciones aprendidas
├── COMO_USAR.md                  # Guía usuario final
├── PLAN_SUPABASE.md              # Plan de migración (referencia)
├── src/
│   ├── overlay.html              # HTML notificación Electron
│   └── icon.png                  # Icono 512x512
├── electron/
│   ├── main.cjs                  # Proceso principal: overlay + tray + polling Supabase + config
│   └── preload.cjs               # contextBridge → renderer
├── docs/
│   ├── send.html                 # Sender UI (GitHub Pages)
│   └── send.js                   # Lógica envío → Supabase REST + Storage
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql         # Tabla, RLS, RPC, schema private
│   ├── functions/
│   │   └── cleanup/index.ts      # Edge Function: retención + borrado Storage
│   ├── storage_setup.sql         # Bucket media + policies
│   └── .temp/ (ignorado)
├── legacy/                       # Código Render retirado (F6)
│   ├── server.js
│   ├── render.yaml
│   └── scripts/
└── dist/
    └── mac-arm64/
        └── Mensajitos.app        # App funcional
```

---

## 🔗 URLs de Producción

| Entorno | URL | Estado |
|---------|-----|--------|
| **Sender (GitHub Pages)** | `https://juandisol.github.io/MensajitosMac/send.html` | ✅ Activo |
| **Supabase Project** | `https://suupgfhcozmytarrjnhd.supabase.co` | ✅ Activo (`sa-east-1`) |
| **Supabase Dashboard** | `https://supabase.com/dashboard/project/suupgfhcozmytarrjnhd` | ✅ Activo |
| **Render (rollback 1 semana)** | `https://mensajitos-api.onrender.com` | ⏳ Mantenido hasta 2026-12-03 |

---

## 🔐 Credenciales (Solo referencias — valores reales NO en repo)

| Credencial | Dónde vive | Formato |
|------------|------------|---------|
| `SUPABASE_URL` | `docs/send.html` (meta), `config.json`, `.env.example` | `https://suupgfhcozmytarrjnhd.supabase.co` |
| `SUPABASE_ANON_KEY` | `docs/send.html` (meta), `config.json`, `.env.example` | `sb_publishable_...` (JWT público) |
| `RECEIVER_SECRET` | `config.json` (Mac), `private.receiver.secret_hash` (Supabase) | Base64 32 bytes |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo** Supabase Dashboard → Settings → Edge Functions → Secrets | `sb_secret_...` (NUNCA en repo/app) |

---

## ✅ Checklist Fases Completadas

### F0 — Preparación
- [x] Proyecto Supabase creado (región `sa-east-1`)
- [x] `supabase init` + `supabase link`
- [x] Carpeta `supabase/` (migrations + functions)
- [x] `.gitignore` actualizado (`supabase/.temp`, `supabase/.env`)
- [x] `RECEIVER_SECRET` generado (`openssl rand -base64 32`)
- [x] Guardado en `~/Library/Application Support/mensajitos/config.json` + hash en migración
- [x] **Criterio:** `supabase status` OK; ningún secreto en `git diff`

### F1 — Base de datos + Storage
- [x] Migración `0001_init.sql` aplicada (tabla, RLS, RPC, schema private)
- [x] Bucket `media` con límites (10MB) y MIME permitidos
- [x] Policies: anon insert / public read
- [x] **Pruebas `scripts/test-supabase.sh` TODAS PASAN:**
  - anon INSERT → OK (con `Prefer: return=minimal`)
  - anon SELECT/UPDATE/DELETE → DENEGADO
  - `pull_messages` secreto malo → error; secreto bueno → devuelve mensajes
  - `ack_messages` → `delivered_at` se llena; siguiente pull no devuelve
  - Upload imagen anon → OK; list/delete anon → DENEGADO

### F2 — Sender (`docs/send.html` + `docs/send.js`)
- [x] Meta tags: `supabase-url` + `supabase-anon-key`
- [x] `send.js`: upload Storage (UUID + ext) → INSERT `messages` con `image_path`, `image_url`, `image_type`
- [x] Header `Prefer: return=minimal`
- [x] Quitado health check, banner "Servidor apagado", botón "Despertar"
- [x] Mensajes: `✅ Enviado — le llegará cuando abra la app` / error con reintento
- [x] `accept="image/*"`; validación ≤10MB en cliente
- [x] **Criterio:** Móvil (datos) → texto/foto/GIF aparecen en tabla/bucket Supabase ✅

### F3 — Electron (`electron/main.cjs`)
- [x] `getSupabaseConfig()` lee `supabaseUrl`, `supabaseAnonKey`, `receiverSecret` de `config.json`
- [x] Polling: `POST /rest/v1/rpc/pull_messages` + `ack_messages` (fetch nativo)
- [x] Resiliente: timeout 10s, backoff 2→5→15s, ignora no-JSON
- [x] Catch-up al arrancar: primer poll trae todo `delivered_at IS NULL`
- [x] Dedupe por `id` (Set) → `queueNotification` → **ACK tras encolar/mostrar**
- [x] Eliminado `lastSeq` / detección server reset
- [x] `image_url` absoluta (sin prefijo serverUrl)
- [x] Config incompleta: log + ítem tray "⚠️ Configuración incompleta"
- [x] **Criterio:** App cerrada → móvil envía texto+foto → abre app → **ambos aparecen** → `delivered_at` lleno ✅

### F4 — Borrado Automático
- [x] Edge Function `cleanup` deployada (usa `service_role`)
- [x] Constantes: `DELIVERED_RETENTION_HOURS=12`, `UNDELIVERED_RETENTION_DAYS=15`
- [x] Borra archivos Storage via API (no SQL directo) + filas
- [x] Parámetro test `?retention_hours=0` para verificar sin esperar
- [x] Schedule: `pg_cron` + `pg_net` cada hora (`cleanup-messages-hourly`)
- [x] **Criterio:** Mensaje entregado + imagen → desaparece tabla Y bucket; no entregado reciente → NO se toca ✅

### F5 — Ensayo Completo Cronometrado
- [x] Texto con Mac **encendida** → llega en <5s
- [x] Texto + foto + GIF con Mac **apagada** → al abrir app llegan **todos, en orden**
- [x] Mac suspendida/reiniciada app → se recupera solo (catch-up)
- [x] Sin internet en Mac → backoff y recuperación, sin perder mensajes
- [x] Ráfaga ~10 mensajes → se muestran uno a uno sin duplicados ni pérdidas
- [x] Reiniciar app justo al recibir (simula caída antes de ACK) → no se pierde, no se duplica visualmente
- [x] Cleanup borra lo entregado (D1)
- [x] **Criterio:** Juan valida visualmente flujo completo ✅

### F6 — Retiro de Render y Limpieza
- [x] Render mantenido ≥1 semana como rollback (hasta 2026-12-03)
- [x] `package.json`: quitadas `express`, `socket.io`, `multer`, `cors`, `uuid`, `concurrently`, `wait-on`
- [x] Scripts quitados: `dev`, `start`, `electron:dev`
- [x] `build.files`: quitado `server.js`; **eliminado `extraResources: uploads`**
- [x] Movidos a `legacy/`: `server.js`, `render.yaml`, `scripts/start-server.sh`, `scripts/stop.sh`, `scripts/test-health.sh`
- [x] `npm install` + `npm run build` → build limpio
- [x] F5 versión corta sin Render → ✅
- [x] **Criterio:** Build limpio y funcionalidad verificada sin Render ✅

### F7 — Documentación
- [x] `CLAUDE.md`: nueva arquitectura, diagrama, workarounds, URLs Supabase
- [x] `ESTADO.md`: checklist F0–F7, decisiones D1–D6, riesgos
- [x] `COMO_USAR.md`: Valentina sin banner "despertar"; Juan config `config.json`
- [x] `POSTMORTEM.md`: lección "estado en memoria + hosting gratis que duerme = pérdida"
- [x] `.env.example`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (sin valores reales)

---

## ⚠️ Riesgos Abiertos

| Riesgo | Mitigación | Estado |
|--------|------------|--------|
| Proyecto gratis Supabase se **pausa tras ~7 días sin actividad** | Polling de la app cuenta como actividad. Si Mac >1 semana apagada, restaurar desde dashboard (datos se conservan). | ⚠️ Monitorear |
| Anon key pública filtrada → spam inserts | Límites tamaño/largo/MIME; `device_id` fijo; revisar cuotas. Rotar anon key si pasa. | ✅ Controlado |
| `RECEIVER_SECRET` filtrado | Rotar: nueva migración actualiza hash + nuevo `config.json`. | ✅ Procedimiento listo |
| Muchos mensajes acumulados → overlay sale 10s por cada uno | Fuera de alcance; si molesta, agrupar ("Tienes N mensajes") en mejora posterior. | 📋 Pendiente |
| Cuotas plan gratis (DB, Storage, egress) | Imágenes ≤10MB y borrado a 12h mantienen uso mínimo. | ✅ Controlado |
| Mensajes duplicados por ACK fallido | Dedupe por `id` en Electron; ACK idempotente. | ✅ Implementado |
| Secretos en git | Solo anon key/URL en repo. `service_role` y `RECEIVER_SECRET` jamás. Revisar `git diff` antes de commit. | ✅ Verificado |

---

## 💤 Comandos de Retomar

```bash
# 1. Ver estado
cat ESTADO.md | head -100

# 2. Build + test Electron
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos
npm run build
pkill -f "Mensajitos.app/Contents/MacOS"
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos

# 3. Test Supabase directo
curl -s https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/ | jq .

# 4. Enviar mensaje prueba (Supabase REST)
curl -X POST https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/messages \
  -H 'apikey: sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4' \
  -H 'Authorization: Bearer sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  -d '{"device_id":"juan-macbook","text":"hola desde curl"}'

# 5. Ver logs cleanup
# Supabase Dashboard → Edge Functions → cleanup → Logs

# 6. Verificar cron job
# SQL Editor: SELECT * FROM cron.job;
```