import { DurableObject } from 'cloudflare:workers';
import { cleanName, cleanLook, cleanEquip, EMOTES } from './shared.js';

// Cada sala del juego es una instancia de Room (un Durable Object).
// - Reenvía posiciones, chat, AFK y estado del micrófono.
// - Pasa las señales WebRTC entre jugadores (la voz y la pantalla compartida
//   viajan directo de jugador a jugador, P2P; el servidor solo los presenta).
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
const DEFAULT_SETTINGS = { chat: true, voice: true, screen: true, items: true, dj: true };
const SPAWN = { x: 3, z: 0 };

// Estado de un jugador: [x, y, z, rotación, velocidad, pose]
// pose: 0 parado, 1 agachado, 2 sentado, 3 trepando, 4 en el aire
function cleanState(s) {
  if (!Array.isArray(s) || s.length !== 6) return null;
  if (!s.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const out = s.map((v) => Math.round(v * 100) / 100);
  out[5] = Math.min(4, Math.max(0, Math.round(s[5])));
  return out;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.states = new Map();   // últimas posiciones (en memoria)
    this.lastSeen = new Map(); // última señal de cada conexión
    this.screen = null;        // { id, streamId } de quien comparte pantalla
    this.dj = null;            // { id, name, streamId, track } de quien pasa música en la cabina
    this.invites = new Map();  // "de>para" -> hora de la invitación a intercambiar
    this.trades = new Map();   // id -> intercambio en curso
    this.tradeOf = new Map();  // jugador -> id del intercambio
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
    const s = await this.ctx.storage.get(['settings', 'bans', 'silenced', 'ground']);
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
    return admins.includes(meta.userId) || meta.userId === (await this.ownerId());
  }

  async fetch(request) {
    const name = request.headers.get('X-Room');
    if (name && !this.name) { this.name = name; await this.ctx.storage.put('name', name); }
    const { 0: client, 1: server } = new WebSocketPair();
    // acceptWebSocket permite que la sala "hiberne" sin cortar las conexiones.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), joined: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  publicInfo(m) {
    return {
      id: m.id, userId: m.userId, name: m.name, look: m.look, equip: m.equip ?? [],
      afk: !!m.afk, mic: m.mic ?? 'off', silenced: !!this.silenced?.[m.userId], mod: !!m.mod,
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
    await this.scheduleAlarm();
  }

  async webSocketMessage(ws, raw) {
    // Las señales WebRTC (descripciones de sesión) son más largas que el resto
    if (typeof raw !== 'string' || raw.length > 20_000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t !== 'rtc' && raw.length > 4096) return;
    await this.load();
    const meta = ws.deserializeAttachment();
    this.lastSeen.set(meta.id, Date.now());

    if (msg.t === 'join' && !meta.joined) {
      const user = await this.accounts().auth(msg.token);
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
      Object.assign(meta, { joined: true, userId: user.id, name: user.name, look: user.look, equip: user.equip, afk: !!msg.afk, mic: 'off' });
      meta.mod = await this.isMod(meta);
      ws.serializeAttachment(meta);
      const s = cleanState(msg.s);
      if (s) this.states.set(meta.id, s);
      const chat = (await this.ctx.storage.get('chat')) ?? [];
      this.send(ws, {
        t: 'welcome', id: meta.id, players: this.players(ws), chat, screen: this.screen, dj: this.dj,
        room: { name: await this.roomName(), owner: await this.ownerId(), settings: this.settings, mod: meta.mod, silenced: !!this.silenced[user.id] },
        ground: this.ground.map((g) => ({ ...g, age: Date.now() - g.at })),
      });
      this.broadcast({ t: 'join', ...this.publicInfo(meta) }, ws);
      await this.accounts().presence(await this.roomName(), [user.id]);
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
      case 'afk': {
        meta.afk = !!msg.v;
        ws.serializeAttachment(meta);
        this.broadcast({ t: 'afk', id: meta.id, v: meta.afk }, ws);
        break;
      }
      case 'emote': {
        if (!EMOTES[msg.e]) return;
        this.broadcast({ t: 'emote', id: meta.id, e: msg.e }, ws);
        break;
      }
      case 'mic': {
        if (!MIC_STATES.includes(msg.v)) return;
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
      case 'look': {
        // El perfil y los objetos se leen de la cuenta (no se confía en lo que manda el cliente)
        const pub = await this.accounts().publicLook(meta.userId);
        if (!pub) return;
        meta.name = cleanName(pub.name);
        meta.look = cleanLook(pub.look);
        meta.equip = cleanEquip(pub.equip);
        ws.serializeAttachment(meta);
        this.broadcast({ t: 'look', id: meta.id, name: meta.name, look: meta.look, equip: meta.equip }, ws);
        break;
      }
      case 'chat': {
        if (silenced) return this.notice(ws, 'Estás silenciado en esta sala.');
        if (!this.settings.chat && !meta.mod) return this.notice(ws, 'El chat está deshabilitado en esta sala.');
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 300);
        if (!text) return;
        const entry = { id: meta.id, userId: meta.userId, name: meta.name, text, ts: Date.now() };
        const chat = (await this.ctx.storage.get('chat')) ?? [];
        chat.push(entry);
        await this.ctx.storage.put('chat', chat.slice(-CHAT_HISTORY));
        this.broadcast({ t: 'chat', ...entry });
        break;
      }
      case 'rtc': {
        // Señal WebRTC para un jugador puntual
        if (typeof msg.to !== 'string' || msg.to === meta.id) return;
        this.send(this.byId(msg.to), { t: 'rtc', from: meta.id, data: msg.data });
        break;
      }
      case 'screen': {
        if (msg.on) {
          if (silenced || (!this.settings.screen && !meta.mod)) {
            this.send(ws, { t: 'screen', denied: true });
            return this.notice(ws, silenced ? 'Estás silenciado en esta sala.' : 'Compartir pantalla está deshabilitado en esta sala.');
          }
          if (this.screen && this.screen.id !== meta.id && this.byId(this.screen.id)) {
            this.send(ws, { t: 'screen', busy: true, id: this.screen.id });
            return;
          }
          this.screen = { id: meta.id, streamId: String(msg.streamId ?? '').slice(0, 100) };
          this.broadcast({ t: 'screen', on: true, ...this.screen });
        } else if (this.screen?.id === meta.id) {
          this.screen = null;
          this.broadcast({ t: 'screen', on: false, id: meta.id });
        }
        break;
      }
      case 'dj': {
        // Cabina del DJ: una persona a la vez (sin cola); cualquiera puede, salvo que la sala lo deshabilite
        if (msg.on) {
          if (silenced || (!this.settings.dj && !meta.mod)) {
            this.send(ws, { t: 'dj', denied: true });
            return this.notice(ws, silenced ? 'Estás silenciado en esta sala.' : 'Pasar música está deshabilitado en esta sala.');
          }
          if (this.dj && this.dj.id !== meta.id && this.byId(this.dj.id)) {
            this.send(ws, { t: 'dj', busy: true, name: this.dj.name });
            return;
          }
          this.dj = { id: meta.id, name: meta.name, streamId: String(msg.streamId ?? '').slice(0, 100), track: '' };
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

  // ---------- Objetos en el suelo ----------

  async drop(ws, meta, msg) {
    if (!this.settings.items && !meta.mod) return this.notice(ws, 'Soltar objetos está deshabilitado en esta sala.');
    const pos = [msg.x, msg.y, msg.z].map(Number);
    if (!pos.every(Number.isFinite)) return;
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
    const age = Date.now() - g.at;
    if (g.owner !== meta.userId && age < PICKUP_LOCK) {
      return this.notice(ws, `Todavía no: podés juntarlo en ${Math.ceil((PICKUP_LOCK - age) / 1000)} s.`);
    }
    const r = await this.accounts().pickupItem(meta.userId, g.iid);
    this.ground = this.ground.filter((x) => x.iid !== g.iid);
    await this.ctx.storage.put('ground', this.ground);
    this.broadcast({ t: 'ground-', iid: g.iid, by: r.ok ? meta.name : null });
    if (r.ok) this.send(ws, { t: 'picked', iid: g.iid, type: g.type });
  }

  // ---------- Moderación ----------

  async moderate(ws, meta, msg) {
    if (!meta.mod) return this.notice(ws, 'No tenés permisos de moderación en esta sala.');
    const target = msg.target ? this.byId(msg.target) : null;
    const tm = target?.deserializeAttachment();
    if (msg.target && (!target || tm.mod && msg.op !== 'bring')) {
      return this.notice(ws, tm?.mod ? 'No se puede moderar a otro moderador.' : 'Ese jugador ya no está.');
    }

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
        delete this.bans[String(msg.userId ?? '')];
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
        this.broadcast({ t: 'silenced', id: tm.id, v: on });
        break;
      }
      case 'bring': {
        // Traer al jugador al lado del moderador
        const s = this.states.get(meta.id);
        if (!s) return;
        this.send(target, { t: 'teleport', x: s[0] + 1, y: s[1], z: s[2] + 0.5, by: meta.name });
        break;
      }
      case 'spawn':
        this.send(target, { t: 'teleport', x: SPAWN.x, y: 0, z: SPAWN.z, by: meta.name });
        break;
      case 'setting': {
        if (!(msg.key in DEFAULT_SETTINGS)) return;
        this.settings[msg.key] = !!msg.value;
        await this.ctx.storage.put('settings', this.settings);
        if (msg.key === 'screen' && !msg.value && this.screen && !this.byId(this.screen.id)?.deserializeAttachment().mod) {
          const id = this.screen.id;
          this.screen = null;
          this.broadcast({ t: 'screen', on: false, id });
        }
        if (msg.key === 'dj' && !msg.value && this.dj && !this.byId(this.dj.id)?.deserializeAttachment().mod) this.stopDJ();
        this.broadcast({ t: 'settings', settings: this.settings, by: meta.name });
        break;
      }
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

    switch (msg.op) {
      case 'invite': {
        const other = this.byId(msg.to);
        if (!other || msg.to === me || trade || this.tradeOf.has(msg.to)) {
          this.send(ws, { t: 'trade', op: 'busy' });
          return;
        }
        this.invites.set(`${me}>${msg.to}`, Date.now());
        this.send(other, { t: 'trade', op: 'invite', from: me, name: meta.name, userId: meta.userId });
        break;
      }
      case 'accept': {
        const key = `${msg.from}>${me}`;
        const at = this.invites.get(key);
        this.invites.delete(key);
        const other = this.byId(msg.from);
        if (!at || Date.now() - at > 60_000 || !other || trade || this.tradeOf.has(msg.from)) {
          this.send(ws, { t: 'trade', op: 'expired' });
          return;
        }
        const otherMeta = other.deserializeAttachment();
        const t = { id: crypto.randomUUID().slice(0, 8), p: [msg.from, me], users: { [msg.from]: otherMeta.userId, [me]: meta.userId }, items: { [msg.from]: [], [me]: [] }, ready: {} };
        this.trades.set(t.id, t);
        this.tradeOf.set(msg.from, t.id);
        this.tradeOf.set(me, t.id);
        this.send(other, { t: 'trade', op: 'open', id: t.id, with: me, name: meta.name });
        this.send(ws, { t: 'trade', op: 'open', id: t.id, with: msg.from, name: otherMeta.name });
        this.tradeState(t);
        break;
      }
      case 'decline': {
        this.invites.delete(`${msg.from}>${me}`);
        this.send(this.byId(msg.from), { t: 'trade', op: 'declined', name: meta.name });
        break;
      }
      case 'offer': {
        if (!trade) return;
        trade.items[me] = await this.accounts().ownedItems(meta.userId, msg.iids);
        trade.ready = {}; // si cambia la oferta, los dos tienen que volver a confirmar
        this.tradeState(trade);
        break;
      }
      case 'ready': {
        if (!trade) return;
        trade.ready[me] = !!msg.v;
        if (trade.p.every((p) => trade.ready[p])) {
          const [a, b] = trade.p;
          const res = await this.accounts().trade(trade.users[a], trade.items[a].map((i) => i.iid), trade.users[b], trade.items[b].map((i) => i.iid));
          this.endTrade(trade, () => (res.ok ? { op: 'done' } : { op: 'failed', error: res.error }));
          // Los objetos equipados pudieron cambiar: actualizar cómo se ven los dos
          for (const p of trade.p) {
            const pws = this.byId(p);
            if (pws) await this.webSocketMessage(pws, JSON.stringify({ t: 'look' }));
          }
        } else this.tradeState(trade);
        break;
      }
      case 'cancel': {
        if (trade) this.endTrade(trade, (p) => ({ op: 'closed', byMe: p === me, name: meta.name }));
        break;
      }
    }
  }

  stopDJ() {
    const { id, name } = this.dj;
    this.dj = null;
    this.broadcast({ t: 'dj', on: false, id, name });
  }

  async leave(ws) {
    const meta = ws.deserializeAttachment();
    if (!meta?.joined) return;
    meta.joined = false;
    ws.serializeAttachment(meta);
    this.states.delete(meta.id);
    this.lastSeen.delete(meta.id);
    if (this.screen?.id === meta.id) {
      this.screen = null;
      this.broadcast({ t: 'screen', on: false, id: meta.id });
    }
    if (this.dj?.id === meta.id) this.stopDJ();
    const tradeId = this.tradeOf.get(meta.id);
    if (tradeId) this.endTrade(this.trades.get(tradeId), () => ({ op: 'closed', name: meta.name }));
    this.broadcast({ t: 'leave', id: meta.id }, ws);
    if (meta.userId) await this.accounts().presenceLeave(await this.roomName(), meta.userId);
  }

  async webSocketClose(ws, code) {
    await this.leave(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'chau'); } catch { /* ya cerrada */ }
  }

  async webSocketError(ws) {
    await this.leave(ws);
  }
}
