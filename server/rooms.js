import { ROOM_TEMPLATES, cleanText } from './shared.js';

// Salas personales: cada cuenta registrada tiene hasta 3 (decisión 26/10). Se suma a la clase Accounts
// (comparte la base SQLite), igual que works.js y designs.js.
// - La sala se llama u-<id>. La primera de cada cuenta tiene el mismo id que la cuenta (las salas de antes
//   de que hubiera varias); las nuevas, uno al azar.
// - La plantilla es fija: se elige al crear la sala y no se cambia (la primera, la de antes, la elige el
//   dueño la primera vez que entra). Para cambiarla se borra la sala (con confirmación) o se crea otra.
// - Nombre, descripción, privacidad, corazones y notas del atril son de cada sala (decisión 27/10); el perfil
//   suma los corazones de todas.
// - Se puede borrar cualquiera, también la única. Al borrarla, los muebles especiales vuelven a la mochila
//   y se echa a quien esté adentro.

export const ROOMS_MAX = 3;
// Salas creadas por día por cuenta (PROVISORIO 29/10, contra crear y borrar en bucle; cada sala nueva es un
// Durable Object)
export const ROOMS_PER_DAY = 10;
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const clean = (s, n) => cleanText(String(s ?? '').replace(/[<>]/g, ''), n);
const PRIVACY = ['todos', 'amigos', 'cerrada'];
// Plantillas que se ofrecen para las salas personales (las de los mapas públicos no)
export const roomTemplates = () => Object.entries(ROOM_TEMPLATES).filter(([, t]) => !t.public).map(([id, t]) => ({ id, name: t.name }));

export function setupRooms(sql) {
  const existed = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rooms'").toArray().length > 0;
  sql.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', descr TEXT NOT NULL DEFAULT '',
      privacy TEXT NOT NULL DEFAULT 'todos', template TEXT, created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rooms_owner ON rooms (owner, created);
    CREATE TABLE IF NOT EXISTS room_creations (owner TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS room_creations_owner ON room_creations (owner, created);
  `);
  const ncols = sql.exec('PRAGMA table_info(notes)').toArray().map((c) => c.name);
  if (!ncols.includes('room')) {
    // Notas del atril por sala: las de antes son de la primera sala (mismo id que la cuenta)
    sql.exec('ALTER TABLE notes ADD COLUMN room TEXT');
    sql.exec('UPDATE notes SET room = owner');
  }
  if (existed) return;
  // Una sola vez: cada cuenta registrada pasa a tener su sala de siempre en la tabla
  sql.exec(`INSERT OR IGNORE INTO rooms (id, owner, name, descr, privacy, template, created)
    SELECT id, id, room_name, room_desc, room_privacy, NULL, created FROM users WHERE username IS NOT NULL`);
}

export const roomsMethods = {
  roomRow(id) {
    return this.sql.exec('SELECT * FROM rooms WHERE id = ?', String(id ?? '')).toArray()[0] ?? null;
  },

  roomsOf(ownerId) {
    return this.sql.exec('SELECT * FROM rooms WHERE owner = ? ORDER BY created', ownerId).toArray();
  },

  // Al registrarse (o elegir nick con Google/Discord): la primera sala, con el id de la cuenta
  ensureFirstRoom(userId) {
    if (this.roomsOf(userId).length) return;
    this.sql.exec('INSERT OR IGNORE INTO rooms (id, owner, created) VALUES (?, ?, ?)', userId, userId, Date.now());
  },

  roomTitleOf(r) {
    if (r.name) return r.name;
    const owner = this.row(r.owner);
    const others = this.roomsOf(r.owner);
    const n = others.findIndex((x) => x.id === r.id);
    return `Sala de ${owner?.name ?? '?'}${others.length > 1 && n > 0 ? ` ${n + 1}` : ''}`;
  },

  roomHearts(roomId) {
    return this.sql.exec('SELECT COUNT(*) AS n FROM hearts WHERE owner = ?', roomId).one().n;
  },

  // Corazones de todas las salas de una persona (para el perfil)
  ownerHearts(ownerId) {
    return this.sql.exec('SELECT COUNT(*) AS n FROM hearts h JOIN rooms r ON r.id = h.owner WHERE r.owner = ?', ownerId).one().n;
  },

  roomPublic(r) {
    const owner = this.row(r.owner);
    return {
      id: r.id, room: `u-${r.id}`, owner: r.owner, ownerName: owner?.name ?? '', name: this.roomTitleOf(r), customName: r.name,
      desc: r.descr, privacy: r.privacy, template: r.template, hearts: this.roomHearts(r.id),
    };
  },

  // La sala pregunta de quién es y con qué plantilla se creó (null: no existe o se borró)
  async roomOwner(roomId) {
    const r = this.roomRow(roomId);
    return r ? { owner: r.owner, template: r.template } : null;
  },

  // La sala avisa qué plantilla eligió el dueño la primera vez (salas de antes)
  async roomTemplateChosen(roomId, template) {
    this.sql.exec('UPDATE rooms SET template = ? WHERE id = ? AND template IS NULL', template, roomId);
    return { ok: true };
  },

  async myRooms(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return { ok: true, guest: true, rooms: [], max: ROOMS_MAX, templates: roomTemplates() };
    return { ok: true, rooms: this.roomsOf(me.id).map((r) => this.roomPublic(r)), max: ROOMS_MAX, templates: roomTemplates() };
  },

  // Las salas de otra persona que quien mira puede ver (el Mapa, la lista de amigos)
  async userRooms(token, ownerId) {
    const viewer = await this.userFromToken(token);
    const rooms = this.roomsOf(String(ownerId ?? '')).filter((r) => r.privacy === 'todos' || this.allowed(viewer?.id, r.owner, r.privacy));
    return { ok: true, rooms: rooms.map((r) => this.roomPublic(r)) };
  },

  async roomCreate(token, { template, name } = {}) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return this.guestError();
    if (!roomTemplates().some((t) => t.id === template)) return { ok: false, error: 'Elegí una plantilla.' };
    if (this.roomsOf(me.id).length >= ROOMS_MAX) return { ok: false, error: `Podés tener hasta ${ROOMS_MAX} salas. Borrá una para crear otra.` };
    const day = Date.now() - 86_400_000;
    if (this.sql.exec('SELECT COUNT(*) AS n FROM room_creations WHERE owner = ? AND created > ?', me.id, day).one().n >= ROOMS_PER_DAY) {
      return { ok: false, error: 'Creaste muchas salas hoy. Probá mañana.' };
    }
    this.sql.exec('DELETE FROM room_creations WHERE created < ?', day);
    this.sql.exec('INSERT INTO room_creations (owner, created) VALUES (?, ?)', me.id, Date.now());
    // La primera vuelve a tener el id de la cuenta (si se había borrado); las demás, uno nuevo
    const id = this.roomRow(me.id) ? randomHex(8) : me.id;
    this.sql.exec('INSERT INTO rooms (id, owner, name, template, created) VALUES (?, ?, ?, ?, ?)', id, me.id, clean(name, 32), template, Date.now());
    return { ok: true, room: this.roomPublic(this.roomRow(id)) };
  },

  async roomUpdate(token, { id, name, desc, privacy } = {}) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return this.guestError();
    const r = this.roomRow(id ?? me.id);
    if (!r || r.owner !== me.id) return { ok: false, error: 'Esa sala no es tuya.' };
    if (privacy !== undefined && !PRIVACY.includes(privacy)) return { ok: false, error: 'Opción no válida.' };
    this.sql.exec('UPDATE rooms SET name = ?, descr = ?, privacy = ? WHERE id = ?',
      name !== undefined ? clean(name, 32) : r.name, desc !== undefined ? clean(desc, 140) : r.descr, privacy ?? r.privacy, r.id);
    if (privacy !== undefined && privacy !== r.privacy) await this.roomRecheckOne(r.id);
    return { ok: true, room: this.roomPublic(this.roomRow(r.id)) };
  },

  async roomDelete(token, id) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const r = this.roomRow(id);
    if (!r || r.owner !== me.id) return { ok: false, error: 'Esa sala no es tuya.' };
    // Primero se borra de la tabla (ya nadie entra) y después la sala echa a todos y devuelve los muebles
    this.sql.exec('DELETE FROM rooms WHERE id = ?', r.id);
    this.sql.exec('DELETE FROM hearts WHERE owner = ?', r.id);
    this.sql.exec('UPDATE notes SET room = NULL WHERE room = ?', r.id); // siguen en el muro
    this.sql.exec('DELETE FROM favorites WHERE room = ?', `u-${r.id}`);
    try { await this.env.ROOMS.get(this.env.ROOMS.idFromName(`u-${r.id}`)).destroy(me.id); } catch { /* sala vacía */ }
    return { ok: true, items: this.items(me.id) };
  },

  // ¿Puede este usuario entrar a la sala? (la usa la sala al entrar)
  async canEnterRoom(roomId, userId) {
    const r = this.roomRow(roomId);
    if (!r) return false;
    return this.allowed(userId, r.owner, r.privacy);
  },

  async roomRecheckOne(roomId) {
    try { await this.env.ROOMS.get(this.env.ROOMS.idFromName(`u-${roomId}`)).recheckAccess(); } catch { /* sala dormida o vacía */ }
  },
};
