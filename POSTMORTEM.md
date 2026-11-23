# Post-Mortem: Mensajitos 💕

**Proyecto:** App de notificaciones desktop (Electron) + web sender + polling backend  
**Duración:** ~3-4 sesiones de trabajo  
**Resultado:** App funcional, build nativo, tray, overlay exacto, single-instance, GIF/WebP

---

## 🎯 Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| **Líneas de código final** | ~500 (main.cjs + overlay.html + server.js + preload.cjs) |
| **Builds fallidos** | ~8-10 antes del que funcionó |
| **Bugs críticos resueltos** | 6 (imports, signing, ELECTRON_RUN_AS_NODE, seq reset, click-through, multi-instancia) |
| **Cambio de stack** | Tauri → Electron (decisión clave) |
| **Tiempo "perdido" en debugging** | ~60-70% del tiempo total |

---

## ✅ Lo que FUE BIEN

### 1. Decisión temprana: **Electron sobre Tauri**
- Tauri 2.x crasheaba en macOS (WebKit bug conocido)
- Electron 30.5.1: "funciona y ya" — Chromium estable, overlays robustos
- **Lección:** Si el framework nativo falla en plataformas objetivo, cambia temprano. No insistas.

### 2. CommonJS (`require`) desde el inicio en Electron
- Electron 30+ tiene problemas con ESM en main process
- `require('electron')` funcionó en dev Y en build
- **Lección:** En Electron, usa CommonJS en main/preload. ESO ES TODO.

### 3. Device ID FIJO (`juan-macbook`)
- Eliminó todo el caos de localStorage, UUIDs aleatorios, registro
- Compartido app + web UI sin sincronización
- **Lección:** IDs fijos simples > sistemas complejos de device registration.

### 4. Polling basado en **sequence number (seq)** no timestamp
- `globalSeq = Date.now()` en server (monotónico across restarts)
- Detección de reset en cliente (`maxSeq <= lastSeq → lastSeq = 0`)
- **Lección:** Seq > timestamps para polling confiable.

### 5. Click-through granular (mouseenter/leave en tarjeta vía IPC)
- Ventana siempre `setIgnoreMouseEvents(true)`
- Solo habilita mouse sobre `.card` via `set-ignore-mouse` IPC
- **Lección:** Click-through total + enable selectivo > toggle ventana completa.

### 6. ResizeObserver en renderer → IPC `resize-overlay`
- Ventana se ajusta EXACTO al contenido (texto, foto, GIF)
- `useContentSize: true` + `invalidateShadow()` para sombra nativa
- **Lección:** Renderer mide, main aplica. No midas en main.

### 7. Single Instance Lock (`requestSingleInstanceLock`)
- Evita instancias múltiples = tarjetas superpuestas, mensajes perdidos, estilos viejos
- Segunda instancia imprime mensaje y sale limpio
- **Lección:** Ponlo ANTES de `app.whenReady()`. Envuelve TODO el arranque.

---

## 🐛 Bugs que NOS DEMORARON MÁS (y cómo evitarlos)

| Bug | Tiempo perdido | Causa raíz | Prevención |
|-----|----------------|------------|------------|
| **`electron` export named 'BrowserWindow'** | ~2 hrs | Intentar ESM `import { BrowserWindow } from 'electron'` | **Usa CommonJS siempre en main/preload** |
| **Build .app sale即可 (exit code 0, sin logs)** | ~3 hrs | `ELECTRON_RUN_AS_NODE=1` en shell de Claude | **`env -u ELECTRON_RUN_AS_NODE` SIEMPRE antes de probar build** |
| **Code signing "timestamp service not available"** | ~1 hr | electron-builder default intenta firmar | `forceCodeSigning:false, hardenedRuntime:false` en package.json |
| **Server restart → mensajes perdidos** | ~1 hr | `globalSeq = 0` se reseteaba | `globalSeq = Date.now()` + detección reset en cliente |
| **Click-through bloqueaba TODA la ventana** | ~1.5 hrs | `setIgnoreMouseEvents(false)` al mostrar | Click-through SIEMPRE on; enable solo sobre card via IPC |
| **Ventana 380px vs card 340px → scroll/franjas** | ~1 hr | Padding body + flex + ancho mismatch | `body{width:340px;padding:0}`, `WIN_W=340`, `useContentSize:true` |
| **Dos instancias abiertas → caos** | ~30 min | Sin single instance lock | `app.requestSingleInstanceLock()` al inicio del main |

**Patrón común:** La mayoría eran **problemas de entorno/build de Electron**, no lógica de negocio.

---

## ⚡ Momentos de VELOCIDAD vs LENTITUD

### 🚀 Rápido (decisiones correctas + tooling)
- Setup inicial Express + Socket.io + multer: **15 min**
- UI web sender (`/send`): **20 min** (HTML inline en server.js)
- Polling endpoint `/api/poll/:deviceId?since=`: **10 min**
- Tray icon + menú: **15 min**
- ResizeObserver + IPC resize: **20 min** (patrón claro)
- Single instance lock: **5 min** (API directa de Electron)

### 🐌 Lento (debugging de entorno)
- **Build Electron funcionando:** ~3-4 intentos fallidos
- **ELECTRON_RUN_AS_NODE:** No documentado en ningún lado, descubierto por prueba/error
- **CommonJS vs ESM:** Probado ESM primero, falló, revertido
- **Click-through correcto:** 3 iteraciones (toggle ventana → toggle card → ResizeObserver)

---

## 🤔 Decisiones que REVISARÍA

### 1. **No probar el build nativo TEMPRANO**
- Esperamos demasiado para hacer `npm run build` y probar el `.app`
- Debería ser: **build + test real cada 30-60 min** durante desarrollo
- Dev mode (`electron .`) ≠ Build mode (asar, paths, env vars)

### 2. **No documentar `ELECTRON_RUN_AS_NODE` en CLAUDE.md**
- Este env var rompe builds en Claude Code shell
- Debería estar en instrucciones globales: `env -u ELECTRON_RUN_AS_NODE` obligatorio

### 3. **Overlay.html muy acoplado a Electron al inicio**
- Fallback `window.addEventListener('message')` para browser testing ayudó
- Pero mejor: **desarrollar overlay en browser primero**, integrar IPC después

### 4. **Config hardcodeada en main.cjs (`FIXED_DEVICE_ID`)**
- Funciona para 1 usuario, pero no escala
- Para futuro: CLI arg o config.json para deviceId

### 5. **Server en mismo repo que app**
- Acoplamiento innecesario
- Mejor: repos separados, versionados independientemente

---

## 📋 Checklist para PRÓXIMOS PROYECTOS Electron + Claude Code

### Setup Inicial (hacer ANTES de escribir código)
- [ ] `package.json`: `electron` en `devDependencies`, `asar:true`, `forceCodeSigning:false`
- [ ] `main.cjs` + `preload.cjs` (CommonJS, `.cjs` extension)
- [ ] `env -u ELECTRON_RUN_AS_NODE` en todos los comandos de test
- [ ] `app.requestSingleInstanceLock()` al inicio de main
- [ ] Build script que funcione: `npm run build` → test `.app` real

### Desarrollo Iterativo
- [ ] **Build + test real cada cambio significativo** (no solo `electron .`)
- [ ] Overlay/renderer: desarrollar en browser con mock IPC → integrar
- [ ] Logs `console.error` (no `console.log`) para ver en terminal
- [ ] `pkill` script en README/COMO_USAR desde día 1

### Comunicación con Usuario
- [ ] **Preguntar ANTES de decisiones irreversibles:** stack (Tauri vs Electron), arch (monorepo vs separate), device ID strategy
- [ ] **Mostrar opciones con tradeoffs**, no solo "esto funciona"
- [ ] **Confirmar antes de refactors grandes** (ej. click-through rewrite)
- [ ] **Entregar artefactos testables** (scripts, curl commands) no solo "está listo"

### Debugging Patterns
- [ ] Si build falla silenciosamente → revisar `ELECTRON_RUN_AS_NODE`
- [ ] Si imports fallan → CommonJS `require('electron')`
- [ ] Si signing falla → `forceCodeSigning:false`
- [ ] Si ventana no aparece → `show: false` + `show()` explícito tras load
- [ ] Si click-through raro → `setIgnoreMouseEvents(true, {forward:true})` siempre, enable selectivo via IPC

---

## 🎓 Lecciones Generales para Desarrollo con Claude Code

### 1. **El entorno de Claude Code ≠ tu terminal**
- Variables de entorno extrañas (`ELECTRON_RUN_AS_NODE=1`)
- Paths distintos, shells distintos
- **Siempre testea el build real en TU terminal, no en la de Claude**

### 2. **Los hooks de Claude Code reescriben comandos**
- `git status` → `rtk git status` (token saver)
- A veces interfiere con env vars o paths
- **Usa `env -u VAR comando` para limpiar**

### 3. **Documenta CADA workaround en CLAUDE.md o POSTMORTEM**
- `ELECTRON_RUN_AS_NODE` costó 3 horas, ahora está documentado
- La próxima vez: 0 horas

### 4. **Pide confirmación en decisiones de arquitectura**
- "¿Tauri o Electron?" → usuario eligió Electron → ahorró días
- "¿Device ID fijo o dinámico?" → fijo → simplificó todo
- **No asumas, pregunta con opciones claras**

### 5. **Entrega comandos copiables, no explicaciones**
- Usuario quiere: `curl ...`, `pkill ...`, `npm run build`
- No: "hay que hacer un build y luego testear"

### 6. **Mantén un ESTADO.md vivo**
- Este proyecto: ESTADO.md fue la única fuente de verdad al retomar
- Actualízalo CADA sesión, no al final

### 7. **Separa "hacer" de "explicar"**
- Modo ejecución: escribe código, build, test
- Modo reporte: resume, documenta, analiza
- **No mezcles** — confunde al usuario y pierde contexto

---

## 📦 Estructura Final Recomendada para Proyectos Similares

```
/proyecto/
├── CLAUDE.md                 # Instrucciones globales + workarounds conocidos
├── POSTMORTEM.md             # Este archivo (actualizar por proyecto)
├── COMO_USAR.md              # 3 pasos: server, app, celular
├── ESTADO.md                 # Checklist vivo, URLs, comandos de retomar
├── app/                      # Electron app (main.cjs, preload.cjs, src/)
│   ├── electron/
│   └── src/
├── server/                   # Backend separado (package.json propio)
│   ├── server.js
│   └── package.json
└── scripts/
    ├── build.sh              # npm run build + test .app
    ├── start.sh              # pkill + server + app
    └── test.sh               # curl commands para verificar
```

---

## 🏁 Conclusión

**Lo que hizo que este proyecto terminara bien:**
1. Usuario tomó decisiones clave temprano (Electron, device ID fijo)
2. Persistencia en hacer build real funcionar (no rendirse en dev mode)
3. Patrones correctos al final: CommonJS, seq polling, ResizeObserver, single-instance

**Lo que habría ahorrado 50% del tiempo:**
1. `npm run build` + test real cada 30 min desde minuto 1
2. `ELECTRON_RUN_AS_NODE` documentado en CLAUDE.md global
3. Preguntar stack (Tauri vs Electron) en mensaje 1, no mensaje 5
4. Overlay desarrollado en browser primero, IPC después

**Para la próxima:** Empieza con `POSTMORTEM.md` del proyecto anterior como checklist.

---

## 🌐 Migración a Render + GitHub Pages (Sesión Final)

### Decisiones clave (A2 + B1)

| Decisión | Opción | Resultado |
|----------|--------|-----------|
| **A. ¿Dónde vive `/send`?** | A2: GitHub Pages estático | ✅ Carga instantánea, banner "despertar" siempre, desacoplado de API |
| **B. Pérdida en plan gratis** | B1: Aceptar + avisar | ✅ $0, simple. Mensajes con Mac apagado >15 min se pierden |

### Bugs nuevos resueltos en migración

| Bug | Tiempo | Causa raíz | Prevención |
|-----|--------|------------|------------|
| **Render no encuentra `package.json`** | ~2 hrs | Archivos nunca `git add` (src/, electron/, package.json) | **`git ls-files` ANTES de deploy**; verificar commit remoto |
| **CORS typo: `juandisol` vs `juandisolo`** | ~30 min | Copy-paste sin verificar username GitHub | Verificar `curl -H "Origin: ..."` ANTES de probar UI |
| **Blueprint Render ignora `rootDir`** | ~1 hr | Bug conocido: Blueprint usa `src/` por defecto | **Web Service manual** (UI) respeta Root Directory; Blueprint no |
| **Polling sin timeout/backoff** | ~15 min | Cold start Render 60-90s → fetch cuelga / JSON.parse falla en HTML | Timeout 10s + backoff 2→5→15s + validar `ok===true` + ignorar no-JSON |

### Workarounds Render (documentar en CLAUDE.md)

```bash
# 1. Root Directory en Web Service manual = "." (punto literal, no vacío)
# 2. NO definir PORT (Render lo inyecta)
# 3. PUBLIC_URL=https://tu-servicio.onrender.com en Environment
# 4. GitHub Pages en repo privado requiere plan Pro; usar público o Cloudflare Pages
# 5. Cache 404 en Fastly ~5 min tras primer deploy fallido; esperar
```

### Lecciones nuevas para CLAUDE.md global

1. **Verifica commit remoto antes de culpar a la plataforma**
   - `git ls-tree -r HEAD --name-only | grep package.json` → debe aparecer
   - 5 configuraciones Render fallaron igual; causa: commit sin package.json

2. **Blueprint ≠ Web Service manual en Render**
   - Blueprint: ignora `rootDir`, usa detector automático (bug: detecta `src/`)
   - Manual: respeta campo "Root Directory" en UI → **usar manual**

3. **CORS: prueba con `curl -H "Origin: ..."` ANTES de UI**
   - Typo `juandisol` vs `juandisolo` pasó desapercibido hasta prueba móvil real

4. **Polling resiliente = obligatorio en serverless/gratis**
   - Timeout + backoff + validar JSON estricto (`ok===true`) + ignorar HTML
   - Sin esto: cold start = mensajes perdidos / app muda

5. **GitHub Pages cachea 404 ~5 min (Fastly)**
   - Primer deploy fallido → cache 404 → fix deploy → esperar 5 min
   - Probar con `curl -I` o móvil (cache distinta)

### Estructura final recomendada (actualizada)

```
mensajitos/
├── CLAUDE.md                 # Instrucciones + workarounds Render/Electron
├── POSTMORTEM.md             # Este archivo
├── COMO_USAR.md              # Guía usuario: 3 pasos (sender, app, móvil)
├── ESTADO.md                 # Checklist vivo (H0-H5 completados)
├── render.yaml               # Blueprint Render (fallback, no usado)
├── server.js                 # API Express (CORS, PUBLIC_URL, health+ts)
├── electron/
│   ├── main.cjs              # Polling resiliente (timeout, backoff, no-JSON)
│   └── preload.cjs           # IPC bridge
├── src/
│   ├── overlay.html          # Renderer Electron
│   └── icon.png
├── docs/
│   ├── send.html             # GitHub Pages (sender Valentina)
│   └── send.js               # Banner despertar, check adaptativo
└── scripts/                  # start/stop/test helpers
```