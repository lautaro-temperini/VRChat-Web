import { DurableObject } from 'cloudflare:workers';
import { cleanName, cleanLook, cleanEquip, EMOTES, ITEM_REACH, CONSUMABLES, FURNITURE, BOOST_TIME, KISS_RANGE, PUBLIC_MAPS } from './shared.js';
import { roomTrack, roomEventTick } from './progress.js';
import { roomEditorMethods, ROOM_SPAWN } from './editor.js';

// Cada sala del juego es una instancia de Room (un Durable Object).
// - Reenvía posiciones, chat, AFK y estado del micrófono.
// - Hace de intermediaria con el servidor de audio de Cloudflare (Realtime SFU): la voz,
//   la música y el video pasan por Cloudflare, así nadie ve la IP de otro. Acá se decide
//   quién puede escuchar a quién (distancia, grupos privados, silenciados).
// - Grupos de voz (party): privados, hasta 4, los arma y maneja quien invita primero.
// - Coordina quién comparte pantalla, los intercambios y los objetos en el suelo.
// - Moderación: el dueño de la sala (salas "u-<id>") y los admins pueden
//   expulsar, banear, silenciar, mover jugadores y habilitar/deshabilitar funciones.
// - Avisa a las cuentas quién está en la sala (para la lista de amigos).

const CHAT_HISTORY = 50;
// Solo para conexiones muertas (se cortó internet sin avisar). Un jugador AFK
// con la pestaña abierta sigue mandando señales y nunca llega a este límite.
const DEAD_AFTER = 3 * 60_000;
const MIC_STATES = ['off', 'on'];
// Objetos en el suelo: otro jugador puede juntarlo a los 5 s; a los 60 s se pierde.
const PICKUP_LOCK = 5_000, GROUND_LIFE = 60_000;
// Antiflood del chat
const FLOOD_MAX = 5, FLOOD_WINDOW = 10_000, REPEAT_WINDOW = 30_000;
const DEFAULT_SETTINGS = { chat: true, voice: true, screen: true, items: true, dj: true, artists: true };
// Partes que toman los artistas en la consola (además de la pantalla del hall, que es this.screen)
const PARTS = ['luces', 'escenario', 'escenario2']; // escenario2: la segunda pantalla de una sala personal (editor)
const SPAWN = { x: -27.5, z: 0 }; // junto a la puerta de entrada (ver museum.js)
// Servidor de audio (Cloudflare Realtime SFU)
const SFU_API = 'https://rtc.live.cloudflare.com/v1/apps/';
// TURN de Cloudflare (para redes cerradas). Opcional: sin TURN_KEY_ID / TURN_KEY_API_TOKEN se usa solo STUN
const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys/';
const TURN_TTL = 6 * 3600;           // s que duran las credenciales que se reparten
const TURN_REUSE = 60 * 60_000;      // ms que la sala reutiliza las mismas (bien por debajo del TTL)
const KINDS = ['voice', 'dj', 'stage', 'stage2']; // pistas que se pueden publicar
// Voz: se escucha hasta 10 m (el cliente elige a los 4 más cercanos que hablan). Acá se
// deja un margen, porque las posiciones llegan con un poco de atraso.
const VOICE_RANGE = 20;
// Grupos de voz
const GROUP_MAX = 4, GROUP_INVITE_LIFE = 60_000;
const TRADE_INVITE_LIFE = 60_000; // la invitación a intercambiar vence al minuto
const GUEST_VOICE = 'Creá una cuenta (es gratis) para usar la voz y los grupos. Los invitados chatean solo por texto.';
const GUEST_STAGE = 'Creá una cuenta (es gratis) para pasar música o usar la consola de artistas.';
// Antiflood de todo lo que no es chat (ver allow): mensajes por conexión, con un margen amplio
// por encima de lo que manda el juego (posición 10/s, luces 15/s, voz unos pocos por segundo).
// Lo que pasa del límite se descarta en silencio. HEAVY: lo que escribe en la base o le pide algo a
// las cuentas; SFU: pedidos al servidor de audio (cada uno es una llamada a la API de Cloudflare).
const RATE = { all: [120, 40], heavy: [30, 5], sfu: [40, 10] }; // [ráfaga, por segundo]
const HEAVY = new Set(['look', 'emote', 'phone', 'afk', 'mic', 'group', 'trade', 'edit', 'drop', 'pickup', 'mod', 'dj', 'part']);
// Conexiones que nunca mandan "join" (o con un token que no sirve) se cierran a los 15 s
const JOIN_TIMEOUT = 15_000;
// Posiciones: más allá de esto no hay nada en ninguna sala (el Museo mide 48 × 22 m)
const WORLD_LIMIT = 500;
const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);

// Estado de un jugador: [x, y, z, rotación, velocidad, pose]
// pose: 0 parado, 1 agachado, 2 sentado, 3 trepando, 4 en el aire, 5 saltando una baranda
function cleanState(s) {
  if (!Array.isArray(s) || s.length !== 6) return null;
  if (!s.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const out = s.map((v) => Math.round(Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, v)) * 100) / 100);
  out[5] = Math.min(5, Math.max(0, Math.round(s[5])));
  return out;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.states = new Map();   // últimas posiciones (en memoria)
    this.chatTimes = new Map(); // antiflood: horarios de los últimos mensajes de cada uno
    this.lastText = new Map();  // antiflood: último mensaje de cada uno
    this.lastSeen = new Map(); // última señal de cada conexión
    this.screen = null;        // { id, streamId } de quien comparte pantalla
    this.dj = null;            // { id, name, streamId, track } de quien pasa música en la cabina
    this.parts = {};           // luces / escenario → { id, name, streamId? } del artista que la tiene
    this.lights = null;        // último estado de las luces que mandó el artista (para los que entran)
    this.invites = new Map();  // "de>para" -> hora de la invitación a intercambiar
    this.trades = new Map();   // id -> intercambio en curso
    this.tradeOf = new Map();  // jugador -> id del intercambio
    this.pulls = new Map();    // conexión -> Map("id:tipo" -> mid) de lo que está escuchando
    this.ginvites = new Map(); // "deUsuario>paraUsuario" -> hora de la invitación al grupo
    this.boosts = new Map();   // usuario -> hasta cuándo le dura el efecto de un consumible o un beso
    this.kisses = new Map();   // "deUsuario>paraUsuario" -> hora del pedido de beso
    this.rates = new Map();    // conexión -> baldes del antiflood (ver allow)
  }

  // Antiflood general: un "balde" por tipo que se vacía con cada mensaje y se llena solo con el tiempo
  allow(id, kind) {
    const now = Date.now();
    let r = this.rates.get(id);
    if (!r) { r = {}; this.rates.set(id, r); }
    const [burst, perSec] = RATE[kind];
    const b = r[kind] ?? (r[kind] = { n: burst, at: now });
    b.n = Math.min(burst, b.n + ((now - b.at) / 1000) * perSec);
    b.at = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }

  accounts() {
    return this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('global'));
  }

  async roomName() {
    if (!this.name) this.name = await this.ctx.storage.get('name');
    return this.name ?? 'museo';
  }

  // Ajustes, baneos, silenciados y objetos en el suelo se guardan (sobreviven si la sala se duerme)
  async load() {
    if (this.loaded) return;
    const s = await this.ctx.storage.get(['settings', 'bans', 'silenced', 'ground', 'groups']);
    this.groups = s.get('groups') ?? {}; // gid -> { leader: userId, members: [userIds en orden de entrada] }
    this.settings = { ...DEFAULT_SETTINGS, ...(s.get('settings') ?? {}) };
    this.bans = s.get('bans') ?? {};         // userId -> { name, at }
    this.silenced = s.get('silenced') ?? {}; // userId -> true
    this.ground = s.get('ground') ?? [];     // [{ iid, type, color, owner, ownerName, x, y, z, at }]
    this.loaded = true;
  }

  async ownerId() {
    const name = await this.roomName();
    return name.startsWith('u-') ? name.slice(2) : null;
  }

  async isMod(meta) {
    const admins = String(this.env.ADMIN_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return admins.includes(meta.userId) || (!meta.guest && meta.userId === (await this.ownerId()));
  }

  // ¿La sala tiene con qué? El Museo tiene cabina, consola y pantalla; en una sala personal tienen
  // que estar puestas como muebles (y la 2ª pantalla, con su propio VJ)
  async hasGear(what) {
    const layout = await this.layout();
    if (!layout) return true;
    const n = (type, pred = () => true) => layout.pieces.filter((p) => p.type === type && pred(p)).length;
    if (what === 'dj') return n('cabina') > 0;
    if (what === 'luces') return n('consola') > 0;
    if (what === 'escenario') return n('consola') > 0 || n('pantalla') > 0;
    if (what === 'escenario2') return n('pantalla') > 1 && n('pantalla', (p) => p.m === 'propia') > 0;
    return false;
  }

  async fetch(request) {
    const name = request.headers.get('X-Room');
    if (name && !this.name) { this.name = name; await this.ctx.storage.put('name', name); }
    const { 0: client, 1: server } = new WebSocketPair();
    // acceptWebSocket permite que la sala "hiberne" sin cortar las conexiones.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), joined: false, born: Date.now() });
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  publicInfo(m) {
    return {
      id: m.id, userId: m.userId, name: m.name, look: m.look, equip: m.equip ?? [],
      afk: !!m.afk, mic: m.mic ?? 'off', silenced: !!this.silenced?.[m.userId], mod: !!m.mod, phone: !!m.phone, guest: !!m.guest,
      voice: !!m.pubs?.voice,
      s: this.states.get(m.id) ?? null,
    };
  }

  joined() {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment()?.joined);
  }

  byId(id) {
    return this.joined().find((ws) => ws.deserializeAttachment().id === id) ?? null;
  }

  players(except) {
    return this.joined().filter((ws) => ws !== except).map((ws) => this.publicInfo(ws.deserializeAttachment()));
  }

  send(ws, msg) {
    try { ws?.send(JSON.stringify(msg)); } catch { /* conexión cerrándose */ }
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.joined()) {
      if (ws === except) continue;
      try { ws.send(data); } catch { /* conexión cerrándose */ }
    }
  }

  notice(ws, text) { this.send(ws, { t: 'notice', text }); }

  // Próxima alarma: presencia cada 30 s mientras haya gente, o el próximo objeto que vence
  async scheduleAlarm() {
    const now = Date.now();
    let next = this.joined().length ? now + 30_000 : Infinity;
    for (const g of this.ground ?? []) next = Math.min(next, g.at + GROUND_LIFE);
    for (const ws of this.ctx.getWebSockets()) {
      const m = ws.deserializeAttachment();
      if (m && !m.joined && !m.left) next = Math.min(next, (m.born ?? now) + JOIN_TIMEOUT);
    }
    if (next === Infinity) return;
    const current = await this.ctx.storage.getAlarm();
    if (!current || current > next || current < now) await this.ctx.storage.setAlarm(Math.max(next, now + 200));
  }

  async alarm() {
    await this.load();
    const now = Date.now();
    // Objetos que vencieron sin que nadie los junte: se pierden
    const expired = this.ground.filter((g) => now - g.at >= GROUND_LIFE);
    if (expired.length) {
      this.ground = this.ground.filter((g) => now - g.at < GROUND_LIFE);
      await this.ctx.storage.put('ground', this.ground);
      for (const g of expired) {
        await this.accounts().destroyGroundItem(g.iid);
        this.broadcast({ t: 'ground-', iid: g.iid, expired: true });
      }
    }
    // Conexiones que nunca entraron: se cierran (no ocupan lugar para siempre)
    for (const ws of this.ctx.getWebSockets()) {
      const m = ws.deserializeAttachment();
      if (m && !m.joined && !m.left && now - (m.born ?? 0) >= JOIN_TIMEOUT) {
        m.left = true; // aunque tarde en cerrarse, ya no puede entrar
        try { ws.serializeAttachment(m); ws.close(4001, 'sin entrar'); } catch { /* ya cerrada */ }
      }
    }
    const alive = [];
    for (const ws of this.joined()) {
      const m = ws.deserializeAttachment();
      if (!this.lastSeen.has(m.id)) this.lastSeen.set(m.id, now); // la sala recién despertó
      if (now - this.lastSeen.get(m.id) > DEAD_AFTER) {
        await this.leave(ws);
        try { ws.close(4000, 'sin conexión'); } catch { /* ya cerrada */ }
      } else alive.push(m.userId);
    }
    if (alive.length) await this.accounts().presence(await this.roomName(), [...new Set(alive)]);
    await roomEventTick(this); // progresión: asistir a eventos
    await this.scheduleAlarm();
  }

  async webSocketMessage(ws, raw) {
    // Las descripciones de sesión del servidor de audio (SDP) son más largas que el resto
    if (typeof raw !== 'string' || raw.length > 64_000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t !== 'sfu' && raw.length > 4096) return;
    const meta = ws.deserializeAttachment();
    if (!meta || meta.left) return;
    // Antiflood de todo (el chat además tiene el suyo, con aviso)
    if (!this.allow(meta.id, 'all')) return;
    if ((HEAVY.has(msg.t) || msg.t === 'join') && !this.allow(meta.id, 'heavy')) return;
    if (msg.t === 'sfu' && !this.allow(meta.id, 'sfu')) return;
    await this.load();
    this.lastSeen.set(meta.id, Date.now());

    if (msg.t === 'join' && !meta.joined) {
      if (meta.joining) return; // ya está entrando (dos "join" seguidos)
      meta.joining = true;
      ws.serializeAttachment(meta);
      const user = await this.accounts().auth(msg.token);
      meta.joining = false;
      ws.serializeAttachment(meta);
      if (!user) {
        this.send(ws, { t: 'error', code: 'auth' });
        ws.close(4001, 'sin sesión');
        return;
      }
      if (this.bans[user.id]) {
        this.send(ws, { t: 'error', code: 'banned' });
        ws.close(4003, 'baneado');
        return;
      }
      // Sala personal: el dueño elige quién entra (todos, amigos o nadie más). Los admins siempre.
      const owner = await this.ownerId();
      if (owner && !(await this.isMod({ userId: user.id, guest: !!user.guest })) && !(await this.accounts().canEnter(owner, user.id))) {
        this.send(ws, { t: 'error', code: 'private' });
        ws.close(4004, 'sala privada');
        return;
      }
      if (ws.deserializeAttachment()?.left) return; // se fue mientras entraba
      Object.assign(meta, { joined: true, userId: user.id, name: user.name, look: user.look, equip: user.equip, guest: !!user.guest, afk: !!msg.afk, mic: 'off' });
      meta.mod = await this.isMod(meta);
      ws.serializeAttachment(meta);
      const s = cleanState(msg.s);
      if (s) this.states.set(meta.id, s);
      // Grupos viejos: si se cortó la conexión sin avisar (pestaña cerrada, deploy), el grupo quedaba
      // guardado y al volver figuraba "En grupo". Se disuelven los que no tienen a nadie conectado.
      const present = new Set(this.joined().filter((w) => w !== ws).map((w) => w.deserializeAttachment().userId));
      const stale = Object.keys(this.groups).filter((gid) => !this.groups[gid].members.some((u) => present.has(u)));
      if (stale.length) { for (const gid of stale) delete this.groups[gid]; await this.saveGroups(); }
      const chat = (await this.ctx.storage.get('chat')) ?? [];
      this.send(ws, {
        t: 'welcome', id: meta.id, players: this.players(ws), chat, screen: this.screen, dj: this.dj, parts: this.parts, lights: this.lights, groups: this.groups,
        room: { name: await this.roomName(), owner: await this.ownerId(), settings: this.settings, mod: meta.mod, silenced: !!this.silenced[user.id] },
        ground: this.ground.map((g) => ({ ...g, age: Date.now() - g.at })),
        layout: await this.layout(),
      });
      this.broadcast({ t: 'join', ...this.publicInfo(meta) }, ws);
      // Una sola conexión por cuenta: la nueva manda y la anterior (acá o en otra sala) se desconecta
      const prev = await this.accounts().claimConn(user.id, await this.roomName(), meta.id);
      if (prev) {
        if (prev.room === (await this.roomName())) await this.takeover(prev.conn);
        else await this.env.ROOMS.get(this.env.ROOMS.idFromName(prev.room)).takeover(prev.conn).catch(() => {});
      }
      await this.accounts().presence(await this.roomName(), [user.id]);
      await roomTrack(this, ws, user.id, 'sala'); // progresión: visitar salas de otros
      await this.scheduleAlarm();
      return;
    }
    if (!meta.joined) return;
    const silenced = !!this.silenced[meta.userId];

    switch (msg.t) {
      case 'ping':
        break;
      case 's': {
        const s = cleanState(msg.s);
        if (!s) return;
        this.states.set(meta.id, s);
        this.broadcast({ t: 's', id: meta.id, s }, ws);
        break;
      }
      case 'phone': {
        // Sacó o guardó el celular (red social): los demás ven al personaje con el teléfono
        meta.phone = !!msg.v;
        ws.serializeAttachment(meta);
        this.broadcast({ t: 'phone', id: meta.id, v: meta.phone }, ws);
        break;
      }
      case 'afk': {
        meta.afk = !!msg.v;
        ws.serializeAttachment(meta);
        this.broadcast({ t: 'afk', id: meta.id, v: meta.afk }, ws);
        break;
      }
      case 'emote': {
        if (!has(EMOTES, msg.e)) return;
        this.broadcast({ t: 'emote', id: meta.id, e: msg.e }, ws);
        await roomTrack(this, ws, meta.userId, 'gesto');
        break;
      }
      case 'mic': {
        if (!MIC_STATES.includes(msg.v)) return;
        // Los invitados (sin cuenta) chatean por texto, pero no hablan por voz
        if (msg.v === 'on' && meta.guest) {
          this.send(ws, { t: 'mic-denied' });
          return this.notice(ws, GUEST_VOICE);
        }
        if (msg.v === 'on' && (silenced || (!this.settings.voice && !meta.mod))) {
          this.send(ws, { t: 'mic-denied' });
          this.notice(ws, silenced ? 'Estás silenciado en esta sala.' : 'El chat de voz está deshabilitado en esta sala.');
          return;
        }
        meta.mic = msg.v;
        ws.serializeAttachment(meta);
        this.broadcast({ t: 'mic', id: meta.id, v: meta.mic }, ws);
        break;
      }
      case 'look':
        await this.reloadLook(ws);
        break;
      case 'chat': {
        if (silenced) return this.notice(ws, 'Estás silenciado en esta sala.');
        if (!this.settings.chat && !meta.mod) return this.notice(ws, 'El chat está deshabilitado en esta sala.');
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 300);
        if (!text) return;
        // Antiflood: hasta 5 mensajes cada 10 s y no repetir el mismo mensaje en 30 s
        const now = Date.now();
        const recent = (this.chatTimes.get(meta.id) ?? []).filter((t) => now - t < FLOOD_WINDOW);
        const last = this.lastText.get(meta.id);
        if (recent.length >= FLOOD_MAX) return this.notice(ws, 'Estás mandando mensajes muy rápido. Esperá unos segundos.');
        if (last && last.text === text.toLowerCase() && now - last.at < REPEAT_WINDOW) return this.notice(ws, 'Ya mandaste ese mensaje.');
        this.chatTimes.set(meta.id, [...recent, now]);
        this.lastText.set(meta.id, { text: text.toLowerCase(), at: now });
        const entry = { id: meta.id, userId: meta.userId, name: meta.name, text, ts: Date.now() };
        const chat = (await this.ctx.storage.get('chat')) ?? [];
        chat.push(entry);
        await this.ctx.storage.put('chat', chat.slice(-CHAT_HISTORY));
        this.broadcast({ t: 'chat', ...entry });
        break;
      }
      case 'sfu':
        await this.sfuMessage(ws, meta, msg);
        break;
      case 'group':
        await this.groupMessage(ws, meta, msg);
        break;
      case 'consume':
        await this.consumeMessage(ws, meta, msg);
        break;
      case 'kiss':
        await this.kissMessage(ws, meta, msg);
        break;
      case 'dj': {
        // Cabina del DJ: una persona a la vez (sin cola); cualquiera puede, salvo que la sala lo deshabilite
        if (msg.on) {
          // Los invitados no pasan música (decisión del usuario, 24/10)
          if (meta.guest) { this.send(ws, { t: 'dj', denied: true }); return this.notice(ws, GUEST_STAGE); }
          if (silenced || (!this.settings.dj && !meta.mod)) {
            this.send(ws, { t: 'dj', denied: true });
            return this.notice(ws, silenced ? 'Estás silenciado en esta sala.' : 'Pasar música está deshabilitado en esta sala.');
          }
          if (!(await this.hasGear('dj'))) return this.send(ws, { t: 'dj', denied: true });
          if (this.dj && this.dj.id !== meta.id && this.byId(this.dj.id)) {
            this.send(ws, { t: 'dj', busy: true, name: this.dj.name });
            return;
          }
          this.dj = { id: meta.id, name: meta.name, streamId: str(msg.streamId, 100), track: '' };
          this.broadcast({ t: 'dj', on: true, ...this.dj });
        } else if (typeof msg.track === 'string' && this.dj?.id === meta.id) {
          const track = msg.track.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120);
          if (track === this.dj.track) return;
          this.dj.track = track;
          this.broadcast({ t: 'dj', track, id: meta.id, name: meta.name });
        } else if (this.dj?.id === meta.id) {
          this.stopDJ();
        }
        break;
      }
      case 'part': {
        // Consola de artistas: luces (OSC) y pantalla del escenario. Cada parte, un artista a la vez
        const part = msg.part;
        if (!PARTS.includes(part)) return;
        const cur = this.parts[part];
        if (msg.on) {
          // Ni toman las luces o las pantallas
          if (meta.guest) { this.send(ws, { t: 'part', part, denied: true }); return this.notice(ws, GUEST_STAGE); }
          if (silenced || (!this.settings.artists && !meta.mod)) {
            this.send(ws, { t: 'part', part, denied: true });
            return this.notice(ws, silenced ? 'Estás silenciado en esta sala.' : 'La consola de artistas está deshabilitada en esta sala.');
          }
          if (!(await this.hasGear(part))) return this.send(ws, { t: 'part', part, denied: true });
          if (cur && cur.id !== meta.id && this.byId(cur.id)) return this.send(ws, { t: 'part', part, busy: true, name: cur.name });
          this.parts[part] = { id: meta.id, name: meta.name, ...(part !== 'luces' ? { streamId: str(msg.streamId, 100) } : {}) };
          this.broadcast({ t: 'part', part, on: true, ...this.parts[part] });
        } else if (cur?.id === meta.id) this.releasePart(part);
        break;
      }
      case 'luces': {
        // Estado de las luces que manda el artista (ya validado y acotado)
        if (this.parts.luces?.id !== meta.id) return;
        const s = cleanLights(msg.s);
        if (!s) return;
        this.lights = s;
        this.broadcast({ t: 'luces', s }, ws);
        break;
      }
      case 'edit':
        await this.editMessage(ws, meta, msg);
        break;
      case 'drop':
        await this.drop(ws, meta, msg);
        break;
      case 'pickup':
        await this.pickup(ws, meta, msg);
        break;
      case 'mod':
        await this.moderate(ws, meta, msg);
        break;
      case 'trade':
        await this.tradeMessage(ws, meta, msg);
        break;
    }
  }

  // La misma cuenta entró desde otra pestaña (o dispositivo): esta conexión se desconecta.
  // La llama la sala donde entró (puede ser esta misma u otra).
  async takeover(conn) {
    const ws = this.ctx.getWebSockets().find((w) => w.deserializeAttachment()?.id === conn);
    if (!ws) return;
    this.send(ws, { t: 'elsewhere' });
    await this.leave(ws, { keepConn: true });
    try { ws.close(4005, 'otra pestaña'); } catch { /* ya cerrada */ }
  }

  // El perfil y los objetos se leen de la cuenta (no se confía en lo que manda el cliente)
  async reloadLook(ws) {
    const meta = ws.deserializeAttachment();
    const pub = meta?.joined && await this.accounts().publicLook(meta.userId);
    const now = ws.deserializeAttachment(); // pudo cambiar mientras se leía la cuenta
    if (!pub || !now?.joined) return;
    now.name = cleanName(pub.name);
    now.look = cleanLook(pub.look);
    now.equip = cleanEquip(pub.equip);
    ws.serializeAttachment(now);
    this.broadcast({ t: 'look', id: now.id, name: now.name, look: now.look, equip: now.equip }, ws);
  }

  // ---------- Objetos en el suelo ----------

  // ¿Está al alcance? Se mide desde la última posición que mandó el jugador, con margen por el retraso
  inReach(meta, [x, y, z]) {
    const s = this.states.get(meta.id);
    if (!s) return false;
    return Math.hypot(x - s[0], z - s[2]) <= ITEM_REACH + 1 && Math.abs(y - s[1]) <= 3;
  }

  async drop(ws, meta, msg) {
    if (!this.settings.items && !meta.mod) return this.notice(ws, 'Soltar objetos está deshabilitado en esta sala.');
    const pos = [msg.x, msg.y, msg.z].map(Number);
    if (!pos.every(Number.isFinite)) return;
    if (!this.inReach(meta, pos)) return this.notice(ws, 'Está muy lejos: soltalo más cerca tuyo.');
    const r = await this.accounts().dropItem(meta.userId, msg.iid);
    if (!r.ok) return this.notice(ws, r.error);
    const g = { ...r.item, owner: meta.userId, ownerName: meta.name, x: pos[0], y: pos[1], z: pos[2], at: Date.now() };
    this.ground.push(g);
    await this.ctx.storage.put('ground', this.ground);
    this.broadcast({ t: 'ground+', ...g, age: 0 });
    this.send(ws, { t: 'dropped', iid: g.iid, equip: r.equip });
    // Lo que tenía puesto puede haber cambiado
    meta.equip = cleanEquip(r.equip);
    ws.serializeAttachment(meta);
    this.broadcast({ t: 'look', id: meta.id, name: meta.name, look: meta.look, equip: meta.equip }, ws);
    await this.scheduleAlarm();
  }

  async pickup(ws, meta, msg) {
    const g = this.ground.find((x) => x.iid === msg.iid);
    if (!g) return this.notice(ws, 'Ese objeto ya no está.');
    if (!this.inReach(meta, [g.x, g.y, g.z])) return this.notice(ws, 'Está muy lejos: acercate para juntarlo.');
    const age = Date.now() - g.at;
    if (g.owner !== meta.userId && age < PICKUP_LOCK) {
      return this.notice(ws, `Todavía no: podés juntarlo en ${Math.ceil((PICKUP_LOCK - age) / 1000)} s.`);
    }
    const r = await this.accounts().pickupItem(meta.userId, g.iid);
    if (!r.ok && !r.gone) return this.notice(ws, r.error); // no se pudo guardar: queda en el piso
    this.ground = this.ground.filter((x) => x.iid !== g.iid);
    await this.ctx.storage.put('ground', this.ground);
    this.broadcast({ t: 'ground-', iid: g.iid, by: r.ok ? meta.name : null });
    if (r.ok) this.send(ws, { t: 'picked', iid: g.iid, type: g.type });
  }

  // ---------- Moderación ----------

  async moderate(ws, meta, msg) {
    if (!meta.mod) return this.notice(ws, 'No tenés permisos de moderación en esta sala.');
    const target = typeof msg.target === 'string' ? this.byId(msg.target) : null;
    const tm = target?.deserializeAttachment();
    // Estas acciones son sobre alguien que está en la sala
    if (['kick', 'ban', 'silence', 'bring', 'spawn'].includes(msg.op) && !target) return this.notice(ws, 'Ese jugador ya no está.');
    if (target && tm.mod && msg.op !== 'bring') return this.notice(ws, 'No se puede moderar a otro moderador.');

    switch (msg.op) {
      case 'kick':
      case 'ban': {
        if (msg.op === 'ban') {
          this.bans[tm.userId] = { name: tm.name, at: Date.now() };
          await this.ctx.storage.put('bans', this.bans);
        }
        this.send(target, { t: 'kicked', ban: msg.op === 'ban', by: meta.name });
        await this.leave(target);
        try { target.close(msg.op === 'ban' ? 4003 : 4002, msg.op); } catch { /* ya cerrada */ }
        this.broadcast({ t: 'notice', text: `${tm.name} fue ${msg.op === 'ban' ? 'baneado' : 'expulsado'} de la sala.` });
        break;
      }
      case 'unban': {
        if (!has(this.bans, msg.userId)) return;
        delete this.bans[msg.userId];
        await this.ctx.storage.put('bans', this.bans);
        this.send(ws, { t: 'bans', bans: this.bans });
        break;
      }
      case 'bans':
        this.send(ws, { t: 'bans', bans: this.bans });
        break;
      case 'silence': {
        const on = !!msg.v;
        if (on) this.silenced[tm.userId] = true; else delete this.silenced[tm.userId];
        await this.ctx.storage.put('silenced', this.silenced);
        if (on && tm.mic === 'on') { tm.mic = 'off'; target.serializeAttachment(tm); this.broadcast({ t: 'mic', id: tm.id, v: 'off' }); }
        if (on && this.screen?.id === tm.id) { this.screen = null; this.broadcast({ t: 'screen', on: false, id: tm.id }); }
        if (on && this.dj?.id === tm.id) this.stopDJ();
        if (on) for (const part of PARTS) if (this.parts[part]?.id === tm.id) this.releasePart(part);
        this.broadcast({ t: 'silenced', id: tm.id, v: on });
        if (on) await this.enforce(); // nadie sigue escuchando su voz
        break;
      }
      case 'bring': {
        // Traer al jugador al lado del moderador
        const s = this.states.get(meta.id);
        if (!s) return;
        this.send(target, { t: 'teleport', x: s[0] + 1, y: s[1], z: s[2] + 0.5, by: meta.name });
        break;
      }
      case 'spawn': {
        // Las salas personales y los mapas públicos tienen su propia entrada
        const sp = (await this.ownerId()) ? ROOM_SPAWN : PUBLIC_MAPS[await this.roomName()]?.spawn ?? SPAWN;
        this.send(target, { t: 'teleport', x: sp.x, y: 0, z: sp.z, by: meta.name });
        break;
      }
      case 'setting': {
        if (!has(DEFAULT_SETTINGS, msg.key)) return;
        this.settings[msg.key] = !!msg.value;
        await this.ctx.storage.put('settings', this.settings);
        if (msg.key === 'screen' && !msg.value && this.screen && !this.byId(this.screen.id)?.deserializeAttachment().mod) {
          const id = this.screen.id;
          this.screen = null;
          this.broadcast({ t: 'screen', on: false, id });
        }
        if (msg.key === 'dj' && !msg.value && this.dj && !this.byId(this.dj.id)?.deserializeAttachment().mod) this.stopDJ();
        if (msg.key === 'artists' && !msg.value) {
          for (const part of PARTS) if (this.parts[part] && !this.byId(this.parts[part].id)?.deserializeAttachment().mod) this.releasePart(part);
        }
        this.broadcast({ t: 'settings', settings: this.settings, by: meta.name });
        if (msg.key === 'voice' && !msg.value) await this.enforce();
        break;
      }
    }
  }

  // ---------- Servidor de audio (Cloudflare Realtime SFU) ----------
  // El cliente nunca habla directo con la API (la clave es secreta): manda el pedido acá,
  // la sala lo valida y lo pasa. Las pistas se llaman "<id de conexión>-<tipo>".

  async sfuApi(path, method, body) {
    if (!this.env.REALTIME_APP_TOKEN || !this.env.REALTIME_APP_ID) return { error: 'Falta configurar el servidor de audio.' };
    try {
      const r = await fetch(`${SFU_API}${this.env.REALTIME_APP_ID}/${path}`, {
        method, headers: { Authorization: `Bearer ${this.env.REALTIME_APP_TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.errorCode) return { error: j.errorDescription || `Error ${r.status}` };
      return j;
    } catch {
      return { error: 'No se pudo conectar con el servidor de audio.' };
    }
  }

  // Credenciales TURN temporales para los navegadores. La clave de la API nunca sale del servidor.
  // Se filtran las direcciones del puerto 53: los navegadores lo bloquean y solo hacen perder tiempo.
  async turnServers() {
    const { TURN_KEY_ID: id, TURN_KEY_API_TOKEN: token } = this.env;
    if (!id || !token) return null;
    if (this.turn && this.turn.until > Date.now()) return this.turn.servers;
    try {
      const r = await fetch(`${TURN_API}${id}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      const servers = [].concat(j.iceServers ?? [])
        .map((s) => ({ ...s, urls: [].concat(s.urls ?? []).filter((u) => !/:53(\?|$)/.test(u)) }))
        .filter((s) => s.urls.length);
      if (!servers.length) return null;
      this.turn = { servers, until: Date.now() + TURN_REUSE };
      return servers;
    } catch {
      return null;
    }
  }

  async sfuSession(ws, meta) {
    if (meta.sfu) return meta.sfu;
    const r = await this.sfuApi('sessions/new', 'POST');
    if (r.error) return null;
    meta.sfu = r.sessionId;
    ws.serializeAttachment(meta);
    return meta.sfu;
  }

  groupOf(userId) {
    for (const [gid, g] of Object.entries(this.groups)) if (g.members.includes(userId)) return gid;
    return null;
  }

  // ¿Puede "viewer" escuchar/ver la pista "kind" de "tm"? Devuelve null si sí, o el motivo
  pullBlocked(viewer, tm, kind) {
    if (!tm?.joined || !tm.sfu) return 'not-yet';
    if (kind === 'dj') return this.dj?.id === tm.id ? (tm.pubs?.dj ? null : 'not-yet') : 'denied';
    if (kind === 'stage') return this.parts.escenario?.id === tm.id ? (tm.pubs?.stage ? null : 'not-yet') : 'denied';
    if (kind === 'stage2') return this.parts.escenario2?.id === tm.id ? (tm.pubs?.stage2 ? null : 'not-yet') : 'denied';
    if (kind !== 'voice') return 'denied';
    if (!tm.pubs?.voice) return 'not-yet';
    if (this.silenced[tm.userId] || (!this.settings.voice && !tm.mod)) return 'denied';
    // Grupo privado: solo se escuchan entre ellos (desde cualquier lugar de la sala)
    const ga = this.groupOf(viewer.userId), gb = this.groupOf(tm.userId);
    if (ga || gb) return ga === gb ? null : 'denied';
    const a = this.states.get(viewer.id), b = this.states.get(tm.id);
    if (!a || !b) return 'denied';
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= VOICE_RANGE ? null : 'denied';
  }

  async sfuMessage(ws, meta, msg) {
    const reply = (data) => this.send(ws, { t: 'sfu', rid: msg.rid, ...data });
    // Servidores STUN/TURN para conectarse (sin TURN configurado, el cliente usa solo STUN)
    if (msg.op === 'ice') {
      const iceServers = await this.turnServers();
      return reply(iceServers ? { ok: true, iceServers } : { ok: false });
    }
    const sid = await this.sfuSession(ws, meta);
    if (!sid) return reply({ ok: false, error: 'No se pudo conectar con el servidor de audio.' });
    const base = `sessions/${sid}`;
    const sdp = typeof msg.sdp === 'string' ? msg.sdp.slice(0, 60_000) : null;

    if (msg.op === 'push') {
      // Publicar mis pistas: voz siempre; música y video solo si la cabina / la pantalla son mías
      const tracks = (Array.isArray(msg.tracks) ? msg.tracks : []).slice(0, 3)
        .filter((t, i, all) => KINDS.includes(t?.kind) && typeof t.mid === 'string' && /^[\w-]{1,16}$/.test(t.mid) && all.findIndex((o) => o?.kind === t.kind) === i);
      const allowed = (k) => (k === 'voice' && !meta.guest) || (k === 'dj' && this.dj?.id === meta.id) || (k === 'stage' && this.parts.escenario?.id === meta.id) || (k === 'stage2' && this.parts.escenario2?.id === meta.id);
      if (!sdp || !tracks.length || !tracks.every((t) => allowed(t.kind))) return reply({ ok: false, error: 'denied' });
      const r = await this.sfuApi(`${base}/tracks/new`, 'POST', {
        sessionDescription: { type: 'offer', sdp },
        tracks: tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: `${meta.id}-${t.kind}` })),
      });
      if (r.error) return reply({ ok: false, error: r.error });
      meta.pubs = { ...(meta.pubs ?? {}) };
      for (const t of tracks) meta.pubs[t.kind] = t.mid;
      ws.serializeAttachment(meta);
      reply({ ok: true, sdp: r.sessionDescription?.sdp });
      if (tracks.some((t) => t.kind === 'voice')) this.broadcast({ t: 'pub', id: meta.id, kind: 'voice' }, ws);
      return;
    }

    if (msg.op === 'unpush') {
      const kinds = (Array.isArray(msg.kinds) ? msg.kinds : []).filter((k, i, all) => KINDS.includes(k) && meta.pubs?.[k] && all.indexOf(k) === i);
      if (!kinds.length) return reply({ ok: true });
      await this.sfuApi(`${base}/tracks/close`, 'PUT', { tracks: kinds.map((k) => ({ mid: meta.pubs[k] })), force: true });
      for (const k of kinds) delete meta.pubs[k];
      ws.serializeAttachment(meta);
      return reply({ ok: true });
    }

    if (msg.op === 'pull') {
      // Escuchar / ver pistas de otros: la sala decide si se puede
      const items = (Array.isArray(msg.items) ? msg.items : []).slice(0, 8);
      const out = [], want = [];
      for (const it of items) {
        const id = str(it?.id, 16), kind = str(it?.kind, 8);
        const target = this.byId(id);
        const tm = target?.deserializeAttachment();
        const why = id === meta.id ? 'denied' : this.pullBlocked(meta, tm, kind);
        if (why) out.push({ id, kind, error: why });
        else want.push({ it: { id, kind }, tm });
      }
      if (!want.length) return reply({ ok: true, tracks: out });
      const r = await this.sfuApi(`${base}/tracks/new`, 'POST', {
        tracks: want.map(({ it, tm }) => ({ location: 'remote', sessionId: tm.sfu, trackName: `${tm.id}-${it.kind}` })),
      });
      if (r.error) return reply({ ok: false, error: r.error, tracks: out });
      const mine = this.pulls.get(meta.id) ?? new Map();
      this.pulls.set(meta.id, mine);
      want.forEach(({ it, tm }, i) => {
        const t = r.tracks?.[i];
        if (!t || t.errorCode) return out.push({ id: it.id, kind: it.kind, error: 'not-yet' });
        mine.set(`${tm.id}:${it.kind}`, t.mid);
        out.push({ id: it.id, kind: it.kind, mid: t.mid });
      });
      return reply({ ok: true, tracks: out, sdp: r.requiresImmediateRenegotiation ? r.sessionDescription?.sdp : null });
    }

    if (msg.op === 'answer') {
      if (!sdp) return reply({ ok: false });
      const r = await this.sfuApi(`${base}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp } });
      return reply({ ok: !r.error, error: r.error });
    }

    if (msg.op === 'unpull') {
      const mine = this.pulls.get(meta.id);
      const mids = (Array.isArray(msg.mids) ? msg.mids : []).map(String).filter((mid) => mine && [...mine.values()].includes(mid)).slice(0, 16);
      if (mids.length) await this.sfuApi(`${base}/tracks/close`, 'PUT', { tracks: mids.map((mid) => ({ mid })), force: true });
      for (const [key, mid] of mine ?? []) if (mids.includes(mid)) mine.delete(key);
      return reply({ ok: true });
    }
    reply({ ok: false, error: 'denied' });
  }

  // Cortar las voces que alguien ya no puede escuchar (entró a un grupo, lo silenciaron…)
  async enforce() {
    for (const ws of this.joined()) {
      const meta = ws.deserializeAttachment();
      const mine = this.pulls.get(meta.id);
      if (!mine?.size || !meta.sfu) continue;
      const cut = [];
      for (const [key, mid] of mine) {
        const [id, kind] = key.split(':');
        if (kind !== 'voice') continue;
        if (this.pullBlocked(meta, this.byId(id)?.deserializeAttachment(), 'voice') === 'denied') cut.push([key, mid]);
      }
      if (!cut.length) continue;
      await this.sfuApi(`sessions/${meta.sfu}/tracks/close`, 'PUT', { tracks: cut.map(([, mid]) => ({ mid })), force: true });
      for (const [key] of cut) mine.delete(key);
      this.send(ws, { t: 'sfu-cut', mids: cut.map(([, mid]) => mid) });
    }
  }

  // ---------- Grupos de voz ----------
  // Privados: solo se escuchan entre ellos. Hasta 4. Quien lo arma es el líder: solo él invita
  // y puede sacar a alguien; si se va, el líder pasa al siguiente. Solo dentro de esta sala.
  // Anti-acoso (en la cuenta): si rechazás, esa persona no te puede reinvitar por un tiempo
  // que crece, y quien está ignorado o restringido no te puede invitar (no se entera).

  // Mensaje para alguien de esta sala que manda Accounts (p. ej. un mensaje privado de un amigo)
  async pushToUser(userId, data) {
    const ws = this.connOfUser(String(userId));
    if (ws) this.send(ws, data);
    return !!ws;
  }

  connOfUser(userId) {
    return this.joined().find((ws) => ws.deserializeAttachment().userId === userId) ?? null;
  }

  async saveGroups() {
    await this.ctx.storage.put('groups', this.groups);
    this.broadcast({ t: 'groups', groups: this.groups });
    await this.enforce();
  }

  // Sacar a alguien de su grupo (se fue, lo sacaron o se quedó solo)
  removeFromGroup(userId) {
    const gid = this.groupOf(userId);
    if (!gid) return null;
    const g = this.groups[gid];
    g.members = g.members.filter((u) => u !== userId);
    if (g.leader === userId) g.leader = g.members[0] ?? null;
    if (g.members.length < 2) delete this.groups[gid];
    return gid;
  }

  // ---------- Consumibles y beso ----------
  // Tomar algo: en la barra del hall (Museo), en un mueble que reparte (barra de tragos, minibar,
  // cafetera) o de la mochila. Durante BOOST_TIME la stamina no se gasta y no se puede tomar otro.
  // Todos ven al personaje con el vaso o la taza.

  near(meta, x, z, max) {
    const s = this.states.get(meta.id);
    return !!s && Math.hypot(s[0] - x, s[2] - z) <= max;
  }

  startBoost(ws, meta, kind) {
    this.boosts.set(meta.userId, Date.now() + BOOST_TIME);
    this.broadcast({ t: 'consume', id: meta.id, kind });
  }

  async consumeMessage(ws, meta, msg) {
    if ((this.boosts.get(meta.userId) ?? 0) > Date.now()) return this.notice(ws, 'Todavía te dura el efecto de lo que tomaste.');
    if (msg.from === 'bar') {
      // Barra del hall del Museo (sur del hall, de x -24 a -15)
      if ((await this.roomName()) !== 'museo' || !CONSUMABLES[msg.kind]) return;
      const s = this.states.get(meta.id);
      if (!s || s[0] < -26 || s[0] > -13 || Math.abs(s[2] - 9.7) > 3) return this.notice(ws, 'Acercate a la barra.');
      return this.startBoost(ws, meta, msg.kind);
    }
    if (msg.from === 'piece') {
      const layout = await this.layout();
      const piece = layout?.pieces.find((p) => p.id === msg.piece);
      const kind = piece && FURNITURE[piece.type]?.gives;
      if (!kind) return;
      if (!this.near(meta, piece.x, piece.z, 3.5)) return this.notice(ws, 'Acercate un poco más.');
      return this.startBoost(ws, meta, kind);
    }
    if (msg.from === 'item') {
      const r = await this.accounts().useConsumable(meta.userId, String(msg.iid ?? ''));
      if (!r.ok) return this.notice(ws, r.error);
      this.send(ws, { t: 'inventory-changed' });
      return this.startBoost(ws, meta, r.kind);
    }
  }

  // Beso: se pide con E (perfil) y el otro acepta o rechaza. Hay que estar cerca. Rechazar usa el
  // mismo bloqueo creciente que los grupos (sin avisar); ignorados y restringidos no pueden pedirlo.
  async kissMessage(ws, meta, msg) {
    const now = Date.now();
    for (const [k, at] of this.kisses) if (now - at > 60_000) this.kisses.delete(k);
    const closeTo = (a, b) => {
      const sa = this.states.get(a.id), sb = this.states.get(b.id);
      return !!sa && !!sb && Math.hypot(sa[0] - sb[0], sa[2] - sb[2]) <= KISS_RANGE + 0.6; // margen por el atraso
    };
    if (msg.op === 'ask') {
      const target = this.byId(String(msg.to ?? ''));
      const tm = target?.deserializeAttachment();
      if (!tm?.joined || tm.id === meta.id) return;
      if (!closeTo(meta, tm)) return this.notice(ws, 'Acercate más para dar un beso.');
      const key = `${meta.userId}>${tm.userId}`;
      const sent = () => this.send(ws, { t: 'kiss', op: 'sent', name: tm.name });
      if (this.kisses.has(key)) return sent();
      const check = await this.accounts().groupInviteCheck(meta.userId, tm.userId, 'kiss');
      if (check.ok) {
        this.kisses.set(key, now);
        this.send(target, { t: 'kiss', op: 'ask', from: meta.id, name: meta.name });
      }
      return sent();
    }
    if (msg.op === 'respond') {
      const from = this.byId(String(msg.from ?? ''));
      const fm = from?.deserializeAttachment();
      if (!fm?.joined) return;
      if (!this.kisses.delete(`${fm.userId}>${meta.userId}`)) return this.notice(ws, 'Ese pedido ya venció.');
      if (!msg.accept) {
        await this.accounts().groupRejected(fm.userId, meta.userId, 'kiss');
        return;
      }
      if (!closeTo(meta, fm)) return this.notice(ws, 'Se alejaron: acercate y que te lo pida de nuevo.');
      // Los dos se dan el beso y los dos reciben el efecto (aunque ya tuvieran uno, se renueva)
      this.boosts.set(meta.userId, now + BOOST_TIME);
      this.boosts.set(fm.userId, now + BOOST_TIME);
      this.broadcast({ t: 'kiss', op: 'do', a: fm.id, b: meta.id });
    }
  }

  async groupMessage(ws, meta, msg) {
    const now = Date.now();
    for (const [k, at] of this.ginvites) if (now - at > GROUP_INVITE_LIFE) this.ginvites.delete(k);

    if (msg.op === 'invite') {
      const target = this.byId(String(msg.to ?? ''));
      const tm = target?.deserializeAttachment();
      if (!tm?.joined || tm.id === meta.id) return;
      // Los invitados (sin cuenta) no arman ni entran a grupos de voz
      if (meta.guest) return this.notice(ws, GUEST_VOICE);
      if (tm.guest) return this.notice(ws, `${tm.name} entró como invitado: los invitados no usan la voz.`);
      const sent = () => this.send(ws, { t: 'group', op: 'sent', name: tm.name });
      const gid = this.groupOf(meta.userId);
      if (gid && this.groups[gid].leader !== meta.userId) return this.notice(ws, 'Solo quien armó el grupo puede invitar.');
      if (gid && this.groups[gid].members.length >= GROUP_MAX) return this.notice(ws, `El grupo está lleno (máximo ${GROUP_MAX}).`);
      if (this.groupOf(tm.userId)) return this.notice(ws, `${tm.name} ya está en un grupo.`);
      const key = `${meta.userId}>${tm.userId}`;
      if (this.ginvites.has(key)) return sent();
      // Si no puede invitarlo (rechazos recientes, ignorado o restringido) no se le avisa: parece enviada
      const check = await this.accounts().groupInviteCheck(meta.userId, tm.userId);
      if (check.ok) {
        this.ginvites.set(key, now);
        this.send(target, { t: 'group', op: 'invite', from: meta.id, name: meta.name });
      }
      return sent();
    }

    if (msg.op === 'respond') {
      const from = this.byId(String(msg.from ?? ''));
      const fm = from?.deserializeAttachment();
      if (!fm?.joined) return;
      const key = `${fm.userId}>${meta.userId}`;
      if (!this.ginvites.delete(key)) return this.notice(ws, 'Esa invitación ya venció.');
      if (!msg.accept) {
        // Rechazo: no se le avisa a quien invitó; la cuenta lleva la cuenta de rechazos
        await this.accounts().groupRejected(fm.userId, meta.userId);
        return;
      }
      if (this.groupOf(meta.userId)) return this.notice(ws, 'Ya estás en un grupo. Salí primero.');
      let gid = this.groupOf(fm.userId);
      if (gid && this.groups[gid].leader !== fm.userId) return this.notice(ws, 'Esa invitación ya no vale.');
      if (gid && this.groups[gid].members.length >= GROUP_MAX) return this.notice(ws, 'El grupo ya está lleno.');
      if (!gid) {
        gid = crypto.randomUUID().slice(0, 8);
        this.groups[gid] = { leader: fm.userId, members: [fm.userId] };
      }
      this.groups[gid].members.push(meta.userId);
      for (const w of this.joined()) {
        const m = w.deserializeAttachment();
        if (this.groups[gid].members.includes(m.userId)) this.send(w, { t: 'group', op: 'joined', name: meta.name, me: m.userId === meta.userId });
      }
      return this.saveGroups();
    }

    if (msg.op === 'leave') {
      const gid = this.removeFromGroup(meta.userId);
      if (!gid) return;
      this.send(ws, { t: 'group', op: 'left' });
      for (const u of this.groups[gid]?.members ?? []) this.send(this.connOfUser(u), { t: 'group', op: 'gone', name: meta.name });
      return this.saveGroups();
    }

    if (msg.op === 'kick') {
      const gid = this.groupOf(meta.userId);
      const userId = String(msg.userId ?? '');
      if (!gid || this.groups[gid].leader !== meta.userId || userId === meta.userId || !this.groups[gid].members.includes(userId)) return;
      this.removeFromGroup(userId);
      this.send(this.connOfUser(userId), { t: 'group', op: 'kicked' });
      return this.saveGroups();
    }
  }

  // ---------- Intercambios ----------
  // invite → accept → (offer / ready)* → cuando los dos están "listos", la cuenta
  // ejecuta el cambio de dueños de una sola vez (todo o nada).

  tradeState(trade) {
    for (const [me, other] of [trade.p, [...trade.p].reverse()]) {
      this.send(this.byId(me), {
        t: 'trade', op: 'state', id: trade.id,
        you: { items: trade.items[me], ready: !!trade.ready[me] },
        them: { items: trade.items[other], ready: !!trade.ready[other] },
      });
    }
  }

  endTrade(trade, msgFor) {
    this.trades.delete(trade.id);
    for (const p of trade.p) {
      this.tradeOf.delete(p);
      this.send(this.byId(p), { t: 'trade', id: trade.id, ...msgFor(p) });
    }
  }

  async tradeMessage(ws, meta, msg) {
    const me = meta.id;
    const tradeId = this.tradeOf.get(me);
    const trade = tradeId ? this.trades.get(tradeId) : null;
    const now = Date.now();
    for (const [k, at] of this.invites) if (now - at > TRADE_INVITE_LIFE) this.invites.delete(k);

    switch (msg.op) {
      case 'invite': {
        const other = typeof msg.to === 'string' ? this.byId(msg.to) : null;
        const om = other?.deserializeAttachment();
        if (meta.guest || om?.guest) {
          this.notice(ws, meta.guest ? 'Creá una cuenta para intercambiar objetos.' : 'Esa persona es invitada: todavía no puede intercambiar.');
          return;
        }
        // Con uno mismo (otra pestaña de la misma cuenta) no tiene sentido
        if (!other || msg.to === me || om.userId === meta.userId || trade || this.tradeOf.has(msg.to)) {
          this.send(ws, { t: 'trade', op: 'busy' });
          return;
        }
        // La misma invitación mientras sigue pendiente no se le vuelve a mostrar al otro
        const key = `${me}>${msg.to}`;
        if (this.invites.has(key)) return;
        this.invites.set(key, now);
        // Si el otro lo ignoró o restringió, la invitación no le llega (y quien invita no se entera)
        const check = await this.accounts().tradeInviteCheck(meta.userId, om.userId);
        if (check.ok) this.send(this.byId(msg.to), { t: 'trade', op: 'invite', from: me, name: meta.name, userId: meta.userId });
        break;
      }
      case 'accept': {
        const from = str(msg.from, 16);
        const key = `${from}>${me}`;
        const at = this.invites.get(key);
        this.invites.delete(key);
        const other = this.byId(from);
        if (!at || now - at > TRADE_INVITE_LIFE || !other || trade || this.tradeOf.has(from)) {
          this.send(ws, { t: 'trade', op: 'expired' });
          return;
        }
        const otherMeta = other.deserializeAttachment();
        const t = { id: crypto.randomUUID().slice(0, 8), p: [from, me], users: { [from]: otherMeta.userId, [me]: meta.userId }, items: { [from]: [], [me]: [] }, ready: {}, v: 0 };
        this.trades.set(t.id, t);
        this.tradeOf.set(from, t.id);
        this.tradeOf.set(me, t.id);
        this.send(other, { t: 'trade', op: 'open', id: t.id, with: me, name: meta.name });
        this.send(ws, { t: 'trade', op: 'open', id: t.id, with: from, name: otherMeta.name });
        this.tradeState(t);
        break;
      }
      case 'decline': {
        const from = str(msg.from, 16);
        if (!this.invites.delete(`${from}>${me}`)) return;
        this.send(this.byId(from), { t: 'trade', op: 'declined', name: meta.name });
        break;
      }
      case 'offer': {
        if (!trade || trade.busy) return;
        const v = ++trade.v;
        const items = await this.accounts().ownedItems(meta.userId, msg.iids);
        // Mientras se leían los objetos pudo cerrarse el intercambio o llegar otra oferta más nueva
        if (this.trades.get(trade.id) !== trade || trade.busy || trade.v !== v) return;
        trade.items[me] = items;
        trade.ready = {}; // si cambia la oferta, los dos tienen que volver a confirmar
        this.tradeState(trade);
        break;
      }
      case 'ready': {
        if (!trade || trade.busy) return;
        trade.ready[me] = !!msg.v;
        if (trade.p.every((p) => trade.ready[p])) {
          // Se ejecuta una sola vez: mientras la cuenta hace el cambio, el intercambio queda trabado
          trade.busy = true;
          const [a, b] = trade.p;
          const res = await this.accounts().trade(trade.users[a], trade.items[a].map((i) => i.iid), trade.users[b], trade.items[b].map((i) => i.iid));
          this.endTrade(trade, () => (res.ok ? { op: 'done' } : { op: 'failed', error: res.error }));
          // Los objetos equipados pudieron cambiar: actualizar cómo se ven los dos
          for (const p of trade.p) {
            const pws = this.byId(p);
            if (pws) await this.reloadLook(pws);
          }
        } else this.tradeState(trade);
        break;
      }
      case 'cancel': {
        if (trade && !trade.busy) this.endTrade(trade, (p) => ({ op: 'closed', byMe: p === me, name: meta.name }));
        break;
      }
    }
  }

  releasePart(part) {
    const { id, name } = this.parts[part];
    delete this.parts[part];
    if (part === 'luces') this.lights = null; // vuelven a automático
    this.broadcast({ t: 'part', part, on: false, id, name });
  }

  stopDJ() {
    const { id, name } = this.dj;
    this.dj = null;
    this.broadcast({ t: 'dj', on: false, id, name });
  }

  async leave(ws, { keepConn = false } = {}) {
    const meta = ws.deserializeAttachment();
    if (!meta) return;
    if (!meta.joined) {
      // Nunca terminó de entrar: si justo estaba entrando, ya no entra
      if (!meta.left) { meta.left = true; try { ws.serializeAttachment(meta); } catch { /* cerrada */ } }
      return;
    }
    await this.load();
    meta.joined = false;
    meta.left = true;
    ws.serializeAttachment(meta);
    this.states.delete(meta.id);
    this.lastSeen.delete(meta.id);
    this.rates.delete(meta.id);
    this.chatTimes.delete(meta.id);
    this.lastText.delete(meta.id);
    for (const k of this.invites.keys()) if (k.startsWith(`${meta.id}>`) || k.endsWith(`>${meta.id}`)) this.invites.delete(k);
    if (this.screen?.id === meta.id) {
      this.screen = null;
      this.broadcast({ t: 'screen', on: false, id: meta.id });
    }
    if (this.dj?.id === meta.id) this.stopDJ();
    for (const part of PARTS) if (this.parts[part]?.id === meta.id) this.releasePart(part);
    const tradeId = this.tradeOf.get(meta.id);
    const trade = tradeId && this.trades.get(tradeId);
    // Si justo se estaba ejecutando, termina solo (la cuenta lo hace todo o nada)
    if (trade && !trade.busy) this.endTrade(trade, () => ({ op: 'closed', name: meta.name }));
    this.broadcast({ t: 'leave', id: meta.id }, ws);
    this.pulls.delete(meta.id);
    // Si se fue el último del grupo que quedaba en la sala, el grupo se disuelve
    // (si queda alguien, sigue en el grupo: deja de escucharse hasta que vuelva)
    const gid = this.groupOf(meta.userId);
    if (gid) {
      const present = new Set(this.joined().filter((w) => w !== ws).map((w) => w.deserializeAttachment().userId));
      if (!this.groups[gid].members.some((u) => present.has(u))) { delete this.groups[gid]; await this.saveGroups(); }
    }
    if (meta.userId && !keepConn) {
      await this.accounts().releaseConn(meta.userId, meta.id);
      // Si la cuenta ya está en otra sala, la presencia es de esa
      await this.accounts().presenceLeave(await this.roomName(), meta.userId);
    }
  }

  async webSocketClose(ws, code) {
    await this.leave(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'chau'); } catch { /* ya cerrada */ }
  }

  async webSocketError(ws) {
    await this.leave(ws);
  }
}

// Luces que manda un artista: colores 0..1, intensidades 0..2, movimiento -1..1
function cleanLights(s) {
  if (!s || typeof s !== 'object') return null;
  const n = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const color = (c) => (Array.isArray(c) && c.length === 3 ? c.map((v) => n(v, 0, 1, 1)) : null);
  const out = {
    color: color(s.color), intensidad: n(s.intensidad, 0, 2, 1), flash: n(s.flash, 0, 1, 0),
    escenario: { color: color(s.escenario?.color), intensidad: n(s.escenario?.intensidad, 0, 2, 1) },
    leds: { color: color(s.leds?.color) },
    focos: [0, 1, 2, 3].map((i) => {
      const f = Array.isArray(s.focos) ? s.focos[i] ?? {} : {};
      return { color: color(f.color), intensidad: n(f.intensidad, 0, 2, 1), pan: n(f.pan, -1, 1, 0), tilt: n(f.tilt, -1, 1, 0) };
    }),
  };
  return out;
}

// Editor de salas: plantilla y muebles de las salas personales (server/editor.js)
Object.assign(Room.prototype, roomEditorMethods);
