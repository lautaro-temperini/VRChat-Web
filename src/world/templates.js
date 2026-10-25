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
  const colliders = [], blockers = [], walls = [], cutaway = [], animated = [], exits = [];
  let timeFn = () => {};
  let videoFn = () => {}; // salas que muestran el video del VJ en sus superficies (inmersiva)

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
      if (h > 2.4) seg(door[0], door[1], 2.4, h); // (una pared baja con puerta no lleva dintel)
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
    exits.push({ x0: -0.9, x1: 0.9, z0: D - 0.6, z1: D + 1 }); // al meterse en la puerta se abre el Mapa
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
  } else if (id === 'plaza') {
    buildPlaza();
  } else if (id === 'cafeteria') {
    buildCafe();
  } else if (id === 'azotea') {
    buildRooftop();
  } else if (id === 'taller') {
    buildWorkshop();
  } else if (id === 'inmersiva') {
    buildImmersive();
  } else if (id === 'rave') {
    buildRave();
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

  // ---------- Plaza (mapa público, 50 × 50 m): fuente con bancos (muebles fijos), esculturas grandes,
  // canteros con árboles, faroles, reja con portón al sur y la ciudad alrededor ----------
  function buildPlaza() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xbdb6aa, roughness: 0.85, side: THREE.DoubleSide });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x8f877b, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.6 });
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(concrete(), def.w / 5, def.d / 5), color: 0xcfc8bc, roughness: 0.75 }));
    // Canteros de pasto en las cuatro esquinas (caminos en cruz y alrededor de la fuente)
    const grass = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 });
    const LAWN = [6, 22];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const size = LAWN[1] - LAWN[0], cx = sx * (LAWN[0] + size / 2), cz = sz * (LAWN[0] + size / 2);
      const lawn = mesh(new THREE.PlaneGeometry(size, size), grass, cx, 0.02, cz);
      lawn.rotation.x = -Math.PI / 2;
      lawn.castShadow = false;
      for (const [w, d, x, z] of [[size + 0.3, 0.15, cx, cz - size / 2], [size + 0.3, 0.15, cx, cz + size / 2], [0.15, size, cx - size / 2, cz], [0.15, size, cx + size / 2, cz]]) {
        box(w, 0.12, d, darkStone, x, 0.06, z).castShadow = false;
      }
    }

    // Fuente: pileta redonda, columna con dos platos y chorros
    const R = 3.6;
    mesh(new THREE.CylinderGeometry(R, R + 0.1, 0.55, 64, 1, true), stone, 0, 0.275, 0);
    const lip = mesh(new THREE.TorusGeometry(R, 0.14, 10, 64), stone, 0, 0.55, 0);
    lip.rotation.x = Math.PI / 2;
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 });
    const water = mesh(new THREE.CircleGeometry(R - 0.05, 64), waterMat, 0, 0.42, 0);
    water.rotation.x = -Math.PI / 2;
    water.castShadow = false;
    mesh(new THREE.CylinderGeometry(0.45, 0.7, 1.4, 24), stone, 0, 0.7, 0);
    mesh(new THREE.CylinderGeometry(1.5, 0.5, 0.35, 40), stone, 0, 1.5, 0);
    mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.9, 20), stone, 0, 2.1, 0);
    mesh(new THREE.CylinderGeometry(0.8, 0.3, 0.25, 32), stone, 0, 2.6, 0);
    const jetMat = new THREE.MeshStandardMaterial({ color: 0xcfefff, roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
    const jets = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const jet = mesh(new THREE.CylinderGeometry(0.03, 0.09, 1.1, 8, 1, true), jetMat, Math.sin(a) * 1.25, 1.2, Math.cos(a) * 1.25);
      jet.castShadow = false;
      jets.push(jet);
    }
    const spout = mesh(new THREE.CylinderGeometry(0.04, 0.12, 0.9, 8, 1, true), jetMat, 0, 3.15, 0);
    spout.castShadow = false;
    jets.push(spout);
    animated.push((dt, t) => {
      jets.forEach((j, i) => { j.scale.y = 1 + 0.12 * Math.sin(t * 6 + i); });
      waterMat.color.setRGB(0.18 + 0.03 * Math.sin(t * 1.3), 0.42 + 0.03 * Math.sin(t * 1.7), 0.56);
    });
    // Se puede subir al borde (trepar), no a la columna
    collider(-R * 0.82, R * 0.82, -R * 0.82, R * 0.82, 0.6, true);
    collider(-0.7, 0.7, -0.7, 0.7, 2.8, false);

    // Esculturas grandes fijas, sobre basamentos
    const plinth = (x, z, w, h) => { box(w, h, w, darkStone, x, h / 2, z); collider(x - w / 2, x + w / 2, z - w / 2, z + w / 2, h + 0.01, false); };
    // 1) Nudo de neón que gira
    plinth(-14, -14, 2.2, 0.8);
    const knotMat = neonMat(0x19d3ff);
    const knot = mesh(new THREE.TorusKnotGeometry(1.1, 0.16, 220, 14, 2, 3), knotMat, -14, 2.6, -14);
    knot.castShadow = false;
    animated.push((dt) => { knot.rotation.y += dt * 0.25; });
    // 2) Bloques de colores apilados
    plinth(14, -14, 2.4, 0.5);
    const blockMats = [0xe63946, 0xffd23f, 0x3a7bd5, 0xf4f4f4].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    [[1.8, 0.9, 1.8, 0, 0.95, 0, 0.2], [1.4, 0.9, 1.4, 0.15, 1.85, 0.1, -0.35], [1.0, 0.9, 1.0, -0.1, 2.75, -0.05, 0.5], [0.6, 0.9, 0.6, 0.05, 3.65, 0.05, -0.2]].forEach(([w, h, d, x, y, z, r], i) => {
      box(w, h, d, blockMats[i], 14 + x, y, -14 + z).rotation.y = r;
    });
    // 3) Aro dorado gigante parado (se puede pasar por adentro)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xd4a74a, roughness: 0.3, metalness: 0.85 });
    const ring = mesh(new THREE.TorusGeometry(2.4, 0.28, 20, 64), ringMat, -14, 2.7, 14);
    ring.rotation.y = Math.PI / 4;
    for (const sd of [-1, 1]) {
      const fx = -14 + sd * Math.cos(Math.PI / 4) * 2.4, fz = 14 - sd * Math.sin(Math.PI / 4) * 2.4;
      box(0.9, 0.3, 0.9, darkStone, fx, 0.15, fz);
      collider(fx - 0.45, fx + 0.45, fz - 0.45, fz + 0.45, 0.6, false);
    }
    // 4) Esferas espejadas
    plinth(14, 14, 2.6, 0.4);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 });
    for (const [x, y, z, r] of [[0, 1.4, 0, 1], [0.9, 2.6, 0.3, 0.6], [-0.5, 3.3, -0.4, 0.4]]) mesh(new THREE.SphereGeometry(r, 40, 24), chrome, 14 + x, y, 14 + z);

    // Árboles en los canteros y a lo largo de la reja (troncos y copas instanciados)
    const trees = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let a = -22; a <= 22; a += 5.5) {
      for (const [x, z] of [[a, -23], [a, 23], [-23, a], [23, a]]) if (!(z === 23 && Math.abs(x) < 4)) trees.push([x, z]);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const [x, z] of [[9.5, 9.5], [18, 9.5], [9.5, 18], [18.5, 18.5]]) trees.push([sx * x + (rand() - 0.5), sz * z + (rand() - 0.5)]);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2f, roughness: 0.9, flatShading: true });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 3, 8), trunkMat, trees.length);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), leafMat, trees.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), eu = new THREE.Euler();
    trees.forEach(([x, z], i) => {
      const k = 0.85 + rand() * 0.4;
      trunks.setMatrixAt(i, m4.compose(pv.set(x, 1.5 * k, z), q.identity(), sv.set(k, k, k)));
      crowns.setMatrixAt(i, m4.compose(pv.set(x, 3.6 * k, z), q.setFromEuler(eu.set(0, rand() * 3, 0)), sv.set(k, k * (0.9 + rand() * 0.3), k)));
      collider(x - 0.25, x + 0.25, z - 0.25, z + 0.25, 3, false);
    });
    trunks.castShadow = crowns.castShadow = high;
    group.add(trunks, crowns);

    // Faroles alrededor de la fuente y en los caminos (de noche se prenden)
    const bulbMat = neonMat(0xffe0a0);
    const lampSpots = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; lampSpots.push([Math.sin(a) * 10.5, Math.cos(a) * 10.5]); }
    for (const v of [-17, 17]) lampSpots.push([v, 2.6], [v, -2.6], [2.6, v], [-2.6, v]);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), iron, lampSpots.length);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 14, 10), bulbMat, lampSpots.length);
    lampSpots.forEach(([x, z], i) => {
      posts.setMatrixAt(i, m4.compose(pv.set(x, 1.8, z), q.identity(), sv.set(1, 1, 1)));
      bulbs.setMatrixAt(i, m4.compose(pv.set(x, 3.75, z), q.identity(), sv.set(1, 1, 1)));
      collider(x - 0.12, x + 0.12, z - 0.12, z + 0.12, 3.6, false);
    });
    posts.castShadow = high;
    bulbs.castShadow = false;
    group.add(posts, bulbs);
    const nightLights = [];
    for (const [x, z] of high ? lampSpots.slice(0, 8).filter((_, i) => i % 2 === 0) : []) {
      const l = new THREE.PointLight(0xffd59a, 0, 14, 1.6);
      l.position.set(x, 3.5, z);
      group.add(l);
      nightLights.push(l);
    }

    // Reja baja de hierro alrededor (no se trepa), con portón al sur: salir por ahí abre el Mapa
    const GATE = 2.2;
    const bars = [];
    for (let a = -D; a <= D; a += 0.18) {
      bars.push([a, -D], [-W, a], [W, a]);
      if (Math.abs(a) > GATE + 0.6) bars.push([a, D]);
    }
    const barMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 1.2, 0.03), iron, bars.length);
    bars.forEach(([x, z], i) => barMesh.setMatrixAt(i, m4.compose(pv.set(x, 0.6, z), q.identity(), sv.set(1, 1, 1))));
    group.add(barMesh);
    for (const y of [0.15, 1.15]) {
      box(def.w, 0.05, 0.05, iron, 0, y, -D);
      box(0.05, 0.05, def.d, iron, -W, y, 0);
      box(0.05, 0.05, def.d, iron, W, y, 0);
      box(D - GATE - 0.6, 0.05, 0.05, iron, -(D + GATE + 0.6) / 2, y, D);
      box(D - GATE - 0.6, 0.05, 0.05, iron, (D + GATE + 0.6) / 2, y, D);
    }
    collider(-W, W, -D - 0.1, -D + 0.1, 1.25);
    collider(-W - 0.1, -W + 0.1, -D, D, 1.25);
    collider(W - 0.1, W + 0.1, -D, D, 1.25);
    collider(-W, -GATE, D - 0.1, D + 0.1, 1.25);
    collider(GATE, W, D - 0.1, D + 0.1, 1.25);
    // Portón: dos pilares y un arco con el nombre; hacia afuera no se puede seguir caminando
    for (const sd of [-1, 1]) { box(0.6, 3.2, 0.6, darkStone, sd * (GATE + 0.3), 1.6, D); collider(sd * (GATE + 0.3) - 0.3, sd * (GATE + 0.3) + 0.3, D - 0.3, D + 0.3, 3.2); }
    box(2 * GATE + 1.2, 0.4, 0.5, darkStone, 0, 3.4, D);
    for (const [z, r] of [[D - 0.26, Math.PI], [D + 0.26, 0]]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.32), new THREE.MeshBasicMaterial({ map: plazaSign(), transparent: true }));
      sign.position.set(0, 3.4, z);
      sign.rotation.y = r;
      group.add(sign);
    }
    collider(-GATE, GATE, D + 1, D + 1.2, 3);
    exits.push({ x0: -GATE, x1: GATE, z0: D - 0.4, z1: D + 1.1 });

    // La ciudad alrededor, el cielo y las luces
    const cities = [[0, -46, 0], [0, 46, Math.PI], [-46, 0, Math.PI / 2], [46, 0, -Math.PI / 2]].map(([x, z, r]) => {
      const city = cityBackdrop(130, 30);
      city.position.set(x, 12, z);
      city.rotation.y = r;
      group.add(city);
      return city;
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 12), new THREE.MeshBasicMaterial({ color: 0x87b3e8, side: THREE.BackSide, fog: false }));
    group.add(dome);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    sun.position.set(-18, 30, 10);
    sun.castShadow = high;
    if (high) { sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 90 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; }
    group.add(sun, sun.target);
    hemi.color.set(0xdfeaff); hemi.groundColor.set(0x5a6040);
    timeFn = (day, golden) => {
      sun.intensity = 2.6 * day;
      sun.color.set(0xffe2b8).lerp(new THREE.Color(0xff8a4a), golden);
      hemi.intensity = 0.2 + 0.8 * day;
      dome.material.color.copy(sky.set(0x0b1236)).lerp(new THREE.Color(0x87b3e8), day).lerp(new THREE.Color(0xff9e6b), golden * 0.7);
      for (const c of cities) { c.material.color.setScalar(0.2 + 0.8 * day); c.userData.windows.opacity = 1 - day; }
      bulbMat.color.set(0xffe0a0).multiplyScalar(0.6 + 5 * (1 - day));
      for (const l of nightLights) l.intensity = 22 * (1 - day);
      knotMat.color.set(0x19d3ff).multiplyScalar(1.5 + 3.5 * (1 - day));
    };
  }

  // ---------- Cafetería (mapa público, 14 × 10 m): café de barrio porteño. Baldosas blanco y negro,
  // boiserie de madera oscura, espejos, estante de botellas, lámparas cálidas y ventanales a la calle ----------
  function buildCafe() {
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(checkerTex(), def.w / 1.2, def.d / 1.2), roughness: 0.35 })); // baldosas de 60 cm
    const cream = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.8 });
    wall('n', cream); wall('o', cream); wall('e', cream);
    // Al sur: ventanales a la calle con la puerta en el medio
    const south = wall('s', cream, { h: 0.6, door: [-0.95, 0.95] });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false });
    const sz = D + T / 2;
    for (const [a, b] of [[-W, -0.95], [0.95, W]]) {
      const len = b - a, mid = (a + b) / 2;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(len, H - 0.6, 0.02), glass);
      pane.position.set(mid, 0.6 + (H - 0.6) / 2, sz);
      south.add(pane);
      blockers.push(pane);
      for (let x = a; x <= b + 0.01; x += len / 3) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, H - 0.6, T), frame); m.position.set(x, 0.6 + (H - 0.6) / 2, sz); south.add(m); }
      for (const y of [0.6, 2.4, H]) { const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, T), frame); m.position.set(mid, y, sz); south.add(m); }
      collider(a, b, D, D + T, H);
    }
    // Vidrio arriba de la puerta
    const transom = new THREE.Mesh(new THREE.BoxGeometry(1.9, H - 2.4, 0.02), glass);
    transom.position.set(0, 2.4 + (H - 2.4) / 2, sz);
    south.add(transom);
    blockers.push(transom);
    // Letras doradas en el vidrio
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5), new THREE.MeshBasicMaterial({ map: cafeSign(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    sign.position.set(-3.6, 2.9, D + T / 2 + 0.02); // se lee desde la calle
    south.add(sign);
    door(frame, glass);
    // Boiserie de madera hasta 1,1 m y moldura dorada en las paredes interiores
    for (const w of walls) {
      if (w.normal.z < -0.5) continue; // la de los ventanales no
      const len = w.max - w.min;
      const holder = cutaway.find((c) => c.normal && c.normal.equals(w.normal))?.object ?? group;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w.along === 'x' ? len : 0.04, 1.1, w.along === 'x' ? 0.04 : len), wood);
      panel.position.copy(w.point).addScaledVector(w.normal, 0.02).setY(0.55);
      holder.add(panel);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w.along === 'x' ? len : 0.05, 0.04, w.along === 'x' ? 0.05 : len), brass);
      rail.position.copy(w.point).addScaledVector(w.normal, 0.04).setY(1.12);
      holder.add(rail);
    }
    // Espejos con marco de madera en las paredes de los costados
    const mirror = new THREE.MeshStandardMaterial({ color: 0xc9d3d8, roughness: 0.02, metalness: 1 });
    for (const s of [-1, 1]) {
      const holder = cutaway.find((c) => c.normal && c.normal.x === -s)?.object ?? group;
      for (const z of [-2.2, 1.6]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.5, 2.4), wood);
        f.position.set(s * (W - 0.03), 2.1, z);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.36, 2.26), mirror);
        m.position.set(s * (W - 0.05), 2.1, z);
        holder.add(f, m);
      }
    }
    // Estante de botellas detrás de la barra (pared norte)
    const north = cutaway.find((c) => c.normal && c.normal.z === 1)?.object ?? group;
    const bottleMats = [0x2f5d3a, 0x6b2a1f, 0xc9a14a, 0x3a5a7a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, transparent: true, opacity: 0.85 }));
    for (const y of [1.6, 2.15]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.04, 0.3), wood);
      shelf.position.set(1.8, y, -D + 0.17);
      north.add(shelf);
      for (let i = 0; i < 14; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 10), bottleMats[(i * 7 + (y > 2 ? 1 : 0)) % 4]);
        b.position.set(-0.3 + i * 0.3, y + 0.17, -D + 0.17);
        north.add(b);
      }
    }
    // Pizarra con el menú
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: menuTex(), roughness: 0.9 }));
    menu.position.set(-2.4, 2.1, -D + 0.03);
    north.add(menu);
    // Techo de madera con lámparas colgantes cálidas
    ceiling(new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8 }));
    for (const [x, z] of [[-3, -1], [0.6, -1], [4, -1], [-3, 2], [0.6, 2.2], [4, 2]]) pendant(x, z);
    hemi.color.set(0xffe2b8); hemi.groundColor.set(0x4a3020); hemi.intensity = 0.7;
    const warm = [];
    for (const [x, z] of high ? [[-2.5, 0.5], [3, 0.5]] : [[0, 0.5]]) {
      const l = new THREE.PointLight(0xffc98a, 14, 12, 1.4);
      l.position.set(x, H - 0.9, z);
      group.add(l);
      warm.push(l);
    }
    // La calle afuera: vereda, empedrado, un farol y edificios enfrente
    const street = new THREE.Mesh(new THREE.PlaneGeometry(60, 14), new THREE.MeshStandardMaterial({ map: repeatTex(concrete(), 12, 3), color: 0x6d6a66, roughness: 0.9 }));
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, -0.02, D + 8);
    group.add(street);
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(60, 2.6), new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: 0.9 }));
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(0, 0.01, D + 1.5);
    group.add(walk);
    const city = cityBackdrop(70, 16);
    city.position.set(0, 7, D + 16);
    city.rotation.y = Math.PI;
    group.add(city);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 20, 10), new THREE.MeshBasicMaterial({ color: 0x87b3e8, side: THREE.BackSide, fog: false }));
    group.add(dome);
    const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
    sun.position.set(-4, 9, 14);
    group.add(sun);
    timeFn = (day, golden) => {
      sun.intensity = 1.8 * day;
      hemi.intensity = 0.55 + 0.35 * day;
      dome.material.color.copy(sky.set(0x0b1236)).lerp(new THREE.Color(0x87b3e8), day).lerp(new THREE.Color(0xff9e6b), golden * 0.7);
      city.material.color.setScalar(0.2 + 0.8 * day);
      city.userData.windows.opacity = 1 - day;
      for (const l of warm) l.intensity = (high ? 10 : 14) + 10 * (1 - day);
    };
  }

  // ---------- Azotea (mapa público, 24 × 18 m): terraza de un edificio con baranda de vidrio, la caseta de la
  // escalera (la puerta lleva al Mapa), tanque de agua y equipos, guirnaldas, pórtico de luces para la fiesta y
  // la ciudad alrededor, más abajo. Las luces siguen la música (o a la consola de artistas por OSC) ----------
  function buildRooftop() {
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(concrete(), def.w / 4, def.d / 4), color: 0x9c968c, roughness: 0.8 }));
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false });
    const facade = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.95 });
    const HUT = 3.2; // media caseta (ancho 6,4 m)
    // Baranda de vidrio con pasamanos (no se trepa), con el hueco de la caseta al sur
    const railRun = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), alongX = z0 === z1;
      const mid = [(x0 + x1) / 2, (z0 + z1) / 2];
      const b = (w, h, d, m, y) => { const o = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : w, h, alongX ? w : len), m); o.position.set(mid[0], y, mid[1]); group.add(o); return o; };
      b(0.08, 0.06, 0.08, steel, 1.08);
      b(0.02, 1.0, 0.02, glass, 0.55);
      if (alongX) collider(Math.min(x0, x1), Math.max(x0, x1), z0 - 0.1, z0 + 0.1, 1.1); else collider(x0 - 0.1, x0 + 0.1, Math.min(z0, z1), Math.max(z0, z1), 1.1);
    };
    railRun(-W, -D, W, -D); railRun(-W, -D, -W, D); railRun(W, -D, W, D);
    railRun(-W, D, -HUT, D); railRun(HUT, D, W, D);
    // Caseta de la escalera, con su puerta mirando a la azotea
    const hut = new THREE.Mesh(new THREE.BoxGeometry(2 * HUT, 3, 3), facade);
    hut.position.set(0, 1.5, D + 1.5);
    hut.castShadow = hut.receiveShadow = high;
    group.add(hut);
    blockers.push(hut);
    collider(-HUT, -0.95, D, D + 3, 3); collider(0.95, HUT, D, D + 3, 3);
    door(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.3 }));
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), neonMat(0xfff1c8));
    lamp.position.set(0, 2.75, D - 0.08);
    group.add(lamp);
    // Tanque de agua sobre patas y equipos de aire acondicionado (decorado, frenan)
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x7f8a8f, roughness: 0.6, metalness: 0.4 });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 28), tankMat);
    tank.position.set(-W + 2, 2.2, D - 2.2);
    group.add(tank);
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), steel); l.position.set(-W + 2 + dx, 0.65, D - 2.2 + dz); group.add(l); }
    collider(-W + 0.9, -W + 3.1, D - 3.3, D - 1.1, 3.1, false);
    for (const [x, z] of [[W - 1.6, D - 1.6], [W - 1.6, D - 3.6]]) {
      box(1.4, 1.0, 1.2, new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.7 }), x, 0.5, z);
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 20), steel);
      fan.position.set(x, 1.02, z);
      group.add(fan);
      collider(x - 0.7, x + 0.7, z - 0.6, z + 0.6, 1.0, true);
    }
    // Pórtico de luces sobre la pista, con 4 focos que siguen la música
    const TRUSS_Z = -3.5, TRUSS_Y = 4.2, TW = 5;
    for (const s of [-1, 1]) { box(0.2, TRUSS_Y, 0.2, steel, s * TW, TRUSS_Y / 2, TRUSS_Z); collider(s * TW - 0.15, s * TW + 0.15, TRUSS_Z - 0.15, TRUSS_Z + 0.15, TRUSS_Y, false); }
    box(2 * TW + 0.2, 0.25, 0.25, steel, 0, TRUSS_Y, TRUSS_Z);
    const spots = [];
    for (let i = 0; i < 4; i++) {
      const x = -3.75 + i * 2.5;
      const can = box(0.22, 0.3, 0.22, new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.6, roughness: 0.4 }), x, TRUSS_Y - 0.28, TRUSS_Z);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), neonMat(0xffffff));
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.151;
      can.add(lens);
      const light = new THREE.SpotLight(0xffffff, 0, 14, 0.45, 0.5, 1.2);
      light.position.set(x, TRUSS_Y - 0.4, TRUSS_Z);
      light.target.position.set(x * 0.5, 0, TRUSS_Z + 3);
      group.add(light, light.target);
      spots.push({ light, lens, x });
    }
    // Guirnaldas de lamparitas de lado a lado
    const bulbs = neonMat(0xffd27a);
    for (let i = 0; i < 4; i++) {
      const z = -D + 3 + i * 3.6, pts = [];
      for (let k = 0; k <= 24; k++) { const u = k / 24; pts.push(new THREE.Vector3(-W + 0.3 + (2 * W - 0.6) * u, 3.2 - Math.sin(u * Math.PI) * 0.6, z)); }
      group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.006, 4), steel));
      for (let k = 1; k < 24; k += 2) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bulbs); b.position.copy(pts[k]).setY(pts[k].y - 0.07); group.add(b); }
    }
    for (const [x, z] of [[-W, -D], [W, -D], [-W, D], [W, D]]) { box(0.1, 3.3, 0.1, steel, x, 1.65, z); }
    // El edificio debajo (para que por la baranda no se vea la terraza flotando) y el borde de la losa
    const body = new THREE.Mesh(new THREE.BoxGeometry(def.w + 0.6, 40, def.d + 0.6), new THREE.MeshStandardMaterial({ color: 0x8d877d, roughness: 0.95 }));
    body.position.set(0, -20.02, 0);
    group.add(body);
    for (const [w, d, x, z] of [[def.w + 0.6, 0.3, 0, -D - 0.15], [0.3, def.d + 0.6, -W - 0.15, 0], [0.3, def.d + 0.6, W + 0.15, 0], [def.w + 0.6, 0.3, 0, D + 0.15]]) box(w, 0.25, d, facade, x, 0.12, z);
    // La ciudad alrededor, más abajo (estamos arriba de un edificio)
    const cities = [[0, -40, 0], [0, 40, Math.PI], [-40, 0, Math.PI / 2], [40, 0, -Math.PI / 2]].map(([x, z, r]) => {
      const city = cityBackdrop(110, 34);
      city.position.set(x, -6, z);
      city.rotation.y = r;
      group.add(city);
      return city;
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 12), new THREE.MeshBasicMaterial({ color: 0x87b3e8, side: THREE.BackSide, fog: false }));
    group.add(dome);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
    sun.position.set(-10, 16, 6);
    sun.castShadow = high;
    if (high) { sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; }
    group.add(sun);
    const warm = new THREE.PointLight(0xffc27a, 0, 18, 1.4);
    warm.position.set(0, 3, 2);
    group.add(warm);
    let dayK = 1;
    timeFn = (day, golden) => {
      dayK = day;
      sun.intensity = 2.6 * day;
      sun.color.set(0xffe2b8).lerp(new THREE.Color(0xff8a4a), golden);
      hemi.intensity = 0.25 + 0.75 * day;
      dome.material.color.copy(sky.set(0x0b1236)).lerp(new THREE.Color(0x87b3e8), day).lerp(new THREE.Color(0xff9e6b), golden * 0.7);
      for (const c of cities) { c.material.color.setScalar(0.2 + 0.8 * day); c.userData.windows.opacity = 1 - day; }
      bulbs.color.set(0xffd27a).multiplyScalar(1 + 4 * (1 - day));
      warm.intensity = 8 * (1 - day);
    };
    const tmp = new THREE.Color();
    animated.push((dt, t, { music = -1, lights = null }) => {
      const p = music > 0 ? Math.min(1, music * 2.2) : 0;
      const dim = 0.35 + 0.65 * (1 - dayK); // de día los focos se notan menos
      spots.forEach((s, i) => {
        const f = lights?.focos?.[i];
        const c = lights ? (f?.color ? tmp.setRGB(...f.color) : lights.color ? tmp.setRGB(...lights.color) : tmp.setHSL((t * 0.08) % 1, 1, 0.5)) : tmp.setHSL((t * 0.05 + i * 0.25) % 1, 1, 0.55);
        const k = lights ? Math.max(0, lights.intensidad ?? 1) * (f?.intensidad ?? 1) : 0.2 + p;
        s.light.color.copy(c);
        s.light.intensity = high ? 45 * k * dim : 0;
        s.lens.material.color.copy(c).multiplyScalar(2 + 4 * k);
        s.light.target.position.set(s.x * 0.5 + (lights ? (f?.pan ?? 0) * 3 : Math.sin(t * 0.7 + i) * 2), 0, TRUSS_Z + 3 + (lights ? (f?.tilt ?? 0) * 3 : Math.cos(t * 0.6 + i) * 2));
      });
    });
  }

  // Focos de colores colgados (Taller, Galpón): siguen la música, o a la consola de artistas por OSC
  function partySpots(list, { power = 45, reach = 16 } = {}) {
    const spots = list.map(([x, y, z, tx, tz]) => {
      const can = box(0.24, 0.32, 0.24, new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.6, roughness: 0.4 }), x, y, z);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), neonMat(0xffffff));
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.161;
      can.add(lens);
      const light = new THREE.SpotLight(0xffffff, 0, reach, 0.42, 0.5, 1.2);
      light.position.set(x, y - 0.1, z);
      light.target.position.set(tx, 0, tz);
      group.add(light, light.target);
      return { light, lens, x, z, tx, tz };
    });
    const tmp = new THREE.Color();
    animated.push((dt, t, { music = -1, lights = null }) => {
      const p = music > 0 ? Math.min(1, music * 2.2) : 0;
      spots.forEach((s, i) => {
        const f = lights?.focos?.[i % 4];
        const c = lights ? (f?.color ? tmp.setRGB(...f.color) : lights.color ? tmp.setRGB(...lights.color) : tmp.setHSL((t * 0.08) % 1, 1, 0.5)) : tmp.setHSL((t * 0.05 + i * 0.17) % 1, 1, 0.55);
        const k = lights ? Math.max(0, lights.intensidad ?? 1) * (f?.intensidad ?? 1) * (1 + (lights.flash ?? 0) * 2) : 0.25 + p;
        s.light.color.copy(c);
        s.light.intensity = high ? power * k : 0;
        s.lens.material.color.copy(c).multiplyScalar(2 + 4 * k);
        s.light.target.position.set(s.tx + (lights ? (f?.pan ?? 0) * 4 : Math.sin(t * 0.7 + i) * 2.5), 0, s.tz + (lights ? (f?.tilt ?? 0) * 4 : Math.cos(t * 0.6 + i * 1.3) * 2.5));
      });
    });
    return spots;
  }

  // Cartel con texto (tutoriales del Taller)
  function board(title, lines, x, y, z, ry, w = 2.2, h = 1.5) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = Math.round(1024 * h / w);
    const g = c.getContext('2d');
    g.fillStyle = '#16161c'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ffd23f'; g.lineWidth = 14; g.strokeRect(7, 7, c.width - 14, c.height - 14);
    g.fillStyle = '#ffd23f'; g.font = '700 64px system-ui, sans-serif'; g.fillText(title, 50, 100);
    g.fillStyle = '#f2f0ea'; g.font = '36px system-ui, sans-serif';
    let yy = 175;
    for (const line of lines) {
      // Corta las líneas largas en palabras
      let cur = '';
      for (const word of line.split(' ')) {
        if (g.measureText(cur + word).width > c.width - 110 && cur) { g.fillText(cur, 50, yy); yy += 50; cur = ''; }
        cur += word + ' ';
      }
      g.fillText(cur, 50, yy);
      yy += 62;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  }

  // ---------- Taller (mapa público, 20 × 14 m): galpón de trabajo para probar OSC y modelos 3D. Consola de
  // artistas con focos que responden al OSC, pantalla, probadores de modelos y carteles con tutoriales ----------
  function buildWorkshop() {
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(concrete(), def.w / 5, def.d / 5), color: 0xa9a49b, roughness: 0.6 }));
    const brick = new THREE.MeshStandardMaterial({ map: repeatTex(brickTex(), def.w / 3, H / 1.5), roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.95 });
    wall('n', white); wall('o', brick); wall('e', brick); wall('s', brick, { door: [-0.95, 0.95] });
    door(new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.5, metalness: 0.4 }), new THREE.MeshStandardMaterial({ color: 0x2f3a48, roughness: 0.5 }));
    // Techo con cabriadas de hierro y claraboyas
    ceiling(new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9 }));
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
    for (let x = -W + 2.5; x < W; x += 5) {
      const beam = box(0.18, 0.35, def.d, steel, x, H - 0.4, 0);
      cutaway.push({ object: beam, normal: null });
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.2, def.d - 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe9ff).multiplyScalar(1.2) }));
      sky.rotation.x = Math.PI / 2;
      sky.position.set(x + 2.5, H - 0.02, 0);
      group.add(sky);
      cutaway.push({ object: sky, normal: null });
    }
    // Mesas de trabajo con herramientas, caballetes y un tablero de herramientas en la pared este
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.7 });
    for (const [x, z] of [[-2.5, -3], [1.5, -3]]) {
      box(2.4, 0.08, 1, wood, x, 0.92, z);
      for (const [dx, dz] of [[-1.1, -0.42], [1.1, -0.42], [-1.1, 0.42], [1.1, 0.42]]) box(0.07, 0.9, 0.07, steel, x + dx, 0.45, z + dz);
      box(0.5, 0.25, 0.35, new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }), x - 0.6, 1.08, z); // caja de herramientas
      box(0.6, 0.02, 0.4, new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.3 }), x + 0.5, 0.97, z - 0.1); // notebook
      collider(x - 1.2, x + 1.2, z - 0.5, z + 0.5, 0.96, true);
    }
    for (const [x, z] of [[-6.5, -4.5], [-8, -2]]) {
      const easel = new THREE.Group();
      easel.position.set(x, 0, z);
      for (const sx of [-0.35, 0.35]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), wood); leg.position.set(sx, 0.95, 0); leg.rotation.z = -sx * 0.25; easel.add(leg); }
      const canvas = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.03), white);
      canvas.position.set(0, 1.35, 0.05);
      easel.add(canvas);
      group.add(easel);
      collider(x - 0.45, x + 0.45, z - 0.3, z + 0.3, 1.8, false);
    }
    // Carteles con los tutoriales
    board('Luces por OSC', [
      '1. Corré el puente OSC en tu PC (scripts/puente-osc.js, con Node 18 o más nuevo).',
      '2. Desde TouchDesigner, Ableton/Max o Blender mandá OSC a 127.0.0.1, puerto 9000.',
      '3. E en la consola de artistas → "Tomar las luces". Los focos de acá responden.',
      'Probá: /luces/color 1 0 0.5 · /luces/flash 1 · /luces/focos/mover 0.3 -0.2',
    ], -W + 0.02, 2.4, -3.2, Math.PI / 2);
    board('Pantalla (VJ)', [
      'E en la consola de artistas → "Tomar la pantalla" y compartí una ventana o pestaña.',
      'Se ve en la pantalla del Taller (y en la del Museo o tu sala, si la tomás ahí).',
    ], -W + 0.02, 2.4, 3, Math.PI / 2, 2.2, 1.1);
    board('Modelos 3D', [
      'Archivo .glb en metros: hasta 2 MB, 10.000 triángulos, texturas de 1024 px y 3 m de alto.',
      'Probalo en los pedestales de acá (E): lo ves solo vos, a tamaño real.',
      'Si te gusta, subilo desde la Mochila → "Subir diseño" (Objeto 3D).',
    ], W - 0.02, 2.4, -4.6, -Math.PI / 2);
    board('Tus diseños', [
      'Estampas (pecho o espalda), cuadros y objetos 3D: Mochila → "Subir diseño".',
      'Solo vos hacés copias ("Copiar"); las regalás intercambiando o soltándolas al piso.',
      'Con 3 objetos 3D que pasen el control sos Diseñador.',
    ], W - 0.02, 2.4, 4.6, -Math.PI / 2);
    // Focos de prueba colgados del techo, apuntando al centro
    partySpots([[-4, H - 0.6, -1, -2, 1], [-1.3, H - 0.6, -1, -0.5, 1], [1.3, H - 0.6, -1, 0.5, 1], [4, H - 0.6, -1, 2, 1]], { power: 40 });
    hemi.color.set(0xfff4e6); hemi.groundColor.set(0x5a554e); hemi.intensity = 1.0;
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(3, 10, 2);
    group.add(key);
    for (const [x, z] of [[-5, 0], [5, 0], [0, -4], [0, 4]]) pendant(x, z);
    timeFn = (day) => { key.intensity = 0.4 + 0.9 * day; hemi.intensity = 0.7 + 0.4 * day; };
  }

  // ---------- Sala inmersiva (mapa público, 16 × 16 m): paredes, piso y techo con el video del VJ; sin VJ,
  // un dibujo que se mueve solo con la música. Sonido envolvente con cuatro parlantes ----------
  function buildImmersive() {
    // Superficies que proyectan: un material compartido con el video (o el dibujo de espera)
    const idleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBeat: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uBeat;
        vec3 pal(float t) { return 0.45 + 0.45 * cos(6.2831 * (vec3(0.55, 0.62, 0.78) + t * vec3(1.0, 0.8, 0.6))); }
        void main() {
          vec2 p = vUv * 6.0;
          float v = sin(p.x + uTime * 0.6) + sin(p.y * 1.3 - uTime * 0.4) + sin((p.x + p.y) * 0.7 + uTime * 0.5) + sin(length(p - 3.0) * 2.0 - uTime);
          float lines = smoothstep(0.92, 1.0, sin(v * 6.0) * 0.5 + 0.5);
          vec3 col = pal(v * 0.12 + uTime * 0.02) * (0.18 + 0.45 * uBeat) + lines * 0.25 * pal(uTime * 0.05 + 0.3);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const videoMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const surfaces = [];
    const surface = (w, h, x, y, z, rx, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), idleMat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      group.add(m);
      surfaces.push(m);
      return m;
    };
    const fl = surface(def.w, def.d, 0, 0.001, 0, -Math.PI / 2, 0);
    fl.receiveShadow = true;
    surface(def.w, def.d, 0, H - 0.01, 0, Math.PI / 2, 0);
    const E = 0.01; // un poco adelante de las paredes (si no, titilan)
    surface(def.w, H, 0, H / 2, -D + E, 0, 0);
    surface(def.d, H, -W + E, H / 2, 0, 0, Math.PI / 2);
    surface(def.d, H, W - E, H / 2, 0, 0, -Math.PI / 2);
    // Pared sur: la de la entrada (con la puerta), también proyecta a los costados
    surface(W - 0.95, H, -(W + 0.95) / 2, H / 2, D - E, 0, Math.PI);
    surface(W - 0.95, H, (W + 0.95) / 2, H / 2, D - E, 0, Math.PI);
    surface(1.9, H - 2.4, 0, 2.4 + (H - 2.4) / 2, D - E, 0, Math.PI);
    // Paredes de verdad detrás (frenan y sostienen la puerta)
    const black = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 1 });
    wall('n', black); wall('o', black); wall('e', black); wall('s', black, { door: [-0.95, 0.95] });
    door(new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.5 }));
    hemi.color.set(0x8080a0); hemi.groundColor.set(0x101018); hemi.intensity = 0.25;
    let videoTex = null;
    videoFn = (video) => {
      videoTex?.dispose();
      videoTex = null;
      if (video) {
        videoTex = new THREE.VideoTexture(video);
        videoTex.colorSpace = THREE.SRGBColorSpace;
        videoMat.map = videoTex;
        videoMat.needsUpdate = true;
      }
      for (const m of surfaces) m.material = video ? videoMat : idleMat;
    };
    animated.push((dt, t, { music = -1 }) => {
      idleMat.uniforms.uTime.value = t;
      const beat = music > 0 ? Math.min(1, music * 2.5) : 0.35;
      idleMat.uniforms.uBeat.value += (beat - idleMat.uniforms.uBeat.value) * Math.min(1, dt * 8);
    });
    // Un poco de luz que sale de las proyecciones
    const glow = new THREE.PointLight(0xb0a0ff, 6, 20, 1.2);
    glow.position.set(0, H - 1, 0);
    group.add(glow);
  }

  // ---------- Galpón / rave (mapa público, 32 × 22 m, 10 m de alto): nave industrial oscura. Escenario al norte
  // con cabina y pantalla gigante, consola al fondo con otra pantalla, estructura de hierro con focos que
  // siguen la música (o el OSC), conos de luz en el humo y tiras de LED ----------
  function buildRave() {
    floor(new THREE.MeshStandardMaterial({ map: repeatTex(concrete(), def.w / 6, def.d / 6), color: 0x55555c, roughness: 0.3, metalness: 0.1 }));
    const dark = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
    wall('n', dark); wall('o', dark); wall('e', dark); wall('s', dark, { door: [-0.95, 0.95] });
    door(steel, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.4 }));
    ceiling(new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 1 }));
    // Escenario al norte (se sube por los costados)
    box(14, 0.8, 5, steel, 0, 0.4, -D + 2.5);
    collider(-7, 7, -D, -D + 5, 0.8, true);
    // Cabriadas de hierro a lo largo del techo
    for (let x = -W + 3; x < W; x += 5.2) {
      const beam = box(0.25, 0.5, def.d, steel, x, H - 0.8, 0);
      cutaway.push({ object: beam, normal: null });
    }
    // Estructura de luces (truss) sobre la pista: dos vigas con 6 focos cada una
    const trussY = 7;
    for (const z of [-4, 3]) {
      box(24, 0.35, 0.35, steel, 0, trussY, z);
      for (const s of [-1, 1]) { box(0.35, trussY, 0.35, steel, s * 12, trussY / 2, z); collider(s * 12 - 0.2, s * 12 + 0.2, z - 0.2, z + 0.2, trussY, false); }
    }
    const spotList = [];
    for (const z of [-4, 3]) for (let i = 0; i < 6; i++) { const x = -10 + i * 4; spotList.push([x, trussY - 0.3, z, x * 0.6, z + (z < 0 ? 3 : -3)]); }
    const spots = partySpots(spotList, { power: 70, reach: 22 });
    // Conos de luz en el humo (se ven los haces)
    const coneGeo = new THREE.ConeGeometry(1.6, trussY - 0.4, 24, 1, true).translate(0, -(trussY - 0.4) / 2, 0);
    const beams = spots.map((s) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.position.set(s.x, trussY - 0.35, s.z);
      cone.castShadow = false;
      group.add(cone);
      return { cone, s };
    });
    const up = new THREE.Vector3(0, -1, 0), dir = new THREE.Vector3();
    animated.push(() => {
      for (const { cone, s } of beams) {
        dir.copy(s.light.target.position).sub(cone.position).normalize();
        cone.quaternion.setFromUnitVectors(up, dir);
        cone.material.color.copy(s.light.color);
        cone.material.opacity = Math.min(0.16, s.light.intensity / 70 * 0.12);
      }
    });
    // Tiras de LED alrededor del techo y del borde del escenario
    const led = neonMat(0xff4fd8);
    for (const w of walls) {
      const len = w.max - w.min;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w.along === 'x' ? len : 0.05, 0.05, w.along === 'x' ? 0.05 : len), led);
      strip.position.copy(w.point).addScaledVector(w.normal, 0.04).setY(H - 1.6);
      group.add(strip);
    }
    box(14, 0.05, 0.05, led, 0, 0.78, -D + 5.03).castShadow = false;
    const tmp = new THREE.Color();
    animated.push((dt, t, { music = -1, lights = null }) => {
      const p = music > 0 ? Math.min(1, music * 2.2) : 0;
      if (lights?.leds?.color) led.color.setRGB(...lights.leds.color).multiplyScalar(5 * (lights.intensidad ?? 1));
      else led.color.copy(tmp.setHSL((t * 0.06) % 1, 1, 0.5)).multiplyScalar(4 * (0.4 + p));
    });
    hemi.color.set(0x9080ff); hemi.groundColor.set(0x100c18); hemi.intensity = 0.3;
    const wash = new THREE.PointLight(0xff4fd8, 6, 30, 1.2);
    wash.position.set(0, H - 2, 0);
    group.add(wash);
    animated.push((dt, t, { music = -1 }) => {
      const p = music > 0 ? Math.min(1, music * 2.2) : 0;
      wash.color.setHSL((t * 0.05 + 0.5) % 1, 0.8, 0.5);
      wash.intensity = 4 + 14 * p;
    });
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
    id, def, group, colliders, blockers, walls, cutaway, exits,
    bounds: { minY: 0.2, maxY: def.h ? def.h - 0.2 : 30 },
    spawn: { x: 0, z: D - (id === 'plaza' ? 3 : 1), yaw: 0 }, // en la puerta, mirando hacia adentro
    setTime(hours) {
      const elev = Math.sin(((hours - 6.5) / 13) * Math.PI);
      const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
      const golden = day * (1 - THREE.MathUtils.smoothstep(elev, 0.1, 0.45));
      timeFn(day, golden);
    },
    update(dt, t, state) { for (const fn of animated) fn(dt, t, state); },
    setVideo(video) { videoFn(video); },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material ?? [])) { m.map?.dispose(); m.dispose(); }
      });
    },
  };
}

// Baldosas blanco y negro (Cafetería): 2 × 2 baldosas por repetición
function checkerTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? '#1b1b1d' : '#ece8df';
    g.fillRect(i * 128, j * 128, 128, 128);
  }
  g.strokeStyle = 'rgba(120,110,100,0.5)';
  g.lineWidth = 2;
  for (let k = 0; k <= 256; k += 128) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.moveTo(0, k); g.lineTo(256, k); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Letras doradas en el ventanal y la pizarra del menú (Cafetería)
function cafeSign() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#d4a74a';
  g.font = 'italic 700 120px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Café', 512, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function menuTex() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 330;
  const g = c.getContext('2d');
  g.fillStyle = '#20241f';
  g.fillRect(0, 0, 512, 330);
  g.strokeStyle = '#6b4a2b';
  g.lineWidth = 18;
  g.strokeRect(0, 0, 512, 330);
  g.fillStyle = '#efeadd';
  g.textAlign = 'center';
  g.font = '700 44px Georgia, serif';
  g.fillText('Hoy', 256, 70);
  g.font = '28px Georgia, serif';
  ['Cortado', 'Café con leche', 'Lágrima', 'Medialunas'].forEach((s, i) => g.fillText(s, 256, 130 + i * 46));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cartel del portón de la Plaza
function plazaSign() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 100;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e2d0';
  g.font = '700 70px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P L A Z A', 512, 54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
