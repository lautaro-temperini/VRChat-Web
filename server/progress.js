// Progresión: puntos y niveles (privados), insignias (públicas), camino inicial y misiones diarias.
// Se suma a la clase Accounts (comparte la base SQLite), igual que works.js.
//
// Qué suma puntos (cada cosa UNA sola vez: la misma obra o sala no suma dos veces):
//   ver una obra del público expuesta (estando en el Museo) · visitar la sala personal de otro ·
//   que te expongan una obra · curar (verificar o denegar) · asistir a un evento (5 min en un set, uno por sala por día
//   de DJ o show de la consola con más de 5 personas). Los me gusta NO dan puntos.
// Los invitados no suman (no tienen objetos para recibir las recompensas).
//
// Todo entra por progressTrack(userId, acción, ref): lo llaman los enganches de accounts.js,
// works.js y room.js. Nunca tira error (si algo falla, la acción original sigue igual).

import { FIXED_TITLES } from '../src/world/artworks.js';
import { ITEMS, ITEM_RARITY, RARITIES, FURNITURE, CONSUMABLES } from './shared.js';

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// Días según la hora de Argentina (GMT-3): las diarias cambian a las 00:00
const DAY = 86_400_000, ARG = 3 * 3_600_000;
const today = () => Math.floor((Date.now() - ARG) / DAY);

// Puntos de cada cosa
export const POINTS = { obra: 10, sala: 5, expuesta: 100, curada: 15, evento: 50, camino: 20 };
// Nivel N desde 25·N·(N−1) puntos (nivel 2 = 50, 5 = 500, 10 = 2.250, 20 = 9.500). Sin tope.
export const levelStart = (n) => 25 * n * (n - 1);
export const levelOf = (points) => Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * points) / 25)) / 2));

// ---------- Recompensas (datos) ----------
// Objetos al azar dentro de una rareza (lista en shared.js → ITEM_RARITY). Con el editor de salas
// los muebles especiales también están en esa lista: sale cualquiera de la rareza que toca.
export const REWARDS = {
  level: (n) => (n % 10 === 0 ? 'exotico' : n % 5 === 0 ? 'raro' : 'basico'), // cada nivel; raro c/5, exótico c/10
  pathStep: 'basico',            // cada paso del camino inicial
  pathDone: 'raro',              // terminar el camino
  daily: 'basico',               // cada misión diaria
  dailyBonus: { rarity: 'raro', chance: 0.25 }, // completar las 3 diarias del día
};

// Escalones: bronce, plata, oro
const TIERS = ['bronce', 'plata', 'oro'];
export const BADGES = {
  explorador: { name: 'Explorador', icon: '🧭', what: 'obras vistas', steps: [10, 50, 200] },
  trotamundos: { name: 'Trotamundos', icon: '🚪', what: 'salas visitadas', steps: [5, 20, 50] },
  artista: { name: 'Artista', icon: '🎨', what: 'obras expuestas', steps: [1, 5, 20] },
  ojo: { name: 'Ojo crítico', icon: '🔍', what: 'obras curadas', steps: [10, 50, 200] },
  fiestero: { name: 'Fiestero', icon: '🪩', what: 'eventos', steps: [3, 15, 50] },
  querido: { name: 'Querido', icon: '♥', what: 'me gusta recibidos', steps: [25, 100, 500] },
};
// Qué cuenta para cada insignia (tipo guardado en progress_log)
const BADGE_KIND = { explorador: 'obra', trotamundos: 'sala', artista: 'expuesta', ojo: 'curada', fiestero: 'evento' };

// Camino inicial: en orden, una después de otra (solo cuenta el paso que toca)
export const PATH = [
  { id: 'obra', text: 'Mirá tu primera obra con E' },
  { id: 'sala', text: 'Visitá la sala de otra persona (Mapa)' },
  { id: 'gesto', text: 'Hacé un gesto (R)' },
  { id: 'amigo', text: 'Agregá un amigo' },
  { id: 'muro', text: 'Publicá algo en el muro (celular)' },
  { id: 'postular', text: 'Postulá una obra al Museo (atril de la entrada)' },
  { id: 'evento', text: 'Quedate 5 minutos en un set con más de 5 personas' },
];

// Misiones diarias: 3 al azar por día
export const DAILY = {
  obras: { text: 'Mirá 3 obras con E', goal: 3 },
  salas: { text: 'Visitá 2 salas de otras personas', goal: 2 },
  likes: { text: 'Dá 3 me gusta en el muro', goal: 3 },
  corazon: { text: 'Dejale un corazón a una sala', goal: 1 },
  muro: { text: 'Publicá algo en el muro', goal: 1 },
  gestos: { text: 'Hacé 2 gestos', goal: 2 },
  evento: { text: 'Está en un evento (5 min en un set)', goal: 1 },
  curar: { text: 'Curá una obra en el atril del Museo', goal: 1, curators: true },
};
const DAILY_COUNT = 3;
// Acción → misión diaria que avanza
const DAILY_OF = { obra: 'obras', obra_fija: 'obras', sala: 'salas', like: 'likes', corazon: 'corazon', muro: 'muro', gesto: 'gestos', evento: 'evento', curada: 'curar' };

// Curador automático: nivel 8 + 30 obras del público vistas. Se da una sola vez
// (si un admin lo saca, no vuelve solo).
const CURATOR = { level: 8, works: 30 };

export function setupProgress(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      user_id TEXT PRIMARY KEY, points INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1,
      path INTEGER NOT NULL DEFAULT 0, curator_given INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS progress_log (
      user_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, ref)
    );
    CREATE TABLE IF NOT EXISTS daily (
      user_id TEXT NOT NULL, day INTEGER NOT NULL, missions TEXT NOT NULL, bonus INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS daily_refs (
      user_id TEXT NOT NULL, day INTEGER NOT NULL, mission TEXT NOT NULL, ref TEXT NOT NULL,
      PRIMARY KEY (user_id, day, mission, ref)
    );
    CREATE TABLE IF NOT EXISTS badges (
      user_id TEXT NOT NULL, badge TEXT NOT NULL, tier INTEGER NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge)
    );
    CREATE TABLE IF NOT EXISTS progress_news (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS progress_news_user ON progress_news (user_id, seen);
  `);
}

export const progressMethods = {
  progressRow(userId) {
    this.sql.exec('INSERT OR IGNORE INTO progress (user_id) VALUES (?)', userId);
    return this.sql.exec('SELECT * FROM progress WHERE user_id = ?', userId).one();
  },

  progressNews(userId, text, kind = 'info') {
    this.sql.exec('INSERT INTO progress_news (id, user_id, text, kind, created) VALUES (?, ?, ?, ?, ?)', randomHex(8), userId, text, kind, Date.now());
  },

  // Un objeto al azar de esa rareza → inventario: accesorio o mueble especial, todo junto y con
  // repetidos (decisión del 24/10). Devuelve "Nombre (Rareza)"
  progressReward(userId, rarity) {
    const pool = Object.keys(ITEM_RARITY).filter((t) => ITEM_RARITY[t] === rarity && (ITEMS[t] || FURNITURE[t]?.special || CONSUMABLES[t]));
    if (!pool.length) return '';
    const type = pick(pool);
    const def = ITEMS[type] ?? FURNITURE[type] ?? CONSUMABLES[type];
    this.addItem(userId, type, ITEMS[type] ? pick(ITEMS[type].colors) : def.color);
    return `${def.name} (${RARITIES[rarity].name.toLowerCase()})`;
  },

  progressPoints(userId, n) {
    const p = this.progressRow(userId);
    const points = p.points + n;
    const level = levelOf(points);
    this.sql.exec('UPDATE progress SET points = ?, level = ? WHERE user_id = ?', points, Math.max(level, p.level), userId);
    for (let l = p.level + 1; l <= level; l++) {
      const got = this.progressReward(userId, REWARDS.level(l));
      this.progressNews(userId, `¡Subiste a nivel ${l}!${got ? ` Ganaste: ${got}` : ''}`, 'level');
    }
  },

  // ¿Es la primera vez? (la misma obra, sala, evento… suma una sola vez)
  progressOnce(userId, kind, ref) {
    return this.sql.exec('INSERT OR IGNORE INTO progress_log (user_id, kind, ref, created) VALUES (?, ?, ?, ?)', userId, kind, String(ref), Date.now()).rowsWritten > 0;
  },

  progressCount(userId, kind) {
    return this.sql.exec('SELECT COUNT(*) AS n FROM progress_log WHERE user_id = ? AND kind = ?', userId, kind).one().n;
  },

  likesReceived(userId) {
    return this.sql.exec(`SELECT COUNT(*) AS n FROM likes WHERE
      (post_type = 'note' AND post_id IN (SELECT id FROM notes WHERE owner = ?)) OR
      (post_type = 'photo' AND post_id IN (SELECT id FROM photos WHERE owner = ?))`, userId, userId).one().n;
  },

  // Camino inicial: solo avanza el paso que toca
  progressPath(userId, step) {
    const p = this.progressRow(userId);
    if (p.path >= PATH.length || PATH[p.path].id !== step) return;
    this.sql.exec('UPDATE progress SET path = path + 1 WHERE user_id = ?', userId);
    const got = this.progressReward(userId, REWARDS.pathStep);
    this.progressNews(userId, `Camino: "${PATH[p.path].text}" ✓ (+${POINTS.camino} puntos${got ? `, ${got}` : ''})`, 'path');
    this.progressPoints(userId, POINTS.camino);
    if (p.path + 1 === PATH.length) {
      const bonus = this.progressReward(userId, REWARDS.pathDone);
      this.progressNews(userId, `¡Terminaste el camino inicial!${bonus ? ` Ganaste: ${bonus}` : ''}`, 'path');
    }
  },

  // Las 3 diarias de hoy (se sortean la primera vez que se piden)
  dailyToday(userId) {
    const day = today();
    const row = this.sql.exec('SELECT * FROM daily WHERE user_id = ? AND day = ?', userId, day).toArray()[0];
    if (row) return { day, missions: JSON.parse(row.missions), bonus: !!row.bonus };
    const curator = this.isCurator(userId);
    const ids = Object.keys(DAILY).filter((id) => curator || !DAILY[id].curators).sort(() => Math.random() - 0.5).slice(0, DAILY_COUNT);
    const missions = ids.map((id) => ({ id, n: 0, done: false }));
    this.sql.exec('INSERT INTO daily (user_id, day, missions) VALUES (?, ?, ?)', userId, day, JSON.stringify(missions));
    this.sql.exec('DELETE FROM daily WHERE user_id = ? AND day < ?', userId, day - 7);
    this.sql.exec('DELETE FROM daily_refs WHERE user_id = ? AND day < ?', userId, day);
    return { day, missions, bonus: false };
  },

  progressDaily(userId, missionId, ref) {
    const d = this.dailyToday(userId);
    const m = d.missions.find((x) => x.id === missionId);
    if (!m || m.done) return;
    // Lo que se repite en el día no cuenta dos veces (la misma obra, sala, publicación…)
    if (ref != null && !this.sql.exec('INSERT OR IGNORE INTO daily_refs (user_id, day, mission, ref) VALUES (?, ?, ?, ?)', userId, d.day, missionId, String(ref)).rowsWritten) return;
    m.n++;
    if (m.n >= DAILY[missionId].goal) {
      m.done = true;
      const got = this.progressReward(userId, REWARDS.daily);
      this.progressNews(userId, `Misión diaria: "${DAILY[missionId].text}" ✓${got ? ` Ganaste: ${got}` : ''}`, 'daily');
    }
    let bonus = d.bonus;
    if (!bonus && d.missions.every((x) => x.done)) {
      bonus = true;
      const lucky = Math.random() < REWARDS.dailyBonus.chance;
      const got = lucky ? this.progressReward(userId, REWARDS.dailyBonus.rarity) : '';
      this.progressNews(userId, got ? `¡Completaste las diarias de hoy! Premio extra: ${got}` : '¡Completaste las diarias de hoy! Mañana hay más.', 'daily');
    }
    this.sql.exec('UPDATE daily SET missions = ?, bonus = ? WHERE user_id = ? AND day = ?', JSON.stringify(d.missions), bonus ? 1 : 0, userId, d.day);
  },

  // Insignias: si pasó a un escalón nuevo, se guarda (nunca baja) y se avisa
  progressBadges(userId) {
    const row = this.row(userId);
    if (!row || this.isGuest(row)) return;
    const have = new Map(this.sql.exec('SELECT badge, tier FROM badges WHERE user_id = ?', userId).toArray().map((b) => [b.badge, b.tier]));
    for (const [id, def] of Object.entries(BADGES)) {
      const count = id === 'querido' ? this.likesReceived(userId) : this.progressCount(userId, BADGE_KIND[id]);
      const tier = def.steps.filter((s) => count >= s).length; // 0 = ninguna, 1 bronce, 2 plata, 3 oro
      if (tier <= (have.get(id) ?? 0)) continue;
      this.sql.exec('INSERT OR REPLACE INTO badges (user_id, badge, tier, created) VALUES (?, ?, ?, ?)', userId, id, tier, Date.now());
      this.progressNews(userId, `Nueva insignia: ${def.icon} ${def.name} (${TIERS[tier - 1]})`, 'badge');
    }
  },

  progressCurator(userId) {
    const p = this.progressRow(userId);
    if (p.curator_given || p.level < CURATOR.level || this.progressCount(userId, 'obra') < CURATOR.works) return;
    this.sql.exec('UPDATE progress SET curator_given = 1 WHERE user_id = ?', userId);
    if (this.hasTitle(userId, 'curador')) return;
    this.sql.exec('INSERT OR IGNORE INTO titles (user_id, title, created) VALUES (?, ?, ?)', userId, 'curador', Date.now());
    this.notifyData(userId, 'title_curator', userId, {});
    this.progressNews(userId, '¡Ahora sos Curador! Revisás obras en el atril de la entrada del Museo.', 'badge');
  },

  // Punto de entrada de todos los enganches. room: nombre de la sala (para 'sala').
  // Lo nuevo (subiste de nivel…) queda en progress_news: el cliente lo lee con GET progress.
  progressTrack(userId, action, ref = null, room = null) {
    try {
      const row = this.row(userId);
      if (!row || this.isGuest(row)) return;
      switch (action) {
        case 'obra': // obra del público expuesta (validado en progressView)
          if (this.progressOnce(userId, 'obra', ref)) this.progressPoints(userId, POINTS.obra);
          this.progressPath(userId, 'obra');
          break;
        case 'obra_fija': // obras de base del Museo: solo el camino y las diarias, sin puntos
          this.progressPath(userId, 'obra');
          break;
        case 'sala': // salas personales de otros (ni la propia ni el Museo)
          if (!room?.startsWith('u-') || room === `u-${userId}`) return;
          ref = room;
          if (this.progressOnce(userId, 'sala', room)) this.progressPoints(userId, POINTS.sala);
          this.progressPath(userId, 'sala');
          break;
        case 'expuesta':
          if (this.progressOnce(userId, 'expuesta', ref)) this.progressPoints(userId, POINTS.expuesta);
          break;
        case 'curada':
          if (this.progressOnce(userId, 'curada', ref)) this.progressPoints(userId, POINTS.curada);
          break;
        case 'evento':
          if (this.progressOnce(userId, 'evento', ref)) this.progressPoints(userId, POINTS.evento);
          this.progressPath(userId, 'evento');
          break;
        case 'gesto': case 'amigo': case 'muro': case 'postular':
          this.progressPath(userId, action);
          if (action === 'gesto') ref = randomHex(4); // cada gesto cuenta
          if (action === 'muro') ref = null;
          break;
        case 'like': case 'corazon':
          break;
        default:
          return;
      }
      if (DAILY_OF[action]) this.progressDaily(userId, DAILY_OF[action], ref == null ? null : `${action === 'obra_fija' ? 'f:' : ''}${ref}`);
      this.progressBadges(userId);
      this.progressCurator(userId);
    } catch (e) {
      console.error('progressTrack', action, e);
    }
  },

  // Lo mismo, devolviendo lo nuevo para mostrarlo ya (la sala se lo manda al jugador)
  progressTrackNews(userId, action, ref = null, room = null) {
    this.progressTrack(userId, action, ref, room);
    return { news: this.takeNews(userId) };
  },

  takeNews(userId) {
    const rows = this.sql.exec('SELECT id, text, kind FROM progress_news WHERE user_id = ? AND seen = 0 ORDER BY created', userId).toArray();
    this.sql.exec('UPDATE progress_news SET seen = 1 WHERE user_id = ? AND seen = 0', userId);
    this.sql.exec('DELETE FROM progress_news WHERE user_id = ? AND created < ?', userId, Date.now() - 7 * DAY);
    return rows.map((r) => ({ text: r.text, kind: r.kind }));
  },

  // ---------- Rutas ----------

  // Miró una obra con E. Las del público suman si están expuestas y estás en el Museo;
  // las de base solo cuentan para el camino y las diarias.
  async progressView(token, id, fixed) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me) || this.where(me.id) !== 'museo') return { ok: true, news: [] };
    if (id) {
      const w = this.sql.exec("SELECT id FROM works WHERE id = ? AND status = 'expuesta'", String(id)).toArray()[0];
      if (!w) return { ok: true, news: [] };
      return { ok: true, ...this.progressTrackNews(me.id, 'obra', w.id) };
    }
    const key = String(fixed ?? '').slice(0, 60);
    if (!FIXED_TITLES.has(key)) return { ok: true, news: [] }; // solo obras fijas que existen (M6)
    return { ok: true, ...this.progressTrackNews(me.id, 'obra_fija', key) };
  },

  // Todo lo mío (privado): nivel, puntos, camino, diarias, insignias y avisos nuevos
  async progress(token) {
    const me = await this.userFromToken(token);
    if (!me) return { ok: false, error: 'Sesión vencida.' };
    if (this.isGuest(me)) return { ok: true, guest: true };
    const p = this.progressRow(me.id);
    const d = this.dailyToday(me.id);
    const have = new Map(this.sql.exec('SELECT badge, tier FROM badges WHERE user_id = ?', me.id).toArray().map((b) => [b.badge, b.tier]));
    return {
      ok: true,
      level: p.level, points: p.points, from: levelStart(p.level), to: levelStart(p.level + 1),
      path: PATH.map((s, i) => ({ text: s.text, done: i < p.path, current: i === p.path })),
      pathDone: p.path >= PATH.length,
      daily: d.missions.map((m) => ({ text: DAILY[m.id].text, n: Math.min(m.n, DAILY[m.id].goal), goal: DAILY[m.id].goal, done: m.done })),
      dailyBonus: d.bonus,
      badges: Object.entries(BADGES).map(([id, b]) => {
        const count = id === 'querido' ? this.likesReceived(me.id) : this.progressCount(me.id, BADGE_KIND[id]);
        const tier = have.get(id) ?? 0;
        return { id, name: b.name, icon: b.icon, what: b.what, tier, tierName: tier ? TIERS[tier - 1] : null, count, next: b.steps[tier] ?? null };
      }),
      titles: ['curador', 'creador', 'disenador'].filter((t) => this.hasTitle(me.id, t)),
      news: this.takeNews(me.id),
    };
  },

  // Insignias públicas de alguien (se ven en su perfil): el escalón más alto de cada una + títulos
  async badgesOf(id) {
    const row = this.row(String(id ?? ''));
    if (!row) return { ok: false, error: 'No existe ese perfil.' };
    const rows = this.sql.exec('SELECT badge, tier FROM badges WHERE user_id = ?', row.id).toArray();
    return {
      ok: true,
      badges: rows.filter((b) => BADGES[b.badge]).map((b) => ({ id: b.badge, name: BADGES[b.badge].name, icon: BADGES[b.badge].icon, tier: b.tier, tierName: TIERS[b.tier - 1] })),
      titles: ['curador', 'creador', 'disenador'].filter((t) => this.hasTitle(row.id, t)),
    };
  },
};

// ---------- Enganches de la sala (room.js) ----------
// Lo que pasa en la sala se avisa a las cuentas; lo nuevo (subiste de nivel…) le llega al jugador.

export async function roomTrack(room, ws, userId, action, ref = null) {
  try {
    const r = await room.accounts().progressTrackNews(userId, action, ref, await room.roomName());
    if (r?.news?.length) room.send(ws, { t: 'progress', news: r.news });
  } catch { /* la progresión nunca frena a la sala */ }
}

// Eventos: hay evento mientras alguien pasa música de verdad en la cabina (su audio publicado en el servidor
// de audio) con más de 5 personas en la sala (invitados y AFK cuentan). Cuenta haber estado 5 minutos en total.
// Un evento por sala por día (decisión 26/10): otro set en la misma sala el mismo día no suma.
// Se llama en cada alarma de la sala (cada 30 s mientras hay gente).
const EVENT_MIN_PEOPLE = 6, EVENT_TIME = 5 * 60_000;
const shows = new WeakMap(); // sala → { day, last, time: Map(userId → ms), done: Set }

export async function roomEventTick(room) {
  try {
    const now = Date.now();
    const djWs = room.dj ? room.byId(room.dj.id) : null;
    const playing = !!djWs?.deserializeAttachment()?.pubs?.dj;
    const day = Math.floor((now - ARG) / DAY);
    let st = shows.get(room);
    if (!st || st.day !== day) { st = { day, last: now, time: new Map(), done: new Set() }; shows.set(room, st); }
    const dt = Math.min(now - st.last, 60_000);
    st.last = now;
    if (!playing) return;
    const people = new Map(); // userId → una de sus conexiones (puede tener dos pestañas)
    for (const ws of room.joined()) people.set(ws.deserializeAttachment().userId, ws);
    if (people.size < EVENT_MIN_PEOPLE) return;
    const name = await room.roomName();
    for (const [userId, ws] of people) {
      if (st.done.has(userId)) continue;
      const t = (st.time.get(userId) ?? 0) + dt;
      st.time.set(userId, t);
      if (t < EVENT_TIME) continue;
      st.done.add(userId);
      await roomTrack(room, ws, userId, 'evento', `${name}:${day}`);
    }
  } catch { /* nunca frena a la sala */ }
}
