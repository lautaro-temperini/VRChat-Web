// Calidad gráfica automática: el juego la elige según el dispositivo (no hay selector a mano,
// así nadie elige "alta" en un equipo que no la banca).
//   low    → celulares y equipos flojos: sin sombras ni post-procesado, texturas de 1K
//   medium → gráficos integrados (Intel, AMD "Radeon Graphics"): sin sombras ni post, texturas de 2K
//   high   → placa de video dedicada: sombras, GTAO, bloom y texturas de 2K
// Si en el juego anda lento, la próxima vez arranca un escalón más abajo (ver FpsWatch).

export const LEVELS = ['low', 'medium', 'high'];
const CAP_KEY = 'qualityCap';

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name.toLowerCase();
  } catch {
    return '';
  }
}

function readCap() {
  try { return localStorage.getItem(CAP_KEY); } catch { return null; }
}

export function detectQuality({ isTouch }) {
  // Para probar: ?calidad=low|medium|high (solo en desarrollo)
  const forced = import.meta.env.DEV && new URLSearchParams(location.search).get('calidad');
  if (LEVELS.includes(forced)) return forced;

  const gpu = gpuName();
  const mem = navigator.deviceMemory ?? 8;       // GB (solo Chrome lo informa)
  const cores = navigator.hardwareConcurrency ?? 4;
  let level = 'high';
  if (/intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/.test(gpu) || cores <= 4) level = 'medium';
  if (isTouch || mem <= 4 || /swiftshader|llvmpipe|software|mali|adreno|powervr|apple gpu/.test(gpu)) level = 'low';
  const cap = readCap();
  if (LEVELS.includes(cap) && LEVELS.indexOf(cap) < LEVELS.indexOf(level)) level = cap;
  return level;
}

// Mira los cuadros por segundo mientras se juega. Si anda lento, avisa una vez con onSlow()
// y guarda un escalón menos para la próxima vez que se abra el juego.
export class FpsWatch {
  constructor(level, onSlow) {
    this.level = level;
    this.onSlow = onSlow;
    this.frames = 0;
    this.time = 0;
    this.done = false;
  }
  // active = jugando, con la pestaña visible (si no, el navegador frena los cuadros a propósito)
  tick(dt, active) {
    if (this.done || !active) { this.frames = this.time = 0; return; }
    this.frames++;
    this.time += dt;
    if (this.time < 8) return;
    const fps = this.frames / this.time;
    this.frames = this.time = 0;
    if (fps >= 24) return;
    this.done = true;
    const i = LEVELS.indexOf(this.level);
    if (i > 0) { try { localStorage.setItem(CAP_KEY, LEVELS[i - 1]); } catch { /* sin almacenamiento */ } }
    this.onSlow(fps);
  }
}
