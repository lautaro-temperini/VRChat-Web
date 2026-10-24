import * as THREE from 'three';
import { POSE } from './avatar.js';

// Brazos y manos que se ven en primera persona (estilo cámara GoPro).
// Son el antebrazo y la mano del propio personaje (MakeHuman): se recortan del cuerpo y de la prenda de
// arriba (la manga, si es larga) y usan los mismos materiales, así tienen el mismo tono de piel, peso y ropa.
// Viven en una escena aparte que se dibuja encima del mundo, así nunca atraviesan una pared.

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const ARM_BONES = (s) => new RegExp(`^(lowerarm|hand|thumb_0\\d|index_0\\d|middle_0\\d|ring_0\\d|pinky_0\\d)_${s}$`);

// Copia de la geometría con solo los triángulos que mueve el antebrazo / la mano de un lado
function armPiece(mesh, side) {
  const g = mesh.geometry;
  const { skinIndex, skinWeight } = g.attributes;
  if (!skinIndex) return null;
  const re = ARM_BONES(side);
  const bones = mesh.skeleton.bones;
  const keep = new Uint8Array(skinIndex.count);
  for (let i = 0; i < skinIndex.count; i++) {
    let best = 0, bi = 0;
    for (let k = 0; k < 4; k++) { const w = skinWeight.getComponent(i, k); if (w > best) { best = w; bi = skinIndex.getComponent(i, k); } }
    keep[i] = re.test(bones[bi]?.name ?? '') ? 1 : 0;
  }
  const src = g.index ? g.index.array : [...Array(skinIndex.count).keys()];
  const idx = [];
  for (let t = 0; t < src.length; t += 3) {
    if (keep[src[t]] && keep[src[t + 1]] && keep[src[t + 2]]) idx.push(src[t], src[t + 1], src[t + 2]);
  }
  if (!idx.length) return null;
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) if (k !== 'skinIndex' && k !== 'skinWeight') out.setAttribute(k, a);
  out.morphAttributes = g.morphAttributes;
  out.morphTargetsRelative = g.morphTargetsRelative;
  out.setIndex(idx);
  const piece = new THREE.Mesh(out, mesh.material);
  piece.userData.source = mesh;
  piece.updateMorphTargets();
  return piece;
}

export class FPArms {
  constructor(avatar) {
    this.avatar = avatar;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x6a5040, 1.5));
    const key = new THREE.DirectionalLight(0xffe2b8, 1.8);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key);

    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.hold = new THREE.Group();
    this.rig.add(this.hold);
    this.reach = 0;
    this.time = 0;
    this.built = null; // qué cuerpo y prendas se usaron (para rehacer al cambiar)

    // side -1 = izquierda de la pantalla (mano izquierda del personaje, que en el modelo está en +X)
    this.arms = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.2, -0.24, -0.03);
      this.hold.add(pivot);
      const roll = new THREE.Group(); // gira para que la palma quede hacia abajo
      roll.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const aim = new THREE.Group();  // el brazo en pose T apunta a ±X: lo paso a -Y (hacia abajo del pivote)
      aim.rotation.z = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      const holder = new THREE.Group(); // corre la malla para que el codo quede en el pivote
      pivot.add(roll);
      roll.add(aim);
      aim.add(holder);
      return { side, pivot, holder, bone: side < 0 ? 'l' : 'r', pieces: [] };
    });
  }

  // Rehace los antebrazos si cambió el cuerpo o la prenda de arriba
  syncLook() {
    const av = this.avatar, m = av.model;
    if (!m?.body) return;
    const top = av.hairMeshes.find((h) => h.userData.style === 'top');
    const key = `${m.type}|${m.body.uuid}|${top?.geometry.uuid ?? ''}`;
    if (key === this.built) return;
    this.built = key;
    for (const a of this.arms) {
      for (const p of a.pieces) { p.removeFromParent(); p.geometry.dispose(); }
      a.pieces = [];
      const elbow = m.rig.bones[`lowerarm_${a.bone}`]?.worldPos;
      if (!elbow) continue;
      a.holder.position.copy(elbow).negate();
      for (const src of [m.body, top]) {
        if (!src) continue;
        const piece = armPiece(src, a.bone);
        if (piece) { a.holder.add(piece); a.pieces.push(piece); }
      }
    }
  }

  // Estira la mano derecha al interactuar con algo
  poke() { this.reach = 1; }

  update(dt, camera, { speed, pose, phase }) {
    this.syncLook(); // el modelo y la ropa cargan en segundo plano
    this.time += dt;
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
    // Las mismas formas de peso y músculo que el cuerpo y la ropa
    for (const a of this.arms) {
      for (const p of a.pieces) {
        const inf = p.userData.source.morphTargetInfluences;
        if (inf && p.morphTargetInfluences) for (let i = 0; i < inf.length; i++) p.morphTargetInfluences[i] = inf[i];
      }
    }

    const grounded = pose === POSE.stand || pose === POSE.crouch;
    const am = grounded ? Math.min(speed / 4.5, 1) : 0;
    const sprint = THREE.MathUtils.clamp((speed - 5.2) / 1.5, 0, 1) * am;
    const air = pose === POSE.air ? 1 : 0;
    const climb = pose === POSE.climb ? 1 : 0;
    this.reach = damp(this.reach, 0, 4, dt);

    // Balanceo de cámara en mano: al caminar, respirar y caer
    const bx = Math.sin(phase) * 0.014 * am;
    const by = -Math.abs(Math.cos(phase)) * 0.018 * am + Math.sin(this.time * 1.7) * 0.004 + air * 0.03;
    this.hold.position.x = damp(this.hold.position.x, bx, 12, dt);
    this.hold.position.y = damp(this.hold.position.y, by + climb * 0.18, 12, dt);

    for (const a of this.arms) {
      const pump = Math.sin(phase) * a.side * 0.07 * (0.4 + sprint) * am;
      const reach = a.side > 0 ? this.reach : 0;
      // El brazo apunta hacia adelante (-Z), apenas hacia arriba y hacia adentro:
      // así las manos asoman abajo del cuadro, como en una cámara GoPro
      const tx = Math.PI / 2 + 0.08 + pump * 1.5 + reach * 0.3 + climb * 0.9 + air * 0.15;
      a.pivot.rotation.x = damp(a.pivot.rotation.x, tx, 14, dt);
      a.pivot.rotation.z = damp(a.pivot.rotation.z, -a.side * (0.24 + air * 0.25), 14, dt);
      a.pivot.position.z = damp(a.pivot.position.z, -0.03 - pump - reach * 0.14, 14, dt);
    }
  }
}
