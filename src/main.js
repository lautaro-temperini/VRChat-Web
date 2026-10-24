// Punto de entrada del cliente. Cada parte está en src/app/ y corre al importarse, en este orden
// (cada una usa lo de las anteriores; lo compartido vive en G, ver src/app/state.js).
import './style.css';
import './app/escena.js';      // render, mundo (Museo o sala personal) y jugador local
import './app/overlays.js';    // un panel abierto a la vez
import './app/cuenta.js';      // ingreso (invitado, mail, Google/Discord) y editor de personaje
import './app/menu.js';        // menú de Esc: sensibilidad y audio
import './app/red.js';         // conexión con la sala, voz, grupos y panel de la sala (Tab)
import './app/social.js';      // suelo, Mapa, gestos, inventario, celular y progresión
import './app/museo.js';       // atril del Museo, obras expuestas, atril de notas y editor de sala
import './app/sala.js';        // entrar a la sala y los mensajes que llegan
import './app/chat.js';        // chat y comandos
import './app/escenario.js';   // cabina del DJ, consola de artistas y pantalla
import './app/interaccion.js'; // E, fichas de obras, perfiles y atajos de teclado
import './app/loop.js';        // bucle principal, día y noche, window.__game
import { api, session } from './net/api.js';
import { G, $, loading } from './app/state.js';

// ---------- Inicio: si ya hay sesión guardada, entra directo ----------
// La pantalla de carga se va cuando el personaje y sus animaciones están listos (o a los 20 s, por las dudas)
(async () => {
  loading(60, 'Cargando tu personaje…');
  const t0 = performance.now();
  while (!G.me.model?.anim && performance.now() - t0 < 20_000) {
    if (G.me.model) loading(85, 'Cargando animaciones…');
    await new Promise((r) => setTimeout(r, 150));
  }
  loading(100, '¡Listo!');
  setTimeout(() => { $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 600); }, 250);
})();
(async () => {
  G.setStatus();
  if (await G.finishOAuth()) return;
  if (session.token) {
    const r = await api('me');
    if (r.ok) { G.useAccount(r.user); G.join(); return; }
    if (r.error !== 'No hay conexión con el servidor.') session.token = null;
  }
  G.showAuth('guest');
})();
