// Mensajes privados entre amigos (chat 1 a 1). Se mezclan en Accounts como los del Museo.
// - Solo entre amigos; si el otro te ignoró o te restringió, no le llega.
// - Hasta 200 caracteres, con el mismo antiflood que el chat de la sala.
// - Se guardan (el otro los lee cuando entra): los últimos 50 de cada conversación.
// - Si el amigo está conectado, la sala donde está se lo entrega al instante (mensaje `dm`).

const DM_MAX = 200, DM_KEEP = 50;
const FLOOD_MAX = 5, FLOOD_WINDOW = 10_000, REPEAT_WINDOW = 30_000;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export function setupMessages(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, sender TEXT NOT NULL,
      text TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS messages_pair ON messages (a, b, created);
    CREATE INDEX IF NOT EXISTS messages_unseen ON messages (sender, seen);
  `);
}

const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((v) => v.toString(16).padStart(2, '0')).join('');

export const messagesMethods = {
  // ¿El otro me bloqueó (ignorar o restringir)?
  dmBlocked(from, to) {
    return this.sql.exec('SELECT 1 FROM ignores WHERE user_id = ? AND ignored_id = ?', to, from).toArray().length > 0
      || this.sql.exec('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?', to, from).toArray().length > 0;
  },

  async dmSend(token, to, text) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return this.guestError();
    to = String(to ?? '');
    text = clean(text).slice(0, DM_MAX);
    if (!text) return { ok: false, error: 'Escribí algo.' };
    if (to === me.id || this.relation(me.id, to) !== 'friends') return { ok: false, error: 'Solo podés escribirles a tus amigos.' };
    // Antiflood (en memoria: alcanza para frenar a alguien que manda de a montones)
    const now = Date.now();
    this.dmTimes ??= new Map();
    const recent = (this.dmTimes.get(me.id) ?? []).filter((t) => now - t.at < Math.max(FLOOD_WINDOW, REPEAT_WINDOW));
    if (recent.filter((t) => now - t.at < FLOOD_WINDOW).length >= FLOOD_MAX) return { ok: false, error: 'Estás mandando mensajes muy rápido. Esperá unos segundos.' };
    if (recent.some((t) => t.to === to && t.text === text.toLowerCase() && now - t.at < REPEAT_WINDOW)) return { ok: false, error: 'Ya mandaste ese mensaje.' };
    recent.push({ at: now, to, text: text.toLowerCase() });
    this.dmTimes.set(me.id, recent);

    const msg = { id: rid(), sender: me.id, text, created: now };
    // Si te bloqueó, para vos se manda igual (no se entera), pero a él no le llega
    if (this.dmBlocked(me.id, to)) return { ok: true, message: { ...msg, mine: true } };
    const [a, b] = pair(me.id, to);
    this.sql.exec('INSERT INTO messages (id, a, b, sender, text, created) VALUES (?, ?, ?, ?, ?, ?)', msg.id, a, b, me.id, text, now);
    this.sql.exec(`DELETE FROM messages WHERE a = ? AND b = ? AND id NOT IN
      (SELECT id FROM messages WHERE a = ? AND b = ? ORDER BY created DESC LIMIT ?)`, a, b, a, b, DM_KEEP);
    // Entrega al instante si está conectado en alguna sala
    const room = this.where(to);
    if (room) {
      try {
        const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(room));
        await stub.pushToUser(to, { t: 'dm', from: { id: me.id, name: me.name }, text, created: now });
      } catch { /* lo ve igual al abrir el celular */ }
    }
    return { ok: true, message: { ...msg, mine: true } };
  },

  // Conversaciones: mis amigos con el último mensaje y cuántos no leí
  async dmList(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    const rows = this.sql.exec(`
      SELECT m.* FROM messages m
      JOIN (SELECT a, b, MAX(created) AS last FROM messages WHERE a = ? OR b = ? GROUP BY a, b) l
        ON m.a = l.a AND m.b = l.b AND m.created = l.last
      ORDER BY m.created DESC`, me.id, me.id).toArray();
    const unread = new Map(this.sql.exec(`SELECT sender, COUNT(*) AS n FROM messages
      WHERE (a = ? OR b = ?) AND sender != ? AND seen = 0 GROUP BY sender`, me.id, me.id, me.id).toArray().map((r) => [r.sender, r.n]));
    const out = [];
    for (const r of rows) {
      const other = r.a === me.id ? r.b : r.a;
      if (this.relation(me.id, other) !== 'friends') continue;
      const u = this.row(other);
      if (!u) continue;
      out.push({ id: other, name: u.name, room: this.where(other), last: { text: r.text, mine: r.sender === me.id, created: r.created }, unread: unread.get(other) ?? 0 });
    }
    return { ok: true, conversations: out, unread: [...unread.entries()].filter(([id]) => this.relation(me.id, id) === 'friends').reduce((s, [, n]) => s + n, 0) };
  },

  // Una conversación (y la marca como leída)
  async dmThread(token, other) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    other = String(other ?? '');
    if (this.relation(me.id, other) !== 'friends') return { ok: false, error: 'Solo podés escribirles a tus amigos.' };
    const [a, b] = pair(me.id, other);
    const rows = this.sql.exec('SELECT * FROM messages WHERE a = ? AND b = ? ORDER BY created DESC LIMIT ?', a, b, DM_KEEP).toArray().reverse();
    this.sql.exec('UPDATE messages SET seen = 1 WHERE a = ? AND b = ? AND sender = ? AND seen = 0', a, b, other);
    const u = this.row(other);
    return { ok: true, friend: { id: other, name: u?.name ?? '', room: this.where(other) }, messages: rows.map((r) => ({ id: r.id, text: r.text, created: r.created, mine: r.sender === me.id })) };
  },
};
