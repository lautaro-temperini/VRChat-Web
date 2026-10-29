// Escribe assets-src/makehuman/catalogo.json desde server/avatarCatalog.js (lo lee build.py en Blender).
// Uso: node scripts/catalogo.mjs
import { writeFileSync } from 'node:fs';
import * as C from '../server/avatarCatalog.js';

const out = {
  garments: C.MH_GARMENTS, accessories: C.MH_ACCESSORIES, skins: C.MH_SKINS, face: C.MH_FACE, morphs: C.MH_MORPHS, brows: C.MH_BROWS,
};
writeFileSync(new URL('../assets-src/makehuman/catalogo.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log('catalogo.json:', Object.keys(C.MH_GARMENTS).length, 'prendas,', Object.keys(C.MH_ACCESSORIES).length, 'accesorios,',
  Object.keys(C.MH_SKINS).length, 'pieles,', Object.keys(C.MH_MORPHS).length, 'formas de animal');
