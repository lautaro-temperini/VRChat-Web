import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { woodFloor, plasterBump, lightPool, painting, plaque, sign, rug, rng } from './textures.js';
import { artworkInfo, SCULPTURES } from './artworks.js';

// Sala principal. Zonas, de oeste a este:
//   x -18..-8  pantalla de video + bancos (paredes verde petróleo)
//   x  -8.. 2  esculturas, bajo el tragaluz (paredes claras)
//   x   2..18  pista de baile + cabina de DJ (paredes oscuras con neón)
const X0 = -18, X1 = 18, Z0 = -11, Z1 = 11, H = 7, T = 0.4;
// Tragaluz: abertura en el techo con vigas, por donde entra el sol
const SX0 = -16, SX1 = 11, SZ = 2.6, WELL = 1.4, BAY = 1.8;
const SUN_FROM = new THREE.Vector3(-6, 12, 5);
// Neón: color por encima de 1 para que el bloom (umbral alto) brille solo en estas piezas
const GLOW = 5;

export function buildMuseum(scene, renderer, quality) {
  const colliders = [];     // cajas en el plano XZ con altura (top); climb:false = no se puede trepar
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
  sun.position.copy(SUN_FROM);
  if (high) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 18, bottom: -18, near: 1, far: 45 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);

  // ---------- Materiales ----------
  const bump = plasterBump();
  bump.repeat.set(6, 2);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.95, bumpMap: bump, bumpScale: 0.4 });
  const tealMat = new THREE.MeshStandardMaterial({ color: 0x1f5560, roughness: 0.9 });
  const nightMat = new THREE.MeshStandardMaterial({ color: 0x1e1b28, roughness: 0.85 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2c1b, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.55, metalness: 0.2 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a74a, roughness: 0.25, metalness: 1 });
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.3 });
  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.85 });
  const frameMats = [
    new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.28, metalness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35 }),
  ];
  const neon = (hex) => { const m = new THREE.MeshBasicMaterial({ toneMapped: false }); m.color.set(hex).multiplyScalar(GLOW); return m; };

  function box(w, h, d, x, y, z, mat, opts = {}) {
    const geo = opts.round ? new RoundedBoxGeometry(w, h, d, 4, opts.round) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = high && (opts.cast ?? true);
    m.receiveShadow = high;
    scene.add(m);
    if (opts.collide) collider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + h / 2, opts.climb);
    if (opts.block) blockers.push(m);
    return m;
  }
  function collider(minX, maxX, minZ, maxZ, top, climb = true) {
    colliders.push({ minX, maxX, minZ, maxZ, top, climb });
  }
  function interactive(object, data) {
    const item = { object, ...data };
    object.traverse((o) => { o.userData.interact = item; });
    interactables.push(item);
    return item;
  }

  // ---------- Piso ----------
  const floorTex = woodFloor();
  floorTex.repeat.set((X1 - X0) / 4.5, (Z1 - Z0) / 4.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = high;
  scene.add(floor);

  // ---------- Techo con tragaluz ----------
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d6, roughness: 1 });
  function ceiling(x, z, w, d) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, H, z);
    m.castShadow = high; // tapa el sol: solo entra por el tragaluz
    scene.add(m);
  }
  ceiling(0, (Z0 - SZ) / 2, X1 - X0, -SZ - Z0);
  ceiling(0, (Z1 + SZ) / 2, X1 - X0, Z1 - SZ);
  ceiling((X0 + SX0) / 2, 0, SX0 - X0, SZ * 2);
  ceiling((SX1 + X1) / 2, 0, X1 - SX1, SZ * 2);

  const wellX = (SX0 + SX1) / 2, wellW = SX1 - SX0;
  box(wellW, WELL, 0.1, wellX, H + WELL / 2, -SZ - 0.05, trimMat);
  box(wellW, WELL, 0.1, wellX, H + WELL / 2, SZ + 0.05, trimMat);
  box(0.1, WELL, SZ * 2, SX0 - 0.05, H + WELL / 2, 0, trimMat);
  box(0.1, WELL, SZ * 2, SX1 + 0.05, H + WELL / 2, 0, trimMat);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(wellW, SZ * 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd6e8ff).multiplyScalar(1.5) }));
  sky.rotation.x = Math.PI / 2;
  sky.position.set(wellX, H + WELL, 0);
  scene.add(sky);
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

  // Luces lineales en el techo
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e0, emissiveIntensity: 1.3 });
  for (const x of [-13, -4.5, 4.5]) for (const z of [-6.8, 6.8]) box(5, 0.04, 0.3, x, H - 0.02, z, panelMat, { cast: false, round: 0.015 });

  // ---------- Paredes ----------
  const wall = { collide: true, block: true, cast: false, climb: false };
  box(X1 - X0 + 2 * T, H, T, 0, H / 2, Z0 - T / 2, wallMat, wall); // norte
  box(X1 - X0 + 2 * T, H, T, 0, H / 2, Z1 + T / 2, wallMat, wall); // sur
  box(T, H, Z1 - Z0, X0 - T / 2, H / 2, 0, wallMat, wall);         // oeste
  box(T, H, Z1 - Z0, X1 + T / 2, H / 2, 0, wallMat, wall);         // este

  // Color por zona (paneles sobre la pared, de la boiserie al techo)
  const PH = H - 1.06 - 0.18, PY = 1.06 + PH / 2;
  for (const z of [Z0 + 0.01, Z1 - 0.01]) {
    box(10, PH, 0.02, -13, PY, z, tealMat, { cast: false });
    box(16, PH, 0.02, 10, PY, z, nightMat, { cast: false });
  }
  box(0.02, PH, Z1 - Z0, X0 + 0.01, PY, 0, tealMat, { cast: false });
  box(0.02, PH, Z1 - Z0, X1 - 0.01, PY, 0, nightMat, { cast: false });

  // Boiserie de madera, moldura y cornisa (el grosor va hacia adentro de la sala)
  for (const [x, z, alongX] of [[0, Z0, true], [0, Z1, true], [X0, 0, false], [X1, 0, false]]) {
    const len = alongX ? X1 - X0 : Z1 - Z0;
    const piece = (h, y, thick, mat, round) => {
      const inward = (alongX ? -Math.sign(z) : -Math.sign(x)) * thick / 2;
      box(alongX ? len : thick, h, alongX ? thick : len, alongX ? x : x + inward, y, alongX ? z + inward : z, mat, { cast: false, round });
    };
    piece(1, 0.5, 0.04, woodMat);
    piece(0.06, 1.03, 0.07, woodMat, 0.025);
    piece(0.18, H - 0.09, 0.14, trimMat, 0.04);
  }

  // Pared divisoria (con cuadros en ambas caras)
  box(0.3, 4.2, 9, -8, 2.1, 0, wallMat, { collide: true, block: true, climb: false });
  box(0.38, 0.12, 9.08, -8, 4.26, 0, trimMat, { round: 0.04 });

  // Columnas de mármol acanaladas, con base y capitel
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
  for (const x of [-13, -3, 7]) {
    for (const z of [-7.6, 7.6]) {
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
      // Colisión de toda la altura: no se atraviesa ni se trepa
      collider(x - 0.4, x + 0.4, z - 0.4, z + 0.4, H, false);
    }
  }

  // ---------- Cuadros (con marco biselado y foco en el techo) ----------
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

  let artId = 1;
  function hangArt(x, z, rotY, railOffset) {
    const w = 1.5 + rand() * 1.1, h = 1.1 + rand() * 0.8;
    const g = new THREE.Group();
    g.position.set(x, 2.15, z);
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
    interactive(g, { kind: 'art', prompt: 'Ver obra', info, image: tex.image });

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

  for (const x of [-15, -11, -4.5, -0.5, 4, 8]) {
    hangArt(x, Z0 + 0.03, 0, 1.4);
    hangArt(x, Z1 - 0.03, Math.PI, 1.4);
  }
  for (const z of [-2.2, 2.2]) {
    hangArt(-8.15, z, -Math.PI / 2);
    hangArt(-7.85, z, Math.PI / 2);
  }
  box(27, 0.04, 0.05, -3.5, H - 0.08, Z0 + 1.4, steelMat, { cast: false, round: 0.015 });
  box(27, 0.04, 0.05, -3.5, H - 0.08, Z1 - 1.4, steelMat, { cast: false, round: 0.015 });

  // ---------- Pantalla de video (zona oeste) ----------
  const vid = document.createElement('canvas');
  vid.width = 640; vid.height = 360;
  const vg = vid.getContext('2d');
  const vidTex = new THREE.CanvasTexture(vid);
  vidTex.colorSpace = THREE.SRGBColorSpace;
  const bezel = box(0.14, 4.25, 7.45, X0 + 0.09, 3.2, 0, darkMat, { cast: false, round: 0.05 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.94), new THREE.MeshBasicMaterial({ map: vidTex, toneMapped: false }));
  screen.position.set(X0 + 0.165, 3.2, 0);
  screen.rotation.y = Math.PI / 2;
  scene.add(screen);
  interactive(screen, { kind: 'screen', prompt: 'Compartir tu pantalla' });
  bezel.userData.interact = screen.userData.interact;
  const cyan = neon(0x36e6ff);
  const tube = (w, h, d, x, y, z) => box(w, h, d, x, y, z, cyan, { cast: false, round: 0.012 });
  tube(0.03, 0.03, 7.6, X0 + 0.17, 5.35, 0);
  tube(0.03, 0.03, 7.6, X0 + 0.17, 1.05, 0);
  tube(0.03, 4.34, 0.03, X0 + 0.17, 3.2, -3.78);
  tube(0.03, 4.34, 0.03, X0 + 0.17, 3.2, 3.78);
  // Cuando alguien comparte su pantalla, se ve acá (si no, la animación de espera)
  let liveVideo = null;
  const screenApi = {
    position: new THREE.Vector3(X0 + 0.2, 3.2, 0),
    setVideo(video) {
      liveVideo = video;
      if (screen.material.map !== vidTex) screen.material.map?.dispose();
      if (video) {
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        screen.material.map = tex;
      } else screen.material.map = vidTex;
      screen.material.needsUpdate = true;
    },
    get live() { return !!liveVideo; },
  };
  let vidClock = 0;
  animated.push((dt, t) => {
    if (liveVideo) return;
    vidClock += dt;
    if (vidClock < 1 / 30) return;
    vidClock = 0;
    const grad = vg.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, `hsl(${(t * 20) % 360} 70% 18%)`);
    grad.addColorStop(1, `hsl(${(t * 20 + 120) % 360} 70% 10%)`);
    vg.fillStyle = grad;
    vg.fillRect(0, 0, 640, 360);
    for (let i = 0; i < 6; i++) {
      const x = 320 + Math.sin(t * 0.7 + i * 1.7) * 220, y = 180 + Math.cos(t * 0.9 + i * 2.3) * 120;
      const r = vg.createRadialGradient(x, y, 0, x, y, 120);
      r.addColorStop(0, `hsla(${(i * 60 + t * 40) % 360} 90% 60% / 0.55)`);
      r.addColorStop(1, 'hsla(0 0% 0% / 0)');
      vg.fillStyle = r;
      vg.fillRect(0, 0, 640, 360);
    }
    vg.fillStyle = 'rgba(255,255,255,0.92)';
    vg.font = '700 34px "Segoe UI", Arial';
    vg.textAlign = 'center';
    vg.fillText('PANTALLA', 320, 170);
    vg.font = '20px "Segoe UI", Arial';
    vg.fillText('Acercate y apretá E para compartir tu pantalla', 320, 205);
    vidTex.needsUpdate = true;
  });

  // Alfombra y bancos frente a la pantalla (con E te sentás)
  const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 8), new THREE.MeshStandardMaterial({ map: rug(), roughness: 0.95 }));
  rugMesh.rotation.x = -Math.PI / 2;
  rugMesh.position.set(-12.2, 0.004, 0);
  rugMesh.receiveShadow = high;
  scene.add(rugMesh);
  const cushion = new THREE.MeshStandardMaterial({ color: 0x2f5e64, roughness: 0.9 });
  for (const z of [-2.2, 2.2]) {
    const bench = new THREE.Group();
    scene.add(bench);
    const parts = [
      box(0.5, 0.3, 0.12, -12, 0.15, z - 1.3, woodMat, { round: 0.03 }),
      box(0.5, 0.3, 0.12, -12, 0.15, z + 1.3, woodMat, { round: 0.03 }),
      box(0.6, 0.1, 3, -12, 0.35, z, woodMat, { round: 0.035 }),
      box(0.56, 0.08, 2.9, -12, 0.44, z, cushion, { round: 0.035 }),
    ];
    for (const p of parts) bench.attach(p);
    collider(-12.3, -11.7, z - 1.5, z + 1.5, 0.48);
    // Asientos: mirando a la pantalla (oeste)
    const seats = [-0.9, 0, 0.9].map((dz) => ({ x: -11.9, y: 0, z: z + dz, yaw: -Math.PI / 2 }));
    interactive(bench, { kind: 'sit', prompt: 'Sentarse', seats });
  }

  // ---------- Plantas ----------
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
    // Curvar la hoja hacia abajo y plegarla por la nervadura
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
      leaf.castShadow = high;
      tilt.add(leaf);
      g.add(pivot);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = high; });
    scene.add(g);
    collider(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 1.2, false);
  }
  for (const [x, z] of [[-17.3, -10.3], [-17.3, 10.3], [-8, -5.2], [-8, 5.2], [1.4, -10.3], [1.4, 10.3], [17.3, -10.3], [17.3, 10.3]]) plant(x, z);

  // ---------- Esculturas ----------
  const sculptures = [];
  function pedestal(x, z, w, h, mesh, lift, key) {
    const body = box(w, h - 0.05, w, x, (h - 0.05) / 2, z, pedestalMat, { collide: true, block: true, round: 0.025 });
    const cap = box(w + 0.06, 0.05, w + 0.06, x, h - 0.025, z, pedestalMat, { round: 0.02 });
    mesh.position.set(x, h + lift, z);
    mesh.castShadow = high;
    scene.add(mesh);
    sculptures.push(mesh);
    const info = SCULPTURES[key];
    const item = interactive(mesh, { kind: 'art', prompt: 'Ver escultura', info });
    body.userData.interact = item;
    cap.userData.interact = item;
  }
  pedestal(-5.5, -3.2, 0.8, 1, new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.24, 0.075, 260, 32),
    new THREE.MeshStandardMaterial({ color: 0xd4a74a, metalness: 1, roughness: 0.22 }),
  ), 0.4, 'knot');
  pedestal(-5.5, 3.2, 0.8, 1, new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.33, 0),
    new THREE.MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.35, clearcoat: 1, flatShading: true }),
  ), 0.36, 'ico');
  const vaseProfile = [];
  for (let i = 0; i <= 40; i++) {
    const v = i / 40;
    vaseProfile.push(new THREE.Vector2(0.12 + Math.sin(v * Math.PI * 1.2) * 0.16 + v * 0.03, v * 0.7));
  }
  pedestal(-2, -3.2, 0.8, 1, new THREE.Mesh(
    new THREE.LatheGeometry(vaseProfile, 64),
    new THREE.MeshStandardMaterial({ color: 0xa0612f, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }),
  ), 0, 'vase');
  pedestal(-2, 3.2, 0.8, 1, new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 }),
  ), 0.3, 'sphere');

  // Pieza central: columna retorcida, rodeada de sogas de terciopelo
  const colGeo = new THREE.BoxGeometry(0.5, 2.4, 0.5, 1, 80, 1);
  const pos = colGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), a = (y + 1.2) * 1.3;
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
  }
  colGeo.computeVertexNormals();
  pedestal(-3.75, 0, 1.4, 0.5, new THREE.Mesh(colGeo, new THREE.MeshPhysicalMaterial({ color: 0x101012, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 })), 1.2, 'column');
  animated.push((dt) => { for (const s of sculptures) s.rotation.y += dt * 0.25; });

  const velvet = new THREE.MeshStandardMaterial({ color: 0x8a1020, roughness: 0.7 });
  const R = 1.35, posts = [[-R, -R], [R, -R], [R, R], [-R, R]].map(([dx, dz]) => new THREE.Vector3(-3.75 + dx, 0, dz));
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
  collider(-3.75 - R, -3.75 + R, -R, R, 1, false);

  // ---------- Pista de baile ----------
  const tiles = new THREE.InstancedMesh(new RoundedBoxGeometry(0.96, 0.03, 0.96, 2, 0.012), new THREE.MeshBasicMaterial({ toneMapped: false }), 64);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < 64; i++) {
    m4.makeTranslation(4.5 + (i % 8), 0.012, -3.5 + Math.floor(i / 8));
    tiles.setMatrixAt(i, m4);
    tiles.setColorAt(i, col.setRGB(0.05, 0.05, 0.05));
  }
  scene.add(tiles);
  let beat = 0;
  animated.push((dt, t) => {
    beat += dt;
    if (beat < 0.47) return;
    beat = 0;
    for (let i = 0; i < 64; i++) {
      const on = Math.random() < 0.35;
      col.setHSL((t * 0.05 + (i % 8) * 0.04) % 1, 0.8, on ? 0.15 : 0.03);
      tiles.setColorAt(i, col);
    }
    tiles.instanceColor.needsUpdate = true;
  });

  // Tiras de LED al ras del piso y del techo en la zona oscura
  const cove = neon(0xff3df2);
  for (const z of [Z0 + 0.08, Z1 - 0.08]) box(16, 0.025, 0.025, 10, 0.03, z, cove, { cast: false, round: 0.01 });
  for (const z of [Z0 + 0.15, Z1 - 0.15]) box(16, 0.025, 0.025, 10, H - 0.22, z, cove, { cast: false, round: 0.01 });

  // ---------- Escenario y cabina de DJ ----------
  box(4.6, 0.4, 9, 15.3, 0.2, 0, darkMat, { collide: true, round: 0.04 });
  const ledMat = neon(0xffffff);
  box(0.04, 0.04, 9, 13.02, 0.36, 0, ledMat, { cast: false, round: 0.015 });
  box(4.6, 0.04, 0.04, 15.3, 0.36, -4.5, ledMat, { cast: false, round: 0.015 });
  box(4.6, 0.04, 0.04, 15.3, 0.36, 4.5, ledMat, { cast: false, round: 0.015 });

  const booth = box(0.8, 1, 3, 16.2, 0.9, 0, darkMat, { collide: true, block: true, round: 0.05 });
  interactive(booth, { kind: 'info', prompt: 'Ver cabina', info: { title: 'Cabina DJ', description: 'Muy pronto: pasá música en vivo desde tu PC y que suene por los parlantes de la sala, más fuerte cuanto más cerca estés.' } });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, metalness: 0.6, roughness: 0.4 });
  for (const z of [-0.85, 0.85]) {
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 48), deckMat);
    deck.position.set(16.15, 1.42, z);
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

  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.5),
    new THREE.MeshBasicMaterial({ map: sign('CABINA DJ', '#ffffff'), transparent: true, toneMapped: false }),
  );
  signMesh.position.set(X1 - 0.05, 5.1, 0);
  signMesh.rotation.y = -Math.PI / 2;
  scene.add(signMesh);

  // Haces de luz que se mueven sobre el escenario
  box(0.15, 0.15, 9, 15, 6.6, 0, steelMat, { cast: false, round: 0.03 });
  const beamGeo = new THREE.ConeGeometry(1.1, 6, 48, 1, true);
  beamGeo.translate(0, -3, 0);
  const beams = [];
  for (const z of [-3, -1, 1, 3]) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0.1 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vY; void main(){ float f = clamp(1.0 + vY / 6.0, 0.0, 1.0); gl_FragColor = vec4(color, opacity * f * f); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, mat);
    beam.position.set(15, 6.5, z);
    scene.add(beam);
    beams.push(beam);
  }
  const stageLight = new THREE.PointLight(0xff00ff, 30, 16, 2);
  stageLight.position.set(13.5, 3.5, 0);
  scene.add(stageLight);
  animated.push((dt, t) => {
    beams.forEach((b, i) => {
      b.rotation.z = Math.sin(t * 0.8 + i) * 0.55 - 0.2;
      b.rotation.x = Math.cos(t * 0.6 + i * 1.3) * 0.35;
      b.material.uniforms.color.value.setHSL((t * 0.08 + i * 0.25) % 1, 1, 0.55);
    });
    ledMat.color.setHSL((t * 0.1) % 1, 1, 0.5).multiplyScalar(GLOW);
    cove.color.setHSL((t * 0.1 + 0.8) % 1, 1, 0.55).multiplyScalar(GLOW);
    stageLight.color.setHSL((t * 0.1 + 0.5) % 1, 1, 0.5);
  });

  return {
    colliders,
    blockers,
    interactables,
    screen: screenApi,
    bounds: { minY: 0.2, maxY: H - 0.2 },
    spawn: { x: 3, z: 0, yaw: Math.PI / 2 },
    update(dt, t) { for (const fn of animated) fn(dt, t); },
    // Día y noche: hours = hora del día (0..24). El sol entra por el tragaluz de día;
    // de noche el cielo se oscurece y se encienden más las luces del techo y los focos.
    setTime(hours) {
      const elev = Math.sin(((hours - 6.5) / 13) * Math.PI);      // >0 entre 6:30 y 19:30
      const day = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);  // 0 noche … 1 día
      const golden = day * (1 - THREE.MathUtils.smoothstep(elev, 0.1, 0.45)); // amanecer/atardecer
      const k = ((hours - 6.5) / 13) * Math.PI;                   // recorrido del sol de este a oeste
      sun.position.set(-Math.cos(k) * 10, 4 + Math.max(elev, 0) * 10, 5);
      sun.intensity = (high ? 3 : 1.6) * day;
      sun.color.set(0xffe2b8).lerp(new THREE.Color(0xff8a4a), golden);
      hemi.intensity = (high ? 0.85 : 1.1) * (0.4 + 0.6 * day);
      scene.environmentIntensity = 0.2 + 0.25 * day;
      const night = new THREE.Color(0x0b1236), dawn = new THREE.Color(0xff9e6b), noon = new THREE.Color(0xd6e8ff);
      sky.material.color.copy(night).lerp(noon, day).lerp(dawn, golden * 0.8).multiplyScalar(0.3 + 1.2 * day);
      shaft.material.uniforms.opacity.value = 0.04 * day;
      shaft.material.uniforms.color.value.set(0xffe6bf).lerp(new THREE.Color(0xff9a5a), golden);
      panelMat.emissiveIntensity = 1.3 + 1.2 * (1 - day);
      poolMat.opacity = 0.2 + 0.25 * (1 - day);
    },
  };
}
