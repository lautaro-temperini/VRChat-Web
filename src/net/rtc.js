// Voz y pantalla compartida, de jugador a jugador (WebRTC, P2P).
// El servidor de la sala solo pasa las "señales" para que dos navegadores se encuentren;
// el audio y el video viajan directo entre ellos.
//
// - Voz: cada voz suena desde la posición de su personaje (audio espacial 3D):
//   más fuerte cerca, más bajo lejos, y a la izquierda/derecha según dónde esté.
// - Pantalla: quien comparte manda su pantalla a todos; se ve en la pantalla gigante
//   y su audio sale desde ahí.
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
        await pc.setLocalDescription();
        this.signal(id, { description: pc.localDescription });
      } catch (e) { console.warn('rtc offer', e); } finally { p.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.signal(id, { candidate }); };
    pc.ontrack = (e) => this.onTrack(id, e);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); };
    this.peers.set(id, p);
    for (const stream of [this.mic, this.screenStream]) {
      if (stream) for (const t of stream.getTracks()) pc.addTrack(t, stream);
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
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('rtc signal', e); }
  }

  // Alguien entró a la sala: si tengo micrófono o pantalla, me conecto con él
  playerJoined(id) {
    if (this.mic || this.screenStream) this.peer(id);
  }

  playerLeft(id) {
    const p = this.peers.get(id);
    if (p) { p.pc.close(); this.peers.delete(id); }
    for (const key of [id, `${id}:screen`]) this.dropSound(key);
    if (this.screen?.id === id) this.setScreen(null);
  }

  // ---------- Audio espacial ----------

  onTrack(id, e) {
    const stream = e.streams[0];
    if (!stream) return;
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

  dropSound(key) {
    const s = this.sounds.get(key);
    if (!s) return;
    s.src.disconnect();
    s.panner.disconnect();
    s.gain.disconnect();
    s.el.srcObject = null;
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

  // Mensaje de la sala sobre quién comparte
  setScreen(info) {
    if (!info && this.screen) {
      this.dropSound(`${this.screen.id}:screen`);
      this.onScreen(null, this.screen.id);
    }
    this.screen = info;
  }
}
