import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// PUBLIC_URL: base URL for absolute image links (set in production)
// e.g., https://mi-servicio.onrender.com
const PUBLIC_URL = process.env.PUBLIC_URL || '';

const app = express();
const httpServer = createServer(app);

// CORS: permitir GitHub Pages (juandisol.github.io) + local dev
const corsOrigins = [
  'https://juandisol.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];
const io = new Server(httpServer, {
  cors: { origin: corsOrigins, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use(express.static('public'));

// Storage for uploaded images
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// In-memory device registry (in production, use Redis)
const devices = new Map(); // deviceId -> socketId
const pendingMessages = new Map(); // deviceId -> messages[]

// Global sequence counter for reliable polling (avoids timestamp collisions)
// Use Date.now() so it monotonically increases across server restarts
let globalSeq = Date.now();
function nextSeq() {
  return ++globalSeq;
}

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (deviceId) => {
    devices.set(deviceId, socket.id);
    socket.join(deviceId);
    console.log('Device registered:', deviceId);
    
    if (pendingMessages.has(deviceId)) {
      const msgs = pendingMessages.get(deviceId);
      msgs.forEach(msg => socket.emit('message', msg));
      pendingMessages.delete(deviceId);
    }
  });

  socket.on('send-message', (data) => {
    const { to, message } = data;
    const targetSocketId = devices.get(to);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('message', message);
      console.log('Message delivered to:', to);
    } else {
      if (!pendingMessages.has(to)) pendingMessages.set(to, []);
      pendingMessages.get(to).push(message);
      console.log('Message queued for:', to);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [deviceId, sockId] of devices.entries()) {
      if (sockId === socket.id) {
        devices.delete(deviceId);
        break;
      }
    }
  });
});

// REST endpoints for sender (web)
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const imageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
  const ext = path.extname(req.file.originalname).toLowerCase();
  let imageType = 'image';
  if (ext === '.gif') imageType = 'gif';
  else if (ext === '.webp') imageType = 'webp';

  res.json({
    url: imageUrl,
    type: imageType,
    originalName: req.file.originalname
  });
});

app.post('/api/send', (req, res) => {
  const { to, from, avatar, text, image_url, image_type } = req.body;

  // ID FIJO por defecto si no se proporciona
  const targetDeviceId = to || 'juan-macbook';

  const message = {
    id: uuidv4(),
    seq: nextSeq(),
    from: from || 'Valentina 💕',
    avatar: avatar || 'https://api.dicebear.com/7.x/big-smile/svg?seed=valentina',
    text: text || null,
    image_url: image_url || null,
    image_type: image_type || null,
    timestamp: Math.floor(Date.now() / 1000)
  };

  console.log('Sending message to:', targetDeviceId, { seq: message.seq, id: message.id, text: message.text, hasImage: !!message.image_url });

  const targetSocketId = devices.get(targetDeviceId);

  if (targetSocketId) {
    io.to(targetSocketId).emit('message', message);
    res.json({ success: true, delivered: true, seq: message.seq });
  } else {
    if (!pendingMessages.has(targetDeviceId)) pendingMessages.set(targetDeviceId, []);
    pendingMessages.get(targetDeviceId).push(message);
    console.log('Message queued. Pending for', targetDeviceId, ':', pendingMessages.get(targetDeviceId).length);
    res.json({ success: true, delivered: false, queued: true, seq: message.seq });
  }
});

// Polling endpoint for Tauri app
app.get('/api/poll/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const since = parseInt(req.query.since) || 0;

  console.log('Polling for device:', deviceId, 'since(seq):', since);

  const messages = pendingMessages.get(deviceId) || [];
  console.log('Pending messages for device:', messages.length);

  // Filter by seq (not timestamp) for reliable ordering
  const newMessages = messages.filter(m => m.seq > since);
  console.log('New messages after filter:', newMessages.length);

  if (newMessages.length > 0) {
    // Remove delivered messages from pending (ack implícito)
    const remaining = messages.filter(m => m.seq <= since);
    if (remaining.length > 0) {
      pendingMessages.set(deviceId, remaining);
    } else {
      pendingMessages.delete(deviceId);
    }
  }

  res.json(newMessages);
});

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), devices: devices.size, pending: pendingMessages.size }));

// Sender web UI
app.get('/send', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enviar mensaje a Juan 💕</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
      min-height: 100vh;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%);
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      color: #fff;
    }
    .container {
      width: 100%;
      max-width: 420px;
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }
    h1 {
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #ff6b9d, #ffcc70);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle {
      text-align: center;
      color: rgba(255, 255, 255, 0.6);
      font-size: 14px;
      margin-bottom: 32px;
    }
    .form-group { margin-bottom: 20px; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 8px;
    }
    input, textarea {
      width: 100%;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
      font-size: 15px;
      font-family: inherit;
      transition: all 0.2s;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #ff6b9d;
      box-shadow: 0 0 0 3px rgba(255, 107, 157, 0.2);
    }
    input::placeholder, textarea::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }
    .file-input {
      position: relative;
    }
    .file-input input[type="file"] {
      position: absolute;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    .file-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 16px;
      border: 2px dashed rgba(255, 107, 157, 0.4);
      border-radius: 12px;
      background: rgba(255, 107, 157, 0.05);
      color: #ff6b9d;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .file-label:hover {
      border-color: #ff6b9d;
      background: rgba(255, 107, 157, 0.1);
    }
    .file-label.has-file {
      border-style: solid;
      border-color: #4ade80;
      background: rgba(74, 222, 128, 0.1);
      color: #4ade80;
    }
    .preview {
      display: none;
      margin-top: 12px;
      border-radius: 12px;
      overflow: hidden;
      max-height: 200px;
    }
    .preview img, .preview video {
      width: 100%;
      height: auto;
      display: block;
    }
    .btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #ff6b9d, #c44569);
      color: white;
      box-shadow: 0 4px 20px rgba(255, 107, 157, 0.4);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(255, 107, 157, 0.5);
    }
    .btn-primary:active {
      transform: translateY(0);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .status {
      text-align: center;
      font-size: 13px;
      margin-top: 16px;
      min-height: 20px;
    }
    .status.sent { color: #4ade80; }
    .status.error { color: #f87171; }
    .status.waiting { color: #fbbf24; }
    .heart {
      display: inline-block;
      animation: beat 1s ease-in-out infinite;
    }
    @keyframes beat {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }
    .quick-actions {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .quick-btn {
      padding: 14px;
      border: 1px solid rgba(255, 107, 157, 0.3);
      background: rgba(255, 107, 157, 0.1);
      color: #ff6b9d;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .quick-btn:hover {
      background: rgba(255, 107, 157, 0.2);
      border-color: #ff6b9d;
    }
    .device-id {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 12px;
      font-family: monospace;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      text-align: center;
      margin-bottom: 20px;
      user-select: all;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Mensajes para Juan 💕</h1>
    <p class="subtitle">Escribe algo bonito, envía una foto o un GIF</p>
    
    <div class="device-id" id="deviceId">Cargando ID...</div>
    
    <div class="quick-actions">
      <button class="quick-btn" data-text="Te extraño mucho 💕">Te extraño</button>
      <button class="quick-btn" data-text="Pensando en ti 💭">Pensando en ti</button>
      <button class="quick-btn" data-text="¡Te amo! ❤️">Te amo</button>
      <button class="quick-btn" data-text="Volverte a ver pronto 🏃‍♀️💨">Pronto nos vemos</button>
    </div>

    <form id="msgForm">
      <div class="form-group">
        <label>Mensaje</label>
        <textarea id="textInput" rows="3" placeholder="Escribe tu mensaje..."></textarea>
      </div>
      
      <div class="form-group">
        <label>Foto o GIF</label>
        <div class="file-input">
          <div class="file-label" id="fileLabel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span id="fileLabelText">Toca para seleccionar</span>
          </div>
          <input type="file" id="fileInput" accept="image/*,video/*" style="display: none;">
        </div>
        <div class="preview" id="preview"></div>
      </div>

      <button type="submit" class="btn btn-primary" id="sendBtn">
        <span class="heart">♥</span> Enviar ahora
      </button>
      
      <div class="status" id="status"></div>
    </form>
  </div>

  <script>
    // ID FIJO compartido con la app Electron
    const DEVICE_ID = 'juan-macbook';
    document.getElementById('deviceId').textContent = 'ID fijo: ' + DEVICE_ID;

    let selectedFile = null;
    const fileInput = document.getElementById('fileInput');
    const fileLabel = document.getElementById('fileLabel');
    const fileLabelText = document.getElementById('fileLabelText');
    const preview = document.getElementById('preview');
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    const textInput = document.getElementById('textInput');

    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        textInput.value = btn.dataset.text;
        textInput.focus();
      });
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      selectedFile = file;
      fileLabel.classList.add('has-file');
      fileLabelText.textContent = file.name;
      
      const url = URL.createObjectURL(file);
      preview.style.display = 'block';
      preview.innerHTML = file.type.startsWith('video/') 
        ? '<video src="' + url + '" autoplay loop muted playsinline></video>'
        : '<img src="' + url + '" alt="Preview">';
    });

    fileLabel.addEventListener('click', () => fileInput.click());

    document.getElementById('msgForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const text = textInput.value.trim();
      if (!text && !selectedFile) {
        showStatus('Escribe un mensaje o selecciona una imagen', 'error');
        return;
      }

      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span class="heart">♥</span> Enviando...';
      showStatus('Subiendo...', 'waiting');

      let imageUrl = null;
      let imageType = null;

      if (selectedFile) {
        const formData = new FormData();
        formData.append('image', selectedFile);
        
        try {
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          imageUrl = data.url;
          imageType = data.type;
        } catch (err) {
          showStatus('Error subiendo imagen: ' + err.message, 'error');
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<span class="heart">♥</span> Enviar ahora';
          return;
        }
      }

      try {
        const res = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: DEVICE_ID,
            from: 'Valentina 💕',
            text: text || null,
            image_url: imageUrl,
            image_type: imageType
          })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.delivered) {
          showStatus('✅ ¡Entregado al instante!', 'sent');
        } else if (data.queued) {
          showStatus('⏳ En cola, se entregará cuando abra la app', 'waiting');
        }

        textInput.value = '';
        selectedFile = null;
        fileLabel.classList.remove('has-file');
        fileLabelText.textContent = 'Toca para seleccionar';
        preview.style.display = 'none';
        preview.innerHTML = '';

      } catch (err) {
        showStatus('Error: ' + err.message, 'error');
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span class="heart">♥</span> Enviar ahora';
      }
    });

    function showStatus(msg, type) {
      status.textContent = msg;
      status.className = 'status ' + type;
    }
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`💕 Server running on ${HOST}:${PORT}`);
  console.log(`📱 Sender UI: http://localhost:${PORT}/send`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});
