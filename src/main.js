import './style.css';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMuseum } from './world/museum.js';
import { Avatar, DEFAULT_LOOK, LOOK_OPTIONS, setTextureQuality } from './player/avatar.js';
import { PlayerController } from './player/controller.js';
import { FPArms } from './player/fpArms.js';
import { Net } from './net/net.js';
import { RemotePlayer } from './net/remote.js';
import { api, session } from './net/api.js';
import { RTC } from './net/rtc.js';
import { createSocial } from './ui/social.js';
import { toast } from './ui/toast.js';
import { guestGate, setRegister, lock } from './ui/guest.js';
import { EMOTES, DANCES } from '../server/shared.js';
import { UI_ICONS } from './ui/icons.js';
import { createRoomPanel } from './ui/roompanel.js';
import { Ground } from './world/ground.js';
import { buildLectern } from './world/lectern.js';
import { createPhone } from './ui/phone.js';
import { createNotes } from './ui/notes.js';
import { renderGallery } from './ui/gallery.js';
import { detectQuality, FpsWatch } from './quality.js';
import { Bridge, applyOsc, defaultLights } from './net/osc.js';

const $ = (id) => document.getElementById(id);
// Pantalla de carga (está en index.html): avanza por etapas y se va cuando está todo listo
function loading(pct, text) {
  $('loading-fill').style.width = `${pct}%`;
  if (text) $('loading-text').textContent = text;
}
loading(30, 'Armando el museo…');
const body = document.body;
const pref = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const isTouch = matchMedia('(pointer: coarse)').matches;
body.classList.toggle('touch', isTouch);
const quality = detectQuality({ isTouch }); // 'low' | 'medium' | 'high' (automática, ver quality.js)
const high = quality === 'high';
setTextureQuality(quality === 'low' ? 'low' : 'high');

// ---------- Render ----------
const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, { low: 1, medium: 1.5, high: 2 }[quality]));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = high;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').append(renderer.domElement);

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.className = 'labels';
body.append(labels.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
const world = buildMuseum(scene, renderer, high ? 'high' : 'low');

// Post-procesado (solo calidad alta): sombras de contacto (GTAO) + brillo solo en neones (bloom con umbral alto)
let composer = null;
if (high) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.2, scale: 1 });
  // Los objetos transparentes (haces de luz, manchas de luz) no tienen que generar sombra de contacto
  const renderAO = gtao.render.bind(gtao);
  gtao.render = (...args) => {
    const hidden = [];
    scene.traverseVisible((o) => { if (o.material?.transparent) { o.visible = false; hidden.push(o); } });
    renderAO(...args);
    for (const o of hidden) o.visible = true;
  };
  composer.addPass(gtao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 3.2));
  composer.addPass(new OutputPass());
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer?.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});

// ---------- Jugador local ----------
let account = null; // { id, username, name, look, bio }
let look = { ...DEFAULT_LOOK };
let name = '';
let bio = '';
let joined = false;
const me = new Avatar(look);
scene.add(me.root);
const ctrl = new PlayerController({ camera, avatar: me, world, dom: renderer.domElement });
ctrl.sens = pref.get('sens', 1);
const fpArms = new FPArms(me);
fpArms.syncLook();

function setLook(next) {
  look = next;
  me.setLook(look);
  fpArms.syncLook();
}
function setEquip(list) {
  me.setEquip(list ?? []);
  if (account) account.equip = list ?? [];
}

ctrl.onModeChange = (mode) => {
  $('btn-cam').querySelector('.lbl').textContent = mode === 'first' ? '1ª persona' : '3ª persona';
  body.classList.toggle('first', mode === 'first');
};
// Íconos en la barra superior (en pantallas chicas se ven solo los íconos)
$('btn-cam').innerHTML = `${UI_ICONS.camera}<span class="lbl">3ª persona</span>`;
for (const [id, icon] of [['btn-mic', 'mic'], ['btn-media', 'music'], ['btn-mundi', 'globe'], ['btn-gestures', 'hand'], ['btn-room', 'friends'], ['btn-look', 'user'], ['btn-inv', 'bag'], ['btn-friends', 'phone']]) {
  $(id).insertAdjacentHTML('afterbegin', UI_ICONS[icon]);
}
// En celular, inventario, amigos y el mapa van arriba con el resto (abajo están los controles táctiles)
if (isTouch) for (const b of [...$('dock').children]) $('topbar').insertBefore(b, $('btn-settings'));
$('btn-cam').onclick = () => ctrl.setMode(ctrl.mode === 'first' ? 'third' : 'first');
document.addEventListener('pointerlockchange', () => {
  body.classList.toggle('locked', document.pointerLockElement === renderer.domElement);
});
// Los textos de los botones inclinados van en un <span> para enderezarlos
for (const b of document.querySelectorAll('button.pill:not(.icon)')) {
  if (!b.querySelector('span')) b.innerHTML = `<span>${b.innerHTML}</span>`;
}

// ---------- Estado de la interfaz ----------
// Un solo panel/superposición abierto a la vez. Mientras hay uno, el jugador no se mueve.
const OVERLAYS = ['editing', 'settings', 'inspecting', 'profiling', 'auth', 'inventory', 'friends', 'trading', 'viewing', 'roompanel', 'mundi', 'gestures', 'djing', 'artists', 'controls', 'kicked', 'notes'];
// Paneles que no frenan al personaje (se puede seguir caminando con WASD)
const NON_BLOCKING = ['inventory', 'friends', 'roompanel', 'editing', 'gestures', 'artists'];
function openOverlay(cls) {
  document.exitPointerLock?.();
  for (const c of OVERLAYS) body.classList.toggle(c, c === cls);
  refreshState();
}
function closeOverlays() {
  if (body.classList.contains('trading') && social.trading) social.cancelTrade();
  for (const c of OVERLAYS) body.classList.remove(c);
  refreshState();
}
const overlayOpen = () => OVERLAYS.some((c) => body.classList.contains(c));
let sendPhone = null; // se define cuando existe la conexión con la sala
function refreshState() {
  // Antes de entrar, el editor muestra el personaje en vitrina; ya adentro se puede caminar con el editor abierto
  ctrl.enabled = joined && !body.classList.contains('auth');
  if (!body.classList.contains('editing')) ctrl.showcase = false;
  ctrl.paused = OVERLAYS.some((c) => body.classList.contains(c) && !NON_BLOCKING.includes(c)) || ctrl.typing;
  body.classList.toggle('playing', ctrl.enabled && !ctrl.paused);
  // Celular abierto = el personaje lo tiene en la mano (y los demás lo ven)
  const phoneOut = body.classList.contains('friends');
  if (phoneOut !== me.phone) {
    me.phone = phoneOut;
    sendPhone?.(phoneOut);
  }
}

// ---------- Pantalla de entrada (invitado / login / registro) ----------
const authEl = $('auth');
function showAuth(tab, upgrade = false) {
  authEl.dataset.tab = tab;
  if (upgrade) authEl.dataset.upgrade = ''; else delete authEl.dataset.upgrade;
  for (const b of authEl.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  $('auth-submit').textContent = { guest: 'Entrar como invitado', login: 'Entrar', register: 'Crear cuenta', nick: 'Listo' }[tab];
  $('auth-pass').autocomplete = tab === 'register' ? 'new-password' : 'current-password';
  $('auth-user-label').textContent = tab === 'login' ? 'Mail o nickname' : 'Nickname';
  $('auth-user').placeholder = tab === 'login' ? 'vos@mail.com o tu_nick' : 'tu_nick';
  $('auth-error').textContent = '';
  openOverlay('auth');
  setTimeout(() => $(tab === 'guest' ? 'auth-name' : tab === 'register' ? 'auth-email' : 'auth-user').focus(), 50);
}
// Condiciones de uso (se abren desde la casilla de +18)
$('open-terms').onclick = (e) => { e.preventDefault(); $('terms').classList.add('show'); };
$('close-terms').onclick = () => $('terms').classList.remove('show');
for (const b of authEl.querySelectorAll('.tab')) b.onclick = () => showAuth(b.dataset.tab, 'upgrade' in authEl.dataset);
$('auth-cancel').onclick = () => openEditor();

// Ingresar con Google o Discord: se va a su página y vuelve con #login=<código de un solo uso>
for (const b of authEl.querySelectorAll('.oauth-btn')) {
  b.onclick = async () => {
    b.disabled = true;
    if (joined) await saveProfile(); // si era invitado, su personaje pasa a la cuenta
    const r = await api('oauthstart', { method: 'POST', body: { provider: b.dataset.provider, origin: location.origin } });
    if (!r.ok) { b.disabled = false; $('auth-error').textContent = r.error; return; }
    location.href = r.url;
  };
}
async function finishOAuth() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('login') && !h.has('loginerror')) return false;
  history.replaceState(null, '', location.pathname + location.search); // saco el código de la dirección
  if (h.has('loginerror')) { showAuth('login'); $('auth-error').textContent = h.get('loginerror'); return true; }
  const r = await api('oauthfinish', { method: 'POST', body: { code: h.get('login') } });
  if (!r.ok) { showAuth('login'); $('auth-error').textContent = r.error; return true; }
  session.token = r.token;
  useAccount(r.user);
  if (r.needsNick) {
    // Cuenta nueva: falta el nickname (y aceptar +18 si no lo había hecho)
    if (r.needsTerms) authEl.dataset.terms = ''; else delete authEl.dataset.terms;
    showAuth('nick');
    $('auth-user').value = '';
  } else join();
  return true;
}

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const tab = authEl.dataset.tab;
  const btn = $('auth-submit');
  btn.disabled = true;
  let r;
  if (tab === 'guest') {
    r = await api('guest', { method: 'POST', body: { name: $('auth-name').value, look, terms: $('auth-terms').checked } });
  } else if (tab === 'nick') {
    r = await api('oauthnick', { method: 'POST', body: { nick: $('auth-user').value, terms: $('auth-terms').checked } });
  } else if (tab === 'login') {
    r = await api('login',{ method: 'POST', body: { login: $('auth-user').value, password: $('auth-pass').value } });
  } else {
    r = await api('register', { method: 'POST', body: { email: $('auth-email').value, nick: $('auth-user').value, password: $('auth-pass').value, look, terms: $('auth-terms').checked } });
  }
  btn.disabled = false;
  $('auth-pass').value = '';
  if (!r.ok) { $('auth-error').textContent = r.error; return; }

  if (joined) {
    // Ya estaba en la sala: o convirtió su invitado en cuenta, o cambió de cuenta
    if (account && r.user.id === account.id) { account = r.user; openEditor(); }
    else location.reload();
    return;
  }
  useAccount(r.user);
  if (tab === 'login') { closeOverlays(); join(); } else openEditor(); // cuenta nueva: primero el personaje
};

function useAccount(user) {
  account = user;
  name = user.name;
  bio = user.bio ?? '';
  setLook({ ...DEFAULT_LOOK, ...user.look });
  setEquip(user.equip);
}

// El botón "Crear cuenta" de los avisos para invitados
setRegister(async () => { closeOverlays(); await saveProfile(); showAuth('register', true); });

function renderAccount() {
  const el = $('account');
  el.innerHTML = '';
  const text = document.createElement('span');
  const btn = document.createElement('button');
  if (account?.username) {
    text.append('Cuenta: ', Object.assign(document.createElement('b'), { textContent: `@${account.username}` }));
    btn.textContent = 'Cerrar sesión';
    btn.onclick = async () => { await api('logout', { method: 'POST' }); session.token = null; location.reload(); };
  } else {
    text.textContent = 'Estás como invitado.';
    btn.textContent = 'Crear cuenta';
    btn.onclick = async () => { await saveProfile(); showAuth('register', true); };
  }
  el.append(text, btn);
}

// ---------- Editor de personaje (capa 1) ----------
const GROUPS = [
  ['body', 'Cuerpo'], ['skin', 'Piel'], ['eyes', 'Ojos'], ['hairStyle', 'Peinado'], ['beard', 'Barba'], ['hair', 'Color de pelo'],
  ['top', 'Arriba'], ['shirt', 'Color de remera / buzo'], ['pants', 'Pantalón'], ['shoes', 'Zapatillas'],
];
const CHIP_LABELS = { masc: 'masculino', fem: 'femenino', false: 'sin barba', true: 'con barba' };
function renderSwatches() {
  const root = $('swatches');
  root.innerHTML = '';
  for (const [key, title] of GROUPS) {
    const group = document.createElement('div');
    group.className = 'group';
    group.innerHTML = `<h2>${title}</h2>`;
    const row = document.createElement('div');
    row.className = 'swatches';
    for (const value of LOOK_OPTIONS[key]) {
      const b = document.createElement('button');
      if (String(value).startsWith('#')) { b.className = 'swatch'; b.style.background = value; b.title = value; }
      else { b.className = 'chip'; b.textContent = CHIP_LABELS[value] ?? value; }
      if (look[key] === value) b.classList.add('sel');
      b.onclick = () => { setLook({ ...look, [key]: value }); renderSwatches(); };
      row.append(b);
    }
    group.append(row);
    root.append(group);
  }
}
for (const key of ['height', 'build']) {
  $(key).oninput = (e) => {
    setLook({ ...look, [key]: Number(e.target.value) });
    if (key === 'height') $('height-val').textContent = `${look.height.toFixed(2)} m`;
  };
}

function openEditor() {
  if (!account) return;
  $('name').value = name;
  $('bio').value = bio;
  $('height').value = look.height;
  $('build').value = look.build;
  $('height-val').textContent = `${look.height.toFixed(2)} m`;
  $('btn-enter').textContent = joined ? 'Guardar' : 'Entrar al museo';
  renderSwatches();
  renderAccount();
  openOverlay('editing');
  ctrl.showcase = joined; // vitrina hasta que el personaje se mueva
}

async function saveProfile() {
  name = $('name').value.trim().slice(0, 20) || 'Visitante';
  bio = $('bio').value.trim().slice(0, 280);
  const r = await api('me', { method: 'PUT', body: { name, look, bio } });
  if (r.ok) account = r.user;
}

async function closeEditor() {
  closeOverlays();
  await saveProfile();
  if (!joined) join();
  else net.send({ t: 'look', name, look });
}
$('btn-look').onclick = () => (body.classList.contains('editing') ? closeEditor() : openEditor());
$('btn-enter').onclick = () => closeEditor();
$('name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.stopPropagation(); // que el mismo Enter no abra el chat
  closeEditor();
});

// ---------- Menú (Esc): General · Audio · Controles ----------
const audioPrefs = { voiceEnabled: true, master: 1, voices: 1, media: 1, ...pref.get('audio', {}) };
function syncSettings() {
  $('sens').value = ctrl.sens;
  $('sens-val').textContent = `${ctrl.sens.toFixed(2)}×`;
  $('voice-enabled').checked = audioPrefs.voiceEnabled;
  for (const k of ['master', 'voices', 'media']) {
    $(`vol-${k}`).value = audioPrefs[k];
    $(`vol-${k}-val`).textContent = `${Math.round(audioPrefs[k] * 100)}%`;
  }
}
function applyAudioPrefs() {
  rtc.setVolumes({ master: audioPrefs.master, voices: audioPrefs.voices, media: audioPrefs.media });
  if (rtc.voiceEnabled !== audioPrefs.voiceEnabled) rtc.setVoiceEnabled(audioPrefs.voiceEnabled);
  pref.set('audio', audioPrefs);
}
$('sens').oninput = (e) => { ctrl.sens = Number(e.target.value); pref.set('sens', ctrl.sens); syncSettings(); };
$('voice-enabled').onchange = (e) => { audioPrefs.voiceEnabled = e.target.checked; applyAudioPrefs(); syncSettings(); };
for (const k of ['master', 'voices', 'media']) {
  $(`vol-${k}`).oninput = (e) => { audioPrefs[k] = Number(e.target.value); applyAudioPrefs(); syncSettings(); };
}
function showMenuTab(tab) {
  for (const b of document.querySelectorAll('#menu-tabs .tab')) b.classList.toggle('active', b.dataset.mtab === tab);
  for (const el of document.querySelectorAll('#settings .mtab')) el.hidden = el.dataset.mtab !== tab;
}
for (const b of document.querySelectorAll('#menu-tabs .tab')) b.onclick = () => showMenuTab(b.dataset.mtab);
function openMenu() {
  syncSettings();
  openOverlay('settings');
}
$('btn-settings').onclick = () => (body.classList.contains('settings') ? closeOverlays() : openMenu());
$('btn-settings-close').onclick = closeOverlays;
$('btn-logout-menu').onclick = async () => { await api('logout', { method: 'POST' }); session.token = null; location.reload(); };

// ---------- Red ----------
const room = (new URLSearchParams(location.search).get('sala') || 'museo').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'museo';
$('room-name').textContent = room;
const net = new Net(room);
const remotes = new Map();

// Voz y pantalla compartida (P2P)
const rtc = new RTC(net);
rtc.getRemoteIds = () => [...remotes.keys()];
let screenVideo = null;
rtc.onScreen = () => {}; // la pantalla del hall ya no existe: hay una sola pantalla (la del VJ)
rtc.onMic = (state) => { $('btn-mic').dataset.state = state; };
// La pantalla (toda la pared del escenario): la usa el VJ que la toma en la consola
rtc.onStage = (video) => {
  screenVideo = video;
  world.stage.setVideo(video);
  if (!video && body.classList.contains('viewing')) closeOverlays();
};
// El navegador habilita el audio recién después de un click o una tecla
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => rtc.audio(), { once: true });

rtc.voiceEnabled = audioPrefs.voiceEnabled;
rtc.setVolumes({ master: audioPrefs.master, voices: audioPrefs.voices, media: audioPrefs.media });

// Hablar: mantener apretada la V (o el botón "Hablar")
async function talk(on) {
  if (on && roomPanel.info.silenced) return toast('Estás silenciado en esta sala.');
  if (on && account?.guest) return guestGate('hablar por voz');
  const r = await rtc.talk(on);
  if (!r.ok) toast(r.error);
  me.talking = on && r.ok; // animación de hablar mientras está quieto
}
const micBtn = $('btn-mic');
micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); talk(true); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) micBtn.addEventListener(ev, () => talk(false));

// M: silenciar la música y la pantalla de la sala
function toggleMedia() {
  const mutedNow = rtc.toggleMedia();
  $('btn-media').classList.toggle('on', mutedNow);
  toast(mutedNow ? 'Música y pantalla de la sala en silencio (M para volver a escuchar).' : 'Volviste a escuchar la música y la pantalla de la sala.');
}
$('btn-media').onclick = toggleMedia;

// Panel de la sala (Tab)
// Grupos de voz de la sala (privados): gid -> { leader, members: [userIds] }
const groups = {
  all: {},
  of(userId) { for (const [gid, g] of Object.entries(this.all)) if (g.members.includes(userId)) return gid; return null; },
  mine() { return account ? this.of(account.id) : null; },
};
function applyGroups() {
  const mine = groups.mine();
  for (const r of remotes.values()) {
    const g = groups.of(r.userId);
    r.setGroup(!g ? null : g === mine ? 'mio' : 'otro');
  }
  roomPanel.render();
}

const roomPanel = createRoomPanel({
  net, rtc, remotes, me: () => account, roomTitle: () => roomTitle, groups,
  ui: { openOverlay, closeOverlays, isOpen: (cls) => body.classList.contains(cls) },
  openProfile: (r) => openProfile(r),
});
$('btn-room').onclick = () => (body.classList.contains('roompanel') ? closeOverlays() : roomPanel.open());

// Objetos en el suelo
const ground = new Ground(scene);
function dropItem(it, at) {
  // Por defecto, adelante del personaje; si se arrastró a la escena, donde se soltó
  const p = at ?? ctrl.pos.clone().add(new THREE.Vector3(Math.sin(ctrl.bodyYaw), 0, Math.cos(ctrl.bodyYaw)).multiplyScalar(0.9));
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
  openOverlay('mundi');
  const [fav, mine] = await Promise.all([api('favorites'), account ? api(`roominfo?id=${account.id}`) : null]);
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
  if (account && !account.guest && mine?.ok) {
    const myRoom = `u-${account.id}`;
    const el = add(mine.room.name, ['Tu sala', PRIVACY_LABEL[mine.room.privacy], hearts(mine.room.hearts)].filter(Boolean).join(' · '), myRoom);
    // Ajustes de tu sala: nombre, descripción y quién puede entrar
    const edit = document.createElement('button');
    edit.className = 'act';
    edit.textContent = 'Editar';
    edit.onclick = () => {
      const form = document.createElement('form');
      form.className = 'room-form';
      form.innerHTML = `
        <label class="field">Nombre de la sala<input name="name" maxlength="32" placeholder="Sala de ${account.name.replace(/[<>"]/g, '')}"></label>
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
        if (room === myRoom) { roomTitle = r.room.name; setStatus(); }
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
  const listed = ['museo', account && `u-${account.id}`, ...favorites.map((f) => f.room), ...friends.map((f) => `u-${f.id}`)];
  if (!listed.includes(room)) {
    section('Estás en');
    add(roomTitle, '', room);
  }
}
const toggleMundi = () => (body.classList.contains('mundi') ? closeOverlays() : openMundi());
$('btn-mundi').onclick = toggleMundi;

// ---------- Gestos (R / comandos del chat) ----------
function gesture(name) {
  if (!joined || !EMOTES[name]) return;
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
    b.onclick = () => { closeOverlays(); gesture(id); };
    $('gesture-list').append(b);
  });
}
const toggleGestures = () => (body.classList.contains('gestures') ? closeOverlays() : openOverlay('gestures'));
$('btn-gestures').onclick = toggleGestures;

// Expulsado / baneado
function showKicked(title, text) {
  net.stop();
  $('kicked-title').textContent = title;
  $('kicked-text').textContent = text;
  $('kicked-go').textContent = room === 'museo' ? 'Reintentar' : 'Ir al Museo';
  $('kicked-go').onclick = () => (room === 'museo' ? location.reload() : social.go('museo'));
  openOverlay('kicked');
}

function openScreenView() {
  if (!screenVideo) return;
  const v = document.createElement('video');
  Object.assign(v, { muted: true, playsInline: true, autoplay: true, srcObject: screenVideo.srcObject });
  v.play().catch(() => {});
  $('screen-slot').replaceChildren(v);
  const owner = parts.escenario && remotes.get(parts.escenario.id);
  $('screen-who').textContent = owner ? `Visuales de ${owner.name}` : 'Tus visuales';
  openOverlay('viewing');
}

// Inventario, amigos, salas e intercambios
const social = createSocial({
  net, room, me: () => account,
  ui: { openOverlay, closeOverlays, isOpen: (cls) => body.classList.contains(cls) },
  onEquip: (equip) => { setEquip(equip); net.send({ t: 'look' }); },
  onDrop: (it, at) => dropItem(it, at),
});
$('btn-inv').onclick = () => (body.classList.contains('inventory') ? closeOverlays() : social.openInventory());

// Celular (la red social): inicio = amigos. Mientras está abierto, el personaje lo tiene en la mano.
const phone = createPhone({ social, me: () => account, go: (target) => social.go(target) });
sendPhone = (v) => { if (net.ready) net.send({ t: 'phone', v }); };
async function openPhone() {
  await social.openFriends();
  phone.open();
}
const togglePhone = () => (body.classList.contains('friends') ? closeOverlays() : openPhone());
$('btn-friends').onclick = togglePhone;
for (const b of document.querySelectorAll('[data-close-panel]')) b.onclick = closeOverlays;

// Nombre de la sala (las salas personales usan el nombre que les puso su dueño)
let roomTitle = room === 'museo' ? 'Museo' : room;
const roomOwner = room.startsWith('u-') ? room.slice(2) : null;
if (roomOwner) {
  api(`profile?id=${roomOwner}`).then((r) => { if (r.ok) { roomTitle = r.profile.roomName; setStatus(); } });
}

// Atril de la sala personal: E para leer las notas del dueño y dejar un corazón
let lectern = null;
const notes = createNotes({
  me: () => account,
  ui: { openOverlay, closeOverlays, isOpen: (cls) => body.classList.contains(cls) },
  onHearts: (n) => lectern?.setHearts(n),
});
if (roomOwner) {
  lectern = buildLectern(scene, { x: -24.5, z: -4.2, yaw: Math.atan2(-3, 4.2) });
  world.colliders.push(lectern.collider);
  const item = { object: lectern.group, kind: 'atril', prompt: 'Leer las notas' };
  lectern.group.traverse((o) => { o.userData.interact = item; });
  world.interactables.push(item);
  notes.hearts(roomOwner);
}

// Controles: al entrar (una vez por visita), con /controls o desde el menú
let controlsShown = false;
function openControls() {
  $('controls-list').innerHTML = isTouch
    ? '<dl><dt>Joystick</dt><dd>Moverse (hasta el borde: trotar)</dd><dt>Arrastrar</dt><dd>Mirar</dd><dt>Saltar · Agachar</dt><dd>Botones de la derecha</dd><dt>Usar</dt><dd>Lo que tenés adelante</dd><dt>Chat</dt><dd>Escribir · /ayuda para ver comandos</dd></dl>'
    : document.querySelector('.mtab[data-mtab=controls] dl').outerHTML;
  openOverlay('controls');
}
$('controls-ok').onclick = closeOverlays;

function join() {
  joined = true;
  refreshState();
  if (!controlsShown) { controlsShown = true; setTimeout(openControls, 400); }
  net.connect(() => ({ token: session.token, s: ctrl.state(), afk }));
  social.refreshFriends();
  phone.refreshBadge();
  roomPanel.syncBlocks();
  setInterval(() => { social.refreshFriends(); phone.refreshBadge(); }, 25_000);
}

function setStatus() {
  const on = net.ready;
  $('status-dot').classList.toggle('on', on);
  $('status').innerHTML = on
    ? `<b>${roomTitle}</b> · ${remotes.size + 1} conectado${remotes.size ? 's' : ''}`
    : `<b>${roomTitle}</b>${joined ? ' · conectando…' : ''}`;
}
function addRemote(p) {
  if (p.id === net.id || remotes.has(p.id)) return;
  remotes.set(p.id, new RemotePlayer(scene, p));
}
function removeRemote(id) {
  rtc.playerLeft(id);
  remotes.get(id)?.dispose();
  remotes.delete(id);
}

net
  .on('welcome', (m) => {
    for (const id of [...remotes.keys()]) removeRemote(id);
    if (rtc.djStream || ctrl.booth) endMySet(); // cambié de sala o se reconectó: la cabina (de DJ o de artistas) ya no es mía
    rtc.reset(); // conexión nueva con el servidor de audio (vuelve a publicar mi micrófono si lo tenía)
    groups.all = m.groups ?? {};
    rtc.setScreen(m.screen);
    setDJ(m.dj);
    // Si tenía luces o pantalla y me reconecté o cambié de sala, las suelto de mi lado
    if (myLights) endPart('luces');
    if (rtc.stageStream) endPart('escenario');
    for (const part of Object.keys(parts)) delete parts[part];
    Object.assign(parts, m.parts ?? {});
    world.artists.setLights(m.lights ?? null);
    rtc.setStage(parts.escenario ? { id: parts.escenario.id, streamId: parts.escenario.streamId } : null);
    refreshArtists();
    m.players.forEach(addRemote);
    applyGroups();
    if (rtc.mic) net.send({ t: 'mic', v: rtc.micState });
    roomPanel.setRoom(m.room ?? {});
    if (me.phone) net.send({ t: 'phone', v: true });
    roomPanel.applyMutes();
    ground.clear();
    for (const g of m.ground ?? []) ground.add(g);
    $('messages').innerHTML = '';
    m.chat.filter((c) => !roomPanel.isIgnored(c.userId)).forEach(addMessage);
    system(`Entraste a ${roomTitle}.${m.room?.mod ? ' Sos moderador de esta sala (Tab para ver las herramientas).' : ''}`);
    setStatus();
  })
  .on('settings', ({ settings, by }) => {
    roomPanel.setRoom({ settings });
    const off = Object.entries(settings).filter(([, v]) => !v).map(([k]) => ({ chat: 'chat', voice: 'voz', screen: 'pantalla', dj: 'pasar música', items: 'soltar objetos' }[k]));
    system(`${by} cambió la sala.${off.length ? ` Deshabilitado: ${off.join(', ')}.` : ' Todo habilitado.'}`);
    if (!settings.voice && !roomPanel.info.mod) talk(false);
  })
  .on('silenced', ({ id, v }) => {
    if (id === net.id) {
      roomPanel.setRoom({ silenced: v });
      if (v) { talk(false); toast('Un moderador te silenció en esta sala.'); } else toast('Ya no estás silenciado.');
    }
    const r = remotes.get(id);
    if (r) { r.silenced = v; roomPanel.applyMutes(); }
    roomPanel.render();
  })
  .on('kicked', ({ ban, by }) => showKicked(ban ? 'Te banearon de esta sala' : 'Te sacaron de la sala', `${by} ${ban ? 'te baneó: no vas a poder volver a entrar a esta sala.' : 'te expulsó. Podés volver a entrar más tarde.'}`))
  .on('teleport', ({ x, y, z, by }) => {
    ctrl.stand();
    ctrl.pos.set(x, y, z);
    ctrl.vel.set(0, 0);
    toast(`${by} te movió.`);
  })
  .on('bans', ({ bans }) => roomPanel.setBans(bans))
  .on('notice', ({ text }) => toast(text))
  .on('mic-denied', () => { rtc.talk(false); })
  .on('ground+', (g) => ground.add(g))
  .on('ground-', ({ iid, by, expired }) => {
    const it = ground.remove(iid);
    if (it && expired && it.owner === account?.id) system(`Se perdió tu objeto (${it.name}): nadie lo juntó a tiempo.`);
    else if (it && by && by !== account?.name) system(`${by} juntó ${it.name.toLowerCase()}.`);
  })
  .on('picked', () => { toast('¡Lo juntaste! Está en tu inventario (I).'); if (body.classList.contains('inventory')) social.openInventory(); })
  .on('dropped', ({ equip }) => setEquip(equip))
  .on('join', (p) => { addRemote(p); roomPanel.applyMutes(); applyGroups(); system(`${p.name} entró a la sala.`); setStatus(); })
  .on('leave', ({ id }) => {
    const r = remotes.get(id);
    if (r) system(`${r.name} salió.`);
    removeRemote(id);
    setStatus();
  })
  .on('s', ({ id, s }) => remotes.get(id)?.setState(s))
  .on('afk', ({ id, v }) => remotes.get(id)?.setAfk(v))
  .on('phone', ({ id, v }) => { const r = remotes.get(id); if (r) r.avatar.phone = v; })
  .on('look', ({ id, name: n, look: l, equip }) => { const r = remotes.get(id); if (r) { r.setLook(l, equip); r.setName(n); } })
  .on('mic', ({ id, v }) => remotes.get(id)?.setMic(v))
  .on('emote', ({ id, e }) => remotes.get(id)?.avatar.gesture(e))
  .on('sfu', (m) => rtc.onSfu(m))
  .on('sfu-cut', ({ mids }) => rtc.cut(mids))
  .on('pub', ({ id, kind }) => { const r = remotes.get(id); if (r && kind === 'voice') r.hasVoice = true; })
  .on('groups', ({ groups: g }) => { groups.all = g ?? {}; applyGroups(); })
  .on('group', (m) => {
    if (m.op === 'sent') toast(`Invitaste a ${m.name} a tu grupo de voz.`);
    else if (m.op === 'invite') {
      toast(`${m.name} te invita a su grupo de voz (privado: solo se escuchan entre ustedes).`, { actions: [
        { label: 'Aceptar', yes: true, onClick: () => net.send({ t: 'group', op: 'respond', from: m.from, accept: true }) },
        { label: 'Rechazar', onClick: () => net.send({ t: 'group', op: 'respond', from: m.from, accept: false }) },
      ], time: 60_000 });
    } else if (m.op === 'joined') system(m.me ? '🔒 Entraste al grupo de voz: ahora solo te escucha tu grupo.' : `🔒 ${m.name} entró a tu grupo de voz.`);
    else if (m.op === 'left') system('Saliste del grupo de voz: volvés a escuchar a los que tenés cerca.');
    else if (m.op === 'gone') system(`${m.name} salió de tu grupo de voz.`);
    else if (m.op === 'kicked') system('Te sacaron del grupo de voz.');
  })
  .on('screen', (m) => {
    if (m.busy) return toast(`Ya está compartiendo ${remotes.get(m.id)?.name ?? 'otra persona'}. Esperá a que termine.`);
    if (m.id === net.id) return;
    if (m.on) {
      rtc.setScreen({ id: m.id, streamId: m.streamId });
      system(`🎬 ${remotes.get(m.id)?.name ?? 'Alguien'} está compartiendo su pantalla en la pantalla del hall.`);
    } else rtc.setScreen(null);
    refreshArtists();
  })
  .on('dj', (m) => {
    if (m.busy) { rtc.stopMusic(); return toast(`La cabina está ocupada: está pasando música ${m.name}.`); }
    if (m.denied) { rtc.stopMusic(); return; }
    const mine = m.id === net.id;
    if (m.on) {
      setDJ(m);
      system(`🎧 ${mine ? 'Empezaste' : `${m.name} empezó`} a pasar música en la cabina.`);
      if (mine) {
        rtc.startMusic();
        ctrl.enterBooth(world.dj.spot);
        closeOverlays();
        toast('Estás pasando música. E para terminar tu set.');
      }
    } else if (typeof m.track === 'string') {
      if (rtc.dj) { rtc.dj.track = m.track; world.dj.setBooth(rtc.dj); }
      if (m.track) system(`♪ Ahora suena: ${m.track}${mine ? '' : ` (DJ ${m.name})`}`);
    } else {
      if (mine) endMySet(false);
      setDJ(null);
      system(`🎧 ${mine ? 'Terminaste' : `${m.name} terminó`} su set.`);
    }
  })
  .on('part', (m) => {
    if (m.busy || m.denied) {
      if (m.part === 'escenario') rtc.stopStage();
      if (m.busy) toast(`${PART_NAMES[m.part]} ya la tiene ${m.name}.`);
      return renderArtists();
    }
    const mine = m.id === net.id, who = mine ? 'Vos' : m.name;
    if (m.on) {
      parts[m.part] = { id: m.id, name: m.name, streamId: m.streamId };
      if (m.part === 'luces' && mine) { myLights = defaultLights(); bridge.start(); }
      if (m.part === 'escenario') { if (mine) rtc.startStage(); else rtc.setStage({ id: m.id, streamId: m.streamId }); }
      // Como el DJ: queda fijo en la cabina de VJ y luces hasta soltar el control
      if (mine && !ctrl.booth) { ctrl.enterBooth(world.artists.spots[m.part]); closeOverlays(); toast('Tenés el control. E para soltarlo.'); }
      system(m.part === 'luces' ? `💡 ${who} ${mine ? 'tomaste' : 'tomó'} las luces.` : `🎬 ${who} ${mine ? 'estás pasando' : 'está pasando'} visuales en la pantalla.`);
    } else {
      delete parts[m.part];
      if (m.part === 'luces') world.artists.setLights(null); // vuelven a automático
      if (m.part === 'escenario') rtc.setStage(null);
      if (mine) endPart(m.part);
      system(m.part === 'luces' ? `💡 ${who} ${mine ? 'soltaste' : 'soltó'} las luces (vuelven a automático).` : `🎬 ${who} ${mine ? 'dejaste' : 'dejó'} la pantalla.`);
    }
    refreshArtists();
  })
  .on('luces', ({ s }) => world.artists.setLights(s))
  .on('trade', (m) => social.onTrade(m))
  .on('chat', (m) => {
    if (roomPanel.isIgnored(m.userId)) return; // ignorado: no veo sus mensajes
    addMessage(m);
    remotes.get(m.id)?.say(m.text);
  })
  .on('error', (m) => {
    if (m.code === 'auth') { session.token = null; location.reload(); }
    if (m.code === 'banned') showKicked('Estás baneado de esta sala', 'El dueño de la sala o un admin te baneó.');
    if (m.code === 'private') showKicked('Sala privada', 'El dueño de esta sala eligió que solo entren sus amigos, o nadie más.');
  })
  .on('status', setStatus);

// ---------- AFK: sin tocar nada por 90 s, o con la pestaña oculta ----------
let afk = false;
let lastInput = performance.now();
function setAfk(v) {
  if (afk === v) return;
  afk = v;
  body.classList.toggle('afk', v);
  if (net.ready) net.send({ t: 'afk', v });
}
const activity = () => { lastInput = performance.now(); if (!document.hidden) setAfk(false); };
for (const ev of ['keydown', 'pointerdown', 'mousemove', 'touchstart', 'wheel']) addEventListener(ev, activity, { passive: true });
document.addEventListener('visibilitychange', () => (document.hidden ? setAfk(true) : activity()));
setInterval(() => { if (performance.now() - lastInput > 90_000) setAfk(true); }, 5000);

// ---------- Chat ----------
function pushLine(el) {
  const box = $('messages');
  box.append(el);
  while (box.children.length > 60) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function addMessage({ name: n, text }) {
  const el = document.createElement('div');
  el.className = 'msg';
  const b = document.createElement('b');
  b.textContent = n;
  el.append(b, document.createTextNode(text));
  pushLine(el);
}
function system(text) {
  const el = document.createElement('div');
  el.className = 'msg sys';
  el.textContent = text;
  pushLine(el);
}

const input = $('chat-input');
function openChat() {
  if (!joined) return;
  document.exitPointerLock?.();
  ctrl.typing = true;
  ctrl.keys.clear();
  body.classList.add('typing');
  refreshState();
  input.focus();
}
function closeChat() {
  ctrl.typing = false;
  body.classList.remove('typing');
  input.blur();
  refreshState();
}
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text.startsWith('/')) command(text);
  else if (text) net.send({ t: 'chat', text });
  input.value = '';
  closeChat();
};

// Comandos del chat: /ayuda, /salas, /ir …
function command(text) {
  const [cmd, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim().toLowerCase().replace(/^@/, '');
  const friends = social.friends.friends;
  switch (cmd.toLowerCase()) {
    case 'controls':
    case 'controles':
      openControls();
      break;
    case 'ayuda':
    case 'help':
      system('Comandos: /controls (teclas) · /salas (ver salas) · /ir museo · /ir mi sala · /ir <amigo> (va a donde está, o a su sala)');
      system('Gestos: /saludar · /aplaudir · /festejar · /señalar · también con la R');
      system(`Bailes (siguen hasta que te movés): /bailar (uno al azar) o /bailar 1 a ${DANCES.length}: ${DANCES.map((d, i) => `${i + 1} ${d}`).join(' · ')}`);
      break;
    case 'saludar':
    case 'aplaudir':
    case 'festejar':
    case 'señalar':
    case 'senalar':
      gesture(cmd.toLowerCase().replace('ñ', 'n'));
      break;
    case 'bailar': {
      const n = parseInt(arg, 10);
      gesture(`baile${n >= 1 && n <= DANCES.length ? n : 1 + Math.floor(Math.random() * DANCES.length)}`);
      break;
    }
    case 'salas':
      system(`Salas: Museo · Tu sala${friends.length ? ' · ' + friends.map((f) => `Sala de ${f.name}${f.room ? `  (${social.roomLabel(f.room).toLowerCase()})` : ''}`).join(' · ') : ''}`);
      break;
    case 'ir': {
      if (!arg) return system('Usá: /ir museo · /ir mi sala · /ir <amigo>');
      if (arg === 'museo') return social.go('museo');
      if (arg === 'mi sala' || arg === 'casa') return account && social.go(`u-${account.id}`);
      const f = friends.find((x) => x.name.toLowerCase().startsWith(arg) || x.username?.startsWith(arg));
      if (!f) return system(`No encontré a "${arg}" en tus amigos. Agregalo desde su perfil (E sobre su personaje).`);
      social.go(f.room ?? `u-${f.id}`);
      break;
    }
    default:
      system(`Comando desconocido: /${cmd}. Escribí /ayuda.`);
  }
}
input.addEventListener('blur', () => { if (ctrl.typing) closeChat(); });

// ---------- Interacción (E / click / botón Usar) ----------
const ray = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
const MAX_REACH = 3.4;
let target = null;
let lastTarget = null;

function findTarget() {
  if (!ctrl.enabled || ctrl.paused || ctrl.sitting) return null;
  ray.setFromCamera(CENTER, camera);
  ray.far = (ctrl.mode === 'third' ? ctrl.camDist : 0) + MAX_REACH + 1;
  const objects = [...world.interactables.map((i) => i.object), ...[...remotes.values()].map((r) => r.avatar.root), ...ground.objects(), ...world.blockers];
  const hit = ray.intersectObjects(objects, true).find((h) => h.object.visible && h.object.isMesh);
  if (!hit) return null;
  const item = hit.object.userData.interact;
  if (!item) return null; // una pared tapa lo que hay detrás
  const head = ctrl.pos.clone().setY(ctrl.pos.y + 1.2);
  if (hit.point.distanceTo(head) > MAX_REACH) return null;
  return { ...item, point: hit.point };
}

function interact() {
  // En una cabina: la E abre su panel para terminar (DJ) o soltar el control (VJ / luces)
  if (ctrl.booth) { rtc.djStream ? openDJPanel() : openArtists(); return; }
  if (ctrl.sitting) { ctrl.stand(); return; }
  if (!target) return;
  fpArms.poke();
  const t = target;
  if (t.kind === 'sit') {
    const seat = t.seats.reduce((a, b) => (Math.hypot(b.x - t.point.x, b.z - t.point.z) < Math.hypot(a.x - t.point.x, a.z - t.point.z) ? b : a));
    ctrl.sit(seat);
  } else if (t.kind === 'player') openProfile(t.player);
  else if (t.kind === 'screen') useScreen();
  else if (t.kind === 'atril') notes.open(roomOwner, account?.id === roomOwner);
  else if (t.kind === 'dj') openDJPanel();
  else if (t.kind === 'artists') openArtists();
  else if (t.kind === 'pickup') net.send({ t: 'pickup', iid: t.ground.iid });
  else openInspect(t);
}

// ---------- Cabina del DJ ----------
// Cualquiera puede pasar música si la cabina está libre (sin cola). Queda fijo en la cabina
// hasta que aprieta E y confirma que termina su set.
function setDJ(info) {
  rtc.setDJ(info ? { id: info.id, streamId: info.streamId, name: info.name, track: info.track ?? '' } : null);
  world.dj.setBooth(rtc.dj);
}
async function openDJPanel() {
  if (rtc.dj && rtc.dj.id !== net.id) return toast(`La cabina está ocupada: está pasando música ${rtc.dj.name}.`);
  const live = !!rtc.djStream;
  $('djpanel').dataset.mode = live ? 'live' : 'setup';
  $('dj-cancel').textContent = live ? 'Seguir pasando música' : 'Cancelar';
  $('dj-file').hidden = !window.showOpenFilePicker;
  if (!window.showOpenFilePicker) $('dj-file-name').textContent = 'Leer el track automáticamente funciona en Chrome o Edge.';
  openOverlay('djing');
  if (live) return;
  const sel = $('dj-source');
  sel.innerHTML = '<option value="">Buscando entradas de audio…</option>';
  const inputs = await rtc.audioInputs();
  sel.innerHTML = '';
  for (const d of inputs) sel.append(new Option(d.name, d.id));
  if (navigator.mediaDevices.getDisplayMedia) sel.append(new Option('Audio de la PC (compartir pantalla o pestaña con audio)', 'system'));
  const last = pref.get('djSource', null);
  if ([...sel.options].some((o) => o.value === last)) sel.value = last;
}
$('dj-start').onclick = async () => {
  const source = $('dj-source').value;
  pref.set('djSource', source);
  $('dj-start').disabled = true;
  const r = await rtc.captureMusic(source);
  $('dj-start').disabled = false;
  if (!r.ok) return toast(r.error);
  net.send({ t: 'dj', on: true, streamId: r.streamId }); // la sala confirma (o dice que está ocupada)
};
$('dj-stop').onclick = () => { net.send({ t: 'dj', on: false }); endMySet(); };
rtc.onMusicEnded = () => { if (rtc.djStream) { net.send({ t: 'dj', on: false }); endMySet(); } };
function endMySet(close = true) {
  rtc.stopMusic();
  ctrl.leaveBooth();
  if (close && body.classList.contains('djing')) closeOverlays();
}

// Nombre del track: se lee de un archivo de texto que escribe el programa del DJ (última línea)
let trackFile = null, lastTrack = '';
$('dj-file').onclick = async () => {
  try {
    [trackFile] = await window.showOpenFilePicker({ types: [{ description: 'Texto', accept: { 'text/plain': ['.txt', '.m3u', '.csv', '.log'] } }] });
    $('dj-file-name').textContent = `Leyendo: ${trackFile.name}`;
    lastTrack = '';
    readTrack();
  } catch { /* canceló */ }
};
async function readTrack() {
  if (!trackFile || !rtc.djStream) return;
  try {
    const text = await (await trackFile.getFile()).text();
    const line = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? '';
    const track = line.replace(/^\d{1,2}:\d{2}(:\d{2})?\s*[-:]?\s*/, '').slice(0, 120); // saca la hora del historial
    if (track && track !== lastTrack) { lastTrack = track; net.send({ t: 'dj', track }); }
  } catch { /* el programa lo está escribiendo: se reintenta */ }
}
setInterval(readTrack, 3000);

// ---------- Consola de artistas ----------
// Partes: luces (por OSC, desde el puente en la PC del artista), pantalla del escenario (video)
// y pantalla del hall (la de siempre). Cada una la toma un artista a la vez.
const PART_NAMES = { luces: 'Las luces', escenario: 'La pantalla' };
const parts = {}; // luces / escenario → { id, name, streamId? }
let myLights = null, lightsDirty = false;
const bridge = new Bridge({
  onStatus: (s) => { $('bridge-status').textContent = s === 'conectado' ? 'conectado ✓' : 'buscando el puente en tu PC…'; },
  onMessage: (address, args) => {
    if (!myLights || !applyOsc(myLights, address, args)) return;
    lightsDirty = true;
    world.artists.setLights(myLights);
  },
});
// A la sala se manda a lo sumo ~15 veces por segundo
setInterval(() => {
  if (!lightsDirty || parts.luces?.id !== net.id) return;
  lightsDirty = false;
  net.send({ t: 'luces', s: myLights });
}, 66);
rtc.onStageEnded = () => { if (parts.escenario?.id === net.id) releasePart('escenario'); };

function refreshArtists() {
  world.artists.setSign({ luces: parts.luces?.name, escenario: parts.escenario?.name });
  if (body.classList.contains('artists')) renderArtists();
}
function renderArtists() {
  for (const row of document.querySelectorAll('.part-row')) {
    const part = row.dataset.part;
    const holder = parts[part];
    const mine = holder?.id === net.id;
    row.classList.toggle('mine', mine);
    row.querySelector('span').textContent = !holder ? 'Libre' : mine ? 'La tenés vos' : `La tiene ${holder.name}`;
    const btn = row.querySelector('button');
    btn.textContent = mine ? 'Soltar' : part === 'luces' ? 'Tomar las luces' : 'Pasar video';
    btn.disabled = !!holder && !mine;
    btn.onclick = () => takePart(part);
  }
  $('bridge-status').textContent = parts.luces?.id === net.id ? $('bridge-status').textContent : 'sin usar';
}
function openArtists() {
  renderArtists();
  openOverlay('artists');
}
async function takePart(part) {
  if (parts[part]?.id === net.id) return releasePart(part);
  if (part === 'luces') return net.send({ t: 'part', part, on: true });
  const r = await rtc.captureStage();
  if (!r.ok) return toast(r.error);
  net.send({ t: 'part', part, on: true, streamId: r.streamId }); // la sala confirma (o dice que está ocupada)
}
function releasePart(part) {
  net.send({ t: 'part', part, on: false });
  endPart(part);
}
function endPart(part) {
  if (part === 'luces') { bridge.stop(); myLights = null; lightsDirty = false; }
  if (part === 'escenario') rtc.stopStage();
  // Sale de la cabina cuando ya no tiene ninguna parte (y no es el DJ)
  const holds = Object.entries(parts).some(([p, h]) => p !== part && h.id === net.id);
  if (ctrl.booth && !rtc.djStream && !holds) ctrl.leaveBooth();
}

// La pantalla: E para pasar video (si está libre), dejar de pasarlo, o verla en grande
function useScreen() {
  const holder = parts.escenario;
  if (!holder) return takePart('escenario');
  if (holder.id === net.id) return releasePart('escenario');
  openScreenView();
}
function promptFor(t) {
  if (t.kind === 'player') return `Ver perfil de ${t.player.name}`;
  if (t.kind === 'artists') return 'Consola de artistas';
  if (t.kind === 'dj') return !rtc.dj ? 'Pasar música' : rtc.dj.id === net.id ? 'Terminar tu set' : `Cabina ocupada (DJ ${rtc.dj.name})`;
  if (t.kind === 'screen') return !parts.escenario ? 'Pasar visuales' : parts.escenario.id === net.id ? 'Dejar de pasar visuales' : 'Ver en grande';
  if (t.kind === 'pickup') {
    const g = t.ground;
    return ground.locked(g, account?.id) ? `Disponible en ${Math.ceil((5000 - ground.age(g)) / 1000)} s` : `Juntar ${g.name.toLowerCase()}`;
  }
  return t.prompt;
}

// Click: el primero toma el mouse para mirar; con el mouse tomado, usa lo que apuntás
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement === renderer.domElement) interact();
  else if (ctrl.enabled && !ctrl.paused && !isTouch) renderer.domElement.requestPointerLock?.();
});
$('btn-use').onclick = interact;
$('btn-crouch').onclick = () => { ctrl.crouchToggle = !ctrl.crouchToggle; $('btn-crouch').classList.toggle('on', ctrl.crouchToggle); };
$('btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); ctrl.jump(); }, { passive: false });
$('btn-chat').onclick = () => (ctrl.typing ? closeChat() : openChat());

// Foto rápida desde una cámara (para obras sin imagen y perfiles).
// Se dibuja y se captura dentro del mismo frame, así no se ve ningún parpadeo.
const photoCam = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
function photo(from, lookAt) {
  photoCam.aspect = innerWidth / innerHeight;
  photoCam.updateProjectionMatrix();
  photoCam.position.copy(from);
  photoCam.lookAt(lookAt);
  const wasVisible = me.root.visible;
  me.root.visible = true;
  renderer.render(scene, photoCam);
  me.root.visible = wasVisible;
  const src = renderer.domElement;
  const size = Math.min(src.width, src.height);
  const out = document.createElement('canvas');
  out.width = out.height = 360;
  out.getContext('2d').drawImage(src, (src.width - size) / 2, (src.height - size) / 2, size, size, 0, 0, 360, 360);
  return out.toDataURL('image/jpeg', 0.88);
}

// Ficha de una obra / escultura / cartel informativo
let previewToken = 0;
function openInspect(item) {
  const info = item.info;
  const isPainting = !!item.image;
  $('inspect').classList.toggle('no-frame', !isPainting);
  if (isPainting) $('inspect-img').src = item.image.toDataURL('image/png');
  else {
    const box = new THREE.Box3().setFromObject(item.object);
    const center = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(center).setY(0).normalize();
    $('inspect-img').src = photo(center.clone().addScaledVector(dir, Math.max(1.6, r * 1.6)).add(new THREE.Vector3(0, r * 0.25, 0)), center);
  }
  $('inspect-kicker').textContent = item.kind === 'info' ? 'Info' : isPainting ? 'Obra' : 'Escultura';
  $('inspect-title').textContent = info.title;
  $('inspect-meta').textContent = [info.author, info.year, info.technique].filter(Boolean).join(' · ');
  $('inspect-desc').textContent = info.description ?? '';

  const card = $('inspect-link');
  card.hidden = !info.link;
  if (info.link) {
    const token = ++previewToken;
    card.href = info.link;
    $('link-img').removeAttribute('src');
    $('link-site').textContent = new URL(info.link).hostname.replace(/^www\./, '');
    $('link-title').textContent = 'Cargando vista previa…';
    $('link-desc').textContent = '';
    api(`preview?url=${encodeURIComponent(info.link)}`).then((p) => {
      if (token !== previewToken) return;
      if (!p.ok) { $('link-title').textContent = 'Abrir sitio ↗'; return; }
      $('link-site').textContent = p.site;
      $('link-title').textContent = p.title || 'Abrir sitio ↗';
      $('link-desc').textContent = p.description;
      if (p.image) $('link-img').src = p.image;
    });
  }
  openOverlay('inspecting');
}

// Perfil de otro jugador (como en Second Life)
async function openProfile(player) {
  const root = player.avatar.root;
  const head = root.position.clone().setY(root.position.y + 1.63 * player.avatar.scale);
  const facing = new THREE.Vector3(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
  $('profile-img').src = photo(head.clone().addScaledVector(facing, 1.05).add(new THREE.Vector3(0, 0.04, 0)), head.clone().setY(head.y - 0.06));
  $('profile-name').textContent = player.name;
  $('profile-user').textContent = '';
  $('profile-bio').textContent = '';
  $('profile-since').textContent = '';
  $('profile').classList.toggle('afk', !!player.afk);
  $('profile-actions').hidden = true;
  showProfileTab('about');
  const g = $('profile-gallery');
  g.innerHTML = '';
  openOverlay('profiling');
  if (!player.userId) return;
  const r = await api(`profile?id=${encodeURIComponent(player.userId)}`);
  if (!r.ok) return;
  const p = r.profile;
  $('profile-user').textContent = p.username ? `@${p.username}` : 'Invitado';
  $('profile-bio').textContent = p.bio;
  $('profile-since').textContent = `Miembro desde ${new Date(p.created).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}${p.hearts ? ` · ♥ ${p.hearts} en su sala` : ''}`;
  renderGallery(g, p.id);
  social.profileActions(player, p);
  // Los invitados ven estas opciones con candado; al tocarlas, el aviso para crear cuenta
  lock($('act-group'), account?.guest);
  lock($('act-trade'), account?.guest);
}
function showProfileTab(tab) {
  for (const b of document.querySelectorAll('#profile-tabs .tab')) b.classList.toggle('active', b.dataset.ptab === tab);
  for (const el of document.querySelectorAll('#profile .ptab')) el.hidden = el.dataset.ptab !== tab;
}
for (const b of document.querySelectorAll('#profile-tabs .tab')) b.onclick = () => showProfileTab(b.dataset.ptab);
for (const b of document.querySelectorAll('[data-close]')) b.onclick = closeOverlays;
for (const id of ['inspect', 'profile', 'screenview']) $(id).addEventListener('click', (e) => { if (e.target.id === id) closeOverlays(); });

// ---------- Atajos de teclado ----------
addEventListener('keydown', (e) => {
  const inField = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
  if (e.key === 'Escape') {
    // Esc: cierra lo que esté abierto; si no hay nada, abre el menú
    if (ctrl.typing) closeChat();
    else if (body.classList.contains('kicked') || body.classList.contains('auth')) { /* no se cierra */ }
    else if (body.classList.contains('editing') && joined) closeEditor();
    else if (overlayOpen()) closeOverlays();
    else if (joined) openMenu();
    return;
  }
  // Tab: la lista de jugadores se ve mientras se mantiene apretada
  if (e.code === 'Tab' && joined && !body.classList.contains('auth') && !body.classList.contains('kicked')) {
    e.preventDefault();
    if (!inField && !e.repeat && !body.classList.contains('roompanel')) {
      tabHeld = { relock: document.pointerLockElement === renderer.domElement };
      roomPanel.open();
    }
    return;
  }
  if (inField || body.classList.contains('auth') || body.classList.contains('kicked')) return;
  // V: hablar mientras se mantiene apretada
  if (e.code === 'KeyV') {
    if (!e.repeat && joined) talk(true);
    return;
  }
  const viewing = ['inspecting', 'profiling', 'viewing', 'notes'].some((c) => body.classList.contains(c));
  if (e.code === 'KeyE') {
    e.preventDefault();
    if (viewing) closeOverlays();
    else if (ctrl.enabled && !ctrl.paused) interact();
  } else if (e.code === 'KeyP' && account) {
    e.preventDefault();
    body.classList.contains('editing') ? closeEditor() : openEditor();
  } else if (e.key === 'Enter' && ctrl.enabled && !overlayOpen() && !ctrl.typing) {
    e.preventDefault();
    openChat();
  } else if (!joined || body.classList.contains('trading')) {
    // durante un intercambio, solo Esc
  } else if (e.code === 'KeyM') {
    toggleMedia();
  } else if (e.code === 'KeyI') {
    body.classList.contains('inventory') ? closeOverlays() : social.openInventory();
  } else if (e.code === 'KeyF') {
    togglePhone();
  } else if (e.code === 'KeyY') {
    toggleMundi();
  } else if (e.code === 'KeyR') {
    toggleGestures();
  }
});
let tabHeld = null;
function releaseTab() {
  if (!tabHeld) return;
  const { relock } = tabHeld;
  tabHeld = null;
  if (!body.classList.contains('roompanel')) return; // ya se abrió otra cosa desde la lista (un perfil, etc.)
  closeOverlays();
  // Si estaba jugando con el mouse capturado, lo vuelve a capturar
  if (relock && ctrl.enabled && !ctrl.paused && !isTouch) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
}
addEventListener('keyup', (e) => {
  if (e.code === 'KeyV') talk(false);
  if (e.code === 'Tab') releaseTab();
});
addEventListener('blur', () => { talk(false); releaseTab(); }); // si la ventana pierde el foco con una tecla apretada

// ---------- Bucle principal ----------
const clock = new THREE.Clock();
const staminaEl = $('stamina');
const staminaFill = staminaEl.querySelector('.fill');
let sendTimer = 0, lastSent = '', lastSentAt = 0, frame = 0, voiceTimer = 0;
// Si anda lento: se apaga el post-procesado y se baja la resolución ya mismo (y la próxima vez arranca más abajo)
const fpsWatch = new FpsWatch(quality, () => {
  composer = null;
  renderer.setPixelRatio(1);
  toast('Bajamos la calidad gráfica para que el juego ande más fluido.');
});
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  fpsWatch.tick(dt, ctrl.enabled && !document.hidden);
  const t = clock.elapsedTime;
  ctrl.update(dt);
  for (const r of remotes.values()) r.update(dt);
  world.update(dt, t);
  ground.update(dt, t, account?.id);
  rtc.update(camera, (key) => (key.endsWith(':dj') ? world.dj.speakers : key.endsWith(':screen') ? world.screen.position : remotes.get(key)?.mouth()));
  world.dj.setMusic(rtc.dj ? rtc.musicLevel() : -1);
  // Qué voces escucho (los 4 más cercanos que hablan, o mi grupo): cada medio segundo
  voiceTimer += dt;
  if (voiceTimer >= 0.5 && net.ready) {
    voiceTimer = 0;
    const myGroup = groups.mine();
    rtc.updateVoices([...remotes.values()].map((r) => ({
      id: r.id, pos: r.avatar.root.position, mic: r.mic, hasVoice: r.hasVoice, group: groups.of(r.userId), blocked: rtc.mutedUsers.has(r.id),
    })), ctrl.pos, myGroup);
  }

  // Barra de stamina: aparece solo cuando no está llena
  staminaEl.classList.toggle('show', ctrl.stamina < 0.999 && ctrl.enabled);
  staminaEl.classList.toggle('tired', ctrl.exhausted);
  staminaFill.style.transform = `scaleX(${ctrl.stamina})`;

  // Qué estás apuntando (cada 3 frames alcanza)
  if (++frame % 3 === 0) {
    target = findTarget();
    if (target !== lastTarget) {
      body.classList.toggle('targeting', !!target);
      lastTarget = target;
    }
    if (target) $('prompt-text').textContent = promptFor(target);
    // Quién está hablando
    for (const r of remotes.values()) r.setSpeaking(r.mic === 'on' && rtc.level(r.id) > 0.035);
  }

  // Posición a la sala: 10 veces por segundo si cambió, o cada 2 s igual
  sendTimer += dt;
  if (sendTimer >= 0.1 && net.ready) {
    sendTimer = 0;
    const s = ctrl.state().map((v) => Math.round(v * 100) / 100);
    const key = s.join(',');
    if (key !== lastSent || t - lastSentAt > 2) {
      net.send({ t: 's', s });
      lastSent = key;
      lastSentAt = t;
    }
  }

  if (composer) composer.render(dt);
  else renderer.render(scene, camera);

  // Manos en primera persona, encima de todo
  if (ctrl.enabled && ctrl.mode === 'first') {
    fpArms.update(dt, camera, { speed: ctrl.speed, pose: ctrl.pose, phase: me.phase });
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(fpArms.scene, camera);
    renderer.autoClear = true;
  }
  labels.render(scene, camera);
});

// ---------- Día y noche según la hora de Argentina (GMT-3) ----------
let fixedHour = null; // para pruebas
function hoursGMT3() {
  const d = new Date();
  return ((d.getUTCHours() - 3 + 24) % 24) + d.getUTCMinutes() / 60;
}
world.setTime(hoursGMT3());
setInterval(() => world.setTime(fixedHour ?? hoursGMT3()), 30_000);

// Acceso para pruebas, solo en desarrollo (npm run dev)
if (import.meta.env.DEV) window.__game = { ctrl, me, gesture, openDJPanel, openArtists, parts, world, remotes, interact, camera, fpArms, renderer, rtc, social, net, ground, roomPanel, setHour: (h) => { fixedHour = h; world.setTime(h); }, get target() { return target; } };

// ---------- Inicio: si ya hay sesión guardada, entra directo ----------
// La pantalla de carga se va cuando el personaje y sus animaciones están listos (o a los 20 s, por las dudas)
(async () => {
  loading(60, 'Cargando tu personaje…');
  const t0 = performance.now();
  while (!me.model?.anim && performance.now() - t0 < 20_000) {
    if (me.model) loading(85, 'Cargando animaciones…');
    await new Promise((r) => setTimeout(r, 150));
  }
  loading(100, '¡Listo!');
  setTimeout(() => { $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 600); }, 250);
})();
(async () => {
  setStatus();
  if (await finishOAuth()) return;
  if (session.token) {
    const r = await api('me');
    if (r.ok) { useAccount(r.user); join(); return; }
    if (r.error !== 'No hay conexión con el servidor.') session.token = null;
  }
  showAuth('guest');
})();
