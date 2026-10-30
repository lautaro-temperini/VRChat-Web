// Lo social y lo que se hace con el personaje: objetos en el suelo (soltar, arrastrar a la escena),
// el Mapa (favoritas, salas), los gestos (R), inventario e intercambios, el celular y la progresión.
import * as THREE from 'three';
import { api } from '../net/api.js';
import { PUBLIC_MAPS } from '../../server/shared.js';
import { createSocial } from '../ui/social.js';
import { createDesignUpload } from '../ui/designs.js';
import { createPhone } from '../ui/phone.js';
import { createProgress } from '../ui/progress.js';
import { toast } from '../ui/toast.js';
import { Ground } from '../world/ground.js';
import { EMOTES, ITEM_REACH } from '../../server/shared.js';
import { G, $, body } from './state.js';

const { scene, ctrl, net, camera, world, renderer, room, me } = G;

// Objetos en el suelo
const ground = new Ground(scene);
function dropItem(it, at) {
  // Por defecto, adelante del personaje; si se arrastró a la escena, donde se soltó
  const p = at ?? ctrl.pos.clone().add(new THREE.Vector3(Math.sin(ctrl.bodyYaw), 0, Math.cos(ctrl.bodyYaw)).multiplyScalar(0.9));
  // Alcance máximo: 3 m (si se arrastró más lejos, cae a 3 m en esa dirección)
  const off = new THREE.Vector2(p.x - ctrl.pos.x, p.z - ctrl.pos.z);
  if (off.length() > ITEM_REACH) { off.setLength(ITEM_REACH); p.set(ctrl.pos.x + off.x, ctrl.pos.y, ctrl.pos.z + off.y); }
  net.send({ t: 'drop', iid: it.iid, x: p.x, y: p.y, z: p.z });
}

// Arrastrar un objeto del inventario a la escena para soltarlo ahí
const dropRay = new THREE.Raycaster();
function pointOnWorld(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  dropRay.setFromCamera(ndc, camera);
  // Primero una superficie horizontal (mesa, escenario, banco); si no, el piso
  const hit = dropRay.intersectObjects(world.blockers, false).find((h) => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7);
  if (hit) return hit.point;
  const p = new THREE.Vector3();
  if (!dropRay.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
  p.x = THREE.MathUtils.clamp(p.x, -17.6, 17.6);
  p.z = THREE.MathUtils.clamp(p.z, -10.6, 10.6);
  return p;
}
renderer.domElement.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/iid')) e.preventDefault(); });
renderer.domElement.addEventListener('drop', (e) => {
  const iid = e.dataTransfer.getData('text/iid');
  if (!iid) return;
  e.preventDefault();
  const p = pointOnWorld(e.clientX, e.clientY);
  if (p) social.dropByIid(iid, p);
});

// Mapa: favoritas (arriba de todo), el Museo y los mapas públicos, tus salas (hasta 3, con sus ajustes) y las
// salas de tus amigos. La estrella marca/desmarca favorita, también la sala en la que estás.
let favorites = [];
const PRIVACY_LABEL = { todos: 'Abierta a todos', amigos: 'Solo amigos', cerrada: 'Cerrada (solo vos)' };
const PRIVACY_OPTIONS = '<option value="todos">Abierta a todos</option><option value="amigos">Solo amigos</option><option value="cerrada">Cerrada (solo vos)</option>';
async function openMundi() {
  G.openOverlay('mundi');
  const own = G.account && !G.account.guest;
  const [fav, mine] = await Promise.all([api('favorites'), own ? api('myrooms') : null]);
  if (fav.ok) favorites = fav.favorites;
  social.refreshMyRooms();
  const isFav = (target) => favorites.some((f) => f.room === target);
  const list = $('mundi-list');
  list.innerHTML = '';
  const section = (title) => {
    const h = document.createElement('h2');
    h.className = 'sub-h';
    h.textContent = title;
    list.append(h);
  };
  // target: la sala (u-<id>, museo…); onGo: otra forma de ir (la sala de un amigo que no está en ninguna)
  const add = (title, sub, target, onGo) => {
    const el = document.createElement('div');
    el.className = `mundi-room ${target && target === room ? 'here' : ''}`;
    if (target) {
      const star = document.createElement('button');
      star.className = `star ${isFav(target) ? 'on' : ''}`;
      star.title = isFav(target) ? 'Sacar de favoritas' : 'Agregar a favoritas';
      star.textContent = isFav(target) ? '★' : '☆';
      star.onclick = async () => {
        const r = await api('favorite', { method: 'POST', body: { room: target, on: !isFav(target) } });
        if (!r.ok) return toast(r.error);
        openMundi();
      };
      el.append(star);
    }
    const who = document.createElement('div');
    who.className = 'who';
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('span');
    s.textContent = target === room ? `Estás acá${sub ? ` · ${sub}` : ''}` : sub;
    who.append(b, s);
    el.append(who);
    if (target !== room) {
      const go = document.createElement('button');
      go.className = 'act on';
      go.textContent = 'Ir';
      go.onclick = onGo ?? (() => social.go(target));
      el.append(go);
    }
    list.append(el);
    return el;
  };
  const hearts = (n) => (n ? `♥ ${n}` : '');

  if (favorites.length) {
    section('Favoritas');
    for (const f of favorites) add(f.name, [f.ownerName && `de ${f.ownerName}`, hearts(f.hearts)].filter(Boolean).join(' · '), f.room);
  }
  section('Salas');
  add('Museo', 'Sala pública', 'museo');
  for (const [id, m] of Object.entries(PUBLIC_MAPS)) add(m.name, `Mapa público · ${m.desc}`, id);
  const myRooms = mine?.ok ? mine.rooms : [];
  if (own && mine?.ok) {
    section(`Tus salas (${myRooms.length} de ${mine.max})`);
    for (const r of myRooms) {
      const tpl = mine.templates.find((t) => t.id === r.template)?.name;
      const el = add(r.name, [tpl, PRIVACY_LABEL[r.privacy], hearts(r.hearts)].filter(Boolean).join(' · '), r.room);
      const edit = document.createElement('button');
      edit.className = 'act';
      edit.textContent = 'Editar';
      edit.onclick = () => roomForm(el, edit, r);
      el.append(edit);
      if (r.desc) { const d = document.createElement('p'); d.className = 'meta room-desc'; d.textContent = r.desc; el.after(d); }
    }
    if (myRooms.length < mine.max) {
      const create = document.createElement('button');
      create.className = 'act on';
      create.textContent = 'Crear una sala';
      create.onclick = () => createForm(create, mine.templates);
      list.append(create);
    }
  }
  const friends = social.friends.friends;
  if (friends.length) {
    section('Salas de tus amigos');
    for (const f of friends) {
      if (f.room?.startsWith('u-')) add(`Sala donde está ${f.name}`, social.roomLabel(f.room).replace(/^En /, `${f.name} está en `), f.room);
      else add(`Salas de ${f.name}`, f.room ? social.roomLabel(f.room).replace(/^En /, `${f.name} está en `) : 'Sus salas personales', null, () => social.goUser(f.id, f.name));
    }
  }
  // La sala actual, si no aparece en ninguna lista, igual se puede marcar como favorita
  const listed = ['museo', ...Object.keys(PUBLIC_MAPS), ...myRooms.map((r) => r.room), ...favorites.map((f) => f.room), ...friends.map((f) => f.room)];
  if (!listed.includes(room)) {
    section('Estás en');
    add(G.roomTitle, '', room);
  }
}

// Ajustes de una sala propia: nombre, descripción, quién puede entrar, y borrarla (con confirmación)
function roomForm(el, edit, r) {
  const form = document.createElement('form');
  form.className = 'room-form';
  form.innerHTML = `
    <label class="field">Nombre de la sala<input name="name" maxlength="32"></label>
    <label class="field">Descripción<input name="desc" maxlength="140" placeholder="¿De qué se trata tu sala?"></label>
    <label class="field">Quién puede entrar<select name="privacy">${PRIVACY_OPTIONS}</select></label>
    <div class="compose-row"><button type="button" class="act danger" data-delete>Borrar sala</button><button type="button" class="act" data-cancel>Cancelar</button><button class="act on">Guardar</button></div>`;
  form.name.placeholder = r.name;
  form.name.value = r.customName ?? '';
  form.desc.value = r.desc ?? '';
  form.privacy.value = r.privacy;
  form.querySelector('[data-cancel]').onclick = () => openMundi();
  form.querySelector('[data-delete]').onclick = () => {
    // Confirmación: borrar no se deshace
    const row = form.querySelector('.compose-row');
    row.innerHTML = '';
    const q = document.createElement('p');
    q.className = 'meta';
    q.textContent = `¿Borrar "${r.name}"? Se echa a quien esté adentro, los muebles especiales vuelven a tu mochila y se pierden sus corazones. No se puede deshacer.`;
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'act'; no.textContent = 'No, dejarla';
    no.onclick = () => openMundi();
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'act danger'; yes.textContent = 'Sí, borrar';
    yes.onclick = async () => {
      const res = await api('roomdelete', { method: 'POST', body: { id: r.id } });
      if (!res.ok) return toast(res.error);
      toast(`Borraste "${r.name}".`);
      if (room === r.room) return social.go('museo');
      openMundi();
    };
    row.before(q);
    row.append(no, yes);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const res = await api('myroom', { method: 'PUT', body: { id: r.id, name: form.name.value, desc: form.desc.value, privacy: form.privacy.value } });
    if (!res.ok) return toast(res.error);
    toast('Guardaste los cambios de tu sala.');
    if (room === r.room) { G.roomTitle = res.room.name; G.setStatus(); }
    openMundi();
  };
  el.after(form);
  edit.remove();
}

// Crear una sala: la plantilla se elige ahora y queda fija
function createForm(button, templates) {
  const form = document.createElement('form');
  form.className = 'room-form';
  form.innerHTML = `
    <label class="field">Plantilla (queda fija)<select name="template"></select></label>
    <label class="field">Nombre de la sala<input name="name" maxlength="32" placeholder="Opcional"></label>
    <div class="compose-row"><button type="button" class="act" data-cancel>Cancelar</button><button class="act on">Crear</button></div>`;
  for (const t of templates) form.template.add(new Option(t.name, t.id));
  form.querySelector('[data-cancel]').onclick = () => openMundi();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const res = await api('roomcreate', { method: 'POST', body: { template: form.template.value, name: form.name.value } });
    if (!res.ok) return toast(res.error);
    social.go(res.room.room);
  };
  button.replaceWith(form);
}
const toggleMundi = () => (body.classList.contains('mundi') ? G.closeOverlays() : openMundi());
$('btn-mundi').onclick = toggleMundi;

// ---------- Gestos (R / comandos del chat) ----------
function gesture(name) {
  if (!G.joined || !EMOTES[name]) return;
  me.gesture(name);
  net.send({ t: 'emote', e: name });
}
for (const [title, dance] of [['Gestos', false], ['Bailes (siguen hasta que te movés)', true]]) {
  const h = document.createElement('h2');
  h.className = 'sub-h';
  h.textContent = title;
  $('gesture-list').append(h);
  Object.entries(EMOTES).filter(([, g]) => !!g.dance === dance).forEach(([id, g], i) => {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = dance ? `${i + 1}. ${g.name}` : g.name;
    b.onclick = () => { G.closeOverlays(); gesture(id); };
    $('gesture-list').append(b);
  });
}
const toggleGestures = () => (body.classList.contains('gestures') ? G.closeOverlays() : G.openOverlay('gestures'));
$('btn-gestures').onclick = toggleGestures;


// Inventario, amigos, salas e intercambios
const social = createSocial({
  net, room, me: () => G.account,
  ui: G.ui,
  onEquip: (equip) => { G.setEquip(equip); net.send({ t: 'look' }); },
  onDrop: (it, at) => dropItem(it, at),
});
// Personaje y Mochila: dos pestañas del mismo botón (P · I)
for (const b of document.querySelectorAll('.yo-tabs [data-yo]')) {
  b.onclick = async () => {
    if (b.dataset.yo === 'inv' && !body.classList.contains('inventory')) {
      if (body.classList.contains('editing')) await G.closeEditor();
      social.openInventory();
    } else if (b.dataset.yo === 'look' && !body.classList.contains('editing')) G.openEditor();
  };
}
// Subir diseños propios (estampas, cuadros, objetos 3D): botón del inventario (ui/designs.js)
const designUp = createDesignUpload({ ui: G.ui, me: () => G.account, onDone: (items, kind) => social.showItems(items, kind === 'estampa' ? 'mochila' : 'mobiliario') });
$('btn-design-up').onclick = () => designUp.open();

// Celular (la red social): inicio = amigos. Mientras está abierto, el personaje lo tiene en la mano.
const phone = createPhone({ social, me: () => G.account, go: (target) => social.go(target), room });
G.sendPhone = (v) => { if (net.ready) net.send({ t: 'phone', v }); };
async function openPhone() {
  await social.openFriends();
  phone.open();
}
const togglePhone = () => (body.classList.contains('friends') ? G.closeOverlays() : openPhone());
// Progresión: barrita de nivel en el HUD y app "Progreso" en el celular (ui/progress.js)
const progress = createProgress({ net, me: () => G.account, openPhone });
$('btn-friends').onclick = togglePhone;
for (const b of document.querySelectorAll('[data-close-panel]')) b.onclick = G.closeOverlays;


Object.assign(G, { ground, social, phone, progress, gesture, openMundi, toggleMundi, toggleGestures, togglePhone });
