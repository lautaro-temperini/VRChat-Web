import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildAccessory } from './accessories.js';
import { ITEMS, EMOTES, STAMP_SIZES, TOPS, BOTTOMS, FEET, HATS, GLASSES, BROWS } from '../../server/shared.js';
import { MH_GARMENTS, MH_ACCESSORIES, MH_FACE, MH_EYES, faceKey, morphKey } from '../../server/avatarCatalog.js';
import { loadGLTF } from '../loaders.js';
import { fitDesignModel } from '../world/designModel.js';
import { designFileUrl } from '../net/api.js';
import { LOCO, locomotionClips, gestureClip } from './anims.js';

// Personaje MakeHuman (CC0, armado en Blender con assets-src/makehuman/build.py), mira hacia +Z.
// Esqueleto con los nombres de Quaternius, en pose T. Cuerpo, pelo y barba traen 8 formas
// (morph targets w{0,5,10}_m{0,5,10}) que se mezclan según peso y músculo.
// El cuerpo y el pelo se cargan en segundo plano; mientras tanto el personaje
// no se ve, pero la interfaz (setLook / setEquip / update) funciona igual.
// La ropa son prendas aparte (arriba, abajo, calzado) teñidas con el color elegido; la piel
// que queda debajo se esconde (el cuerpo trae en "_cover" qué prendas tapan cada vértice).

export const DEFAULT_LOOK = {
  body: 'masc', skin: '#d9a07a', hair: '#3b2416', hairStyle: 'corto', beard: false, beardStyle: 'completa', eyes: '#4a3020',
  top: 'remera', bottom: 'jean', feet: 'zapatillas', shirt: '#ff7a3d', pants: '#2b3445', shoes: '#f4f4f4',
  height: 1.75, weight: 0.5, muscle: 0.5, hat: '', glasses: '', brows: 'eyebrow001', face: {},
};

export const LOOK_OPTIONS = {
  body: ['masc', 'fem'],
  skin: ['#ffe0c7', '#f1c09b', '#d9a07a', '#b97a52', '#8d5534', '#5c3520'],
  hair: ['#151010', '#3b2416', '#7a4a26', '#c98d4a', '#f2d48a', '#e8e8e8', '#d63a3a', '#3a7bd5', '#ff6fb5', '#5ad17a'],
  hairStyle: ['corto', 'flequillo', 'largo', 'rapado', 'rulos', 'coleta', 'trenza', 'bob', 'despeinado', 'melena', 'revuelto', 'carre', 'rulitos', 'lacio', 'prolijo', 'jopo', 'trenzadoble', 'francesa', 'rodetetrenzado', 'francesadespeinada', 'haciaatras', 'bobdesfilado', 'largodesmechado', 'rodete', 'vincha', 'salvaje', 'bobrecto', 'bobrectoflequillo', 'bobadentro', 'bobadentroflequillo', 'bobinvertido', 'bobinvertidoflequillo'],
  beard: [false, true],
  beardStyle: ['completa', 'tupida', 'candado', 'bigote'],
  eyes: ['#4a3020', '#2e6b8a', '#3d7a3d', '#8a6a2a', '#1d1d1d', '#8a4be2'],
  top: TOPS.filter((t) => t !== 'buzo'),
  bottom: BOTTOMS,
  feet: FEET,
  hat: ['', ...HATS],
  glasses: ['', ...GLASSES],
  brows: BROWS,
  shirt: ['#f4f4f4', '#1d1d22', '#ff7a3d', '#3a7bd5', '#e63946', '#2a9d8f', '#ffd23f', '#8a4be2', '#ff6fb5', '#5ad17a'],
  pants: ['#2b3445', '#1d1d22', '#4b6a8f', '#7a6a55', '#3d5a3a', '#e8e1d0', '#8a3a3a'],
  shoes: ['#f4f4f4', '#1d1d22', '#ff7a3d', '#3a7bd5', '#e63946', '#ffd23f'],
};

// Peinados viejos que ya no se ofrecen: se muestran como otro, pero el dato guardado no se toca
const LEGACY_HAIR = {};

const BASE = `${import.meta.env.BASE_URL}models/makehuman/`;
// Dónde van los objetos equipados (en metros del modelo, en pose de reposo):
// head = gorros y auriculares, face = anteojos, chest = cadena y mochila.
// Los accesorios se diseñaron para el personaje anterior (1,81 m): la escala los acomoda.
const BODIES = {
  masc: { file: 'body/masc.gltf', height: 1.728, head: [0, 1.632, 0.045, 0.82], face: [0, 1.595, 0.042, 0.85], chest: [0, 0.09, 0.045, 0.9] },
  fem: { file: 'body/fem.gltf', height: 1.591, head: [0, 1.495, 0.04, 0.76], face: [0, 1.462, 0.038, 0.79], chest: [0, 0.08, 0.04, 0.83] },
};
const hairFile = (type, style) => `hair/${type}/${style}.gltf`;
const beardFile = (type, style) => `hair/${type}/barba_${style}.gltf`;
const clothFile = (type, garment) => `clothes/${type}/${garment}.gltf`;
const accFile = (type, id) => `acc/${type}/${id}.gltf`;
// Orden de los bits de "_cover0..3" (16 por atributo; el mismo orden que el catálogo y build.py)
const GARMENT_BITS = Object.keys(MH_GARMENTS);
const COVER_ATTRS = 4;
// Bits de las prendas puestas, por atributo
function hideBits(garments) {
  const out = new Array(COVER_ATTRS).fill(0);
  for (const g of garments) {
    const i = GARMENT_BITS.indexOf(g);
    if (i >= 0) out[i >> 4] |= 1 << (i & 15);
  }
  return out;
}
// Premios equipados que cambian al personaje: { acc: [ids], feet, skin, morphs: [ids], head, face }
function prizesOf(equip = []) {
  const out = { acc: [], feet: null, skin: null, morphs: [], eyes: null, head: false, face: false };
  for (const it of equip) {
    const def = ITEMS[it.type];
    if (!def) continue;
    if (def.mh === 'acc') out.acc.push(it.type);
    else if (def.mh === 'cloth') out.feet = it.type;
    else if (def.mh === 'skin') out.skin = it.type;
    else if (def.mh === 'morph') out.morphs.push(it.type);
    else if (def.mh === 'eyes') out.eyes = it.type;
    if (def.slot === 'head') out.head = true;
    if (def.slot === 'face') out.face = true;
  }
  return out;
}
// Prenda de cada lugar según el look (con los valores viejos que ya no se ofrecen)
const LEGACY_TOP = { buzo: 'mangalarga' };
const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);
export function outfitOf(L, equip) {
  return {
    top: pick(LOOK_OPTIONS.top, LEGACY_TOP[L.top] ?? L.top, 'remera'),
    bottom: pick(LOOK_OPTIONS.bottom, L.bottom, 'jean'),
    // El calzado de premio (equipado) reemplaza al elegido en el editor
    feet: (equip && prizesOf(equip).feet) || pick(LOOK_OPTIONS.feet, L.feet, 'zapatillas'),
  };
}

// ---------- Carga de modelos (una sola vez por archivo) ----------
const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager);
const cache = new Map();
const texLoader = new THREE.TextureLoader(manager);
const texCache = new Map();
// Texturas sueltas (cejas, pieles de premio), como las de los glTF: sin dar vuelta y en sRGB
function loadTex(name) {
  if (!texCache.has(name)) {
    texCache.set(name, texLoader.loadAsync(`${BASE}textures/${name}`).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }));
  }
  return texCache.get(name);
}
let lowRes = false;
// En calidad baja (celulares) se usan las texturas de 1K en lugar de las de 2K
export function setTextureQuality(quality) { lowRes = quality === 'low'; }
manager.setURLModifier((url) => (lowRes ? url.replace('/textures/', '/textures/1k/') : url));
function load(file) {
  if (!cache.has(file)) cache.set(file, loader.loadAsync(BASE + file).then(prepare));
  return cache.get(file);
}

const isBodyMaterial = (name) => /^Body/.test(name);

function prepare(gltf) {
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) o.material.vertexColors = false; });
  return gltf;
}

// ---------- Materiales ----------
const toLinear = (hex) => new THREE.Color(hex);
// Tono medio de piel de las texturas (medido en Blender): se usa para recolorear la piel
const REF_SKIN = { masc: toLinear('#f3d6c1'), fem: toLinear('#e5cebe') };

// Piel teñida con el color elegido; la que queda debajo de la ropa puesta no se dibuja
// (uHide = bits de las prendas puestas; _cover = bits de las prendas que tapan cada vértice)
function bodyMaterial(base, uniforms) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float _cover0, _cover1, _cover2, _cover3;
        uniform int uHide0, uHide1, uHide2, uHide3;
        varying float vHidden;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHidden = ((int(_cover0 + 0.5) & uHide0) | (int(_cover1 + 0.5) & uHide1)
          | (int(_cover2 + 0.5) & uHide2) | (int(_cover3 + 0.5) & uHide3)) != 0 ? 1.0 : 0.0;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSkin, uRefSkin;
        uniform float uTint;
        varying float vHidden;`)
      .replace('#include <map_fragment>', `
        if (vHidden > 0.5) discard;
        vec4 texel = texture2D(map, vMapUv);
        // Piel teñida con el color elegido; las pieles de premio van con su textura (uTint = 0)
        diffuseColor.rgb *= mix(texel.rgb, texel.rgb / uRefSkin * uSkin, uTint);`);
  };
  m.customProgramCacheKey = () => 'avatar-body';
  return m;
}

// Ojos de fantasía (premios): uEyeMode 0 = normal (color elegido), 1 = color propio con pupila redonda,
// 2 = con pupila rasgada; uEyeGlow = cuánto brilla el iris
function eyeMaterial(base, uniforms) {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    for (const k of ['uEye', 'uEyeFx', 'uEyeMode', 'uEyeGlow']) shader.uniforms[k] = uniforms[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEye, uEyeFx;\nuniform float uEyeMode, uEyeGlow;')
      .replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        // La textura de los ojos trae dos iris (uno por ojo, en diagonal): se usa el del lado que toca.
        // La pupila (oscura) no se tiñe
        float l = dot(texel.rgb, vec3(0.333));
        vec2 pc = vMapUv - (vMapUv.x > vMapUv.y ? vec2(0.704, 0.297) : vec2(0.288, 0.709));
        float irisR = 1.0 - smoothstep(0.115, 0.135, length(pc));
        // (l es lineal: el iris de esta textura ronda 0,015 y la pupila es negra)
        float iris = irisR * smoothstep(0.002, 0.008, l);
        vec3 eyeGlow = vec3(0.0);
        if (uEyeMode < 0.5) {
          // (la textura del iris es muy oscura: se aclara para que se vea el color elegido)
          diffuseColor.rgb *= mix(texel.rgb, uEye * clamp(l * 45.0, 0.5, 1.5), iris);
        } else {
          // Iris de color propio (un poco más chico que el de la textura: queda su aro oscuro alrededor) y
          // pupila redonda o rasgada
          float disc = 1.0 - smoothstep(0.08, 0.095, length(pc));
          float vein = clamp(l * 8.0, 0.65, 1.25);
          float pupil = uEyeMode > 1.5
            ? 1.0 - smoothstep(0.85, 1.0, length(pc / vec2(0.011, 0.07)))
            : 1.0 - smoothstep(0.85, 1.0, length(pc) / 0.028);
          vec3 col = mix(uEyeFx * vein, vec3(0.01), pupil);
          diffuseColor.rgb *= mix(texel.rgb, col, disc);
          eyeGlow = uEyeFx * uEyeGlow * disc * (1.0 - pupil);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n        totalEmissiveRadiance += eyeGlow;');
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
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
// Corrección de postura (radianes; ver posture())
const POSTURE = { shoulders: 0.14, neck: 0.08 };
if (import.meta.env.DEV) window.__POSTURE = POSTURE;
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
  // Suma un giro D (en el espacio del modelo) sobre la pose que ya tiene el hueso
  add(name, d) {
    const b = this.bones[name];
    b.bone.quaternion.multiply(_q.copy(b.inv).multiply(d).multiply(b.world));
  }
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

// ---------- Brazo con cinemática inversa (para llevar la mano a un punto: la boca, frente al pecho) ----------
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3(), _P = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
// Gira el hueso (en el mundo) para que la dirección "from" pase a ser "to"
function rotateWorld(bone, from, to) {
  _qa.setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(_qb));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(_qb).invert().multiply(_qa));
  bone.updateWorldMatrix(false, true);
}
// Dos huesos (brazo y antebrazo) para que la muñeca llegue a "target" (mundo), con el codo hacia "pole".
// w: cuánto (0..1, para entrar y salir suave)
function armIK(rig, s, target, pole, w) {
  const U = rig.bones[`upperarm_${s}`].bone, L = rig.bones[`lowerarm_${s}`].bone, H = rig.bones[`hand_${s}`].bone;
  const u0 = U.quaternion.clone(), l0 = L.quaternion.clone();
  U.updateWorldMatrix(true, true);
  U.getWorldPosition(_S); L.getWorldPosition(_E); H.getWorldPosition(_W);
  const a = _S.distanceTo(_E), b = _E.distanceTo(_W);
  const dir = _T.copy(target).sub(_S);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  dir.normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pd = _P.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = _a.copy(_S).addScaledVector(dir, x).addScaledVector(pd, h);
  rotateWorld(U, _b.copy(_E).sub(_S).normalize(), elbow.sub(_S).normalize());
  L.getWorldPosition(_E); H.getWorldPosition(_W);
  const wrist = _a.copy(_S).addScaledVector(dir, d);
  rotateWorld(L, _b.copy(_W).sub(_E).normalize(), wrist.sub(_E).normalize());
  U.quaternion.copy(u0.slerp(U.quaternion, w));
  L.quaternion.copy(l0.slerp(L.quaternion, w));
  U.updateWorldMatrix(false, true);
}
// Direcciones del personaje en el mundo (mira a +Z del modelo; su derecha es -X)
function bodyAxes(root) {
  const q = root.getWorldQuaternion(_qb);
  return {
    fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    right: new THREE.Vector3(-1, 0, 0).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    s: root.getWorldScale(_P).x,
  };
}
// Centro del agarre de la mano (entre la muñeca y los nudillos, del lado de la palma)
function gripPoint(rig, s, out) {
  const hand = rig.bones[`hand_${s}`].bone.getWorldPosition(_S);
  const knuckle = rig.bones[`middle_01_${s}`].bone.getWorldPosition(_E);
  const index = rig.bones[`index_01_${s}`].bone.getWorldPosition(_W);
  const pinky = rig.bones[`pinky_01_${s}`].bone.getWorldPosition(_T);
  const fingers = _a.copy(knuckle).sub(hand);
  const across = _b.copy(index).sub(pinky);
  // Normal de la palma: perpendicular a los dedos y al ancho de la mano (del lado del pulgar al doblar)
  const palm = new THREE.Vector3().crossVectors(across, fingers).normalize();
  if (s === 'l') palm.negate();
  return { pos: out.copy(hand).lerp(knuckle, 0.75), palm, fingers: fingers.normalize() };
}
// Pone un objeto (hijo de "parent") con posición y orientación dadas en el mundo; a tamaño real
function placeWorld(obj, parent, pos, basisX, basisY, basisZ) {
  _m4.makeBasis(basisX, basisY, basisZ);
  const q = _qa.setFromRotationMatrix(_m4);
  obj.quaternion.copy(parent.getWorldQuaternion(_qb).invert().multiply(q));
  obj.position.copy(parent.worldToLocal(_T.copy(pos)));
  obj.scale.setScalar(1 / parent.getWorldScale(_P).x);
}

export const POSE = { stand: 0, crouch: 1, sit: 2, climb: 3, air: 4, vault: 5 };
export const VAULT_TIME = 0.6; // segundos que dura saltar una baranda
// Pose del DJ (ángulos como en GESTURES; sz positivo = abrir el brazo hacia afuera)
const DJ_POSE = { sx: -0.9, sz: 0.4, el: -0.6, lean: 0.15, neck: 0.15 }; // medida: los dedos tocan la consola
if (import.meta.env.DEV) window.__DJ_POSE = DJ_POSE;
const SQUAT_AT = 0.4; // segundo de agachado_caminar que se usa como pose agachada

// Celular (en coordenadas del modelo en pose T, colgado de la mano derecha):
// largo a lo largo de Z, pantalla mirando a +X; al doblar el brazo queda vertical mirando la cara.
function phoneMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.075, 0.15, 2, 0.006), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.3, metalness: 0.5 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.135, 0.064), new THREE.MeshBasicMaterial({ color: 0x8fd0ff }));
  screen.rotation.y = Math.PI / 2;
  screen.position.x = 0.0065;
  body.castShadow = true;
  g.add(body, screen);
  return g;
}

// Vaso (trago) o taza (café) en la mano derecha; como el celular, el largo va a lo largo de Z en pose T,
// así al doblar el brazo queda parado frente a la boca
function cupMesh() {
  const g = new THREE.Group();
  const glass = new THREE.Group();
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.2, transparent: true, opacity: 0.9 }));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.027, 0.11, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.3 }));
  glass.add(liquid, rim);
  const mug = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
  mug.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.08, 18), white));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 16), white);
  handle.position.x = 0.038;
  mug.add(handle);
  for (const c of [glass, mug]) c.rotation.x = Math.PI / 2;
  g.add(glass, mug);
  g.userData = { glass, mug };
  return g;
}

// Gestos hechos por código: aplaudir (no hay animación) y los demás mientras cargan las animaciones.
// Devuelven ángulos de los brazos [derecho, izquierdo] y del cuerpo, con la misma convención de update().
const GESTURES = {
  saludar: (t) => ({ sx: [-0.3, 0], sz: [-(2.55 + 0.28 * Math.sin(t * 11)), 0.1], el: [-0.25, -0.2] }),
  aplaudir: (t) => {
    const c = Math.abs(Math.sin(t * 8));
    return { sx: [-1.2, -1.2], sz: [-0.26 + 0.16 * c, 0.26 - 0.16 * c], el: [-0.8, -0.8] }; // c = 1: manos juntas
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
if (import.meta.env.DEV) window.__GESTURES = GESTURES; // para calibrar en devtest
// Cuánto pesa cada forma w{0,5,10}_m{0,5,10} para un peso y músculo (0..1). La del promedio
// (w5_m5) es la base del modelo y no lleva forma.
function shapeInfluences(weight, muscle) {
  const cell = (v) => {
    const x = Math.min(1, Math.max(0, v ?? 0.5));
    return x <= 0.5 ? [[0, 1 - x * 2], [5, x * 2]] : [[5, 2 - x * 2], [10, x * 2 - 1]];
  };
  const out = {};
  for (const [w, a] of cell(weight)) for (const [m, b] of cell(muscle)) {
    if ((w !== 5 || m !== 5) && a * b > 0) out[`w${w}_m${m}`] = (out[`w${w}_m${m}`] ?? 0) + a * b;
  }
  return out;
}
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
    this.weights = { stand: 1, crouch: 0, sit: 0, climb: 0, air: 0, vault: 0 };
    this.vaultT = 1;
    this.j = { hip: [0, 0], knee: [0, 0], sx: [0, 0], sz: [0, 0], el: [0, 0], y: 0, lean: 0, tilt: 0, roll: 0, neck: 0 };
    this.scale = 1;
    this.gest = null;   // gesto en curso: { name, t, action? }
    this.talking = false; // hablando por voz: usa la animación de hablar cuando está quieto
    this.phone = false;   // con el celular en la mano (red social abierta): los demás lo ven
    this.djing = false;   // pasando música en la cabina: manos en la consola y la cabeza al ritmo
    // Estampa de diseño sobre la parte de arriba de la ropa (ver stampMaterial)
    this.stampU = { uStamp: { value: null }, uStampOn: { value: 0 }, uStampC: { value: new THREE.Vector2() }, uStampS: { value: new THREE.Vector2(1, 1) }, uStampSide: { value: 1 } };
    this.held = null; // objeto 3D de diseño en la mano: { design, group }
    this.phoneW = 0;
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
      uHide0: { value: 0 }, uHide1: { value: 0 }, uHide2: { value: 0 }, uHide3: { value: 0 }, uTint: { value: 1 },
      uEyeFx: { value: new THREE.Color() }, uEyeMode: { value: 0 }, uEyeGlow: { value: 0 },
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
    // Los premios de MakeHuman no se arman por código: se cargan con la ropa (syncHair)
    this.accessories = list.filter((it) => ITEMS[it.type] && !ITEMS[it.type].mh).map((it) => {
      const a = buildAccessory(it.type, it.color);
      a.group.traverse((o) => { if (o.isMesh) o.raycast = noRaycast; });
      return { ...a, type: it.type };
    });
    this.attachAccessories();
    this.stamp = list.find((it) => it.type === 'estampa')?.design ?? null;
    this.applyStamp();
    this.setHeld(list.find((it) => it.type === 'disenoObjeto')?.design ?? null);
    this.setLook(this.look);
  }

  // Estampa: la imagen, dónde va (pecho o espalda, debajo del cuello) y de qué tamaño
  applyStamp() {
    const U = this.stampU, d = this.stamp;
    U.uStampOn.value = 0;
    if (!d || !this.model) return;
    const id = d.id;
    stampTexture(id).then((tex) => {
      if (this.stamp?.id !== id || !this.model) return;
      const w = STAMP_SIZES[d.size] ?? STAMP_SIZES.mediano;
      const h = Math.min(0.45, (w * (d.h || 1)) / (d.w || 1));
      const neck = this.model.rig.bones.neck_01.worldPos.y;
      U.uStamp.value = tex;
      U.uStampS.value.set(w, h);
      U.uStampC.value.set(0, neck - 0.1 - h / 2);
      U.uStampSide.value = d.place === 'espalda' ? -1 : 1;
      U.uStampOn.value = 1;
    });
  }

  // Objeto 3D en la mano (diseños de hasta 50 cm): a tamaño real, parado sobre la mano derecha
  setHeld(design) {
    if (this.held?.design.id === design?.id) return;
    this.held?.group.removeFromParent();
    this.held = null;
    if (!design) return;
    const held = { design, group: new THREE.Group() };
    this.held = held;
    heldModel(design).then((obj) => {
      if (this.held !== held) return;
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.raycast = noRaycast; } });
      held.group.add(obj);
      this.root.add(held.group);
    }).catch(() => {});
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
    if (this.model?.type !== L.body) this.loadBody(L.body);
    else this.syncHair();
    if (this.model) this.applyShape();
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
      if (isBodyMaterial(name)) { o.material = bodyMaterial(o.material, this.uniforms); body = o; }
      else if (/Eyes/i.test(name)) o.material = eyeMaterial(o.material, this.uniforms);
      else {  // cejas y pestañas
        o.material = o.material.clone();
        o.material.color = this.mats.hair.color;
        o.userData.hair = true;
        if (/^Brows/.test(name)) { o.userData.brows = true; o.userData.baseMap = o.material.map; }
      }
      meshes.push(o);
    });
    this.uniforms.uRefSkin.value = REF_SKIN[type] ?? REF_SKIN.masc;
    const rig = new Rig(scene);
    const anchor = (bone, [x, y, z, s]) => { const g = rig.holder(bone, [x, y, z]); g.scale.setScalar(s); return g; };
    const anchors = { head: anchor('Head', def.head), face: anchor('Head', def.face), chest: anchor('spine_03', def.chest) };
    const model = { type, scene, rig, gltf, meshes, body, anchors, anim: null, legY: rig.bones.thigh_l.bone.getWorldPosition(new THREE.Vector3()).y };
    // Celular en la mano derecha (en pose T la mano apunta a -X; ver applyPhone)
    // Celular y vaso: se ubican cada cuadro en el agarre de la mano derecha (placeProps)
    model.phone = new THREE.Group();
    model.phone.add(phoneMesh());
    model.phone.visible = false;
    model.cup = new THREE.Group();
    model.cup.add(cupMesh());
    model.cup.visible = false;
    scene.add(model.phone, model.cup);
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
    this.applyStamp();
    this.baseSkin = body?.material.map ?? null;
    this.applyShape();
    this.syncHair();
  }

  // Piel de premio y cejas: cambian la textura (las cejas siguen teñidas con el color del pelo)
  async applyTextures() {
    const m = this.model;
    if (!m) return;
    const L = this.look;
    const skin = prizesOf(this.equip).skin;
    const brows = BROWS.includes(L.brows) && L.brows !== BROWS[0] ? L.brows : null;
    const key = `${skin}|${brows}`;
    if (m.texKey === key) return;
    m.texKey = key;
    const [skinTex, browTex] = await Promise.all([
      skin ? loadTex(`skin_${skin}.jpg`).catch(() => null) : null,
      brows ? loadTex(`brows_${brows}.png`).catch(() => null) : null,
    ]);
    if (this.model !== m || m.texKey !== key) return;
    if (m.body) {
      m.body.material.map = skinTex ?? this.baseSkin;
      m.body.material.needsUpdate = true;
      this.uniforms.uTint.value = skinTex ? 0 : 1;
    }
    for (const o of m.meshes) {
      if (!o.userData.brows) continue;
      o.material.map = browTex ?? o.userData.baseMap;
      o.material.needsUpdate = true;
    }
  }

  // Peinado, barba y ropa: se cargan aparte y se enganchan al esqueleto del cuerpo
  async syncHair() {
    const m = this.model;
    if (!m) return;
    const L = this.look;
    const style = LEGACY_HAIR[L.hairStyle] ?? L.hairStyle;
    const outfit = outfitOf(L, this.equip);
    const prizes = prizesOf(this.equip);
    this.applyTextures();
    // Ojos de fantasía (premio)
    const fx = prizes.eyes && MH_EYES[prizes.eyes];
    this.uniforms.uEyeMode.value = fx ? (fx.slit ? 2 : 1) : 0;
    this.uniforms.uEyeGlow.value = fx?.glow ?? 0;
    if (fx) this.uniforms.uEyeFx.value.set(fx.color);
    // [archivo, qué es, color] (sin color: va con su textura, sin teñir)
    const parts = [
      [hairFile(m.type, LOOK_OPTIONS.hairStyle.includes(style) ? style : 'corto'), style, this.mats.hair],
      L.beard ? [beardFile(m.type, pick(LOOK_OPTIONS.beardStyle, L.beardStyle, 'completa')), 'barba', this.mats.hair] : null,
      [clothFile(m.type, outfit.top), 'top', this.mats.shirt],
      [clothFile(m.type, outfit.bottom), 'bottom', this.mats.pants],
      [clothFile(m.type, outfit.feet), 'feet', prizes.feet ? null : this.mats.shoes],
      // Sombrero y anteojos del editor (un premio en la cabeza o en la cara los reemplaza)
      L.hat && HATS.includes(L.hat) && !prizes.head ? [accFile(m.type, L.hat), 'hat', null] : null,
      L.glasses && GLASSES.includes(L.glasses) && !prizes.face ? [accFile(m.type, L.glasses), 'acc', null] : null,
      ...prizes.acc.map((id) => [accFile(m.type, id), ITEMS[id].slot === 'head' ? 'hat' : 'acc', null]),
    ].filter(Boolean);
    // La piel que tapan las prendas puestas no se dibuja
    hideBits(Object.values(outfit)).forEach((bits, i) => { this.uniforms[`uHide${i}`].value = bits; });
    const key = parts.map((p) => p[0]).join('+');
    this.updateHairVisibility();
    if (m.hairKey === key) return;
    m.hairKey = key;
    const gltfs = await Promise.all(parts.map((p) => load(p[0])));
    if (this.disposed || this.model !== m || m.hairKey !== key) return;
    for (const h of this.hairMeshes) { h.removeFromParent(); h.material.dispose(); }
    this.hairMeshes = [];
    const skinBones = m.body.skeleton.bones;
    for (const [i, gltf] of gltfs.entries()) {
      const [, kind, mat] = parts[i];
      gltf.scene.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const mesh = new THREE.SkinnedMesh(o.geometry, o.material.clone());
        // Los nombres de las formas (w0_m0, f_cara_…) los pone el cargador en la malla, no en la geometría:
        // sin esto la malla nueva solo tiene "0", "1"… y no sigue el peso, el músculo ni la cara
        if (o.morphTargetDictionary) {
          mesh.morphTargetDictionary = { ...o.morphTargetDictionary };
          mesh.morphTargetInfluences = new Array(o.morphTargetInfluences.length).fill(0);
        }
        // La textura viene en gris: se tiñe con el color elegido (las medias quedan blancas)
        const socks = /^Socks/.test(o.material.name);
        if (!socks && mat && !/^Acc_/.test(o.material.name)) mesh.material.color = mat.color;
        // Con calza las medias atraviesan la tela en los tobillos: van tapadas
        mesh.userData.hidden = socks && outfit.bottom === 'calza';
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.raycast = noRaycast;
        mesh.userData.style = kind;
        if (kind === 'top') stampMaterial(mesh.material, this.stampU);
        m.body.parent.add(mesh);
        mesh.bind(new THREE.Skeleton(skinBones, o.skeleton.boneInverses), m.body.bindMatrix);
        this.hairMeshes.push(mesh);
      });
    }
    this.applyShape();
    this.updateHairVisibility();
  }

  // Con gorra o gorro no se ve el pelo corto (como en el personaje anterior)
  updateHairVisibility() {
    const hat = (this.equip ?? []).some((it) => ITEMS[it.type]?.slot === 'head' && it.type !== 'crown') || !!this.look.hat;
    // Capuchas y la bolsa tapan todo el pelo (no la barba)
    const covered = (this.equip ?? []).some((it) => MH_ACCESSORIES[it.type]?.hideHair);
    const isHair = (style) => LOOK_OPTIONS.hairStyle.includes(style);
    for (const h of this.hairMeshes) {
      h.visible = !h.userData.hidden && !(hat && h.userData.style === 'corto') && !(covered && isHair(h.userData.style));
    }
  }

  // Tipo de cuerpo (peso y músculo, 0..1; 0,5 = promedio), como los macros de MakeHuman: hay una forma
  // en cada combinación de peso y músculo en 0, 0,5 y 1 (w{0,5,10}_m{0,5,10}, relativas al promedio)
  // y se mezclan las 4 de alrededor (interpolación bilineal). Vale para cuerpo, ojos, cejas, pelo y barba.
  applyShape() {
    const m = this.model;
    if (!m) return;
    const infl = shapeInfluences(this.look.weight, this.look.muscle);
    // Presets de cara (uno por zona) y formas de animal de premio
    for (const [zone, z] of Object.entries(MH_FACE)) {
      const v = this.look.face?.[zone];
      if (v && Object.hasOwn(z.options, v)) infl[faceKey(zone, v)] = 1;
    }
    for (const id of prizesOf(this.equip).morphs) infl[morphKey(id)] = 1;
    for (const o of [...m.meshes, ...this.hairMeshes]) {
      const dict = o.morphTargetDictionary;
      if (!dict) continue;
      o.morphTargetInfluences.fill(0);
      for (const [k, v] of Object.entries(infl)) if (dict[k] !== undefined) o.morphTargetInfluences[dict[k]] = v;
    }
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
    // Cuánto "camina" (0..1+): agachado se mueve más lento, así que la referencia es otra
    this.amount = damp(this.amount, grounded ? Math.min(speed / (pose === POSE.crouch ? 1.4 : 4.5), 1.4) : 0, 10, dt);
    const a = this.amount, am = Math.min(a, 1);
    const sprint = THREE.MathUtils.clamp((speed - 5.2) / 1.5, 0, 1) * am;
    this.phase += dt * speed * (pose === POSE.crouch ? 3.4 : 2.3) / this.scale;
    const { crouch, sit, climb, air, vault } = w;
    // Saltar la baranda: el avance (0..1) lo lleva cada avatar, así se ve igual en los demás
    if (pose === POSE.vault && this.prevPose !== POSE.vault) this.vaultT = 0;
    this.prevPose = pose;
    this.vaultT = Math.min(1, this.vaultT + dt / VAULT_TIME);
    const V = vaultPose(this.vaultT);
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
      hip = mix(hip, V.hip[i], vault);
      knee = mix(knee, V.knee[i], vault);
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
      sx = mix(sx, V.sx[i], vault); sz = mix(sz, V.sz[i], vault); el = mix(el, V.el[i], vault);
      sx = mix(sx, -0.45, sit); sz = mix(sz, side * 0.12, sit); el = mix(el, -0.95, sit);
      if (gw > 0.001) { sx = mix(sx, gp.sx[i], gw); sz = mix(sz, gp.sz[i], gw); el = mix(el, gp.el[i], gw); }
      J.sx[i] = damp(J.sx[i], sx, k, dt);
      J.sz[i] = damp(J.sz[i], sz, k, dt);
      J.el[i] = damp(J.el[i], el, k, dt);
    });

    // Cuerpo: rebote, inclinación al correr, curvas y aterrizajes
    const lean = 0.05 * am + 0.2 * sprint + crouch * 0.35 + climb * 0.35 + V.lean * vault;
    const bob = Math.abs(Math.sin(this.phase)) * (0.035 + 0.03 * sprint) * am;
    J.y = damp(J.y, bob - crouch * 0.36 - sit * 0.42 - landing * 0.12 + V.y * vault + (gp.y ?? 0) * gw, 20, dt);
    J.lean = damp(J.lean, lean, 10, dt);
    J.tilt = damp(J.tilt, THREE.MathUtils.clamp(-turn * 0.07, -0.22, 0.22) * am + (gp.tilt ?? 0) * gw, 8, dt);
    J.roll = damp(J.roll, V.roll * vault, 16, dt); // de costado (solo al saltar una baranda)
    J.neck = damp(J.neck, -lean * 0.7, 10, dt);
    if (this.model?.anim) { this.animate(dt, speed, gw); this.posture(); }
    else this.applyPose(J, am);
    // Celular: pisa el brazo derecho y baja un poco la cabeza (también caminando)
    this.phoneW = damp(this.phoneW, this.phone ? 1 : 0, 8, dt);
    // Tomando algo (unos segundos, con sorbos) y beso (inclinarse hacia el otro)
    this.drinkT = Math.max(0, (this.drinkT ?? 0) - dt);
    this.kissT = Math.max(0, (this.kissT ?? 0) - dt);
    this.drinkW = damp(this.drinkW ?? 0, this.drinkT > 0 ? 1 : 0, 8, dt);
    this.kissW = damp(this.kissW ?? 0, this.kissT > 0 ? 1 : 0, 6, dt);
    if (this.model) {
      this.model.phone.visible = this.phoneW > 0.35 && this.drinkW < 0.35;
      if (this.phoneW > 0.001 && this.drinkW < 0.5) this.applyPhone(this.phoneW);
      this.model.cup.visible = this.drinkW > 0.35;
      if (this.drinkW > 0.001) this.applyDrink(this.drinkW, 0.5 + 0.5 * Math.sin(this.time * 2.4));
      if (this.model.phone.visible || this.model.cup.visible) this.placeProps();
      if (this.kissW > 0.001) this.applyKiss(this.kissW);
      this.djW = damp(this.djW ?? 0, this.djing ? 1 : 0, 6, dt);
      if (this.djW > 0.001) this.applyDJ(this.djW);
      // Objeto en la mano: brazo doblado hacia adelante (salvo con el celular, tomando o en la cabina)
      const busy = this.phoneW > 0.35 || this.drinkW > 0.35 || this.djW > 0.35;
      this.holdW = damp(this.holdW ?? 0, this.held && !busy ? 1 : 0, 8, dt);
      if (this.holdW > 0.001) this.applyHold(this.holdW);
      if (this.held) this.placeHeld(busy);
    }
  }

  // Tomar un trago ('trago') o un café ('cafe'): el vaso o la taza en la mano unos segundos
  drink(kind) {
    this.drinkT = 4;
    const cup = this.model?.cup.children[0];
    if (cup) { cup.userData.glass.visible = kind !== 'cafe'; cup.userData.mug.visible = kind === 'cafe'; }
    this.drinkKind = kind;
  }

  // Beso corto (el que llama gira al personaje hacia el otro)
  kiss() { this.kissT = 2.2; }

  // Brazo derecho llevando el vaso a la boca; sip 0..1 = cuánto lo levanta (la mano llega a la boca por IK)
  applyDrink(w, sip) {
    const R = this.model.rig, X = bodyAxes(this.root);
    const neck = R.bones.neck_01.bone, n0 = neck.quaternion.clone();
    R.euler('neck_01', -0.12 * sip, 0, 0);
    neck.quaternion.copy(n0.slerp(neck.quaternion, w));
    const head = R.bones.Head.bone;
    head.updateWorldMatrix(true, false);
    const mouth = head.getWorldPosition(new THREE.Vector3())
      .addScaledVector(X.up, (0.02 - 0.16 * (1 - sip)) * X.s).addScaledVector(X.fwd, (0.1 + 0.08 * (1 - sip)) * X.s)
      .addScaledVector(X.right, 0.02 * X.s);
    // La muñeca queda un poco abajo y afuera del vaso (que está en la mano)
    mouth.addScaledVector(X.up, -0.06 * X.s).addScaledVector(X.right, 0.03 * X.s);
    armIK(R, 'r', mouth, new THREE.Vector3().addScaledVector(X.up, -1).addScaledVector(X.right, 0.8), w);
    this.sip = sip;
  }

  // Inclinarse hacia adelante y estirar el cuello (el beso)
  applyKiss(w) {
    const R = this.model.rig;
    for (const [n, a] of [['spine_02', 0.18], ['spine_03', 0.12], ['neck_01', 0.22]]) {
      const b = R.bones[n].bone;
      const saved = b.quaternion.clone();
      R.euler(n, a, 0, 0);
      b.quaternion.copy(saved.slerp(b.quaternion, w));
    }
  }

  // DJ: las dos manos sobre la consola (una más cerca del plato) y la cabeza marcando el ritmo
  applyDJ(w) {
    const R = this.model.rig;
    const names = ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'neck_01', 'spine_03'];
    const saved = names.map((n) => R.bones[n].bone.quaternion.clone());
    const P = DJ_POSE, nod = Math.abs(Math.sin(this.time * Math.PI * 2)); // 120 bpm
    [['l', 1], ['r', -1]].forEach(([s, side], i) => {
      const scratch = i === 1 ? Math.sin(this.time * 5) * 0.08 : 0; // la derecha va y viene en el plato
      R.set(`upperarm_${s}`, _q2.setFromEuler(_e.set(P.sx + scratch, 0, side * P.sz)).multiply(ARM_DOWN[side]));
      R.set(`lowerarm_${s}`, _q3.copy(ARM_DOWN_INV[side]).multiply(qx(P.el)).multiply(ARM_DOWN[side]));
    });
    R.euler('spine_03', P.lean, 0, 0);
    R.euler('neck_01', P.neck + 0.12 * nod, 0, 0);
    names.forEach((n, k) => { const b = R.bones[n].bone; b.quaternion.copy(saved[k].slerp(b.quaternion, w)); });
  }

  // Postura: las animaciones adaptadas al esqueleto dejan los hombros caídos hacia adelante y la cabeza
  // adelantada; se tiran las clavículas un poco hacia atrás y se endereza el cuello
  posture() {
    const R = this.model.rig, P = POSTURE;
    R.add('clavicle_l', _qe.setFromAxisAngle(_Y, P.shoulders));
    R.add('clavicle_r', _qe.setFromAxisAngle(_Y, -P.shoulders));
    R.add('neck_01', _qe.setFromAxisAngle(_X, -P.neck));
  }

  // Brazo derecho doblado hacia adelante, la mano con la palma para arriba (para sostener un objeto)
  applyHold(w) {
    const R = this.model.rig;
    const names = ['upperarm_r', 'lowerarm_r'];
    const saved = names.map((n) => R.bones[n].bone.quaternion.clone());
    R.set('upperarm_r', _q2.setFromEuler(_e.set(-0.3, 0, 0.15)).multiply(ARM_DOWN[-1]));
    R.set('lowerarm_r', _q3.copy(ARM_DOWN_INV[-1]).multiply(qx(-1.45)).multiply(ARM_DOWN[-1]));
    names.forEach((n, k) => { const b = R.bones[n].bone; b.quaternion.copy(saved[k].slerp(b.quaternion, w)); });
  }

  // El objeto sigue a la mano derecha, siempre parado y mirando para donde mira el personaje
  placeHeld(hidden) {
    const g = this.held.group;
    g.visible = !hidden && this.holdW > 0.5;
    if (!g.visible) return;
    const hand = this.model.rig.bones.hand_r.bone;
    hand.updateWorldMatrix(true, false);
    hand.getWorldPosition(_hp);
    this.root.worldToLocal(_hp);
    g.position.set(_hp.x, _hp.y + 0.03 / this.root.scale.y, _hp.z + 0.07 / this.root.scale.z); // sobre la palma, no la muñeca
    g.scale.setScalar(1 / this.root.scale.x); // a tamaño real aunque el personaje sea más alto o más bajo
  }

  // Brazo derecho sosteniendo el celular frente al pecho (por IK), cabeza mirándolo
  applyPhone(w) {
    const R = this.model.rig, X = bodyAxes(this.root);
    const neck = R.bones.neck_01.bone, n0 = neck.quaternion.clone();
    R.euler('neck_01', 0.38, 0, 0);
    neck.quaternion.copy(n0.slerp(neck.quaternion, w));
    const chest = R.bones.spine_03.bone;
    chest.updateWorldMatrix(true, false);
    const target = chest.getWorldPosition(new THREE.Vector3())
      .addScaledVector(X.fwd, 0.32 * X.s).addScaledVector(X.up, 0.15 * X.s).addScaledVector(X.right, 0.05 * X.s);
    armIK(R, 'r', target, new THREE.Vector3().addScaledVector(X.up, -1).addScaledVector(X.right, 0.7).addScaledVector(X.fwd, -0.3), w);
  }

  // Celular y vaso en el agarre de la mano derecha: el celular con la pantalla hacia la cara, el vaso parado
  // (inclinado hacia la boca al tomar)
  placeProps() {
    const m = this.model, R = m.rig, X = bodyAxes(this.root);
    m.scene.updateMatrixWorld(true);
    const grip = gripPoint(R, 'r', new THREE.Vector3());
    const head = R.bones.Head.bone.getWorldPosition(new THREE.Vector3()).addScaledVector(X.up, 0.08 * X.s);
    if (m.phone.visible) {
      // Pantalla (+X del celular) hacia los ojos; el largo (+Z) para arriba
      const pos = grip.pos.clone().addScaledVector(grip.palm, 0.012 * X.s);
      const toEye = head.clone().sub(pos).normalize();
      const up = X.up.clone().addScaledVector(toEye, -X.up.dot(toEye)).normalize();
      placeWorld(m.phone, m.scene, pos, toEye, new THREE.Vector3().crossVectors(up, toEye), up);
    }
    if (m.cup.visible) {
      // Vaso parado (+Z del grupo = arriba del vaso), en la palma; al tomar se inclina hacia la boca
      const pos = grip.pos.clone().addScaledVector(grip.palm, 0.035 * X.s);
      const up = X.up.clone().addScaledVector(X.fwd, -0.9 * (this.sip ?? 0)).normalize();
      const side = X.right.clone().addScaledVector(up, -X.right.dot(up)).normalize();
      placeWorld(m.cup, m.scene, pos, side, new THREE.Vector3().crossVectors(up, side), up);
    }
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
    const stand = blend(speed, [[0, 'idle'], [1.6, 'walk'], [3.2, 'jog']]);
    if (this.talking) { stand.talk = stand.idle; stand.idle = 0; }
    for (const [k, v] of Object.entries(stand)) target[k] += v * w.stand;
    // Saltar y pasar barandas se hacen por código (abajo); mientras tanto la base es quieto
    const proc = Math.min(1, w.air + w.vault);
    target.idle += proc;
    // Agachado: un cuadro en cuclillas de agachado_caminar (piernas parejas, pies en el piso); al avanzar
    // se suman los pasos por código (el clip entero gira el cuerpo de costado y no sirve para caminar)
    const squat = A.actions.crouchWalk;
    if (squat) { squat.time = SQUAT_AT; squat.timeScale = 0; }
    target.crouchWalk += w.crouch;
    target.climb += w.climb;
    // Trepar dura lo que tarda el juego en subirte (0,42 s): la animación arranca de cero cada vez
    if (A.actions.climb) {
      if (w.climb > 0.5 && !A.climbing) { A.climbing = true; A.actions.climb.reset(); A.actions.climb.timeScale = A.actions.climb.getClip().duration / 0.5; }
      if (w.climb < 0.1) A.climbing = false;
    }
    target.sit += w.sit;
    // El primer cuadro arranca ya en su pose (si no, al aparecer se ve en pose T hasta que sube el peso)
    const first = !A.w;
    A.w ??= {};
    for (const [k, action] of Object.entries(A.actions)) {
      A.w[k] = first ? target[k] : damp(A.w[k] ?? 0, target[k], k === 'talk' || k === 'idle' ? 4 : 14, dt); // hablar entra y sale despacio
      action.setEffectiveWeight(A.w[k] * base);
      const s = LOCO[k].speed;
      if (s) action.timeScale = THREE.MathUtils.clamp(speed / s / this.scale, 0.6, 2.5);
    }
    if (A.gesture) A.gesture.setEffectiveWeight(ga);
    A.mixer.update(dt);
    const step = w.crouch * Math.min(this.amount * 2, 1);
    if (step > 0.01) {
      [['l', 1], ['r', -1]].forEach(([s, side]) => {
        const ph = this.phase + (side > 0 ? 0 : Math.PI);
        R.add(`thigh_${s}`, qx(-Math.sin(ph) * 0.4 * step));
        R.add(`calf_${s}`, qx(Math.max(0, -Math.cos(ph)) * 0.55 * step));
      });
    }

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
    // (la animación de sentarse ya trae su altura: no se resta la bajada de la pose hecha por código)
    root.bone.position.copy(root.restPos).add(_v.set(0, Math.min(J.y + 0.42 * w.sit + 0.36 * w.crouch, 0) * 0.5, 0).applyQuaternion(root.parentInv));
    R.euler('root', 0, 0, J.tilt);

    // Agachado y en el aire: la pose hecha por código, mezclada encima según cuánto pesa
    if (proc > 0.001) {
      const saved = PROC_BONES.map((n) => R.bones[n].bone.quaternion.clone());
      const savedPos = root.bone.position.clone();
      this.applyPose(J, Math.min(this.amount, 1));
      PROC_BONES.forEach((n, k) => { const b = R.bones[n].bone; b.quaternion.copy(saved[k].slerp(b.quaternion, proc)); });
      root.bone.position.lerpVectors(savedPos, root.bone.position, proc);
    }
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
    R.euler('root', J.lean, J.roll, J.tilt);
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
const _v = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _hp = new THREE.Vector3();

// ---------- Diseños: estampas y objetos en la mano ----------
const stampCache = new Map();
function stampTexture(id) {
  if (!stampCache.has(id)) {
    stampCache.set(id, new THREE.TextureLoader().loadAsync(designFileUrl(id)).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    }).catch(() => { stampCache.delete(id); return null; }));
  }
  return stampCache.get(id);
}
const modelCache = new Map();
// Copia del modelo, con la base en el piso y centrado (cada avatar tiene la suya)
function heldModel(design) {
  const id = design.id;
  if (!modelCache.has(id)) modelCache.set(id, loadGLTF(designFileUrl(id, 'model')).catch((e) => { modelCache.delete(id); throw e; }));
  return modelCache.get(id).then((gltf) => fitDesignModel(gltf.scene, design));
}
// La estampa se proyecta sobre la prenda en su pose de reposo (antes de animar), mirando de frente
// (pecho, +Z) o de atrás (espalda): así se deforma con la ropa sin depender de cómo está su textura
function stampMaterial(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = `varying vec3 vStampP;
varying vec3 vStampN;
${sh.vertexShader.replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
vStampP = transformed;
vStampN = objectNormal;`)}`;
    sh.fragmentShader = `varying vec3 vStampP;
varying vec3 vStampN;
uniform sampler2D uStamp;
uniform float uStampOn;
uniform vec2 uStampC;
uniform vec2 uStampS;
uniform float uStampSide;
`
      + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        if (uStampOn > 0.5 && vStampN.z * uStampSide > 0.3) {
          vec2 suv = vec2((vStampP.x - uStampC.x) * uStampSide / uStampS.x + 0.5, (vStampP.y - uStampC.y) / uStampS.y + 0.5);
          if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
            vec4 st = texture2D(uStamp, suv);
            diffuseColor.rgb = mix(diffuseColor.rgb, st.rgb, st.a);
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'estampa';
}
const ARM_BONES = ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r'];
const PROC_BONES = ['root', 'spine_02', 'neck_01', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r', ...ARM_BONES];

// Saltar una baranda de costado (u = 0..1): apoya las manos, pasa las piernas juntas hacia un
// costado con el cuerpo inclinado, se suelta con una mano y cae estirándose
function vaultPose(u) {
  const S = THREE.MathUtils.smoothstep;
  const plant = S(u, 0, 0.25), swing = S(u, 0.2, 0.55), out = S(u, 0.65, 1);
  const tuck = swing * (1 - out);
  const hip = (i) => mix(mix(-0.8 * plant, -1.65 + (i ? -0.2 : 0.2), swing), -0.3 - (i ? 0.25 : 0), out);
  const knee = (i) => mix(mix(0.9 * plant, 1.9 + (i ? 0.15 : 0), swing), 0.4 + (i ? 0.35 : 0), out);
  // Brazo izquierdo (i = 1) apoyado en el pasamanos, recto hacia abajo; el derecho se abre para equilibrar
  const arm = (i) => i
    ? { sx: mix(-0.85 * plant, -0.25, swing) * (1 - out) - 0.5 * out, sz: mix(0.1, 0.2, swing) * (1 - out) + 0.9 * out, el: -0.1 - 0.5 * out }
    : { sx: mix(-0.85 * plant, -0.6, swing) * (1 - out) - 0.5 * out, sz: mix(-0.1, -1.3, swing) * (1 - out) - 0.9 * out, el: -0.1 - 0.6 * swing };
  const A = [arm(0), arm(1)];
  return {
    hip: [hip(0), hip(1)],
    knee: [knee(0), knee(1)],
    sx: [A[0].sx, A[1].sx], sz: [A[0].sz, A[1].sz], el: [A[0].el, A[1].el],
    lean: 0.55 * plant * (1 - out) - 0.15 * out,
    roll: 0.75 * tuck,
    y: -0.1 * tuck,
  };
}

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
