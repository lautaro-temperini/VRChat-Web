import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FURNITURE } from '../../server/shared.js';
import { buildShell } from './templates.js';
import { buildFurniture } from './furniture.js';
import { boothSign, artistsSign } from './textures.js';
import { api, photoUrl } from '../net/api.js';

// Sala personal (u-<id>): plantilla + muebles que pone el dueño con el editor (editor.js).
// Devuelve un "mundo" con la misma forma que el del Museo (museum.js), así el controlador,
// la interacción con E, la cabina del DJ, la consola y la pantalla funcionan igual.

export function isPersonalRoom() {
  const sala = (new URLSearchParams(location.search).get('sala') || '').toLowerCase();
  return sala.startsWith('u-');
}

const MAX_LAMP_LIGHTS = { high: 6, low: 2 }; // luces reales de lámparas (las demás solo brillan)

export function buildPersonalRoom(scene, renderer, quality) {
  const high = quality === 'high';
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  scene.background = new THREE.Color(0x0d0d0f);

  const ownerId = (new URLSearchParams(location.search).get('sala') || '').toLowerCase().slice(2);
  let ownerName = '';
  api(`profile?id=${ownerId}`).then((r) => { if (r.ok) ownerName = r.profile.name; });

  let shell = null;
  let layout = null;      // { template, pieces, chosen }
  let hours = 12;
  const pieces = new Map(); // id -> { piece, holder, built, colliders, blockers, item, seats }
  const state = { music: -1, lights: null, dj: null, parts: {}, hearts: 0, video: null };
  const speakers = [new THREE.Vector3(-1, 1.6, -4), new THREE.Vector3(1, 1.6, -4)];
  const screenPos = new THREE.Vector3(0, 2.5, -5);
  let idleTex = null;

  const world = {
    editable: true,
    colliders: [], blockers: [], interactables: [],
    bounds: { minY: 0.2, maxY: 4 },
    spawn: { x: 0, z: 4, yaw: 0 },
    works: { paintings: [], sculptures: [] },
    get layout() { return layout; },
    get shell() { return shell; },
    pieces,
    screen: { get position() { return screenPos; } },
    stage: { setVideo(video) { state.video = video; applyVideo(); } },
    dj: {
      get spot() { return spotOf('cabina', (p) => p.spot); },
      get exit() { return world.dj.spot?.exit; },
      speakers,
      setBooth(dj) { state.dj = dj; for (const p of ofType('cabina')) applyBooth(p); },
      setMusic(level) { state.music = level; },
    },
    artists: {
      setSign(parts) { state.parts = parts ?? {}; for (const p of ofType('consola')) applyArtists(p); },
      setLights(s) { state.lights = s; },
      get spots() {
        return { luces: spotOf('consola', (p) => p.spots.luces), escenario: spotOf('consola', (p) => p.spots.escenario) };
      },
    },
    // Contador de corazones del atril (lo llena notes.js)
    lectern: { setHearts(n) { state.hearts = n; for (const p of ofType('atril')) p.built.parts.lectern.setHearts(n); } },
    setLayout,
    setPiece,
    removePiece,
    // Para el editor: mueble al que pertenece una malla
    pieceOf(object) { for (let o = object; o; o = o.parent) if (o.userData.pieceId) return pieces.get(o.userData.pieceId); return null; },
    update(dt, t) {
      shell?.update(dt, t, { music: state.music, lights: state.lights });
      const p = state.music > 0 ? Math.min(1, state.music * 2.2) : 0;
      for (const e of pieces.values()) {
        const parts = e.built.parts;
        if (parts.spin) parts.spin.rotation.y += dt * 0.6;
        if (parts.cones) parts.cones.forEach((c, i) => c.scale.setScalar(1 + p * (i ? 0.08 : 0.05) * Math.sin(t * 30)));
        if (e.light?.userData.sparkle) e.light.intensity = (high ? 2 : 1) * (0.6 + 0.4 * Math.sin(t * 5));
      }
    },
    setTime(h) { hours = h; shell?.setTime(h); },
  };

  const ofType = (type) => [...pieces.values()].filter((e) => e.piece.type === type);
  // Pasa un punto local de un mueble a coordenadas de la sala
  function toWorld(e, lx, lz) {
    const c = Math.cos(e.piece.r), s = Math.sin(e.piece.r);
    return { x: e.piece.x + c * lx + s * lz, z: e.piece.z - s * lx + c * lz };
  }
  function spotOf(type, get) {
    const e = ofType(type)[0];
    if (!e) return null;
    const local = get(e.built.parts);
    const p = toWorld(e, local.x, local.z), ex = toWorld(e, local.exit.x, local.exit.z);
    return { x: p.x, y: local.y, z: p.z, yaw: local.yaw + e.piece.r, exit: ex };
  }

  // ---------- Plantilla ----------
  function setLayout(next) {
    if (!next) return;
    const changed = !shell || shell.id !== next.template;
    layout = { ...next, pieces: [...next.pieces] };
    if (changed) {
      if (shell) { scene.remove(shell.group); shell.dispose(); }
      shell = buildShell(next.template, { high });
      scene.add(shell.group);
      shell.setTime(hours);
      world.bounds = shell.bounds;
      world.spawn = shell.spawn;
      scene.background = new THREE.Color(next.template === 'terraza' ? 0x87b3e8 : 0x0d0d0f);
    }
    for (const id of [...pieces.keys()]) dropPiece(id);
    for (const p of next.pieces) addPiece(p);
    rebuildLists();
  }

  // ---------- Muebles ----------
  function addPiece(piece) {
    const built = buildFurniture(piece, { high, h: shell?.def.h });
    const holder = new THREE.Group();
    holder.position.set(piece.x, piece.y ?? 0, piece.z);
    holder.rotation.y = piece.r;
    holder.add(built.group);
    holder.userData.pieceId = piece.id;
    scene.add(holder);
    const e = { piece, holder, built };
    pieces.set(piece.id, e);
    place(e);
    return e;
  }
  // Choques, asientos e interacción en coordenadas de la sala (se recalculan al mover)
  function place(e) {
    const { piece, holder, built } = e;
    holder.position.set(piece.x, piece.y ?? 0, piece.z);
    holder.rotation.y = piece.r;
    holder.updateMatrixWorld(true);
    const c = Math.abs(Math.cos(piece.r)), s = Math.abs(Math.sin(piece.r));
    e.colliders = built.boxes.map((b) => {
      const p = toWorld(e, b.x, b.z);
      const hw = c * b.w / 2 + s * b.d / 2, hd = s * b.w / 2 + c * b.d / 2;
      return { minX: p.x - hw, maxX: p.x + hw, minZ: p.z - hd, maxZ: p.z + hd, top: b.top + (piece.y ?? 0), climb: b.climb, noStand: b.noStand };
    });
    e.blockers = [];
    if (built.parts.block) holder.traverse((o) => { if (o.isMesh) e.blockers.push(o); });
    const seats = built.seats.map((st) => { const p = toWorld(e, st.x, st.z); return { x: p.x, y: st.y, z: p.z, yaw: st.yaw + piece.r }; });
    e.item = built.interact ? { object: holder, ...built.interact, seats } : (e.photoItem ?? null);
    if (piece.type === 'cuadro') applyPhoto(e);
    if (piece.type === 'cabina') applyBooth(e);
    if (piece.type === 'consola') applyArtists(e);
    if (piece.type === 'atril') built.parts.lectern.setHearts(state.hearts);
    holder.traverse((o) => { o.userData.interact = e.item ?? undefined; });
  }
  function dropPiece(id) {
    const e = pieces.get(id);
    if (!e) return;
    scene.remove(e.holder);
    e.holder.traverse((o) => {
      o.element?.remove(); // carteles HTML (corazones del atril)
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) { if (m.userData.shared) continue; if (m.map && !m.map.userData.shared) m.map.dispose(); m.dispose(); }
    });
    if (e.light) scene.remove(e.light);
    pieces.delete(id);
  }
  // Un mueble nuevo o cambiado: si solo se movió, se reubica; si cambió otra cosa, se rearma
  function setPiece(piece, oldId) {
    if (oldId && oldId !== piece.id && pieces.has(oldId)) {
      const e = pieces.get(oldId);
      pieces.delete(oldId);
      pieces.set(piece.id, e);
      e.holder.userData.pieceId = piece.id;
    }
    const cur = pieces.get(piece.id);
    if (layout) {
      const i = layout.pieces.findIndex((p) => p.id === piece.id || p.id === oldId);
      if (i >= 0) layout.pieces[i] = piece; else layout.pieces.push(piece);
    }
    const same = cur && ['type', 'c', 'photo', 'w'].every((k) => cur.piece[k] === piece[k]);
    if (same) { cur.piece = piece; place(cur); } else { if (cur) dropPiece(piece.id); addPiece(piece); }
    rebuildLists();
  }
  function removePiece(id) {
    dropPiece(id);
    if (layout) layout.pieces = layout.pieces.filter((p) => p.id !== id);
    rebuildLists();
  }

  function rebuildLists() {
    const all = [...pieces.values()];
    world.colliders = [...(shell?.colliders ?? []), ...all.flatMap((e) => e.colliders)];
    world.blockers = [...(shell?.blockers ?? []), ...all.flatMap((e) => e.blockers)];
    world.interactables = all.map((e) => e.item).filter(Boolean);
    // Parlantes: los dos primeros (izquierdo y derecho); si no hay, la cabina
    const spk = ofType('parlante').map((e) => { const p = toWorld(e, 0, 0.3); return new THREE.Vector3(p.x, 1.2, p.z); });
    const booth = ofType('cabina')[0];
    const fallback = booth ? new THREE.Vector3(booth.piece.x, 1.2, booth.piece.z) : new THREE.Vector3(0, 1.6, 0);
    speakers[0].copy(spk[0] ?? fallback);
    speakers[1].copy(spk[1] ?? spk[0] ?? fallback);
    const scr = ofType('pantalla')[0];
    if (scr) screenPos.set(scr.piece.x, scr.piece.y, scr.piece.z);
    applyVideo();
    applyLights();
  }

  // Luces de las lámparas y la bola de espejos: solo las primeras (son caras)
  function applyLights() {
    let n = 0;
    const max = high ? MAX_LAMP_LIGHTS.high : MAX_LAMP_LIGHTS.low;
    for (const e of pieces.values()) {
      const want = e.built.parts.light;
      if (!want) continue;
      if (n++ >= max) { if (e.light) { scene.remove(e.light); e.light = null; } continue; }
      if (!e.light) {
        e.light = new THREE.PointLight(want.color, want.sparkle ? 2 : 3.5, want.sparkle ? 8 : 5, 1.6);
        e.light.userData.sparkle = !!want.sparkle;
        scene.add(e.light);
      }
      e.light.position.set(e.piece.x, want.y, e.piece.z);
    }
  }

  // ---------- Cuadros con fotos de la galería del dueño ----------
  function applyPhoto(e) {
    const canvasMesh = e.built.parts.canvas;
    const id = e.piece.photo;
    if (e.photoId === id) return;
    e.photoId = id;
    if (!id) {
      e.photoItem = null;
      canvasMesh.material.map = placeholder();
      canvasMesh.material.needsUpdate = true;
      return;
    }
    photoUrl(id).then(async (url) => {
      if (!url || e.photoId !== id) return;
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch { return; }
      // Copia en un canvas (la ficha con E la muestra en grande)
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      // "Cubrir" el marco sin deformar la foto
      const { w, h } = e.built.parts.frame;
      const frameAspect = (w - 0.12) / (h - 0.12), imgAspect = cv.width / cv.height;
      if (imgAspect > frameAspect) { tex.repeat.set(frameAspect / imgAspect, 1); tex.offset.set((1 - tex.repeat.x) / 2, 0); }
      else { tex.repeat.set(1, imgAspect / frameAspect); tex.offset.set(0, (1 - tex.repeat.y) / 2); }
      canvasMesh.material.map = tex;
      canvasMesh.material.needsUpdate = true;
      e.item = e.photoItem = { object: e.holder, kind: 'art', prompt: 'Ver foto', image: cv, info: { title: 'Foto', author: ownerName ? `De la galería de ${ownerName}` : '' } };
      e.holder.traverse((o) => { o.userData.interact = e.item; });
      rebuildLists();
    });
  }
  let placeholderTex = null;
  function placeholder() {
    if (placeholderTex) return placeholderTex;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 192;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 192);
    grad.addColorStop(0, '#efe9df'); grad.addColorStop(1, '#d9d1c4');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 192);
    placeholderTex = new THREE.CanvasTexture(c);
    placeholderTex.colorSpace = THREE.SRGBColorSpace;
    placeholderTex.userData.shared = true;
    return placeholderTex;
  }

  // ---------- Cabina, consola y pantallas ----------
  function applyBooth(e) {
    const sign = e.built.parts.sign;
    sign.material.map?.dispose();
    sign.visible = !!state.dj;
    if (state.dj) { sign.material.map = boothSign(state.dj.name, state.dj.track); sign.material.needsUpdate = true; }
  }
  function applyArtists(e) {
    const sign = e.built.parts.artistSign;
    sign.material.map?.dispose();
    sign.material.map = artistsSign(state.parts);
    sign.material.needsUpdate = true;
  }
  // Hasta 2 pantallas: muestran el video del VJ (la segunda, si es "espejo", lo mismo que la primera)
  function applyVideo() {
    const screens = ofType('pantalla');
    screens.forEach((e, i) => {
      const mesh = e.built.parts.screen;
      const live = state.video && (i === 0 || e.piece.m === 'espejo');
      if (mesh.material.map && !mesh.material.map.userData.shared) mesh.material.map.dispose();
      if (live) {
        const tex = new THREE.VideoTexture(state.video);
        tex.colorSpace = THREE.SRGBColorSpace;
        // "Cubrir" la pantalla con el video
        const { w, h } = e.built.parts.size;
        const va = (state.video.videoWidth || 16) / (state.video.videoHeight || 9), sa = w / h;
        if (va > sa) { tex.repeat.set(sa / va, 1); tex.offset.set((1 - tex.repeat.x) / 2, 0); }
        else { tex.repeat.set(1, va / sa); tex.offset.set(0, (1 - tex.repeat.y) / 2); }
        mesh.material.map = tex;
      } else mesh.material.map = idle();
      mesh.material.needsUpdate = true;
    });
  }
  function idle() {
    if (idleTex) return idleTex;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 288;
    const g = c.getContext('2d');
    g.fillStyle = '#060608';
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.font = '600 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Pantalla libre · E para pasar visuales', 256, 150);
    idleTex = new THREE.CanvasTexture(c);
    idleTex.colorSpace = THREE.SRGBColorSpace;
    idleTex.userData.shared = true;
    return idleTex;
  }

  // Mientras llega el diseño de la sala, se ve el loft vacío
  setLayout({ template: 'loft', pieces: [], chosen: false });
  return world;
}

export const isWallPiece = (type) => FURNITURE[type]?.mount === 'wall';
