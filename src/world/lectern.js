import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Atril con un libro abierto (como un pequeño altar). Va en las salas personales:
// con E se abren las notas del dueño, y arriba muestra los corazones que recibió.

export function buildLectern(scene, { x, z, yaw }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c1b, roughness: 0.45 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a74a, roughness: 0.25, metalness: 1 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.9, side: THREE.DoubleSide });
  const cover = new THREE.MeshStandardMaterial({ color: 0x7a1c22, roughness: 0.6 });

  const add = (geo, mat, px, py, pz, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.x = rx;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 40), wood, 0, 0.03, 0);
  add(new THREE.CylinderGeometry(0.035, 0.05, 1.0, 20), brass, 0, 0.55, 0);
  // Tabla inclinada donde apoya el libro
  const tilt = new THREE.Group();
  tilt.position.set(0, 1.08, 0);
  tilt.rotation.x = -0.45;
  g.add(tilt);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.44), wood);
  board.castShadow = true;
  tilt.add(board);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.03), wood);
  lip.position.set(0, 0.03, 0.22);
  tilt.add(lip);
  // Libro abierto: tapas y dos páginas curvadas
  const coverMesh = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.015, 0.38), cover);
  coverMesh.position.y = 0.022;
  tilt.add(coverMesh);
  for (const s of [-1, 1]) {
    const pageGeo = new THREE.PlaneGeometry(0.26, 0.34, 12, 1);
    const p = pageGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 0.13) / 0.26; // 0 en el lomo … 1 en el borde
      p.setZ(i, Math.sin(u * Math.PI) * 0.025 + (1 - u) * 0.012);
    }
    pageGeo.computeVertexNormals();
    pageGeo.rotateX(-Math.PI / 2);
    const page = new THREE.Mesh(pageGeo, paper);
    page.position.set(s * 0.135, 0.032, 0);
    if (s < 0) page.scale.x = -1;
    tilt.add(page);
  }

  // Contador de corazones flotando arriba
  const tag = document.createElement('div');
  tag.className = 'lectern-tag';
  tag.textContent = '♥ 0';
  const label = new CSS2DObject(tag);
  label.position.y = 1.65;
  g.add(label);

  scene.add(g);
  return {
    group: g,
    setHearts(n) { tag.textContent = `♥ ${n}`; },
    collider: { minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, top: 1.2, climb: false },
  };
}
