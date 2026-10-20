// Luces por OSC: el puente (scripts/puente-osc.js) corre en la PC del artista, recibe OSC de
// TouchDesigner, Ableton/Max, Blender, etc. y se lo pasa a esta pestaña por http://127.0.0.1:9001.
// Acá se arma el estado de las luces; main.js lo manda a la sala unas 15 veces por segundo.
//
// Direcciones (valores de 0 a 1; los colores también aceptan 0..255):
//   /luces/color r g b            color de todas las luces
//   /luces/intensidad v           brillo general (0..2)
//   /luces/flash v                destello (0 = nada, 1 = máximo)
//   /luces/focos/color r g b      los 4 focos       /luces/focos/N/color r g b   el foco N (1..4)
//   /luces/focos/intensidad v                       /luces/focos/N/intensidad v
//   /luces/focos/mover pan tilt   (-1..1)           /luces/focos/N/mover pan tilt
//   /luces/escenario/color r g b  luz del escenario /luces/escenario/intensidad v
//   /luces/leds/color r g b       tiras de LED

export const BRIDGE = 'http://127.0.0.1:9001';

export function defaultLights() {
  return {
    color: null, intensidad: 1, flash: 0,
    escenario: { color: null, intensidad: 1 },
    leds: { color: null },
    focos: [0, 1, 2, 3].map(() => ({ color: null, intensidad: 1, pan: 0, tilt: 0 })),
  };
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
function rgb(args) {
  const c = args.slice(0, 3).map((v) => num(v, 1));
  if (c.length < 3) return null;
  const k = c.some((v) => v > 1) ? 255 : 1;
  return c.map((v) => Math.min(1, Math.max(0, v / k)));
}

// Aplica un mensaje OSC al estado. Devuelve true si cambió algo.
export function applyOsc(state, address, args) {
  const p = address.toLowerCase().split('/').filter(Boolean);
  if (p[0] !== 'luces') return false;
  const [, what, a, b] = p;
  const focos = (sel) => (sel ? [state.focos[Number(sel) - 1]].filter(Boolean) : state.focos);
  switch (what) {
    case 'color': state.color = rgb(args); return true;
    case 'intensidad': state.intensidad = num(args[0], 1); return true;
    case 'flash': state.flash = num(args[0]); return true;
    case 'escenario':
      if (a === 'color') state.escenario.color = rgb(args);
      else if (a === 'intensidad') state.escenario.intensidad = num(args[0], 1);
      else return false;
      return true;
    case 'leds':
      if (a !== 'color') return false;
      state.leds.color = rgb(args);
      return true;
    case 'focos': {
      // /luces/focos/color … o /luces/focos/2/color …
      const sel = /^\d$/.test(a) ? a : null;
      const prop = sel ? b : a;
      for (const f of focos(sel)) {
        if (prop === 'color') f.color = rgb(args);
        else if (prop === 'intensidad') f.intensidad = num(args[0], 1);
        else if (prop === 'mover') { f.pan = num(args[0]); f.tilt = num(args[1]); }
        else return false;
      }
      return true;
    }
    default: return false;
  }
}

// Conexión con el puente local. onStatus('conectado' | 'buscando'), onMessage(address, args)
export class Bridge {
  constructor({ onStatus, onMessage }) {
    this.onStatus = onStatus;
    this.onMessage = onMessage;
    this.es = null;
  }
  start() {
    if (this.es) return;
    this.onStatus('buscando');
    this.es = new EventSource(`${BRIDGE}/eventos`);
    this.es.onopen = () => this.onStatus('conectado');
    this.es.onerror = () => this.onStatus('buscando'); // EventSource reintenta solo
    this.es.onmessage = (e) => {
      try {
        const { address, args } = JSON.parse(e.data);
        if (typeof address === 'string' && Array.isArray(args)) this.onMessage(address, args);
      } catch { /* mensaje roto */ }
    };
  }
  stop() {
    this.es?.close();
    this.es = null;
  }
}
