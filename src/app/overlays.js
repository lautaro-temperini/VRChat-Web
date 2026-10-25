// Estado de la interfaz: un solo panel/superposición abierto a la vez. Mientras hay uno, el
// jugador no se mueve (salvo los paneles que no frenan).
import { G, body } from './state.js';

const OVERLAYS = ['editing', 'settings', 'inspecting', 'profiling', 'auth', 'inventory', 'friends', 'trading', 'viewing', 'roompanel', 'mundi', 'gestures', 'djing', 'artists', 'controls', 'kicked', 'notes', 'works', 'roomedit', 'designing'];
// Paneles que no frenan al personaje (se puede seguir caminando con WASD)
const NON_BLOCKING = ['inventory', 'friends', 'roompanel', 'editing', 'gestures', 'artists'];
function openOverlay(cls) {
  document.exitPointerLock?.();
  for (const c of OVERLAYS) body.classList.toggle(c, c === cls);
  refreshState();
}
function closeOverlays() {
  if (body.classList.contains('trading') && G.social.trading) G.social.cancelTrade();
  for (const c of OVERLAYS) body.classList.remove(c);
  refreshState();
}
const overlayOpen = () => OVERLAYS.some((c) => body.classList.contains(c));
G.sendPhone = null; // se define cuando existe la conexión con la sala
function refreshState() {
  const { ctrl, me } = G;
  // Antes de entrar, el editor muestra el personaje en vitrina; ya adentro se puede caminar con el editor abierto
  ctrl.enabled = G.joined && !body.classList.contains('auth');
  if (!body.classList.contains('editing')) ctrl.showcase = false;
  ctrl.paused = OVERLAYS.some((c) => body.classList.contains(c) && !NON_BLOCKING.includes(c)) || ctrl.typing;
  body.classList.toggle('playing', ctrl.enabled && !ctrl.paused);
  // Celular abierto = el personaje lo tiene en la mano (y los demás lo ven)
  const phoneOut = body.classList.contains('friends');
  if (phoneOut !== me.phone) {
    me.phone = phoneOut;
    G.sendPhone?.(phoneOut);
  }
}

// Lo que reciben los paneles de src/ui (createSocial, createNotes…)
const ui = { openOverlay, closeOverlays, isOpen: (cls) => body.classList.contains(cls) };

Object.assign(G, { openOverlay, closeOverlays, overlayOpen, refreshState, ui });
