import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Animaciones del personaje:
//  - Universal Animation Library (Quaternius, CC0): movimiento básico (quieto, caminar, correr…)
//  - Mixamo: gestos y bailes (se adaptan del esqueleto "mixamorig" al de Quaternius)
// Las dos fuentes y los cuerpos están en pose T, así que alcanza con llevar la rotación de cada
// hueso "respecto de su pose de reposo" de un esqueleto al otro (ver retarget()).

const BASE = `${import.meta.env.BASE_URL}models/anims/`;
// Paquete: cada clip recortado a lo que usa el juego, en JSON (lo arma devtest/empaquetar.html).
// Pesa mucho menos que los FBX y que ual.glb entero; si falta un clip, se lee el original.
const PACK = `${BASE}pack/`;

// Movimiento básico y su velocidad natural en m/s (ya escalada a la altura de nuestros personajes).
// file = Mixamo (más natural; puede ser distinto por cuerpo), clip = Universal Animation Library.
// hips: false = sin mover la cadera (trepar: la subida ya la hace el juego)
export const LOCO = {
  idle: { file: { masc: 'mixamo/quieto_masc.fbx', fem: 'mixamo/quieto_fem.fbx' } },
  talk: { clip: 'Idle_Talking_Loop' },
  walk: { file: 'mixamo/caminar.fbx', speed: 1.66 },
  jog: { file: 'mixamo/trotar.fbx', speed: 2.4 },
  sprint: { file: 'mixamo/correr.fbx', speed: 4.4 },
  crouchWalk: { file: 'mixamo/agachado_caminar.fbx' }, // se usa un solo cuadro: la pose en cuclillas
  air: { file: 'mixamo/caer.fbx' },
  sit: { file: 'mixamo/sentado.fbx' },
  climb: { file: 'mixamo/trepar.fbx', hips: false },
};

// Gestos con animación (los que no están acá se hacen por código, ver GESTURES en avatar.js)
export const GESTURE_CLIPS = {
  saludar: { file: 'mixamo/saludar.fbx' },
  senalar: { file: 'mixamo/senalar.fbx' },
  festejar: { file: 'mixamo/festejar.fbx' },
  baile10: { ual: 'Dance_Loop', loop: true },
};
for (let i = 1; i <= 9; i++) GESTURE_CLIPS[`baile${i}`] = { file: `mixamo/baile${i}.fbx`, loop: true };

// Huesos de Mixamo → huesos de Quaternius
const MIXAMO = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' };
for (const [side, s] of [['Left', 'l'], ['Right', 'r']]) {
  Object.assign(MIXAMO, {
    [`${side}Shoulder`]: `clavicle_${s}`, [`${side}Arm`]: `upperarm_${s}`, [`${side}ForeArm`]: `lowerarm_${s}`, [`${side}Hand`]: `hand_${s}`,
    [`${side}UpLeg`]: `thigh_${s}`, [`${side}Leg`]: `calf_${s}`, [`${side}Foot`]: `foot_${s}`, [`${side}ToeBase`]: `ball_${s}`,
  });
  for (const [f, q] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky']]) {
    for (let k = 1; k <= 3; k++) MIXAMO[`${side}Hand${f}${k}`] = `${q}_0${k}_${s}`;
  }
}
const mixamoName = (n) => MIXAMO[n.replace(/^mixamorig:?/, '')];

// Esqueleto de origen: pose de reposo de cada hueso, en local y en el espacio del modelo
function source(root, rename, hips) {
  root.updateMatrixWorld(true);
  const bones = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    const to = rename(o.name);
    if (!to || bones[o.name]) return;
    bones[o.name] = { to, local: o.quaternion.clone(), world: o.getWorldQuaternion(new THREE.Quaternion()) };
  });
  const h = root.getObjectByName(hips);
  return {
    bones, hips,
    hipsPos: h.getWorldPosition(new THREE.Vector3()),
    hipsParent: h.parent.matrixWorld.clone(),
  };
}

// ---------- Carga (una vez por archivo) ----------
const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

function loadUAL() {
  return once('ual', async () => {
    const gltf = await new GLTFLoader().loadAsync(BASE + 'ual.glb');
    const src = source(gltf.scene, (n) => (n === 'root' ? null : n), 'pelvis'); // la raíz la mueve el juego
    return { src, clips: Object.fromEntries(gltf.animations.map((c) => [c.name, c])) };
  });
}
function loadFBX(file) {
  return once(file, async () => {
    const fbx = await new FBXLoader().loadAsync(BASE + file);
    const hips = fbx.getObjectByName('mixamorigHips') ? 'mixamorigHips' : 'mixamorig:Hips';
    return { src: source(fbx, mixamoName, hips), clip: fbx.animations[0] };
  });
}

// Un clip y su esqueleto de origen. def: { file } (Mixamo) o { ual } (nombre del clip en ual.glb)
export async function loadRaw(def) {
  if (def.file) return loadFBX(def.file);
  const ual = await loadUAL();
  return { clip: ual.clips[def.ual], src: ual.src };
}
export const packName = (def) => (def.file ? def.file.replace(/\.fbx$/, '') : `ual_${def.ual}`).replace(/[/:]/g, '_') + '.json';
function loadClip(def) {
  return once(`clip:${packName(def)}`, async () => {
    try {
      const res = await fetch(PACK + packName(def));
      if (res.ok && res.headers.get('content-type')?.includes('json')) return unpack(await res.json());
    } catch { /* sin paquete: el original */ }
    return loadRaw(def);
  });
}
// Del JSON del paquete a { src, clip } (lo mismo que dan los cargadores originales)
function unpack(d) {
  const q = (a, i) => new THREE.Quaternion(a[i], a[i + 1], a[i + 2], a[i + 3]);
  const bones = {};
  for (const [name, b] of Object.entries(d.bones)) bones[name] = { to: b[0], local: q(b, 1), world: q(b, 5) };
  const tracks = d.tracks.map(([name, kind, times, values]) => new (kind === 'q' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack)(name, times, values));
  return {
    src: { bones, hips: d.hips, hipsPos: new THREE.Vector3().fromArray(d.hipsPos), hipsParent: new THREE.Matrix4().fromArray(d.hipsParent) },
    clip: new THREE.AnimationClip(d.name, d.duration, tracks),
  };
}

// ---------- Adaptación al esqueleto de destino ----------
const MAX_SWAY = 0.3; // m que la cadera se puede alejar de su lugar en una animación
const _a = new THREE.Quaternion(), _b = new THREE.Quaternion(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

// rig: el de avatar.js ({ bones: { nombre: { rest, world, inv, restPos, parentInv, worldPos } } })
function retarget(clip, src, rig, name, { hips = true } = {}) {
  const tracks = [];
  const pelvis = rig.bones.pelvis;
  const ratio = pelvis.worldPos.y / src.hipsPos.y; // altura de cadera (y de paso las unidades: cm → m)
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot), prop = track.name.slice(dot + 1);
    const S = src.bones[bone];
    const T = S && rig.bones[S.to];
    if (!T) continue;
    if (prop === 'quaternion') {
      // D (rotación respecto del reposo, en el espacio del modelo) = Wₛ · Lₛ⁻¹ · q · Wₛ⁻¹
      // q destino = L_t · W_t⁻¹ · D · W_t  →  q destino = A · q · B
      const A = _a.copy(T.rest).multiply(T.inv).multiply(S.world).multiply(_q.copy(S.local).invert()).clone();
      const B = _b.copy(S.world).invert().multiply(T.world).clone();
      const v = new Float32Array(track.values.length);
      for (let i = 0; i < v.length; i += 4) {
        _q.fromArray(track.values, i).premultiply(A).multiply(B).normalize().toArray(v, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${S.to}.quaternion`, track.times, v));
    } else if (prop === 'position' && bone === src.hips && hips) {
      // Cadera: solo el movimiento respecto del reposo, escalado a la altura del personaje.
      // Se le saca el corrimiento horizontal (el personaje no se tiene que ir de su lugar).
      const n = track.times.length, v = new Float32Array(n * 3);
      const d = [];
      for (let i = 0; i < n; i++) {
        _v.fromArray(track.values, i * 3).applyMatrix4(src.hipsParent).sub(src.hipsPos).multiplyScalar(ratio);
        d.push(_v.clone());
      }
      const drift = d[n - 1].clone().sub(d[0]);
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) : 0;
        d[i].x -= d[0].x + drift.x * k;
        d[i].z -= d[0].z + drift.z * k;
      }
      // Centrado en su lugar y, si se aleja más de MAX_SWAY (algunos bailes recorren un metro), achicado:
      // si no, el cuerpo se ve lejos de donde está de verdad el jugador y atraviesa paredes
      let mx = 0, mz = 0;
      for (const p of d) { mx += p.x / n; mz += p.z / n; }
      let far = 0;
      for (const p of d) { p.x -= mx; p.z -= mz; far = Math.max(far, Math.hypot(p.x, p.z)); }
      const shrink = far > MAX_SWAY ? MAX_SWAY / far : 1;
      for (let i = 0; i < n; i++) {
        _v.copy(d[i]);
        _v.x *= shrink;
        _v.z *= shrink;
        _v.applyQuaternion(T.parentInv).add(T.restPos).toArray(v, i * 3);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${S.to}.position`, track.times, v));
    }
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

// Clips ya adaptados, por tipo de cuerpo (todos los avatares con el mismo cuerpo los comparten)
const adapted = new Map();
function adapt(key, rig, make, opts) {
  if (!adapted.has(key)) adapted.set(key, make().then((c) => c && retarget(c.clip, c.src, rig, key, opts)));
  return adapted.get(key);
}

export function locomotionClips(bodyType, rig) {
  return Promise.all(Object.entries(LOCO).map(async ([k, def]) => {
    const file = typeof def.file === 'object' ? def.file[bodyType] ?? def.file.masc : def.file;
    const clip = await adapt(`${bodyType}:${file ?? def.clip}`, rig, () => loadClip(file ? { file } : { ual: def.clip }), { hips: def.hips ?? true });
    return [k, clip];
  })).then(Object.fromEntries);
}

export function gestureClip(bodyType, rig, name) {
  const def = GESTURE_CLIPS[name];
  if (!def) return Promise.resolve(null);
  return adapt(`${bodyType}:${name}`, rig, () => loadClip(def.ual ? { ual: def.ual } : { file: def.file }));
}
