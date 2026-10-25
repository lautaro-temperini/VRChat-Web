// Bucle principal (cada cuadro: mover, voces, qué apuntás, mandar la posición, dibujar), día y
// noche según la hora de Argentina y el acceso para pruebas (window.__game, solo en desarrollo).
import * as THREE from 'three';
import { toast } from '../ui/toast.js';
import { FpsWatch } from '../quality.js';
import { G, $ } from './state.js';

const { quality, renderer, labels, scene, camera, world, me, ctrl, fpArms, net, remotes, rtc, groups, ground, roomEditor } = G;

// ---------- Bucle principal ----------
const clock = new THREE.Clock();
const staminaEl = $('stamina');
const staminaFill = staminaEl.querySelector('.fill');
let sendTimer = 0, lastSent = '', lastSentAt = 0, frame = 0, voiceTimer = 0, inExit = false;
// Si anda lento: se apaga el post-procesado y se baja la resolución ya mismo (y la próxima vez arranca más abajo)
const fpsWatch = new FpsWatch(quality, () => {
  G.composer = null;
  renderer.setPixelRatio(1);
  toast('Bajamos la calidad gráfica para que el juego ande más fluido.');
});
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  fpsWatch.tick(dt, ctrl.enabled && !document.hidden);
  const t = clock.elapsedTime;
  // DJ: en la cabina pone las manos en la consola (yo, y el que está pasando música)
  const djSpot = ctrl.booth && world.dj.spot; // en las salas personales es un objeto nuevo cada vez
  me.djing = !!djSpot && Math.hypot(ctrl.booth.x - djSpot.x, ctrl.booth.z - djSpot.z) < 0.05;
  for (const r of remotes.values()) r.avatar.djing = rtc.dj?.id === r.id;
  ctrl.update(dt);
  for (const r of remotes.values()) r.update(dt);
  world.update(dt, t);
  roomEditor?.update(dt);
  ground.update(dt, t, G.account?.id);
  rtc.update(camera, (key) => (key.endsWith(':dj') ? (world.dj.sources ?? world.dj.speakers) : key.endsWith(':screen') ? world.screen.position : remotes.get(key)?.mouth()));
  world.dj.setMusic(rtc.dj ? rtc.musicLevel() : -1);
  // Qué voces escucho (los 4 más cercanos que hablan, o mi grupo): cada medio segundo
  voiceTimer += dt;
  if (voiceTimer >= 0.5 && net.ready) {
    voiceTimer = 0;
    const myGroup = groups.mine();
    rtc.updateVoices([...remotes.values()].map((r) => ({
      id: r.id, pos: r.avatar.root.position, mic: r.mic, hasVoice: r.hasVoice, group: groups.of(r.userId), blocked: rtc.mutedUsers.has(r.id),
    })), ctrl.pos, myGroup);
  }

  // Barra de stamina: aparece solo cuando no está llena
  staminaEl.classList.toggle('show', ctrl.stamina < 0.999 && ctrl.enabled);
  staminaEl.classList.toggle('tired', ctrl.exhausted);
  staminaFill.style.transform = `scaleX(${ctrl.stamina})`;

  // Qué estás apuntando (cada 3 frames alcanza)
  if (++frame % 3 === 0) {
    G.updateTarget();
    // Quién está hablando
    for (const r of remotes.values()) r.setSpeaking(r.mic === 'on' && rtc.level(r.id) > 0.035);
    // Puertas que dan afuera: meterse en la zona de enfrente abre el Mapa (de nuevo recién al salir y volver)
    const p = ctrl.pos;
    const exit = !!world.exits?.some((e) => p.x > e.x0 && p.x < e.x1 && p.z > e.z0 && p.z < e.z1);
    if (exit && !inExit && ctrl.enabled && G.joined) G.openMundi();
    inExit = exit;
  }

  // Posición a la sala: 10 veces por segundo si cambió, o cada 2 s igual
  sendTimer += dt;
  if (sendTimer >= 0.1 && net.ready) {
    sendTimer = 0;
    const s = ctrl.state().map((v) => Math.round(v * 100) / 100);
    const key = s.join(',');
    if (key !== lastSent || t - lastSentAt > 2) {
      net.send({ t: 's', s });
      lastSent = key;
      lastSentAt = t;
    }
  }

  if (G.composer) G.composer.render(dt);
  else renderer.render(scene, camera);

  // Manos en primera persona, encima de todo
  if (ctrl.enabled && ctrl.mode === 'first') {
    fpArms.update(dt, camera, { speed: ctrl.speed, pose: ctrl.pose, phase: me.phase });
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(fpArms.scene, camera);
    renderer.autoClear = true;
  }
  labels.render(scene, camera);
});

// ---------- Día y noche según la hora de Argentina (GMT-3) ----------
let fixedHour = null; // para pruebas
function hoursGMT3() {
  const d = new Date();
  return ((d.getUTCHours() - 3 + 24) % 24) + d.getUTCMinutes() / 60;
}
world.setTime(hoursGMT3());
setInterval(() => world.setTime(fixedHour ?? hoursGMT3()), 30_000);

// Acceso para pruebas, solo en desarrollo (npm run dev)
if (import.meta.env.DEV) {
  const { gesture, openDJPanel, openArtists, parts, interact, social, roomPanel, works } = G;
  window.__game = { ctrl, me, gesture, openDJPanel, openArtists, parts, world, remotes, interact, camera, fpArms, renderer, rtc, social, net, ground, roomPanel, works, setHour: (h) => { fixedHour = h; world.setTime(h); }, get target() { return G.getTarget(); } };
}

