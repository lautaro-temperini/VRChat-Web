import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Modelos de los objetos equipables. Cada uno se arma en coordenadas de la
// parte del cuerpo donde va: 'head' (centro de la cabeza) o 'chest' (torso).

const sphere = (r, mat, tMax = Math.PI) => new THREE.Mesh(new THREE.SphereGeometry(r, 32, 18, 0, Math.PI * 2, 0, tMax), mat);
function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

export function buildAccessory(type, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.3 });
  let part = 'head';

  switch (type) {
    case 'cap': {
      const dome = at(sphere(0.136, mat, Math.PI * 0.5), 0, 0.03, -0.005);
      dome.scale.set(1, 0.85, 1.05);
      const brim = at(new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.012, 40), mat), 0, 0.04, 0.125);
      brim.scale.set(1, 1, 1.25);
      brim.rotation.x = -0.12;
      g.add(dome, brim, at(sphere(0.014, mat), 0, 0.146, -0.005));
      break;
    }
    case 'beanie': {
      const dome = at(sphere(0.138, mat, Math.PI * 0.55), 0, 0.02, -0.005);
      dome.scale.set(1, 1.15, 1.05);
      const fold = at(new THREE.Mesh(new THREE.TorusGeometry(0.133, 0.024, 12, 40), mat), 0, 0.03, -0.005);
      fold.rotation.x = Math.PI / 2;
      fold.scale.set(1, 1.05, 1);
      g.add(dome, fold, at(sphere(0.036, mat), 0, 0.178, -0.01));
      break;
    }
    case 'crown': {
      const band = at(new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.102, 0.06, 40, 1, true), metal), 0, 0.12, 0);
      band.material.side = THREE.DoubleSide;
      g.add(band);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const spike = at(new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 12), metal), Math.sin(a) * 0.108, 0.178, Math.cos(a) * 0.108);
        const gem = at(sphere(0.011, new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe63946 : 0x3a7bd5, roughness: 0.1, metalness: 0.3 })), Math.sin(a) * 0.112, 0.12, Math.cos(a) * 0.112);
        g.add(spike, gem);
      }
      break;
    }
    case 'headphones': {
      const band = at(new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.013, 10, 40, Math.PI), mat), 0, 0.0, -0.01);
      g.add(band);
      for (const s of [-1, 1]) {
        const cup = at(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.038, 32), mat), s * 0.135, -0.005, -0.01);
        cup.rotation.z = Math.PI / 2;
        const pad = at(new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 8, 24), dark), s * 0.115, -0.005, -0.01);
        pad.rotation.y = Math.PI / 2;
        g.add(cup, pad);
      }
      break;
    }
    case 'sunglasses':
    case 'glasses': {
      const frame = type === 'glasses' ? metal : mat;
      const lensMat = type === 'sunglasses'
        ? new THREE.MeshStandardMaterial({ color: 0x0a0a0f, roughness: 0.05, metalness: 0.6 })
        : new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.05, transparent: true, opacity: 0.25 });
      for (const s of [-1, 1]) {
        if (type === 'sunglasses') {
          g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.056, 0.034, 0.012, 3, 0.008), lensMat), s * 0.043, 0.016, 0.122));
          g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.062, 0.008, 0.014, 2, 0.003), frame), s * 0.043, 0.035, 0.123));
        } else {
          const rim = at(new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0035, 8, 32), frame), s * 0.043, 0.016, 0.124);
          const lens = at(new THREE.Mesh(new THREE.CircleGeometry(0.023, 24), lensMat), s * 0.043, 0.016, 0.123);
          g.add(rim, lens);
        }
        const arm = at(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.12), frame), s * 0.112, 0.022, 0.065);
        arm.rotation.y = s * 0.12;
        g.add(arm);
      }
      g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.006, 0.006), frame), 0, 0.024, 0.125));
      break;
    }
    case 'chain': {
      part = 'chest';
      const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 10, 48), metal), 0, 1.43, 0.02);
      ring.rotation.x = Math.PI / 2 - 0.55;
      ring.scale.set(1.15, 1, 1);
      const coin = at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 28), metal), 0, 1.36, 0.14);
      coin.rotation.x = Math.PI / 2 - 0.2;
      g.add(ring, coin);
      break;
    }
    case 'backpack': {
      part = 'chest';
      g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.34, 0.13, 4, 0.05), mat), 0, 1.2, -0.19));
      g.add(at(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.12, 0.04, 3, 0.02), mat), 0, 1.11, -0.265));
      for (const s of [-1, 1]) {
        const strap = at(new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.32, 0.018, 2, 0.008), dark), s * 0.09, 1.25, 0.125);
        strap.rotation.x = -0.08;
        const over = at(new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.018, 0.25, 2, 0.008), dark), s * 0.09, 1.415, -0.01);
        g.add(strap, over);
      }
      break;
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, part };
}
