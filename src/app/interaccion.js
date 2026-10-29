// Interacción: qué tenés adelante (E / click / botón Usar), el cartel de lo que hace la E, la ficha
// de las obras (con vista previa del link), el perfil de otros jugadores y los atajos de teclado.
import * as THREE from 'three';
import { api, workFileUrl, designFileUrl } from '../net/api.js';
import { parseGLTF } from '../loaders.js';
import { checkGLB } from '../../server/glb.js';
import { guestGate, lock } from '../ui/guest.js';
import { renderGallery } from '../ui/gallery.js';
import { toast } from '../ui/toast.js';
import { G, $, body } from './state.js';

const { ctrl, camera, world, remotes, renderer, scene, me, fpArms, isTouch, net, rtc, ground, social, progress, notes, works, roomOwner, roomEditor, roomPanel, parts } = G;

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
  if (ctrl.booth) { rtc.djStream ? G.openDJPanel() : G.openArtists(); return; }
  if (ctrl.sitting) { ctrl.stand(); return; }
  if (!target) return;
  fpArms.poke();
  const t = target;
  if (t.kind === 'sit') {
    const seat = t.seats.reduce((a, b) => (Math.hypot(b.x - t.point.x, b.z - t.point.z) < Math.hypot(a.x - t.point.x, a.z - t.point.z) ? b : a));
    ctrl.sit(seat);
  } else if (t.kind === 'player') openProfile(t.player);
  else if (t.kind === 'screen') G.useScreen();
  else if (t.kind === 'screen2') roomEditor?.useScreen2(); // segunda pantalla de una sala personal
  else if (t.kind === 'probador') tryModel(t);
  else if (t.kind === 'atril') roomOwner ? notes.open(roomOwner, !!G.account && G.account.id === G.roomOwnerId) : notes.openLatest(); // en los mapas públicos: las últimas notas de todos
  else if (t.kind === 'museo') { if (G.account?.guest) guestGate('postular obras al Museo'); else works.open(); }
  else if (t.kind === 'dj') G.openDJPanel();
  else if (t.kind === 'artists') G.openArtists();
  else if (t.kind === 'pickup') net.send({ t: 'pickup', iid: t.ground.iid });
  // Barra del hall: elegís trago o café y te lo tomás ahí
  else if (t.kind === 'bar') {
    toast('¿Qué te servís?', { actions: [
      { label: 'Trago', yes: true, onClick: () => net.send({ t: 'consume', from: 'bar', kind: 'trago' }) },
      { label: 'Café', yes: true, onClick: () => net.send({ t: 'consume', from: 'bar', kind: 'cafe' }) },
    ] });
  }
  // Barra de tragos, minibar o cafetera de una sala
  else if (t.kind === 'dispense') net.send({ t: 'consume', from: 'piece', piece: t.piece });
  else openInspect(t);
}

function promptFor(t) {
  if (t.kind === 'player') return `Ver perfil de ${t.player.name}`;
  if (t.kind === 'artists') return 'Consola de artistas';
  if (t.kind === 'dj') return !rtc.dj ? 'Pasar música' : rtc.dj.id === net.id ? 'Terminar tu set' : `Cabina ocupada (DJ ${rtc.dj.name})`;
  if (t.kind === 'screen2') return roomEditor?.screen2Prompt();
  if (t.kind === 'screen') return !parts.escenario ? 'Pasar visuales' : parts.escenario.id === net.id ? 'Dejar de pasar visuales' : 'Ver en grande';
  if (t.kind === 'pickup') {
    const g = t.ground;
    return ground.locked(g, G.account?.id) ? `Disponible en ${Math.ceil((5000 - ground.age(g)) / 1000)} s` : `Juntar ${g.name.toLowerCase()}`;
  }
  return t.prompt;
}

// Click: el primero toma el mouse para mirar; con el mouse tomado, usa lo que apuntás
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement === renderer.domElement) interact();
  else if (ctrl.enabled && !ctrl.paused && !isTouch) renderer.domElement.requestPointerLock?.();
});
$('btn-use').onclick = interact;
// En celular el cartel ("Ver obra", "Tomar trago"…) también se toca
$('prompt').addEventListener('click', (e) => { e.stopPropagation(); interact(); });
$('btn-crouch').onclick = () => { ctrl.crouchToggle = !ctrl.crouchToggle; $('btn-crouch').classList.toggle('on', ctrl.crouchToggle); };
$('btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); ctrl.jump(); }, { passive: false });
$('btn-chat').onclick = () => (ctrl.typing ? G.closeChat() : G.openChat());

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
// Probador de modelos (Taller): elegís un .glb de tu PC, pasa el control automático y se ve a tamaño real
// arriba del pedestal. Solo para vos: no se sube a ningún lado
let tried = null;
function tryModel(t) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.glb,model/gltf-binary' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const r = checkGLB(data);
    if (!r.ok) return toast(`No pasa el control: ${r.error}`);
    let gltf;
    try { gltf = await parseGLTF(data); } catch { return toast('No se pudo abrir el modelo. ¿Es un .glb válido?'); }
    tried?.removeFromParent();
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -box.min.y, -c.z);
    tried = new THREE.Group();
    tried.add(obj);
    tried.position.y = 0.92;
    t.object.add(tried);
    const [x, y, z] = r.size.map((v) => `${Math.round(v * 100)} cm`);
    toast(`Pasa el control ✓ ${x} × ${y} de alto × ${z} · ${r.tris.toLocaleString('es-AR')} triángulos. Lo ves solo vos; para tenerlo, Mochila → "Subir diseño".`, { time: 9000 });
  };
  input.click();
}

function openInspect(item) {
  const info = item.info;
  const publicPainting = item.work?.kind === 'cuadro';
  const designPainting = item.design?.kind === 'cuadro';
  const isPainting = !!item.image || publicPainting || designPainting;
  $('inspect').classList.toggle('no-frame', !isPainting);
  if (designPainting) {
    // Cuadro de diseño: en HD si el autor la subió (si no, la de la pared)
    const img = $('inspect-img');
    img.onerror = () => { img.onerror = null; img.src = designFileUrl(item.design.id); };
    img.src = designFileUrl(item.design.id, 'hd');
  } else if (publicPainting) {
    // Obra del público: la imagen en HD (hasta 2048 px)
    $('inspect-img').removeAttribute('src');
    workFileUrl(item.work.id, 'hd').then((url) => { if (url) $('inspect-img').src = url; });
  } else if (isPainting) $('inspect-img').src = item.image.toDataURL('image/png');
  else {
    const box = new THREE.Box3().setFromObject(item.object);
    const center = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(center).setY(0).normalize();
    $('inspect-img').src = photo(center.clone().addScaledVector(dir, Math.max(1.6, r * 1.6)).add(new THREE.Vector3(0, r * 0.25, 0)), center);
  }
  if (item.kind === 'art') progress.viewed(item); // progresión: descubrir obras
  $('inspect-kicker').textContent = item.kind === 'info' ? 'Info' : item.kind === 'design' ? 'Diseño' : isPainting ? 'Obra' : 'Escultura';
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
  G.openOverlay('inspecting');
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
  G.openOverlay('profiling');
  progress.profileBadges(player.userId); // insignias públicas
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
  lock($('act-group'), G.account?.guest);
  lock($('act-trade'), G.account?.guest);
}
function showProfileTab(tab) {
  for (const b of document.querySelectorAll('#profile-tabs .tab')) b.classList.toggle('active', b.dataset.ptab === tab);
  for (const el of document.querySelectorAll('#profile .ptab')) el.hidden = el.dataset.ptab !== tab;
}
for (const b of document.querySelectorAll('#profile-tabs .tab')) b.onclick = () => showProfileTab(b.dataset.ptab);
for (const b of document.querySelectorAll('[data-close]')) b.onclick = G.closeOverlays;
for (const id of ['inspect', 'profile', 'screenview']) $(id).addEventListener('click', (e) => { if (e.target.id === id) G.closeOverlays(); });

// ---------- Atajos de teclado ----------
addEventListener('keydown', (e) => {
  const inField = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
  if (e.key === 'Escape') {
    // Esc: cierra lo que esté abierto; si no hay nada, abre el menú
    if (ctrl.typing) G.closeChat();
    else if (body.classList.contains('kicked') || body.classList.contains('auth')) { /* no se cierra */ }
    else if (body.classList.contains('editing') && G.joined) G.closeEditor();
    else if (G.overlayOpen()) G.closeOverlays();
    else if (G.joined) G.openMenu();
    return;
  }
  // Tab: la lista de jugadores se ve mientras se mantiene apretada
  if (e.code === 'Tab' && G.joined && !body.classList.contains('auth') && !body.classList.contains('kicked')) {
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
    if (!e.repeat && G.joined) G.talk(true);
    return;
  }
  const viewing = ['inspecting', 'profiling', 'viewing', 'notes'].some((c) => body.classList.contains(c));
  if (e.code === 'KeyE') {
    e.preventDefault();
    if (viewing) G.closeOverlays();
    else if (ctrl.enabled && !ctrl.paused) interact();
  } else if (e.code === 'KeyP' && G.account) {
    e.preventDefault();
    body.classList.contains('editing') ? G.closeEditor() : G.openEditor();
  } else if (e.key === 'Enter' && ctrl.enabled && !G.overlayOpen() && !ctrl.typing) {
    e.preventDefault();
    G.openChat();
  } else if (!G.joined || body.classList.contains('trading')) {
    // durante un intercambio, solo Esc
  } else if (e.code === 'KeyM') {
    G.toggleMedia();
  } else if (e.code === 'KeyI') {
    body.classList.contains('inventory') ? G.closeOverlays() : social.openInventory();
  } else if (e.code === 'KeyF') {
    G.togglePhone();
  } else if (e.code === 'KeyY') {
    G.toggleMundi();
  } else if (e.code === 'KeyR') {
    G.toggleGestures();
  }
});
let tabHeld = null;
function releaseTab() {
  if (!tabHeld) return;
  const { relock } = tabHeld;
  tabHeld = null;
  if (!body.classList.contains('roompanel')) return; // ya se abrió otra cosa desde la lista (un perfil, etc.)
  G.closeOverlays();
  // Si estaba jugando con el mouse capturado, lo vuelve a capturar
  if (relock && ctrl.enabled && !ctrl.paused && !isTouch) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
}
addEventListener('keyup', (e) => {
  if (e.code === 'KeyV') G.talk(false);
  if (e.code === 'Tab') releaseTab();
});
addEventListener('blur', () => { G.talk(false); releaseTab(); }); // si la ventana pierde el foco con una tecla apretada


// Qué estás apuntando (el bucle lo llama cada 3 cuadros)
function updateTarget() {
  target = findTarget();
  if (target !== lastTarget) {
    body.classList.toggle('targeting', !!target);
    lastTarget = target;
  }
  if (target) $('prompt-text').textContent = promptFor(target);
}

Object.assign(G, { interact, updateTarget, openProfile, openInspect, getTarget: () => target });
