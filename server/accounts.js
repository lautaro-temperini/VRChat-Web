import { DurableObject } from 'cloudflare:workers';
import { cleanName, cleanLook, ITEMS, STARTER_ITEMS } from './shared.js';

// Cuentas de usuario (una sola instancia global con base SQLite).
// - Invitado: se crea sin usuario ni contraseña; el navegador guarda su token.
// - Cuenta: usuario + contraseña (se guarda solo el hash PBKDF2, nunca la contraseña).
// Un invitado puede convertirse en cuenta sin perder su personaje.
// También guarda: inventario de objetos, amigos y en qué sala está cada uno.

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100_000 }, key, 256);
  return hex(bits);
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const USERNAME = /^[a-z0-9_.]{3,20}$/;
const ONLINE_WINDOW = 90_000; // ms: si la sala no avisó en este tiempo, está desconectado

export class Accounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE, pass TEXT, salt TEXT,
        name TEXT NOT NULL, look TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        iid TEXT PRIMARY KEY, owner_id TEXT NOT NULL, type TEXT NOT NULL, color TEXT NOT NULL,
        equipped INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS items_owner ON items (owner_id);
      CREATE TABLE IF NOT EXISTS friends (
        a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE TABLE IF NOT EXISTS presence (
        user_id TEXT PRIMARY KEY, room TEXT NOT NULL, updated INTEGER NOT NULL
      );
    `);
    // Columnas agregadas después de la primera versión
    const cols = this.sql.exec('PRAGMA table_info(users)').toArray().map((c) => c.name);
    if (!cols.includes('bio')) this.sql.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('starter')) this.sql.exec('ALTER TABLE users ADD COLUMN starter INTEGER NOT NULL DEFAULT 0');
  }

  // ---------- Usuarios y sesiones ----------

  row(id) {
    return this.sql.exec('SELECT * FROM users WHERE id = ?', String(id ?? '')).toArray()[0] ?? null;
  }

  publicUser(row) {
    return {
      id: row.id, username: row.username ?? null, name: row.name, look: JSON.parse(row.look),
      bio: row.bio ?? '', created: row.created, equip: this.equipped(row.id),
    };
  }

  async newSession(userId) {
    const token = randomHex(32);
    this.sql.exec('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)', await sha256(token), userId, Date.now());
    return token;
  }

  async userFromToken(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const rows = this.sql.exec(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', await sha256(token),
    ).toArray();
    return rows[0] ?? null;
  }

  async guest(name, look) {
    const id = randomHex(8);
    this.sql.exec('INSERT INTO users (id, name, look, created) VALUES (?, ?, ?, ?)',
      id, cleanName(name), JSON.stringify(cleanLook(look)), Date.now());
    this.giveStarter(id);
    return { ok: true, token: await this.newSession(id), user: this.publicUser(this.row(id)) };
  }

  // Crea una cuenta nueva, o convierte al invitado actual (token) en cuenta.
  async register(token, username, password, name, look) {
    username = String(username ?? '').trim().toLowerCase();
    if (!USERNAME.test(username)) return { ok: false, error: 'El usuario debe tener 3 a 20 caracteres: letras, números, punto o guion bajo.' };
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) return { ok: false, error: 'La contraseña tiene que tener al menos 6 caracteres.' };
    if (this.sql.exec('SELECT 1 FROM users WHERE username = ?', username).toArray().length) return { ok: false, error: 'Ese usuario ya existe.' };

    const salt = randomHex(16);
    const pass = await pbkdf2(password, salt);
    const current = await this.userFromToken(token);
    if (current && !current.username) {
      this.sql.exec('UPDATE users SET username = ?, pass = ?, salt = ? WHERE id = ?', username, pass, salt, current.id);
      return { ok: true, token, user: this.publicUser(this.row(current.id)) };
    }
    const id = randomHex(8);
    this.sql.exec('INSERT INTO users (id, username, pass, salt, name, look, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, username, pass, salt, cleanName(name || username), JSON.stringify(cleanLook(look)), Date.now());
    this.giveStarter(id);
    return { ok: true, token: await this.newSession(id), user: this.publicUser(this.row(id)) };
  }

  async login(username, password) {
    username = String(username ?? '').trim().toLowerCase();
    const row = this.sql.exec('SELECT * FROM users WHERE username = ?', username).toArray()[0];
    const fail = { ok: false, error: 'Usuario o contraseña incorrectos.' };
    if (!row || typeof password !== 'string') return fail;
    if (!sameText(await pbkdf2(password, row.salt), row.pass)) return fail;
    return { ok: true, token: await this.newSession(row.id), user: this.publicUser(row) };
  }

  async auth(token) {
    const row = await this.userFromToken(token);
    return row ? this.publicUser(row) : null;
  }

  async update(token, name, look, bio) {
    const row = await this.userFromToken(token);
    if (!row) return { ok: false, error: 'Sesión vencida.' };
    const cleanBio = String(bio ?? row.bio ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, 280);
    this.sql.exec('UPDATE users SET name = ?, look = ?, bio = ? WHERE id = ?', cleanName(name), JSON.stringify(cleanLook(look)), cleanBio, row.id);
    return { ok: true, user: this.publicUser(this.row(row.id)) };
  }

  async logout(token) {
    if (typeof token === 'string') this.sql.exec('DELETE FROM sessions WHERE token = ?', await sha256(token));
    return { ok: true };
  }

  // Lo que la sala necesita para mostrar a alguien (nombre, ropa, objetos)
  async publicLook(userId) {
    const row = this.row(userId);
    return row ? { name: row.name, look: JSON.parse(row.look), equip: this.equipped(row.id) } : null;
  }

  // Perfil que puede ver cualquiera. Si quien mira tiene sesión, incluye la relación de amistad.
  async profile(id, token) {
    const row = this.row(id);
    if (!row) return { ok: false, error: 'No existe ese perfil.' };
    const viewer = await this.userFromToken(token);
    const { username, name, look, bio, created, equip } = this.publicUser(row);
    return {
      ok: true,
      profile: {
        id: row.id, username, name, look, bio, created, equip, gallery: [],
        relation: viewer ? (viewer.id === row.id ? 'self' : this.relation(viewer.id, row.id)) : 'none',
      },
    };
  }

  // ---------- Inventario ----------

  giveStarter(userId) {
    const types = [...STARTER_ITEMS].sort(() => Math.random() - 0.5).slice(0, 3);
    for (const type of types) this.addItem(userId, type, pick(ITEMS[type].colors));
    this.sql.exec('UPDATE users SET starter = 1 WHERE id = ?', userId);
  }

  addItem(userId, type, color) {
    this.sql.exec('INSERT INTO items (iid, owner_id, type, color, created) VALUES (?, ?, ?, ?, ?)', randomHex(8), userId, type, color, Date.now());
  }

  equipped(userId) {
    return this.sql.exec('SELECT type, color FROM items WHERE owner_id = ? AND equipped = 1', userId).toArray()
      .map(({ type, color }) => ({ type, color }));
  }

  items(userId) {
    return this.sql.exec('SELECT iid, type, color, equipped FROM items WHERE owner_id = ? ORDER BY created', userId).toArray()
      .map((r) => ({ iid: r.iid, type: r.type, color: r.color, equipped: !!r.equipped }));
  }

  async inventory(token) {
    const row = await this.userFromToken(token);
    if (!row) return { ok: false, error: 'Sesión vencida.' };
    if (!row.starter) this.giveStarter(row.id); // cuentas creadas antes del inventario
    return { ok: true, items: this.items(row.id) };
  }

  async equip(token, iid, on) {
    const row = await this.userFromToken(token);
    if (!row) return { ok: false, error: 'Sesión vencida.' };
    const item = this.sql.exec('SELECT * FROM items WHERE iid = ? AND owner_id = ?', String(iid ?? ''), row.id).toArray()[0];
    if (!item) return { ok: false, error: 'Ese objeto no es tuyo.' };
    this.ctx.storage.transactionSync(() => {
      if (on) {
        // Uno por lugar: sacar lo que haya en el mismo lugar del cuerpo
        const slot = ITEMS[item.type]?.slot;
        for (const other of this.items(row.id)) {
          if (other.equipped && ITEMS[other.type]?.slot === slot) this.sql.exec('UPDATE items SET equipped = 0 WHERE iid = ?', other.iid);
        }
      }
      this.sql.exec('UPDATE items SET equipped = ? WHERE iid = ?', on ? 1 : 0, item.iid);
    });
    return { ok: true, items: this.items(row.id), equip: this.equipped(row.id) };
  }

  // Detalle de objetos para mostrar en un intercambio (solo los que son del dueño)
  async ownedItems(userId, iids) {
    if (!Array.isArray(iids)) return [];
    const mine = new Map(this.items(userId).map((i) => [i.iid, i]));
    return [...new Set(iids)].filter((iid) => mine.has(iid)).slice(0, 12).map((iid) => mine.get(iid));
  }

  // Intercambio: todo o nada. Si algún objeto ya no es de quien lo ofrece, se cancela.
  async trade(aId, aIids, bId, bIids) {
    const owns = (uid, list) => list.every((iid) => this.sql.exec('SELECT 1 FROM items WHERE iid = ? AND owner_id = ?', iid, uid).toArray().length);
    if (!owns(aId, aIids) || !owns(bId, bIids)) return { ok: false, error: 'Algún objeto ya no está disponible.' };
    this.ctx.storage.transactionSync(() => {
      for (const iid of aIids) this.sql.exec('UPDATE items SET owner_id = ?, equipped = 0 WHERE iid = ?', bId, iid);
      for (const iid of bIids) this.sql.exec('UPDATE items SET owner_id = ?, equipped = 0 WHERE iid = ?', aId, iid);
    });
    return { ok: true };
  }

  // ---------- Objetos en el suelo ----------
  // Al soltarlo, el objeto deja el inventario (dueño = "suelo"). Si alguien lo junta,
  // pasa a ser suyo; si vence sin que nadie lo junte, se borra.

  async dropItem(userId, iid) {
    const item = this.sql.exec('SELECT * FROM items WHERE iid = ? AND owner_id = ?', String(iid ?? ''), userId).toArray()[0];
    if (!item) return { ok: false, error: 'Ese objeto no es tuyo.' };
    this.sql.exec("UPDATE items SET owner_id = ?, equipped = 0 WHERE iid = ?", `ground:${userId}`, item.iid);
    return { ok: true, item: { iid: item.iid, type: item.type, color: item.color }, equip: this.equipped(userId) };
  }

  async pickupItem(userId, iid) {
    const item = this.sql.exec("SELECT * FROM items WHERE iid = ? AND owner_id LIKE 'ground:%'", String(iid ?? '')).toArray()[0];
    if (!item) return { ok: false, error: 'Ese objeto ya no está.' };
    this.sql.exec('UPDATE items SET owner_id = ?, equipped = 0 WHERE iid = ?', userId, item.iid);
    return { ok: true };
  }

  async destroyGroundItem(iid) {
    this.sql.exec("DELETE FROM items WHERE iid = ? AND owner_id LIKE 'ground:%'", String(iid ?? ''));
    return { ok: true };
  }

  // ---------- Amigos ----------

  relation(me, other) {
    const r = this.sql.exec('SELECT * FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me, other, other, me).toArray()[0];
    if (!r) return 'none';
    if (r.status === 'accepted') return 'friends';
    return r.a === me ? 'outgoing' : 'incoming';
  }

  where(userId) {
    const p = this.sql.exec('SELECT room, updated FROM presence WHERE user_id = ?', userId).toArray()[0];
    return p && Date.now() - p.updated < ONLINE_WINDOW ? p.room : null;
  }

  async friends(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const rows = this.sql.exec('SELECT * FROM friends WHERE a = ? OR b = ?', me.id, me.id).toArray();
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const r of rows) {
      const otherId = r.a === me.id ? r.b : r.a;
      const other = this.row(otherId);
      if (!other) continue;
      const info = { id: other.id, name: other.name, username: other.username ?? null, room: this.where(other.id) };
      if (r.status === 'accepted') out.friends.push(info);
      else if (r.a === me.id) out.outgoing.push(info);
      else out.incoming.push(info);
    }
    out.friends.sort((x, y) => (y.room ? 1 : 0) - (x.room ? 1 : 0) || x.name.localeCompare(y.name));
    return { ok: true, ...out };
  }

  async friendRequest(token, otherId) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!this.row(otherId) || otherId === me.id) return { ok: false, error: 'No existe ese perfil.' };
    const rel = this.relation(me.id, otherId);
    if (rel === 'incoming') return this.friendRespond(token, otherId, true); // ya te había invitado: aceptar
    if (rel === 'none') this.sql.exec("INSERT INTO friends (a, b, status, created) VALUES (?, ?, 'pending', ?)", me.id, otherId, Date.now());
    return { ok: true, relation: this.relation(me.id, otherId) };
  }

  async friendRespond(token, otherId, accept) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (accept) this.sql.exec("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", otherId, me.id);
    else this.sql.exec('DELETE FROM friends WHERE a = ? AND b = ?', otherId, me.id);
    return { ok: true, relation: this.relation(me.id, otherId) };
  }

  async friendRemove(token, otherId) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    this.sql.exec('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me.id, otherId, otherId, me.id);
    return { ok: true, relation: 'none' };
  }

  // ---------- Presencia (las salas avisan quién está adentro) ----------

  async presence(room, userIds) {
    const now = Date.now();
    for (const id of userIds) {
      this.sql.exec('INSERT INTO presence (user_id, room, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET room = excluded.room, updated = excluded.updated', id, room, now);
    }
  }

  async presenceLeave(room, userId) {
    this.sql.exec('DELETE FROM presence WHERE user_id = ? AND room = ?', userId, room);
  }
}
