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
const PHOTO_LIMIT = 30;           // fotos por usuario (decisión del usuario)
const PHOTO_BYTES = 700 * 1024;   // el cliente achica y comprime antes de subir
const NOTE_LENGTH = 280;          // largo máximo de una nota
const FEED_FRIENDS = 30;          // muro: publicaciones tuyas y de amigos
const FEED_FEATURED = 15;         // muro: "Destacados" (lo más nuevo del resto)

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
    // Red social: fotos de la galería, notas del dueño, corazones del atril, favoritas y avisos
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
        w INTEGER NOT NULL, h INTEGER NOT NULL, created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS photos_owner ON photos (owner);
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_owner ON notes (owner, created);
      CREATE TABLE IF NOT EXISTS hearts (
        owner TEXT NOT NULL, from_user TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (owner, from_user)
      );
      CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL, room TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (user_id, room)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, from_user TEXT NOT NULL,
        created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created);
      CREATE TABLE IF NOT EXISTS likes (
        post_type TEXT NOT NULL, post_id TEXT NOT NULL, user_id TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (post_type, post_id, user_id)
      );
    `);
    // Columnas agregadas después de la primera versión
    const cols = this.sql.exec('PRAGMA table_info(users)').toArray().map((c) => c.name);
    const addCol = (name, def) => { if (!cols.includes(name)) this.sql.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`); };
    addCol('bio', "TEXT NOT NULL DEFAULT ''");
    addCol('starter', 'INTEGER NOT NULL DEFAULT 0');
    addCol('room_name', "TEXT NOT NULL DEFAULT ''");
    addCol('room_desc', "TEXT NOT NULL DEFAULT ''");
    addCol('room_privacy', "TEXT NOT NULL DEFAULT 'todos'");     // todos | amigos | cerrada
    addCol('gallery_privacy', "TEXT NOT NULL DEFAULT 'todos'");  // todos | amigos | nadie
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
        id: row.id, username, name, look, bio, created, equip,
        relation: viewer ? (viewer.id === row.id ? 'self' : this.relation(viewer.id, row.id)) : 'none',
        hearts: this.heartCount(row.id),
        roomName: this.roomTitle(row),
        galleryPrivacy: row.gallery_privacy,
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
    if (rel === 'none') {
      this.sql.exec("INSERT INTO friends (a, b, status, created) VALUES (?, ?, 'pending', ?)", me.id, otherId, Date.now());
      this.notify(otherId, 'friend_request', me.id);
    }
    return { ok: true, relation: this.relation(me.id, otherId) };
  }

  async friendRespond(token, otherId, accept) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (accept) {
      const changed = this.sql.exec("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending'", otherId, me.id).rowsWritten;
      if (changed) this.notify(otherId, 'friend_accepted', me.id);
    } else this.sql.exec('DELETE FROM friends WHERE a = ? AND b = ?', otherId, me.id);
    return { ok: true, relation: this.relation(me.id, otherId) };
  }

  async friendRemove(token, otherId) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    this.sql.exec('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me.id, otherId, otherId, me.id);
    return { ok: true, relation: 'none' };
  }

  // ---------- Privacidad ----------
  // todos: cualquiera · amigos: el dueño y sus amigos · cerrada/nadie: solo el dueño

  allowed(viewerId, ownerId, privacy) {
    if (viewerId && viewerId === ownerId) return true;
    if (privacy === 'todos') return true;
    if (privacy === 'amigos') return !!viewerId && this.relation(viewerId, ownerId) === 'friends';
    return false;
  }

  // ¿Puede este usuario entrar a la sala personal de ownerId? (la usa la sala al entrar)
  async canEnter(ownerId, userId) {
    const owner = this.row(ownerId);
    if (!owner) return true; // sala de una cuenta que no existe: sin dueño, abierta
    return this.allowed(userId, ownerId, owner.room_privacy);
  }

  // ---------- Galería de fotos del perfil (hasta 30, visibilidad la elige el dueño) ----------

  async photoList(token, ownerId) {
    const owner = this.row(ownerId);
    if (!owner) return { ok: false, error: 'No existe ese perfil.' };
    const viewer = await this.userFromToken(token);
    const mine = viewer?.id === ownerId;
    if (!this.allowed(viewer?.id, ownerId, owner.gallery_privacy)) {
      return { ok: true, hidden: true, privacy: owner.gallery_privacy, photos: [] };
    }
    const photos = this.sql.exec('SELECT id, w, h, created FROM photos WHERE owner = ? ORDER BY created DESC', ownerId).toArray();
    return { ok: true, mine, privacy: owner.gallery_privacy, max: PHOTO_LIMIT, photos };
  }

  async photoGet(token, id) {
    const p = this.sql.exec('SELECT * FROM photos WHERE id = ?', String(id ?? '')).toArray()[0];
    if (!p) return null;
    const viewer = await this.userFromToken(token);
    if (!this.allowed(viewer?.id, p.owner, this.row(p.owner)?.gallery_privacy)) return null;
    return { mime: p.mime, data: p.data };
  }

  async photoAdd(token, mime, data, w, h) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!['image/jpeg', 'image/webp', 'image/png'].includes(mime)) return { ok: false, error: 'Formato no permitido (JPG, PNG o WebP).' };
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > PHOTO_BYTES) return { ok: false, error: 'La foto es demasiado pesada.' };
    const count = this.sql.exec('SELECT COUNT(*) AS n FROM photos WHERE owner = ?', me.id).one().n;
    if (count >= PHOTO_LIMIT) return { ok: false, error: `Llegaste al máximo de ${PHOTO_LIMIT} fotos. Borrá alguna para subir otra.` };
    const id = randomHex(8);
    this.sql.exec('INSERT INTO photos (id, owner, mime, data, w, h, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, me.id, mime, data, Math.round(w) || 0, Math.round(h) || 0, Date.now());
    return { ok: true, id };
  }

  async photoDelete(token, id) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const gone = this.sql.exec('DELETE FROM photos WHERE id = ? AND owner = ?', String(id ?? ''), me.id).rowsWritten;
    if (gone) this.sql.exec("DELETE FROM likes WHERE post_type = 'photo' AND post_id = ?", String(id));
    return { ok: true };
  }

  async setGalleryPrivacy(token, value) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!['todos', 'amigos', 'nadie'].includes(value)) return { ok: false, error: 'Opción no válida.' };
    this.sql.exec('UPDATE users SET gallery_privacy = ? WHERE id = ?', value, me.id);
    return { ok: true, privacy: value };
  }

  // ---------- Notas del dueño (las lee cualquiera; solo escribe el dueño) ----------

  async notesList(ownerId) {
    const owner = this.row(ownerId);
    if (!owner) return { ok: false, error: 'No existe ese perfil.' };
    const notes = this.sql.exec('SELECT id, text, created FROM notes WHERE owner = ? ORDER BY created DESC LIMIT 100', ownerId).toArray();
    return { ok: true, owner: { id: owner.id, name: owner.name, room: this.roomTitle(owner) }, notes };
  }

  async noteAdd(token, text) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const clean = String(text ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, NOTE_LENGTH);
    if (!clean) return { ok: false, error: 'La nota está vacía.' };
    const id = randomHex(8);
    this.sql.exec('INSERT INTO notes (id, owner, text, created) VALUES (?, ?, ?, ?)', id, me.id, clean, Date.now());
    return { ok: true, note: { id, text: clean, created: Date.now() } };
  }

  async noteDelete(token, id) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const gone = this.sql.exec('DELETE FROM notes WHERE id = ? AND owner = ?', String(id ?? ''), me.id).rowsWritten;
    if (gone) this.sql.exec("DELETE FROM likes WHERE post_type = 'note' AND post_id = ?", String(id));
    return { ok: true };
  }

  // ---------- Muro del celular (tipo Facebook) ----------
  // Arriba: lo tuyo y lo de tus amigos. Abajo, "Destacados": lo más nuevo del resto.
  // Las fotos aparecen solo si quien mira puede ver la galería de su dueño.

  async feed(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const friendIds = this.sql.exec(
      "SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM friends WHERE (a = ? OR b = ?) AND status = 'accepted'", me.id, me.id, me.id,
    ).toArray().map((r) => r.id);
    const circle = [me.id, ...friendIds];
    const marks = circle.map(() => '?').join(',');
    const authors = new Map();
    const author = (id) => {
      if (!authors.has(id)) { const u = this.row(id); authors.set(id, u ? { id: u.id, name: u.name, username: u.username ?? null, privacy: u.gallery_privacy } : null); }
      return authors.get(id);
    };
    const likesOf = (type, id) => this.sql.exec('SELECT COUNT(*) AS n FROM likes WHERE post_type = ? AND post_id = ?', type, id).one().n;
    const liked = (type, id) => this.sql.exec('SELECT 1 FROM likes WHERE post_type = ? AND post_id = ? AND user_id = ?', type, id, me.id).toArray().length > 0;
    const shape = (type, r, section) => {
      const a = author(r.owner);
      if (!a) return null;
      if (type === 'photo' && !this.allowed(me.id, r.owner, a.privacy)) return null;
      return {
        type, id: r.id, section, created: r.created, mine: r.owner === me.id,
        author: { id: a.id, name: a.name, username: a.username },
        ...(type === 'note' ? { text: r.text } : { w: r.w, h: r.h }),
        likes: likesOf(type, r.id), liked: liked(type, r.id),
      };
    };
    const pick = (inCircle, limit) => {
      const cond = `owner ${inCircle ? '' : 'NOT '}IN (${marks})`;
      const notes = this.sql.exec(`SELECT id, owner, text, created FROM notes WHERE ${cond} ORDER BY created DESC LIMIT ?`, ...circle, limit).toArray();
      const photos = this.sql.exec(`SELECT id, owner, w, h, created FROM photos WHERE ${cond} ORDER BY created DESC LIMIT ?`, ...circle, limit).toArray();
      const section = inCircle ? 'amigos' : 'destacados';
      return [...notes.map((r) => shape('note', r, section)), ...photos.map((r) => shape('photo', r, section))]
        .filter(Boolean).sort((x, y) => y.created - x.created).slice(0, limit);
    };
    return { ok: true, items: [...pick(true, FEED_FRIENDS), ...pick(false, FEED_FEATURED)] };
  }

  async like(token, type, id, on) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!['note', 'photo'].includes(type)) return { ok: false, error: 'Publicación no válida.' };
    const table = type === 'note' ? 'notes' : 'photos';
    const post = this.sql.exec(`SELECT owner FROM ${table} WHERE id = ?`, String(id ?? '')).toArray()[0];
    if (!post) return { ok: false, error: 'Esa publicación ya no existe.' };
    if (type === 'photo' && !this.allowed(me.id, post.owner, this.row(post.owner)?.gallery_privacy)) return { ok: false, error: 'No podés ver esa foto.' };
    if (on) this.sql.exec('INSERT OR IGNORE INTO likes (post_type, post_id, user_id, created) VALUES (?, ?, ?, ?)', type, String(id), me.id, Date.now());
    else this.sql.exec('DELETE FROM likes WHERE post_type = ? AND post_id = ? AND user_id = ?', type, String(id), me.id);
    const likes = this.sql.exec('SELECT COUNT(*) AS n FROM likes WHERE post_type = ? AND post_id = ?', type, String(id)).one().n;
    return { ok: true, likes, liked: !!on };
  }

  // ---------- Corazones del atril: uno por visitante; cuentan para la sala y para el dueño ----------

  heartCount(ownerId) {
    return this.sql.exec('SELECT COUNT(*) AS n FROM hearts WHERE owner = ?', ownerId).one().n;
  }

  async hearts(token, ownerId) {
    const viewer = await this.userFromToken(token);
    const mine = !!viewer && this.sql.exec('SELECT 1 FROM hearts WHERE owner = ? AND from_user = ?', ownerId, viewer.id).toArray().length > 0;
    return { ok: true, count: this.heartCount(ownerId), given: mine, self: viewer?.id === ownerId };
  }

  async heartGive(token, ownerId) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!this.row(ownerId)) return { ok: false, error: 'No existe esa sala.' };
    if (me.id === ownerId) return { ok: false, error: 'No podés dejarte un corazón a vos mismo.' };
    this.sql.exec('INSERT OR IGNORE INTO hearts (owner, from_user, created) VALUES (?, ?, ?)', ownerId, me.id, Date.now());
    return { ok: true, count: this.heartCount(ownerId), given: true };
  }

  // ---------- Mi sala: nombre, descripción y quién puede entrar ----------

  roomTitle(row) {
    return row.room_name || `Sala de ${row.name}`;
  }

  async roomInfo(ownerId) {
    const owner = this.row(ownerId);
    if (!owner) return { ok: false, error: 'No existe esa sala.' };
    return {
      ok: true,
      room: { owner: owner.id, ownerName: owner.name, name: this.roomTitle(owner), customName: owner.room_name, desc: owner.room_desc, privacy: owner.room_privacy, hearts: this.heartCount(owner.id) },
    };
  }

  async setMyRoom(token, { name, desc, privacy } = {}) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (privacy !== undefined && !['todos', 'amigos', 'cerrada'].includes(privacy)) return { ok: false, error: 'Opción no válida.' };
    const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
    this.sql.exec('UPDATE users SET room_name = ?, room_desc = ?, room_privacy = ? WHERE id = ?',
      name !== undefined ? clean(name, 32) : me.room_name,
      desc !== undefined ? clean(desc, 140) : me.room_desc,
      privacy ?? me.room_privacy, me.id);
    return this.roomInfo(me.id);
  }

  // ---------- Salas favoritas (se guardan desde el Mapa) ----------

  roomLabel(room) {
    if (room === 'museo') return { name: 'Museo', hearts: null };
    if (room.startsWith('u-')) {
      const owner = this.row(room.slice(2));
      if (owner) return { name: this.roomTitle(owner), hearts: this.heartCount(owner.id), ownerName: owner.name };
    }
    return { name: `Sala ${room}`, hearts: null };
  }

  async favorites(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const rows = this.sql.exec('SELECT room FROM favorites WHERE user_id = ? ORDER BY created DESC', me.id).toArray();
    return { ok: true, favorites: rows.map(({ room }) => ({ room, ...this.roomLabel(room) })) };
  }

  async setFavorite(token, room, on) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    room = String(room ?? '').toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(room)) return { ok: false, error: 'Sala no válida.' };
    if (on) this.sql.exec('INSERT OR IGNORE INTO favorites (user_id, room, created) VALUES (?, ?, ?)', me.id, room, Date.now());
    else this.sql.exec('DELETE FROM favorites WHERE user_id = ? AND room = ?', me.id, room);
    return this.favorites(token);
  }

  // ---------- Buscador de gente (para agregar amigos) ----------

  async search(token, q) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const term = String(q ?? '').trim().toLowerCase().replace(/^@/, '').slice(0, 20);
    if (term.length < 2) return { ok: true, results: [] };
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const rows = this.sql.exec(
      'SELECT id, name, username FROM users WHERE id != ? AND (LOWER(name) LIKE ? OR username LIKE ?) ORDER BY username IS NULL, name LIMIT 20',
      me.id, like, like,
    ).toArray();
    return { ok: true, results: rows.map((r) => ({ id: r.id, name: r.name, username: r.username ?? null, relation: this.relation(me.id, r.id), room: this.where(r.id) })) };
  }

  // ---------- Avisos (por ahora: solicitudes de amistad enviadas y aceptadas) ----------

  notify(userId, type, fromId) {
    this.sql.exec('INSERT INTO notifications (id, user_id, type, from_user, created) VALUES (?, ?, ?, ?, ?)', randomHex(8), userId, type, fromId, Date.now());
  }

  async notifications(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const rows = this.sql.exec('SELECT * FROM notifications WHERE user_id = ? ORDER BY created DESC LIMIT 30', me.id).toArray();
    const unseen = this.sql.exec('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND seen = 0', me.id).one().n;
    return {
      ok: true, unseen,
      items: rows.map((r) => {
        const from = this.row(r.from_user);
        return { id: r.id, type: r.type, created: r.created, seen: !!r.seen, from: from ? { id: from.id, name: from.name, username: from.username ?? null } : null };
      }),
    };
  }

  async notificationsSeen(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    this.sql.exec('UPDATE notifications SET seen = 1 WHERE user_id = ?', me.id);
    return { ok: true };
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
