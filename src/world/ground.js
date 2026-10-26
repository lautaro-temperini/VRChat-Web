import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildAccessory } from '../player/accessories.js';
import { ITEMS, FURNITURE, CONSUMABLES } from '../../server/shared.js';
import { miniFurniture } from './furniture.js';
import { loadGLTF } from '../loaders.js';
import { fitDesignModel } from './designModel.js';
import { designFileUrl } from '../net/api.js';

// Objetos soltados en el suelo. Giran sobre un aro; otro jugador puede juntarlos
// a los 5 s (quien lo soltó, enseguida). A los 60 s, si nadie lo juntó, se pierde.
// El servidor es el que decide; esto solo lo muestra.

export const PICKUP_LOCK = 5_000;
export const GROUND_LIFE = 60_000;

export class Ground {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.ringGeo = new THREE.RingGeometry(0.22, 0.3, 40).rotateX(-Math.PI / 2);
  }

  add(g) {
    this.remove(g.iid);
    const group = new THREE.Group();
    group.position.set(g.x, g.y, g.z);
    const spin = new THREE.Group();
    group.add(spin);
    // Diseños: su imagen o su modelo; muebles especiales: una versión chiquita del mueble
    const a = g.design ? { group: designMini(g.design) }
      : CONSUMABLES[g.type] ? { group: drinkMini(g.type) }
      : FURNITURE[g.type] ? { group: miniFurniture(g.type, g.color) } : buildAccessory(g.type, g.color);
    // Centrar el modelo (algunos están armados a la altura del pecho)
    const center = new THREE.Box3().setFromObject(a.group).getCenter(new THREE.Vector3());
    a.group.position.sub(center);
    spin.add(a.group);
    spin.scale.setScalar(FURNITURE[g.type] || g.design || CONSUMABLES[g.type] ? 1 : 2.2);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.y = 0.02;
    group.add(ring);
    const tag = document.createElement('div');
    tag.className = 'ground-tag';
    const label = new CSS2DObject(tag);
    label.position.y = 0.95;
    group.add(label);

    const item = { ...g, group, spin, ring, tag, label, name: g.design?.title || (ITEMS[g.type]?.name ?? FURNITURE[g.type]?.name ?? CONSUMABLES[g.type]?.name ?? g.type), born: performance.now() - (g.age ?? 0) };
    group.traverse((o) => { o.userData.interact = { kind: 'pickup', ground: item }; });
    this.scene.add(group);
    this.items.set(g.iid, item);
  }

  remove(iid) {
    const it = this.items.get(iid);
    if (!it) return null;
    it.group.remove(it.label);
    it.tag.remove();
    it.group.removeFromParent();
    it.group.traverse((o) => { if (o.isMesh) { if (o.geometry !== this.ringGeo) o.geometry.dispose(); if (!o.material.userData.shared) o.material.dispose(); } });
    this.items.delete(iid);
    return it;
  }

  clear() { for (const iid of [...this.items.keys()]) this.remove(iid); }

  age(it) { return performance.now() - it.born; }
  locked(it, myUserId) { return it.owner !== myUserId && this.age(it) < PICKUP_LOCK; }

  objects() { return [...this.items.values()].map((i) => i.group); }

  update(dt, t, myUserId) {
    for (const it of this.items.values()) {
      const age = this.age(it);
      it.spin.rotation.y += dt * 1.4;
      it.spin.position.y = 0.45 + Math.sin(t * 2 + it.x) * 0.06;
      const left = GROUND_LIFE - age;
      const locked = this.locked(it, myUserId);
      it.tag.textContent = locked ? `${it.name} · en ${Math.ceil((PICKUP_LOCK - age) / 1000)} s` : left < 10_000 ? `${it.name} · ${Math.max(0, Math.ceil(left / 1000))} s` : it.name;
      it.tag.className = `ground-tag ${locked ? 'locked' : ''} ${left < 10_000 ? 'soon' : ''}`;
      // Parpadea los últimos 10 segundos
      it.spin.visible = left > 10_000 || Math.sin(t * 10) > -0.3;
    }
  }
}

// Miniatura de un diseño en el piso (unos 45 cm): la estampa como un cartelito, el cuadro chiquito y el
// objeto 3D achicado (se carga en segundo plano)
const MINI = 0.45;
function designMini(d) {
  const g = new THREE.Group();
  if (d.kind === 'cuadro') return miniFurniture('disenoCuadro', '#141414', MINI, { design: d });
  if (d.kind === 'estampa') {
    const k = MINI / Math.max(d.w || 1, d.h || 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, alphaTest: 0.05 });
    new THREE.TextureLoader().loadAsync(designFileUrl(d.id)).then((t) => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; }).catch(() => {});
    g.add(new THREE.Mesh(new THREE.PlaneGeometry((d.w || 1) * k, (d.h || 1) * k), mat));
    return g;
  }
  loadGLTF(designFileUrl(d.id, 'model')).then((gltf) => {
    const obj = fitDesignModel(gltf.scene, d);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = MINI / Math.max(size.x, size.y, size.z, 0.01);
    obj.scale.setScalar(k);
    obj.position.copy(c).multiplyScalar(-k);
    g.add(obj);
  }).catch(() => {});
  return g;
}

// Consumibles en el piso: un vaso (trago) o una taza (café), grandes para que se vean
function drinkMini(type) {
  const g = new THREE.Group();
  const color = CONSUMABLES[type]?.color ?? '#ffffff';
  if (type === 'cafe') {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.22, 24), white));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 20), white);
    handle.position.x = 0.12;
    g.add(handle);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color, roughness: 0.3 }));
    coffee.position.y = 0.1;
    g.add(coffee);
  } else {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.26, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.2, transparent: true, opacity: 0.9 })));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.3, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.3 })));
  }
  return g;
}
