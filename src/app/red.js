// Red: la conexión con la sala, la voz (Cloudflare Realtime, rtc.js), hablar con la V, silenciar la
// música con la M, los grupos de voz y el panel de la sala (Tab).
import { Net } from '../net/net.js';
import { RTC } from '../net/rtc.js';
import { api } from '../net/api.js';
import { PUBLIC_MAPS } from '../../server/shared.js';
import { toast } from '../ui/toast.js';
import { guestGate } from '../ui/guest.js';
import { createRoomPanel } from '../ui/roompanel.js';
import { G, $, body } from './state.js';

const { audioPrefs } = G;
const room = (new URLSearchParams(location.search).get('sala') || 'museo').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'museo';
$('room-name').textContent = room;
const net = new Net(room);
const remotes = new Map();

// Nombre de la sala (las salas personales usan el nombre que les puso su dueño)
G.roomTitle = room === 'museo' ? 'Museo' : PUBLIC_MAPS[room]?.name ?? room;
// Sala personal: su id (el de u-<id>; corazones y notas del atril son de la sala) y, cuando llega, su dueño
const roomOwner = room.startsWith('u-') ? room.slice(2) : null;
G.roomOwnerId = null;
if (roomOwner) {
  api(`roominfo?id=${roomOwner}`).then((r) => { if (r.ok) { G.roomTitle = r.room.name; G.roomOwnerId = r.room.owner; G.setStatus(); } });
}

// Voz y pantalla compartida (P2P)
const rtc = new RTC(net);
rtc.getRemoteIds = () => [...remotes.keys()];
rtc.onScreen = () => {}; // la pantalla del hall ya no existe: hay una sola pantalla (la del VJ)
rtc.onMic = (state) => { $('btn-mic').dataset.state = state; };
// (la pantalla del escenario, rtc.onStage, está en escenario.js)
// El navegador habilita el audio recién después de un click o una tecla
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => rtc.audio(), { once: true });

rtc.voiceEnabled = audioPrefs.voiceEnabled;
rtc.setVolumes({ master: audioPrefs.master, voices: audioPrefs.voices, media: audioPrefs.media });

// Hablar: mantener apretada la V (o el botón "Hablar")
async function talk(on) {
  if (on && roomPanel.info.silenced) return toast('Estás silenciado en esta sala.');
  if (on && G.account?.guest) return guestGate('hablar por voz');
  const r = await rtc.talk(on);
  if (!r.ok) toast(r.error);
  G.me.talking = on && r.ok; // animación de hablar mientras está quieto
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
  mine() { return G.account ? this.of(G.account.id) : null; },
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
  net, rtc, remotes, me: () => G.account, roomTitle: () => G.roomTitle, groups,
  ui: G.ui,
  openProfile: (r) => G.openProfile(r),
});
$('btn-room').onclick = () => (body.classList.contains('roompanel') ? G.closeOverlays() : roomPanel.open());


Object.assign(G, { room, roomOwner, net, remotes, rtc, talk, toggleMedia, groups, applyGroups, roomPanel });
