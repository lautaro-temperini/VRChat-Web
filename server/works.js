import { isImage } from './shared.js';
import { checkGLB } from './glb.js';

// Museo rotativo: obras del público que se postulan en el atril de la entrada del Museo.
// Se suman a la clase Accounts (comparten la base SQLite); los archivos van a R2 (binding ART).
//
// Recorrido de una obra (status):
//   pendiente → verificada (1 curador) → expuesta (24 h en un lugar) → expuesta_antes
//   pendiente → denegada (2 curadores, cada uno con motivo)
//   pendiente con un "no" + un "sí" → en_disputa (decide un admin)
//   cualquier estado → bajada (solo admins)
// Los Creadores (3 obras aceptadas seguidas) entran ya verificados. La cola es por fecha de
// postulación; verificar no adelanta: en cada lugar que se libera entra la verificada más vieja.

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const WORK_KINDS = { cuadro: 9, escultura: 5 }; // lugares del Museo de cada tipo
export const DENY_REASONS = {
  plagio: 'No es obra propia / plagio',
  condiciones: 'No cumple las condiciones de uso',
  archivo: 'Archivo con problemas (no se ve bien)',
  spam: 'Spam o repetida',
  otro: 'Otro',
};
const SHOW_TIME = 24 * 3_600_000;   // cada obra se expone 24 h
const DAILY_LIMIT = 5;              // postulaciones por persona en las últimas 24 h
const CREATOR_STREAK = 3;           // obras aceptadas seguidas para ser Creador
const LIMITS = { hd: 2_000_000, wall: 700_000, model: 2 * 1024 * 1024 }; // bytes
const IMAGE_MIMES = ['image/jpeg', 'image/webp', 'image/png'];
const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const dim = (v) => Math.min(10_000, Math.max(0, Math.round(Number(v)) || 0));
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

// La IP no se guarda: solo un resumen, para no darle a un curador obras subidas desde su misma conexión
const ipHash = async (ip) => (ip ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`obra|${ip}`)))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('') : null);

export function setupWorks(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY, author TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, technique TEXT NOT NULL, year TEXT NOT NULL, link TEXT NOT NULL,
      w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, created INTEGER NOT NULL, decided INTEGER,
      deny_reason TEXT, deny_text TEXT, slot INTEGER, shown_at INTEGER, ends_at INTEGER, removed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS works_queue ON works (kind, status, created);
    CREATE INDEX IF NOT EXISTS works_author ON works (author, created);
    CREATE TABLE IF NOT EXISTS work_votes (
      work_id TEXT NOT NULL, user_id TEXT NOT NULL, vote TEXT NOT NULL, reason TEXT, text TEXT, created INTEGER NOT NULL,
      PRIMARY KEY (work_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS titles (
      user_id TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, by_user TEXT,
      PRIMARY KEY (user_id, title)
    );
    CREATE TABLE IF NOT EXISTS review_assign (
      user_id TEXT PRIMARY KEY, work_id TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS slots (
      kind TEXT NOT NULL, idx INTEGER NOT NULL, work_id TEXT, ends_at INTEGER,
      PRIMARY KEY (kind, idx)
    );
  `);
  const wcols = sql.exec('PRAGMA table_info(works)').toArray().map((c) => c.name);
  if (!wcols.includes('ip_hash')) sql.exec('ALTER TABLE works ADD COLUMN ip_hash TEXT');
  const cols = sql.exec('PRAGMA table_info(users)').toArray().map((c) => c.name);
  if (!cols.includes('creator_streak')) sql.exec('ALTER TABLE users ADD COLUMN creator_streak INTEGER NOT NULL DEFAULT 0');
  const ncols = sql.exec('PRAGMA table_info(notifications)').toArray().map((c) => c.name);
  if (!ncols.includes('data')) sql.exec('ALTER TABLE notifications ADD COLUMN data TEXT');
  for (const [kind, n] of Object.entries(WORK_KINDS)) {
    for (let i = 0; i < n; i++) sql.exec('INSERT OR IGNORE INTO slots (kind, idx) VALUES (?, ?)', kind, i);
  }
}

export const worksMethods = {
  hasTitle(userId, title) {
    return this.sql.exec('SELECT 1 FROM titles WHERE user_id = ? AND title = ?', userId, title).toArray().length > 0;
  },
  isCurator(userId) { return this.isAdmin(userId) || this.hasTitle(userId, 'curador'); },

  // Aviso con datos (título de la obra, motivo…)
  notifyData(userId, type, fromId, data) {
    this.sql.exec('INSERT INTO notifications (id, user_id, type, from_user, created, data) VALUES (?, ?, ?, ?, ?, ?)',
      randomHex(8), userId, type, fromId, Date.now(), JSON.stringify(data));
  },

  workPublic(w, viewer) {
    const author = this.row(w.author);
    return {
      id: w.id, kind: w.kind, title: w.title, description: w.description, technique: w.technique, year: w.year, link: w.link,
      w: w.w, h: w.h, created: w.created, status: w.status, slot: w.slot, endsAt: w.ends_at,
      author: author ? { id: author.id, name: author.name, username: author.username ?? null } : null,
      mine: viewer === w.author,
    };
  },

  // ---------- Postular ----------
  async workSubmit(token, f) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return this.guestError();
    if (!this.env.ART) return { ok: false, error: 'Falta configurar el almacenamiento de obras (R2).' };
    const kind = f.kind;
    if (!has(WORK_KINDS, kind)) return { ok: false, error: 'Elegí si es un cuadro o una escultura.' };
    const title = clip(f.title, 80);
    if (!title) return { ok: false, error: 'La obra necesita un título.' };
    let link = clip(f.link, 300);
    if (link) {
      try { const u = new URL(link); if (!['http:', 'https:'].includes(u.protocol)) throw 0; link = u.href; } catch { return { ok: false, error: 'El link no es válido.' }; }
    }
    const since = Date.now() - 24 * 3_600_000;
    const recent = this.sql.exec("SELECT COUNT(*) AS n FROM works WHERE author = ? AND created > ?", me.id, since).one().n;
    if (recent >= DAILY_LIMIT) return { ok: false, error: `Podés postular hasta ${DAILY_LIMIT} obras cada 24 horas.` };

    // Archivos: cuadro = imagen HD (hasta 2048 px) + imagen para la pared (1024 px); escultura = modelo GLB
    const files = [];
    if (kind === 'cuadro') {
      for (const [name, max] of [['hd', LIMITS.hd], ['wall', LIMITS.wall]]) {
        const file = f[name];
        if (!file || !IMAGE_MIMES.includes(file.mime) || !(file.data instanceof ArrayBuffer) || !file.data.byteLength) return { ok: false, error: 'Falta la imagen (JPG, PNG o WebP).' };
        if (file.data.byteLength > max) return { ok: false, error: 'La imagen es demasiado pesada.' };
        if (!isImage(file.mime, file.data)) return { ok: false, error: 'El archivo no es una imagen JPG, PNG o WebP.' };
        files.push([name, file]);
      }
    } else {
      const file = f.model;
      if (!file || !(file.data instanceof ArrayBuffer)) return { ok: false, error: 'Falta el modelo 3D (GLB).' };
      // Mismo control automático que los objetos 3D de diseño (triángulos, texturas, tamaño, extensiones)
      const check = checkGLB(file.data);
      if (!check.ok) return check;
      files.push(['model', { mime: 'model/gltf-binary', data: file.data }]);
    }
    const id = randomHex(8);
    for (const [name, file] of files) {
      await this.env.ART.put(`obras/${id}/${name}`, file.data, { httpMetadata: { contentType: file.mime } });
    }
    const creator = this.hasTitle(me.id, 'creador');
    this.sql.exec(`INSERT INTO works (id, author, kind, title, description, technique, year, link, w, h, status, created, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, me.id, kind, title, clip(f.description, 600), clip(f.technique, 80), clip(f.year, 12), link,
      dim(f.w), dim(f.h), creator ? 'verificada' : 'pendiente', Date.now(), await ipHash(f.ip));
    if (creator) this.rotate();
    this.progressTrack(me.id, 'postular');
    return { ok: true, id, verified: creator };
  },

  async myWorks(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const rows = this.sql.exec('SELECT * FROM works WHERE author = ? ORDER BY created DESC LIMIT 50', me.id).toArray();
    const since = Date.now() - 24 * 3_600_000;
    const recent = rows.filter((r) => r.created > since).length;
    return {
      ok: true, left: Math.max(0, DAILY_LIMIT - recent), limit: DAILY_LIMIT,
      creator: this.hasTitle(me.id, 'creador'), curator: this.isCurator(me.id), admin: this.isAdmin(me.id),
      works: rows.map((w) => ({ ...this.workPublic(w, me.id), denyReason: w.deny_reason ? DENY_REASONS[w.deny_reason] : null, denyText: w.deny_text ?? '', queue: this.queueSpot(w) })),
    };
  },

  // Puesto en la fila de su tipo (las que esperan revisión conservan su lugar) y fecha estimada:
  // la fila avanza a medida que vencen los lugares, cada uno 24 h. Es aproximada: si se deniega o
  // se baja alguna de adelante, entra antes.
  queueSpot(w) {
    if (!['pendiente', 'en_disputa', 'verificada'].includes(w.status)) return null;
    const ahead = this.sql.exec("SELECT COUNT(*) AS n FROM works WHERE kind = ? AND status IN ('pendiente', 'en_disputa', 'verificada') AND created < ?", w.kind, w.created).one().n;
    const now = Date.now();
    const ends = this.sql.exec('SELECT ends_at FROM slots WHERE kind = ?', w.kind).toArray()
      .map((s) => Math.max(now, s.ends_at ?? now)).sort((x, y) => x - y);
    return { pos: ahead + 1, eta: ends[ahead % ends.length] + Math.floor(ahead / ends.length) * SHOW_TIME };
  },

  // ¿Quién puede ver los archivos? Expuestas: todos. Si no: el autor, curadores y admins.
  async workFile(token, id, name) {
    const w = this.sql.exec('SELECT * FROM works WHERE id = ?', String(id ?? '')).toArray()[0];
    if (!w || !['hd', 'wall', 'model'].includes(name) || (name === 'model') !== (w.kind === 'escultura')) return null;
    if (!['expuesta', 'expuesta_antes'].includes(w.status)) {
      const me = await this.userFromToken(token);
      if (!me || (me.id !== w.author && !this.isCurator(me.id))) return null;
    }
    return `obras/${w.id}/${name}`;
  },

  // ---------- Revisar (curadores y admins) ----------
  // Les toca una obra: nunca propia (salvo admins) ni de amigos, y que no hayan votado. Van por fecha (la más
  // vieja primero, sin prioridades; decisión 26/10), pero antes las subidas desde otra conexión (prioridad,
  // no exclusión). Solo pueden votar la que les tocó.
  async reviewNext(token, skip, ip) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!this.isCurator(me.id)) return { ok: false, error: 'Solo para curadores.' };
    const admin = this.isAdmin(me.id);
    const rows = this.sql.exec(`
      SELECT w.* FROM works w
      WHERE w.status = 'pendiente'
        AND NOT EXISTS (SELECT 1 FROM work_votes v WHERE v.work_id = w.id AND v.user_id = ?)
        AND (? OR w.author != ?)
        AND (? OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.status = 'accepted'
             AND ((f.a = ? AND f.b = w.author) OR (f.b = ? AND f.a = w.author))))`,
    me.id, admin ? 1 : 0, me.id, admin ? 1 : 0, me.id, me.id).toArray().sort((a, b) => a.created - b.created);
    const pool = rows.filter((w) => w.id !== String(skip ?? ''));
    const list = pool.length ? pool : rows;
    if (!list.length) { this.sql.exec('DELETE FROM review_assign WHERE user_id = ?', me.id); return { ok: true, work: null }; }
    const mine = await ipHash(ip);
    const w = list.find((x) => !mine || x.ip_hash !== mine) ?? list[0];
    this.sql.exec('INSERT OR REPLACE INTO review_assign (user_id, work_id, at) VALUES (?, ?, ?)', me.id, w.id, Date.now());
    return { ok: true, work: this.workPublic(w, me.id), reasons: DENY_REASONS };
  },

  async reviewVote(token, id, vote, reason, text) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!this.isCurator(me.id)) return { ok: false, error: 'Solo para curadores.' };
    const admin = this.isAdmin(me.id);
    const w = this.sql.exec('SELECT * FROM works WHERE id = ?', String(id ?? '')).toArray()[0];
    if (!w || !['pendiente', 'en_disputa'].includes(w.status)) return { ok: false, error: 'Esa obra ya no está para revisar.' };
    if (w.status === 'en_disputa' && !admin) return { ok: false, error: 'Esa obra la decide un admin.' };
    if (!admin && w.author === me.id) return { ok: false, error: 'No podés revisar tus propias obras.' };
    // Solo la que le tocó (si no, un curador elige a dedo la obra de un conocido)
    const assigned = this.sql.exec('SELECT work_id FROM review_assign WHERE user_id = ?', me.id).toArray()[0]?.work_id;
    if (!admin && assigned !== w.id) return { ok: false, error: 'Esa obra no te tocó a vos.' };
    if (!admin && this.relation(me.id, w.author) === 'friends') return { ok: false, error: 'No podés revisar obras de amigos.' };
    if (vote === 'no' && !has(DENY_REASONS, reason)) return { ok: false, error: 'Elegí un motivo.' };
    if (vote !== 'ok' && vote !== 'no') return { ok: false, error: 'Voto inválido.' };
    if (vote === 'ok') reason = null;
    const detail = reason === 'otro' ? clip(text, 200) : '';
    if (reason === 'otro' && !detail) return { ok: false, error: 'Contá el motivo.' };
    this.sql.exec('INSERT OR REPLACE INTO work_votes (work_id, user_id, vote, reason, text, created) VALUES (?, ?, ?, ?, ?, ?)',
      w.id, me.id, vote, vote === 'no' ? reason : null, detail, Date.now());
    this.progressTrack(me.id, 'curada', w.id);

    const others = this.sql.exec('SELECT * FROM work_votes WHERE work_id = ? AND user_id != ?', w.id, me.id).toArray();
    const otherNo = others.find((v) => v.vote === 'no');
    let result;
    if (admin) result = vote === 'ok' ? 'verificada' : 'denegada'; // el admin decide solo (también en disputas)
    else if (vote === 'ok') result = otherNo ? 'en_disputa' : 'verificada';
    else result = otherNo ? 'denegada' : 'pendiente';

    if (result === 'verificada') this.workVerified(w, me.id);
    else if (result === 'denegada') this.workDenied(w, me.id, reason, detail);
    else if (result === 'en_disputa') this.sql.exec("UPDATE works SET status = 'en_disputa' WHERE id = ?", w.id);
    return { ok: true, status: result };
  },

  workVerified(w, byId) {
    this.sql.exec("UPDATE works SET status = 'verificada', decided = ? WHERE id = ?", Date.now(), w.id);
    this.notifyData(w.author, 'work_verified', byId, { title: w.title });
    // Racha de Creador: 3 aceptadas seguidas
    if (!this.hasTitle(w.author, 'creador')) {
      this.sql.exec('UPDATE users SET creator_streak = creator_streak + 1 WHERE id = ?', w.author);
      const streak = this.row(w.author)?.creator_streak ?? 0;
      if (streak >= CREATOR_STREAK) {
        this.sql.exec('INSERT OR IGNORE INTO titles (user_id, title, created) VALUES (?, ?, ?)', w.author, 'creador', Date.now());
        this.notifyData(w.author, 'title_creator', byId, {});
      }
    }
    this.rotate();
  },

  workDenied(w, byId, reason, text) {
    this.sql.exec("UPDATE works SET status = 'denegada', decided = ?, deny_reason = ?, deny_text = ? WHERE id = ?", Date.now(), reason, text, w.id);
    this.sql.exec('UPDATE users SET creator_streak = 0 WHERE id = ?', w.author);
    this.notifyData(w.author, 'work_denied', byId, { title: w.title, reason: DENY_REASONS[reason], text });
  },

  // ---------- Rotación: cada lugar por su cuenta ----------
  // En cada lugar vencido (o vacío) entra la verificada más vieja de su tipo; si no hay, la actual
  // se queda otras 24 h. Se llama al leer el Museo y al verificar (no hace falta un reloj aparte).
  rotate() {
    const now = Date.now();
    for (const kind of Object.keys(WORK_KINDS)) {
      const due = this.sql.exec('SELECT * FROM slots WHERE kind = ? AND (work_id IS NULL OR ends_at <= ?) ORDER BY idx', kind, now).toArray();
      for (const s of due) {
        const next = this.sql.exec("SELECT * FROM works WHERE kind = ? AND status = 'verificada' ORDER BY created LIMIT 1", kind).toArray()[0];
        if (!next) {
          if (s.work_id) this.sql.exec('UPDATE slots SET ends_at = ? WHERE kind = ? AND idx = ?', s.ends_at + SHOW_TIME * Math.ceil((now - s.ends_at + 1) / SHOW_TIME), kind, s.idx);
          continue;
        }
        if (s.work_id) this.sql.exec("UPDATE works SET status = 'expuesta_antes', slot = NULL WHERE id = ?", s.work_id);
        this.sql.exec("UPDATE works SET status = 'expuesta', slot = ?, shown_at = ?, ends_at = ? WHERE id = ?", s.idx, now, now + SHOW_TIME, next.id);
        this.sql.exec('UPDATE slots SET work_id = ?, ends_at = ? WHERE kind = ? AND idx = ?', next.id, now + SHOW_TIME, kind, s.idx);
        this.notifyData(next.author, 'work_showing', next.author, { title: next.title });
        this.progressTrack(next.author, 'expuesta', next.id);
      }
    }
  },

  // Lo que se ve en el Museo ahora: [{ kind, idx, work | null }]
  museumNow() {
    this.rotate();
    const slots = this.sql.exec('SELECT kind, idx, work_id FROM slots ORDER BY kind, idx').toArray();
    return {
      ok: true,
      slots: slots.map((s) => {
        const w = s.work_id && this.sql.exec('SELECT * FROM works WHERE id = ?', s.work_id).toArray()[0];
        return { kind: s.kind, idx: s.idx, work: w ? this.workPublic(w, null) : null };
      }),
    };
  },

  // ---------- Admins ----------
  async worksAdmin(token) {
    const me = await this.userFromToken(token);
    if (!me || !this.isAdmin(me.id)) return { ok: false, error: 'Solo para admins.' };
    const rows = this.sql.exec("SELECT * FROM works WHERE status NOT IN ('bajada') ORDER BY created DESC LIMIT 200").toArray();
    const votes = this.sql.exec('SELECT * FROM work_votes').toArray();
    const name = (id) => this.row(id)?.name ?? '?';
    return {
      ok: true, reasons: DENY_REASONS,
      works: rows.map((w) => ({
        ...this.workPublic(w, me.id),
        votes: votes.filter((v) => v.work_id === w.id).map((v) => ({ who: name(v.user_id), vote: v.vote, reason: v.reason ? DENY_REASONS[v.reason] : null, text: v.text ?? '' })),
      })),
      curators: this.sql.exec("SELECT user_id FROM titles WHERE title = 'curador'").toArray().map((t) => name(t.user_id)),
    };
  },

  async workRemove(token, id) {
    const me = await this.userFromToken(token);
    if (!me || !this.isAdmin(me.id)) return { ok: false, error: 'Solo para admins.' };
    const w = this.sql.exec('SELECT * FROM works WHERE id = ?', String(id ?? '')).toArray()[0];
    if (!w) return { ok: false, error: 'No existe esa obra.' };
    this.sql.exec("UPDATE works SET status = 'bajada', removed_by = ?, slot = NULL WHERE id = ?", me.id, w.id);
    this.sql.exec('UPDATE slots SET work_id = NULL, ends_at = NULL WHERE work_id = ?', w.id);
    this.rotate();
    return { ok: true };
  },

  // /curador nick y /creador nick (admins): da o quita el título
  async setTitle(token, nick, title) {
    const me = await this.userFromToken(token);
    if (!me || !this.isAdmin(me.id)) return { ok: false, error: 'Solo para admins.' };
    if (!['curador', 'creador'].includes(title)) return { ok: false, error: 'Título inválido.' };
    const who = this.sql.exec('SELECT * FROM users WHERE username = ?', String(nick ?? '').trim().toLowerCase().replace(/^@/, '')).toArray()[0];
    if (!who) return { ok: false, error: `No encontré a "${nick}".` };
    const has = this.hasTitle(who.id, title);
    if (has) this.sql.exec('DELETE FROM titles WHERE user_id = ? AND title = ?', who.id, title);
    else this.sql.exec('INSERT INTO titles (user_id, title, created, by_user) VALUES (?, ?, ?, ?)', who.id, title, Date.now(), me.id);
    if (title === 'creador' && has) this.sql.exec('UPDATE users SET creator_streak = 0 WHERE id = ?', who.id);
    return { ok: true, name: who.name, on: !has };
  },
};
