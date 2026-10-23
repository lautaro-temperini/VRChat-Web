import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { api, submitWork, workFileUrl } from '../net/api.js';
import { toast } from './toast.js';

// Atril de la entrada del Museo: postular obras al Museo rotativo, ver las tuyas,
// revisar (curadores y admins) y administrar (admins). Ver server/works.js.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// Reglas de los archivos (decisión del usuario: imágenes hasta 2048 px; modelos GLB hasta 2 MB,
// 10.000 triángulos, texturas de 1K y 3 m de alto)
const HD = 2048, WALL = 1024, MODEL_BYTES = 2 * 1024 * 1024, MAX_TRIS = 10_000, MAX_TEX = 1024, MAX_HEIGHT = 3;

const STATUS = {
  pendiente: 'Esperando que la revise un curador',
  verificada: 'Verificada: entra al Museo en su turno',
  en_disputa: 'La está revisando un admin',
  expuesta: 'Expuesta ahora en el Museo',
  expuesta_antes: 'Ya se expuso',
  denegada: 'Denegada',
  bajada: 'Bajada por un admin',
};

// ---------- Archivos: achicar imágenes y revisar modelos en el navegador ----------
async function resize(bitmap, max, quality) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  let blob = await new Promise((r) => c.toBlob(r, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return { blob, w, h };
}

async function prepareImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('No se pudo leer la imagen (JPG, PNG o WebP).'); }
  let hd = await resize(bitmap, HD, 0.9);
  if (hd.blob.size > 1_900_000) hd = await resize(bitmap, HD, 0.78);
  if (hd.blob.size > 1_900_000) throw new Error('La imagen es demasiado pesada incluso comprimida.');
  const wall = await resize(bitmap, WALL, 0.85);
  return { hd, wall };
}

async function checkModel(file) {
  if (!/\.glb$/i.test(file.name)) throw new Error('El modelo tiene que ser un archivo .glb.');
  if (file.size > MODEL_BYTES) throw new Error('El modelo pesa más de 2 MB.');
  let gltf;
  try { gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), ''); } catch { throw new Error('No se pudo abrir el modelo. ¿Es un .glb válido?'); }
  let tris = 0, tex = 0;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const m of [o.material].flat()) for (const map of Object.values(m)) if (map?.isTexture && map.image) tex = Math.max(tex, map.image.width ?? 0, map.image.height ?? 0);
  });
  const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
  if (tris > MAX_TRIS) throw new Error(`El modelo tiene ${Math.round(tris).toLocaleString('es-AR')} triángulos; el máximo es ${MAX_TRIS.toLocaleString('es-AR')}.`);
  if (tex > MAX_TEX) throw new Error(`Las texturas pueden ser de hasta ${MAX_TEX} px (tiene de ${tex} px).`);
  if (size.y > MAX_HEIGHT) throw new Error(`El modelo mide ${size.y.toFixed(1)} m de alto; el máximo es ${MAX_HEIGHT} m (la escala va en metros).`);
  return { tris: Math.round(tris), size, scene: gltf.scene };
}

// Visor chiquito para modelos 3D (gira solo)
function modelViewer(container, scene) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const w = container.clientWidth || 320, h = 240;
  r.setSize(w, h);
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.replaceChildren(r.domElement);
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2);
  d.position.set(2, 4, 3);
  s.add(d);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  scene.position.sub(center);
  pivot.add(scene);
  s.add(pivot);
  const cam = new THREE.PerspectiveCamera(35, w / h, size / 100, size * 10);
  cam.position.set(0, size * 0.35, size * 1.4);
  cam.lookAt(0, 0, 0);
  let alive = true;
  const loop = () => { if (!alive || !r.domElement.isConnected) { r.dispose(); return; } pivot.rotation.y += 0.01; r.render(s, cam); requestAnimationFrame(loop); };
  loop();
  return () => { alive = false; };
}

async function preview(container, work, f) {
  container.replaceChildren(el('p', 'meta', 'Cargando…'));
  const url = await workFileUrl(work.id, f);
  if (!url) { container.replaceChildren(el('p', 'meta', 'No se pudo cargar el archivo.')); return; }
  if (work.kind === 'cuadro') {
    const img = el('img', 'work-img');
    img.src = url;
    container.replaceChildren(img);
  } else {
    try { modelViewer(container, (await new GLTFLoader().loadAsync(url)).scene); } catch { container.replaceChildren(el('p', 'meta', 'No se pudo abrir el modelo.')); }
  }
}

export function createWorks({ ui, me }) {
  let tab = 'postular';
  let kind = 'cuadro';
  let prepared = null; // { kind, hd, wall } o { kind, file }
  let reviewing = null;
  let stopViewer = null;

  function show(name) {
    tab = name;
    for (const b of document.querySelectorAll('#works-tabs [data-wtab]')) b.classList.toggle('active', b.dataset.wtab === name);
    for (const s of document.querySelectorAll('#works [data-wpane]')) s.hidden = s.dataset.wpane !== name;
    if (name === 'mias') renderMine();
    if (name === 'revisar') nextReview();
    if (name === 'admin') renderAdmin();
  }
  for (const b of document.querySelectorAll('#works-tabs [data-wtab]')) b.onclick = () => show(b.dataset.wtab);

  // ---------- Postular ----------
  function setKind(k) {
    kind = k;
    prepared = null;
    for (const b of document.querySelectorAll('#work-kind [data-kind]')) b.classList.toggle('sel', b.dataset.kind === k);
    $('work-file').value = '';
    $('work-file').accept = k === 'cuadro' ? 'image/jpeg,image/png,image/webp' : '.glb,model/gltf-binary';
    $('work-file-hint').textContent = k === 'cuadro'
      ? 'Imagen JPG, PNG o WebP. Se ve a 1024 px en la pared y hasta 2048 px al abrir la ficha.'
      : 'Modelo .glb de hasta 2 MB, 10.000 triángulos, texturas de 1K y 3 m de alto (escala en metros).';
    $('work-preview').replaceChildren();
  }
  for (const b of document.querySelectorAll('#work-kind [data-kind]')) b.onclick = () => setKind(b.dataset.kind);

  $('work-file').onchange = async () => {
    const file = $('work-file').files[0];
    prepared = null;
    stopViewer?.();
    if (!file) return;
    const box = $('work-preview');
    box.replaceChildren(el('p', 'meta', 'Revisando el archivo…'));
    try {
      if (kind === 'cuadro') {
        const img = await prepareImage(file);
        prepared = { kind, ...img };
        const i = el('img', 'work-img');
        i.src = URL.createObjectURL(img.wall.blob);
        box.replaceChildren(i, el('p', 'meta', `${img.hd.w} × ${img.hd.h} px · listo para postular`));
      } else {
        const m = await checkModel(file);
        prepared = { kind, file };
        const v = el('div', 'work-viewer');
        box.replaceChildren(v, el('p', 'meta', `${m.tris.toLocaleString('es-AR')} triángulos · ${m.size.y.toFixed(2)} m de alto · listo para postular`));
        stopViewer = modelViewer(v, m.scene);
      }
    } catch (e) {
      box.replaceChildren(el('p', 'work-error', e.message));
    }
  };

  $('work-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!prepared || prepared.kind !== kind) return toast(kind === 'cuadro' ? 'Elegí la imagen de tu obra.' : 'Elegí el modelo 3D de tu obra.');
    const title = $('work-title').value.trim();
    if (!title) return toast('La obra necesita un título.');
    const form = new FormData();
    form.set('kind', kind);
    for (const k of ['title', 'description', 'technique', 'year', 'link']) form.set(k, $(`work-${k}`).value.trim());
    if (kind === 'cuadro') {
      form.set('hd', prepared.hd.blob, 'hd');
      form.set('wall', prepared.wall.blob, 'wall');
      form.set('w', prepared.hd.w);
      form.set('h', prepared.hd.h);
    } else form.set('model', prepared.file, 'model.glb');
    const btn = $('work-send');
    btn.disabled = true;
    btn.textContent = 'Subiendo…';
    const r = await submitWork(form);
    btn.disabled = false;
    btn.textContent = 'Postular';
    if (!r.ok) return toast(r.error);
    toast(r.verified ? '¡Listo! Como sos Creador, tu obra ya entró verificada a la cola.' : '¡Listo! Tu obra está en la cola: te avisamos al celular cuando la revisen.');
    $('work-form').reset();
    setKind(kind);
    show('mias');
  };

  // ---------- Mis obras ----------
  let info = null;
  async function renderMine() {
    const list = $('works-mine');
    list.replaceChildren(el('p', 'meta', 'Cargando…'));
    const r = await api('myworks');
    if (!r.ok) { list.replaceChildren(el('p', 'meta', r.error)); return; }
    info = r;
    const head = el('p', 'meta', `Te quedan ${r.left} de ${r.limit} postulaciones (últimas 24 h).`);
    const titles = [r.creator && 'Creador', r.curator && !r.admin && 'Curador', r.admin && 'Admin'].filter(Boolean);
    list.replaceChildren(head);
    if (titles.length) list.append(el('p', 'work-titles', titles.map((t) => `★ ${t}`).join('  ')));
    if (!r.works.length) list.append(el('p', 'meta', 'Todavía no postulaste obras.'));
    for (const w of r.works) {
      const card = el('div', `work-card ${w.status}`);
      const thumb = el('div', 'work-thumb', w.kind === 'cuadro' ? '' : '🗿');
      if (w.kind === 'cuadro') workFileUrl(w.id, 'wall').then((url) => { if (url) thumb.style.backgroundImage = `url(${url})`; });
      const text = el('div', 'work-text');
      text.append(el('b', '', w.title), el('span', 'meta', `${w.kind === 'cuadro' ? 'Cuadro' : 'Escultura'} · ${STATUS[w.status] ?? w.status}`));
      if (w.status === 'expuesta' && w.endsAt) text.append(el('span', 'meta', `Hasta ${new Date(w.endsAt).toLocaleString('es-AR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`));
      if (w.status === 'denegada') text.append(el('span', 'work-error', `Motivo: ${w.denyReason}${w.denyText ? ` — ${w.denyText}` : ''}`));
      card.append(thumb, text);
      list.append(card);
    }
    $('works-tabs').querySelector('[data-wtab=revisar]').hidden = !r.curator;
    $('works-tabs').querySelector('[data-wtab=admin]').hidden = !r.admin;
  }

  // ---------- Revisar (curadores y admins) ----------
  function reasonsSelect(reasons) {
    const sel = el('select');
    sel.append(new Option('Elegí un motivo…', ''));
    for (const [k, v] of Object.entries(reasons)) sel.append(new Option(v, k));
    return sel;
  }
  function voteBox(work, reasons, after) {
    const box = el('div', 'work-vote');
    const ok = el('button', 'act on', 'Verificar');
    const no = el('button', 'act', 'Denegar…');
    const deny = el('div', 'work-deny');
    deny.hidden = true;
    const sel = reasonsSelect(reasons);
    const text = el('input');
    text.placeholder = 'Contá el motivo';
    text.maxLength = 200;
    text.hidden = true;
    sel.onchange = () => { text.hidden = sel.value !== 'otro'; };
    const send = el('button', 'act danger', 'Denegar');
    deny.append(sel, text, send);
    const vote = async (v) => {
      const r = await api('reviewvote', { method: 'POST', body: { id: work.id, vote: v, reason: sel.value, text: text.value } });
      if (!r.ok) return toast(r.error);
      toast({ verificada: 'Verificada.', denegada: 'Denegada: le avisamos al autor.', pendiente: 'Tu voto quedó: falta otro curador.', en_disputa: 'Hay desacuerdo: la decide un admin.' }[r.status] ?? 'Listo.');
      after();
    };
    ok.onclick = () => vote('ok');
    no.onclick = () => { deny.hidden = !deny.hidden; };
    send.onclick = () => vote('no');
    box.append(ok, no, deny);
    return box;
  }

  async function nextReview(skip) {
    const pane = $('works-review');
    pane.replaceChildren(el('p', 'meta', 'Buscando una obra…'));
    const r = await api(`review${skip ? `?skip=${encodeURIComponent(skip)}` : ''}`);
    if (!r.ok) { pane.replaceChildren(el('p', 'meta', r.error)); return; }
    reviewing = r.work;
    if (!r.work) { pane.replaceChildren(el('p', 'meta', 'No hay obras para revisar por ahora. ¡Gracias!')); return; }
    const w = r.work;
    const view = el('div', 'work-review-view');
    const meta = el('div', 'work-text');
    meta.append(el('b', '', w.title), el('span', 'meta', [w.author?.name, w.year, w.technique].filter(Boolean).join(' · ')));
    if (w.description) meta.append(el('p', '', w.description));
    if (w.link) { const a = el('a', '', w.link); a.href = w.link; a.target = '_blank'; a.rel = 'noopener'; meta.append(a); }
    const other = el('button', 'act', 'Otra');
    other.onclick = () => nextReview(w.id);
    pane.replaceChildren(view, meta, voteBox(w, r.reasons, () => nextReview()), other);
    preview(view, w, w.kind === 'cuadro' ? 'hd' : 'model');
  }

  // ---------- Admin ----------
  async function renderAdmin() {
    const pane = $('works-admin');
    pane.replaceChildren(el('p', 'meta', 'Cargando…'));
    const r = await api('worksadmin');
    if (!r.ok) { pane.replaceChildren(el('p', 'meta', r.error)); return; }
    pane.replaceChildren(el('p', 'meta', `Curadores: ${r.curators.length ? r.curators.join(', ') : 'ninguno todavía'}. Para nombrar o quitar: /curador nick (y /creador nick para el título de Creador).`));
    const order = { en_disputa: 0, pendiente: 1, verificada: 2, expuesta: 3, denegada: 4, expuesta_antes: 5 };
    const works = [...r.works].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.created - b.created);
    if (!works.length) pane.append(el('p', 'meta', 'Todavía no hay postulaciones.'));
    for (const w of works) {
      const card = el('div', `work-card admin ${w.status}`);
      const text = el('div', 'work-text');
      text.append(el('b', '', w.title), el('span', 'meta', `${w.kind === 'cuadro' ? 'Cuadro' : 'Escultura'} de ${w.author?.name ?? '?'} · ${STATUS[w.status] ?? w.status}`));
      for (const v of w.votes) text.append(el('span', 'meta', `${v.vote === 'ok' ? '✔ Verificó' : '✖ Denegó'} ${v.who}${v.reason ? ` (${v.reason}${v.text ? `: ${v.text}` : ''})` : ''}`));
      const actions = el('div', 'work-actions');
      const see = el('button', 'act', 'Ver');
      const view = el('div', 'work-review-view');
      view.hidden = true;
      see.onclick = () => { view.hidden = !view.hidden; if (!view.hidden) preview(view, w, w.kind === 'cuadro' ? 'hd' : 'model'); };
      actions.append(see);
      if (['pendiente', 'en_disputa'].includes(w.status)) actions.append(voteBox(w, r.reasons, renderAdmin));
      const remove = el('button', 'act danger', 'Bajar');
      remove.onclick = async () => {
        if (!confirm(`¿Bajar "${w.title}"? Sale de la cola o del Museo.`)) return;
        const x = await api('workremove', { method: 'POST', body: { id: w.id } });
        if (!x.ok) return toast(x.error);
        renderAdmin();
      };
      actions.append(remove);
      card.append(text, actions, view);
      pane.append(card);
    }
  }

  return {
    async open() {
      setKind(kind);
      ui.openOverlay('works');
      await renderMine(); // sabe si sos curador/admin (para las pestañas)
      show(tab === 'revisar' && !info?.curator ? 'postular' : tab);
    },
  };
}
