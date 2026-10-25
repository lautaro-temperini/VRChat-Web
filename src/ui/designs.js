import { parseGLTF } from '../loaders.js';
import { submitDesign } from '../net/api.js';
import { checkGLB, MODEL_RULES } from '../../server/glb.js';
import { DESIGN_IMAGE, HAND_MAX } from '../../server/shared.js';
import { modelViewer } from './works.js';
import { toast } from './toast.js';
import { guestGate } from './guest.js';

// Subir un diseño propio (botón "Subir diseño" del inventario): estampa (va en la ropa, en el pecho o
// la espalda), cuadro u objeto 3D (van a la sala, al piso o a la mano). Ver server/designs.js.
// onDone(items): el inventario nuevo, con el diseño ya adentro.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const HD = 2048;

// Achica la imagen y la deja en WebP (o PNG si el navegador no sabe: las estampas pueden tener transparencia)
async function shrink(bitmap, max) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(16, Math.round(bitmap.width * k)), h = Math.max(16, Math.round(bitmap.height * k));
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { blob, w, h };
}

export function createDesignUpload({ ui, me, onDone }) {
  let kind = 'estampa', place = 'pecho', size = 'mediano', prepared = null, busy = false;

  const segs = { 'design-kind': 'kind', 'design-place': 'v', 'design-size': 'v' };
  const pick = (id, value) => { for (const b of $(id).querySelectorAll('button')) b.classList.toggle('sel', b.dataset[segs[id]] === value); };
  function setKind(k) {
    kind = k;
    pick('design-kind', k);
    $('design-place-box').hidden = $('design-size-box').hidden = k !== 'estampa';
    $('design-file').accept = k === 'objeto' ? '.glb,model/gltf-binary' : 'image/png,image/jpeg,image/webp';
    $('design-file').value = '';
    prepared = null;
    $('design-preview').replaceChildren();
    $('design-file-hint').textContent = {
      estampa: `Imagen PNG, JPG o WebP (hasta ${DESIGN_IMAGE} px; con fondo transparente queda mejor). Se ve en la parte de arriba de la ropa.`,
      cuadro: `Imagen PNG, JPG o WebP. En la pared se ve a ${DESIGN_IMAGE} px y en grande hasta ${HD} px.`,
      objeto: `Modelo .glb en metros: hasta 2 MB, ${MODEL_RULES.tris.toLocaleString('es-AR')} triángulos, texturas de ${MODEL_RULES.tex} px y ${MODEL_RULES.height} m de alto. Si mide hasta ${HAND_MAX * 100} cm se puede sostener en la mano.`,
    }[k];
  }
  for (const b of $('design-kind').querySelectorAll('button')) b.onclick = () => setKind(b.dataset.kind);
  for (const b of $('design-place').querySelectorAll('button')) b.onclick = () => { place = b.dataset.v; pick('design-place', place); };
  for (const b of $('design-size').querySelectorAll('button')) b.onclick = () => { size = b.dataset.v; pick('design-size', size); };

  $('design-file').onchange = async () => {
    const file = $('design-file').files[0];
    prepared = null;
    const box = $('design-preview');
    box.replaceChildren();
    if (!file) return;
    if (!$('design-title').value.trim()) $('design-title').value = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
    try {
      if (kind === 'objeto') {
        const data = await file.arrayBuffer();
        const r = checkGLB(data);
        if (!r.ok) throw new Error(r.error);
        const gltf = await parseGLTF(data).catch(() => { throw new Error('No se pudo abrir el modelo. ¿Es un .glb válido?'); });
        const [x, y, z] = r.size.map((v) => `${Math.round(v * 100)} cm`);
        const view = el('div', 'design-3d');
        box.append(view, el('p', 'meta', `${x} × ${y} de alto × ${z} · ${r.tris.toLocaleString('es-AR')} triángulos${Math.max(...r.size) <= HAND_MAX ? ' · se puede sostener en la mano' : ''}`));
        modelViewer(view, gltf.scene);
        prepared = { model: new Blob([data], { type: 'model/gltf-binary' }) };
      } else {
        let bitmap;
        try { bitmap = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen (PNG, JPG o WebP).'); }
        const img = await shrink(bitmap, DESIGN_IMAGE);
        const hd = kind === 'cuadro' && Math.max(bitmap.width, bitmap.height) > DESIGN_IMAGE ? await shrink(bitmap, HD) : null;
        if (img.blob.size > 900_000 || (hd && hd.blob.size > 1_900_000)) throw new Error('La imagen es demasiado pesada incluso achicada.');
        const pic = el('img', 'work-img');
        pic.src = URL.createObjectURL(img.blob);
        box.append(pic);
        prepared = { img, hd };
      }
    } catch (e) {
      $('design-file').value = '';
      box.replaceChildren(el('p', 'error', e.message));
    }
  };

  $('design-form').onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!prepared) return toast('Elegí el archivo primero.');
    const title = $('design-title').value.trim();
    if (!title) return toast('Ponele un nombre a tu diseño.');
    const form = new FormData();
    form.set('kind', kind);
    form.set('title', title);
    if (kind === 'objeto') form.set('model', prepared.model, 'modelo.glb');
    else {
      form.set('img', prepared.img.blob, 'imagen');
      form.set('w', prepared.img.w);
      form.set('h', prepared.img.h);
      if (prepared.hd) form.set('hd', prepared.hd.blob, 'hd');
      if (kind === 'estampa') { form.set('place', place); form.set('size', size); }
    }
    busy = true;
    $('design-send').disabled = true;
    $('design-send').textContent = 'Subiendo…';
    const r = await submitDesign(form);
    busy = false;
    $('design-send').disabled = false;
    $('design-send').textContent = 'Subir';
    if (!r.ok) return toast(r.error ?? 'No se pudo subir.');
    toast(r.designer ? '¡Listo! Ya está en tu inventario. Y ahora sos Diseñador 🧩' : '¡Listo! Tu diseño ya está en tu inventario.');
    $('design-title').value = '';
    setKind(kind);
    onDone?.(r.items, kind);
  };

  function open() {
    if (me()?.guest) return guestGate('subir diseños');
    setKind(kind);
    pick('design-place', place);
    pick('design-size', size);
    ui.openOverlay('designing');
  }
  return { open };
}
