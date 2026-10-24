// Museo y salas personales: el atril de la entrada del Museo (postular y curar obras), las obras del
// público que están expuestas, el atril de notas y corazones de cada sala personal y el editor de
// la sala propia.
import { api, workFileUrl } from '../net/api.js';
import { loadGLTF } from '../loaders.js';
import { createWorks } from '../ui/works.js';
import { createNotes } from '../ui/notes.js';
import { toast } from '../ui/toast.js';
import { buildLectern } from '../world/lectern.js';
import { createRoomEditor } from '../world/editor.js';
import { G } from './state.js';

const { scene, camera, renderer, world, ctrl, net, rtc, room, roomOwner, isTouch } = G;

// Atril de la sala personal: E para leer las notas del dueño y dejar un corazón
let lectern = null;
const notes = createNotes({
  me: () => G.account,
  ui: G.ui,
  onHearts: (n) => lectern?.setHearts(n),
});
const shown = { cuadro: [], escultura: [] }; // id de la obra del público en cada lugar
// Museo: en la entrada, un atril para postular obras al Museo rotativo (y revisar, para curadores)
const works = createWorks({ ui: { openOverlay: G.openOverlay, closeOverlays: G.closeOverlays }, me: () => G.account });
if (room === 'museo') {
  const altar = buildLectern(scene, { x: -24.5, z: -4.2, yaw: Math.atan2(-3, 4.2) });
  world.colliders.push(altar.collider);
  const item = { object: altar.group, kind: 'museo', prompt: 'Exponé tu obra' };
  altar.group.traverse((o) => { o.userData.interact = item; });
  world.interactables.push(item);
  loadMuseum();
  setInterval(loadMuseum, 5 * 60_000);
}

// Obras del público que están expuestas ahora (cada lugar rota por su cuenta cada 24 h)
async function loadMuseum() {
  const r = await api('museum');
  if (!r.ok) return;
  for (const s of r.slots) {
    const slot = (s.kind === 'cuadro' ? world.works.paintings : world.works.sculptures)[s.idx];
    const id = s.work?.id ?? null;
    if (!slot || shown[s.kind][s.idx] === id) continue;
    shown[s.kind][s.idx] = id;
    if (!s.work) { slot.setWork(null); continue; }
    try {
      if (s.kind === 'cuadro') {
        const url = await workFileUrl(id, 'wall');
        const img = new Image();
        img.src = url;
        await img.decode();
        if (shown[s.kind][s.idx] === id) slot.setWork(s.work, img);
      } else {
        const gltf = await loadGLTF(await workFileUrl(id, 'model'));
        if (shown[s.kind][s.idx] === id) slot.setWork(s.work, gltf.scene);
      }
    } catch { shown[s.kind][s.idx] = null; } // se reintenta en la próxima vuelta
  }
}

if (roomOwner) {
  lectern = world.lectern; // el atril es un mueble más del editor de salas (rooms.js)
  notes.hearts(roomOwner);
}
// Editor de la sala propia (solo lo usa el dueño; los demás ven los cambios)
const roomEditor = world.editable ? createRoomEditor({ world, scene, camera, renderer, net, rtc, ctrl, me: () => G.account, ui: { openOverlay: G.openOverlay, closeOverlays: G.closeOverlays }, toast, isTouch }) : null;


Object.assign(G, { notes, works, roomEditor });
