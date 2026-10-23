import * as THREE from 'three';
import { FURNITURE, FURNITURE_CATS, ROOM_TEMPLATES, ROOM_MAX_PIECES, SCREEN_WIDTH } from '../../server/shared.js';
import { buildFurniture } from './furniture.js';
import { api, photoUrl } from '../net/api.js';
import { createStage2 } from './stage2.js';
import './editor.css';

// Editor de la sala propia (u-<id>). Solo el dueño lo abre.
// - Cámara desde arriba (las paredes que tapan y el techo se ocultan).
// - Catálogo de muebles básicos (libres) y especiales (del inventario).
// - Arrastrar para mover (grilla de 25 cm; con Alt, libre), girar de a 15°, color RGB libre.
// - Los cambios se mandan a la sala al soltar: los visitantes los ven recién ahí. Esc cancela.
// - Celular: tocar y arrastrar; botones grandes para girar, color, sacar y listo.

const GRID = 0.25, TURN = Math.PI / 12;
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const TEMPLATE_TEXT = {
  loft: 'Piso de madera, ladrillo y un ventanal a la ciudad.',
  galeria: 'Paredes blancas y luz cenital, para colgar y exponer.',
  club: 'Paredes negras, luces de color, cabina de DJ y pantalla.',
  terraza: 'Al aire libre, con baranda, guirnaldas y la ciudad de fondo.',
};
const QUICK_COLORS = ['#f4f1ea', '#1d1d22', '#4a2c1b', '#8a3b3b', '#2f3a48', '#3f7a3a', '#c9a14a', '#ff4fd8', '#19d3ff'];

export function createRoomEditor({ world, scene, camera, renderer, net, rtc, ctrl, me, ui, toast, isTouch }) {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  let isOwner = false;
  let active = false;
  let selected = null;     // id del mueble elegido
  let drag = null;         // { id, start: {x,y,z,r}, offset, moved, pointerId }
  let orbit = null;        // { x, y, pointerId }
  const pointers = new Map();
  let pinch = null;
  let specials = [];       // muebles especiales del inventario
  let prevMode = null;
  let tmpN = 0;
  const cam = { tx: 0, tz: 0, yaw: 0, pitch: 0.9, dist: 13 };
  const keys = new Set();

  // ---------- Interfaz ----------
  const btn = document.createElement('button');
  btn.id = 'btn-roomedit';
  btn.className = 'pill';
  btn.title = 'Editar tu sala';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 21h4L19 9l-4-4L3 17z"/><path d="M14 6l4 4"/></svg><span class="lbl">Editar sala</span>';
  btn.hidden = true;
  btn.onclick = () => (active ? close() : open());
  $('topbar').insertBefore(btn, $('btn-settings'));
  for (const s of btn.querySelectorAll(':scope > *')) s.style.transform = 'skewX(calc(var(--skew) * -1))';

  const root = document.createElement('div');
  root.id = 'roomedit';
  root.innerHTML = `
    <div id="re-surface"></div>
    <aside id="re-catalog">
      <header>
        <h1 class="display">Tu sala</h1>
        <span id="re-count"></span>
      </header>
      <div class="re-row">
        <button class="act" id="re-template">Plantilla</button>
        <button class="act on" id="re-done">Listo</button>
        <button class="act re-toggle" id="re-toggle">Agregar</button>
      </div>
      <div class="re-cats" id="re-cats"></div>
      <div class="re-grid" id="re-grid"></div>
      <p class="meta re-hint">${isTouch ? 'Tocá un mueble y arrastralo. Arrastrá en el piso para girar la vista; pellizcá para acercarte.' : 'Arrastrá para mover · <kbd>R</kbd> girar · <kbd>Alt</kbd> sin grilla · <kbd>Supr</kbd> sacar · <kbd>Esc</kbd> cancelar · rueda y <kbd>WASD</kbd> para la vista'}</p>
    </aside>
    <div id="re-selected">
      <b id="re-name"></b>
      <div class="re-row">
        <button class="act" id="re-left" title="Girar a la izquierda">⟲</button>
        <button class="act" id="re-right" title="Girar a la derecha">⟳</button>
        <label class="act re-color" title="Color"><input type="color" id="re-color"><span>Color</span></label>
        <button class="act" id="re-photo">Foto</button>
        <button class="act danger" id="re-remove">Sacar</button>
        <button class="act on" id="re-deselect">Listo</button>
      </div>
      <div class="re-row re-swatches" id="re-swatches"></div>
      <div class="re-row" id="re-screen">
        <label class="field">Tamaño <input type="range" id="re-width" min="${SCREEN_WIDTH[0]}" max="${SCREEN_WIDTH[1]}" step="0.25"></label>
        <span class="meta">Muestra:</span>
        <button class="act" data-mode="propia">Su propio VJ</button>
        <button class="act" data-mode="espejo">Lo mismo que la otra</button>
      </div>
    </div>
`;
  // El selector de plantilla y de fotos va aparte: se abre también fuera del modo edición
  const modal = document.createElement('div');
  modal.id = 're-modal';
  modal.className = 're-modal';
  modal.innerHTML = '<div class="re-card" id="re-modal-card"></div>';
  document.body.append(root, modal);

  let cat = 'living';
  function renderCats() {
    const el = $('re-cats');
    el.innerHTML = '';
    for (const [id, name] of Object.entries(FURNITURE_CATS)) {
      const b = document.createElement('button');
      b.className = `tab ${id === cat ? 'active' : ''}`;
      b.textContent = name;
      b.onclick = () => { cat = id; renderCats(); renderGrid(); };
      el.append(b);
    }
  }
  function renderGrid() {
    const grid = $('re-grid');
    grid.innerHTML = '';
    const layout = world.layout;
    $('re-count').textContent = layout ? `${layout.pieces.length}/${ROOM_MAX_PIECES}` : '';
    if (cat === 'especial') {
      if (!specials.length) grid.innerHTML = '<div class="empty">No tenés muebles especiales en el inventario. Se ganan jugando (y se pueden intercambiar).</div>';
      for (const it of specials) grid.append(card(it.type, it.color, () => addPiece(it.type, { iid: it.iid, c: it.color })));
      return;
    }
    for (const [type, def] of Object.entries(FURNITURE)) {
      if (def.cat !== cat || def.special) continue;
      grid.append(card(type, def.color, () => addPiece(type)));
    }
  }
  function card(type, color, onClick) {
    const def = FURNITURE[type];
    const b = document.createElement('button');
    b.className = 'item';
    const img = document.createElement('img');
    img.alt = '';
    img.src = thumbnail(type, color);
    const label = document.createElement('span');
    label.textContent = def.name;
    b.append(img, label);
    const n = world.layout?.pieces.filter((p) => p.type === type).length ?? 0;
    if (def.max && n >= def.max) { b.disabled = true; b.title = `Ya ${def.max === 1 ? 'está puesto' : `hay ${def.max}`}`; }
    b.onclick = onClick;
    return b;
  }

  // Miniatura de cada mueble (se dibuja una vez con el mismo renderer, fuera de pantalla)
  const thumbs = new Map();
  let thumbKit = null;
  function thumbnail(type, color) {
    const key = `${type}${color}`;
    if (thumbs.has(key)) return thumbs.get(key);
    thumbKit ??= {
      target: new THREE.WebGLRenderTarget(128, 128),
      scene: new THREE.Scene(),
      cam: new THREE.PerspectiveCamera(30, 1, 0.05, 50),
      canvas: Object.assign(document.createElement('canvas'), { width: 128, height: 128 }),
    };
    const k = thumbKit;
    k.scene.clear();
    k.scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(2, 4, 3);
    k.scene.add(sun);
    const built = buildFurniture({ type, c: color, w: 2.4 }, { h: 3.2 });
    const holder = new THREE.Group();
    holder.add(built.group);
    if (FURNITURE[type].mount === 'wall') built.group.position.y = 1;
    k.scene.add(holder);
    const labels = [];
    built.group.traverse((o) => { if (o.isCSS2DObject) labels.push(o); });
    for (const l of labels) l.removeFromParent();
    const box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const dir = FURNITURE[type].mount === 'wall' ? new THREE.Vector3(0.35, 0.15, 1) : new THREE.Vector3(1, 0.8, 1.4);
    k.cam.position.copy(c).addScaledVector(dir.normalize(), r / Math.sin((15 * Math.PI) / 180) * 1.05);
    k.cam.lookAt(c);
    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    renderer.setRenderTarget(k.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(k.scene, k.cam);
    const px = new Uint8Array(128 * 128 * 4);
    renderer.readRenderTargetPixels(k.target, 0, 0, 128, 128, px);
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevTone;
    const g = k.canvas.getContext('2d');
    const data = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) data.data.set(px.subarray((127 - y) * 512, (128 - y) * 512), y * 512); // da vuelta en vertical
    g.putImageData(data, 0, 0);
    const url = k.canvas.toDataURL();
    holder.traverse((o) => { o.geometry?.dispose(); });
    thumbs.set(key, url);
    return url;
  }

  // ---------- Abrir y cerrar ----------
  function open() {
    if (!isOwner) return;
    if (!world.layout?.chosen) return chooseTemplate(true);
    ui.openOverlay('roomedit');
    active = true;
    prevMode = ctrl.mode;
    if (ctrl.mode === 'first') ctrl.setMode('third');
    const def = ROOM_TEMPLATES[world.layout.template];
    // Con la pantalla vertical (celular) hay que alejarse más para ver la sala entera
    Object.assign(cam, { tx: 0, tz: 0.5, yaw: 0, pitch: 1.05, dist: Math.max(def.w, def.d) * 1.15 * Math.min(1.9, Math.max(1, 1.2 / camera.aspect)) });
    grid.visible = true;
    renderCats();
    renderGrid();
    loadSpecials();
  }
  function close() {
    if (!active) return;
    cancelDrag();
    select(null);
    active = false;
    grid.visible = false;
    for (const c of world.shell?.cutaway ?? []) c.object.visible = true;
    if (prevMode && prevMode !== ctrl.mode) ctrl.setMode(prevMode);
    if (body.classList.contains('roomedit')) ui.closeOverlays();
  }
  async function loadSpecials() {
    const r = await api('inventory');
    if (!r.ok) return;
    specials = r.items.filter((it) => FURNITURE[it.type]?.special);
    if (cat === 'especial' && active) renderGrid();
  }

  $('re-done').onclick = close;
  $('re-template').onclick = () => chooseTemplate(false);
  $('re-toggle').onclick = () => $('re-catalog').classList.toggle('open');

  // ---------- Plantillas ----------
  function chooseTemplate(first) {
    const card = $('re-modal-card');
    card.innerHTML = `<h1 class="display">${first ? 'Elegí cómo es tu sala' : 'Cambiar de plantilla'}</h1>
      <p class="meta">${first ? 'Después la podés cambiar cuando quieras.' : 'Los muebles básicos se borran (la plantilla nueva trae los suyos) y los especiales vuelven a tu inventario.'}</p>
      <div class="re-templates"></div>
      <div class="re-row"><button class="act" data-cancel>${first ? 'Más tarde' : 'Cancelar'}</button></div>`;
    const list = card.querySelector('.re-templates');
    for (const [id, t] of Object.entries(ROOM_TEMPLATES)) {
      const b = document.createElement('button');
      b.className = `re-template ${world.layout?.template === id && world.layout.chosen ? 'current' : ''}`;
      b.dataset.t = id;
      b.innerHTML = `<b class="display"></b><span></span>`;
      b.querySelector('b').textContent = t.name;
      b.querySelector('span').textContent = TEMPLATE_TEXT[id];
      b.onclick = () => {
        net.send({ t: 'edit', op: 'template', template: id });
        hideModal();
        pendingOpen = true;
      };
      list.append(b);
    }
    card.querySelector('[data-cancel]').onclick = hideModal;
    $('re-modal').classList.add('show');
  }
  let pendingOpen = false;
  const hideModal = () => $('re-modal').classList.remove('show');
  $('re-modal').addEventListener('click', (e) => { if (e.target.id === 're-modal') hideModal(); });

  // ---------- Muebles ----------
  const entry = (id) => world.pieces.get(id);
  function pieceData(id) { const e = entry(id); return e ? { ...e.piece } : null; }

  function addPiece(type, extra = {}) {
    const layout = world.layout;
    if (!layout) return;
    const def = FURNITURE[type];
    if (layout.pieces.length >= ROOM_MAX_PIECES) return toast(`Llegaste al máximo de ${ROOM_MAX_PIECES} objetos en la sala.`);
    if (def.max && layout.pieces.filter((p) => p.type === type).length >= def.max) return toast(`"${def.name}": puede haber ${def.max === 1 ? 'uno solo' : `hasta ${def.max}`} por sala.`);
    const id = `t${Date.now().toString(36)}${tmpN++}`;
    const piece = { id, type, x: snap(cam.tx), z: snap(cam.tz), y: 0, r: 0, c: def.color, ...extra };
    if (def.mount === 'wall') {
      // En la pared que mejor se ve desde la cámara, a la altura de los ojos
      const fwd = camera.getWorldDirection(new THREE.Vector3());
      const wall = hangWalls().sort((a, b) => a.normal.dot(fwd) - b.normal.dot(fwd))[0];
      if (!wall) return toast('Esta sala no tiene paredes libres para colgar.');
      if (type === 'pantalla') { piece.w = 3.6; piece.m = 'espejo'; }
      Object.assign(piece, freeWallSpot(wall, type === 'pantalla' ? 2.6 : 1.6, piece));
    } else {
      // Un poco más allá del centro de la vista, mirando a la cámara
      piece.r = Math.round((cam.yaw + Math.PI) / TURN) * TURN;
      Object.assign(piece, clampFloor(piece));
    }
    world.setPiece(piece);
    net.send({ t: 'edit', op: 'add', piece });
    if (extra.iid) { specials = specials.filter((s) => s.iid !== extra.iid); }
    select(id);
    renderGrid();
    if (isTouch) $('re-catalog').classList.remove('open');
  }

  function sendUpdate(id, fields) {
    const e = entry(id);
    if (!e) return;
    world.setPiece({ ...e.piece, ...fields });
    if (id.startsWith('t')) { pendingUpdates.set(id, { ...(pendingUpdates.get(id) ?? {}), ...fields }); return; } // todavía no llegó a la sala
    net.send({ t: 'edit', op: 'update', id, piece: fields });
  }
  const pendingUpdates = new Map();

  function removeSelected() {
    const id = selected;
    if (!id) return;
    select(null);
    const e = entry(id);
    if (!e) return;
    world.removePiece(id);
    net.send({ t: 'edit', op: 'remove', id });
    renderGrid();
  }

  function rotateSelected(dir) {
    const p = selected && pieceData(selected);
    if (!p || FURNITURE[p.type].mount === 'wall') return;
    const r = Math.round(p.r / TURN) * TURN + dir * TURN;
    sendUpdate(p.id, clampFloor({ ...p, r }));
  }

  // ---------- Selección ----------
  const helper = new THREE.BoxHelper(undefined, 0xffd60a);
  helper.material.depthTest = false;
  helper.renderOrder = 10;
  helper.visible = false;
  scene.add(helper);
  const grid = new THREE.GridHelper(14, 56, 0xffd60a, 0xffffff);
  grid.material.transparent = true;
  grid.material.opacity = 0.12;
  grid.material.depthWrite = false;
  grid.position.y = 0.006;
  grid.visible = false;
  scene.add(grid);

  function select(id) {
    selected = id;
    const p = id && pieceData(id);
    $('re-selected').classList.toggle('show', !!p);
    helper.visible = !!p;
    if (!p) return;
    const def = FURNITURE[p.type];
    $('re-name').textContent = def.name;
    $('re-color').value = p.c;
    $('re-left').hidden = $('re-right').hidden = def.mount === 'wall';
    $('re-photo').hidden = p.type !== 'cuadro';
    $('re-remove').textContent = def.special ? 'Guardar en el inventario' : 'Sacar';
    $('re-screen').hidden = p.type !== 'pantalla';
    if (p.type === 'pantalla') {
      $('re-width').value = p.w;
      for (const b of $('re-screen').querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === p.m);
    }
    const sw = $('re-swatches');
    sw.innerHTML = '';
    for (const c of QUICK_COLORS) {
      const b = document.createElement('button');
      b.className = `swatch ${c === p.c ? 'sel' : ''}`;
      b.style.background = c;
      b.onclick = () => { if (selected) { sendUpdate(selected, { c }); select(selected); } };
      sw.append(b);
    }
  }
  $('re-left').onclick = () => rotateSelected(1);
  $('re-right').onclick = () => rotateSelected(-1);
  $('re-remove').onclick = removeSelected;
  $('re-deselect').onclick = () => select(null);
  // Color RGB libre: se ve mientras elegís y se manda al cerrar el selector
  $('re-color').oninput = (e) => { const p = selected && pieceData(selected); if (p) world.setPiece({ ...p, c: e.target.value }); };
  $('re-color').onchange = (e) => { if (selected) { sendUpdate(selected, { c: e.target.value }); select(selected); } };
  $('re-width').oninput = (e) => { const p = selected && pieceData(selected); if (p) world.setPiece({ ...p, w: Number(e.target.value) }); };
  $('re-width').onchange = (e) => { if (selected) sendUpdate(selected, { w: Number(e.target.value) }); };
  for (const b of root.querySelectorAll('#re-screen [data-mode]')) b.onclick = () => { if (selected) { sendUpdate(selected, { m: b.dataset.mode }); select(selected); } };
  $('re-photo').onclick = () => pickPhoto();

  // ---------- Fotos de la galería ----------
  async function pickPhoto() {
    const id = selected;
    const card = $('re-modal-card');
    card.innerHTML = '<h1 class="display">Elegí una foto</h1><p class="meta">Cargando tu galería…</p><div class="re-photos"></div><div class="re-row"><button class="act" data-cancel>Cancelar</button></div>';
    card.querySelector('[data-cancel]').onclick = hideModal;
    $('re-modal').classList.add('show');
    const r = await api(`photos?id=${encodeURIComponent(me()?.id ?? '')}`);
    const meta = card.querySelector('.meta');
    if (!r.ok) { meta.textContent = r.error; return; }
    if (r.privacy !== 'todos') { meta.textContent = 'Para colgar fotos, tu galería tiene que estar visible para todos (Celular → Galería).'; return; }
    if (!r.photos.length) { meta.textContent = 'Todavía no subiste fotos a tu galería (Celular → Galería).'; return; }
    meta.textContent = 'Las fotos colgadas las ve cualquiera que entre a tu sala.';
    const list = card.querySelector('.re-photos');
    for (const p of r.photos) {
      const b = document.createElement('button');
      b.className = 're-photo';
      const img = document.createElement('img');
      photoUrl(p.id).then((url) => { if (url) img.src = url; });
      b.append(img);
      b.onclick = () => { hideModal(); if (entry(id)) sendUpdate(id, { photo: p.id }); };
      list.append(b);
    }
  }

  // ---------- Cámara del editor ----------
  const tmpV = new THREE.Vector3();
  function update(dt) {
    if (active && !body.classList.contains('roomedit')) close(); // se abrió otro panel
    if (!active) return;
    // Pan con WASD / flechas
    const sp = dt * 6;
    const f = new THREE.Vector2(-Math.sin(cam.yaw), -Math.cos(cam.yaw)), rgt = new THREE.Vector2(Math.cos(cam.yaw), -Math.sin(cam.yaw));
    const mv = (k, v, s) => { if (keys.has(k)) { cam.tx += v.x * s; cam.tz += v.y * s; } };
    mv('KeyW', f, sp); mv('ArrowUp', f, sp); mv('KeyS', f, -sp); mv('ArrowDown', f, -sp);
    mv('KeyD', rgt, sp); mv('ArrowRight', rgt, sp); mv('KeyA', rgt, -sp); mv('ArrowLeft', rgt, -sp);
    const def = ROOM_TEMPLATES[world.layout?.template ?? 'loft'];
    cam.tx = THREE.MathUtils.clamp(cam.tx, -def.w / 2, def.w / 2);
    cam.tz = THREE.MathUtils.clamp(cam.tz, -def.d / 2, def.d / 2);
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, 0.4, cam.tz);
    // Se ocultan el techo y las paredes que quedan entre la cámara y la sala
    for (const c of world.shell?.cutaway ?? []) {
      if (c.keep) continue;
      c.object.visible = c.normal ? tmpV.copy(camera.position).setY(0).dot(c.normal) >= -Math.max(def.w, def.d) / 2 : false;
    }
    const e = selected && entry(selected);
    if (e) { helper.setFromObject(e.holder); helper.visible = true; } else helper.visible = false;
  }

  // ---------- Puntero: elegir, arrastrar, girar la vista ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function setRay(ev) {
    ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pick(ev) {
    setRay(ev);
    const holders = [...world.pieces.values()].map((e) => e.holder);
    const hit = ray.intersectObjects(holders, true).find((h) => h.object.isMesh && h.object.visible);
    return hit ? world.pieceOf(hit.object) : null;
  }
  function floorPoint(ev) {
    setRay(ev);
    return ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
  }
  const snap = (v, free) => (free ? Math.round(v * 100) / 100 : Math.round(v / GRID) * GRID);

  // Paredes donde se puede colgar (las visibles, con altura suficiente)
  function hangWalls() {
    const shell = world.shell;
    if (!shell) return [];
    return shell.walls.filter((w) => w.top >= 1.5 && (shell.cutaway.find((c) => c.normal?.equals(w.normal))?.object.visible ?? true));
  }
  function onWall(wall, along, y, type, free, screenW) {
    const half = (FURNITURE[type].size[0] ?? 1) / 2;
    const hw = type === 'pantalla' ? (screenW ?? pieceData(selected)?.w ?? 3.6) / 2 : half;
    let a = THREE.MathUtils.clamp(snap(along, free), wall.min + hw, wall.max - hw);
    const p = wall.point.clone();
    if (wall.along === 'x') p.x = a; else p.z = a;
    const top = Math.min(wall.top, world.shell.def.h || 4);
    return { x: p.x, z: p.z, y: THREE.MathUtils.clamp(snap(y, free), 0.5, Math.max(0.6, top - 0.4)), r: Math.atan2(wall.normal.x, wall.normal.z) };
  }
  // Un lugar libre en la pared (que no quede encima de otro cuadro o pantalla), empezando por el centro de la vista
  function freeWallSpot(wall, y, piece) {
    const width = (p) => (p.type === 'pantalla' ? p.w ?? 3.6 : FURNITURE[p.type].size[0]);
    const on = [...world.pieces.values()].map((e) => e.piece)
      .filter((p) => FURNITURE[p.type].mount === 'wall' && angleDiff(p.r, Math.atan2(wall.normal.x, wall.normal.z)) < 0.01 && Math.abs((p.y ?? 0) - y) < 1.2);
    const start = wall.along === 'x' ? cam.tx : cam.tz;
    for (let k = 0; k < 24; k++) {
      const a = start + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const spot = onWall(wall, a, y, piece.type, false, piece.w);
      const at = wall.along === 'x' ? spot.x : spot.z;
      if (on.every((p) => Math.abs((wall.along === 'x' ? p.x : p.z) - at) >= (width(p) + width(piece)) / 2 + 0.1)) return spot;
    }
    return onWall(wall, start, y, piece.type, false, piece.w);
  }
  function wallHit(ev, type, free) {
    setRay(ev);
    let best = null;
    for (const w of hangWalls()) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(w.normal, w.point);
      const p = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!p || ray.ray.direction.dot(w.normal) > 0) continue;
      const a = w.along === 'x' ? p.x : p.z;
      if (a < w.min - 0.5 || a > w.max + 0.5 || p.y < -0.5 || p.y > w.top + 1) continue;
      const d = p.distanceTo(ray.ray.origin);
      if (!best || d < best.d) best = { d, w, p };
    }
    return best && onWall(best.w, best.w.along === 'x' ? best.p.x : best.p.z, best.p.y, type, free);
  }
  // Que el mueble no quede afuera de la sala
  function clampFloor(p) {
    const def = ROOM_TEMPLATES[world.layout?.template ?? 'loft'];
    const [w, d] = FURNITURE[p.type].size;
    const c = Math.abs(Math.cos(p.r)), s = Math.abs(Math.sin(p.r));
    const hw = Math.min(def.w / 2, (c * w + s * d) / 2), hd = Math.min(def.d / 2, (s * w + c * d) / 2);
    return { ...p, x: THREE.MathUtils.clamp(p.x, -def.w / 2 + hw, def.w / 2 - hw), z: THREE.MathUtils.clamp(p.z, -def.d / 2 + hd, def.d / 2 - hd) };
  }

  const surface = $('re-surface');
  surface.addEventListener('contextmenu', (e) => e.preventDefault());
  surface.addEventListener('pointerdown', (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    surface.setPointerCapture(ev.pointerId);
    if (pointers.size === 2) {
      // Dos dedos: pellizcar para acercar (y se suelta lo que se estaba arrastrando)
      cancelDrag();
      orbit = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist };
      return;
    }
    const e = ev.button === 0 ? pick(ev) : null;
    if (e) {
      select(e.piece.id);
      const p = e.piece;
      const wall = FURNITURE[p.type].mount === 'wall';
      const fp = wall ? null : floorPoint(ev);
      drag = { id: p.id, start: { x: p.x, y: p.y, z: p.z, r: p.r }, offset: fp ? { x: p.x - fp.x, z: p.z - fp.z } : null, wall, moved: false, pointerId: ev.pointerId };
      surface.classList.add('dragging');
    } else {
      orbit = { x: ev.clientX, y: ev.clientY, moved: false, pointerId: ev.pointerId };
    }
  });
  surface.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (prev) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      cam.dist = THREE.MathUtils.clamp(pinch.dist * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 4, 30);
      return;
    }
    if (drag && drag.pointerId === ev.pointerId) {
      const p = pieceData(drag.id);
      if (!p) { drag = null; return; }
      const free = ev.altKey;
      let next;
      if (drag.wall) next = wallHit(ev, p.type, free);
      else {
        const fp = floorPoint(ev);
        next = fp && clampFloor({ ...p, x: snap(fp.x + drag.offset.x, free), z: snap(fp.z + drag.offset.z, free) });
      }
      if (!next) return;
      if (['x', 'y', 'z', 'r'].some((k) => next[k] !== undefined && Math.abs((next[k] ?? 0) - (p[k] ?? 0)) > 1e-4)) {
        drag.moved = true;
        world.setPiece({ ...p, ...next }); // solo de mi lado: a la sala se manda al soltar
      }
      return;
    }
    if (orbit && orbit.pointerId === ev.pointerId) {
      const dx = ev.clientX - orbit.x, dy = ev.clientY - orbit.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) orbit.moved = true;
      cam.yaw -= dx * 0.006;
      cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.004, 0.35, 1.45);
      orbit.x = ev.clientX; orbit.y = ev.clientY;
      return;
    }
    if (!isTouch) surface.style.cursor = pick(ev) ? 'grab' : '';
  });
  const end = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && drag.pointerId === ev.pointerId) {
      const d = drag;
      drag = null;
      surface.classList.remove('dragging');
      const p = pieceData(d.id);
      if (p && d.moved) sendUpdate(p.id, { x: p.x, y: p.y, z: p.z, r: p.r });
    }
    if (orbit && orbit.pointerId === ev.pointerId) {
      if (!orbit.moved && ev.button === 0) select(null); // tocar el piso suelta la selección
      orbit = null;
    }
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', (ev) => { if (drag?.pointerId === ev.pointerId) cancelDrag(); end(ev); });
  surface.addEventListener('wheel', (ev) => { cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(ev.deltaY) * 0.1), 4, 30); }, { passive: true });

  // Esc mientras arrastrás: el mueble vuelve a su lugar (no se manda nada)
  function cancelDrag() {
    if (!drag) return;
    const p = pieceData(drag.id);
    if (p) world.setPiece({ ...p, ...drag.start });
    drag = null;
    surface.classList.remove('dragging');
  }

  // Teclado del editor (antes que los atajos del juego)
  addEventListener('keydown', (ev) => {
    if (!active || ['INPUT', 'TEXTAREA'].includes(ev.target.tagName)) return;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.key === 'Escape') {
      if ($('re-modal').classList.contains('show')) { hideModal(); stop(); }
      else if (drag) { cancelDrag(); stop(); }
      else if (selected) { select(null); stop(); }
      return; // si no hay nada, Esc cierra el editor (main.js)
    }
    if (ev.code === 'KeyR') { rotateSelected(ev.shiftKey ? -1 : 1); stop(); return; }
    if (ev.code === 'Delete' || ev.code === 'Backspace') { removeSelected(); stop(); return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.code)) { keys.add(ev.code); stop(); return; }
    // El resto de los atajos (E, I, F, Y…) no se usan mientras editás, salvo Enter (chat)
    if (!['Enter', 'Tab'].includes(ev.key) && !['KeyV', 'KeyM'].includes(ev.code)) stop();
  }, true);
  addEventListener('keyup', (ev) => keys.delete(ev.code), true);
  addEventListener('blur', () => keys.clear());

  // ---------- Mensajes de la sala ----------
  net
    .on('layout', ({ layout, back }) => {
      select(null);
      cancelDrag();
      world.setLayout(layout);
      if (isOwner && back) toast(`${back === 1 ? 'Un mueble especial volvió' : `${back} muebles especiales volvieron`} a tu inventario.`);
      if (isOwner && pendingOpen) { pendingOpen = false; if (!active) open(); else { renderGrid(); loadSpecials(); } }
    })
    .on('piece', ({ piece, tmp }) => {
      if (drag?.id === piece.id) return; // lo estoy moviendo yo: manda lo mío al soltar
      const wasSelected = selected === tmp;
      world.setPiece(piece, tmp);
      if (wasSelected) select(piece.id);
      if (tmp && drag?.id === tmp) drag.id = piece.id;
      // Cambios que hice antes de que la sala confirmara el mueble nuevo
      if (tmp && pendingUpdates.has(tmp)) { net.send({ t: 'edit', op: 'update', id: piece.id, piece: pendingUpdates.get(tmp) }); pendingUpdates.delete(tmp); }
      if (active) renderGrid();
    })
    .on('piece-', ({ id, back }) => {
      if (selected === id) select(null);
      if (drag?.id === id) drag = null;
      world.removePiece(id);
      if (isOwner && back) { toast('El mueble especial volvió a tu inventario.'); loadSpecials(); }
      if (active) renderGrid();
    })
    .on('edit-fail', ({ op, id, piece }) => {
      if (op === 'add' && id) { world.removePiece(id); if (selected === id) select(null); loadSpecials(); }
      if (piece) world.setPiece(piece);
      if (active) renderGrid();
    });

  // Al entrar a la sala: el diseño, y si sos el dueño, el botón (y elegir plantilla la primera vez)
  const stage2 = createStage2({ net, rtc, world, toast, ui });
  function onWelcome(m) {
    if (m.layout) world.setLayout(m.layout);
    stage2.onWelcome(m);
    const account = me();
    isOwner = !!account && !account.guest && m.room?.owner === account.id;
    btn.hidden = !isOwner;
    if (isOwner && !m.layout?.chosen) setTimeout(() => chooseTemplate(true), 1200);
  }

  const api_ = { onWelcome, update, open, close, useScreen2: () => stage2.use(), screen2Prompt: () => stage2.prompt(), get active() { return active; }, get selected() { return selected; } };
  if (import.meta.env.DEV) window.__roomEditor = api_;
  return api_;
}
