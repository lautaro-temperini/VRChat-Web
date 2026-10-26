import * as THREE from 'three';
import { MODEL_RULES } from '../../server/glb.js';

// Modelo 3D de un diseño, ya cargado, listo para poner en la escena. Defensa en el cliente para lo que el
// servidor no puede medir (mallas comprimidas con Draco/meshopt): si trae más triángulos que los permitidos,
// se muestra una caja en su lugar; si es más grande que lo que declaró, se achica a esa medida.
// Devuelve un grupo con la base en el piso y centrado.
export function fitDesignModel(scene, design) {
  const obj = scene.clone(true);
  let tris = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    tris += o.isInstancedMesh ? n * o.count : n;
  });
  const dims = design?.dims ?? [0.5, 0.5, 0.5];
  const g = new THREE.Group();
  if (tris > MODEL_RULES.tris * 1.05) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(...dims), new THREE.MeshStandardMaterial({ color: 0x55555f, roughness: 0.8 }));
    box.position.y = dims[1] / 2;
    g.add(box);
    return g;
  }
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = Math.min(1, (Math.max(...dims) * 1.05) / Math.max(size.x, size.y, size.z, 0.001));
  obj.scale.multiplyScalar(k);
  obj.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  g.add(obj);
  return g;
}
