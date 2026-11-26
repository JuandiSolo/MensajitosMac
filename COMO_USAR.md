# Mensajitos — Guía Rápida (Producción con Supabase)

## URLs de producción (fijas, no cambian)

| Componente | URL |
|------------|-----|
| **Sender (Valentina - móvil)** | `https://juandisol.github.io/MensajitosMac/send.html` |
| **Supabase Project** | `https://suupgfhcozmytarrjnhd.supabase.co` |
| **Supabase Dashboard** | `https://supabase.com/dashboard/project/suupgfhcozmytarrjnhd` |

> **Render ya no se usa** (migración completada F6). El servidor Express + Socket.io fue retirado. Supabase maneja DB, Storage y Edge Functions.

---

## Para Juan (Mac) — Configuración inicial (una sola vez)

### 1. Configurar `config.json`
La app busca la configuración en:
```
~/Library/Application Support/mensajitos/config.json
```

**Crea/edita ese archivo** con tus credenciales Supabase:
```json
{
  "supabaseUrl": "https://suupgfhcozmytarrjnhd.supabase.co",
  "supabaseAnonKey": "sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4",
  "receiverSecret": "8MnVwyYuoX5rCJi03Q9CIxD4sM+7zqeshKLg6IURU/A="
}
```

> **Importante:** El `receiverSecret` es un secreto largo (base64 32 bytes). **Nunca lo commitees al repo**. Solo vive en este archivo y en la tabla privada de Supabase (como hash).

### 2. Compilar la app (solo si cambias código Electron)
```bash
cd /Users/juandi/ProyectosClaudeCode/MensajesValentina/mensajitos
npm run build
```

### 3. Ejecutar la app
```bash
# Mata instancias previas y lanza build nuevo
pkill -f "Mensajitos.app/Contents/MacOS"
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos
```

### 4. Verificar que funciona
- En la barra de menú (arriba a la derecha) aparece 💕
- Click en 💕 → "Enviar prueba" → sale notificación en la Mac
- Si falta configuración, verás en el menú: **⚠️ Configuración incompleta**

---

## Para Valentina (Móvil) — Cada vez

### Abre en el navegador (usa **datos móviles**, no wifi de casa)
```
https://juandisol.github.io/MensajitosMac/send.html
```

### Envía mensajes
1. Escribe texto o selecciona foto/GIF (máx 10 MB)
2. Pulsa **"Enviar ahora"**
3. Verás: **✅ Enviado — le llegará cuando abra la app**
4. El mensaje llega a la Mac de Juan **en cuanto abra la app** (o al instante si ya está encendida)

> **Ya NO hay banner "Servidor apagado" ni botón "Despertar"** — Supabase no duerme mientras haya actividad.

---

## Cómo funciona (resumen simple)

| Situación | Qué pasa |
|-----------|----------|
| **Mac encendido (app corriendo)** | Mensajes llegan en **<5 segundos** (polling cada 3s) |
| **Mac apagado / app cerrada** | Mensajes **se guardan en Supabase** (Postgres + Storage) |
| **Juan abre la app** | **Catch-up automático**: llegan todos los mensajes pendientes, en orden |
| **Mensaje entregado** | Se marca `delivered_at` y se **borra a las 12 horas** (incluye imagen) |
| **Mensaje nunca entregado** | Se **borra a los 15 días** automáticamente |

---

## Comandos útiles

```bash
# Ver logs de la app (en terminal donde la ejecutaste)
# Verás: [Main] Queued notification: { id: '...', seq: ..., text: '...', image_url: '...' }

# Verificar Supabase health
curl -s https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/ | jq .

# Enviar mensaje de prueba desde terminal (directo a Supabase)
curl -X POST https://suupgfhcozmytarrjnhd.supabase.co/rest/v1/messages \
  -H 'apikey: sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4' \
  -H 'Authorization: Bearer sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  -d '{"device_id":"juan-macbook","text":"hola desde curl"}'

# Matar todo
pkill -f "Mensajitos.app/Contents/MacOS"

# Recompilar tras cambios en electron/main.cjs o electron/preload.cjs
npm run build
```

---

## Estructura del proyecto (post-migración)

```
mensajitos/
├── package.json                  # Solo electron, electron-builder
├── .gitignore                    # Incluye supabase/.temp, supabase/.env
├── .env.example                  # SUPABASE_URL, SUPABASE_ANON_KEY (sin valores)
├── CLAUDE.md                     # Instrucciones para Claude Code
├── ESTADO.md                     # Estado vivo del proyecto
├── POSTMORTEM.md                 # Lecciones aprendidas
├── COMO_USAR.md                  # Este archivo
├── PLAN_SUPABASE.md              # Plan de migración (referencia)
├── src/
│   ├── overlay.html              # Renderer: notificación overlay
│   └── icon.png                  # Tray icon
├── electron/
│   ├── main.cjs                  # Proceso principal: overlay + tray + polling Supabase RPC
│   └── preload.cjs               # contextBridge → renderer
├── docs/
│   ├── send.html                 # GitHub Pages sender (Valentina)
│   └── send.js                   # Lógica envío → Supabase REST + Storage
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql         # Tabla messages, RLS, RPC, schema private
│   ├── functions/
│   │   └── cleanup/index.ts      # Edge Function: retención 12h/15d + borrado Storage
│   └── storage_setup.sql         # Bucket media + policies
├── legacy/                       # Código Render retirado (F6)
│   ├── server.js
│   ├── render.yaml
│   └── scripts/
└── dist/
    └── mac-arm64/
        └── Mensajitos.app        # App funcional
```

---

## Desarrollo local (opcional)

```bash
# Solo Electron (usa Supabase remoto directo)
npm run build
pkill -f "Mensajitos.app/Contents/MacOS"
env -u ELECTRON_RUN_AS_NODE ./dist/mac-arm64/Mensajitos.app/Contents/MacOS/Mensajitos
```

> No hay server local que levantar — todo va contra Supabase en la nube.

---

## Solución de problemas

| Problema | Qué revisar |
|----------|-------------|
| **"Configuración incompleta" en tray** | Verifica `~/Library/Application Support/mensajitos/config.json` tiene las 3 claves |
| **Mensajes no llegan** | 1. ¿App corriendo? 2. ¿`config.json` correcto? 3. ¿Supabase project activo? (Dashboard → Database) |
| **Imágenes no se ven** | Verifica bucket `media` existe en Supabase Dashboard → Storage |
| **App no compila** | `rm -rf node_modules package-lock.json && npm install && npm run build` |
| **Doble notificación** | Solo una instancia permitida — `pkill -f "Mensajitos.app"` antes de lanzar |