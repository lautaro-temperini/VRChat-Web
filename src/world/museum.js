import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { lightPool, painting, plaque, artistsSign, boothSign, concrete, collage, rng } from './textures.js';
import { artworkInfo, SCULPTURES } from './artworks.js';
import { mergeStatic } from './merge.js';

// Sala principal (48 × 22 m), de oeste a este:
//   x -30..-6  hall: puerta doble de entrada, barra (sur), baño que sobresale (norte),
//              esculturas junto a la pared del medio, escaleras al balcón (norte y sur)
//   x  -6..18  pista: paredes negras, balcón en U (2º piso) sobre tres paredes, cabina de VJ y
//              luces abajo del balcón oeste, escenario con DJ y una pantalla que ocupa toda la pared este
const X0 = -30, X1 = 18, Z0 = -11, Z1 = 11, H = 7, T = 0.4;
const XP = -6;                        // pared del medio: el hall al oeste, la pista al este
const BY = 3.5, BT = 0.25;            // balcón: altura del piso y espesor de la losa
const BX = 12, BZ = 7.5, BW = -1;     // balcón: franjas norte/sur hasta x = 12 (|z| > 7,5) y franja oeste hasta x = -1
// Tragaluz: abertura en el techo del hall, por donde entra el sol (termina antes de la pista)
const SX0 = -27, SX1 = -7.5, SZ = 2.6, WELL = 1.4, BAY = 1.8;
const SUN_FROM = new THREE.Vector3(-6, 12, 5);
// Baño: sobresale al norte del hall
const WC = { x0: -22, x1: -15, z0: -17, door0: -19.6, door1: -17.6, h: 3.2 };
// Neón: color por encima de 1 para que el bloom (umbral alto) brille solo en estas piezas
const GLOW = 5;

export function buildMuseum(scene, renderer, quality) {
  const colliders = [];     // cajas en el plano XZ con altura (top) y, si flotan, base (bottom)
  const blockers = [];      // mallas que frenan la cámara en tercera persona
  const interactables = []; // cosas con las que se interactúa con E
  const animated = [];      // funciones (dt, t) que se llaman cada frame
  const high = quality === 'high';
  const rand = rng(42);

  // ---------- Luz y ambiente ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.background = new THREE.Color(0x0d0d0f);
  const hemi = new THREE.HemisphereLight(0xfff1e0, 0x6a5040, high ? 0.85 : 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe2b8, high ? 3 : 1.6);
  sun.target.position.set(-6, 0, 0);
  sun.position.copy(SUN_FROM).add(sun.target.position);
  scene.add(sun.target);
  if (high) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 20, bottom: -20, near: 1, far: 50 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);

  // ---------- Materiales ----------
  const concreteTex = concrete();
  const floorMat = (w, d) => {
    const t = concreteTex.clone();
    t.repeat.set(w / 6, d / 6);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.22, metalness: 0.05 });
  };
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.95 });
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2c1b, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.55, metalness: 0.2 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a74a, roughness: 0.25, metalness: 1 });
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.3 });
  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.85 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false });
  const fabricMat = new THREE.MeshStandardMaterial({ color: 0x2f3a48, roughness: 0.95 });
  const porcelainMat = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.15 });
  const frameMats = [
    new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.28, metalness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35 }),
  ];
  const neon = (hex) => { const m = new THREE.MeshBasicMaterial({ toneMapped: false }); m.color.set(hex).multiplyScalar(GLOW); return m; };

  // opts: collide (choca), float (choca solo a su altura: se puede pasar por debajo), block (frena la cámara),
  //       climb (se puede trepar), round (bordes redondeados), cast (sombra)
  function box(w, h, d, x, y, z, mat, opts = {}) {
    const geo = opts.round ? new RoundedBoxGeometry(w, h, d, 4, opts.round) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = high && (opts.cast ?? true);
    m.receiveShadow = high;
    scene.add(m);
    if (opts.collide) {
      collider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + h / 2, opts.climb, opts.float ? y - h / 2 : undefined);
      // noStand: obras y cabinas, para que nadie se pare encima ni saltando
      if (opts.noStand) Object.assign(colliders[colliders.length - 1], { climb: false, noStand: true });
    }
    if (opts.block) blockers.push(m);
    return m;
  }
  function collider(minX, maxX, minZ, maxZ, top, climb = true, bottom) {
    colliders.push({ minX, maxX, minZ, maxZ, top, climb, bottom });
  }
  function interactive(object, data) {
    const item = { object, ...data };
    object.traverse((o) => { o.userData.interact = item; });
    interactables.push(item);
    return item;
  }
  function plane(w, h, mat, x, y, z, rotY = 0, rotX = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rotX, rotY, 0, 'YXZ');
    m.receiveShadow = high;
    scene.add(m);
    return m;
  }

  // ---------- Piso: cemento pulido ----------
  plane(X1 - X0, Z1 - Z0, floorMat(X1 - X0, Z1 - Z0), (X0 + X1) / 2, 0, 0, 0, -Math.PI / 2);

  // ---------- Techo: claro en el hall (con tragaluz), negro sobre la pista ----------
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d6, roughness: 1 });
  const ceilBlack = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 1 });
  function ceiling(x0, x1, z0, z1, mat) {
    const m = plane(x1 - x0, z1 - z0, mat, (x0 + x1) / 2, H, (z0 + z1) / 2, 0, Math.PI / 2);
    m.castShadow = high; // tapa el sol: solo entra por el tragaluz
  }
  ceiling(X0, XP, Z0, -SZ, ceilMat);
  ceiling(X0, XP, SZ, Z1, ceilMat);
  ceiling(X0, SX0, -SZ, SZ, ceilMat);
  ceiling(SX1, XP, -SZ, SZ, ceilMat);
  ceiling(XP, X1, Z0, Z1, ceilBlack);

  const wellX = (SX0 + SX1) / 2, wellW = SX1 - SX0;
  box(wellW, WELL, 0.1, wellX, H + WELL / 2, -SZ - 0.05, trimMat);
  box(wellW, WELL, 0.1, wellX, H + WELL / 2, SZ + 0.05, trimMat);
  box(0.1, WELL, SZ * 2, SX0 - 0.05, H + WELL / 2, 0, trimMat);
  box(0.1, WELL, SZ * 2, SX1 + 0.05, H + WELL / 2, 0, trimMat);
  const sky = plane(wellW, SZ * 2, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd6e8ff).multiplyScalar(1.5) }), wellX, H + WELL, 0, 0, Math.PI / 2);
  for (let x = SX0 + BAY; x < SX1 - 0.1; x += BAY) box(0.09, 0.14, SZ * 2, x, H + WELL - 0.12, 0, steelMat, { round: 0.02 });
  box(wellW, 0.14, 0.09, wellX, H + WELL - 0.12, 0, steelMat, { round: 0.02 });

  // Haz de luz del sol: una caja inclinada con un shader que se desvanece (sutil)
  const sunDir = SUN_FROM.clone().normalize().negate();
  const shaftLen = (H + WELL) / -sunDir.y;
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(wellW, shaftLen, SZ * 2),
    new THREE.ShaderMaterial({
      uniforms: { L: { value: shaftLen }, W: { value: wellW }, D: { value: SZ * 2 }, bay: { value: BAY }, opacity: { value: 0.04 }, color: { value: new THREE.Color(0xffe6bf) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float L, W, D, bay, opacity; uniform vec3 color; varying vec3 vP;
        void main(){
          float fy = pow(clamp(vP.y / L + 0.5, 0.0, 1.0), 1.6);
          float fz = 1.0 - smoothstep(0.55, 1.0, abs(vP.z) / (D * 0.5));
          float fw = 1.0 - smoothstep(0.85, 1.0, abs(vP.x) / (W * 0.5));
          float m = mod(vP.x + W * 0.5, bay);
          float fx = smoothstep(0.05, 0.35, m) * (1.0 - smoothstep(bay - 0.35, bay - 0.05, m));
          gl_FragColor = vec4(color, opacity * fy * fz * fw * fx);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  shaft.position.set(wellX, H + WELL, 0).addScaledVector(sunDir, shaftLen / 2);
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir.clone().negate());
  scene.add(shaft);

  // Un poco de polvo en el aire, solo en calidad alta
  if (high) {
    const dustCount = 150;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) dustPos.set([SX0 + rand() * (wellW + 4), 0.3 + rand() * 6.5, -6 + rand() * 9], i * 3);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const dg = dot.getContext('2d');
    const grd = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grd;
    dg.fillRect(0, 0, 32, 32);
    scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.022, map: new THREE.CanvasTexture(dot), color: 0xfff0d6, transparent: true, opacity: 0.3,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    animated.push((dt, t) => {
      for (let i = 0; i < dustCount; i++) {
        const k = i * 3;
        dustPos[k] += Math.sin(t * 0.3 + i) * 0.03 * dt;
        dustPos[k + 1] += (0.04 + Math.sin(i) * 0.03) * dt;
        dustPos[k + 2] += Math.cos(t * 0.25 + i * 1.7) * 0.03 * dt;
        if (dustPos[k + 1] > 6.8) dustPos[k + 1] = 0.3;
      }
      dustGeo.attributes.position.needsUpdate = true;
    });
  }

  // ---------- Paredes ----------
  const wall = { collide: true, block: true, cast: false, climb: false };
  // Norte: con el hueco de la puerta del baño
  box(WC.door0 - X0 + T, H, T, (X0 - T + WC.door0) / 2, H / 2, Z0 - T / 2, wallMat, wall);
  box(X1 + T - WC.door1, H, T, (WC.door1 + X1 + T) / 2, H / 2, Z0 - T / 2, wallMat, wall);
  box(WC.door1 - WC.door0, H - 2.5, T, (WC.door0 + WC.door1) / 2, 2.5 + (H - 2.5) / 2, Z0 - T / 2, wallMat, { cast: false });
  box(X1 - X0 + 2 * T, H, T, (X0 + X1) / 2, H / 2, Z1 + T / 2, wallMat, wall); // sur
  box(T, H, Z1 - Z0, X0 - T / 2, H / 2, 0, wallMat, wall);                     // oeste
  box(T, H, Z1 - Z0, X1 + T / 2, H / 2, 0, wallMat, wall);                     // este

  // Pista: paredes negras de piso a techo
  for (const z of [Z0 + 0.012, Z1 - 0.012]) box(X1 - XP, H, 0.02, (XP + X1) / 2, H / 2, z, blackMat, { cast: false });

  // Hall: boiserie de madera, moldura y cornisa (el grosor va hacia adentro)
  const hallW = XP - X0, hallX = (X0 + XP) / 2;
  for (const [x, z, alongX, len] of [[hallX, Z0, true, hallW], [hallX, Z1, true, hallW], [X0, 0, false, Z1 - Z0]]) {
    const piece = (h, y, thick, mat, round) => {
      const inward = (alongX ? -Math.sign(z) : -Math.sign(x)) * thick / 2;
      box(alongX ? len : thick, h, alongX ? thick : len, alongX ? x : x + inward, y, alongX ? z + inward : z, mat, { cast: false, round });
    };
    piece(1, 0.5, 0.04, woodMat);
    piece(0.06, 1.03, 0.07, woodMat, 0.025);
    piece(0.18, H - 0.09, 0.14, trimMat, 0.04);
  }

  // Puerta doble de entrada (pared oeste)
  {
    const x = X0 + 0.03, w = 2.8, h = 3.1;
    box(0.1, h + 0.2, 0.18, x, (h + 0.2) / 2, -w / 2 - 0.09, darkMat, { cast: false });
    box(0.1, h + 0.2, 0.18, x, (h + 0.2) / 2, w / 2 + 0.09, darkMat, { cast: false });
    box(0.1, 0.2, w + 0.36, x, h + 0.1, 0, darkMat, { cast: false });
    const doorGlass = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.6, emissive: 0x6f8aa0, emissiveIntensity: 0.25 });
    for (const s of [-1, 1]) {
      box(0.06, h, w / 2 - 0.04, x + 0.02, h / 2, s * (w / 4 + 0.01), doorGlass, { cast: false });
      box(0.07, h, 0.08, x + 0.02, h / 2, s * (w / 2 - 0.04), darkMat, { cast: false });
      box(0.07, h, 0.06, x + 0.02, h / 2, s * 0.04, darkMat, { cast: false });
      box(0.05, 1.1, 0.04, x + 0.09, 1.15, s * 0.16, brassMat, { cast: false, round: 0.015 });
    }
  }

  // Pared del medio (hasta la losa del balcón; cuadros del lado del hall)
  box(0.3, BY - BT, 9, XP, (BY - BT) / 2, 0, wallMat, { collide: true, block: true, climb: false });
  box(0.02, BY - BT, 9, XP + 0.16, (BY - BT) / 2, 0, blackMat, { cast: false });

  // Columnas de mármol acanaladas en el hall
  const shaftGeo = new THREE.CylinderGeometry(0.25, 0.27, H - 0.75, 160, 1, true);
  {
    const p = shaftGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x);
      const k = 1 - 0.07 * Math.pow(0.5 + 0.5 * Math.cos(a * 20), 6);
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    shaftGeo.computeVertexNormals();
  }
  const ringGeo = new THREE.TorusGeometry(0.29, 0.045, 12, 48).rotateX(Math.PI / 2);
  for (const x of [-25, -16.5]) {
    for (const z of [-6.6, 6.6]) {
      box(0.8, 0.22, 0.8, x, 0.11, z, marbleMat, { round: 0.03 });
      const ring = new THREE.Mesh(ringGeo, marbleMat);
      ring.position.set(x, 0.27, z);
      const col = new THREE.Mesh(shaftGeo, marbleMat);
      col.position.set(x, 0.22 + (H - 0.75) / 2 + 0.05, z);
      const ringTop = new THREE.Mesh(ringGeo, marbleMat);
      ringTop.position.set(x, H - 0.5, z);
      for (const m of [ring, col, ringTop]) { m.castShadow = m.receiveShadow = high; scene.add(m); }
      blockers.push(col);
      box(0.74, 0.3, 0.74, x, H - 0.2, z, marbleMat, { round: 0.03 });
      collider(x - 0.4, x + 0.4, z - 0.4, z + 0.4, H, false);
    }
  }

  // ---------- Cuadros del hall (con marco biselado y foco en el techo) ----------
  const pool = lightPool();
  const poolMat = new THREE.MeshBasicMaterial({ map: pool, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  const spotGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.18, 20).rotateX(Math.PI / 2);
  const spotLens = new THREE.MeshBasicMaterial({ color: 0xfff2d8 });

  function frameGeo(w, h, b = 0.085) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - b, -h / 2 - b); s.lineTo(w / 2 + b, -h / 2 - b); s.lineTo(w / 2 + b, h / 2 + b); s.lineTo(-w / 2 - b, h / 2 + b); s.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-w / 2, -h / 2); hole.lineTo(-w / 2, h / 2); hole.lineTo(w / 2, h / 2); hole.lineTo(w / 2, -h / 2); hole.closePath();
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 4, curveSegments: 1 });
  }

  // Lugares del Museo rotativo: cada cuadro y cada pedestal puede mostrar una obra del público
  // (setWork) y vuelve a la obra de siempre cuando no hay ninguna (setWork(null))
  const paintingSlots = [], sculptureSlots = [];
  const FIT_W = 2.6, FIT_H = 1.9; // tamaño máximo de un cuadro del público en la pared

  let artId = 1;
  function hangArt(x, z, rotY, railOffset, y = 2.15) {
    const w = 1.5 + rand() * 1.1, h = 1.1 + rand() * 0.8;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, h * 2), poolMat);
    glow.position.set(0, 0.25, 0.006);
    g.add(glow);
    const frame = new THREE.Mesh(frameGeo(w, h), frameMats[artId % 3]);
    frame.position.z = 0.025;
    frame.castShadow = high;
    g.add(frame);
    const tex = painting(artId, w, h);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, emissive: 0xffffff, emissiveIntensity: 0.05 }));
    art.position.z = 0.045;
    g.add(art);
    const info = artworkInfo(artId);
    const label = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.11, 0.012, 2, 0.004), [
      ...Array(4).fill(trimMat), new THREE.MeshStandardMaterial({ map: plaque(info.title.slice(0, 18), `${info.author} · ${info.year}`), roughness: 0.9 }), trimMat,
    ]);
    label.position.set(w / 2 + 0.32, -0.35, 0.01);
    g.add(label);
    scene.add(g);
    const item = interactive(g, { kind: 'art', prompt: 'Ver obra', info, image: tex.image });
    // Lugar rotativo: cambia imagen, tamaño del marco y ficha
    const base = { w, h, tex, info, label: label.material[4].map };
    const slot = {
      group: g,
      setWork(work, image) {
        let ww = base.w, hh = base.h;
        if (work) {
          const a = (work.w && work.h) ? work.w / work.h : (image.width / image.height);
          ww = Math.min(FIT_W, FIT_H * a); hh = ww / a;
        }
        for (const [m, geo] of [[frame, frameGeo(ww, hh)], [art, new THREE.PlaneGeometry(ww, hh)], [glow, new THREE.PlaneGeometry(ww * 2, hh * 2)]]) { m.geometry.dispose(); m.geometry = geo; }
        label.position.x = ww / 2 + 0.32;
        if (art.material.map !== base.tex) art.material.map.dispose();
        if (label.material[4].map !== base.label) label.material[4].map.dispose();
        if (work) {
          const t = new THREE.Texture(image);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          t.needsUpdate = true;
          art.material.map = t;
          label.material[4].map = plaque(work.title.slice(0, 18), `${work.author?.name ?? ''}${work.year ? ` · ${work.year}` : ''}`);
          item.info = { title: work.title, author: work.author?.name ?? '', year: work.year, technique: work.technique, description: work.description, link: work.link };
          item.image = null;
          item.work = work;
        } else {
          art.material.map = base.tex;
          label.material[4].map = base.label;
          Object.assign(item, { info: base.info, image: base.tex.image, work: null });
        }
        art.material.needsUpdate = true;
        label.material[4].needsUpdate = true;
      },
    };
    paintingSlots.push(slot);
    if (railOffset) {
      // Foco colgado del riel, apuntando al cuadro
      const head = new THREE.Mesh(spotGeo, steelMat);
      const out = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      head.position.set(x + out.x * railOffset, H - 0.2, z + out.z * railOffset);
      head.lookAt(x, 2.4, z);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), spotLens);
      lens.position.z = 0.091;
      head.add(lens);
      scene.add(head);
    }
    artId++;
  }
  for (const x of [-26.8, -23.6, -14.6]) hangArt(x, Z0 + 0.03, 0, 1.4);
  for (const x of [-27, -13.4]) hangArt(x, Z1 - 0.03, Math.PI, 1.4);
  for (const z of [-6.4, 6.4]) hangArt(X0 + 0.03, z, Math.PI / 2, 1.4);
  for (const z of [-2.2, 2.2]) hangArt(XP - 0.16, z, -Math.PI / 2, 0, 1.75);
  box(XP - X0, 0.04, 0.05, hallX, H - 0.08, Z0 + 1.4, steelMat, { cast: false, round: 0.015 });
  box(XP - X0, 0.04, 0.05, hallX, H - 0.08, Z1 - 1.4, steelMat, { cast: false, round: 0.015 });

  // ---------- Plantas (solo en el hall) ----------
  const potMat = new THREE.MeshStandardMaterial({ color: 0xc4683f, roughness: 0.8 });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 1 });
  const leafMats = [0x3f8a3a, 0x2f6e2c, 0x58a548].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, side: THREE.DoubleSide }));
  const potGeo = new THREE.LatheGeometry([[0, 0], [0.19, 0], [0.22, 0.04], [0.25, 0.44], [0.25, 0.48], [0.235, 0.48], [0.22, 0.45], [0, 0.45]].map(([r, y]) => new THREE.Vector2(r, y)), 48);
  const rimGeo = new THREE.TorusGeometry(0.255, 0.022, 10, 48).rotateX(Math.PI / 2);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.11, 0.1, 0.1, 0.32, 0, 0.48);
  leafShape.bezierCurveTo(-0.1, 0.32, -0.11, 0.1, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(leafShape, 12);
  {
    const p = leafGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, 0.9 * y * y - 0.35 * Math.abs(x));
    }
    leafGeo.computeVertexNormals();
  }
  function plant(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pot = new THREE.Mesh(potGeo, potMat);
    const rim = new THREE.Mesh(rimGeo, potMat);
    rim.position.y = 0.48;
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), soilMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.44;
    g.add(pot, rim, soil);
    const s = 0.95 + rand() * 0.5;
    for (let i = 0; i < 16; i++) {
      const pivot = new THREE.Group();
      pivot.position.y = 0.45;
      pivot.rotation.y = i * 2.39996 + rand() * 0.3;
      const tilt = new THREE.Group();
      tilt.rotation.x = 0.15 + (i / 16) * 0.9 + rand() * 0.2;
      pivot.add(tilt);
      const leaf = new THREE.Mesh(leafGeo, leafMats[i % 3]);
      leaf.scale.setScalar(s * (1.15 - (i / 16) * 0.4));
      tilt.add(leaf);
      g.add(pivot);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = high; });
    scene.add(g);
    collider(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 1.2, false);
  }
  for (const [x, z] of [[-29.3, -10.3], [-29.3, 10.3], [-29.2, -2.1], [-29.2, 2.1], [-6.9, -5.3], [-6.9, 5.3], [-12.9, -10.3]]) plant(x, z);

  // ---------- Esculturas (del lado del hall de la pared del medio) ----------
  const sculptures = [];
  function pedestal(x, z, w, h, mesh, lift, key, maxH = 1.3) {
    const body = box(w, h - 0.05, w, x, (h - 0.05) / 2, z, pedestalMat, { collide: true, block: true, round: 0.025, noStand: true });
    const cap = box(w + 0.06, 0.05, w + 0.06, x, h - 0.025, z, pedestalMat, { round: 0.02 });
    mesh.position.set(x, h + lift, z);
    mesh.castShadow = high;
    scene.add(mesh);
    sculptures.push(mesh);
    const item = interactive(mesh, { kind: 'art', prompt: 'Ver escultura', info: SCULPTURES[key] });
    body.userData.interact = item;
    cap.userData.interact = item;
    // Lugar rotativo: el modelo del público se achica para entrar en el pedestal (sin agrandarlo)
    let current = mesh;
    sculptureSlots.push({
      setWork(work, object) {
        current.removeFromParent();
        sculptures.splice(sculptures.indexOf(current), 1);
        if (current !== mesh) current.traverse((o) => { o.geometry?.dispose(); });
        if (work) {
          const holder = new THREE.Group();
          const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
          const k = Math.min(1, (w * 0.95) / Math.max(size.x, size.z, 1e-3), maxH / Math.max(size.y, 1e-3));
          object.scale.multiplyScalar(k);
          const box3 = new THREE.Box3().setFromObject(object);
          object.position.sub(box3.getCenter(new THREE.Vector3())).setY(object.position.y - box3.min.y);
          holder.add(object);
          holder.position.set(x, h, z);
          holder.traverse((o) => { if (o.isMesh) o.castShadow = high; o.userData.interact = item; });
          current = holder;
          item.info = { title: work.title, author: work.author?.name ?? '', year: work.year, technique: work.technique, description: work.description, link: work.link };
          item.work = work;
        } else {
          current = mesh;
          item.info = SCULPTURES[key];
          item.work = null;
        }
        item.object = current;
        scene.add(current);
        sculptures.push(current);
      },
    });
  }
  pedestal(-11.6, -3.2, 0.8, 1, new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.24, 0.075, 260, 32),
    new THREE.MeshStandardMaterial({ color: 0xd4a74a, metalness: 1, roughness: 0.22 }),
  ), 0.4, 'knot');
  pedestal(-11.6, 3.2, 0.8, 1, new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.33, 0),
    new THREE.MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.35, clearcoat: 1, flatShading: true }),
  ), 0.36, 'ico');
  const vaseProfile = [];
  for (let i = 0; i <= 40; i++) {
    const v = i / 40;
    vaseProfile.push(new THREE.Vector2(0.12 + Math.sin(v * Math.PI * 1.2) * 0.16 + v * 0.03, v * 0.7));
  }
  pedestal(-7.6, -3.2, 0.8, 1, new THREE.Mesh(
    new THREE.LatheGeometry(vaseProfile, 64),
    new THREE.MeshStandardMaterial({ color: 0xa0612f, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }),
  ), 0, 'vase');
  pedestal(-7.6, 3.2, 0.8, 1, new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 }),
  ), 0.3, 'sphere');
  const colGeo = new THREE.BoxGeometry(0.5, 2.4, 0.5, 1, 80, 1);
  {
    const pos = colGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), a = (y + 1.2) * 1.3;
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
    }
    colGeo.computeVertexNormals();
  }
  const CX = -9.6;
  pedestal(CX, 0, 1.2, 0.5, new THREE.Mesh(colGeo, new THREE.MeshPhysicalMaterial({ color: 0x101012, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 })), 1.2, 'column', 2.4);
  animated.push((dt) => { for (const s of sculptures) s.rotation.y += dt * 0.25; });
  // Sogas de terciopelo alrededor de la columna
  const velvet = new THREE.MeshStandardMaterial({ color: 0x8a1020, roughness: 0.7 });
  const R = 1.05, posts = [[-R, -R], [R, -R], [R, R], [-R, R]].map(([dx, dz]) => new THREE.Vector3(CX + dx, 0, dz));
  for (const p of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 16), brassMat);
    post.position.set(p.x, 0.45, p.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.04, 32), brassMat);
    base.position.set(p.x, 0.02, p.z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), brassMat);
    ball.position.set(p.x, 0.92, p.z);
    scene.add(post, base, ball);
  }
  posts.forEach((a, i) => {
    const b = posts[(i + 1) % 4];
    const mid = a.clone().lerp(b, 0.5);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(a.x, 0.86, a.z), new THREE.Vector3(mid.x, 0.6, mid.z), new THREE.Vector3(b.x, 0.86, b.z)]);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.022, 10), velvet);
    rope.castShadow = high;
    scene.add(rope);
  });
  collider(CX - R, CX + R, -R, R, 1, false);

  // ---------- Asientos (E para sentarse) ----------
  // seats: [{ x, y, z, yaw }] (yaw 0 = mirando a +z)
  function sofa(x, y, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const add = (w, h, d, px, py, pz, mat, round = 0.06) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, round), mat);
      m.position.set(px, py, pz);
      m.castShadow = high;
      g.add(m);
    };
    add(2.4, 0.3, 0.95, 0, 0.17, 0, darkMat, 0.04);
    add(2.1, 0.16, 0.8, 0, 0.4, 0.06, fabricMat);
    add(2.4, 0.55, 0.22, 0, 0.6, -0.38, fabricMat);
    for (const s of [-1, 1]) add(0.2, 0.42, 0.95, s * 1.12, 0.45, 0, fabricMat);
    g.userData.mergeable = true; // no se mueve: se dibuja junto con el resto (ver merge.js)
    scene.add(g);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const hw = Math.abs(cos) * 1.2 + Math.abs(sin) * 0.48, hd = Math.abs(sin) * 1.2 + Math.abs(cos) * 0.48;
    collider(x - hw, x + hw, z - hd, z + hd, y + 0.48, true, y);
    const seats = [-0.7, 0, 0.7].map((d) => ({ x: x + cos * d + sin * 0.1, y, z: z - sin * d + cos * 0.1, yaw }));
    interactive(g, { kind: 'sit', prompt: 'Sentarse', seats });
  }
  const stoolSeatMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.5 });
  function stool(x, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 16), steelMat);
    leg.position.y = 0.36;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 32), steelMat);
    foot.position.y = 0.015;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 32).rotateX(Math.PI / 2), steelMat);
    ring.position.y = 0.3;
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.07, 32), stoolSeatMat);
    seat.position.y = 0.74;
    for (const m of [leg, foot, ring, seat]) { m.castShadow = high; g.add(m); }
    g.userData.mergeable = true;
    scene.add(g);
    collider(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 0.78);
    interactive(g, { kind: 'sit', prompt: 'Sentarse', seats: [{ x, y: 0.3, z, yaw }] });
  }

  // ---------- Barra (sur del hall) con banquetas ----------
  {
    const x0 = -24, x1 = -15, cx = (x0 + x1) / 2, w = x1 - x0;
    box(w, 1.05, 0.7, cx, 0.525, 9.7, woodMat, { collide: true, block: true, climb: false, round: 0.03 });
    box(w + 0.2, 0.06, 0.9, cx, 1.08, 9.65, new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.15, metalness: 0.3 }), { round: 0.02 });
    box(w, 0.04, 0.04, cx, 0.12, 9.33, neon(0xff9a3d), { cast: false });
    // Estantes con botellas contra la pared
    for (const y of [1.35, 1.85, 2.35]) box(w, 0.04, 0.3, cx, y, Z1 - 0.2, darkMat, { cast: false });
    const bottleGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.3, 12);
    const bottleMats = [0x2e7d32, 0x6d4c41, 0xffb74d, 0x90caf9, 0xd81b60].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, transparent: true, opacity: 0.85 }));
    for (const y of [1.52, 2.02, 2.52]) {
      for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.22 + rand() * 0.2) {
        const b = new THREE.Mesh(bottleGeo, bottleMats[Math.floor(rand() * bottleMats.length)]);
        b.position.set(x, y, Z1 - 0.22);
        b.userData.mergeTransparent = true;
        scene.add(b);
      }
    }
    box(w, 0.02, 1.2, cx, 3, Z1 - 0.6, neon(0xffb36b), { cast: false });
    for (let i = 0; i < 8; i++) stool(x0 + 0.6 + i * ((w - 1.2) / 7), 8.75, 0);
  }

  // ---------- Baño (sobresale al norte del hall): paredes de collage ----------
  {
    const { x0, x1, z0, h } = WC, cx = (x0 + x1) / 2, cz = (z0 + Z0) / 2, w = x1 - x0, d = Z0 - z0;
    plane(w, d, floorMat(w, d), cx, 0.002, cz, 0, -Math.PI / 2);
    box(T, h, d, x0 - T / 2, h / 2, cz, wallMat, wall);
    box(T, h, d, x1 + T / 2, h / 2, cz, wallMat, wall);
    box(w + 2 * T, h, T, cx, h / 2, z0 - T / 2, wallMat, wall);
    box(w + 2 * T, T, d + T, cx, h + T / 2, cz, wallMat, { cast: false });
    const coll = (seed, rep) => { const t = collage(seed); t.repeat.set(rep, 1); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }); };
    plane(d, h, coll(3, d / h), x0 + 0.01, h / 2, cz, Math.PI / 2);
    plane(d, h, coll(5, d / h), x1 - 0.01, h / 2, cz, -Math.PI / 2);
    plane(w, h, coll(8, w / h), cx, h / 2, z0 + 0.01, 0);
    plane(WC.door0 - x0, h, coll(13, 1), (x0 + WC.door0) / 2, h / 2, Z0 - T - 0.01, Math.PI);
    plane(x1 - WC.door1, h, coll(21, 1), (WC.door1 + x1) / 2, h / 2, Z0 - T - 0.01, Math.PI);
    plane(w - 0.4, d - 0.6, new THREE.MeshBasicMaterial({ color: 0xfff1dc }), cx, h - 0.01, cz, 0, Math.PI / 2);
    // Dos cubículos contra la pared del fondo, con inodoro
    for (const [sx, ex] of [[x0, -19.3], [-19.3, -16.6]]) {
      const mx = (sx + ex) / 2;
      box(0.05, 2.1, 1.8, ex, 1.15, z0 + 0.9, darkMat, { collide: true, climb: false });
      box(ex - sx - 1, 2.1, 0.05, sx + (ex - sx - 1) / 2, 1.15, z0 + 1.8, darkMat, { collide: true, climb: false });
      box(0.4, 0.42, 0.55, mx, 0.21, z0 + 0.4, porcelainMat, { round: 0.08 });
      box(0.42, 0.45, 0.16, mx, 0.62, z0 + 0.1, porcelainMat, { round: 0.04 });
      collider(mx - 0.25, mx + 0.25, z0, z0 + 0.7, 0.45);
    }
    // Lavatorio y espejo contra la pared este
    box(0.55, 0.85, 2.6, x1 - 0.3, 0.425, -13.3, darkMat, { collide: true, climb: false, round: 0.02 });
    for (const z of [-14.1, -12.5]) {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.12, 32), porcelainMat);
      basin.position.set(x1 - 0.3, 0.9, z);
      scene.add(basin);
    }
    plane(2.4, 1.1, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.03 }), x1 - 0.02, 1.7, -13.3, -Math.PI / 2);
    box(0.02, 0.02, 2.4, x1 - 0.05, 2.3, -13.3, neon(0xff6fb5), { cast: false });
  }

  // ---------- Escaleras al balcón (norte y sur del hall, pegadas a la pista) ----------
  {
    const steps = 12, run = 0.5, x0 = XP - steps * run, rise = BY / steps;
    for (const [z, s] of [[Z0 + 0.75, 1], [Z1 - 0.75, -1]]) {
      for (let i = 0; i < steps; i++) {
        const top = (i + 1) * rise;
        box(run, top, 1.5, x0 + run * (i + 0.5), top / 2, z, i % 2 ? darkMat : steelMat, { collide: true, block: true, climb: false });
      }
      // Baranda del lado abierto
      const rz = z + s * 0.78;
      const len = Math.hypot(steps * run, BY);
      const rail = box(len, 0.05, 0.05, x0 + (steps * run) / 2, BY / 2 + 1, rz, steelMat, { cast: false, round: 0.02 });
      rail.rotation.z = Math.atan2(BY, steps * run);
      const glass = box(len, 0.9, 0.02, x0 + (steps * run) / 2, BY / 2 + 0.5, rz, glassMat, { cast: false });
      glass.rotation.z = rail.rotation.z;
      glass.userData.mergeTransparent = true;
    }
  }

  // ---------- Balcón en U sobre la pista (2º piso) ----------
  const balconyTop = floorMat(18, 3.5);
  const slab = (x0, x1, z0, z1) => {
    const w = x1 - x0, d = z1 - z0;
    box(w, BT, d, (x0 + x1) / 2, BY - BT / 2, (z0 + z1) / 2, darkMat, { collide: true, float: true, block: true, climb: false });
    plane(w, d, balconyTop, (x0 + x1) / 2, BY + 0.002, (z0 + z1) / 2, 0, -Math.PI / 2);
  };
  slab(XP, BX, Z0, -BZ);
  slab(XP, BX, BZ, Z1);
  slab(XP, BW, -BZ, BZ);
  // Barandas de vidrio (chocan solo a la altura del balcón)
  const railing = (x0, x1, z0, z1) => {
    const w = Math.max(x1 - x0, 0.06), d = Math.max(z1 - z0, 0.06), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(w, 1, d, cx, BY + 0.5, cz, glassMat, { cast: false }).userData.mergeTransparent = true;
    box(w + 0.02, 0.05, d + 0.02, cx, BY + 1.03, cz, steelMat, { cast: false, round: 0.02 });
    collider(cx - w / 2 - 0.03, cx + w / 2 + 0.03, cz - d / 2 - 0.03, cz + d / 2 + 0.03, BY + 1.1, false, BY);
  };
  railing(BW, BX, -BZ, -BZ);
  railing(BW, BX, BZ, BZ);
  railing(BX, BX, Z0, -BZ);
  railing(BX, BX, BZ, Z1);
  railing(BW, BW, -BZ, BZ);
  railing(XP, XP, Z0 + 1.6, Z1 - 1.6); // del lado del hall (las escaleras llegan por las puntas)
  // Columnas negras que sostienen el balcón
  for (const [x, z] of [[BW, -BZ], [BW, BZ], [5.5, -BZ], [5.5, BZ], [BX, -BZ], [BX, BZ]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, BY - BT, 24), blackMat);
    c.position.set(x, (BY - BT) / 2, z);
    c.castShadow = high;
    scene.add(c);
    blockers.push(c);
    collider(x - 0.18, x + 0.18, z - 0.18, z + 0.18, BY - BT, false);
  }
  // Sillones del balcón, mirando a la pista
  for (const x of [0.5, 4, 8.8]) {
    sofa(x, BY, -10.3, 0);
    sofa(x, BY, 10.3, Math.PI);
  }

  // Tiras de LED al ras del piso y del techo en la pista
  const cove = neon(0xff3df2);
  for (const z of [Z0 + 0.08, Z1 - 0.08]) {
    box(X1 - XP, 0.025, 0.025, (XP + X1) / 2, 0.03, z, cove, { cast: false, round: 0.01 });
    box(X1 - XP, 0.025, 0.025, (XP + X1) / 2, H - 0.12, z, cove, { cast: false, round: 0.01 });
  }

  // ---------- Cabina de VJ y luces (abajo del balcón oeste, mirando a la pista) ----------
  const vjX = -3.1;
  const desk = box(1.1, 1, 3.4, vjX, 0.5, 0, darkMat, { collide: true, block: true, climb: false, round: 0.05, noStand: true });
  box(0.03, 0.03, 3.3, vjX + 0.56, 0.98, 0, neon(0x19d3ff), { cast: false });
  const deskItem = interactive(desk, { kind: 'artists' });
  for (const z of [-1, 0, 1]) {
    const pad = plane(0.7, 0.8, new THREE.MeshBasicMaterial({ color: z === 0 ? 0x2a0f3a : 0x0c2a3a, toneMapped: false }), vjX - 0.05, 1.006, z * 1.05, 0, -Math.PI / 2);
    pad.userData.interact = deskItem;
  }
  const artistSign = plane(3, 0.75, new THREE.MeshBasicMaterial({ map: artistsSign({}), transparent: true, toneMapped: false }), vjX + 0.2, 2.75, 0, Math.PI / 2);
  function setArtists(parts) {
    const old = artistSign.material.map;
    artistSign.material.map = artistsSign(parts);
    artistSign.material.needsUpdate = true;
    old.dispose();
  }

  // ---------- Escenario y cabina de DJ ----------
  box(4.6, 0.4, 9, 15.3, 0.2, 0, darkMat, { collide: true, round: 0.04 });
  const ledMat = neon(0xffffff);
  box(0.04, 0.04, 9, 13.02, 0.36, 0, ledMat, { cast: false, round: 0.015 });
  box(4.6, 0.04, 0.04, 15.3, 0.36, -4.5, ledMat, { cast: false, round: 0.015 });
  box(4.6, 0.04, 0.04, 15.3, 0.36, 4.5, ledMat, { cast: false, round: 0.015 });
  const booth = box(0.8, 1, 3, 16.2, 0.9, 0, darkMat, { collide: true, block: true, round: 0.05, noStand: true });
  interactive(booth, { kind: 'dj' });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, metalness: 0.6, roughness: 0.4 });
  for (const z of [-0.85, 0.85]) {
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 48), deckMat);
    deck.position.set(16.15, 1.42, z);
    deck.userData.dynamic = true; // gira
    scene.add(deck);
    animated.push((dt) => { deck.rotation.y += dt * 3.5; });
  }
  box(0.4, 0.06, 0.5, 16.15, 1.43, 0, deckMat, { cast: false, round: 0.02 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x333336, metalness: 0.5, roughness: 0.5 });
  for (const z of [-4, 4]) {
    box(0.8, 2.2, 0.8, 16.6, 1.5, z, darkMat, { collide: true, block: true, round: 0.05 });
    for (const [y, r] of [[2.0, 0.25], [1.05, 0.16]]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(r, 48), coneMat);
      c.position.set(16.19, y, z);
      c.rotation.y = -Math.PI / 2;
      const surround = new THREE.Mesh(new THREE.TorusGeometry(r, 0.02, 8, 48), steelMat);
      surround.position.copy(c.position);
      surround.rotation.y = -Math.PI / 2;
      scene.add(c, surround);
    }
  }
  // Cartelito en el frente de la cabina con el DJ y el track (solo cuando hay DJ)
  const boothSignMesh = plane(2.6, 0.65, new THREE.MeshBasicMaterial({ toneMapped: false }), 15.78, 0.85, 0, -Math.PI / 2);
  boothSignMesh.visible = false;
  boothSignMesh.userData.dynamic = true;
  function setBooth(dj) {
    boothSignMesh.material.map?.dispose();
    boothSignMesh.visible = !!dj;
    if (dj) { boothSignMesh.material.map = boothSign(dj.name, dj.track); boothSignMesh.material.needsUpdate = true; }
  }

  // ---------- Pantalla: toda la pared este. La toma un VJ (solo video) ----------
  const SW = Z1 - Z0, SH = H - 0.4;
  const idle = document.createElement('canvas');
  idle.width = 512; idle.height = Math.round(512 * SH / SW);
  const ig = idle.getContext('2d');
  const idleTex = new THREE.CanvasTexture(idle);
  idleTex.colorSpace = THREE.SRGBColorSpace;
  const bigScreen = plane(SW, SH, new THREE.MeshBasicMaterial({ map: idleTex, toneMapped: false }), X1 - 0.03, 0.4 + SH / 2, 0, -Math.PI / 2);
  interactive(bigScreen, { kind: 'screen' });
  let liveVideo = null;
  const screenApi = {
    position: new THREE.Vector3(X1 - 0.2, 3.5, 0),
    setVideo(video) {
      liveVideo = video;
      if (bigScreen.material.map !== idleTex) bigScreen.material.map.dispose();
      if (video) {
        // "Cubrir": la pared es más ancha que un video 16:9, así que se recorta arriba y abajo
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        const fit = () => {
          const a = (video.videoWidth || 16) / (video.videoHeight || 9), A = SW / SH;
          if (A > a) { tex.repeat.set(1, a / A); tex.offset.set(0, (1 - a / A) / 2); } else { tex.repeat.set(A / a, 1); tex.offset.set((1 - A / a) / 2, 0); }
        };
        fit();
        video.addEventListener('loadedmetadata', fit);
        bigScreen.material.map = tex;
      } else bigScreen.material.map = idleTex;
      bigScreen.material.needsUpdate = true;
    },
    get live() { return !!liveVideo; },
  };
  // Sin video: ondas oscuras muy suaves (que se note que es una pantalla, sin llamar la atención)
  let idleClock = 0;
  animated.push((dt, t) => {
    if (liveVideo) return;
    idleClock += dt;
    if (idleClock < 1 / 15) return;
    idleClock = 0;
    ig.fillStyle = '#040408';
    ig.fillRect(0, 0, idle.width, idle.height);
    for (let i = 0; i < 4; i++) {
      const x = idle.width * (0.5 + Math.sin(t * 0.15 + i * 1.9) * 0.45), y = idle.height * (0.5 + Math.cos(t * 0.2 + i * 2.3) * 0.4);
      const r = ig.createRadialGradient(x, y, 0, x, y, idle.width * 0.35);
      r.addColorStop(0, `hsla(${(i * 70 + t * 6) % 360} 70% 40% / 0.18)`);
      r.addColorStop(1, 'hsla(0 0% 0% / 0)');
      ig.fillStyle = r;
      ig.fillRect(0, 0, idle.width, idle.height);
    }
    idleTex.needsUpdate = true;
  });

  // ---------- Luces de la pista: tiras de LED pixel en el techo y beams ----------
  const PIX_X0 = BW + 0.6, PIX_X1 = BX - 0.4, PIX_N = 44, STRIPS = [-6, -3.6, -1.2, 1.2, 3.6, 6];
  const pixels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), new THREE.MeshBasicMaterial({ toneMapped: false }), PIX_N * STRIPS.length);
  {
    const m4 = new THREE.Matrix4();
    STRIPS.forEach((z, s) => {
      for (let i = 0; i < PIX_N; i++) {
        m4.makeTranslation(PIX_X0 + (i / (PIX_N - 1)) * (PIX_X1 - PIX_X0), H - 0.05, z);
        pixels.setMatrixAt(s * PIX_N + i, m4);
        pixels.setColorAt(s * PIX_N + i, new THREE.Color(0, 0, 0));
      }
      box(PIX_X1 - PIX_X0 + 0.3, 0.02, 0.09, (PIX_X0 + PIX_X1) / 2, H - 0.025, z, blackMat, { cast: false });
    });
  }
  scene.add(pixels);

  // Beams: cabezales móviles en dos barras, con un haz finito
  const beamGeo = new THREE.CylinderGeometry(0.02, 0.32, 7, 24, 1, true);
  beamGeo.translate(0, -3.5, 0);
  const beams = [];
  for (const z of [-3.6, 3.6]) {
    box(PIX_X1 - PIX_X0, 0.08, 0.08, (PIX_X0 + PIX_X1) / 2, H - 0.45, z, steelMat, { cast: false });
    for (const x of [1.2, 5, 8.8]) {
      const head = new THREE.Group();
      head.position.set(x, H - 0.6, z);
      head.userData.dynamic = true; // apunta a la pista
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.26, 0.22, 3, 0.04), darkMat);
      head.add(body);
      const mat = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
        vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vY; void main(){ float f = clamp(1.0 + vY / 7.0, 0.0, 1.0); gl_FragColor = vec4(color, opacity * f); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.position.y = -0.12;
      head.add(beam);
      scene.add(head);
      beams.push({ head, beam });
    }
  }
  const stageLight = new THREE.PointLight(0xff00ff, 30, 16, 2);
  stageLight.position.set(13.5, 3.5, 0);
  scene.add(stageLight);

  // Música del DJ: nivel de graves (0..1) que manda main.js; con música, todo late con el bombo
  const music = { level: 0, avg: 0, since: 0, pulse: 0, on: false };
  // Luces que manda un artista por OSC (null = automáticas)
  let lightOverride = null;
  // Fiesta: de noche, con DJ o con artista de luces. De día y sin nadie, apagadas
  let night = 0, party = 0;
  const col = new THREE.Color();
  animated.push((dt, t) => {
    music.since += dt;
    music.avg += (music.level - music.avg) * Math.min(1, dt * 2);
    const hit = music.on && music.level > 0.3 && music.level > music.avg * 1.18 && music.since > 0.28;
    if (hit) music.since = 0;
    music.pulse = hit ? 1 : music.pulse * Math.exp(-dt * 6);
    const target = lightOverride || music.on ? 1 : night;
    party += (target - party) * Math.min(1, dt * 1.5);

    const L = lightOverride;
    const rgb = (c, fallback) => (c ?? fallback ?? [1, 1, 1]);
    const p = music.on ? music.pulse : 0;
    const flash = L ? L.flash : p;
    // Beams
    beams.forEach(({ head, beam }, i) => {
      const f = L?.focos[i % 4];
      if (f) {
        head.rotation.z = f.pan * 0.9;
        head.rotation.x = f.tilt * 0.7;
        beam.material.uniforms.color.value.setRGB(...rgb(f.color, L.color));
        beam.material.uniforms.opacity.value = (0.18 + flash * 0.3) * f.intensidad * L.intensidad;
      } else {
        head.rotation.z = Math.sin(t * 0.7 + i * 1.1) * 0.6;
        head.rotation.x = Math.cos(t * 0.5 + i * 0.8) * 0.45;
        beam.material.uniforms.color.value.setHSL((t * 0.05 + i * 0.17) % 1, 1, 0.6);
        beam.material.uniforms.opacity.value = (0.14 + p * 0.25) * party;
      }
    });
    // Tiras de LED pixel: una onda de color que corre por la pista (con artista: su color de LEDs)
    const ledCol = L ? rgb(L.leds.color, L.color) : null;
    for (let s = 0; s < STRIPS.length; s++) {
      for (let i = 0; i < PIX_N; i++) {
        const k = i / PIX_N;
        if (ledCol) {
          const wave = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4 - k * 12 + s));
          col.setRGB(...ledCol).multiplyScalar(GLOW * 0.6 * wave * L.intensidad * (1 + flash * 2));
        } else {
          const wave = 0.5 + 0.5 * Math.sin(t * 2.2 - k * 9 + s * 0.8);
          col.setHSL((t * 0.04 + k * 0.5 + s * 0.05) % 1, 1, 0.5).multiplyScalar(GLOW * 0.5 * party * (0.15 + 0.85 * wave) * (1 + p * 1.5));
        }
        pixels.setColorAt(s * PIX_N + i, col);
      }
    }
    pixels.instanceColor.needsUpdate = true;
    if (L) {
      ledMat.color.setRGB(...rgb(L.leds.color, L.color)).multiplyScalar(GLOW * L.intensidad * (1 + flash * 2));
      cove.color.setRGB(...rgb(L.leds.color, L.color)).multiplyScalar(GLOW * L.intensidad * (1 + flash));
      stageLight.color.setRGB(...rgb(L.escenario.color, L.color));
      stageLight.intensity = (30 + flash * 90) * L.escenario.intensidad * L.intensidad;
    } else {
      ledMat.color.setHSL((t * 0.1) % 1, 1, 0.5).multiplyScalar(GLOW * (0.15 + 0.85 * party) * (1 + p * 1.5));
      cove.color.setHSL((t * 0.1 + 0.8) % 1, 1, 0.55).multiplyScalar(GLOW * party * (1 + p));
      stageLight.color.setHSL((t * 0.1 + 0.5) % 1, 1, 0.5);
      stageLight.intensity = (30 + p * 70) * party;
    }
  });

  // Las piezas quietas que comparten material se dibujan juntas (ver merge.js): mismo aspecto, menos trabajo
  mergeStatic(scene);

  return {
    colliders,
    blockers,
    interactables,
    // Una sola pantalla (la pared este): la usan el VJ (consola) y "ver en grande"
    screen: screenApi,
    stage: screenApi,
    // Museo rotativo: 9 lugares de cuadros y 5 de esculturas (en el orden del servidor)
    works: { paintings: paintingSlots, sculptures: sculptureSlots },
    // Cabina del DJ: dónde se para (mirando a la pista), dónde se baja y los dos parlantes [izq., der.]
    dj: {
      spot: { x: 17.05, y: 0.4, z: 0, yaw: -Math.PI / 2, exit: { x: 15.2, z: 0 } },
      exit: { x: 15.2, z: 0 },
      speakers: [new THREE.Vector3(16.2, 1.6, -4), new THREE.Vector3(16.2, 1.6, 4)],
      setBooth,
      setMusic(level) { music.level = level; music.on = level >= 0; },
    },
    // Consola de artistas: cartel con quién tiene cada parte, y las luces que mandan por OSC
    // spots: dónde queda fijo cada artista mientras tiene el control (detrás de la consola, mirando a la pista)
    artists: {
      setSign: setArtists,
      setLights(s) { lightOverride = s; },
      spots: {
        luces: { x: vjX - 0.95, y: 0, z: -0.8, yaw: Math.PI / 2, exit: { x: vjX - 2.2, z: -0.8 } },
        escenario: { x: vjX - 0.95, y: 0, z: 0.8, yaw: Math.PI / 2, exit: { x: vjX - 2.2, z: 0.8 } },
      },
    },
    bounds: { minY: 0.2, maxY: H - 0.2 },
    spawn: { x: X0 + 2.5, z: 0, yaw: -Math.PI / 2 },
    update(dt, t) { for (const fn of animated) fn(dt, t); },
    // Día y noche: hours = hora del día (0..24). El sol entra por el tragaluz de día;
    // de noche se encienden las luces de la fiesta.
    setTime(hours) {
      const elev = Math.sin(((hours - 6.5) / 13) * Math.PI);      // >0 entre 6:30 y 19:30
      const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);  // 0 noche … 1 día
      const golden = day * (1 - THREE.MathUtils.smoothstep(elev, 0.1, 0.45)); // amanecer/atardecer
      const k = ((hours - 6.5) / 13) * Math.PI;                   // recorrido del sol de este a oeste
      sun.position.set(-Math.cos(k) * 10, 4 + Math.max(elev, 0) * 10, 5).add(sun.target.position);
      sun.intensity = (high ? 3 : 1.6) * day;
      sun.color.set(0xffe2b8).lerp(new THREE.Color(0xff8a4a), golden);
      hemi.intensity = (high ? 0.85 : 1.1) * (0.4 + 0.6 * day);
      scene.environmentIntensity = 0.2 + 0.25 * day;
      const nightSky = new THREE.Color(0x0b1236), dawn = new THREE.Color(0xff9e6b), noon = new THREE.Color(0xd6e8ff);
      sky.material.color.copy(nightSky).lerp(noon, day).lerp(dawn, golden * 0.8).multiplyScalar(0.3 + 1.2 * day);
      shaft.material.uniforms.opacity.value = 0.04 * day;
      shaft.material.uniforms.color.value.set(0xffe6bf).lerp(new THREE.Color(0xff9a5a), golden);
      poolMat.opacity = 0.2 + 0.25 * (1 - day);
      night = 1 - day;
    },
  };
}
