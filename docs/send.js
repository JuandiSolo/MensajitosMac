// Mensajitos Sender - GitHub Pages version (Supabase)
// Lee config de <meta name="supabase-url"> y <meta name="supabase-anon-key">

const DEVICE_ID = 'juan-macbook';
const SUPABASE_URL = document.querySelector('meta[name="supabase-url"]').content.replace(/\/$/, '');
const SUPABASE_ANON_KEY = document.querySelector('meta[name="supabase-anon-key"]').content;

const headers = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

let selectedFile = null;

// Elementos DOM
const fileInput = document.getElementById('fileInput');
const fileLabel = document.getElementById('fileLabel');
const fileLabelText = document.getElementById('fileLabelText');
const preview = document.getElementById('preview');
const sendBtn = document.getElementById('sendBtn');
const statusEl = document.getElementById('status');
const textInput = document.getElementById('textInput');

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

  // Validar tamaño (10 MB)
  if (file.size > 10 * 1024 * 1024) {
    showStatus('La imagen supera 10 MB', 'error');
    fileInput.value = '';
    return;
  }

  // Validar tipo MIME
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    showStatus('Formato no soportado (usa JPG, PNG, GIF o WebP)', 'error');
    fileInput.value = '';
    return;
  }

  selectedFile = file;
  fileLabel.classList.add('has-file');
  fileLabelText.textContent = file.name;

  const url = URL.createObjectURL(file);
  preview.style.display = 'block';
  preview.innerHTML = '<img src="' + url + '" alt="Preview">';
});

fileLabel.addEventListener('click', () => fileInput.click());

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

  let imagePath = null;
  let imageUrl = null;
  let imageType = null;

  if (selectedFile) {
    // Generar UUID + extensión
    const ext = selectedFile.name.split('.').pop().toLowerCase();
    const uuid = crypto.randomUUID();
    const fileName = `${uuid}.${ext}`;

    // Subir a Storage
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${fileName}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': selectedFile.type
        },
        body: selectedFile
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Error subiendo' }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      imagePath = fileName;
      imageUrl = `${SUPABASE_URL}/storage/v1/object/public/media/${fileName}`;
      imageType = selectedFile.type === 'image/gif' ? 'gif' :
                  selectedFile.type === 'image/webp' ? 'webp' : 'image';

    } catch (err) {
      showStatus('Error subiendo imagen: ' + err.message, 'error');
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span class="heart">♥</span> Enviar ahora';
      return;
    }
  }

  // Insert en messages
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        device_id: DEVICE_ID,
        sender: 'Valentina 💕',
        text: text || null,
        image_path: imagePath,
        image_url: imageUrl,
        image_type: imageType
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Error enviando' }));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    showStatus('✅ Enviado — le llega en segundos si la app está abierta, o al abrirla', 'sent');

    // Reset formulario
    textInput.value = '';
    selectedFile = null;
    fileLabel.classList.remove('has-file');
    fileLabelText.textContent = 'Toca para seleccionar';
    preview.style.display = 'none';
    preview.innerHTML = '';

  } catch (err) {
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