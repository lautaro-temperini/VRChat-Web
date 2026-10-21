import { api, photoUrl, uploadPhoto } from '../net/api.js';
import { toast } from './toast.js';

// Galería de fotos del perfil (tipo Fotolog / Instagram).
// - El dueño sube y borra fotos (hasta 30) y elige quién la ve: todos, amigos o nadie.
// - Las fotos NO se cuelgan solas en la sala: eso lo decide el dueño (llega con el editor de salas).

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 1600;   // la foto se achica a este lado máximo antes de subir
const QUALITY = 0.82;    // calidad JPEG
const PRIVACY = [['todos', 'Todos'], ['amigos', 'Solo amigos'], ['nadie', 'Solo yo']];

// Achica y comprime una imagen elegida del disco → { blob, w, h }
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  let q = QUALITY, blob;
  do {
    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    q -= 0.12;
  } while (blob.size > 650 * 1024 && q > 0.3);
  return { blob, w, h };
}

// Ver una foto en grande
export function openPhoto(src) {
  const box = $('photoview');
  $('photoview-img').src = src;
  box.classList.add('show');
}
$('photoview').addEventListener('click', () => $('photoview').classList.remove('show'));

export async function renderGallery(container, ownerId) {
  container.innerHTML = '<div class="empty">Cargando…</div>';
  const r = await api(`photos?id=${encodeURIComponent(ownerId)}`);
  container.innerHTML = '';
  if (!r.ok) { container.innerHTML = `<div class="empty">${r.error}</div>`; return; }
  if (r.hidden) {
    container.innerHTML = `<div class="empty">${r.privacy === 'amigos' ? 'Esta galería es solo para amigos.' : 'Esta galería es privada.'}</div>`;
    return;
  }

  // Controles del dueño: subir y quién la ve
  if (r.mine) {
    const bar = document.createElement('div');
    bar.className = 'gallery-bar';
    const up = document.createElement('label');
    up.className = 'act on upload';
    up.textContent = `Subir foto (${r.photos.length}/${r.max})`;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    up.append(input);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      up.textContent = 'Subiendo…';
      try {
        const { blob, w, h } = await shrink(file);
        const res = await uploadPhoto(blob, w, h);
        if (!res.ok) toast(res.error);
      } catch {
        toast('No se pudo leer esa imagen.');
      }
      renderGallery(container, ownerId);
    };
    const sel = document.createElement('select');
    sel.className = 'privacy';
    for (const [v, label] of PRIVACY) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = `Ve mi galería: ${label}`;
      o.selected = r.privacy === v;
      sel.append(o);
    }
    sel.onchange = async () => {
      const res = await api('galleryprivacy', { method: 'POST', body: { privacy: sel.value } });
      if (!res.ok) toast(res.error);
    };
    bar.append(up, sel);
    container.append(bar);
  }

  const grid = document.createElement('div');
  grid.className = 'gallery';
  container.append(grid);
  if (!r.photos.length) {
    grid.innerHTML = `<div class="empty">${r.mine ? 'Todavía no subiste fotos.' : 'Todavía no subió fotos.'}</div>`;
    return;
  }
  for (const p of r.photos) {
    const cell = document.createElement('div');
    cell.className = 'photo';
    const img = document.createElement('img');
    img.alt = '';
    cell.append(img);
    photoUrl(p.id).then((url) => { if (url) img.src = url; });
    img.onclick = () => img.src && openPhoto(img.src);
    if (r.mine) {
      const del = document.createElement('button');
      del.className = 'del';
      del.title = 'Borrar foto';
      del.textContent = '✕';
      del.onclick = () => toast('¿Borrar esta foto?', { actions: [
        { label: 'Borrar', yes: true, onClick: async () => { await api('photodelete', { method: 'POST', body: { id: p.id } }); renderGallery(container, ownerId); } },
        { label: 'No' },
      ] });
      cell.append(del);
    }
    grid.append(cell);
  }
}
