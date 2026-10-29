import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Junta las mallas quietas del mundo que comparten material en una sola malla por zona.
// Se ve igual (misma geometría y mismo material, ya ubicada en su lugar), pero el celular
// dibuja decenas de piezas en vez de cientos: cada malla es un "draw call" y eso es lo que más
// le cuesta a una placa de video floja.
//
// No se tocan (quedan como estaban):
//  - lo que se usa con E (userData.interact) o se mueve/cambia después (userData.dynamic)
//  - lo transparente (el orden de dibujo importa), salvo que se marque userData.mergeTransparent
//    (piezas iguales que casi no se superponen: botellas, vidrios de las barandas)
//  - instancias, puntos, líneas y multi-material
//  - lo que cuelga de un grupo marcado como dinámico o usable
// Lo que se usa con E pero no se mueve nunca (sillones, banquetas) se marca userData.mergeable en el
// grupo: se dibuja junto con el resto y el grupo original sale de la escena, pero sigue en
// world.interactables (con su posición), así el rayo de la E lo sigue encontrando.
// Las mallas que frenan la cámara (blockers) sí se juntan: la original sale de la escena (no se
// dibuja) pero sigue en world.blockers con su posición, así los rayos de la cámara y de E la siguen tocando.
// Las zonas (CELL m de lado) son para que el navegador pueda seguir salteando lo que no se ve.
const CELL = 16;

function mergeableRoot(o) {
  for (let p = o; p; p = p.parent) if (p.userData.mergeable) return p;
  return null;
}

function eligible(o, skip, roots) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || skip.has(o)) return false;
  if (Array.isArray(o.material) || (o.material.transparent && !o.userData.mergeTransparent) || !o.visible) return false;
  const root = mergeableRoot(o);
  if (root && roots && !roots.has(root)) return false;
  for (let p = o; p; p = p.parent) {
    if ((p.userData.interact && !root) || p.userData.dynamic || !p.visible) return false;
    if (p !== o && p.isMesh) return false; // hijo de otra malla: se arrastraría con ella
  }
  // Escala espejada: da vuelta las caras al hornear la posición
  return o.matrixWorld.determinant() > 0;
}

// Atributos en común: si una pieza no tiene uv y otra sí, no se pueden juntar
function signature(geo) {
  return Object.keys(geo.attributes).sort().join(',');
}

export function mergeStatic(scene, { skip = [] } = {}) {
  scene.updateMatrixWorld(true);
  const skipSet = new Set(skip);
  // Un grupo "mergeable" se junta entero o nada (si quedara una pieza afuera, desaparecería con él)
  const roots = new Set();
  scene.traverse((o) => { if (o.userData.mergeable) roots.add(o); });
  for (const r of [...roots]) {
    let ok = true;
    r.traverse((o) => { if (o.isMesh && !eligible(o, skipSet, null)) ok = false; });
    if (!ok) roots.delete(r);
  }
  const groups = new Map();
  scene.traverse((o) => {
    if (!eligible(o, skipSet, roots)) return;
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, signature(o.geometry), Math.floor(c.x / CELL), Math.floor(c.z / CELL)].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });

  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length;
    if (list.length < 2 && !mergeableRoot(list[0])) { after += list.length; continue; }
    const geos = list.map((o) => {
      const g = o.geometry.clone();
      // Solo lo que usan los materiales del mundo (algunas geometrías traen grupos o atributos de más)
      g.clearGroups();
      g.applyMatrix4(o.matrixWorld);
      return g;
    });
    // Con índices y sin índices mezclados (RoundedBox no tiene): se pasan todas a sin índices
    if (geos.some((g) => g.index) && geos.some((g) => !g.index)) geos.forEach((g, i) => { if (g.index) { geos[i] = g.toNonIndexed(); g.dispose(); } });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) { after += list.length; continue; }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'estatico';
    scene.add(mesh);
    // Las originales nunca se dibujaron (esto corre al armar el mundo): no ocupan memoria de video
    for (const o of list) if (!mergeableRoot(o)) o.removeFromParent();
    after++;
  }
  for (const r of roots) r.removeFromParent();
  // Grupos que quedaron vacíos (por ejemplo, las plantas): se sacan para no recorrerlos cada cuadro
  // (nunca la raíz ni algo sin padre: no se puede sacar y el bucle no terminaría)
  for (let n = 0; n < 64; n++) {
    const empty = [];
    scene.traverse((o) => { if (o !== scene && o.parent && o.isGroup && !o.children.length && !o.userData.interact && !o.userData.dynamic) empty.push(o); });
    if (!empty.length) break;
    for (const g of empty) g.removeFromParent();
  }
  return { before, after };
}
