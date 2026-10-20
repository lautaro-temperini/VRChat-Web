import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildAccessory } from './accessories.js';
import { ITEMS, EMOTES } from '../../server/shared.js';
import { LOCO, locomotionClips, gestureClip } from './anims.js';

// Personaje realista estilizado (modelos de Quaternius, CC0), mira hacia +Z.
// El cuerpo y el pelo se cargan en segundo plano; mientras tanto el personaje
// no se ve, pero la interfaz (setLook / setEquip / update) funciona igual.
// La ropa no es un modelo aparte: el sombreador pinta cada parte del cuerpo
// (torso, brazos, piernas, pies) con el color elegido, según qué hueso la mueve.

export const DEFAULT_LOOK = {
  body: 'masc', skin: '#d9a07a', hair: '#3b2416', hairStyle: 'corto', beard: false, eyes: '#4a3020',
  top: 'buzo', shirt: '#ff7a3d', pants: '#2b3445', shoes: '#f4f4f4',
  height: 1.75, build: 1,
};

export const LOOK_OPTIONS = {
  body: ['masc', 'fem'],
  skin: ['#ffe0c7', '#f1c09b', '#d9a07a', '#b97a52', '#8d5534', '#5c3520'],
  hair: ['#151010', '#3b2416', '#7a4a26', '#c98d4a', '#f2d48a', '#e8e8e8', '#d63a3a', '#3a7bd5', '#ff6fb5', '#5ad17a'],
  hairStyle: ['corto', 'largo', 'rapado', 'rodete'],
  beard: [false, true],
  eyes: ['#4a3020', '#2e6b8a', '#3d7a3d', '#8a6a2a', '#1d1d1d', '#8a4be2'],
  top: ['remera', 'buzo'],
  shirt: ['#f4f4f4', '#1d1d22', '#ff7a3d', '#3a7bd5', '#e63946', '#2a9d8f', '#ffd23f', '#8a4be2', '#ff6fb5', '#5ad17a'],
  pants: ['#2b3445', '#1d1d22', '#4b6a8f', '#7a6a55', '#3d5a3a', '#e8e1d0', '#8a3a3a'],
  shoes: ['#f4f4f4', '#1d1d22', '#ff7a3d', '#3a7bd5', '#e63946', '#ffd23f'],
};

// Peinados del personaje viejo que no existen en el pack: se muestran como el más
// parecido, pero el dato guardado no se toca (así se pueden recuperar más adelante).
const LEGACY_HAIR = { rulos: 'corto', coleta: 'rodete' };

const BASE = `${import.meta.env.BASE_URL}models/quaternius/`;
// Dónde van los objetos equipados (en metros del modelo, en pose de reposo):
// head = gorros y auriculares, face = anteojos, chest = cadena y mochila
const BODIES = {
  masc: { file: 'body/Superhero_Male_FullBody.gltf', height: 1.81, head: [0, 1.71, 0.012, 1.04], face: [0, 1.685, 0.012, 1.04], chest: [0, 0, -0.01, 1.05] },
  fem: { file: 'body/Superhero_Female_FullBody.gltf', height: 1.767, head: [0, 1.665, 0.02, 1], face: [0, 1.63, 0.012, 0.92], chest: [0, 0, 0, 0.95] },
};
const HAIR_FILES = {
  corto: 'Hair_SimpleParted', largo: 'Hair_Long', rodete: 'Hair_Buns',
  rapado: { masc: 'Hair_Buzzed', fem: 'Hair_BuzzedFemale' },
};

// ---------- Carga de modelos (una sola vez por archivo) ----------
const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager);
const cache = new Map();
let lowRes = false;
// En calidad baja (celulares) se usan las texturas de 1K en lugar de las de 2K
export function setTextureQuality(quality) { lowRes = quality === 'low'; }
manager.setURLModifier((url) => (lowRes ? url.replace('/textures/', '/textures/1k/') : url));
function load(file) {
  if (!cache.has(file)) cache.set(file, loader.loadAsync(BASE + file).then(prepare));
  return cache.get(file);
}

// Partes del cuerpo según el hueso: 0 piel, 1 torso, 2 brazo, 3 pierna, 4 pie
function partOf(bone) {
  if (/^(Head|neck|hand|index|middle|ring|pinky|thumb)/.test(bone)) return 0;
  if (/^(spine|clavicle)/.test(bone)) return 1;
  if (/^(upperarm|lowerarm)/.test(bone)) return 2;
  if (/^(pelvis|thigh|calf|root)/.test(bone)) return 3;
  return 4;
}

// Se ejecuta una vez por archivo: guarda en la geometría a qué parte pertenece cada vértice
function prepare(gltf) {
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.material.vertexColors = false; // los colores de vértice del pack vienen en blanco
    if (!/Superhero/i.test(o.material.name)) return;
    const { skinIndex, skinWeight, position } = o.geometry.attributes;
    const bones = o.skeleton.bones;
    const arm = { x0: bones.find((b) => b.name === 'upperarm_l'), x1: bones.find((b) => b.name === 'hand_l') };
    const x0 = arm.x0.getWorldPosition(new THREE.Vector3()).x, x1 = arm.x1.getWorldPosition(new THREE.Vector3()).x;
    const part = new Float32Array(position.count * 2);
    const sums = new Float32Array(5);
    for (let i = 0; i < position.count; i++) {
      sums.fill(0);
      for (let k = 0; k < 4; k++) sums[partOf(bones[skinIndex.getComponent(i, k)].name)] += skinWeight.getComponent(i, k);
      let best = 0;
      for (let p = 1; p < 5; p++) if (sums[p] > sums[best]) best = p;
      part[i * 2] = best;
      part[i * 2 + 1] = (Math.abs(position.getX(i)) - x0) / (x1 - x0); // 0 hombro … 1 muñeca
    }
    o.geometry.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
    const bone = (n) => bones.find((b) => b.name === n).getWorldPosition(new THREE.Vector3());
    gltf.userData.neckY = bone('neck_01').y + 0.01;
    gltf.userData.shoeY = bone('foot_l').y + 0.035;
  });
  return gltf;
}

// ---------- Materiales ----------
const toLinear = (hex) => new THREE.Color(hex);
// Tono medio de piel de las texturas del pack: se usa para recolorear la piel
const REF_SKIN = { masc: toLinear('#a97350'), fem: toLinear('#aa7752') };

function bodyMaterial(base, uniforms) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aPart;
        uniform float uSleeve, uNeckY, uShoeY;
        varying vec4 vCloth; // torso, piernas, pies, (sin usar)`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float p = aPart.x;
        vec4 c = vec4(0.0);
        if (position.y < uShoeY || p > 3.5) c.z = 1.0;
        else if (p > 2.5) c.y = 1.0;
        else if (p > 1.5) c.x = step(aPart.y, uSleeve);
        else if (p > 0.5) c.x = step(position.y, uNeckY);
        vCloth = c;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkin, uRefSkin, uShirt, uPants, uShoes;
        varying vec4 vCloth;`)
      .replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        vec3 detail = texel.rgb / uRefSkin;
        // La ropa toma solo un poco del detalle de la piel (y nada del color)
        float shade = mix(1.0, clamp(dot(detail, vec3(0.333)), 0.6, 1.3), 0.35);
        vec3 cloth = (uShirt * vCloth.x + uPants * vCloth.y + uShoes * vCloth.z) * shade;
        float covered = clamp(vCloth.x + vCloth.y + vCloth.z, 0.0, 1.0);
        diffuseColor.rgb *= mix(detail * uSkin, cloth, covered);`)
      // La ropa disimula la musculatura: se aplana el relieve del mapa de normales
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, covered * 0.75));`);
  };
  m.customProgramCacheKey = () => 'avatar-body';
  return m;
}

function eyeMaterial(base, uniforms) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uEye = uniforms.uEye;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEye;')
      .replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        // El iris está en el centro de la textura; la pupila (oscura) no se tiñe
        float l = dot(texel.rgb, vec3(0.333));
        float iris = (1.0 - smoothstep(0.062, 0.075, distance(vMapUv, vec2(0.5, 0.53)))) * smoothstep(0.02, 0.05, l);
        diffuseColor.rgb *= mix(texel.rgb, uEye * clamp(l * 6.0, 0.4, 1.6), iris);`);
  };
  m.customProgramCacheKey = () => 'avatar-eyes';
  return m;
}

// ---------- Huesos ----------
// Las rotaciones se escriben "en el espacio del modelo en reposo" (X = adelante/atrás,
// Z = hacia los costados), igual que el personaje anterior, y acá se pasan a cada hueso.
const _q = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _e = new THREE.Euler();
const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
// De pose T a brazos abajo
const ARM_DOWN = { [-1]: qz(Math.PI / 2), 1: qz(-Math.PI / 2) };
const ARM_DOWN_INV = { [-1]: ARM_DOWN[-1].clone().invert(), 1: ARM_DOWN[1].clone().invert() };

class Rig {
  constructor(scene) {
    scene.updateMatrixWorld(true);
    this.bones = {};
    scene.traverse((o) => {
      if (!o.isBone) return;
      const world = o.getWorldQuaternion(new THREE.Quaternion());
      const parentInv = o.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const worldPos = o.getWorldPosition(new THREE.Vector3());
      this.bones[o.name] = { bone: o, rest: o.quaternion.clone(), restPos: o.position.clone(), world, inv: world.clone().invert(), parentInv, worldPos };
    });
  }
  // local = reposo · W⁻¹ · D · W  (D en el espacio del modelo)
  set(name, d) {
    const b = this.bones[name];
    b.bone.quaternion.copy(b.rest).multiply(_q.copy(b.inv).multiply(d).multiply(b.world));
  }
  euler(name, x, y, z) { this.set(name, _qe.setFromEuler(_e.set(x, y, z))); }
  // Escala (x, 1, z) un hueso del torso y deshace ese ensanche en los hijos que cuelgan
  // de él (brazos, cuello), así crecen los hombros pero no se deforman brazos ni cabeza
  widen(name, w, children) {
    const a = this.bones[name];
    a.bone.scale.set(w, 1, w);
    for (const n of children) {
      const c = this.bones[n];
      const f = (axis) => {
        const d = axis.applyQuaternion(c.world).applyQuaternion(a.inv);
        return 1 / Math.hypot(d.x * w, d.y, d.z * w);
      };
      c.bone.scale.set(f(new THREE.Vector3(1, 0, 0)), f(new THREE.Vector3(0, 1, 0)), f(new THREE.Vector3(0, 0, 1)));
    }
  }
  // Objeto que, colgado del hueso, usa coordenadas del modelo en reposo
  holder(name, origin) {
    const b = this.bones[name];
    const g = new THREE.Group();
    const bonePos = b.bone.getWorldPosition(new THREE.Vector3());
    g.quaternion.copy(b.inv);
    g.position.copy(new THREE.Vector3().fromArray(origin).sub(bonePos).applyQuaternion(b.inv));
    b.bone.add(g);
    return g;
  }
}

export const POSE = { stand: 0, crouch: 1, sit: 2, climb: 3, air: 4 };

// Gestos hechos por código: aplaudir (no hay animación) y los demás mientras cargan las animaciones.
// Devuelven ángulos de los brazos [derecho, izquierdo] y del cuerpo, con la misma convención de update().
const GESTURES = {
  saludar: (t) => ({ sx: [-0.3, 0], sz: [-(2.55 + 0.28 * Math.sin(t * 11)), 0.1], el: [-0.25, -0.2] }),
  aplaudir: (t) => {
    const c = Math.abs(Math.sin(t * 8));
    return { sx: [-0.95, -0.95], sz: [0.4 - 0.16 * c, -0.4 + 0.16 * c], el: [-1.25, -1.25] };
  },
  senalar: () => ({ sx: [-1.5, 0], sz: [-0.08, 0.1], el: [0, -0.2] }),
  bailar: (t) => {
    const b = t * 6.3;
    return {
      sx: [-2.5 + 0.45 * Math.sin(b), -2.5 - 0.45 * Math.sin(b)], sz: [-0.45, 0.45], el: [-0.6, -0.6],
      y: -0.05 * Math.abs(Math.sin(b)), tilt: Math.sin(b / 2) * 0.12, knee: 0.25 * Math.abs(Math.sin(b)),
    };
  },
};
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const mix = (a, b, t) => a + (b - a) * t;

// Para que los rayos (E / click) no tengan que recorrer la malla animada
const noRaycast = () => {};

export class Avatar {
  constructor(look = DEFAULT_LOOK, equip = []) {
    this.root = new THREE.Group();
    this.phase = 0;
    this.amount = 0;
    this.time = Math.random() * 10;
    this.weights = { stand: 1, crouch: 0, sit: 0, climb: 0, air: 0 };
    this.j = { hip: [0, 0], knee: [0, 0], sx: [0, 0], sz: [0, 0], el: [0, 0], y: 0, lean: 0, tilt: 0, neck: 0 };
    this.scale = 1;
    this.gest = null;   // gesto en curso: { name, t, action? }
    this.talking = false; // hablando por voz: usa la animación de hablar cuando está quieto
    this.gestW = 0;     // cuánto pesa el gesto (para entrar y salir suave)
    this.gestPose = null;
    this.model = null;  // { scene, rig, gltf, meshes, body }
    this.hairMeshes = [];
    this.accessories = [];
    this.equip = [];

    // Materiales "de referencia": los usan los brazos de primera persona y guardan los colores
    const std = (roughness) => new THREE.MeshStandardMaterial({ roughness });
    this.mats = { skin: std(0.5), hair: std(0.65), eyes: std(0.2), shirt: std(0.75), pants: std(0.8), shoes: std(0.45) };
    const M = this.mats;
    this.uniforms = {
      uSkin: { value: M.skin.color }, uShirt: { value: M.shirt.color }, uPants: { value: M.pants.color },
      uShoes: { value: M.shoes.color }, uEye: { value: M.eyes.color }, uRefSkin: { value: REF_SKIN.masc },
      uSleeve: { value: 1 }, uNeckY: { value: 1.5 }, uShoeY: { value: 0.1 },
    };

    // Caja invisible para apuntarle con la E / el click (más barata que la malla animada)
    this.hitbox = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.2, 4, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.88;
    this.root.add(this.hitbox);

    this.setLook(look);
    this.setEquip(equip);
  }

  // Objetos equipados: [{ type, color }]
  setEquip(list = []) {
    for (const a of this.accessories) {
      a.group.removeFromParent();
      a.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    this.equip = list;
    this.accessories = list.filter((it) => ITEMS[it.type]).map((it) => {
      const a = buildAccessory(it.type, it.color);
      a.group.traverse((o) => { if (o.isMesh) o.raycast = noRaycast; });
      return { ...a, type: it.type };
    });
    this.attachAccessories();
    this.setLook(this.look);
  }

  attachAccessories() {
    if (!this.model) return;
    const { anchors } = this.model;
    for (const a of this.accessories) anchors[a.part === 'chest' ? 'chest' : ITEMS[a.type].slot === 'face' ? 'face' : 'head'].add(a.group);
  }

  setLook(look) {
    this.look = { ...DEFAULT_LOOK, ...look };
    const L = this.look;
    for (const k of ['skin', 'hair', 'eyes', 'shirt', 'pants', 'shoes']) this.mats[k].color.set(L[k]);
    this.uniforms.uSleeve.value = L.top === 'buzo' ? 1.02 : 0.42;
    if (this.model?.type !== L.body) this.loadBody(L.body);
    else this.syncHair();
    if (this.model) this.applyBuild();
    const def = BODIES[L.body] ?? BODIES.masc;
    this.scale = L.height / 1.75;
    this.root.scale.setScalar(L.height / def.height);
  }

  async loadBody(type) {
    const def = BODIES[type] ?? BODIES.masc;
    this.loadingBody = type;
    const gltf = await load(def.file);
    if (this.disposed || this.loadingBody !== type) return;
    this.dropModel();

    const scene = SkeletonUtils.clone(gltf.scene);
    const meshes = [];
    let body = null;
    scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // la caja de la malla es la de reposo: al animarse puede cortarse
      o.raycast = noRaycast;
      const name = o.material.name;
      if (/Superhero/i.test(name)) { o.material = bodyMaterial(o.material, this.uniforms); body = o; }
      else if (/Eyes/i.test(name)) o.material = eyeMaterial(o.material, this.uniforms);
      else { o.material = o.material.clone(); o.material.color = this.mats.hair.color; o.userData.hair = true; } // cejas
      meshes.push(o);
    });
    this.uniforms.uRefSkin.value = REF_SKIN[type] ?? REF_SKIN.masc;
    this.uniforms.uNeckY.value = gltf.userData.neckY;
    this.uniforms.uShoeY.value = gltf.userData.shoeY;
    const rig = new Rig(scene);
    const anchor = (bone, [x, y, z, s]) => { const g = rig.holder(bone, [x, y, z]); g.scale.setScalar(s); return g; };
    const anchors = { head: anchor('Head', def.head), face: anchor('Head', def.face), chest: anchor('spine_03', def.chest) };
    const model = { type, scene, rig, gltf, meshes, body, anchors, anim: null, legY: rig.bones.thigh_l.bone.getWorldPosition(new THREE.Vector3()).y };
    this.model = model;
    // Animaciones: hasta que cargan, el personaje se mueve con la animación hecha por código
    locomotionClips(type, rig).then((clips) => {
      if (this.model !== model) return;
      const mixer = new THREE.AnimationMixer(scene);
      const actions = {};
      for (const [k, clip] of Object.entries(clips)) if (clip) actions[k] = mixer.clipAction(clip).setEffectiveWeight(0).play();
      model.anim = { mixer, actions, gesture: null };
      if (this.gest) this.gesture(this.gest.name); // un gesto que llegó antes de cargar
    }).catch((e) => console.warn('No se pudieron cargar las animaciones', e));
    this.root.add(scene);
    this.attachAccessories();
    this.applyBuild();
    this.syncHair();
  }

  // Peinado y barba: se cargan aparte y se enganchan al esqueleto del cuerpo
  async syncHair() {
    const m = this.model;
    if (!m) return;
    const L = this.look;
    const style = LEGACY_HAIR[L.hairStyle] ?? L.hairStyle;
    let file = HAIR_FILES[style] ?? HAIR_FILES.corto;
    if (typeof file === 'object') file = file[m.type];
    const files = [file, L.beard ? 'Hair_Beard' : null].filter(Boolean);
    const key = files.join('+');
    this.updateHairVisibility();
    if (m.hairKey === key) return;
    m.hairKey = key;
    const parts = await Promise.all(files.map((f) => load(`hair/${f}.gltf`)));
    if (this.disposed || this.model !== m || m.hairKey !== key) return;
    for (const h of this.hairMeshes) { h.removeFromParent(); h.material.dispose(); }
    this.hairMeshes = [];
    const skinBones = m.body.skeleton.bones;
    for (const [i, gltf] of parts.entries()) {
      gltf.scene.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const mesh = new THREE.SkinnedMesh(o.geometry, o.material.clone());
        mesh.material.color = this.mats.hair.color;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.raycast = noRaycast;
        mesh.userData.style = i === 0 ? style : 'barba';
        m.body.parent.add(mesh);
        mesh.bind(new THREE.Skeleton(skinBones, o.skeleton.boneInverses), m.body.bindMatrix);
        this.hairMeshes.push(mesh);
      });
    }
    this.updateHairVisibility();
  }

  // Con gorra o gorro no se ve el pelo corto (como en el personaje anterior)
  updateHairVisibility() {
    const hat = (this.equip ?? []).some((it) => ITEMS[it.type]?.slot === 'head' && it.type !== 'crown');
    for (const h of this.hairMeshes) h.visible = !(hat && h.userData.style === 'corto');
  }

  // Contextura: torso más ancho (hombros incluidos) y extremidades más gruesas
  applyBuild() {
    const R = this.model.rig, b = this.look.build;
    R.widen('spine_01', 0.6 + b * 0.4, ['clavicle_l', 'clavicle_r', 'neck_01']);
    const limb = 0.8 + b * 0.2;
    for (const n of ['upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r']) R.bones[n].bone.scale.set(limb, 1, limb);
  }

  dropModel() {
    const m = this.model;
    if (!m) return;
    for (const a of this.accessories) a.group.removeFromParent();
    for (const h of this.hairMeshes) h.material.dispose();
    for (const o of m.meshes) o.material.dispose();
    if (m.anim) { m.anim.mixer.stopAllAction(); m.anim.mixer.uncacheRoot(m.scene); }
    m.scene.removeFromParent();
    this.hairMeshes = [];
    this.model = null;
  }

  // Gestos (/saludar, /bailar…): se cortan al moverse; los que no son "loop" duran un rato
  gesture(name) {
    if (!EMOTES[name]) return;
    const g = { name, t: 0 };
    this.gest = g;
    const m = this.model;
    if (m?.anim?.gesture) { m.anim.gesture.stop(); m.anim.gesture = null; }
    if (!m) return;
    gestureClip(m.type, m.rig, name).then((clip) => {
      const A = m.anim;
      if (!clip || !A || this.gest !== g || this.model !== m) return;
      const action = A.mixer.clipAction(clip);
      action.setLoop(EMOTES[name].loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.reset().setEffectiveWeight(0).play();
      g.action = action;
      g.dur = clip.duration;
      A.gesture = action;
    });
  }

  // motion: { speed (m/s), pose (POSE.*), turn (rad/s, para inclinarse en curvas), landing (0..1) }
  update(dt, { speed = 0, pose = POSE.stand, turn = 0, landing = 0 } = {}) {
    this.time += dt;
    const w = this.weights;
    for (const [name, id] of Object.entries(POSE)) w[name] = damp(w[name], pose === id ? 1 : 0, 12, dt);
    const grounded = pose === POSE.stand || pose === POSE.crouch;
    this.amount = damp(this.amount, grounded ? Math.min(speed / 4.5, 1.4) : 0, 10, dt);
    const a = this.amount, am = Math.min(a, 1);
    const sprint = THREE.MathUtils.clamp((speed - 5.2) / 1.5, 0, 1) * am;
    this.phase += dt * speed * (pose === POSE.crouch ? 3.4 : 2.3) / this.scale;
    const { crouch, sit, climb, air } = w;
    const k = 18; // qué tan rápido siguen las articulaciones a su pose
    const J = this.j;

    const G = this.gest;
    if (G) {
      G.t += dt;
      const def = EMOTES[G.name];
      const dur = G.dur ?? def.dur ?? 2;
      if (speed > 0.5 || pose !== POSE.stand || (!def.loop && G.t > dur - 0.25)) this.gest = null;
      else this.gestPose = (GESTURES[G.name] ?? (def.dance ? GESTURES.bailar : GESTURES.saludar))(G.t);
    }
    this.gestW = damp(this.gestW, this.gest ? 1 : 0, 8, dt);
    const gw = this.gestPose ? this.gestW : 0;
    const gp = this.gestPose ?? {};

    [-1, 1].forEach((side, i) => {
      const ph = this.phase + (side > 0 ? 0 : Math.PI);
      const amp = (0.5 + 0.35 * sprint) * am * (1 - crouch * 0.45);
      let hip = -Math.sin(ph) * amp + crouch * -0.95;
      let knee = Math.max(0, -Math.cos(ph)) * (0.85 + 0.65 * sprint) * am + 0.1 * am + crouch * 1.85;
      hip = mix(hip, -0.35 - side * 0.35, air);
      knee = mix(knee, 0.7 + side * 0.5, air);
      hip = mix(hip, -1.25 + side * 0.2, climb);
      knee = mix(knee, 1.7, climb);
      hip = mix(hip, -1.55, sit);
      knee = mix(knee, 1.55, sit);
      knee = mix(knee, gp.knee ?? knee, gw);
      J.hip[i] = damp(J.hip[i], hip, k, dt);
      J.knee[i] = damp(J.knee[i], knee, k, dt);
    });

    const idle = Math.sin(this.time * 1.6) * 0.03 * (1 - am);
    [-1, 1].forEach((side, i) => {
      const swing = Math.sin(this.phase) * side * (0.65 + 0.5 * sprint) * am;
      let sx = swing + idle + crouch * -0.3;
      let sz = side * (0.08 + 0.05 * am);
      let el = -(0.2 + 0.55 * am + 0.75 * sprint) - crouch * 0.5;
      sx = mix(sx, -0.5, air); sz = mix(sz, side * 0.85, air); el = mix(el, -0.6, air);
      sx = mix(sx, -2.75, climb); sz = mix(sz, side * 0.2, climb); el = mix(el, -0.35, climb);
      sx = mix(sx, -0.45, sit); sz = mix(sz, side * 0.12, sit); el = mix(el, -0.95, sit);
      if (gw > 0.001) { sx = mix(sx, gp.sx[i], gw); sz = mix(sz, gp.sz[i], gw); el = mix(el, gp.el[i], gw); }
      J.sx[i] = damp(J.sx[i], sx, k, dt);
      J.sz[i] = damp(J.sz[i], sz, k, dt);
      J.el[i] = damp(J.el[i], el, k, dt);
    });

    // Cuerpo: rebote, inclinación al correr, curvas y aterrizajes
    const lean = 0.05 * am + 0.2 * sprint + crouch * 0.35 + climb * 0.35;
    const bob = Math.abs(Math.sin(this.phase)) * (0.035 + 0.03 * sprint) * am;
    J.y = damp(J.y, bob - crouch * 0.36 - sit * 0.42 - landing * 0.12 + (gp.y ?? 0) * gw, 20, dt);
    J.lean = damp(J.lean, lean, 10, dt);
    J.tilt = damp(J.tilt, THREE.MathUtils.clamp(-turn * 0.07, -0.22, 0.22) * am + (gp.tilt ?? 0) * gw, 8, dt);
    J.neck = damp(J.neck, -lean * 0.7, 10, dt);
    if (this.model?.anim) this.animate(dt, speed, gw);
    else this.applyPose(J, am);
  }

  // Con las animaciones cargadas: mezcla según velocidad y pose, más el gesto encima
  animate(dt, speed, gw) {
    const m = this.model, A = m.anim, w = this.weights, R = m.rig, J = this.j;
    // Gesto con animación: entra y sale suave con gestW (el de código, aplaudir, se aplica después)
    if (!this.gest && A.gesture && this.gestW < 0.01) { A.gesture.stop(); A.gesture = null; }
    const ga = A.gesture ? this.gestW : 0;

    const base = 1 - ga;
    const target = {};
    for (const k of Object.keys(LOCO)) target[k] = 0;
    const stand = blend(speed, [[0, 'idle'], [1.6, 'walk'], [3, 'jog'], [4.6, 'sprint']]);
    if (this.talking) { stand.talk = stand.idle; stand.idle = 0; }
    for (const [k, v] of Object.entries(stand)) target[k] += v * w.stand;
    const crouch = blend(speed, [[0, 'crouch'], [1, 'crouchWalk']]);
    for (const [k, v] of Object.entries(crouch)) target[k] += v * w.crouch;
    target.air += w.air;
    target.climb += w.climb;
    // Trepar dura lo que tarda el juego en subirte (0,42 s): la animación arranca de cero cada vez
    if (A.actions.climb) {
      if (w.climb > 0.5 && !A.climbing) { A.climbing = true; A.actions.climb.reset(); A.actions.climb.timeScale = A.actions.climb.getClip().duration / 0.5; }
      if (w.climb < 0.1) A.climbing = false;
    }
    target.sit += w.sit;
    A.w ??= {};
    for (const [k, action] of Object.entries(A.actions)) {
      A.w[k] = damp(A.w[k] ?? 0, target[k], k === 'talk' || k === 'idle' ? 4 : 14, dt); // hablar entra y sale despacio
      action.setEffectiveWeight(A.w[k] * base);
      const s = LOCO[k].speed;
      if (s) action.timeScale = THREE.MathUtils.clamp(speed / s / this.scale, 0.6, 2.5);
    }
    if (A.gesture) A.gesture.setEffectiveWeight(ga);
    A.mixer.update(dt);

    // Gesto hecho por código (aplaudir, o mientras carga la animación): pisa los brazos
    if (gw > 0.001 && !A.gesture) {
      const saved = ARM_BONES.map((n) => R.bones[n].bone.quaternion.clone());
      [['l', 1], ['r', -1]].forEach(([s, side]) => {
        const i = side > 0 ? 1 : 0;
        R.set(`upperarm_${s}`, _q2.setFromEuler(_e.set(J.sx[i], 0, J.sz[i])).multiply(ARM_DOWN[side]));
        R.set(`lowerarm_${s}`, _q3.copy(ARM_DOWN_INV[side]).multiply(qx(J.el[i])).multiply(ARM_DOWN[side]));
      });
      ARM_BONES.forEach((n, k) => { const b = R.bones[n].bone; b.quaternion.copy(saved[k].slerp(b.quaternion, gw)); });
    }
    // Inclinarse en las curvas y el golpe al aterrizar (la raíz no la mueven las animaciones)
    const root = R.bones.root;
    root.bone.position.copy(root.restPos).add(_v.set(0, Math.min(J.y, 0) * 0.5, 0).applyQuaternion(root.parentInv));
    R.euler('root', 0, 0, J.tilt);
  }

  // Pasa los ángulos a los huesos del modelo
  applyPose(J, am) {
    const m = this.model;
    if (!m) return;
    const R = m.rig;
    const legRatio = m.legY / 0.92; // el personaje anterior tenía la cadera a 0,92 m
    const root = R.bones.root;
    // El hueso raíz está en un marco con Z hacia arriba: el desplazamiento se pasa a ese marco
    root.bone.position.copy(root.restPos).add(_v.set(0, J.y * legRatio, 0).applyQuaternion(root.parentInv));
    R.euler('root', J.lean, 0, J.tilt);
    R.euler('spine_02', 0, Math.sin(this.phase) * 0.12 * am, 0);
    R.euler('neck_01', J.neck, Math.sin(this.time * 0.4) * 0.18 * (1 - am) * (1 - this.weights.sit * 0.5), 0);
    [['l', 1], ['r', -1]].forEach(([s, side]) => {
      const i = side > 0 ? 1 : 0;
      R.set(`thigh_${s}`, qx(J.hip[i]));
      R.set(`calf_${s}`, qx(J.knee[i]));
      R.set(`upperarm_${s}`, _q2.setFromEuler(_e.set(J.sx[i], 0, J.sz[i])).multiply(ARM_DOWN[side]));
      R.set(`lowerarm_${s}`, _q3.copy(ARM_DOWN_INV[side]).multiply(qx(J.el[i])).multiply(ARM_DOWN[side]));
    });
  }

  dispose() {
    this.disposed = true;
    this.dropModel();
    for (const m of Object.values(this.mats)) m.dispose();
    this.hitbox.geometry.dispose();
    this.hitbox.material.dispose();
    for (const a of this.accessories) a.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
const _v = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const ARM_BONES = ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r'];

// Pesos para mezclar animaciones según un valor (ej. velocidad): [[valor, nombre], …] ordenados
function blend(x, points) {
  const out = {};
  for (const [, n] of points) out[n] = 0;
  if (x <= points[0][0]) { out[points[0][1]] = 1; return out; }
  for (let i = 1; i < points.length; i++) {
    const [x1, n1] = points[i], [x0, n0] = points[i - 1];
    if (x <= x1) { const t = (x - x0) / (x1 - x0); out[n0] = 1 - t; out[n1] = t; return out; }
  }
  out[points[points.length - 1][1]] = 1;
  return out;
}
