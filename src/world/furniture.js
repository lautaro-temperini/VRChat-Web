import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildLectern } from './lectern.js';
import { loadGLTF } from '../loaders.js';
import { fitDesignModel } from './designModel.js';
import { designFileUrl } from '../net/api.js';
import { cuadroSize } from '../../server/shared.js';

// Muebles del editor de salas, hechos por código (después se pueden reemplazar por modelos
// sin tocar las salas guardadas: lo guardado es solo el id del catálogo, posición, giro y color).
//
// buildFurniture(pieza, { high, h }) → {
//   group,  origen en el piso (o en la pared, para los colgados), mirando a +z
//   boxes:  choques en coordenadas locales [{ x, z, w, d, top, bottom?, climb?, noStand? }]
//   seats:  asientos locales [{ x, y, z, yaw }] (y = altura del piso del asiento, como en el Museo)
//   interact: { kind, prompt } o null
//   parts:  piezas que la sala anima o cambia (pantalla, cartel de la cabina, conos, luz…)
// }

const GLOW = 5; // neón: color por encima de 1 para que brille con el bloom (umbral alto)
const SEAT = 0.47; // la cadera queda tanto más arriba que la "y" del asiento

const shared = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a74a, roughness: 0.25, metalness: 1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.5, metalness: 0.2 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4a2c1b, roughness: 0.45 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.85 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 1 }),
  cone: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.7 }),
};
for (const m of Object.values(shared)) m.userData.shared = true; // no se liberan al sacar un mueble
export const neonMat = (hex) => { const m = new THREE.MeshBasicMaterial({ toneMapped: false }); m.color.set(hex).multiplyScalar(GLOW); return m; };

// Versión chiquita (para cuando un mueble especial queda en el suelo)
export function miniFurniture(type, color, size = 0.55, extra = {}) {
  const { group } = buildFurniture({ type, c: color, w: 2, ...extra }, { h: 2.2 });
  const labels = [];
  group.traverse((o) => { if (o.isCSS2DObject) labels.push(o); });
  for (const l of labels) l.removeFromParent();
  const box = new THREE.Box3().setFromObject(group);
  const dim = box.getSize(new THREE.Vector3());
  group.scale.setScalar(size / Math.max(dim.x, dim.y, dim.z, 0.01));
  return group;
}

export function buildFurniture(piece, env = {}) {
  const high = !!env.high;
  const g = new THREE.Group();
  const boxes = [];
  const seats = [];
  const parts = {};
  let interact = null;
  const color = new THREE.Color(piece.c);
  const mat = (opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
  const tint = (k, opts = {}) => new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(k), roughness: 0.6, ...opts });

  function add(geo, m, x, y, z, parent = g) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = high;
    mesh.receiveShadow = high;
    parent.add(mesh);
    return mesh;
  }
  const rbox = (w, h, d, m, x, y, z, r = 0.04) => add(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), m, x, y, z);
  const cbox = (w, h, d, m, x, y, z) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z);
  const cyl = (rt, rb, h, m, x, y, z, seg = 24) => add(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
  const collide = (w, d, top, extra = {}) => boxes.push({ x: 0, z: 0, w, d, top, climb: true, ...extra });
  const sit = (x, z, seatTop, yaw = 0) => seats.push({ x, y: Math.max(0, seatTop - SEAT), z, yaw });
  const seatsAction = () => { interact = { kind: 'sit', prompt: 'Sentarse' }; };

  // Sillón (también el especial con neón): base, almohadón, respaldo y apoyabrazos
  function sofa(width, fabric, base = shared.dark) {
    rbox(width, 0.3, 0.95, base, 0, 0.17, 0);
    rbox(width - 0.3, 0.16, 0.8, fabric, 0, 0.4, 0.06, 0.06);
    rbox(width, 0.55, 0.22, fabric, 0, 0.6, -0.38, 0.06);
    for (const s of [-1, 1]) rbox(0.2, 0.42, 0.95, fabric, s * (width / 2 - 0.1), 0.45, 0, 0.06);
    collide(width, 0.95, 0.48);
    const n = Math.max(1, Math.round((width - 0.4) / 0.7));
    for (let i = 0; i < n; i++) sit((i - (n - 1) / 2) * 0.7, -0.05, 0.48); // contra el respaldo
    seatsAction();
  }

  switch (piece.type) {
    case 'sofa': sofa(2.4, mat({ roughness: 0.95 })); break;
    case 'sillon': sofa(1, mat({ roughness: 0.95 })); break;
    case 'puf': {
      const p = add(new THREE.SphereGeometry(0.36, 28, 16), mat({ roughness: 1 }), 0, 0.24, 0);
      p.scale.set(1, 0.62, 1);
      collide(0.7, 0.7, 0.44);
      sit(0, 0, 0.44);
      seatsAction();
      break;
    }
    case 'mesaRatona': {
      rbox(1.2, 0.06, 0.7, mat({ roughness: 0.35 }), 0, 0.4, 0, 0.02);
      for (const [x, z] of [[-0.52, -0.27], [0.52, -0.27], [-0.52, 0.27], [0.52, 0.27]]) cyl(0.025, 0.025, 0.37, shared.steel, x, 0.185, z, 10);
      collide(1.2, 0.7, 0.43);
      break;
    }
    case 'alfombra': {
      const rug = add(new THREE.PlaneGeometry(3, 2), mat({ roughness: 1, side: THREE.DoubleSide }), 0, 0.012, 0);
      rug.rotation.x = -Math.PI / 2;
      rug.castShadow = false;
      const border = add(new THREE.RingGeometry(0.98, 1, 4, 1, Math.PI / 4), tint(0.55, { roughness: 1 }), 0, 0.014, 0);
      border.rotation.x = -Math.PI / 2;
      border.scale.set(1.5 * Math.SQRT2 * 0.98, Math.SQRT2 * 0.98, 1);
      border.castShadow = false;
      parts.flat = true;
      break;
    }
    case 'mesa': {
      rbox(1.6, 0.06, 0.9, mat({ roughness: 0.4 }), 0, 0.74, 0, 0.02);
      for (const [x, z] of [[-0.72, -0.37], [0.72, -0.37], [-0.72, 0.37], [0.72, 0.37]]) cbox(0.06, 0.71, 0.06, tint(0.8), x, 0.355, z);
      collide(1.6, 0.9, 0.77);
      break;
    }
    case 'silla': {
      rbox(0.46, 0.05, 0.44, mat(), 0, 0.45, 0, 0.02);
      rbox(0.46, 0.5, 0.04, mat(), 0, 0.72, -0.21, 0.02);
      for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) cyl(0.018, 0.018, 0.45, shared.steel, x, 0.225, z, 8);
      collide(0.46, 0.44, 0.47);
      sit(0, 0.04, 0.47);
      seatsAction();
      break;
    }
    case 'probador': {
      // Probador de modelos (Taller): pedestal con aro de luz; E y elegís un .glb de tu PC (lo ves solo vos)
      cyl(0.5, 0.55, 0.9, mat({ roughness: 0.6 }), 0, 0.45, 0, 40);
      const ringLight = add(new THREE.TorusGeometry(0.52, 0.02, 8, 48), neonMat(0x19d3ff), 0, 0.91, 0);
      ringLight.rotation.x = Math.PI / 2;
      ringLight.castShadow = false;
      collide(1, 1, 0.9, { climb: false, noStand: true });
      parts.top = 0.9;
      interact = { kind: 'probador', prompt: 'Probar un modelo 3D' };
      break;
    }
    case 'mesaCafe': {
      // Mesa redonda de mármol con pie de hierro (Cafetería)
      cyl(0.36, 0.36, 0.03, mat({ roughness: 0.25 }), 0, 0.75, 0, 40);
      cyl(0.035, 0.035, 0.72, shared.dark, 0, 0.37, 0, 12);
      cyl(0.22, 0.26, 0.04, shared.dark, 0, 0.02, 0, 24);
      collide(0.7, 0.7, 0.77);
      break;
    }
    case 'sillaCafe': {
      // Silla de madera curvada (estilo Thonet): asiento redondo, aro de respaldo y patas
      const wood = mat({ roughness: 0.55 });
      cyl(0.2, 0.2, 0.04, wood, 0, 0.46, 0.02, 28);
      for (const [x, z] of [[-0.15, 0.15], [0.15, 0.15], [-0.14, -0.13], [0.14, -0.13]]) cyl(0.015, 0.012, 0.46, wood, x, 0.23, z + 0.02, 8);
      const hoop = add(new THREE.TorusGeometry(0.17, 0.014, 8, 24, Math.PI), wood, 0, 0.72, -0.16);
      hoop.rotation.z = 0;
      for (const x of [-0.17, 0.17]) cyl(0.014, 0.014, 0.28, wood, x, 0.58, -0.16, 8);
      collide(0.42, 0.42, 0.47);
      sit(0, 0.02, 0.47);
      seatsAction();
      break;
    }
    case 'barraCafe': {
      // Barra del café: madera oscura con tapa de mármol, máquina de espresso y tazas; E y te tomás un café
      rbox(4.4, 1.05, 0.65, mat({ roughness: 0.45 }), 0, 0.525, 0, 0.03);
      rbox(4.6, 0.05, 0.8, new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.25 }), 0, 1.075, -0.02, 0.015);
      cbox(4.4, 0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.8 }), 0, 0.12, 0.34);
      const chrome = new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.15, metalness: 1 });
      rbox(0.7, 0.45, 0.4, chrome, -1.2, 1.33, -0.1, 0.04);
      rbox(0.72, 0.06, 0.42, new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.4 }), -1.2, 1.58, -0.1, 0.02);
      for (const x of [-1.38, -1.02]) cyl(0.03, 0.03, 0.1, shared.dark, x, 1.08 + 0.12, 0.12, 10);
      const porcelain = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.35 });
      for (let i = 0; i < 5; i++) cyl(0.04, 0.035, 0.06, porcelain, 0.2 + i * 0.13, 1.13, -0.15, 12);
      cyl(0.2, 0.2, 0.25, new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.2, transparent: true, opacity: 0.55 }), 1.3, 1.23, -0.1, 20); // campana de las medialunas
      collide(4.4, 0.65, 1.1, { climb: false, noStand: true });
      interact = { kind: 'dispense', gives: 'cafe', prompt: 'Pedir un café' };
      break;
    }
    case 'bancoPlaza': {
      // Banco de plaza: tablas de madera sobre patas de hierro, con respaldo inclinado (mapas públicos)
      const wood = mat({ roughness: 0.75 });
      for (let i = 0; i < 4; i++) cbox(1.8, 0.035, 0.1, wood, 0, 0.45, -0.2 + i * 0.13);
      for (let i = 0; i < 3; i++) {
        const slat = cbox(1.8, 0.1, 0.03, wood, 0, 0.62 + i * 0.13, -0.3 - i * 0.03);
        slat.rotation.x = -0.15;
      }
      for (const x of [-0.75, 0.75]) {
        cbox(0.05, 0.45, 0.05, shared.dark, x, 0.225, 0.18);
        cbox(0.05, 0.9, 0.05, shared.dark, x, 0.45, -0.28).rotation.x = -0.12;
        cbox(0.05, 0.05, 0.55, shared.dark, x, 0.43, -0.04);
      }
      collide(1.8, 0.6, 0.47);
      for (const x of [-0.55, 0, 0.55]) sit(x, -0.02, 0.47);
      seatsAction();
      break;
    }
    case 'banqueta': {
      cyl(0.03, 0.04, 0.7, shared.steel, 0, 0.36, 0, 16);
      cyl(0.2, 0.22, 0.03, shared.steel, 0, 0.015, 0, 32);
      const ring = add(new THREE.TorusGeometry(0.16, 0.012, 8, 32), shared.steel, 0, 0.3, 0);
      ring.rotation.x = Math.PI / 2;
      cyl(0.2, 0.18, 0.07, mat({ roughness: 0.5 }), 0, 0.74, 0, 32);
      collide(0.4, 0.4, 0.78);
      seats.push({ x: 0, y: 0.3, z: 0, yaw: 0 }); // como las banquetas del Museo
      seatsAction();
      break;
    }
    case 'barra': {
      rbox(2.4, 1.05, 0.7, mat({ roughness: 0.45 }), 0, 0.525, 0, 0.03);
      rbox(2.6, 0.06, 0.9, new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.15, metalness: 0.3 }), 0, 1.08, -0.05, 0.02);
      cbox(2.4, 0.04, 0.04, neonMat(0xff9a3d), 0, 0.12, 0.36).castShadow = false;
      collide(2.4, 0.7, 1.1, { climb: false });
      parts.block = true;
      break;
    }
    case 'cuadro': {
      // Colgado de la pared: el origen está sobre la pared, a la altura del centro del cuadro
      const fw = 1.2, fh = 0.9;
      rbox(fw, fh, 0.05, mat({ roughness: 0.35 }), 0, 0, 0.025, 0.015);
      const canvas = add(new THREE.PlaneGeometry(fw - 0.12, fh - 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 0, 0, 0.052);
      canvas.castShadow = false;
      parts.canvas = canvas;
      parts.frame = { w: fw, h: fh };
      break;
    }
    case 'pedestal': {
      rbox(0.55, 1, 0.55, mat({ roughness: 0.85 }), 0, 0.5, 0, 0.02);
      collide(0.55, 0.55, 1, { climb: false, noStand: true });
      break;
    }
    case 'atril': {
      // El mismo atril de las salas personales: E para leer las notas y dejar un corazón
      const l = buildLectern(g, { x: 0, z: 0, yaw: 0 });
      l.group.traverse((o) => { if (o.isMesh && o.material?.color && o.material.metalness < 0.5 && o.material.roughness < 0.5) o.material = mat({ roughness: 0.45 }); });
      const c = l.collider;
      boxes.push({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, w: c.maxX - c.minX, d: c.maxZ - c.minZ, top: c.top, climb: false, noStand: true });
      parts.lectern = l;
      interact = { kind: 'atril', prompt: 'Leer las notas' };
      break;
    }
    case 'neon': {
      // Corazón de neón sobre una placa oscura
      rbox(1.2, 1, 0.04, shared.dark, 0, 0, 0.02, 0.02);
      const shape = [];
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        shape.push(new THREE.Vector3(16 * Math.sin(t) ** 3 * 0.024, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.024 + 0.04, 0.07));
      }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shape, true), 96, 0.018, 8, true), neonMat(piece.c), 0, 0, 0).castShadow = false;
      break;
    }
    case 'planta': {
      cyl(0.24, 0.18, 0.45, new THREE.MeshStandardMaterial({ color: 0xd9cfc0, roughness: 0.8 }), 0, 0.225, 0, 24);
      cyl(0.22, 0.22, 0.02, shared.soil, 0, 0.44, 0, 24);
      const leaf = mat({ roughness: 0.8, side: THREE.DoubleSide });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, tall = 0.55 + (i % 3) * 0.25;
        const l = add(new THREE.SphereGeometry(0.16, 10, 8), leaf, Math.cos(a) * 0.14, 0.45 + tall, Math.sin(a) * 0.14);
        l.scale.set(0.55, 1.6, 0.22);
        l.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
      }
      collide(0.5, 0.5, 0.45, { climb: false });
      break;
    }
    case 'lampara': {
      cyl(0.18, 0.2, 0.03, shared.steel, 0, 0.015, 0, 28);
      cyl(0.015, 0.015, 1.5, shared.steel, 0, 0.77, 0, 10);
      const shade = add(new THREE.CylinderGeometry(0.16, 0.24, 0.32, 28, 1, true), new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.6 }), 0, 1.58, 0);
      shade.castShadow = false;
      add(new THREE.SphereGeometry(0.05, 12, 8), neonMat(0xfff1d6), 0, 1.52, 0).castShadow = false;
      parts.light = { y: 1.5, color: 0xffe2b8 };
      collide(0.4, 0.4, 1.7, { climb: false });
      break;
    }
    case 'estante': {
      const w = 1.2, h = 1.8, d = 0.35, m = mat({ roughness: 0.5 });
      for (const s of [-1, 1]) cbox(0.04, h, d, m, s * (w / 2 - 0.02), h / 2, 0);
      for (let i = 0; i < 5; i++) cbox(w, 0.03, d, m, 0, 0.02 + i * 0.44, 0);
      cbox(w, h, 0.02, tint(0.7), 0, h / 2, -d / 2 + 0.01);
      // Libros de colores: un solo material con el color en los vértices (así se juntan en una malla)
      const rand = (n) => (Math.sin(n * 12.9898) * 43758.5453) % 1;
      const bookMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
      const col = new THREE.Color();
      for (let s = 0; s < 4; s++) {
        let x = -w / 2 + 0.06;
        for (let i = 0; x < w / 2 - 0.12 && i < 14; i++) {
          const bw = 0.04 + Math.abs(rand(s * 20 + i)) * 0.04, bh = 0.24 + Math.abs(rand(s * 31 + i)) * 0.12;
          if (Math.abs(rand(s * 7 + i)) > 0.82) { x += 0.12; continue; }
          const book = cbox(bw, bh, 0.24, bookMat, x + bw / 2, 0.035 + s * 0.44 + bh / 2, 0.02);
          col.setHSL(Math.abs(rand(i * 3 + s)), 0.45, 0.4);
          const n = book.geometry.attributes.position.count;
          book.geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [col.r, col.g, col.b]).flat(), 3));
          x += bw + 0.008;
        }
      }
      collide(w, d, h, { climb: false });
      parts.block = true;
      break;
    }
    case 'cama': {
      const frame = tint(0.5, { roughness: 0.5 });
      rbox(1.6, 0.3, 2.1, frame, 0, 0.15, 0, 0.03);
      rbox(1.5, 0.22, 2, new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95 }), 0, 0.41, 0, 0.08);
      rbox(1.52, 0.08, 1.3, mat({ roughness: 1 }), 0, 0.55, 0.36, 0.04);
      for (const s of [-1, 1]) rbox(0.62, 0.14, 0.38, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), s * 0.38, 0.58, -0.75, 0.07);
      rbox(1.7, 1.05, 0.08, frame, 0, 0.53, -1.07, 0.03);
      collide(1.6, 2.1, 0.55);
      for (const z of [-0.3, 0.4]) { sit(0.62, z, 0.55, Math.PI / 2); sit(-0.62, z, 0.55, -Math.PI / 2); }
      seatsAction();
      break;
    }
    case 'panel': {
      rbox(1.4, 2.2, 0.08, mat({ roughness: 0.9 }), 0, 1.15, 0, 0.02);
      for (const s of [-1, 1]) cbox(0.3, 0.04, 0.4, shared.steel, s * 0.5, 0.02, 0);
      collide(1.4, 0.12, 2.25, { climb: false });
      parts.block = true;
      break;
    }
    case 'cabina': {
      // Cabina de DJ: el DJ se para atrás (z negativo), mirando a +z
      rbox(2, 1.05, 0.9, mat({ roughness: 0.55, metalness: 0.2 }), 0, 0.525, 0, 0.03);
      cbox(2.02, 0.04, 0.04, neonMat(0x19d3ff), 0, 0.98, 0.46).castShadow = false;
      for (const s of [-1, 1]) {
        cbox(0.5, 0.04, 0.4, shared.dark, s * 0.55, 1.07, -0.1);
        const plate = cyl(0.17, 0.17, 0.02, shared.steel, s * 0.55, 1.1, -0.1, 32);
        parts[s < 0 ? 'deckA' : 'deckB'] = plate;
      }
      cbox(0.4, 0.05, 0.3, shared.dark, 0, 1.08, -0.1);
      // Cartel con el nombre del DJ y el track (lo llena la sala)
      const sign = add(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }), 0, 0.6, 0.46);
      sign.visible = false;
      sign.castShadow = false;
      parts.sign = sign;
      collide(2, 0.9, 1.1, { climb: false, noStand: true });
      parts.spot = { x: 0, y: 0, z: -0.85, yaw: 0, exit: { x: 1.4, z: 0.9 } };
      interact = { kind: 'dj' };
      break;
    }
    case 'consola': {
      // Consola de artistas: luces (OSC) y pantalla; los artistas se paran atrás, mirando a +z
      rbox(1.4, 0.95, 0.8, mat({ roughness: 0.55, metalness: 0.2 }), 0, 0.475, 0, 0.03);
      const desk = cbox(1.3, 0.04, 0.6, shared.dark, 0, 0.97, -0.05);
      desk.rotation.x = 0.18;
      for (let i = 0; i < 8; i++) cbox(0.05, 0.02, 0.2, neonMat(new THREE.Color().setHSL(i / 8, 1, 0.5)), -0.45 + i * 0.13, 1, -0.05).castShadow = false;
      const sign = add(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }), 0, 1.4, 0.36);
      sign.castShadow = false;
      parts.artistSign = sign;
      collide(1.4, 0.8, 1, { climb: false, noStand: true });
      parts.spots = {
        luces: { x: -0.35, y: 0, z: -0.8, yaw: 0, exit: { x: -0.35, z: 1.2 } },
        escenario: { x: 0.35, y: 0, z: -0.8, yaw: 0, exit: { x: 0.35, z: 1.2 } },
      };
      interact = { kind: 'artists' };
      break;
    }
    case 'parlante': {
      rbox(0.7, 1.6, 0.6, mat({ roughness: 0.8 }), 0, 0.8, 0, 0.03);
      const cones = [];
      for (const [y, r] of [[1.25, 0.15], [0.62, 0.26]]) {
        const ringM = add(new THREE.TorusGeometry(r, 0.025, 8, 32), shared.steel, 0, y, 0.305);
        ringM.castShadow = false;
        const c = add(new THREE.CircleGeometry(r, 32), shared.cone, 0, y, 0.302);
        c.castShadow = false;
        cones.push(c);
      }
      parts.cones = cones;
      parts.speaker = new THREE.Vector3(0, 1, 0.3);
      collide(0.7, 0.6, 1.6); // los parlantes sí se pueden trepar
      break;
    }
    case 'pantalla': {
      // Pantalla colgada: ancho a elección, 16:9
      const w = piece.w ?? 3.6, h = (w * 9) / 16;
      rbox(w + 0.12, h + 0.12, 0.08, mat({ roughness: 0.4 }), 0, 0, 0.04, 0.02);
      const screen = add(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 0, 0, 0.082);
      screen.castShadow = false;
      parts.screen = screen;
      parts.size = { w, h };
      interact = { kind: 'screen' };
      break;
    }
    case 'trono': {
      const gold = mat({ roughness: 0.25, metalness: 1 });
      const velvet = new THREE.MeshStandardMaterial({ color: 0x7a1c22, roughness: 1 });
      rbox(1, 0.45, 0.9, gold, 0, 0.225, 0, 0.04);
      rbox(0.8, 0.12, 0.75, velvet, 0, 0.5, 0.05, 0.05);
      rbox(1, 1.6, 0.16, gold, 0, 1.0, -0.38, 0.05);
      rbox(0.74, 1.2, 0.04, velvet, 0, 1.05, -0.29, 0.03);
      for (const s of [-1, 1]) {
        rbox(0.14, 0.4, 0.85, gold, s * 0.45, 0.68, 0, 0.04);
        add(new THREE.SphereGeometry(0.09, 16, 12), gold, s * 0.42, 1.86, -0.38);
      }
      add(new THREE.OctahedronGeometry(0.14), gold, 0, 1.95, -0.38);
      collide(1, 0.9, 0.56);
      sit(0, 0.08, 0.56);
      seatsAction();
      break;
    }
    case 'espejos': {
      // Bola de espejos: cuelga del techo (o a 3,4 m si es al aire libre). Gira sola
      const top = Math.max(2.6, (env.h || 4) - 0.05);
      const y = top - 0.9;
      cyl(0.006, 0.006, top - y, shared.steel, 0, (top + y) / 2, 0, 6).castShadow = false;
      const ball = add(new THREE.IcosahedronGeometry(0.3, 3), new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 1, flatShading: true }), 0, y - 0.3, 0);
      parts.spin = ball;
      parts.light = { y: y - 0.3, color: 0xffffff, sparkle: true };
      break;
    }
    case 'sillonNeon': {
      sofa(2.2, new THREE.MeshStandardMaterial({ color, roughness: 1, sheen: 1 }));
      cbox(2.1, 0.03, 0.03, neonMat(0xff4fd8), 0, 0.03, 0.47).castShadow = false;
      cbox(2.2, 0.03, 0.03, neonMat(0xff4fd8), 0, 0.89, -0.38).castShadow = false;
      break;
    }
    case 'esculturaNeon': {
      rbox(0.6, 0.8, 0.6, shared.dark, 0, 0.4, 0, 0.02);
      const knot = add(new THREE.TorusKnotGeometry(0.22, 0.03, 160, 10, 2, 3), neonMat(piece.c), 0, 1.25, 0);
      knot.castShadow = false;
      parts.spin = knot;
      collide(0.6, 0.6, 0.8, { climb: false, noStand: true });
      break;
    }
    // Diseños de artistas: un cuadro con su imagen (1,2 m del lado más largo) o un objeto 3D a tamaño real.
    // E abre la ficha (el cuadro, en HD).
    case 'disenoCuadro': {
      const d = piece.design;
      const [w, h] = cuadroSize(d);
      rbox(w + 0.08, h + 0.08, 0.05, mat({ roughness: 0.35 }), 0, 0, 0.025, 0.015);
      const canvas = add(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 0, 0, 0.052);
      canvas.castShadow = false;
      if (d) new THREE.TextureLoader().loadAsync(designFileUrl(d.id)).then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        canvas.material.map = tex;
        canvas.material.needsUpdate = true;
      }).catch(() => {});
      interact = { kind: 'design', prompt: 'Ver el cuadro', design: d, info: { title: d?.title ?? '' } };
      break;
    }
    case 'disenoObjeto': {
      const d = piece.design;
      const [w, h, dp] = d?.dims ?? [0.5, 0.5, 0.5];
      collide(w, dp, h);
      if (d) loadGLTF(designFileUrl(d.id, 'model')).then((gltf) => {
        const obj = fitDesignModel(gltf.scene, d);
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = high; o.receiveShadow = high; } });
        g.add(obj);
      }).catch(() => {});
      interact = { kind: 'design', prompt: 'Ver', design: d, info: { title: d?.title ?? '' } };
      break;
    }
    // Muebles que reparten consumibles: E y te lo tomás en el momento
    case 'barraTragos': {
      rbox(2, 1.05, 0.7, mat({ roughness: 0.4 }), 0, 0.525, 0, 0.03);
      rbox(2.2, 0.06, 0.85, new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.1, metalness: 0.4 }), 0, 1.08, 0, 0.02);
      cbox(2, 0.04, 0.04, neonMat(0xff4fd8), 0, 0.12, 0.36).castShadow = false;
      // Botellas arriba de la barra
      const glass = [0x2e7d32, 0xffb74d, 0x90caf9, 0xd81b60].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, transparent: true, opacity: 0.85 }));
      for (let i = 0; i < 4; i++) cyl(0.04, 0.045, 0.3, glass[i], -0.7 + i * 0.18, 1.26, -0.2, 12);
      collide(2, 0.7, 1.1, { climb: false, noStand: true });
      interact = { kind: 'dispense', gives: 'trago', prompt: 'Servirte un trago' };
      break;
    }
    case 'minibar': {
      rbox(0.6, 0.85, 0.6, mat({ roughness: 0.35, metalness: 0.3 }), 0, 0.425, 0, 0.04);
      cbox(0.03, 0.4, 0.03, shared.steel, 0.24, 0.55, 0.31);
      cbox(0.5, 0.01, 0.01, neonMat(0x19d3ff), 0, 0.82, 0.305).castShadow = false;
      collide(0.6, 0.6, 0.85, { climb: false, noStand: true });
      interact = { kind: 'dispense', gives: 'trago', prompt: 'Servirte un trago' };
      break;
    }
    case 'cafetera': {
      // Mesita con la cafetera arriba
      rbox(0.6, 0.75, 0.5, tint(1.6, { roughness: 0.7 }), 0, 0.375, 0, 0.02);
      rbox(0.3, 0.38, 0.28, mat({ roughness: 0.3, metalness: 0.6 }), 0, 0.94, -0.03, 0.03);
      cyl(0.05, 0.045, 0.08, new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 }), 0, 0.79, 0.08, 16);
      cbox(0.22, 0.02, 0.02, neonMat(0xffb36b), 0, 1.1, 0.12).castShadow = false;
      collide(0.6, 0.5, 0.75, { climb: false, noStand: true });
      interact = { kind: 'dispense', gives: 'cafe', prompt: 'Servirte un café' };
      break;
    }
    default:
      cbox(0.5, 0.5, 0.5, mat(), 0, 0.25, 0);
  }
  return { group: g, boxes, seats, interact, parts };
}
