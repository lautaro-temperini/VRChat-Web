import * as THREE from 'three';
import { ROOM_TEMPLATES } from '../../server/shared.js';
import { woodFloor, concrete } from './textures.js';
import { neonMat } from './furniture.js';

// Plantillas de las salas personales (loft, galería, club, terraza): el "cascarón" de la sala
// (piso, paredes, techo, luces y lo que se ve afuera). Los muebles los pone el dueño (rooms.js).
// Todas miden ~12 × 10 m, con la entrada al sur (z = d/2).
//
// buildShell(id, { high }) → {
//   group, colliders, blockers,
//   walls:   paredes donde se cuelgan cuadros y pantallas [{ normal, point, along, min, max, top }]
//   cutaway: lo que se oculta en el editor para ver desde arriba [{ object, normal }] (normal null = techo)
//   setTime(hours), update(dt, t, { music, lights })
// }

const T = 0.2; // espesor de las paredes

export function buildShell(id, { high }) {
  const def = ROOM_TEMPLATES[id] ?? ROOM_TEMPLATES.loft;
  const W = def.w / 2, D = def.d / 2, H = def.h || 3.2;
  const group = new THREE.Group();
  const colliders = [], blockers = [], walls = [], cutaway = [], animated = [];
  let timeFn = () => {};

  function mesh(geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = high;
    m.receiveShadow = high;
    group.add(m);
    return m;
  }
  const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  function collider(minX, maxX, minZ, maxZ, top, climb = false) { colliders.push({ minX, maxX, minZ, maxZ, top, climb }); }

  function floor(mat) {
    const m = mesh(new THREE.PlaneGeometry(def.w + 2 * T, def.d + 2 * T), mat, 0, 0, 0);
    m.rotation.x = -Math.PI / 2;
    m.castShadow = false;
  }
  function repeatTex(tex, rx, ry) { const t = tex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t; }

  // Una pared interior (de un lado de la sala), con hueco de puerta opcional en el medio.
  // side: n (z = -D), s (z = +D), o (x = -W), e (x = +W)
  function wall(side, mat, { h = H, door = null } = {}) {
    const ns = side === 'n' || side === 's';
    const len = (ns ? def.w : def.d) + 2 * T;
    const sign = side === 'n' || side === 'o' ? -1 : 1;
    const pos = sign * ((ns ? D : W) + T / 2);
    const normal = ns ? new THREE.Vector3(0, 0, -sign) : new THREE.Vector3(-sign, 0, 0);
    const holder = new THREE.Group();
    group.add(holder);
    const seg = (a, b, y0, y1) => {
      const l = b - a, mid = (a + b) / 2, hh = y1 - y0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(ns ? l : T, hh, ns ? T : l), mat);
      m.position.set(ns ? mid : pos, (y0 + y1) / 2, ns ? pos : mid);
      m.castShadow = m.receiveShadow = high;
      holder.add(m);
      blockers.push(m);
      if (y0 < 0.1) {
        if (ns) collider(a, b, pos - T / 2, pos + T / 2, y1);
        else collider(pos - T / 2, pos + T / 2, a, b, y1);
      }
    };
    if (door) {
      seg(-len / 2, door[0], 0, h);
      seg(door[1], len / 2, 0, h);
      seg(door[0], door[1], 2.4, h);
    } else seg(-len / 2, len / 2, 0, h);
    cutaway.push({ object: holder, normal });
    // Plano de la cara interior, para colgar cosas
    walls.push({ normal, point: ns ? new THREE.Vector3(0, 0, sign * D) : new THREE.Vector3(sign * W, 0, 0), along: ns ? 'x' : 'z', min: ns ? -W : -D, max: ns ? W : D, top: h, door });
    return holder;
  }
  function ceiling(mat) {
    const m = mesh(new THREE.PlaneGeometry(def.w + 2 * T, def.d + 2 * T), mat, 0, H, 0);
    m.rotation.x = Math.PI / 2;
    cutaway.push({ object: m, normal: null });
    return m;
  }
  // Puerta de entrada (decorativa) al sur, en el medio
  function door(frameMat, leafMat) {
    const g = new THREE.Group();
    g.position.set(0, 0, D);
    // Todas las piezas frenan la cámara (si no, en 3ª persona se escapa por el hueco de la puerta)
    const add = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = high; g.add(b); blockers.push(b); };
    add(0.08, 2.4, T + 0.06, frameMat, -0.9, 1.2, T / 2);
    add(0.08, 2.4, T + 0.06, frameMat, 0.9, 1.2, T / 2);
    add(1.88, 0.08, T + 0.06, frameMat, 0, 2.4, T / 2);
    add(0.86, 2.3, 0.05, leafMat, -0.43, 1.15, T * 0.8);
    add(0.86, 2.3, 0.05, leafMat, 0.43, 1.15, T * 0.8);
    group.add(g);
    cutaway.push({ object: g, normal: new THREE.Vector3(0, 0, 1) });
  }
  // Zócalo alrededor (se oculta junto con su pared)
  function baseboard(mat) {
    for (const w of walls) {
      const len = w.max - w.min;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w.along === 'x' ? len : 0.02, 0.1, w.along === 'x' ? 0.02 : len), mat);
      b.position.copy(w.point).addScaledVector(w.normal, 0.01).setY(0.05);
      const holder = cutaway.find((c) => c.normal && c.normal.equals(w.normal))?.object ?? group;
      holder.add(b);
    }
  }

  const hemi = new THREE.HemisphereLight(0xfff1e0, 0x6a5040, 0.9);
  group.add(hemi);
  const sky = new THREE.Color();

  if (id === 'loft') {
    // Loft: piso de madera, paredes de ladrillo y yeso, ventanal al este, vigas a la vista
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(woodFloor(), def.w / 4, def.d / 4), roughness: 0.5 }));
    const plaster = new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.95 });
    const brick = new THREE.MeshStandardMaterial({ map: repeatTex(brickTex(), def.w / 3, H / 1.5), roughness: 0.9 });
    wall('n', brick);
    wall('o', plaster);
    wall('s', plaster, { door: [-0.95, 0.95] });
    // Ventanal al este: marco negro con vidrios, y la ciudad atrás
    const east = wall('e', plaster, { h: 0.5 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false });
    const win = new THREE.Group();
    east.add(win);
    const wx = W + T / 2;
    for (let z = -D; z <= D + 0.01; z += def.d / 5) { const b = new THREE.Mesh(new THREE.BoxGeometry(T, H - 0.5, 0.08), frame); b.position.set(wx, 0.5 + (H - 0.5) / 2, z); win.add(b); }
    for (const y of [0.5, 2.3, H]) { const b = new THREE.Mesh(new THREE.BoxGeometry(T, 0.08, def.d), frame); b.position.set(wx, y, 0); win.add(b); }
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.02, H - 0.5, def.d), glass);
    pane.position.set(wx, 0.5 + (H - 0.5) / 2, 0);
    win.add(pane);
    blockers.push(pane);
    collider(W, W + T, -D, D, H);
    const city = cityBackdrop(def.d * 3, 9);
    city.position.set(W + 14, 3, 0);
    city.rotation.y = -Math.PI / 2;
    group.add(city);
    const ceil = ceiling(new THREE.MeshStandardMaterial({ color: 0xdcd5c9, roughness: 1 }));
    for (let x = -W + 1.5; x < W; x += 3) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, def.d), new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.7 }));
      beam.rotation.x = -Math.PI / 2; // el techo está rotado: así queda derecha y colgando 15 cm
      beam.position.set(x, 0, 0.15);
      ceil.add(beam);
    }
    // Lámparas colgantes
    for (const [x, z] of [[-2, -1], [2, -1], [-2, 2.5], [2, 2.5]]) pendant(x, z);
    cutaway.push({ object: city, normal: null });
    door(frame, new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.5 }));
    baseboard(new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.6 }));
    const sun = new THREE.DirectionalLight(0xffe2b8, 1.8);
    sun.position.set(14, 8, -3);
    sun.castShadow = high;
    if (high) { sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; }
    group.add(sun);
    const night = new THREE.PointLight(0xffc98a, 0, 14, 1.5);
    night.position.set(0, H - 0.6, 0.5);
    group.add(night);
    timeFn = (day) => {
      sun.intensity = 2.2 * day;
      hemi.intensity = 0.35 + 0.6 * day;
      night.intensity = 9 * (1 - day);
      city.material.color.setScalar(0.25 + 0.75 * day);
      city.userData.windows.opacity = 1 - day;
    };
  } else if (id === 'galeria') {
    // Galería: paredes blancas, piso de cemento claro, luz cenital y rieles de luz
    const conc = concrete();
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(conc, def.w / 6, def.d / 6), color: 0xd8d4cc, roughness: 0.3, metalness: 0.05 }));
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.95 });
    wall('n', white); wall('o', white); wall('e', white); wall('s', white, { door: [-0.95, 0.95] });
    const ceil = ceiling(white);
    for (const z of [-2.5, 2.5]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(def.w - 2, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f7ff).multiplyScalar(1.4) }));
      strip.position.set(0, z, 0.01);
      ceil.add(strip);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(def.w - 1, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.6, roughness: 0.4 }));
      rail.position.set(0, z * 1.5, 0.03);
      ceil.add(rail);
    }
    door(new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.6 }));
    baseboard(new THREE.MeshStandardMaterial({ color: 0xe0dcd4, roughness: 0.7 }));
    hemi.color.set(0xffffff); hemi.groundColor.set(0x9a948a); hemi.intensity = 1.2;
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2, 10, 3);
    group.add(key);
    // Luces que bañan las paredes
    for (const [x, z, tx, tz] of [[-3.5, -3.7, -3.5, -5], [0, -3.7, 0, -5], [3.5, -3.7, 3.5, -5], [-4.7, -1.5, -6, -1.5], [4.7, -1.5, 6, -1.5]]) {
      if (!high) break;
      const s = new THREE.SpotLight(0xfff4e0, 18, 8, 0.55, 0.6, 1.5);
      s.position.set(x, H - 0.2, z);
      s.target.position.set(tx, 1.6, tz);
      group.add(s, s.target);
    }
    timeFn = (day) => { key.intensity = 0.6 + 0.8 * day; hemi.intensity = 0.9 + 0.4 * day; };
  } else if (id === 'club') {
    // Club: la pista del Museo en chico, sin balcón. Paredes negras, luces básicas
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(concrete(), def.w / 6, def.d / 6), roughness: 0.22, metalness: 0.05 }));
    const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });
    wall('n', black); wall('o', black); wall('e', black); wall('s', black, { door: [-0.95, 0.95] });
    ceiling(new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 1 }));
    door(new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.5, metalness: 0.3 }), new THREE.MeshStandardMaterial({ color: 0x232328, roughness: 0.5 }));
    hemi.color.set(0xb0a0ff); hemi.groundColor.set(0x201820); hemi.intensity = 0.45;
    // Tira de LED alrededor del techo + 4 focos de color
    const led = neonMat(0xff4fd8);
    for (const w of walls) {
      const len = w.max - w.min;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w.along === 'x' ? len : 0.04, 0.04, w.along === 'x' ? 0.04 : len), led);
      strip.position.copy(w.point).addScaledVector(w.normal, 0.03).setY(H - 0.25);
      cutaway.find((c) => c.normal && c.normal.equals(w.normal)).object.add(strip);
    }
    const spots = [];
    for (const [x, z] of [[-3, -2], [3, -2], [-3, 2], [3, 2]]) {
      const can = box(0.22, 0.3, 0.22, new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.6, roughness: 0.4 }), x, H - 0.2, z);
      cutaway.push({ object: can, normal: null });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), neonMat(0xffffff));
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.151;
      can.add(lens);
      const light = new THREE.SpotLight(0xffffff, 0, 10, 0.45, 0.5, 1.2);
      light.position.set(x, H - 0.3, z);
      light.target.position.set(x * 0.4, 0, z * 0.3);
      group.add(light, light.target);
      spots.push({ light, lens, x, z });
    }
    const wash = new THREE.PointLight(0xffffff, 0, 16, 1.2);
    wash.position.set(0, H - 0.8, -1);
    group.add(wash);
    const tmp = new THREE.Color();
    animated.push((dt, t, { music = -1, lights = null }) => {
      const p = music > 0 ? Math.min(1, music * 2.2) : 0;
      if (lights) {
        // Un artista maneja las luces por OSC
        const k = Math.max(0, lights.intensidad ?? 1);
        const base = lights.color ? tmp.setRGB(...lights.color) : tmp.setHSL((t * 0.08) % 1, 1, 0.5);
        led.color.copy(lights.leds?.color ? new THREE.Color(...lights.leds.color) : base).multiplyScalar(5 * k + (lights.flash ?? 0) * 10);
        spots.forEach((s, i) => {
          const f = lights.focos?.[i];
          const c = f?.color ? new THREE.Color(...f.color) : base;
          s.light.color.copy(c);
          s.light.intensity = high ? 40 * k * (f?.intensidad ?? 1) : 0;
          s.lens.material.color.copy(c).multiplyScalar(5 * k);
          s.light.target.position.set(s.x * 0.4 + (f?.pan ?? 0) * 3, 0, s.z * 0.3 + (f?.tilt ?? 0) * 3);
        });
        wash.color.copy(base);
        wash.intensity = 6 * k;
        return;
      }
      led.color.setHSL((t * 0.06) % 1, 1, 0.5).multiplyScalar(5 * (0.5 + p));
      spots.forEach((s, i) => {
        const c = tmp.setHSL((t * 0.05 + i * 0.25) % 1, 1, 0.55);
        s.light.color.copy(c);
        s.light.intensity = high ? (8 + 40 * p) : 0;
        s.lens.material.color.copy(c).multiplyScalar(2 + 4 * p);
        s.light.target.position.set(s.x * 0.4 + Math.sin(t * 0.7 + i) * 1.5, 0, s.z * 0.3 + Math.cos(t * 0.6 + i) * 1.5);
      });
      wash.color.setHSL((t * 0.05 + 0.5) % 1, 0.8, 0.5);
      wash.intensity = 4 + 10 * p;
    });
  } else {
    // Terraza: al aire libre, deck de madera, baranda, fachada con la puerta al sur y la ciudad al norte
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(woodFloor(), def.w / 3, def.d / 3), color: 0xc8b8a6, roughness: 0.7 }));
    const facadeMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.95 });
    wall('s', facadeMat, { h: 3.4, door: [-0.95, 0.95] });
    door(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, transparent: true, opacity: 0.35 }));
    // Baranda de vidrio con pasamanos (no se trepa)
    const rail = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false });
    for (const side of ['n', 'o', 'e']) {
      const ns = side === 'n';
      const len = ns ? def.w : def.d;
      const sign = side === 'o' ? -1 : side === 'e' ? 1 : -1;
      const pos = sign * (ns ? D : W);
      const holder = new THREE.Group();
      group.add(holder);
      const add = (w, h, d, m, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(ns ? len : w, h, ns ? w : len), m); b.position.set(ns ? 0 : pos, y, ns ? pos : 0); holder.add(b); return b; };
      add(0.08, 0.06, 0.08, rail, 1.08);
      add(0.02, 1.0, 0.02, glass, 0.55);
      if (ns) collider(-W, W, pos - 0.1, pos + 0.1, 1.1); else collider(pos - 0.1, pos + 0.1, -D, D, 1.1);
      const normal = ns ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-sign, 0, 0);
      cutaway.push({ object: holder, normal: normal.clone().negate(), keep: true });
      walls.push({ normal, point: ns ? new THREE.Vector3(0, 0, pos) : new THREE.Vector3(pos, 0, 0), along: ns ? 'x' : 'z', min: ns ? -W : -D, max: ns ? W : D, top: 3.4 });
    }
    // Guirnalda de lamparitas
    const bulbs = neonMat(0xffd27a);
    const garland = new THREE.Group();
    group.add(garland);
    cutaway.push({ object: garland, normal: null });
    for (let i = 0; i < 4; i++) {
      const x0 = -W + 0.2, x1 = W - 0.2, z = -D + 1.5 + i * 2.2;
      const pts = [];
      for (let k = 0; k <= 20; k++) { const u = k / 20; pts.push(new THREE.Vector3(x0 + (x1 - x0) * u, 3 - Math.sin(u * Math.PI) * 0.5, z)); }
      const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.006, 4), rail);
      garland.add(wire);
      for (let k = 1; k < 20; k += 2) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), bulbs); b.position.copy(pts[k]).setY(pts[k].y - 0.06); garland.add(b); }
    }
    const city = cityBackdrop(70, 14);
    city.position.set(0, 2, -32);
    group.add(city);
    cutaway.push({ object: city, normal: null });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12), new THREE.MeshBasicMaterial({ color: 0x87b3e8, side: THREE.BackSide, fog: false }));
    group.add(dome);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    sun.position.set(-6, 12, -4);
    sun.castShadow = high;
    if (high) { sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; }
    group.add(sun);
    const warm = new THREE.PointLight(0xffc27a, 0, 14, 1.4);
    warm.position.set(0, 2.8, 0);
    group.add(warm);
    timeFn = (day, golden) => {
      sun.intensity = 2.6 * day;
      sun.color.set(0xffe2b8).lerp(new THREE.Color(0xff8a4a), golden);
      hemi.intensity = 0.25 + 0.75 * day;
      dome.material.color.copy(sky.set(0x0b1236)).lerp(new THREE.Color(0x87b3e8), day).lerp(new THREE.Color(0xff9e6b), golden * 0.7);
      city.material.color.setScalar(0.2 + 0.8 * day);
      city.userData.windows.opacity = 1 - day;
      bulbs.color.set(0xffd27a).multiplyScalar(1 + 4 * (1 - day));
      warm.intensity = 8 * (1 - day);
    };
  }

  // Luz de lámparas colgantes (loft)
  // (se ocultan junto con el techo en el editor)
  function pendant(x, z) {
    const g = new THREE.Group();
    const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); };
    add(new THREE.BoxGeometry(0.01, 0.9, 0.01), new THREE.MeshStandardMaterial({ color: 0x111111 }), H - 0.45);
    add(new THREE.ConeGeometry(0.22, 0.25, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), H - 1);
    add(new THREE.SphereGeometry(0.06, 12, 8), neonMat(0xffe3b0), H - 1.08);
    group.add(g);
    cutaway.push({ object: g, normal: null });
  }

  return {
    id, def, group, colliders, blockers, walls, cutaway,
    bounds: { minY: 0.2, maxY: def.h ? def.h - 0.2 : 30 },
    spawn: { x: 0, z: D - 1, yaw: 0 }, // en la puerta, mirando hacia adentro
    setTime(hours) {
      const elev = Math.sin(((hours - 6.5) / 13) * Math.PI);
      const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
      const golden = day * (1 - THREE.MathUtils.smoothstep(elev, 0.1, 0.45));
      timeFn(day, golden);
    },
    update(dt, t, state) { for (const fn of animated) fn(dt, t, state); },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material ?? [])) { m.map?.dispose(); m.dispose(); }
      });
    },
  };
}

// Ladrillos (loft)
function brickTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#8c8279';
  g.fillRect(0, 0, 512, 512);
  const bh = 512 / 16, bw = 512 / 4;
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < 16; r++) {
    for (let k = -1; k < 5; k++) {
      const x = k * bw + (r % 2 ? bw / 2 : 0);
      g.fillStyle = `hsl(${10 + rand() * 10} ${35 + rand() * 15}% ${32 + rand() * 12}%)`;
      g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Ciudad de fondo: siluetas de edificios con ventanas que se prenden de noche
function cityBackdrop(width, height) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const w = document.createElement('canvas');
  w.width = 1024; w.height = 256;
  const gw = w.getContext('2d');
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 1024;) {
    const bw = 30 + rand() * 70, bh = 60 + rand() * 180;
    g.fillStyle = `hsl(220 10% ${30 + rand() * 25}%)`;
    g.fillRect(x, 256 - bh, bw, bh);
    gw.fillStyle = '#ffd98a';
    for (let y = 256 - bh + 8; y < 250; y += 12) for (let wx = x + 5; wx < x + bw - 6; wx += 10) if (rand() > 0.6) gw.fillRect(wx, y, 4, 6);
    x += bw + 2;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  const wtex = new THREE.CanvasTexture(w);
  wtex.colorSpace = THREE.SRGBColorSpace;
  const winMat = new THREE.MeshBasicMaterial({ map: wtex, transparent: true, opacity: 0, toneMapped: false, fog: false });
  const lit = new THREE.Mesh(new THREE.PlaneGeometry(width, height), winMat);
  lit.position.z = 0.05;
  m.add(lit);
  m.userData.windows = winMat;
  return m;
}
