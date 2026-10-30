// Voz, música del DJ y pantalla del escenario, por el servidor de audio de Cloudflare (Realtime SFU).
// Nadie se conecta directo con nadie: cada navegador manda y recibe todo por Cloudflare,
// así ningún jugador ve la IP de otro. La sala hace de intermediaria con la API
// (tiene la clave) y decide qué puede escuchar cada uno (distancia, grupos, silenciados).
//
// - Voz: escuchás a los 4 más cercanos que estén hablando, dentro de 10 m, con audio 3D.
//   En un grupo privado solo escuchás a tu grupo (desde cualquier lugar de la sala).
// - DJ: la música (estéreo, buena calidad) sale por los equipos de la sala (world.dj.sources):
//   en el museo, line arrays, subs, frontfill y surround, cada uno en su lugar; en las salas
//   personales, los dos parlantes (izquierdo y derecho). Se escucha también estando en grupo.
// - Pantalla del escenario (VJ): solo video.

// Sin TURN configurado en el servidor (o si no responde) se usa solo el STUN de Cloudflare
const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const HEAR_RANGE = 10;      // m: hasta dónde se escucha una voz
const PRELOAD_RANGE = 12;   // m: me suscribo un poco antes, así no se pierde la primera palabra
const DROP_RANGE = 18;      // m: recién acá suelto la suscripción (para no ir y venir)
const MAX_AUDIBLE = 4;      // voces que suenan a la vez (las más cercanas que estén hablando)
const MAX_PRELOAD = 8;      // voces a las que estoy suscripto a la vez (fuera de un grupo)
const RETRY = 1500;         // ms entre intentos si la pista todavía no está publicada
// Bandas de los equipos de sonido: [tipo de filtro, frecuencia en Hz]. 'full' (o nada) = sin filtro
const MUSIC_BANDS = {
  top: ['highpass', 90],    // line arrays y surround: los graves profundos van por los subs
  low: ['lowpass', 110],    // subs: solo graves
  high: ['highpass', 2000], // frontfill / tweeters: agudos, para que adelante se escuche claro
};

export class RTC {
  constructor(net) {
    this.net = net;
    this.sounds = new Map();  // clave -> { el, src, panner, gain, analyser, data }
    this.mic = null;          // mi micrófono (MediaStream)
    this.djStream = null;     // mi música, si estoy en la cabina
    this.dj = null;           // { id, name, track } de quien pasa música en la sala
    this.stageStream = null;  // mi video en la pantalla del escenario (VJ)
    this.stage = null;        // { id } de quien pasa video en la pantalla del escenario
    this.screen = null;       // (la pantalla del hall ya no existe; se guarda por compatibilidad)
    this.onStage = () => {};  // (video | null) cuando cambia la pantalla del escenario
    this.onScreen = () => {};
    this.onMic = () => {};    // ('off' | 'on') cuando empiezo o dejo de hablar
    this.talking = false;     // apretando V
    this.voiceEnabled = true; // chat de voz activado en Menú → Audio
    this.mediaMuted = false;  // M: música / pantalla de la sala en silencio
    this.mutedUsers = new Set(); // ids de jugadores muteados por mí
    this.volumes = { master: 1, voices: 1, media: 1 };
    this.ctx = null;
    this.flat = new Set();    // voces de mi grupo: suenan "en la oreja", sin distancia
    this.reset();
  }

  // Cambié de sala o me reconecté: todo empieza de cero (la sesión de Cloudflare es por conexión)
  reset() {
    try { this.pc?.close(); } catch { /* ya cerrada */ }
    this.pc = null;
    this.ice = null;            // servidores STUN/TURN (se piden a la sala la primera vez)
    this.chain = Promise.resolve();
    this.rid = 0;
    this.waiting = new Map();   // rid -> resolve
    this.local = {};            // tipo -> transceiver que publico (voice / dj / stage)
    this.subs = new Map();      // "id:tipo" -> { mid, state: 'pending' | 'on' }
    this.byMid = new Map();     // mid -> "id:tipo"
    this.retries = new Map();   // "id:tipo" -> timeout
    for (const key of [...this.sounds.keys()]) if (key !== 'me:dj') this.dropSound(key);
    this.flat.clear();
    // Si ya tenía micrófono, lo vuelvo a publicar en la sala nueva
    if (this.mic) this.publish('voice', this.mic.getAudioTracks()[0], this.mic);
  }

  // El navegador solo deja sonar audio después de un click o tecla: se llama ahí
  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // Dos "buses": voces y medios de la sala (música, pantalla)
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
  }

  // ---------- Conexión con Cloudflare (a través de la sala) ----------

  // Pedido a la sala, que lo pasa a la API de Cloudflare y responde
  request(op, data = {}) {
    const rid = ++this.rid;
    return new Promise((resolve) => {
      this.waiting.set(rid, resolve);
      this.net.send({ t: 'sfu', rid, op, ...data });
      setTimeout(() => { if (this.waiting.delete(rid)) resolve({ ok: false, error: 'timeout' }); }, 15_000);
    });
  }

  onSfu(m) {
    const resolve = this.waiting.get(m.rid);
    if (!resolve) return;
    this.waiting.delete(m.rid);
    resolve(m);
  }

  // Las negociaciones van de a una (si no, el navegador se confunde)
  queue(fn) {
    const run = this.chain.then(fn).catch((e) => { console.warn('sfu', e); });
    this.chain = run;
    return run;
  }

  // Servidores para atravesar redes cerradas (wifi de empresas, facultades, datos móviles con NAT
  // estricto): la sala pide credenciales TURN temporales a Cloudflare (la clave queda en el servidor).
  // Con TURN, el audio puede ir por TCP/TLS al 443, que casi ninguna red bloquea.
  iceServers() {
    this.ice ??= this.request('ice').then((r) => (r.ok && Array.isArray(r.iceServers) && r.iceServers.length ? r.iceServers : ICE));
    return this.ice;
  }

  async peer() {
    if (this.pc) return this.pc;
    const iceServers = await this.iceServers();
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    pc.ontrack = (e) => this.onTrack(e);
    this.pc = pc;
    return pc;
  }

  // Publicar una pista mía (voz, música o video)
  publish(kind, track, stream) {
    if (!track) return Promise.resolve();
    return this.queue(async () => {
      const pc = await this.peer();
      const tr = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      if (kind === 'dj') setBitrate(tr.sender);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(kind === 'dj' ? stereo(offer) : offer);
      const r = await this.request('push', { sdp: pc.localDescription.sdp, tracks: [{ mid: tr.mid, kind }] });
      if (!r.ok) { tr.stop(); console.warn('sfu push', r.error); return; }
      await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
      this.local[kind] = tr;
    });
  }

  unpublish(kind) {
    return this.queue(async () => {
      const tr = this.local[kind];
      if (!tr) return;
      delete this.local[kind];
      await this.request('unpush', { kinds: [kind] });
      try { tr.sender.replaceTrack(null); tr.stop(); } catch { /* ya cerrada */ }
    });
  }

  // Suscribirme a la pista de otro jugador
  subscribe(id, kind) {
    const key = `${id}:${kind}`;
    if (this.subs.has(key)) return;
    this.subs.set(key, { state: 'pending' });
    this.queue(async () => {
      if (!this.subs.has(key)) return; // la solté mientras esperaba
      const r = await this.request('pull', { items: [{ id, kind }] });
      const t = r.tracks?.[0];
      if (!r.ok || !t || t.error) {
        this.subs.delete(key);
        // Todavía no publicó (o la sala no me deja): reintento en un rato si sigue haciendo falta
        if (t?.error === 'not-yet' || r.error === 'timeout') this.retry(key, id, kind);
        return;
      }
      this.subs.set(key, { mid: t.mid, state: 'on' });
      this.byMid.set(t.mid, key);
      if (r.sdp) await this.answer(r.sdp);
    });
  }

  retry(key, id, kind) {
    clearTimeout(this.retries.get(key));
    this.retries.set(key, setTimeout(() => {
      this.retries.delete(key);
      if (this.wanted(id, kind)) this.subscribe(id, kind);
    }, RETRY));
  }

  // ¿Todavía quiero esa pista? (la música y el video sí mientras sigan; las voces las decide updateVoices)
  wanted(id, kind) {
    if (kind === 'dj') return this.dj?.id === id;
    if (kind === 'stage') return this.stage?.id === id;
    if (kind === 'stage2') return this.stage2?.id === id;
    return !!this.voiceWanted?.has(id);
  }

  async answer(sdp) {
    const pc = await this.peer();
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await this.request('answer', { sdp: ans.sdp });
  }

  unsubscribe(key) {
    clearTimeout(this.retries.get(key));
    this.retries.delete(key);
    const sub = this.subs.get(key);
    if (!sub) return;
    this.subs.delete(key);
    this.dropSound(key.endsWith(':voice') ? key.split(':')[0] : key);
    if (key.endsWith(':stage') && this.stage) this.onStage(null);
    if (key.endsWith(':stage2') && this.stage2) this.onStage2?.(null);
    if (!sub.mid) return;
    this.byMid.delete(sub.mid);
    this.queue(() => this.request('unpull', { mids: [sub.mid] }));
  }

  // La sala me cortó pistas que ya no puedo escuchar (por ejemplo, alguien entró a un grupo privado)
  cut(mids = []) {
    for (const mid of mids) {
      const key = this.byMid.get(mid);
      if (!key) continue;
      this.byMid.delete(mid);
      this.subs.delete(key);
      this.dropSound(key.endsWith(':voice') ? key.split(':')[0] : key);
    }
  }

  playerJoined() {}

  playerLeft(id) {
    for (const key of [...this.subs.keys()]) if (key.startsWith(`${id}:`)) this.unsubscribe(key);
    this.dropSound(id);
    this.flat.delete(id);
    if (this.dj?.id === id) this.setDJ(null);
    if (this.stage?.id === id) this.setStage(null);
    if (this.stage2?.id === id) this.setStage(null, 'stage2');
  }

  // ---------- Qué voces escucho ----------
  // Se llama cada medio segundo con los jugadores de la sala:
  // [{ id, pos, mic, hasVoice, group, blocked }], mi posición y mi grupo (o null)
  updateVoices(players, myPos, myGroup) {
    const wanted = new Set();
    const cands = [];
    for (const p of players) {
      if (!p.hasVoice || p.blocked) continue;
      if (myGroup ? p.group !== myGroup : !!p.group) continue; // grupo privado: solo entre ellos
      const d = p.pos ? p.pos.distanceTo(myPos) : Infinity;
      cands.push({ ...p, d });
    }
    cands.sort((a, b) => a.d - b.d);
    let audible;
    if (myGroup) {
      for (const p of cands) wanted.add(p.id);
      audible = cands.filter((p) => p.mic === 'on').slice(0, MAX_AUDIBLE);
    } else {
      let n = 0;
      for (const p of cands) {
        const subscribed = this.subs.has(`${p.id}:voice`);
        if (n < MAX_PRELOAD && (p.d <= PRELOAD_RANGE || (subscribed && p.d <= DROP_RANGE))) { wanted.add(p.id); n++; }
      }
      audible = cands.filter((p) => p.mic === 'on' && p.d <= HEAR_RANGE).slice(0, MAX_AUDIBLE);
    }
    this.voiceWanted = wanted;
    if (this.voiceEnabled) for (const id of wanted) this.subscribe(id, 'voice');
    for (const key of [...this.subs.keys()]) {
      if (!key.endsWith(':voice')) continue;
      const id = key.split(':')[0];
      if (!this.voiceEnabled || !wanted.has(id)) this.unsubscribe(key);
    }
    // Volumen de cada voz: suena si está entre las audibles y no la muteé
    const on = new Set(audible.map((p) => p.id));
    const t = this.ctx?.currentTime ?? 0;
    for (const [key, s] of this.sounds) {
      if (s.panners || !s.gain || key.includes(':')) continue;
      const v = on.has(key) && !this.mutedUsers.has(key) ? 1 : 0;
      s.gain.gain.setTargetAtTime(v, t, 0.08);
    }
    this.flat = myGroup ? new Set(cands.map((p) => p.id)) : new Set();
  }

  // ---------- Audio ----------

  onTrack(e) {
    const key = this.byMid.get(e.transceiver.mid);
    if (!key) return;
    const [id, kind] = key.split(':');
    const stream = new MediaStream([e.track]);
    if (kind === 'voice') this.addSound(id, stream);
    else if (kind === 'dj') this.addMusic(`${id}:dj`, stream);
    else if (kind === 'stage' && this.stage?.id === id) this.onStage(videoOf(stream));
    else if (kind === 'stage2' && this.stage2?.id === id) this.onStage2?.(videoOf(stream));
  }

  addSound(key, stream) {
    this.dropSound(key);
    const ctx = this.audio();
    // Chrome necesita el stream enganchado a un <audio> (mudo) para que suene por WebAudio
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.3, maxDistance: 60 });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const gain = ctx.createGain();
    gain.gain.value = 0; // updateVoices decide si suena
    src.connect(analyser);
    src.connect(panner).connect(gain).connect(this.voicesBus);
    this.sounds.set(key, { el, src, panner, gain, analyser, data: new Uint8Array(analyser.fftSize) });
  }

  // Música del DJ: suena por los equipos de la sala. Cada equipo es una fuente en su lugar
  // (ver musicSources); el grafo de cada uno se arma en update, cuando se sabe dónde está la música
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
    src.connect(split);
    gain.connect(this.mediaBus);
    this.sounds.set(key, { el, src, panners: [], chains: [], layout: null, split, gain, ...this.beatAnalyser(src) });
  }

  // Lista de fuentes de la música. positions puede ser:
  //  - [izq., der.] (dos Vector3, como las salas personales): un parlante por canal, como siempre
  //  - [{ pos, ch: 'L'|'R'|'mono', band: 'full'|'top'|'low'|'high', gain, model, ref, rolloff }]
  //    (los equipos del museo: line arrays, subs, frontfill, surround)
  musicSources(positions) {
    if (!positions?.length) return null;
    if (!positions[0].isVector3) return positions;
    this._pairs ??= new WeakMap();
    let list = this._pairs.get(positions);
    if (!list) {
      list = [{ pos: positions[0], ch: 'L' }, { pos: positions[1] ?? positions[0], ch: 'R' }];
      this._pairs.set(positions, list);
    }
    return list;
  }

  // Arma (o rearma, si cambió la sala) un canal por fuente: canal → filtro → volumen → panner → música
  buildMusic(s, list) {
    for (const c of s.chains) c.nodes.forEach((n) => n.disconnect());
    const ctx = this.ctx;
    s.chains = list.map((f) => {
      const out = new GainNode(ctx, { gain: f.gain ?? 1 });
      const nodes = [out];
      let input = out;
      const band = MUSIC_BANDS[f.band];
      if (band) {
        input = new BiquadFilterNode(ctx, { type: band[0], frequency: band[1], Q: Math.SQRT1_2 });
        input.connect(out);
        nodes.push(input);
      }
      if (f.ch === 'mono') {
        // Los dos canales juntos (a la mitad cada uno): lo hace el navegador al bajar a 1 canal
        Object.assign(input, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
        s.src.connect(input);
      } else s.split.connect(input, f.ch === 'R' ? 1 : 0);
      const panner = new PannerNode(ctx, {
        panningModel: f.model ?? 'HRTF', distanceModel: 'inverse', refDistance: f.ref ?? 5, rolloffFactor: f.rolloff ?? 0.6, maxDistance: 80,
        positionX: f.pos.x, positionY: f.pos.y, positionZ: f.pos.z,
      });
      out.connect(panner).connect(s.gain);
      nodes.push(panner);
      return { nodes, panner };
    });
    s.panners = s.chains.map((c) => c.panner);
    s.layout = list;
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
    s.chains?.forEach((c) => c.nodes.forEach((n) => n.disconnect()));
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
        // Música: cada fuente en su equipo (si cambió la sala, se rearman)
        const list = this.musicSources(positionOf(key));
        if (!list) continue;
        if (s.layout !== list) this.buildMusic(s, list);
        s.chains.forEach(({ panner: pn }, i) => { const q = list[i].pos; pn.positionX.setTargetAtTime(q.x, t, 0.05); pn.positionY.setTargetAtTime(q.y, t, 0.05); pn.positionZ.setTargetAtTime(q.z, t, 0.05); });
        continue;
      }
      if (!s.panner) continue;
      // Mi grupo suena como una llamada: sin distancia ni dirección
      const pos = this.flat.has(key) ? p : positionOf(key);
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
    if (on && !this.voiceEnabled) return { ok: false, error: 'El chat de voz está desactivado en Menú → Audio.' };
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
      this.publish('voice', this.mic.getAudioTracks()[0], this.mic);
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
      this.mic = null;
      this.unpublish('voice');
      this.net.send({ t: 'mic', v: 'off' });
      this.onMic('off');
    }
    this.applyVolumes();
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
    return { ok: true, streamId: 'dj' };
  }

  // La sala confirmó que la cabina es mía: empiezo a mandar la música
  startMusic() {
    const stream = this.pendingMusic;
    if (!stream) return;
    this.pendingMusic = null;
    this.djStream = stream;
    stream.getAudioTracks()[0]?.addEventListener('ended', () => this.onMusicEnded?.());
    this.publish('dj', stream.getAudioTracks()[0], stream);
    // Me analizo a mí mismo para las luces (sin sonar: ya lo escucho en mi PC)
    const src = this.ctx.createMediaStreamSource(stream);
    this.sounds.set('me:dj', { el: null, src, ...this.beatAnalyser(src) });
  }

  stopMusic() {
    for (const stream of [this.djStream, this.pendingMusic]) if (stream) for (const t of stream.getTracks()) t.stop();
    if (this.djStream) this.unpublish('dj');
    this.djStream = this.pendingMusic = null;
    const me = this.sounds.get('me:dj');
    if (me) { me.src.disconnect(); this.sounds.delete('me:dj'); }
  }

  // Mensaje de la sala sobre quién pasa música
  setDJ(info) {
    if (this.dj && (!info || info.id !== this.dj.id)) this.unsubscribe(`${this.dj.id}:dj`);
    this.dj = info;
    if (info && info.id !== this.net.id) this.subscribe(info.id, 'dj');
  }

  // ---------- Pantalla del escenario (VJ): solo video ----------

  // slot: 'stage' (la pantalla de siempre) o 'stage2' (la segunda pantalla de una sala personal)
  async captureStage(slot = 'stage') {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      this[slot === 'stage' ? 'pendingStage' : 'pendingStage2'] = stream;
      return { ok: true, streamId: slot };
    } catch {
      return { ok: false, error: 'Se canceló o el navegador no permite compartir pantalla.' };
    }
  }

  // La sala confirmó que la pantalla es mía
  startStage(slot = 'stage') {
    const [pending, live, show] = slot === 'stage' ? ['pendingStage', 'stageStream', this.onStage] : ['pendingStage2', 'stage2Stream', this.onStage2];
    const stream = this[pending];
    if (!stream) return;
    this[pending] = null;
    this[live] = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => (slot === 'stage' ? this.onStageEnded : this.onStage2Ended)?.());
    this.publish(slot, stream.getVideoTracks()[0], stream);
    show?.(videoOf(stream));
  }

  stopStage(slot = 'stage') {
    const [pending, live] = slot === 'stage' ? ['pendingStage', 'stageStream'] : ['pendingStage2', 'stage2Stream'];
    for (const stream of [this[live], this[pending]]) if (stream) for (const t of stream.getTracks()) t.stop();
    if (this[live]) this.unpublish(slot);
    this[live] = this[pending] = null;
  }

  setStage(info, slot = 'stage') {
    const show = slot === 'stage' ? this.onStage : this.onStage2;
    const cur = this[slot];
    if (cur && (!info || info.id !== cur.id)) {
      this.unsubscribe(`${cur.id}:${slot}`);
      show?.(null);
    }
    this[slot] = info;
    if (info && info.id !== this.net.id) this.subscribe(info.id, slot);
  }

  setScreen(info) { this.screen = info; }
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
