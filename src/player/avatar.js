import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildAccessory } from './accessories.js';
import { ITEMS } from '../../server/shared.js';

// Personaje estilizado (≈1,75 m, mira hacia +Z), armado por código.
// La interfaz (setLook / update) es la misma que va a usar un modelo hecho
// en Blender, así el resto del juego no cambia cuando lo reemplacemos.

export const DEFAULT_LOOK = {
  skin: '#d9a07a', hair: '#3b2416', hairStyle: 'corto', eyes: '#4a3020',
  top: 'buzo', shirt: '#ff7a3d', pants: '#2b3445', shoes: '#f4f4f4',
  height: 1.75, build: 1,
};

export const LOOK_OPTIONS = {
  skin: ['#ffe0c7', '#f1c09b', '#d9a07a', '#b97a52', '#8d5534', '#5c3520'],
  hair: ['#151010', '#3b2416', '#7a4a26', '#c98d4a', '#f2d48a', '#e8e8e8', '#d63a3a', '#3a7bd5', '#ff6fb5', '#5ad17a'],
  hairStyle: ['corto', 'largo', 'rapado', 'rulos', 'coleta'],
  eyes: ['#4a3020', '#2e6b8a', '#3d7a3d', '#8a6a2a', '#1d1d1d', '#8a4be2'],
  top: ['remera', 'buzo'],
  shirt: ['#f4f4f4', '#1d1d22', '#ff7a3d', '#3a7bd5', '#e63946', '#2a9d8f', '#ffd23f', '#8a4be2', '#ff6fb5', '#5ad17a'],
  pants: ['#2b3445', '#1d1d22', '#4b6a8f', '#7a6a55', '#3d5a3a', '#e8e1d0', '#8a3a3a'],
  shoes: ['#f4f4f4', '#1d1d22', '#ff7a3d', '#3a7bd5', '#e63946', '#ffd23f'],
};

// Forma de "salchicha" afinada: va desde y=0 (articulación) hacia abajo.
function taper(r1, r2, len, seg = 8) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r2 * Math.cos(a), -len + r2 + r2 * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r1 * Math.cos(a), -r1 + r1 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, 20);
}

function lathe(profile, segs = 28) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}

const SPHERE = new THREE.SphereGeometry(1, 28, 20);

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
function ell(rx, ry, rz, mat, x = 0, y = 0, z = 0) {
  const m = mesh(SPHERE, mat, x, y, z);
  m.scale.set(rx, ry, rz);
  return m;
}
export const POSE = { stand: 0, crouch: 1, sit: 2, climb: 3, air: 4 };
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const mix = (a, b, t) => a + (b - a) * t;

function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export class Avatar {
  constructor(look = DEFAULT_LOOK, equip = []) {
    this.root = new THREE.Group();
    this.body = group(this.root);
    this.phase = 0;
    this.amount = 0;
    this.time = Math.random() * 10;
    this.weights = { stand: 1, crouch: 0, sit: 0, climb: 0, air: 0 };
    this.eyes = [];

    const std = (roughness, extra = {}) => new THREE.MeshStandardMaterial({ roughness, ...extra });
    this.mats = {
      skin: std(0.5), hair: std(0.65), eyes: std(0.2), shirt: std(0.75),
      pants: std(0.8), shoes: std(0.45),
    };
    const M = this.mats;
    const white = std(0.3, { color: 0xffffff });
    const dark = std(0.4, { color: 0x15110f });
    const lip = std(0.5, { color: 0x8a4040 });
    const sole = std(0.6, { color: 0xf7f7f2 });
    const belt = std(0.4, { color: 0x1b1b1f });
    Object.assign(M, { white, dark, lip, sole, belt }); // para liberarlos en dispose()
    const b = this.body;

    // ---------- Torso ----------
    this.chest = group(b);
    this.chest.add(mesh(lathe([[0, 0.96], [0.15, 0.97], [0.16, 1.03], [0.152, 1.1], [0.17, 1.2], [0.196, 1.3], [0.2, 1.36], [0.182, 1.43], [0.12, 1.475], [0.06, 1.5], [0, 1.505]]), M.shirt));
    this.hips = group(b);
    this.hips.add(mesh(lathe([[0, 0.83], [0.148, 0.845], [0.165, 0.92], [0.157, 1.0], [0, 1.01]]), M.pants));
    const beltRing = mesh(new THREE.TorusGeometry(0.157, 0.016, 8, 32), belt, 0, 0.99, 0);
    beltRing.rotation.x = Math.PI / 2;
    this.hips.add(beltRing);
    b.add(mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.12, 16), M.skin, 0, 1.52, 0));

    // Detalles del buzo: capucha, bolsillo y cordones
    this.hoodie = group(this.chest);
    const hood = mesh(new THREE.TorusGeometry(0.105, 0.05, 10, 20, Math.PI), M.shirt, 0, 1.47, -0.035);
    hood.rotation.set(Math.PI * 0.62, 0, Math.PI);
    hood.scale.set(1.1, 1, 1);
    this.hoodie.add(hood);
    const pocket = mesh(new RoundedBoxGeometry(0.2, 0.09, 0.03, 2, 0.012), M.shirt, 0, 1.1, 0.098);
    this.hoodie.add(pocket);
    for (const x of [-0.035, 0.035]) {
      this.hoodie.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), white, x, 1.38, 0.13));
    }

    // ---------- Cabeza ----------
    this.neck = group(b, 0, 1.53, 0);
    const head = group(this.neck, 0, 0.1, 0);
    this.headCenter = head;
    head.add(ell(0.118, 0.13, 0.122, M.skin));
    head.add(ell(0.1, 0.085, 0.1, M.skin, 0, -0.035, 0.012));
    for (const s of [-1, 1]) {
      head.add(ell(0.02, 0.034, 0.014, M.skin, s * 0.118, -0.005, -0.005));
      // Ojo: blanco, iris, pupila, brillo
      const eye = group(head, s * 0.043, 0.012, 0.1);
      eye.rotation.y = s * 0.28;
      this.eyes.push(eye);
      eye.add(ell(0.027, 0.031, 0.014, white));
      eye.add(ell(0.016, 0.018, 0.008, M.eyes, 0, -0.002, 0.009));
      eye.add(ell(0.008, 0.009, 0.004, dark, 0, -0.002, 0.015));
      eye.add(ell(0.004, 0.004, 0.002, white, 0.005, 0.006, 0.018));
      const brow = mesh(new THREE.CapsuleGeometry(0.0075, 0.03, 4, 8), M.hair, s * 0.045, 0.058, 0.112);
      brow.rotation.z = Math.PI / 2 + s * 0.12;
      head.add(brow);
    }
    head.add(ell(0.016, 0.022, 0.02, M.skin, 0, -0.012, 0.125));
    const mouth = mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 14, Math.PI), lip, 0, -0.048, 0.113);
    mouth.rotation.z = Math.PI;
    mouth.scale.set(1, 0.55, 1);
    head.add(mouth);

    // ---------- Peinados ----------
    const cap = (r = 0.128) => {
      const m = mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), M.hair, 0, 0.012, -0.006);
      m.scale.set(1, 1.05, 1.04);
      return m;
    };
    const H = {};
    H.corto = group(head);
    H.corto.add(cap());
    [[-0.06, 0.1, 0.07, 0.4], [0, 0.12, 0.075, 0.55], [0.06, 0.1, 0.07, 0.4], [-0.03, 0.13, 0.03, 0.2], [0.035, 0.13, 0.03, 0.2]]
      .forEach(([x, y, z, rx]) => { const t = ell(0.05, 0.03, 0.055, M.hair, x, y, z); t.rotation.x = -rx; H.corto.add(t); });
    H.largo = group(head);
    H.largo.add(cap());
    H.largo.add(ell(0.125, 0.17, 0.075, M.hair, 0, -0.07, -0.075));
    for (const s of [-1, 1]) H.largo.add(ell(0.035, 0.12, 0.055, M.hair, s * 0.108, -0.06, 0.02));
    const fringe = ell(0.1, 0.035, 0.05, M.hair, 0.015, 0.095, 0.085);
    fringe.rotation.z = -0.25;
    H.largo.add(fringe);
    H.rapado = group(head);
    H.rapado.add(cap(0.121));
    H.rulos = group(head);
    for (let i = 0; i < 22; i++) {
      const phi = Math.acos(1 - (i / 21) * 1.15), th = i * 2.4;
      const r = 0.13;
      H.rulos.add(ell(0.052, 0.052, 0.052, M.hair, Math.sin(phi) * Math.cos(th) * r, 0.02 + Math.cos(phi) * r, Math.sin(phi) * Math.sin(th) * r - 0.015));
    }
    H.coleta = group(head);
    H.coleta.add(cap());
    H.coleta.add(ell(0.045, 0.045, 0.045, M.hair, 0, 0.06, -0.13));
    const tail = mesh(taper(0.04, 0.018, 0.22), M.hair, 0, 0.06, -0.15);
    tail.rotation.x = 0.35;
    H.coleta.add(tail);
    this.hairs = H;

    // ---------- Brazos ----------
    this.arms = [-1, 1].map((side) => {
      const shoulder = group(b, side * 0.2, 1.405, 0);
      shoulder.add(mesh(taper(0.05, 0.043, 0.29), M.skin));
      const sleeveShort = mesh(taper(0.062, 0.057, 0.15), M.shirt);
      shoulder.add(sleeveShort);
      const sleeveLong = mesh(taper(0.062, 0.054, 0.3), M.shirt);
      shoulder.add(sleeveLong);
      const elbow = group(shoulder, 0, -0.28, 0);
      elbow.add(mesh(taper(0.044, 0.035, 0.25), M.skin));
      const cuff = mesh(taper(0.053, 0.046, 0.23), M.shirt);
      elbow.add(cuff);
      const hand = group(elbow, 0, -0.25, 0);
      hand.add(ell(0.034, 0.05, 0.024, M.skin, 0, -0.035, 0));
      const thumb = mesh(taper(0.013, 0.011, 0.05), M.skin, side * -0.012, -0.015, 0.02);
      thumb.rotation.set(-0.5, 0, side * 0.2);
      hand.add(thumb);
      return { shoulder, elbow, side, sleeveShort, sleeveLong, cuff };
    });

    // ---------- Piernas ----------
    this.legs = [-1, 1].map((side) => {
      const hip = group(b, side * 0.088, 0.92, 0);
      hip.add(mesh(taper(0.082, 0.062, 0.46), M.pants));
      const knee = group(hip, 0, -0.43, 0);
      knee.add(mesh(taper(0.064, 0.054, 0.42), M.pants));
      knee.add(mesh(new RoundedBoxGeometry(0.115, 0.085, 0.25, 3, 0.035), M.shoes, 0, -0.425, 0.04));
      knee.add(mesh(new RoundedBoxGeometry(0.125, 0.032, 0.27, 2, 0.012), sole, 0, -0.474, 0.042));
      return { hip, knee, side };
    });

    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.accessories = [];
    this.equip = [];
    this.setLook(look);
    this.setEquip(equip);
  }

  // Objetos equipados: [{ type, color }]
  setEquip(list = []) {
    for (const a of this.accessories) {
      a.group.removeFromParent();
      a.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.equip = list;
    this.accessories = list.filter((it) => ITEMS[it.type]).map((it) => {
      const a = buildAccessory(it.type, it.color);
      (a.part === 'head' ? this.headCenter : this.body).add(a.group);
      return a;
    });
    this.setLook(this.look);
  }

  setLook(look) {
    this.look = { ...DEFAULT_LOOK, ...look };
    const L = this.look;
    for (const k of ['skin', 'hair', 'eyes', 'shirt', 'pants', 'shoes']) this.mats[k].color.set(L[k]);
    const hat = (this.equip ?? []).some((it) => ITEMS[it.type]?.slot === 'head' && it.type !== 'crown');
    for (const [k, g] of Object.entries(this.hairs)) g.visible = k === L.hairStyle && !(hat && ['corto', 'rulos'].includes(k));
    const hoodie = L.top === 'buzo';
    this.hoodie.visible = hoodie;
    for (const a of this.arms) {
      a.sleeveShort.visible = !hoodie;
      a.sleeveLong.visible = hoodie;
      a.cuff.visible = hoodie;
      a.shoulder.position.x = a.side * 0.2 * L.build;
    }
    // Contextura: más ancho de torso y extremidades
    this.chest.scale.set(1.12 * L.build, 1, 0.7 * (0.5 + L.build / 2));
    this.hips.scale.set(1.08 * (0.6 + L.build * 0.4), 1, 0.78);
    for (const a of this.arms) a.shoulder.scale.set(0.8 + L.build * 0.2, 1, 0.8 + L.build * 0.2);
    for (const l of this.legs) l.hip.scale.set(0.85 + L.build * 0.15, 1, 0.85 + L.build * 0.15);
    this.scale = L.height / 1.75;
    this.root.scale.setScalar(this.scale);
  }

  // motion: { speed (m/s), pose (POSE.*), turn (rad/s, para inclinarse en curvas), landing (0..1) }
  update(dt, { speed = 0, pose = POSE.stand, turn = 0, landing = 0 } = {}) {
    this.time += dt;
    const w = this.weights;
    for (const [name, id] of Object.entries(POSE)) w[name] = damp(w[name], pose === id ? 1 : 0, 12, dt);
    const grounded = pose === POSE.stand || pose === POSE.crouch;
    this.amount = damp(this.amount, grounded ? Math.min(speed / 4.5, 1.4) : 0, 10, dt);
    const a = this.amount, am = Math.min(a, 1);
    const sprint = THREE.MathUtils.clamp((speed - 5.2) / 1.5, 0, 1) * am;
    this.phase += dt * speed * (pose === POSE.crouch ? 3.4 : 2.3) / this.scale;
    const { crouch, sit, climb, air } = w;
    const k = 18; // qué tan rápido siguen las articulaciones a su pose

    for (const leg of this.legs) {
      const ph = this.phase + (leg.side > 0 ? 0 : Math.PI);
      const amp = (0.5 + 0.35 * sprint) * am * (1 - crouch * 0.45);
      let hip = -Math.sin(ph) * amp + crouch * -0.95;
      let knee = Math.max(0, -Math.cos(ph)) * (0.85 + 0.65 * sprint) * am + 0.1 * am + crouch * 1.85;
      hip = mix(hip, -0.35 - leg.side * 0.35, air);
      knee = mix(knee, 0.7 + leg.side * 0.5, air);
      hip = mix(hip, -1.25 + leg.side * 0.2, climb);
      knee = mix(knee, 1.7, climb);
      hip = mix(hip, -1.55, sit);
      knee = mix(knee, 1.55, sit);
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hip, k, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, knee, k, dt);
    }

    const idle = Math.sin(this.time * 1.6) * 0.03 * (1 - am);
    for (const arm of this.arms) {
      const swing = Math.sin(this.phase) * arm.side * (0.65 + 0.5 * sprint) * am;
      let sx = swing + idle + crouch * -0.3;
      let sz = arm.side * (0.08 + 0.05 * am);
      let el = -(0.2 + 0.55 * am + 0.75 * sprint) - crouch * 0.5;
      sx = mix(sx, -0.5, air); sz = mix(sz, arm.side * 0.85, air); el = mix(el, -0.6, air);
      sx = mix(sx, -2.75, climb); sz = mix(sz, arm.side * 0.2, climb); el = mix(el, -0.35, climb);
      sx = mix(sx, -0.45, sit); sz = mix(sz, arm.side * 0.12, sit); el = mix(el, -0.95, sit);
      arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, sx, k, dt);
      arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, sz, k, dt);
      arm.elbow.rotation.x = damp(arm.elbow.rotation.x, el, k, dt);
    }

    // Cuerpo: rebote, inclinación al correr, curvas y aterrizajes
    const lean = 0.05 * am + 0.2 * sprint + crouch * 0.35 + climb * 0.35;
    const bob = Math.abs(Math.sin(this.phase)) * (0.035 + 0.03 * sprint) * am;
    this.body.position.y = damp(this.body.position.y, bob - crouch * 0.36 - sit * 0.42 - landing * 0.12, 20, dt);
    this.body.rotation.x = damp(this.body.rotation.x, lean, 10, dt);
    this.body.rotation.z = damp(this.body.rotation.z, THREE.MathUtils.clamp(-turn * 0.07, -0.22, 0.22) * am, 8, dt);
    this.chest.rotation.y = Math.sin(this.phase) * 0.12 * am;
    this.chest.scale.y = 1 + Math.sin(this.time * 1.8) * 0.01 * (1 - am);
    this.neck.rotation.x = damp(this.neck.rotation.x, -lean * 0.7, 10, dt);
    this.neck.rotation.y = Math.sin(this.time * 0.4) * 0.18 * (1 - am) * (1 - sit * 0.5);

    // Parpadeo cada tantos segundos
    const blink = (this.time % 4.3) < 0.12 ? 0.15 : 1;
    for (const e of this.eyes) e.scale.y = blink;
  }
  dispose() {
    this.root.traverse((o) => { if (o.geometry && o.geometry !== SPHERE) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) m.dispose();
    this.setEquip([]);
  }
}
