const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// En CommonJS, __dirname ya está disponible globalmente
console.error('[Main] Starting...', { __dirname, platform: process.platform });
console.error('[Main] process.versions:', process.versions);

const POLL_INTERVAL_BASE = 3000; // 3s base (no hay cold start Render)
const AUTO_HIDE_DELAY = 10000; // 10 segundos
const WIN_W = 340; // Ventana del ancho exacto de la tarjeta
const MARGIN = 20;

// ID FIJO compartido con send.html
const FIXED_DEVICE_ID = 'juan-macbook';

// Configuración persistente en userData/config.json
function getConfig() {
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[Main] Failed to read config:', e);
    }
  }
  return {};
}

function saveConfig(config) {
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[Main] Failed to write config:', e);
  }
}

// Obtener deviceId (fijo)
function getDeviceId() {
  return FIXED_DEVICE_ID;
}

// Obtener Supabase config: config.json > env vars (sin defaults para secretos)
function getSupabaseConfig() {
  const config = getConfig();
  return {
    supabaseUrl: config.supabaseUrl || process.env.SUPABASE_URL,
    supabaseAnonKey: config.supabaseAnonKey || process.env.SUPABASE_ANON_KEY,
    receiverSecret: config.receiverSecret || process.env.RECEIVER_SECRET
  };
}

let deviceId = null;
let overlayWindow = null;
let tray = null;
let pollingInterval = null;
let notificationQueue = [];
let isShowingNotification = false;
let pendingShow = false;
let showTimeout = null;

// Set para deduplicar mensajes por ID (el estado vive en DB, no en seq)
const seenMessageIds = new Set();

// Polling resiliente state
let currentPollInterval = POLL_INTERVAL_BASE;
let consecutiveErrors = 0;
const POLL_TIMEOUT_MS = 10000; // 10s timeout per request
const BACKOFF_STEPS = [2000, 5000, 15000]; // 2s → 5s → 15s

// Crear ventana overlay
function createOverlayWindow() {
  console.error('[Main] Creating overlay window...');
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea; // {x, y, width, height}

  overlayWindow = new BrowserWindow({
    width: WIN_W,
    height: 1, // Height will be set by resize-overlay
    x: workArea.x + workArea.width - WIN_W - MARGIN,
    y: workArea.y + workArea.height - 1 - MARGIN,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    hasShadow: true,
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false
    },
    show: false
  });

  console.error('[Main] Loading overlay.html from:', path.join(__dirname, '../src/overlay.html'));
  overlayWindow.loadFile(path.join(__dirname, '../src/overlay.html'));

  overlayWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      overlayWindow.hide();
    }
  });

  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Main] Failed to load overlay:', errorCode, errorDescription);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    console.error('[Main] Overlay loaded successfully');
  });

  // Visible en todos los workspaces y fullscreen
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through cuando está oculto
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  return overlayWindow;
}

// Crear tray icon
function createTray() {
  console.error('[Main] Creating tray...');
  const iconPath = path.join(__dirname, '../src/icon.png');
  let icon;

  try {
    icon = nativeImage.createFromPath(iconPath);
    console.error('[Main] Loaded icon from path:', iconPath, 'size:', icon.getSize());
  } catch (e) {
    console.error('[Main] Failed to load icon, using empty:', e.message);
    icon = nativeImage.createEmpty();
  }

  try {
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    console.error('[Main] Tray created successfully');
  } catch (e) {
    console.error('[Main] Failed to create tray:', e);
  }

  const { supabaseUrl, receiverSecret } = getSupabaseConfig();
  const missingConfig = !supabaseUrl || !receiverSecret;

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Enviar prueba', click: () => sendTestMessage() },
    { type: 'separator' },
    { label: `Device ID: ${deviceId}`, enabled: false },
    ...(missingConfig ? [
      { label: '⚠️ Configuración incompleta', enabled: false },
      { type: 'separator' }
    ] : []),
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('Mensajitos 💕');
  tray.setContextMenu(contextMenu);
}

// Llamar a pull_messages RPC
async function pullMessages(supabaseUrl, supabaseAnonKey, receiverSecret, deviceId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/pull_messages`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_secret: receiverSecret,
          p_device: deviceId,
          p_limit: 50
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const messages = await response.json();
    if (!Array.isArray(messages)) {
      throw new Error('Response not an array');
    }
    return messages;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Llamar a ack_messages RPC
async function ackMessages(supabaseUrl, supabaseAnonKey, receiverSecret, ids) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/ack_messages`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_secret: receiverSecret,
          p_ids: ids
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const count = await response.json();
    return count;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Iniciar polling a Supabase (resiliente: timeout, backoff, ignora no-JSON)
function startPolling() {
  const { supabaseUrl, supabaseAnonKey, receiverSecret } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseAnonKey || !receiverSecret) {
    console.error('[Main] ❌ Configuración Supabase incompleta (supabaseUrl, supabaseAnonKey, receiverSecret). Polling NO iniciado.');
    console.error('[Main] Configurar en:', path.join(app.getPath('userData'), 'config.json'));
    if (tray) {
      createTray(); // Refresca menú con warning
    }
    return;
  }

  console.error('[Main] Starting Supabase polling...', { deviceId, supabaseUrl });
  if (pollingInterval) clearInterval(pollingInterval);

  consecutiveErrors = 0;
  currentPollInterval = POLL_INTERVAL_BASE;

  function scheduleNextPoll() {
    pollingInterval = setInterval(async () => {
      try {
        const { supabaseUrl, supabaseAnonKey, receiverSecret } = getSupabaseConfig();
        if (!supabaseUrl || !supabaseAnonKey || !receiverSecret) {
          throw new Error('Configuración perdida durante polling');
        }

        const messages = await pullMessages(supabaseUrl, supabaseAnonKey, receiverSecret, deviceId);

        // ÉXITO: resetear backoff
        if (consecutiveErrors > 0) {
          console.error('[Main] Polling recovered after', consecutiveErrors, 'errors');
        }
        consecutiveErrors = 0;
        currentPollInterval = POLL_INTERVAL_BASE;

        if (messages.length === 0) return;

        // Deduplicar por ID y encolar
        for (const msg of messages) {
          if (seenMessageIds.has(msg.id)) {
            console.error('[Main] Duplicate message skipped:', msg.id);
            continue;
          }
          seenMessageIds.add(msg.id);
          queueNotification(msg);
        }
      } catch (err) {
        consecutiveErrors++;
        const backoffIndex = Math.min(consecutiveErrors - 1, BACKOFF_STEPS.length - 1);
        currentPollInterval = BACKOFF_STEPS[backoffIndex];
        console.error('[Main] Poll error #' + consecutiveErrors + ': ' + err.message + ' → backoff ' + currentPollInterval + 'ms');

        // Re-programar con nuevo intervalo
        if (pollingInterval) clearInterval(pollingInterval);
        scheduleNextPoll();
      }
    }, currentPollInterval);
  }

  scheduleNextPoll();
  console.error('[Main] Polling started, base interval:', POLL_INTERVAL_BASE);
}

// Queue notifications to show one at a time
function queueNotification(message) {
  // image_url ya viene absoluta desde Supabase (no necesita prefijo serverUrl)
  console.error('[Main] Queued notification:', { id: message.id, seq: message.seq, text: message.text, image_url: message.image_url });

  notificationQueue.push(message);
  processNotificationQueue();
}

async function processNotificationQueue() {
  if (isShowingNotification || notificationQueue.length === 0) return;

  const message = notificationQueue.shift();
  isShowingNotification = true;
  await showNotification(message);
}

// Mostrar notificación en el overlay
function showNotification(message) {
  if (!overlayWindow) {
    isShowingNotification = false;
    processNotificationQueue();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    // Keep mouse events ignored by default; overlay.html will toggle via IPC on mouseenter/leave
    overlayWindow.webContents.send('new-message', message);

    // Don't show immediately - wait for resize-overlay from renderer
    // Fallback: show after 300ms if no resize event arrives
    pendingShow = true;
    if (showTimeout) clearTimeout(showTimeout);
    showTimeout = setTimeout(() => {
      if (pendingShow && overlayWindow && !overlayWindow.isDestroyed()) {
        console.error('[Main] Fallback show after 300ms');
        overlayWindow.show();
        pendingShow = false;
      }
    }, 300);

    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('hide-notification');
        setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
            overlayWindow.hide();
          }
          isShowingNotification = false;

          // ACK al servidor DESPUÉS de encolar/mostrar (idempotente)
          const { supabaseUrl, supabaseAnonKey, receiverSecret } = getSupabaseConfig();
          if (supabaseUrl && supabaseAnonKey && receiverSecret) {
            ackMessages(supabaseUrl, supabaseAnonKey, receiverSecret, [message.id])
              .then(count => console.error('[Main] ACK sent for', message.id, '→', count, 'rows'))
              .catch(err => console.error('[Main] ACK failed for', message.id, ':', err.message, '→ reintentará en próximo poll'));
          }

          processNotificationQueue();
          resolve();
        }, 300);
      } else {
        isShowingNotification = false;
        processNotificationQueue();
        resolve();
      }
    }, AUTO_HIDE_DELAY);
  });
}

// Resize window to fit card content (sent from renderer via IPC)
ipcMain.on('resize-overlay', (_, height) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const h = Math.max(1, Math.ceil(height));
  overlayWindow.setBounds({
    x: workArea.x + workArea.width - WIN_W - MARGIN,
    y: workArea.y + workArea.height - h - MARGIN,
    width: WIN_W,
    height: h
  });
  overlayWindow.invalidateShadow(); // Actualiza la sombra nativa al nuevo contorno

  // Show window after first resize if pending
  if (pendingShow) {
    overlayWindow.show();
    pendingShow = false;
    if (showTimeout) clearTimeout(showTimeout);
  }
});

// Enviar mensaje de prueba (solo texto, sin URL fake)
function sendTestMessage() {
  const testMsg = {
    id: require('crypto').randomUUID(),
    from: 'Valentina 💕',
    avatar: 'https://api.dicebear.com/7.x/big-smile/svg?seed=valentina',
    text: '¡Test desde Electron! 😘',
    image_url: null,
    image_type: null,
    timestamp: Math.floor(Date.now() / 1000)
  };
  showNotification(testMsg);
}

// IPC handlers
ipcMain.on('notification-clicked', () => {
  console.error('Notification clicked');
});

ipcMain.on('notification-closed', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
});

// Mouse events: only ignore mouse events when cursor is OUTSIDE the card
ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// Single instance lock - evita múltiples instancias
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error('[Main] Ya hay otra instancia en ejecución; saliendo.');
  app.quit();
}

// Second instance event (no-op, la primera instancia ya está corriendo)
app.on('second-instance', () => {
  // Intencionalmente vacío - la primera instancia maneja todo
});

// App lifecycle - solo arranca si tenemos el lock
app.whenReady().then(() => {
  deviceId = getDeviceId();
  console.error('[Main] App ready, deviceId:', deviceId);

  const { supabaseUrl, supabaseAnonKey, receiverSecret } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseAnonKey || !receiverSecret) {
    console.error('[Main] ⚠️ FALTA config.json con supabaseUrl, supabaseAnonKey, receiverSecret');
    console.error('[Main] Ruta:', path.join(app.getPath('userData'), 'config.json'));
  }

  createOverlayWindow();
  createTray();
  startPolling();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow();
  });
});

app.on('window-all-closed', () => {
  console.error('[Main] Window all closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  console.error('[Main] Before quit');
  app.isQuitting = true;
  if (pollingInterval) clearInterval(pollingInterval);
});

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});