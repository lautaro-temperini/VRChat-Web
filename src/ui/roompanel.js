import { toast } from './toast.js';
import { api } from '../net/api.js';

// Panel de la sala (Tab): info de la sala, jugadores conectados y moderación.
// Tres acciones distintas, solo para mí:
// - Mutear: no escucho su voz.
// - Ignorar (guardado en la cuenta): no escucho su voz ni veo sus mensajes en la sala,
//   y no me puede invitar a un grupo de voz.
// - Restringir (guardado en la cuenta): no veo sus publicaciones (muro y fotos).
// - Grupo de voz: quién está, salir y (si lo armaste vos) sacar a alguien.
// - Moderación (dueño de la sala o admin): silenciar, traer, mandar a la entrada,
//   expulsar, banear y habilitar/deshabilitar funciones de la sala.

const $ = (id) => document.getElementById(id);
const REASONS = { acoso: 'Acoso', ilegal: 'Contenido ilegal', plagio: 'Robo de obra', spam: 'Spam', suplantacion: 'Suplantación', otro: 'Otro' };
const SETTINGS = [['chat', 'Chat de texto'], ['voice', 'Chat de voz'], ['screen', 'Compartir pantalla'], ['dj', 'Pasar música (DJ)'], ['artists', 'Consola de artistas'], ['items', 'Soltar objetos']];

function loadSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* sin almacenamiento */ }
}

export function createRoomPanel({ net, rtc, remotes, ui, me, roomTitle, openProfile, groups }) {
  const muted = loadSet('muted');     // userIds
  const ignored = loadSet('ignored'); // userIds ignorados (voz y texto; vive en la cuenta, acá queda una copia)
  const restricted = new Set();        // userIds restringidos (publicaciones; vive en la cuenta)
  let reports = [];
  // Traer de la cuenta los restringidos y los ignorados (y subir los ignorados que estaban solo en este navegador)
  async function syncBlocks() {
    const [b, i] = await Promise.all([api('blocks'), api('ignores')]);
    if (b.ok) {
      restricted.clear();
      for (const x of b.blocks) restricted.add(x.id);
    }
    if (i.ok) {
      const server = new Set(i.ignores);
      for (const id of ignored) if (!server.has(id)) api('ignore', { method: 'POST', body: { id, on: true } });
      for (const id of server) ignored.add(id);
      saveSet('ignored', ignored);
      applyMutes();
    }
    render();
  }
  let room = { settings: {}, mod: false, owner: null, silenced: false };
  let bans = {};
  let timer = null;

  const isIgnored = (userId) => ignored.has(userId);
  const voiceOff = (userId) => muted.has(userId) || ignored.has(userId);

  // Aplicar mutes a las voces que ya están sonando
  function applyMutes() {
    for (const r of remotes.values()) rtc.setUserMuted(r.id, voiceOff(r.userId) || r.silenced);
  }

  function toggle(set, key, userId) {
    const on = !set.has(userId);
    on ? set.add(userId) : set.delete(userId);
    if (key === 'restricted') api('block', { method: 'POST', body: { id: userId, on } });
    else saveSet(key, set);
    if (key === 'ignored') api('ignore', { method: 'POST', body: { id: userId, on } });
    applyMutes();
    render();
  }

  function mod(op, target, extra = {}) { net.send({ t: 'mod', op, target, ...extra }); }

  function confirmMod(label, name, fn) {
    toast(`¿${label} a ${name}?`, { actions: [{ label: 'Sí', yes: true, onClick: fn }, { label: 'No' }] });
  }

  function btn(label, onClick, cls = '') {
    const b = document.createElement('button');
    b.className = `act ${cls}`;
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function row(p, isMe) {
    const el = document.createElement('div');
    el.className = 'player-row';
    const top = document.createElement('div');
    top.className = 'top';
    const name = document.createElement('b');
    name.textContent = isMe ? `${p.name} (vos)` : p.name;
    const tags = document.createElement('span');
    tags.className = 'tags';
    const tag = (text, cls = '') => { const t = document.createElement('span'); t.className = `tag ${cls}`; t.textContent = text; tags.append(t); };
    if (p.mod) tag('Mod', 'mod');
    if (p.afk) tag('AFK', 'afk');
    if (p.talking) tag('Hablando', 'talk');
    if (p.silenced) tag('Silenciado', 'bad');
    if (!isMe && muted.has(p.userId)) tag('Muteado');
    if (!isMe && ignored.has(p.userId)) tag('Ignorado');
    if (!isMe && restricted.has(p.userId)) tag('Restringido');
    if (p.guest) tag('Invitado');
    if (p.group) tag(p.group === groups.mine() ? 'Tu grupo' : 'En grupo', 'group');
    top.append(name, tags);
    el.append(top);
    if (isMe) return el;

    const btns = document.createElement('div');
    btns.className = 'btns';
    btns.append(
      btn('Perfil', () => openProfile(p.remote)),
      btn(muted.has(p.userId) ? 'Desmutear' : 'Mutear', () => toggle(muted, 'muted', p.userId)),
      btn(ignored.has(p.userId) ? 'Dejar de ignorar' : 'Ignorar', () => toggle(ignored, 'ignored', p.userId)),
      btn(restricted.has(p.userId) ? 'Quitar restricción' : 'Restringir', () => toggle(restricted, 'restricted', p.userId)),
    );
    if (room.mod && !p.mod) {
      btns.append(
        btn(p.silenced ? 'Quitar silencio' : 'Silenciar', () => mod('silence', p.id, { v: !p.silenced })),
        btn('Traer', () => mod('bring', p.id)),
        btn('A la entrada', () => mod('spawn', p.id)),
        btn('Expulsar', () => confirmMod('Expulsar', p.name, () => mod('kick', p.id)), 'danger'),
        btn('Banear', () => confirmMod('Banear', p.name, () => mod('ban', p.id)), 'danger'),
      );
    }
    el.append(btns);
    return el;
  }

  // Mi grupo de voz: quiénes están, salir y sacar (solo el que lo armó)
  function renderGroup() {
    const box = $('rp-group');
    box.innerHTML = '';
    const gid = groups.mine();
    const g = gid && groups.all[gid];
    if (!g) return;
    const myId = me()?.id;
    const h = document.createElement('h2');
    h.className = 'sub-h';
    h.textContent = 'Tu grupo de voz (privado)';
    box.append(h);
    for (const userId of g.members) {
      const r = [...remotes.values()].find((x) => x.userId === userId);
      const el = document.createElement('div');
      el.className = 'player-row';
      const top = document.createElement('div');
      top.className = 'top';
      const n = document.createElement('b');
      n.textContent = userId === myId ? `${me()?.name ?? 'Vos'} (vos)` : r?.name ?? 'Fuera de la sala';
      const tags = document.createElement('span');
      tags.className = 'tags';
      if (userId === g.leader) { const t = document.createElement('span'); t.className = 'tag group'; t.textContent = 'Lo armó'; tags.append(t); }
      top.append(n, tags);
      if (userId === myId) top.append(btn('Salir del grupo', () => net.send({ t: 'group', op: 'leave' })));
      else if (g.leader === myId) top.append(btn('Sacar', () => confirmMod('Sacar del grupo', r?.name ?? 'esta persona', () => net.send({ t: 'group', op: 'kick', userId }))));
      el.append(top);
      box.append(el);
    }
  }

  function render() {
    if (!ui.isOpen('roompanel')) return;
    $('rp-title').textContent = roomTitle();
    const count = remotes.size + 1;
    $('rp-meta').textContent = `${count} jugador${count > 1 ? 'es' : ''} conectado${count > 1 ? 's' : ''}${room.mod ? ' · sos moderador de esta sala' : ''}`;

    // Funciones de la sala (solo los moderadores las pueden cambiar)
    const box = $('rp-settings');
    box.innerHTML = '';
    if (!room.mod) {
      // Quien no modera solo lo ve, en una línea (lo apagado, tachado)
      const line = document.createElement('p');
      line.className = 'meta perms';
      line.append('En esta sala: ');
      SETTINGS.forEach(([key, label], i) => {
        const s = document.createElement(room.settings[key] !== false ? 'span' : 's');
        s.textContent = label;
        line.append(...(i ? [' · ', s] : [s]));
      });
      box.append(line);
    }
    const grid = document.createElement('div');
    grid.hidden = !room.mod;
    grid.className = 'toggles';
    for (const [key, label] of SETTINGS) {
      const l = document.createElement('label');
      l.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = room.settings[key] !== false;
      cb.disabled = !room.mod;
      cb.onchange = () => mod('setting', undefined, { key, value: cb.checked });
      const span = document.createElement('span');
      span.textContent = label;
      l.append(cb, span);
      grid.append(l);
    }
    box.append(grid);

    const list = $('rp-players');
    list.innerHTML = '';
    const mine = me();
    list.append(row({ name: mine?.name ?? 'Vos', mod: room.mod, silenced: room.silenced, talking: rtc.talking, group: groups.mine() }, true));
    for (const r of remotes.values()) {
      list.append(row({ id: r.id, userId: r.userId, name: r.name, mod: r.mod, afk: r.afk, talking: r.speaking, silenced: r.silenced, guest: r.guest, group: groups.of(r.userId), remote: r }, false));
    }
    renderGroup();

    const bansBox = $('rp-bans');
    bansBox.innerHTML = '';
    const banned = Object.entries(bans);
    if (room.mod && banned.length) {
      const h = document.createElement('h2');
      h.className = 'sub-h';
      h.textContent = 'Baneados';
      bansBox.append(h);
      for (const [userId, b] of banned) {
        const el = document.createElement('div');
        el.className = 'player-row';
        const top = document.createElement('div');
        top.className = 'top';
        const n = document.createElement('b');
        n.textContent = b.name;
        top.append(n, btn('Desbanear', () => net.send({ t: 'mod', op: 'unban', userId })));
        el.append(top);
        bansBox.append(el);
      }
    }

    // Reportes abiertos (solo admins)
    if (me()?.admin && reports.length) {
      const h = document.createElement('h2');
      h.className = 'sub-h';
      h.textContent = `Reportes (${reports.length})`;
      bansBox.append(h);
      for (const rep of reports) {
        const el = document.createElement('div');
        el.className = 'player-row';
        const top = document.createElement('div');
        top.className = 'top';
        const n = document.createElement('b');
        n.textContent = `${rep.target.name} · ${REASONS[rep.reason] ?? rep.reason}`;
        top.append(n, btn('Resuelto', async () => { const r = await api('reportresolve', { method: 'POST', body: { id: rep.id } }); if (r.ok) { reports = r.reports; render(); } }));
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `Lo reportó ${rep.reporter.name} en ${rep.room || '—'}${rep.detail ? `: "${rep.detail}"` : ''}`;
        el.append(top, meta);
        bansBox.append(el);
      }
    }
  }

  function open() {
    ui.openOverlay('roompanel');
    if (room.mod) net.send({ t: 'mod', op: 'bans' });
    if (me()?.admin) api('reports').then((r) => { if (r.ok) { reports = r.reports; render(); } });
    render();
    clearInterval(timer);
    timer = setInterval(() => (ui.isOpen('roompanel') ? render() : clearInterval(timer)), 1000);
  }

  return {
    open, render, applyMutes, isIgnored, syncBlocks,
    setRoom(r) { room = { ...room, ...r }; render(); },
    setBans(b) { bans = b ?? {}; render(); },
    get info() { return room; },
  };
}
