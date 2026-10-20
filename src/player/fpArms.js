import * as THREE from 'three';
import { POSE } from './avatar.js';

// Brazos y manos que se ven en primera persona (estilo cámara GoPro).
// Viven en una escena aparte que se dibuja encima del mundo, así nunca
// atraviesan una pared aunque estés pegado a ella.

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

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
  return new THREE.LatheGeometry(pts, 24);
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

    const M = avatar.mats;
    const sphere = new THREE.SphereGeometry(1, 24, 16);
    this.arms = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.23, -0.27, -0.03);
      this.hold.add(pivot);
      const fore = new THREE.Mesh(taper(0.046, 0.037, 0.3), M.skin);
      const cuff = new THREE.Mesh(taper(0.056, 0.049, 0.22), M.shirt);
      pivot.add(fore, cuff);
      const hand = new THREE.Group();
      hand.position.y = -0.3;
      pivot.add(hand);
      const palm = new THREE.Mesh(sphere, M.skin);
      palm.scale.set(0.038, 0.055, 0.026);
      palm.position.y = -0.04;
      const thumb = new THREE.Mesh(taper(0.014, 0.012, 0.055), M.skin);
      thumb.position.set(-side * 0.015, -0.015, 0.022);
      thumb.rotation.set(-0.5, 0, -side * 0.25);
      hand.add(palm, thumb);
      return { side, pivot, cuff };
    });
  }

  // Llamar cuando cambia la ropa (remera = brazo descubierto, buzo = manga)
  syncLook() {
    for (const a of this.arms) a.cuff.visible = this.avatar.look.top === 'buzo';
  }

  // Estira la mano derecha al interactuar con algo
  poke() { this.reach = 1; }

  update(dt, camera, { speed, pose, phase }) {
    this.time += dt;
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);

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
