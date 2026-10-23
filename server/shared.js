// Validaciones y catálogos compartidos entre el servidor y el cliente.

// Objetos equipables. slot: dónde se ponen (uno por lugar).
export const ITEMS = {
  cap: { slot: 'head', name: 'Gorra', colors: ['#e63946', '#3a7bd5', '#1d1d22', '#ffd23f', '#2a9d8f', '#f4f4f4'] },
  beanie: { slot: 'head', name: 'Gorro de lana', colors: ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#ff6fb5'] },
  crown: { slot: 'head', name: 'Corona', colors: ['#ffd23f'], rare: true },
  headphones: { slot: 'ears', name: 'Auriculares', colors: ['#1d1d22', '#f4f4f4', '#ff4fd8', '#19d3ff'] },
  sunglasses: { slot: 'face', name: 'Anteojos de sol', colors: ['#1d1d22', '#ff4fd8', '#19d3ff', '#ffd23f'] },
  glasses: { slot: 'face', name: 'Lentes redondos', colors: ['#1d1d22', '#c9a14a', '#8a4be2'] },
  chain: { slot: 'neck', name: 'Cadena', colors: ['#ffd23f', '#d9d9d9'] },
  backpack: { slot: 'back', name: 'Mochila', colors: ['#e63946', '#3a7bd5', '#2a9d8f', '#ffd23f', '#1d1d22'] },
};
// Lo que recibe cada cuenta nueva (se eligen 3 al azar, sin repetir)
export const STARTER_ITEMS = ['cap', 'beanie', 'headphones', 'sunglasses', 'glasses', 'chain', 'backpack'];

// Lista de objetos equipados que se muestra sobre un personaje: [{ type, color }]
export function cleanEquip(list) {
  if (!Array.isArray(list)) return [];
  const used = new Set();
  const out = [];
  for (const it of list.slice(0, 8)) {
    const def = ITEMS[it?.type];
    if (!def || used.has(def.slot) || !def.colors.includes(it.color)) continue;
    used.add(def.slot);
    out.push({ type: it.type, color: it.color });
  }
  return out;
}

// rulos y coleta son del personaje anterior: se siguen aceptando para no perder lo guardado
// Gestos: comandos del chat (/saludar, /bailar 3…) y menú de la R.
// loop = se repite hasta que te movés; dur = duración si no hay animación (hecho por código)
export const EMOTES = {
  saludar: { name: 'Saludar', dur: 2.4 },
  aplaudir: { name: 'Aplaudir', dur: 3 },
  festejar: { name: 'Festejar', dur: 2.9 },
  senalar: { name: 'Señalar', dur: 2.2 },
};
export const DANCES = ['Hip hop de brazos', 'Hip hop', 'Breakdance', 'Baile libre', 'House', 'House 2', 'Shuffle', 'Swing', 'Onda', 'Clásico'];
DANCES.forEach((name, i) => { EMOTES[`baile${i + 1}`] = { name, loop: true, dance: true }; });

export const HAIR_STYLES = ['corto', 'largo', 'rapado', 'rodete', 'rulos', 'coleta'];
export const TOPS = ['remera', 'buzo'];
export const BODIES = ['masc', 'fem'];
const COLOR_KEYS = ['skin', 'hair', 'eyes', 'shirt', 'pants', 'shoes'];

export function cleanName(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return n || 'Visitante';
}

export function cleanLook(look) {
  const out = {};
  if (!look || typeof look !== 'object') return out;
  for (const k of COLOR_KEYS) {
    if (typeof look[k] === 'string' && /^#[0-9a-f]{6}$/i.test(look[k])) out[k] = look[k];
  }
  if (HAIR_STYLES.includes(look.hairStyle)) out.hairStyle = look.hairStyle;
  if (TOPS.includes(look.top)) out.top = look.top;
  if (BODIES.includes(look.body)) out.body = look.body;
  if (typeof look.beard === 'boolean') out.beard = look.beard;
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : undefined);
  const height = num(look.height, 1.55, 1.95);
  const build = num(look.build, 0.85, 1.2);
  if (height !== undefined) out.height = height;
  if (build !== undefined) out.build = build;
  return out;
}

// Alcance para soltar y juntar objetos del piso (m). El servidor deja un margen por el retraso.
export const ITEM_REACH = 3;
