// Voz y pantalla compartida, de jugador a jugador (WebRTC, P2P).
// El servidor de la sala solo pasa las "señales" para que dos navegadores se encuentren;
// el audio y el video viajan directo entre ellos.
//
// - Voz: cada voz suena desde la posición de su personaje (audio espacial 3D):
//   más fuerte cerca, más bajo lejos, y a la izquierda/derecha según dónde esté.
// - Pantalla: quien comparte manda su pantalla a todos; se ve en la pantalla gigante
//   y su audio sale desde ahí.
// - DJ: quien está en la cabina manda su música (estéreo, buena calidad) y sale por los
//   dos parlantes del escenario: el canal izquierdo por uno y el derecho por el otro.
//
// Límite conocido: sin un servidor TURN, algunas redes muy cerradas (ciertas oficinas
// o datos móviles) pueden no conectarse. Se agrega al subirlo online.

const ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

export class RTC {
  constructor(net) {
    this.net = net;
    this.peers = new Map();   // id del jugador -> { pc, polite, makingOffer, ignoreOffer }
    this.sounds = new Map();  // clave -> { el, src, panner, analyser, data }
    this.mic = null;          // mi micrófono (MediaStream)
    this.muted = false;
    this.screenStream = null; // mi pantalla, si la estoy compartiendo
    this.screen = null;       // { id, streamId } de quien comparte en la sala
    this.djStream = null;     // mi música, si estoy en la cabina
    this.dj = null;           // { id, streamId, name, track } de quien pasa música en la sala
    this.stageStream = null;  // mi video en la pantalla del escenario (VJ)
    this.stage = null;        // { id, streamId } de quien pasa video en la pantalla del escenario
    this.onStage = () => {};  // (video | null) cuando cambia la pantalla del escenario
    this.remoteStreams = new Map(); // id del stream -> { id del jugador, stream } (para ubicar la música si llega antes del aviso)
    this.ctx = null;
    this.onScreen = () => {}; // (video | null, idDelDueño) cuando cambia la pantalla de la sala
    this.onMic = () => {};    // ('off' | 'on') cuando empiezo o dejo de hablar
    this.talking = false;     // apretando V
    this.voiceEnabled = true; // chat de voz activado en Ajustes
    this.mediaMuted = false;  // M: música / pantalla de la sala en silencio
    this.mutedUsers = new Set(); // ids de jugadores muteados por mí
    this.volumes = { master: 1, voices: 1, media: 1 };
  }

  // El navegador solo deja sonar audio después de un click o tecla: se llama ahí
  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // Dos "buses": voces y medios de la sala (pantalla compartida, música)
      this.voicesBus = this.ctx.createGain();
      this.mediaBus = this.ctx.createGain();
      this.voicesBus.connect(this.master);
      this.mediaBus.connect(this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get micState() { return this.mic && this.talking ? 'on' : 'off'; }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.voicesBus.gain.value = this.voiceEnabled ? this.volumes.voices : 0;
    this.mediaBus.gain.value = this.mediaMuted ? 0 : this.volumes.media;
  }

  setVolumes(v) { Object.assign(this.volumes, v); this.applyVolumes(); }

  toggleMedia() { this.mediaMuted = !this.mediaMuted; this.applyVolumes(); return this.mediaMuted; }

  // Mutear a un jugador: deja de sonar su voz (solo para mí)
  setUserMuted(id, muted) {
    if (muted) this.mutedUsers.add(id); else this.mutedUsers.delete(id);
    const s = this.sounds.get(id);
    if (s) s.gain.gain.value = muted ? 0 : 1;
  }

  // ---------- Conexiones ----------

  peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    // "Negociación perfecta": si los dos ofrecen a la vez, el "educado" cede
    p = { pc, polite: this.net.id < id, makingOffer: false, ignoreOffer: false };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription(stereo(await pc.createOffer()));
        this.signal(id, { description: pc.localDescription });
      } catch (e) { console.warn('rtc offer', e); } finally { p.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.signal(id, { candidate }); };
    pc.ontrack = (e) => this.onTrack(id, e);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); };
    this.peers.set(id, p);
    for (const stream of [this.mic, this.screenStream, this.djStream, this.stageStream]) {
      if (!stream) continue;
      for (const t of stream.getTracks()) {
        const sender = pc.addTrack(t, stream);
        if (stream === this.djStream) setBitrate(sender);
      }
    }
    return p;
  }

  signal(to, data) { this.net.send({ t: 'rtc', to, data }); }

  async onSignal(from, { description, candidate } = {}) {
    const p = this.peer(from);
    const pc = p.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription(stereo(await pc.createAnswer()));
          this.signal(from, { description: pc.localDescription });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('rtc signal', e); }
  }

  // Alguien entró a la sala: si tengo micrófono o pantalla, me conecto con él
  playerJoined(id) {
    if (this.mic || this.screenStream || this.djStream || this.stageStream) this.peer(id);
  }

  playerLeft(id) {
    const p = this.peers.get(id);
    if (p) { p.pc.close(); this.peers.delete(id); }
    for (const key of [id, `${id}:screen`, `${id}:dj`]) this.dropSound(key);
    for (const [sid, r] of this.remoteStreams) if (r.id === id) this.remoteStreams.delete(sid);
    if (this.screen?.id === id) this.setScreen(null);
    if (this.dj?.id === id) this.setDJ(null);
    if (this.stage?.id === id) this.setStage(null);
  }

  // ---------- Audio espacial ----------

  onTrack(id, e) {
    const stream = e.streams[0];
    if (!stream) return;
    this.remoteStreams.set(stream.id, { id, stream });
    if (this.stage && this.stage.id === id && stream.id === this.stage.streamId) {
      if (e.track.kind === 'video') this.onStage(videoOf(stream));
      return;
    }
    if (this.dj && this.dj.id === id && stream.id === this.dj.streamId) {
      if (e.track.kind === 'audio') this.addMusic(`${id}:dj`, stream);
      return;
    }
    const isScreen = this.screen && this.screen.id === id && stream.id === this.screen.streamId;
    if (e.track.kind === 'video') {
      if (!isScreen) return;
      const video = document.createElement('video');
      Object.assign(video, { muted: true, playsInline: true, autoplay: true, srcObject: stream });
      video.play().catch(() => {});
      this.onScreen(video, id);
    } else {
      this.addSound(isScreen ? `${id}:screen` : id, stream, isScreen);
    }
  }

  addSound(key, stream, isScreen) {
    this.dropSound(key);
    const ctx = this.audio();
    // Chrome necesita el stream enganchado a un <audio> (mudo) para que suene por WebAudio
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse',
      refDistance: isScreen ? 4 : 1.5, rolloffFactor: isScreen ? 0.7 : 1.3, maxDistance: 60,
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const gain = ctx.createGain();
    gain.gain.value = this.mutedUsers.has(key) ? 0 : 1;
    src.connect(analyser);
    src.connect(panner).connect(gain).connect(isScreen ? this.mediaBus : this.voicesBus);
    this.sounds.set(key, { el, src, panner, gain, analyser, data: new Uint8Array(analyser.fftSize) });
  }

  // Música del DJ: el canal izquierdo sale por un parlante y el derecho por el otro
  addMusic(key, stream) {
    this.dropSound(key);
    const ctx = this.audio();
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const split = ctx.createChannelSplitter(2);
    const gain = ctx.createGain();
    const panners = [0, 1].map((ch) => {
      const p = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 5, rolloffFactor: 0.6, maxDistance: 80 });
      split.connect(p, ch);
      p.connect(gain);
      return p;
    });
    src.connect(split);
    gain.connect(this.mediaBus);
    this.sounds.set(key, { el, src, panner: panners[0], panners, split, gain, ...this.beatAnalyser(src) });
  }

  // Analizador para que las luces sigan el ritmo (sirve también para mi propia música, sin que suene)
  beatAnalyser(src) {
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    return { analyser, data: new Uint8Array(analyser.fftSize), freq: new Uint8Array(analyser.frequencyBinCount) };
  }

  // Energía de los graves (0..1) de la música que suena en la sala, para las luces
  musicLevel() {
    const key = this.dj && (this.dj.id === this.net.id ? 'me:dj' : `${this.dj.id}:dj`);
    const s = key && this.sounds.get(key);
    if (!s?.freq) return 0;
    s.analyser.getByteFrequencyData(s.freq);
    // Hasta ~150 Hz: bombo y bajo
    const bins = Math.max(2, Math.round(150 / (this.ctx.sampleRate / s.analyser.fftSize)));
    let sum = 0;
    for (let i = 1; i <= bins; i++) sum += s.freq[i];
    return sum / bins / 255;
  }

  dropSound(key) {
    const s = this.sounds.get(key);
    if (!s) return;
    s.src.disconnect();
    s.panner?.disconnect();
    s.panners?.forEach((p) => p.disconnect());
    s.split?.disconnect();
    s.gain?.disconnect();
    if (s.el) s.el.srcObject = null;
    this.sounds.delete(key);
  }

  // Cada frame: dónde está quien escucha (la cámara) y dónde suena cada voz
  update(camera, positionOf) {
    if (!this.ctx || !this.sounds.size) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const p = camera.position;
    const f = camera.getWorldDirection(this._f ??= camera.position.clone());
    const u = (this._u ??= p.clone()).set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.05); L.positionY.setTargetAtTime(p.y, t, 0.05); L.positionZ.setTargetAtTime(p.z, t, 0.05);
      L.forwardX.setTargetAtTime(f.x, t, 0.05); L.forwardY.setTargetAtTime(f.y, t, 0.05); L.forwardZ.setTargetAtTime(f.z, t, 0.05);
      L.upX.setTargetAtTime(u.x, t, 0.05); L.upY.setTargetAtTime(u.y, t, 0.05); L.upZ.setTargetAtTime(u.z, t, 0.05);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    for (const [key, s] of this.sounds) {
      if (s.panners) {
        // Música: cada canal en su parlante
        const spk = positionOf(key);
        if (spk) s.panners.forEach((p, i) => { p.positionX.setTargetAtTime(spk[i].x, t, 0.05); p.positionY.setTargetAtTime(spk[i].y, t, 0.05); p.positionZ.setTargetAtTime(spk[i].z, t, 0.05); });
        continue;
      }
      if (!s.panner) continue;
      const pos = positionOf(key);
      if (!pos) continue;
      s.panner.positionX.setTargetAtTime(pos.x, t, 0.05);
      s.panner.positionY.setTargetAtTime(pos.y, t, 0.05);
      s.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
    }
  }

  // Volumen de una voz (0..1), para mostrar quién está hablando
  level(key) {
    const s = this.sounds.get(key);
    if (!s) return 0;
    s.analyser.getByteTimeDomainData(s.data);
    let sum = 0;
    for (const v of s.data) sum += (v - 128) ** 2;
    return Math.sqrt(sum / s.data.length) / 128;
  }

  // ---------- Mi micrófono ----------

  // Pulsar para hablar: mientras se mantiene V, el micrófono transmite
  async talk(on) {
    if (on === this.talking) return { ok: true };
    if (on && !this.voiceEnabled) return { ok: false, error: 'El chat de voz está desactivado en Ajustes.' };
    this.audio();
    this.talking = on;
    if (on && !this.mic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        this.talking = false;
        return { ok: false, error: 'No se pudo usar el micrófono (¿le diste permiso al navegador?).' };
      }
      for (const t of this.mic.getAudioTracks()) t.enabled = this.talking;
      for (const id of this.remoteIds()) {
        const p = this.peers.get(id);
        if (p) for (const t of this.mic.getTracks()) p.pc.addTrack(t, this.mic);
        else this.peer(id);
      }
    }
    if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = this.talking;
    this.net.send({ t: 'mic', v: this.micState });
    this.onMic(this.micState);
    return { ok: true };
  }

  // Activar / desactivar el chat de voz entero (no hablo ni escucho voces)
  setVoiceEnabled(on) {
    this.voiceEnabled = on;
    if (!on && this.mic) {
      this.talking = false;
      for (const t of this.mic.getTracks()) t.stop();
      for (const { pc } of this.peers.values()) {
        for (const s of pc.getSenders()) if (s.track && s.track.kind === 'audio' && this.mic.getTracks().includes(s.track)) pc.removeTrack(s);
      }
      this.mic = null;
      this.net.send({ t: 'mic', v: 'off' });
      this.onMic('off');
    }
    this.applyVolumes();
  }
  remoteIds() { return this.getRemoteIds?.() ?? []; }

  // ---------- Pantalla compartida ----------

  async startScreen() {
    this.audio();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch {
      return { ok: false, error: 'Se canceló o el navegador no permite compartir pantalla.' };
    }
    this.screenStream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => this.stopScreen());
    // Primero aviso a la sala (así los demás saben que este stream es una pantalla)…
    this.net.send({ t: 'screen', on: true, streamId: stream.id });
    this.screen = { id: this.net.id, streamId: stream.id };
    // …y después mando el video
    for (const id of this.remoteIds()) {
      const p = this.peers.get(id);
      if (p) for (const t of stream.getTracks()) p.pc.addTrack(t, stream);
      else this.peer(id);
    }
    const local = document.createElement('video');
    Object.assign(local, { muted: true, playsInline: true, autoplay: true, srcObject: stream });
    local.play().catch(() => {});
    this.onScreen(local, this.net.id);
    return { ok: true };
  }

  stopScreen() {
    const stream = this.screenStream;
    if (!stream) return;
    this.screenStream = null;
    for (const t of stream.getTracks()) t.stop();
    for (const { pc } of this.peers.values()) {
      for (const sender of pc.getSenders()) if (sender.track && stream.getTracks().includes(sender.track)) pc.removeTrack(sender);
    }
    this.net.send({ t: 'screen', on: false });
    this.setScreen(null);
  }

  // ---------- Música del DJ ----------

  // Entradas de audio disponibles (controladora, placa de sonido, cable virtual…)
  async audioInputs() {
    try {
      // Sin permiso, el navegador no dice los nombres: lo pido una vez y lo suelto
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch { /* sin permiso: van sin nombre */ }
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Entrada ${i + 1}` }));
  }

  // source: id de una entrada de audio, o 'system' (audio de la PC al compartir pantalla/pestaña)
  async captureMusic(source) {
    this.audio();
    let stream;
    try {
      if (source === 'system') {
        const d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        d.getVideoTracks().forEach((t) => { t.stop(); d.removeTrack(t); }); // solo el audio
        if (!d.getAudioTracks().length) return { ok: false, error: 'No se compartió audio. Tildá "Compartir audio" al elegir la pantalla o pestaña.' };
        stream = d;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          deviceId: source ? { exact: source } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000,
        } });
      }
    } catch {
      return { ok: false, error: 'No se pudo usar esa entrada de audio (¿le diste permiso al navegador?).' };
    }
    for (const t of stream.getAudioTracks()) t.contentHint = 'music';
    this.pendingMusic = stream;
    return { ok: true, streamId: stream.id };
  }

  // La sala confirmó que la cabina es mía: empiezo a mandar la música
  startMusic() {
    const stream = this.pendingMusic;
    if (!stream) return;
    this.pendingMusic = null;
    this.djStream = stream;
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onMusicEnded?.());
    for (const id of this.remoteIds()) {
      const p = this.peers.get(id);
      if (p) for (const t of stream.getTracks()) setBitrate(p.pc.addTrack(t, stream));
      else this.peer(id);
    }
    // Me analizo a mí mismo para las luces (sin sonar: ya lo escucho en mi PC)
    const src = this.ctx.createMediaStreamSource(stream);
    this.sounds.set('me:dj', { el: null, src, ...this.beatAnalyser(src) });
  }

  stopMusic() {
    for (const stream of [this.djStream, this.pendingMusic]) {
      if (!stream) continue;
      for (const t of stream.getTracks()) t.stop();
      for (const { pc } of this.peers.values()) {
        for (const sender of pc.getSenders()) if (sender.track && stream.getTracks().includes(sender.track)) pc.removeTrack(sender);
      }
    }
    this.djStream = this.pendingMusic = null;
    const me = this.sounds.get('me:dj');
    if (me) { me.src.disconnect(); this.sounds.delete('me:dj'); }
  }

  // Mensaje de la sala sobre quién pasa música
  setDJ(info) {
    if (this.dj && (!info || info.id !== this.dj.id)) this.dropSound(`${this.dj.id}:dj`);
    this.dj = info;
    if (info && info.id !== this.net.id) {
      const r = this.remoteStreams.get(info.streamId);
      if (r) { this.dropSound(info.id); this.addMusic(`${info.id}:dj`, r.stream); }
    }
  }

  // ---------- Pantalla del escenario (VJ): solo video ----------

  async captureStage() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      this.pendingStage = stream;
      return { ok: true, streamId: stream.id };
    } catch {
      return { ok: false, error: 'Se canceló o el navegador no permite compartir pantalla.' };
    }
  }

  // La sala confirmó que la pantalla es mía
  startStage() {
    const stream = this.pendingStage;
    if (!stream) return;
    this.pendingStage = null;
    this.stageStream = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onStageEnded?.());
    for (const id of this.remoteIds()) {
      const p = this.peers.get(id);
      if (p) for (const t of stream.getTracks()) p.pc.addTrack(t, stream);
      else this.peer(id);
    }
    this.onStage(videoOf(stream));
  }

  stopStage() {
    for (const stream of [this.stageStream, this.pendingStage]) {
      if (!stream) continue;
      for (const t of stream.getTracks()) t.stop();
      for (const { pc } of this.peers.values()) {
        for (const sender of pc.getSenders()) if (sender.track && stream.getTracks().includes(sender.track)) pc.removeTrack(sender);
      }
    }
    this.stageStream = this.pendingStage = null;
  }

  setStage(info) {
    if (!info && this.stage) this.onStage(null);
    this.stage = info;
    if (info && info.id !== this.net.id) {
      const r = this.remoteStreams.get(info.streamId);
      if (r?.stream.getVideoTracks().length) this.onStage(videoOf(r.stream));
    }
  }

  // Mensaje de la sala sobre quién comparte
  setScreen(info) {
    if (!info && this.screen) {
      this.dropSound(`${this.screen.id}:screen`);
      this.onScreen(null, this.screen.id);
    }
    this.screen = info;
  }
}

// Opus en estéreo y con más calidad (por defecto WebRTC lo arma para voz, en mono)
function stereo(desc) {
  const sdp = desc.sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt, params) =>
    (/stereo=1/.test(params) ? line : `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=256000`));
  return { type: desc.type, sdp };
}

function setBitrate(sender) {
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = 256000;
  sender.setParameters(params).catch(() => {});
}

function videoOf(stream) {
  const video = document.createElement('video');
  Object.assign(video, { muted: true, playsInline: true, autoplay: true, srcObject: stream });
  video.play().catch(() => {});
  return video;
}
