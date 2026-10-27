// Ayudas para las pruebas: cuentas de prueba por la API y clientes WebSocket reales contra el
// servidor local (npm test lo levanta solo; ver scripts/test.mjs).
import assert from 'node:assert/strict';

export const BASE = process.env.TEST_BASE ?? 'http://127.0.0.1:8790';
const WS_BASE = BASE.replace(/^http/, 'ws');
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = 'GET', body, token, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { text }; }
  data.status = res.status;
  return data;
}

// Invitado (sin cuenta)
export async function guest(name = 'Invitado') {
  const r = await api('guest', { method: 'POST', body: { name, terms: true } });
  assert.ok(r.ok, `no se pudo crear el invitado: ${r.error}`);
  return { token: r.token, user: r.user };
}

// Cuenta registrada (mail + nickname). Trae el paquete inicial de 15 objetos.
export async function account(prefix = 'p') {
  const nick = `${prefix}${uniq()}`.slice(0, 20);
  const r = await api('register', { method: 'POST', body: { email: `${nick}@prueba.test`, nick, password: 'secreto123', terms: true } });
  assert.ok(r.ok, `no se pudo registrar: ${r.error}`);
  return { token: r.token, user: r.user, nick };
}

export async function inventory(token) {
  const r = await api('inventory', { token });
  assert.ok(r.ok);
  return r.items;
}

// Cliente de sala: guarda todo lo que llega y deja esperar mensajes
export class Client {
  constructor(token, room = 'museo') {
    this.token = token;
    this.room = room;
    this.msgs = [];
    this.waiters = [];
    this.closed = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws/${this.room}`);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = (e) => reject(e.error ?? new Error('ws error'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        this.msgs.push(m);
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
      };
      this.ws.onclose = (e) => { this.closed = e.code; for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error(`conexión cerrada (${e.code}) esperando ${w.what}`)); } };
    });
  }

  send(msg) { this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  // Espera el próximo mensaje que cumpla (también mira los que ya llegaron, desde "from")
  wait(pred, { ms = 4000, what = 'mensaje', from = this.mark ?? 0 } = {}) {
    const p = typeof pred === 'string' ? (m) => m.t === pred : pred;
    const old = this.msgs.slice(from).find(p);
    if (old) { this.mark = this.msgs.indexOf(old) + 1; return Promise.resolve(old); }
    return new Promise((resolve, reject) => {
      const w = { pred: p, what: typeof pred === 'string' ? pred : what, resolve: (m) => { this.mark = this.msgs.indexOf(m) + 1; resolve(m); }, reject };
      w.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error(`no llegó ${w.what} en ${ms} ms`)); }, ms);
      this.waiters.push(w);
    });
  }

  // ¿Llegó algo que cumpla en los próximos ms? (para comprobar que algo NO pasa)
  async none(pred, ms = 600) {
    const p = typeof pred === 'string' ? (m) => m.t === pred : pred;
    const start = this.msgs.length;
    await sleep(ms);
    return !this.msgs.slice(start).some(p);
  }

  since(i) { return this.msgs.slice(i); }

  async join(s = [0, 0, 0, 0, 0, 0], extra = {}) {
    this.joinedAt = s.slice(0, 3);
    if (!this.ws) await this.open();
    this.mark = this.msgs.length;
    this.send({ t: 'join', token: this.token, s, ...extra });
    const from = this.mark;
    this.welcome = await this.wait((m) => m.t === 'welcome' || m.t === 'error', { what: 'welcome' });
    if (this.welcome.t === 'welcome') this.id = this.welcome.id;
    // La sala pone en la entrada a quien aparece lejos de ella (o de donde estaba al irse)
    const fix = this.msgs.slice(from).find((m) => m.t === 'pos-fix');
    if (fix) { this.joinedAt = [fix.x, fix.y, fix.z]; this.at = null; }
    return this.welcome;
  }

  close() {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.addEventListener('close', () => resolve(), { once: true });
      setTimeout(resolve, 2000); // wrangler dev a veces no avisa el cierre
      this.ws.close(1000);
    });
  }
}

export async function joined(token, room = 'museo', s) {
  const c = new Client(token, room);
  const w = await c.join(s);
  assert.equal(w.t, 'welcome', `no pudo entrar a ${room}: ${JSON.stringify(w)}`);
  return c;
}

// Entra y espera a que la sala de "c" sepa la posición (algunas acciones se miden desde ahí)
// La sala controla la velocidad (saldo de 10 m que se recarga a 8 m/s): se camina por tramos
export async function moveTo(c, x, y, z) {
  const from = c.at ?? c.joinedAt ?? [0, 0, 0];
  const d = Math.hypot(x - from[0], z - from[2]);
  const steps = Math.max(1, Math.ceil(d / 6));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    c.send({ t: 's', s: [from[0] + (x - from[0]) * k, y, from[2] + (z - from[2]) * k, 0, 0, 0] });
    await sleep(i < steps ? 800 : 80);
  }
  c.at = [x, y, z];
}
