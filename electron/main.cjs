const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// En CommonJS, __dirname ya está disponible globalmente
console.error('[Main] Starting...', { __dirname, platform: process.platform });
console.error('[Main] process.versions:', process.versions);

const POLL_INTERVAL = 2000; // 2 segundos
const AUTO_HIDE_DELAY = 10000; // 10 segundos
const WIN_W = 340; // Ventana del ancho exacto de la tarjeta
const MARGIN = 20;

// ID FIJO compartido con /send
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

// Obtener deviceId (fijo, ignora config.json)
function getDeviceId() {
  return FIXED_DEVICE_ID;
}

// Obtener serverUrl desde config.json o env var
function getServerUrl() {
  const config = getConfig();
  return config.serverUrl || process.env.MENSAJITOS_SERVER || 'https://manuals-tobacco-trained-log.trycloudflare.com';
}

// Guardar serverUrl en config.json
function setServerUrl(url) {
  const config = getConfig();
  config.serverUrl = url;
  saveConfig(config);
}

let deviceId = null;
let overlayWindow = null;
let tray = null;
let pollingInterval = null;
let lastSeq = 0;
let notificationQueue = [];
let isShowingNotification = false;
let pendingShow = false;
let showTimeout = null;

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
    useContentSize: true, // Ventana se ajusta al contenido
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

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Enviar prueba', click: () => sendTestMessage() },
    { type: 'separator' },
    { label: `Device ID: ${deviceId}`, enabled: false },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('Mensajitos 💕');
  tray.setContextMenu(contextMenu);
}

// Iniciar polling al servidor
function startPolling() {
  const serverUrl = getServerUrl();
  console.error('[Main] Starting polling...', { deviceId, serverUrl });
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const currentServerUrl = getServerUrl(); // Re-read in case config changed
      const response = await fetch(`${currentServerUrl}/api/poll/${deviceId}?since=${lastSeq}`);
      if (!response.ok) return;

      const messages = await response.json();
      if (messages.length === 0) return;

      // Server restart detection: if we get messages but all have seq <= lastSeq,
      // the server seq was reset (e.g., server restart). Reset lastSeq to 0 to catch up.
      const maxSeq = Math.max(...messages.map(m => m.seq));
      if (maxSeq <= lastSeq) {
        console.error('[Main] Server seq reset detected (maxSeq:', maxSeq, '<= lastSeq:', lastSeq, '), resetting lastSeq to 0');
        lastSeq = 0;
      }

      for (const msg of messages) {
        if (msg.seq > lastSeq) {
          lastSeq = msg.seq;
          queueNotification(msg);
        }
      }
    } catch (err) {
      console.error('[Main] Poll error:', err);
    }
  }, POLL_INTERVAL);
  console.error('[Main] Polling started, interval:', POLL_INTERVAL);
}

// Queue notifications to show one at a time
function queueNotification(message) {
  // Fix relative image URLs (e.g., /uploads/xxx -> https://server/uploads/xxx)
  const serverUrl = getServerUrl();
  if (message.image_url && message.image_url.startsWith('/')) {
    message.image_url = serverUrl + message.image_url;
  }
  console.error('[Main] Queued notification:', { seq: message.seq, text: message.text, image_url: message.image_url });

  notificationQueue.push(message);
  processNotificationQueue();
}

function processNotificationQueue() {
  if (isShowingNotification || notificationQueue.length === 0) return;

  const message = notificationQueue.shift();
  isShowingNotification = true;
  showNotification(message);
}

// Mostrar notificación en el overlay
function showNotification(message) {
  if (!overlayWindow) {
    isShowingNotification = false;
    processNotificationQueue();
    return;
  }

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
        processNotificationQueue();
      }, 300);
    } else {
      isShowingNotification = false;
      processNotificationQueue();
    }
  }, AUTO_HIDE_DELAY);
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

// Single instance lock - evita múltiples instancias (causa tarjetas superpuestas, mensajes perdidos, estilos viejos)
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