import { DurableObject } from 'cloudflare:workers';
import { cleanName, cleanLook, ITEMS, STARTER_ITEMS, FURNITURE, SPECIAL_FURNITURE } from './shared.js';
import { setupWorks, worksMethods } from './works.js';
import { setupMessages, messagesMethods } from './messages.js';
import { setupProgress, progressMethods } from './progress.js';
import { accountsEditorMethods } from './editor.js';

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
// Días según la hora de Argentina (GMT-3)
const DAY = 86_400_000, ARG = 3 * 3_600_000;
const argDay = (ts) => Math.floor((ts - ARG) / DAY);
const argMidnight = (day) => (day + 1) * DAY + ARG;

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
// Ingreso con Google y Discord (OAuth). "verified": el proveedor confirmó que el mail es suyo
const OAUTH = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    profile: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile', extra: { prompt: 'select_account' },
    read: (p) => ({ sub: p.sub && String(p.sub), email: p.email, verified: p.email_verified === true || p.email_verified === 'true', name: p.given_name || p.name }),
  },
  discord: {
    auth: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token',
    profile: 'https://discord.com/api/users/@me', scope: 'identify email', extra: { prompt: 'none' },
    read: (p) => ({ sub: p.id && String(p.id), email: p.email, verified: p.verified === true, name: p.global_name || p.username }),
  },
};
const REPORT_REASONS =['acoso', 'ilegal', 'plagio', 'spam', 'suplantacion', 'otro'];

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
    addCol('email', 'TEXT');                                     // cuentas registradas (sin verificar por ahora)
    addCol('terms', 'INTEGER');                                  // cuándo aceptó +18 y condiciones
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)');
    // Restringir (ocultar todo de una persona) y reportes a los admins
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (user_id, blocked_id)
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY, provider TEXT NOT NULL, origin TEXT NOT NULL, guest_id TEXT, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_links (
        provider TEXT NOT NULL, sub TEXT NOT NULL, user_id TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (provider, sub)
      );
      CREATE TABLE IF NOT EXISTS login_codes (
        code TEXT PRIMARY KEY, token TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ignores (
        user_id TEXT NOT NULL, ignored_id TEXT NOT NULL, created INTEGER NOT NULL,
        PRIMARY KEY (user_id, ignored_id)
      );
      CREATE TABLE IF NOT EXISTS group_rejects (
        from_id TEXT NOT NULL, to_id TEXT NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL, until INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, reporter TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL,
        detail TEXT NOT NULL, room TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'abierto'
      );
    `);
    setupWorks(this.sql); // Museo rotativo (works.js)
    setupMessages(this.sql); // Mensajes entre amigos (messages.js)
    setupProgress(this.sql); // Progresión (progress.js)
  }

  // Invitado = cuenta sin registrar (sin nickname): solo para probar
  isGuest(row) { return !row?.username; }
  guestError() { return { ok: false, guest: true, error: 'Creá una cuenta (es gratis) para usar esto. Los invitados solo pueden mirar, chatear y moverse.' }; }
  isAdmin(id) { return String(this.env.ADMIN_IDS ?? '').split(',').map((s) => s.trim()).includes(id); }

  // ¿El nombre ya lo usa una cuenta registrada? (sin importar mayúsculas)
  nameTaken(name, exceptId = '') {
    return this.sql.exec('SELECT 1 FROM users WHERE username = ? AND id != ?', String(name).trim().toLowerCase(), exceptId).toArray().length > 0;
  }

  // ---------- Usuarios y sesiones ----------

  row(id) {
    return this.sql.exec('SELECT * FROM users WHERE id = ?', String(id ?? '')).toArray()[0] ?? null;
  }

  publicUser(row) {
    return {
      id: row.id, username: row.username ?? null, name: row.name, look: JSON.parse(row.look),
      bio: row.bio ?? '', created: row.created, equip: this.equipped(row.id),
      guest: this.isGuest(row), admin: this.isAdmin(row.id),
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

  // Invitado: solo para probar (sin objetos, intercambio, muro ni sala propia). Tiene que aceptar +18.
  async guest(name, look, terms) {
    if (!terms) return { ok: false, error: 'Para entrar tenés que confirmar que sos mayor de 18 y aceptar las condiciones.' };
    const clean = cleanName(name);
    if (this.nameTaken(clean)) return { ok: false, error: 'Ese nombre es de una cuenta registrada. Elegí otro o iniciá sesión.' };
    const id = randomHex(8);
    this.sql.exec('INSERT INTO users (id, name, look, created, terms) VALUES (?, ?, ?, ?, ?)',
      id, clean, JSON.stringify(cleanLook(look)), Date.now(), Date.now());
    return { ok: true, token: await this.newSession(id), user: this.publicUser(this.row(id)) };
  }

  // Crea una cuenta (mail + nickname único + contraseña), o convierte al invitado actual en cuenta
  // (conserva su personaje). El nickname es el nombre que ven los demás y no se repite.
  async register(token, { email, nick, password, look, terms } = {}) {
    email = String(email ?? '').trim().toLowerCase();
    nick = String(nick ?? '').trim();
    const username = nick.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return { ok: false, error: 'Ese mail no parece válido.' };
    if (!USERNAME.test(username)) return { ok: false, error: 'El nickname debe tener 3 a 20 caracteres: letras, números, punto o guion bajo.' };
    if (typeof password !== 'string' || password.length < 6 || password.length > 200) return { ok: false, error: 'La contraseña tiene que tener al menos 6 caracteres.' };
    if (!terms) return { ok: false, error: 'Tenés que confirmar que sos mayor de 18 y aceptar las condiciones.' };
    if (this.sql.exec('SELECT 1 FROM users WHERE username = ?', username).toArray().length) return { ok: false, error: 'Ese nickname ya está en uso.' };
    if (this.sql.exec('SELECT 1 FROM users WHERE email = ?', email).toArray().length) return { ok: false, error: 'Ya hay una cuenta con ese mail. Iniciá sesión.' };

    const salt = randomHex(16);
    const pass = await pbkdf2(password, salt);
    const current = await this.userFromToken(token);
    let id;
    if (current && this.isGuest(current)) {
      id = current.id;
      this.sql.exec('UPDATE users SET username = ?, name = ?, email = ?, pass = ?, salt = ?, terms = ? WHERE id = ?', username, nick, email, pass, salt, Date.now(), id);
    } else {
      id = randomHex(8);
      this.sql.exec('INSERT INTO users (id, username, name, email, pass, salt, look, created, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, username, nick, email, pass, salt, JSON.stringify(cleanLook(look)), Date.now(), Date.now());
      token = null;
    }
    if (!this.row(id).starter) this.giveStarter(id); // los objetos iniciales llegan al registrarse
    return { ok: true, token: token ?? await this.newSession(id), user: this.publicUser(this.row(id)) };
  }

  // Se entra con el mail o con el nickname
  async login(login, password) {
    const key = String(login ?? '').trim().toLowerCase();
    const row = this.sql.exec('SELECT * FROM users WHERE username = ? OR email = ?', key, key).toArray()[0];
    const fail = { ok: false, error: 'Usuario o contraseña incorrectos.' };
    if (!row || !row.salt || typeof password !== 'string') return fail; // sin salt: entra solo con Google/Discord
    if (!sameText(await pbkdf2(password, row.salt), row.pass)) return fail;
    return { ok: true, token: await this.newSession(row.id), user: this.publicUser(row) };
  }

  // ---------- Ingreso con Google y Discord ----------
  // 1) oauthStart: arma el link al proveedor (con un "state" de un solo uso que recuerda de dónde vino
  //    y si era un invitado, para convertir esa cuenta y no perder el personaje).
  // 2) oauthCallback: canjea el código, lee el mail y busca la cuenta: la ya vinculada, la que tiene
  //    ese mail (si el proveedor lo confirmó: es la misma cuenta), el invitado que la pidió, o una nueva.
  // 3) oauthFinish: el juego cambia el código de un solo uso por la sesión.
  // 4) oauthNick: si es nueva, elige su nickname único (y acepta +18 si no lo había hecho).

  async oauthStart(token, provider, origin) {
    const cfg = OAUTH[provider];
    const clientId = this.env[`${provider.toUpperCase()}_CLIENT_ID`];
    if (!cfg || !clientId) return { ok: false, error: 'Esa forma de ingresar no está disponible.' };
    // Solo vuelve a este mismo sitio (o a la página local de desarrollo)
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return { ok: false, error: 'Origen no válido.' };
    const now = Date.now();
    this.sql.exec('DELETE FROM oauth_states WHERE created < ?', now - 10 * 60_000);
    const current = await this.userFromToken(token);
    const state = randomHex(16);
    this.sql.exec('INSERT INTO oauth_states (state, provider, origin, guest_id, created) VALUES (?, ?, ?, ?, ?)',
      state, provider, origin, current && this.isGuest(current) ? current.id : null, now);
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: `${origin}/api/oauth/${provider}/callback`, response_type: 'code',
      scope: cfg.scope, state, ...cfg.extra,
    });
    return { ok: true, url: `${cfg.auth}?${params}` };
  }

  async oauthCallback(provider, code, state, denied) {
    const cfg = OAUTH[provider];
    const st = this.sql.exec('SELECT * FROM oauth_states WHERE state = ? AND provider = ?', String(state ?? ''), provider).toArray()[0];
    if (!cfg || !st || Date.now() - st.created > 10 * 60_000) return { ok: false, error: 'El ingreso venció. Probá de nuevo.' };
    this.sql.exec('DELETE FROM oauth_states WHERE state = ?', st.state);
    const fail = (error) => ({ ok: false, error, origin: st.origin });
    if (denied || !code) return fail('Se canceló el ingreso.');

    // Canjear el código por un acceso y leer el perfil
    let profile;
    try {
      const tr = await fetch(cfg.token, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: this.env[`${provider.toUpperCase()}_CLIENT_ID`], client_secret: this.env[`${provider.toUpperCase()}_CLIENT_SECRET`] ?? '',
          code, grant_type: 'authorization_code', redirect_uri: `${st.origin}/api/oauth/${provider}/callback`,
        }),
      });
      const tok = await tr.json();
      if (!tok.access_token) return fail('No se pudo ingresar. Probá de nuevo.');
      const pr = await fetch(cfg.profile, { headers: { Authorization: `Bearer ${tok.access_token}` } });
      profile = cfg.read(await pr.json());
    } catch {
      return fail('No se pudo conectar. Probá de nuevo.');
    }
    if (!profile?.sub) return fail('No se pudo leer tu cuenta.');
    const email = profile.verified && profile.email ? String(profile.email).trim().toLowerCase() : null;

    let id = this.sql.exec('SELECT user_id FROM oauth_links WHERE provider = ? AND sub = ?', provider, profile.sub).toArray()[0]?.user_id;
    if (id && !this.row(id)) id = null;
    if (!id && email) id = this.sql.exec('SELECT id FROM users WHERE email = ?', email).toArray()[0]?.id;
    if (!id && st.guest_id && this.isGuest(this.row(st.guest_id))) id = st.guest_id;
    if (!id) {
      id = randomHex(8);
      let name = cleanName(profile.name || 'Artista');
      if (this.nameTaken(name)) name = cleanName(`${name}${Math.floor(Math.random() * 900 + 100)}`);
      this.sql.exec('INSERT INTO users (id, name, look, created) VALUES (?, ?, ?, ?)', id, name, JSON.stringify(cleanLook(null)), Date.now());
    }
    this.sql.exec('INSERT OR IGNORE INTO oauth_links (provider, sub, user_id, created) VALUES (?, ?, ?, ?)', provider, profile.sub, id, Date.now());
    // Si la cuenta no tenía mail, guarda el confirmado (si nadie más lo usa)
    if (email && !this.row(id).email && !this.sql.exec('SELECT 1 FROM users WHERE email = ?', email).toArray().length) {
      this.sql.exec('UPDATE users SET email = ? WHERE id = ?', email, id);
    }
    const loginCode = randomHex(16);
    this.sql.exec('DELETE FROM login_codes WHERE created < ?', Date.now() - 2 * 60_000);
    this.sql.exec('INSERT INTO login_codes (code, token, created) VALUES (?, ?, ?)', loginCode, await this.newSession(id), Date.now());
    return { ok: true, code: loginCode, origin: st.origin };
  }

  async oauthFinish(code) {
    const r = this.sql.exec('SELECT * FROM login_codes WHERE code = ?', code).toArray()[0];
    if (!r || Date.now() - r.created > 2 * 60_000) return { ok: false, error: 'El ingreso venció. Probá de nuevo.' };
    this.sql.exec('DELETE FROM login_codes WHERE code = ?', code);
    const row = await this.userFromToken(r.token);
    if (!row) return { ok: false, error: 'No se pudo ingresar.' };
    return { ok: true, token: r.token, user: this.publicUser(row), needsNick: !row.username, needsTerms: !row.terms };
  }

  // Cuenta entrada por Google/Discord que todavía no tiene nickname
  async oauthNick(token, { nick, terms } = {}) {
    const row = await this.userFromToken(token);
    if (!row) return { ok: false, error: 'Sesión vencida.' };
    if (row.username) return { ok: true, user: this.publicUser(row) };
    const isLinked = this.sql.exec('SELECT 1 FROM oauth_links WHERE user_id = ?', row.id).toArray().length > 0;
    if (!isLinked) return { ok: false, error: 'No válido.' };
    nick = String(nick ?? '').trim();
    const username = nick.toLowerCase();
    if (!USERNAME.test(username)) return { ok: false, error: 'El nickname debe tener 3 a 20 caracteres: letras, números, punto o guion bajo.' };
    if (!row.terms && !terms) return { ok: false, error: 'Tenés que confirmar que sos mayor de 18 y aceptar las condiciones.' };
    if (this.sql.exec('SELECT 1 FROM users WHERE username = ?', username).toArray().length) return { ok: false, error: 'Ese nickname ya está en uso.' };
    this.sql.exec('UPDATE users SET username = ?, name = ?, terms = COALESCE(terms, ?) WHERE id = ?', username, nick, Date.now(), row.id);
    if (!this.row(row.id).starter) this.giveStarter(row.id);
    return { ok: true, user: this.publicUser(this.row(row.id)) };
  }

  async auth(token) {
    const row = await this.userFromToken(token);
    return row ? this.publicUser(row) : null;
  }

  async update(token, name, look, bio) {
    const row = await this.userFromToken(token);
    if (!row) return { ok: false, error: 'Sesión vencida.' };
    const cleanBio = String(bio ?? row.bio ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, 280);
    let newName = cleanName(name ?? row.name);
    if (this.isGuest(row)) {
      if (newName !== row.name && this.nameTaken(newName)) return { ok: false, error: 'Ese nombre es de una cuenta registrada.' };
      this.sql.exec('UPDATE users SET name = ?, look = ?, bio = ? WHERE id = ?', newName, JSON.stringify(cleanLook(look)), cleanBio, row.id);
    } else {
      // Cuenta registrada: el nombre visible es el nickname (único); cambiarlo cambia el nickname
      // (cuentas viejas pueden tener nombre ≠ usuario: si no cambia el nombre, no se toca el usuario)
      let username = row.username;
      if (newName !== row.name) {
        if (!USERNAME.test(newName.toLowerCase())) return { ok: false, error: 'El nickname debe tener 3 a 20 caracteres: letras, números, punto o guion bajo.' };
        if (this.nameTaken(newName, row.id)) return { ok: false, error: 'Ese nickname ya está en uso.' };
        username = newName.toLowerCase();
      }
      this.sql.exec('UPDATE users SET name = ?, username = ?, look = ?, bio = ? WHERE id = ?', newName, username, JSON.stringify(cleanLook(look)), cleanBio, row.id);
    }
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
    // Paquete inicial: 15 objetos al azar entre prendas y muebles especiales (se pueden repetir)
    const pool = [...STARTER_ITEMS, ...SPECIAL_FURNITURE];
    for (let i = 0; i < 15; i++) {
      const type = pick(pool);
      this.addItem(userId, type, ITEMS[type] ? pick(ITEMS[type].colors) : FURNITURE[type].color);
    }
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
    if (this.isGuest(row)) return { ok: true, guest: true, items: [] };
    if (!row.starter) this.giveStarter(row.id); // cuentas creadas antes del inventario
    return { ok: true, items: this.items(row.id) };
  }

  async equip(token, iid, on) {
    const row = await this.userFromToken(token);
    if (!row) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(row)) return this.guestError();
    const item = this.sql.exec('SELECT * FROM items WHERE iid = ? AND owner_id = ?', String(iid ?? ''), row.id).toArray()[0];
    if (!item) return { ok: false, error: 'Ese objeto no es tuyo.' };
    if (!ITEMS[item.type]) return { ok: false, error: 'Los muebles se ponen desde el editor de tu sala.' };
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
    if (this.isGuest(this.row(aId)) || this.isGuest(this.row(bId))) return this.guestError();
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
    if (this.isGuest(this.row(userId))) return this.guestError();
    const item = this.sql.exec('SELECT * FROM items WHERE iid = ? AND owner_id = ?', String(iid ?? ''), userId).toArray()[0];
    if (!item) return { ok: false, error: 'Ese objeto no es tuyo.' };
    this.sql.exec("UPDATE items SET owner_id = ?, equipped = 0 WHERE iid = ?", `ground:${userId}`, item.iid);
    return { ok: true, item: { iid: item.iid, type: item.type, color: item.color }, equip: this.equipped(userId) };
  }

  async pickupItem(userId, iid) {
    if (this.isGuest(this.row(userId))) return this.guestError();
    const item = this.sql.exec("SELECT * FROM items WHERE iid = ? AND owner_id LIKE 'ground:%'", String(iid ?? '')).toArray()[0];
    if (!item) return { ok: false, gone: true, error: 'Ese objeto ya no está.' };
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
      this.progressTrack(me.id, 'amigo');
    }
    return { ok: true, relation: this.relation(me.id, otherId) };
  }

  async friendRespond(token, otherId, accept) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (accept) {
      const changed = this.sql.exec("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending'", otherId, me.id).rowsWritten;
      if (changed) { this.notify(otherId, 'friend_accepted', me.id); this.progressTrack(me.id, 'amigo'); }
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
    if (this.isGuest(owner)) return userId === ownerId; // los invitados no tienen sala propia para recibir gente
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
    if (this.isGuest(me)) return this.guestError();
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
    if (this.isGuest(me)) return this.guestError();
    const clean = String(text ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, NOTE_LENGTH);
    if (!clean) return { ok: false, error: 'La nota está vacía.' };
    const id = randomHex(8);
    this.sql.exec('INSERT INTO notes (id, owner, text, created) VALUES (?, ?, ?, ?)', id, me.id, clean, Date.now());
    this.progressTrack(me.id, 'muro');
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
    const blocked = this.blockedBy(me.id);
    const shape = (type, r, section) => {
      const a = author(r.owner);
      if (!a || blocked.has(r.owner)) return null; // restringido: no aparece nada suyo
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
    if (this.isGuest(me)) return this.guestError();
    if (!['note', 'photo'].includes(type)) return { ok: false, error: 'Publicación no válida.' };
    const table = type === 'note' ? 'notes' : 'photos';
    const post = this.sql.exec(`SELECT owner FROM ${table} WHERE id = ?`, String(id ?? '')).toArray()[0];
    if (!post) return { ok: false, error: 'Esa publicación ya no existe.' };
    if (type === 'photo' && !this.allowed(me.id, post.owner, this.row(post.owner)?.gallery_privacy)) return { ok: false, error: 'No podés ver esa foto.' };
    if (on) this.sql.exec('INSERT OR IGNORE INTO likes (post_type, post_id, user_id, created) VALUES (?, ?, ?, ?)', type, String(id), me.id, Date.now());
    if (on) { this.progressTrack(me.id, 'like', `${type}:${id}`); this.progressBadges(post.owner); }
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
    if (this.isGuest(me)) return this.guestError();
    if (!this.row(ownerId)) return { ok: false, error: 'No existe esa sala.' };
    if (me.id === ownerId) return { ok: false, error: 'No podés dejarte un corazón a vos mismo.' };
    this.sql.exec('INSERT OR IGNORE INTO hearts (owner, from_user, created) VALUES (?, ?, ?)', ownerId, me.id, Date.now());
    this.progressTrack(me.id, 'corazon', ownerId);
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
    if (this.isGuest(me)) return this.guestError();
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
        let data = null;
        try { data = r.data ? JSON.parse(r.data) : null; } catch { /* aviso viejo */ }
        return { id: r.id, type: r.type, created: r.created, seen: !!r.seen, data, from: from ? { id: from.id, name: from.name, username: from.username ?? null } : null };
      }),
    };
  }

  async notificationsSeen(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    this.sql.exec('UPDATE notifications SET seen = 1 WHERE user_id = ?', me.id);
    return { ok: true };
  }

  // ---------- Restringir: ocultar todo de una persona (voz, chat, muro, fotos) — solo para quien restringe ----------

  blockedBy(userId) {
    return new Set(this.sql.exec('SELECT blocked_id FROM blocks WHERE user_id = ?', userId).toArray().map((r) => r.blocked_id));
  }

  async blocks(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const ids = [...this.blockedBy(me.id)];
    return { ok: true, blocks: ids.map((id) => { const u = this.row(id); return { id, name: u?.name ?? '—' }; }) };
  }

  async setBlock(token, otherId, on) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!otherId || otherId === me.id) return { ok: false, error: 'No válido.' };
    if (on) this.sql.exec('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created) VALUES (?, ?, ?)', me.id, otherId, Date.now());
    else this.sql.exec('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?', me.id, otherId);
    return this.blocks(token);
  }

  // ---------- Ignorar: no escucho su voz ni veo su texto en la sala (y no me puede invitar a un grupo) ----------

  async ignores(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const ids = this.sql.exec('SELECT ignored_id FROM ignores WHERE user_id = ?', me.id).toArray().map((r) => r.ignored_id);
    return { ok: true, ignores: ids };
  }

  async setIgnore(token, otherId, on) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!otherId || otherId === me.id) return { ok: false, error: 'No válido.' };
    if (on) this.sql.exec('INSERT OR IGNORE INTO ignores (user_id, ignored_id, created) VALUES (?, ?, ?)', me.id, otherId, Date.now());
    else this.sql.exec('DELETE FROM ignores WHERE user_id = ? AND ignored_id = ?', me.id, otherId);
    return this.ignores(token);
  }

  // ---------- Invitaciones a grupos de voz (anti-acoso) ----------
  // Si rechazás a alguien: 1º rechazo, no te puede reinvitar por 1 min; 2º, 10 min; 3º, hasta
  // mañana (medianoche de Argentina). La cuenta de rechazos vuelve a cero cada día.
  // Quien está ignorado o restringido nunca te puede invitar. A quien invita no se le avisa nada.

  async groupInviteCheck(fromId, toId) {
    const hit = (table, col) => this.sql.exec(`SELECT 1 FROM ${table} WHERE user_id = ? AND ${col} = ?`, toId, fromId).toArray().length > 0;
    if (hit('ignores', 'ignored_id') || hit('blocks', 'blocked_id')) return { ok: false };
    const r = this.sql.exec('SELECT until FROM group_rejects WHERE from_id = ? AND to_id = ?', fromId, toId).toArray()[0];
    return { ok: !r || r.until <= Date.now() };
  }

  async groupRejected(fromId, toId) {
    const now = Date.now();
    const day = argDay(now);
    const r = this.sql.exec('SELECT day, count FROM group_rejects WHERE from_id = ? AND to_id = ?', fromId, toId).toArray()[0];
    const count = r && r.day === day ? r.count + 1 : 1;
    const until = count === 1 ? now + 60_000 : count === 2 ? now + 10 * 60_000 : argMidnight(day);
    this.sql.exec('INSERT OR REPLACE INTO group_rejects (from_id, to_id, day, count, until) VALUES (?, ?, ?, ?, ?)', fromId, toId, day, count, until);
    return { ok: true };
  }

  // ---------- Reportes: llegan a los admins (contenido ilegal, robo de obras, acoso…) ----------

  async report(token, { target, reason, detail, room } = {}) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (!this.row(target) || target === me.id) return { ok: false, error: 'No válido.' };
    if (!REPORT_REASONS.includes(reason)) return { ok: false, error: 'Elegí un motivo.' };
    const today = this.sql.exec('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created > ?', me.id, Date.now() - 86_400_000).one().n;
    if (today >= 10) return { ok: false, error: 'Mandaste muchos reportes hoy. Probá mañana.' };
    this.sql.exec('INSERT INTO reports (id, reporter, target, reason, detail, room, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
      randomHex(8), me.id, target, reason, String(detail ?? '').trim().slice(0, 500), String(room ?? '').slice(0, 40), Date.now());
    return { ok: true };
  }

  async reports(token) {
    const me = await this.userFromToken(token);
    if (!me || !this.isAdmin(me.id)) return { ok: false, error: 'Solo para admins.' };
    const rows = this.sql.exec("SELECT * FROM reports WHERE status = 'abierto' ORDER BY created DESC LIMIT 50").toArray();
    const who = (id) => { const u = this.row(id); return u ? { id, name: u.name, username: u.username ?? null } : { id, name: '—' }; };
    return { ok: true, reports: rows.map((r) => ({ id: r.id, reason: r.reason, detail: r.detail, room: r.room, created: r.created, reporter: who(r.reporter), target: who(r.target) })) };
  }

  async resolveReport(token, id) {
    const me = await this.userFromToken(token);
    if (!me || !this.isAdmin(me.id)) return { ok: false, error: 'Solo para admins.' };
    this.sql.exec("UPDATE reports SET status = 'resuelto' WHERE id = ?", String(id ?? ''));
    return this.reports(token);
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

// Museo rotativo: postular, revisar, rotar (server/works.js)
Object.assign(Accounts.prototype, worksMethods);
// Mensajes entre amigos (server/messages.js)
Object.assign(Accounts.prototype, messagesMethods);
// Progresión: puntos, niveles, insignias y misiones (server/progress.js)
Object.assign(Accounts.prototype, progressMethods);

// Editor de salas: muebles especiales que salen del inventario (server/editor.js)
Object.assign(Accounts.prototype, accountsEditorMethods);
