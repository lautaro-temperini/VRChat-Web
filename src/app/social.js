// Lo social y lo que se hace con el personaje: objetos en el suelo (soltar, arrastrar a la escena),
// el Mapa (favoritas, salas), los gestos (R), inventario e intercambios, el celular y la progresión.
import * as THREE from 'three';
import { api } from '../net/api.js';
import { createSocial } from '../ui/social.js';
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

// Mapa: favoritas (arriba de todo), el Museo, tu sala (con sus ajustes) y las salas de tus amigos.
// La estrella marca/desmarca favorita, también la sala en la que estás.
let favorites = [];
const PRIVACY_LABEL = { todos: 'Abierta a todos', amigos: 'Solo amigos', cerrada: 'Cerrada (solo vos)' };
async function openMundi() {
  G.openOverlay('mundi');
  const [fav, mine] = await Promise.all([api('favorites'), G.account ? api(`roominfo?id=${G.account.id}`) : null]);
  if (fav.ok) favorites = fav.favorites;
  const isFav = (target) => favorites.some((f) => f.room === target);
  const list = $('mundi-list');
  list.innerHTML = '';
  const section = (title) => {
    const h = document.createElement('h2');
    h.className = 'sub-h';
    h.textContent = title;
    list.append(h);
  };
  const add = (title, sub, target) => {
    const el = document.createElement('div');
    el.className = `mundi-room ${target === room ? 'here' : ''}`;
    const star = document.createElement('button');
    star.className = `star ${isFav(target) ? 'on' : ''}`;
    star.title = isFav(target) ? 'Sacar de favoritas' : 'Agregar a favoritas';
    star.textContent = isFav(target) ? '★' : '☆';
    star.onclick = async () => {
      const r = await api('favorite', { method: 'POST', body: { room: target, on: !isFav(target) } });
      if (!r.ok) return toast(r.error);
      openMundi();
    };
    const who = document.createElement('div');
    who.className = 'who';
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('span');
    s.textContent = target === room ? `Estás acá${sub ? ` · ${sub}` : ''}` : sub;
    who.append(b, s);
    el.append(star, who);
    if (target !== room) {
      const go = document.createElement('button');
      go.className = 'act on';
      go.textContent = 'Ir';
      go.onclick = () => social.go(target);
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
  if (G.account && !G.account.guest && mine?.ok) {
    const myRoom = `u-${G.account.id}`;
    const el = add(mine.room.name, ['Tu sala', PRIVACY_LABEL[mine.room.privacy], hearts(mine.room.hearts)].filter(Boolean).join(' · '), myRoom);
    // Ajustes de tu sala: nombre, descripción y quién puede entrar
    const edit = document.createElement('button');
    edit.className = 'act';
    edit.textContent = 'Editar';
    edit.onclick = () => {
      const form = document.createElement('form');
      form.className = 'room-form';
      form.innerHTML = `
        <label class="field">Nombre de la sala<input name="name" maxlength="32" placeholder="Sala de ${G.account.name.replace(/[<>"]/g, '')}"></label>
        <label class="field">Descripción<input name="desc" maxlength="140" placeholder="¿De qué se trata tu sala?"></label>
        <label class="field">Quién puede entrar<select name="privacy">
          <option value="todos">Abierta a todos</option><option value="amigos">Solo amigos</option><option value="cerrada">Cerrada (solo vos)</option>
        </select></label>
        <div class="compose-row"><button type="button" class="act" data-cancel>Cancelar</button><button class="act on">Guardar</button></div>`;
      form.name.value = mine.room.customName ?? '';
      form.desc.value = mine.room.desc ?? '';
      form.privacy.value = mine.room.privacy;
      form.querySelector('[data-cancel]').onclick = () => openMundi();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const r = await api('myroom', { method: 'PUT', body: { name: form.name.value, desc: form.desc.value, privacy: form.privacy.value } });
        if (!r.ok) return toast(r.error);
        toast('Guardaste los cambios de tu sala.');
        if (room === myRoom) { G.roomTitle = r.room.name; G.setStatus(); }
        openMundi();
      };
      el.after(form);
      edit.remove();
    };
    el.append(edit);
    if (mine.room.desc) { const d = document.createElement('p'); d.className = 'meta room-desc'; d.textContent = mine.room.desc; el.after(d); }
  }
  const friends = social.friends.friends;
  if (friends.length) {
    section('Salas de tus amigos');
    for (const f of friends) add(`Sala de ${f.name}`, f.room ? social.roomLabel(f.room).replace(/^En /, `${f.name} está en `) : 'Su sala personal', `u-${f.id}`);
  }
  // La sala actual, si no aparece en ninguna lista, igual se puede marcar como favorita
  const listed = ['museo', G.account && `u-${G.account.id}`, ...favorites.map((f) => f.room), ...friends.map((f) => `u-${f.id}`)];
  if (!listed.includes(room)) {
    section('Estás en');
    add(G.roomTitle, '', room);
  }
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
$('btn-inv').onclick = () => (body.classList.contains('inventory') ? G.closeOverlays() : social.openInventory());

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
