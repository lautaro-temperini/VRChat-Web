// Escenario: la cabina del DJ (música desde la PC y el nombre del track), la consola de artistas
// (luces por OSC con el puente, video en la pantalla del escenario) y ver la pantalla en grande.
import { toast } from '../ui/toast.js';
import { guestGate } from '../ui/guest.js';
import { Bridge, applyOsc, defaultLights } from '../net/osc.js';
import { G, $, body, pref } from './state.js';

const { world, ctrl, net, rtc, remotes } = G;

// La pantalla (toda la pared del escenario): la usa el VJ que la toma en la consola
let screenVideo = null;
rtc.onStage = (video) => {
  screenVideo = video;
  world.stage.setVideo(video);
  if (!video && body.classList.contains('viewing')) G.closeOverlays();
};

// ---------- Cabina del DJ ----------
// Cualquiera puede pasar música si la cabina está libre (sin cola). Queda fijo en la cabina
// hasta que aprieta E y confirma que termina su set.
function setDJ(info) {
  rtc.setDJ(info ? { id: info.id, streamId: info.streamId, name: info.name, track: info.track ?? '' } : null);
  world.dj.setBooth(rtc.dj);
}
async function openDJPanel() {
  if (rtc.dj && rtc.dj.id !== net.id) return toast(`La cabina está ocupada: está pasando música ${rtc.dj.name}.`);
  if (G.account?.guest) return guestGate('pasar música');
  const live = !!rtc.djStream;
  $('djpanel').dataset.mode = live ? 'live' : 'setup';
  $('dj-cancel').textContent = live ? 'Seguir pasando música' : 'Cancelar';
  $('dj-file').hidden = !window.showOpenFilePicker;
  if (!window.showOpenFilePicker) $('dj-file-name').textContent = 'Leer el track automáticamente funciona en Chrome o Edge.';
  G.openOverlay('djing');
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
  if (close && body.classList.contains('djing')) G.closeOverlays();
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
  if (G.account?.guest) return guestGate('usar la consola de artistas');
  renderArtists();
  G.openOverlay('artists');
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
  if (!holder && G.account?.guest) return guestGate('pasar visuales');
  if (!holder) return takePart('escenario');
  if (holder.id === net.id) return releasePart('escenario');
  openScreenView();
}

// Mensajes de la sala: la cabina (dj) y la consola (part)
function onDJ(m) {
  if (m.busy) { rtc.stopMusic(); return toast(`La cabina está ocupada: está pasando música ${m.name}.`); }
  if (m.denied) { rtc.stopMusic(); return; }
  const mine = m.id === net.id;
  if (m.on) {
    setDJ(m);
    G.system(`🎧 ${mine ? 'Empezaste' : `${m.name} empezó`} a pasar música en la cabina.`);
    if (mine) {
      rtc.startMusic();
      ctrl.enterBooth(world.dj.spot);
      G.closeOverlays();
      toast('Estás pasando música. E para terminar tu set.');
    }
  } else if (typeof m.track === 'string') {
    if (rtc.dj) { rtc.dj.track = m.track; world.dj.setBooth(rtc.dj); }
    if (m.track) G.system(`♪ Ahora suena: ${m.track}${mine ? '' : ` (DJ ${m.name})`}`);
  } else {
    if (mine) endMySet(false);
    setDJ(null);
    G.system(`🎧 ${mine ? 'Terminaste' : `${m.name} terminó`} su set.`);
  }
}
function onPart(m) {
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
    if (mine && !ctrl.booth) { ctrl.enterBooth(world.artists.spots[m.part]); G.closeOverlays(); toast('Tenés el control. E para soltarlo.'); }
    G.system(m.part === 'luces' ? `💡 ${who} ${mine ? 'tomaste' : 'tomó'} las luces.` : `🎬 ${who} ${mine ? 'estás pasando' : 'está pasando'} visuales en la pantalla.`);
  } else {
    delete parts[m.part];
    if (m.part === 'luces') world.artists.setLights(null); // vuelven a automático
    if (m.part === 'escenario') rtc.setStage(null);
    if (mine) endPart(m.part);
    G.system(m.part === 'luces' ? `💡 ${who} ${mine ? 'soltaste' : 'soltó'} las luces (vuelven a automático).` : `🎬 ${who} ${mine ? 'dejaste' : 'dejó'} la pantalla.`);
  }
  refreshArtists();
}


function openScreenView() {
  if (!screenVideo) return;
  const v = document.createElement('video');
  Object.assign(v, { muted: true, playsInline: true, autoplay: true, srcObject: screenVideo.srcObject });
  v.play().catch(() => {});
  $('screen-slot').replaceChildren(v);
  const owner = parts.escenario && remotes.get(parts.escenario.id);
  $('screen-who').textContent = owner ? `Visuales de ${owner.name}` : 'Tus visuales';
  G.openOverlay('viewing');
}


Object.assign(G, {
  parts, setDJ, openDJPanel, endMySet, refreshArtists, openArtists, endPart, useScreen, onDJ, onPart,
  hasMyLights: () => !!myLights,
});
