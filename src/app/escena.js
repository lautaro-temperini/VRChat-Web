// Arranque y render: calidad gráfica, renderer, escena, cámara, el mundo (Museo o sala personal),
// post-procesado, el jugador local (personaje, controlador, brazos de 1ª persona) y los botones.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMuseum } from '../world/museum.js';
import { buildPersonalRoom, isPersonalRoom } from '../world/rooms.js';
import { Avatar, DEFAULT_LOOK, setTextureQuality } from '../player/avatar.js';
import { PlayerController } from '../player/controller.js';
import { FPArms } from '../player/fpArms.js';
import { setLoaderRenderer } from '../loaders.js';
import { UI_ICONS } from '../ui/icons.js';
import { detectQuality } from '../quality.js';
import { G, $, body, pref, loading } from './state.js';

loading(30, 'Armando el museo…');

const isTouch = matchMedia('(pointer: coarse)').matches;
body.classList.toggle('touch', isTouch);
const quality = detectQuality({ isTouch }); // 'low' | 'medium' | 'high' (automática, ver quality.js)
const high = quality === 'high';
setTextureQuality(quality === 'low' ? 'low' : 'high');

// ---------- Render ----------
const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, { low: 1, medium: 1.5, high: 2 }[quality]));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = high;
renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoftShadowMap ya no existe en three: usaba esta igual)
$('app').append(renderer.domElement);
setLoaderRenderer(renderer);

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.className = 'labels';
body.append(labels.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
// Las salas personales (u-<id>) usan una plantilla con los muebles del dueño (rooms.js); el Museo es el de siempre
const world = isPersonalRoom() ? buildPersonalRoom(scene, renderer, quality) : buildMuseum(scene, renderer, quality);

// Post-procesado (solo calidad alta): sombras de contacto (GTAO) + brillo solo en neones (bloom con umbral alto).
// G.composer queda en null si se apaga (ver el bucle, loop.js)
G.composer = null;
if (high) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1.2, scale: 1 });
  // Los objetos transparentes (haces de luz, manchas de luz) no tienen que generar sombra de contacto
  const renderAO = gtao.render.bind(gtao);
  gtao.render = (...args) => {
    const hidden = [];
    scene.traverseVisible((o) => { if (o.material?.transparent) { o.visible = false; hidden.push(o); } });
    renderAO(...args);
    for (const o of hidden) o.visible = true;
  };
  composer.addPass(gtao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 3.2));
  composer.addPass(new OutputPass());
  G.composer = composer;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  G.composer?.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});

// ---------- Jugador local ----------
const me = new Avatar({ ...DEFAULT_LOOK });
scene.add(me.root);
const ctrl = new PlayerController({ camera, avatar: me, world, dom: renderer.domElement });
ctrl.sens = pref.get('sens', 1);
const fpArms = new FPArms(me);
fpArms.syncLook();

function setEquip(list) {
  me.setEquip(list ?? []);
  if (G.account) G.account.equip = list ?? [];
}

ctrl.onModeChange = (mode) => {
  $('btn-cam').querySelector('.lbl').textContent = mode === 'first' ? '1ª persona' : '3ª persona';
  body.classList.toggle('first', mode === 'first');
};
// Íconos en la barra superior (en pantallas chicas se ven solo los íconos)
$('btn-cam').innerHTML = `${UI_ICONS.camera}<span class="lbl">3ª persona</span>`;
for (const [id, icon] of [['btn-mic', 'mic'], ['btn-media', 'music'], ['btn-mundi', 'globe'], ['btn-gestures', 'hand'], ['btn-room', 'friends'], ['btn-look', 'user'], ['btn-inv', 'bag'], ['btn-friends', 'phone']]) {
  $(id).insertAdjacentHTML('afterbegin', UI_ICONS[icon]);
}
// En celular, inventario, amigos y el mapa van arriba con el resto (abajo están los controles táctiles)
if (isTouch) for (const b of [...$('dock').children]) $('topbar').insertBefore(b, $('btn-settings'));
$('btn-cam').onclick = () => ctrl.setMode(ctrl.mode === 'first' ? 'third' : 'first');
document.addEventListener('pointerlockchange', () => {
  body.classList.toggle('locked', document.pointerLockElement === renderer.domElement);
});
// Los textos de los botones inclinados van en un <span> para enderezarlos
for (const b of document.querySelectorAll('button.pill:not(.icon)')) {
  if (!b.querySelector('span')) b.innerHTML = `<span>${b.innerHTML}</span>`;
}

Object.assign(G, { isTouch, quality, renderer, labels, scene, camera, world, me, ctrl, fpArms, setEquip });
