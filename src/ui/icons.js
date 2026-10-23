// Íconos SVG simples (sin imágenes externas).

// Muebles (editor de salas): un sillón
const FURNITURE_PATH = '<path d="M5 10V7a3 3 0 013-3h8a3 3 0 013 3v3a2 2 0 00-2 2v1H7v-1a2 2 0 00-2-2z"/><path d="M3 12a2 2 0 014 0v3h10v-3a2 2 0 014 0v6h-2v2h-2v-2H7v2H5v-2H3z"/>';
const ITEM_PATHS = {
  cap: '<path d="M4 15c0-5 3.6-9 8-9s8 4 8 9z"/><path d="M12 15h9.5c.8 0 .8 2-1 2H12z"/>',
  beanie: '<path d="M5 15c0-5 3-9 7-9s7 4 7 9z"/><rect x="4" y="14" width="16" height="4" rx="2"/><circle cx="12" cy="4.5" r="2"/>',
  crown: '<path d="M3 18l1.5-10 4.5 4 3-6 3 6 4.5-4L21 18z"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0116 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="2.5" y="13" width="5" height="7" rx="2"/><rect x="16.5" y="13" width="5" height="7" rx="2"/>',
  sunglasses: '<path d="M2 9h20v2l-1 4.5a2 2 0 01-2 1.5h-3a2 2 0 01-2-1.6L13.5 12h-3l-.5 3.4A2 2 0 018 17H5a2 2 0 01-2-1.5L2 11z"/>',
  glasses: '<circle cx="7" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="17" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10.5 12.5h3" stroke="currentColor" stroke-width="2"/>',
  chain: '<path d="M5 4c0 7 3 11 7 11s7-4 7-11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="2.5 1.5"/><circle cx="12" cy="18" r="3.4"/>',
  backpack: '<rect x="5" y="6" width="14" height="15" rx="4"/><path d="M9 6V4.5a3 3 0 016 0V6" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="13" width="8" height="4" rx="1.5" fill="rgba(0,0,0,.25)"/>',
};

// Ícono de un objeto con su color
export function itemIcon(type, color) {
  const dark = isLight(color) ? '#1d1500' : '#ffffff';
  return `<span class="ico" style="background:${color};color:${dark}"><svg viewBox="0 0 24 24" fill="${dark}">${ITEM_PATHS[type] ?? FURNITURE_PATH}</svg></span>`;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 150;
}

// Íconos de la barra superior
export const UI_ICONS = {
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>',
  friends: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.4 2 5 4.9"/></svg>',
  music: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  hand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8a8 8 0 0016 0v-3a2 2 0 00-4 0"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};
