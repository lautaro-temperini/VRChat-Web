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

// Lista de objetos equipados que se muestra sobre un personaje: [{ type, color }], y los diseños:
// [{ type: 'estampa' | 'disenoObjeto', design }] (estampa en la ropa, objeto 3D en la mano)
export function cleanEquip(list) {
  if (!Array.isArray(list)) return [];
  const used = new Set();
  const out = [];
  for (const it of list.slice(0, 8)) {
    const slot = DESIGN_SLOTS[it?.type];
    if (slot) {
      const design = cleanDesign(it.design);
      if (!design || used.has(slot) || DESIGN_ITEM[design.kind] !== it.type) continue;
      if (slot === 'mano' && !designHoldable(design)) continue;
      used.add(slot);
      out.push({ type: it.type, design });
      continue;
    }
    const def = typeof it?.type === 'string' && Object.hasOwn(ITEMS, it.type) ? ITEMS[it.type] : null;
    if (!def || used.has(def.slot) || !def.colors.includes(it.color)) continue;
    used.add(def.slot);
    out.push({ type: it.type, color: it.color });
  }
  return out;
}

// ---------- Diseños de artistas como objetos (server/designs.js) ----------
// Cualquier cuenta sube estampas (van en la ropa), cuadros y objetos 3D (van a la sala, al piso o
// a la mano si miden hasta 50 cm). Cada diseño es un objeto del inventario (items.design = id).
export const DESIGN_KINDS = { estampa: 'Estampa', cuadro: 'Cuadro', objeto: 'Objeto 3D' };
export const DESIGN_ITEM = { estampa: 'estampa', cuadro: 'disenoCuadro', objeto: 'disenoObjeto' }; // tipo del objeto
const DESIGN_SLOTS = { estampa: 'estampa', disenoObjeto: 'mano' };
export const STAMP_PLACES = { pecho: 'Pecho', espalda: 'Espalda' };
export const STAMP_SIZES = { chico: 0.12, mediano: 0.25, grande: 0.38 }; // ancho en metros
export const HAND_MAX = 0.5; // m: lo más grande que se puede sostener en la mano
export const DESIGN_IMAGE = 1024; // px: estampas y cuadros (los cuadros también en HD hasta 2048)
// Tamaño en metros: cuadros de 1,2 m del lado más largo; objetos 3D con sus medidas reales
export function cuadroSize(d) { const a = (d?.w || 1) / (d?.h || 1); return a >= 1 ? [1.2, 1.2 / a] : [1.2 * a, 1.2]; }
// [ancho, profundidad] de un mueble puesto (los de diseño, según el diseño)
export function pieceSize(p) {
  const d = p?.design;
  if (d?.kind === 'objeto' && d.dims) return [d.dims[0], d.dims[2]];
  if (d?.kind === 'cuadro') return [cuadroSize(d)[0], 0.1];
  return FURNITURE[p?.type]?.size ?? [1, 1];
}
export const designHoldable = (d) => d?.kind === 'objeto' && Array.isArray(d.dims) && Math.max(...d.dims) <= HAND_MAX;
// Lo público de un diseño (lo que viaja con el objeto); null si no es válido
export function cleanDesign(d) {
  if (!d || typeof d !== 'object' || !/^[0-9a-f]{16}$/.test(String(d.id)) || !Object.hasOwn(DESIGN_KINDS, d.kind)) return null;
  const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const out = { id: d.id, kind: d.kind, title: String(d.title ?? '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 60) };
  if (d.kind === 'objeto') {
    if (!Array.isArray(d.dims) || d.dims.length !== 3) return null;
    out.dims = d.dims.map((v) => Math.round(n(v, 0.01, 3) * 1000) / 1000);
  } else {
    out.w = Math.round(n(d.w, 1, 4096));
    out.h = Math.round(n(d.h, 1, 4096));
  }
  if (d.kind === 'estampa') {
    out.place = Object.hasOwn(STAMP_PLACES, d.place) ? d.place : 'pecho';
    out.size = Object.hasOwn(STAMP_SIZES, d.size) ? d.size : 'mediano';
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

// Peinados (modelos de MakeHuman: pack del sistema + Hair 01). Todos se ofrecen en el avanzado.
export const HAIR_STYLES = ['corto', 'flequillo', 'largo', 'rapado', 'rulos', 'coleta', 'trenza', 'bob', 'despeinado', 'melena', 'revuelto', 'carre', 'rulitos', 'lacio', 'prolijo', 'jopo', 'trenzadoble', 'francesa', 'rodetetrenzado', 'francesadespeinada', 'haciaatras', 'bobdesfilado', 'largodesmechado', 'rodete', 'vincha', 'salvaje', 'bobrecto', 'bobrectoflequillo', 'bobadentro', 'bobadentroflequillo', 'bobinvertido', 'bobinvertidoflequillo'];
// Barba: un interruptor sí/no y, si está en sí, el tipo
export const BEARD_STYLES = ['completa', 'tupida', 'candado', 'bigote'];
// Ropa con volumen (modelos de MakeHuman). "buzo" es del editor viejo: se ve como manga larga.
export const TOPS = ['remera', 'mangalarga', 'camisa', 'campera', 'buzo'];
export const BOTTOMS = ['jean', 'short', 'calza', 'pollera'];
export const FEET = ['zapatillas', 'botas', 'zapatos'];
export const BODIES = ['masc', 'fem'];
// Tipos de cuerpo del editor básico: cada uno es un punto de los deslizadores del avanzado
// (peso 0..1 y músculo 0..1; promedio = 0,5 / 0,5). Se combinan como en MakeHuman:
// mucho peso + poco músculo = gordo; mucho peso + mucho músculo = grande (decisión del 24/10).
export const BODY_TYPES = {
  flaco: { name: 'Flaco', weight: 0, muscle: 0 },
  promedio: { name: 'Promedio', weight: 0.5, muscle: 0.5 },
  gordo: { name: 'Gordo', weight: 1, muscle: 0 },
  musculoso: { name: 'Musculoso', weight: 0.75, muscle: 1 },
};
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
  if (BOTTOMS.includes(look.bottom)) out.bottom = look.bottom;
  if (FEET.includes(look.feet)) out.feet = look.feet;
  if (BODIES.includes(look.body)) out.body = look.body;
  if (typeof look.beard === 'boolean') out.beard = look.beard;
  if (BEARD_STYLES.includes(look.beardStyle)) out.beardStyle = look.beardStyle;
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : undefined);
  const height = num(look.height, 1.55, 1.95);
  // build (contextura) es del editor viejo: se sigue aceptando pero el personaje ya no lo usa
  const build = num(look.build, 0.85, 1.2);
  const weight = num(look.weight, 0, 1), muscle = num(look.muscle, 0, 1);
  if (height !== undefined) out.height = height;
  if (build !== undefined) out.build = build;
  if (weight !== undefined) out.weight = weight;
  if (muscle !== undefined) out.muscle = muscle;
  return out;
}

// ¿Los bytes son de verdad una imagen del tipo que dice? (JPG, PNG o WebP). Lo usa el servidor
// con lo que se sube (fotos y obras)
export function isImage(mime, data) {
  const b = new Uint8Array(data, 0, Math.min(12, data.byteLength));
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/webp') return String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP';
  return false;
}

// Alcance para soltar y juntar objetos del piso (m). El servidor deja un margen por el retraso.
export const ITEM_REACH = 3;

// ---------- Progresión (server/progress.js) ----------
// Rareza de los objetos: separa lo básico de lo especial. Las recompensas de niveles y misiones
// se eligen al azar dentro de una rareza, de esta lista. PROVISORIO: hoy hay solo indumentaria;
// cuando se junte el editor de salas se suman acá los muebles (su id + rareza).
export const RARITIES = {
  basico: { name: 'Básico', color: '#a7adb5' },
  raro: { name: 'Raro', color: '#4f8cff' },
  exotico: { name: 'Exótico', color: '#ffc93c' },
};
export const ITEM_RARITY = {
  cap: 'basico', beanie: 'basico', headphones: 'basico', sunglasses: 'basico', glasses: 'basico', backpack: 'basico',
  chain: 'raro',
  crown: 'exotico',
  // Muebles especiales (rareza provisoria del 24/10, para probar los porcentajes)
  esculturaNeon: 'basico', espejos: 'raro', sillonNeon: 'raro', trono: 'exotico',
  barraTragos: 'raro', minibar: 'raro', cafetera: 'raro',
  // Consumibles (también salen como premio)
  trago: 'basico', cafe: 'basico',
};
// Consumibles: se toman y durante BOOST_TIME la stamina no se gasta (no se puede tomar otro mientras dura)
export const CONSUMABLES = {
  trago: { name: 'Trago', color: '#ff7a3d' },
  cafe: { name: 'Café', color: '#6b4226' },
};
export const BOOST_TIME = 120_000;
// Beso: hay que estar a menos de esta distancia (la sala deja un margen por el atraso de las posiciones)
export const KISS_RANGE = 1.5;
export const rarityOf = (type) => ITEM_RARITY[type] ?? 'basico';

// ---------- Editor de salas ----------
// Plantillas de las salas personales (u-<id>). Medidas en metros, centradas en 0,0:
// x de -w/2 a w/2, z de -d/2 a d/2. La entrada está al sur (z = d/2), mirando al norte.
export const ROOM_TEMPLATES = {
  loft: { name: 'Loft', w: 12, d: 10, h: 4.2 },
  galeria: { name: 'Galería', w: 12, d: 10, h: 4.5 },
  club: { name: 'Club', w: 12, d: 10, h: 5 },
  terraza: { name: 'Terraza', w: 12, d: 10, h: 0 }, // al aire libre: sin techo
  // Plantillas de los mapas públicos (public: no se ofrecen para las salas personales)
  plaza: { name: 'Plaza', w: 50, d: 50, h: 0, public: true },
  cafeteria: { name: 'Cafetería', w: 14, d: 10, h: 3.8, public: true },
};

// ---------- Mapas públicos (abiertos a todos, en el Mapa junto al Museo) ----------
// Salas sin dueño con una plantilla y muebles fijos (nadie los edita): [tipo, x, z, rotación (grados), y]
export const PUBLIC_MAPS = {
  plaza: {
    name: 'Plaza', where: 'En la Plaza', desc: 'Para pasear y charlar: fuente, bancos y esculturas', template: 'plaza',
    spawn: { x: 0, z: 22 }, // entrando por el portón (al sur)
    // Bancos alrededor de la fuente, mirándola
    pieces: [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return ['bancoPlaza', Math.round(Math.sin(a) * 7 * 100) / 100, Math.round(Math.cos(a) * 7 * 100) / 100, deg + 180];
    }),
  },
  cafeteria: {
    name: 'Cafetería', where: 'En la Cafetería', desc: 'Café de barrio: pedí un café y sentate a charlar', template: 'cafeteria',
    spawn: { x: 0, z: 3.8 },
    pieces: [
      ['barraCafe', 1.8, -4.3, 0],
      ['atril', -5.9, 3.7, 50],
      // Mesas de dos (una silla de cada lado, mirando la mesa) y una de cuatro
      ...[[-4.6, -2.6], [-1.4, -2.6], [-4.6, 0.4], [-1.4, 0.4], [2.6, 1.6], [5.4, 1.6]].flatMap(([x, z]) => [
        ['mesaCafe', x, z, 0], ['sillaCafe', x - 0.62, z, 90], ['sillaCafe', x + 0.62, z, -90],
      ]),
      ['mesaCafe', 4, -1.4, 0], ['sillaCafe', 3.38, -1.4, 90], ['sillaCafe', 4.62, -1.4, -90], ['sillaCafe', 4, -2.02, 0], ['sillaCafe', 4, -0.78, 180],
    ],
  },
};
// Salas que existen: el Museo, los mapas públicos y las personales (u-<id de cuenta>)
export const isRoomName = (name) => name === 'museo' || Object.hasOwn(PUBLIC_MAPS, name) || /^u-[0-9a-f]{16}$/.test(name);
export const ROOM_MAX_PIECES = 100;

// Catálogo de muebles. Se referencian por id (la progresión los da como premio por id).
// cat: living · comedor · arte · deco · equipo · especial
// mount: floor (en el piso) · wall (colgado de una pared: cuadros, pantallas, carteles)
// special: sale del inventario (y vuelve al levantarlo); los demás son libres para todos
// max: cuántos puede haber por sala; color: el de fábrica (el dueño lo cambia con RGB libre)
// size: [ancho, profundidad] aproximado, para que no quede afuera de la sala
export const FURNITURE = {
  sofa: { name: 'Sillón de 3', cat: 'living', mount: 'floor', color: '#2f3a48', size: [2.4, 0.95] },
  sillon: { name: 'Sillón individual', cat: 'living', mount: 'floor', color: '#7a4a3a', size: [1, 0.95] },
  puf: { name: 'Puf', cat: 'living', mount: 'floor', color: '#c9a14a', size: [0.7, 0.7] },
  mesaRatona: { name: 'Mesa ratona', cat: 'living', mount: 'floor', color: '#4a2c1b', size: [1.2, 0.7] },
  alfombra: { name: 'Alfombra', cat: 'living', mount: 'floor', color: '#8a3b3b', size: [3, 2] },
  mesa: { name: 'Mesa', cat: 'comedor', mount: 'floor', color: '#5a3a24', size: [1.6, 0.9] },
  silla: { name: 'Silla', cat: 'comedor', mount: 'floor', color: '#1d1d22', size: [0.5, 0.5] },
  banqueta: { name: 'Banqueta alta', cat: 'comedor', mount: 'floor', color: '#8a1c1c', size: [0.45, 0.45] },
  barra: { name: 'Barra chica', cat: 'comedor', mount: 'floor', color: '#4a2c1b', size: [2.4, 0.7] },
  // Muebles especiales que reparten consumibles a los visitantes (gives: qué dan; se toma en el momento)
  barraTragos: { name: 'Barra de tragos', cat: 'especial', mount: 'floor', color: '#2b2b33', size: [2, 0.7], special: true, gives: 'trago' },
  minibar: { name: 'Minibar', cat: 'especial', mount: 'floor', color: '#c9c9cf', size: [0.6, 0.6], special: true, gives: 'trago' },
  cafetera: { name: 'Cafetera', cat: 'especial', mount: 'floor', color: '#1d1d22', size: [0.6, 0.5], special: true, gives: 'cafe' },
  cuadro: { name: 'Cuadro', cat: 'arte', mount: 'wall', color: '#141414', size: [1.2, 0.1] },
  pedestal: { name: 'Pedestal', cat: 'arte', mount: 'floor', color: '#f2f0ec', size: [0.6, 0.6] },
  atril: { name: 'Atril', cat: 'arte', mount: 'floor', color: '#4a2c1b', size: [0.7, 0.7], max: 1 },
  neon: { name: 'Cartel de neón', cat: 'arte', mount: 'wall', color: '#ff4fd8', size: [1.2, 0.1] },
  planta: { name: 'Planta', cat: 'deco', mount: 'floor', color: '#3f7a3a', size: [0.6, 0.6] },
  lampara: { name: 'Lámpara de pie', cat: 'deco', mount: 'floor', color: '#f2e6c9', size: [0.5, 0.5] },
  estante: { name: 'Estante', cat: 'deco', mount: 'floor', color: '#4a2c1b', size: [1.2, 0.4] },
  cama: { name: 'Cama', cat: 'deco', mount: 'floor', color: '#d9d2c5', size: [1.6, 2.1] },
  panel: { name: 'Panel', cat: 'deco', mount: 'floor', color: '#e9e3d6', size: [1.4, 0.1] },
  cabina: { name: 'Cabina de DJ', cat: 'equipo', mount: 'floor', color: '#1b1b20', size: [2, 0.9], max: 1 },
  consola: { name: 'Consola de artistas', cat: 'equipo', mount: 'floor', color: '#1b1b20', size: [1.4, 0.8], max: 1 },
  parlante: { name: 'Parlante', cat: 'equipo', mount: 'floor', color: '#151518', size: [0.7, 0.6] },
  pantalla: { name: 'Pantalla', cat: 'equipo', mount: 'wall', color: '#0b0b0d', size: [4, 0.1], max: 2 },
  trono: { name: 'Trono dorado', cat: 'especial', mount: 'floor', color: '#d4a74a', size: [1, 0.9], special: true },
  espejos: { name: 'Bola de espejos', cat: 'especial', mount: 'floor', color: '#d9d9d9', size: [0.6, 0.6], special: true },
  sillonNeon: { name: 'Sillón de terciopelo con neón', cat: 'especial', mount: 'floor', color: '#5b1a6e', size: [2.2, 0.95], special: true },
  esculturaNeon: { name: 'Escultura de neón', cat: 'especial', mount: 'floor', color: '#19d3ff', size: [0.8, 0.8], special: true },
  // Diseños de artistas (design: lo pone el servidor al colocarlo, desde el objeto del inventario)
  disenoCuadro: { name: 'Cuadro de diseño', cat: 'especial', mount: 'wall', color: '#141414', size: [1.2, 0.1], special: true, design: true },
  disenoObjeto: { name: 'Objeto 3D', cat: 'especial', mount: 'floor', color: '#ffffff', size: [1, 1], special: true, design: true },
  // De los mapas públicos (hidden: no salen en el catálogo del editor)
  bancoPlaza: { name: 'Banco de plaza', cat: 'living', mount: 'floor', color: '#6b4a2b', size: [1.8, 0.65], hidden: true },
  mesaCafe: { name: 'Mesa de café', cat: 'comedor', mount: 'floor', color: '#ece8e1', size: [0.75, 0.75], hidden: true },
  sillaCafe: { name: 'Silla de café', cat: 'comedor', mount: 'floor', color: '#3b2416', size: [0.45, 0.45], hidden: true },
  barraCafe: { name: 'Barra del café', cat: 'comedor', mount: 'floor', color: '#3b2416', size: [4.4, 0.7], hidden: true, gives: 'cafe' },
};
export const FURNITURE_CATS = { living: 'Living', comedor: 'Comedor y bar', arte: 'Arte', deco: 'Deco y luz', equipo: 'Música y pantallas', especial: 'Especiales' };
export const SPECIAL_FURNITURE = Object.keys(FURNITURE).filter((k) => FURNITURE[k].special && !FURNITURE[k].design);
// Pantallas: tamaño (ancho en metros) y qué muestran: su propio VJ o lo mismo que la otra pantalla
export const SCREEN_WIDTH = [1, 8];
export const SCREEN_MODES = ['propia', 'espejo'];

// Lo que trae cada plantilla al elegirla: [tipo, x, z, rotación (grados), y (solo los de pared)]
export const TEMPLATE_PIECES = {
  loft: [['alfombra', -1.5, -1, 0], ['sofa', -1.5, 0.2, 180], ['mesaRatona', -1.5, -1.2, 0], ['sillon', -3.6, -1.2, 90], ['lampara', 0.4, 0.4, 0],
    ['planta', -5.3, -4.3, 0], ['cama', 3.8, -3.6, 0], ['estante', 1.5, -4.75, 0], ['mesa', 3.2, 1.6, 0], ['silla', 3.2, 2.3, 180], ['silla', 3.2, 0.9, 0],
    ['atril', 4.6, 3.6, -40], ['cuadro', -1.5, -5, 0, 1.7]],
  galeria: [['pedestal', -2, -1, 0], ['pedestal', 2, -1, 0], ['pedestal', 0, 1.5, 0], ['cuadro', -3.5, -5, 0, 1.6], ['cuadro', 0, -5, 0, 1.6], ['cuadro', 3.5, -5, 0, 1.6],
    ['cuadro', -6, -1.5, 90, 1.6], ['cuadro', 6, -1.5, -90, 1.6], ['panel', 0, -2.8, 0], ['banqueta', -4.5, 3.6, 0], ['planta', 5.3, 4.3, 0], ['atril', -4.8, 3.4, 40]],
  club: [['cabina', 0, -3.6, 0], ['parlante', -2.4, -4.3, 0], ['parlante', 2.4, -4.3, 0], ['pantalla', 0, -5, 0, 2.9], ['consola', 4.6, 2.6, -90],
    ['sofa', -5.4, 0.5, 90], ['sofa', 5.4, -1.5, -90], ['barra', -4, 4.3, 180], ['banqueta', -4.8, 3.6, 0], ['banqueta', -3.2, 3.6, 0], ['atril', 4.8, 4.2, -30]],
  terraza: [['alfombra', 0, 0.3, 0], ['sofa', 0, 1.6, 180], ['mesaRatona', 0, 0.4, 0], ['puf', -1, -0.6, 0], ['puf', 1, -0.6, 0], ['planta', -5.3, -4.3, 0],
    ['planta', 5.3, -4.3, 0], ['planta', -5.3, 1, 0], ['lampara', 2.6, -1.8, 0], ['mesa', 3.6, 2.4, 0], ['silla', 3.6, 3.1, 180], ['silla', 3.6, 1.7, 0], ['atril', -4.6, 3.6, 40]],
};

// Valida un mueble que manda el cliente. Devuelve el mueble limpio o null.
// { id, type, x, y, z, r (radianes), c (color), iid? (especial), photo? (cuadro), w? y m? (pantalla) }
export function cleanPiece(p, template) {
  const own = (obj, k) => typeof k === 'string' && Object.hasOwn(obj, k);
  const def = own(FURNITURE, p?.type) ? FURNITURE[p.type] : null;
  const t = own(ROOM_TEMPLATES, template) ? ROOM_TEMPLATES[template] : null;
  if (!def || !t) return null;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const out = { id: String(p.id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 12), type: p.type };
  if (!out.id) return null;
  const hx = t.w / 2, hz = t.d / 2;
  out.x = Math.round(Math.min(hx, Math.max(-hx, num(p.x))) * 1000) / 1000;
  out.z = Math.round(Math.min(hz, Math.max(-hz, num(p.z))) * 1000) / 1000;
  out.y = def.mount === 'wall' ? Math.round(Math.min(Math.max(t.h, 4) - 0.3, Math.max(0.3, num(p.y, 1.6))) * 1000) / 1000 : 0;
  out.r = Math.round((((num(p.r) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 10000) / 10000;
  out.c = typeof p.c === 'string' && /^#[0-9a-f]{6}$/i.test(p.c) ? p.c.toLowerCase() : def.color;
  if (def.special) out.iid = String(p.iid ?? '').slice(0, 32);
  if (p.type === 'cuadro' && p.photo) out.photo = String(p.photo).slice(0, 40);
  if (def.design) { out.design = cleanDesign(p.design); if (!out.design) return null; }
  if (p.type === 'pantalla') {
    out.w = Math.round(Math.min(SCREEN_WIDTH[1], Math.max(SCREEN_WIDTH[0], num(p.w, 3.6))) * 100) / 100;
    out.m = SCREEN_MODES.includes(p.m) ? p.m : 'espejo';
  }
  return out;
}
