// Mensajitos Sender - GitHub Pages version
// API base URL se lee del meta tag <meta name="api-base"> en send.html
// En producción: https://mensajitos-api.onrender.com

const DEVICE_ID = 'juan-macbook';
const API_BASE = document.querySelector('meta[name="api-base"]').content.replace(/\/$/, '');

let selectedFile = null;
let online = true;
let checkInterval = null;
let wakeInProgress = false;

// Elementos DOM
const fileInput = document.getElementById('fileInput');
const fileLabel = document.getElementById('fileLabel');
const fileLabelText = document.getElementById('fileLabelText');
const preview = document.getElementById('preview');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const textInput = document.getElementById('textInput');
const serverBanner = document.getElementById('serverBanner');
const bannerTitle = document.getElementById('bannerTitle');
const bannerMsg = document.getElementById('bannerMsg');
const wakeBtn = document.getElementById('wakeBtn');

// Quick actions
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    textInput.value = btn.dataset.text;
    textInput.focus();
  });
});

// File selection
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

// Health check con validación estricta (ok === true, no solo res.ok)
async function checkHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${API_BASE}/health`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await res.json();
    return data && data.ok === true; // Render cold start devuelve HTML → json() lanza o ok !== true
  } catch {
    return false;
  }
}

// UI state
function setOnline() {
  if (online) return;
  online = true;
  serverBanner.classList.remove('visible', 'waking');
  sendBtn.disabled = false;
  wakeBtn.style.display = 'none';
}

function setOffline() {
  if (!online) return;
  online = false;
  serverBanner.classList.add('visible');
  serverBanner.classList.remove('waking');
  bannerTitle.textContent = 'Servidor apagado';
  bannerMsg.textContent = 'El servidor está dormido. Espera un momento…';
  wakeBtn.style.display = 'inline-block';
  wakeBtn.disabled = false;
  wakeBtn.textContent = 'Despertar servidor';
  sendBtn.disabled = true;
}

function setWaking() {
  online = false;
  serverBanner.classList.add('visible', 'waking');
  bannerTitle.textContent = 'Despertando servidor…';
  bannerMsg.textContent = 'Puede tardar ~1 minuto. Por favor espera.';
  wakeBtn.style.display = 'inline-block';
  wakeBtn.disabled = true;
  wakeBtn.textContent = 'Despertando…';
  sendBtn.disabled = true;
}

function setWakeFailed() {
  bannerTitle.textContent = 'Sigue apagado';
  bannerMsg.textContent = 'El servidor no responde. Vuelve a intentarlo.';
  wakeBtn.disabled = false;
  wakeBtn.textContent = 'Reintentar';
}

// Polling adaptativo: cada 15s si online, cada 3s si offline
let checkDelay = 15000;
function scheduleCheck() {
  clearInterval(checkInterval);
  checkInterval = setInterval(async () => {
    const wasOnline = online;
    const isHealthy = await checkHealth();

    if (isHealthy) {
      if (!wasOnline) setOnline();
      checkDelay = 15000;
    } else {
      if (wasOnline) setOffline();
      checkDelay = 3000;
    }
    scheduleCheck(); // re-arm con nuevo delay
  }, checkDelay);
}

// Pausar checks si pestaña oculta
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(checkInterval);
  } else {
    // Check inmediato al volver
    checkHealth().then(healthy => {
      healthy ? setOnline() : setOffline();
    });
    scheduleCheck();
  }
});

// Wake button
wakeBtn.addEventListener('click', async () => {
  if (wakeInProgress) return;
  wakeInProgress = true;
  setWaking();

  // Timeout largo para cold start de Render (~60-90s)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 95000);
    const res = await fetch(`${API_BASE}/health`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data && data.ok === true) {
      setOnline();
    } else {
      setWakeFailed();
    }
  } catch {
    setWakeFailed();
  } finally {
    wakeInProgress = false;
  }
});

// Form submit
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
      const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
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
    const res = await fetch(`${API_BASE}/api/send`, {
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
    // Si falla por servidor dormido, el POST también lo despierta
    // No vaciar formulario para que Valentina pueda reintentar
    showStatus('Error: ' + err.message, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span class="heart">♥</span> Enviar ahora';
  }
});

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}

// Iniciar
(async () => {
  // Check inicial
  const healthy = await checkHealth();
  healthy ? setOnline() : setOffline();

  // Iniciar polling adaptativo
  scheduleCheck();

  // Online/offline events también disparan check
  window.addEventListener('online', () => {
    checkHealth().then(h => h ? setOnline() : setOffline());
    scheduleCheck();
  });
})();