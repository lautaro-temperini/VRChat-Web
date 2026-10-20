import { toast } from './toast.js';

// Panel de la sala (Tab): info de la sala, jugadores conectados y moderación.
// - Mutear (solo para mí): no escucho su voz.
// - Ignorar (solo para mí): no escucho su voz ni veo sus mensajes.
// - Moderación (dueño de la sala o admin): silenciar, traer, mandar a la entrada,
//   expulsar, banear y habilitar/deshabilitar funciones de la sala.

const $ = (id) => document.getElementById(id);
const SETTINGS = [['chat', 'Chat de texto'], ['voice', 'Chat de voz'], ['screen', 'Compartir pantalla'], ['dj', 'Pasar música (DJ)'], ['items', 'Soltar objetos']];

function loadSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set(); }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* sin almacenamiento */ }
}

export function createRoomPanel({ net, rtc, remotes, ui, me, roomTitle, openProfile }) {
  const muted = loadSet('muted');     // userIds
  const ignored = loadSet('ignored'); // userIds
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
    set.has(userId) ? set.delete(userId) : set.add(userId);
    saveSet(key, set);
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
    top.append(name, tags);
    el.append(top);
    if (isMe) return el;

    const btns = document.createElement('div');
    btns.className = 'btns';
    btns.append(
      btn('Perfil', () => openProfile(p.remote)),
      btn(muted.has(p.userId) ? 'Desmutear' : 'Mutear', () => toggle(muted, 'muted', p.userId)),
      btn(ignored.has(p.userId) ? 'Dejar de ignorar' : 'Ignorar', () => toggle(ignored, 'ignored', p.userId)),
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

  function render() {
    if (!ui.isOpen('roompanel')) return;
    $('rp-title').textContent = roomTitle();
    const count = remotes.size + 1;
    $('rp-meta').textContent = `${count} jugador${count > 1 ? 'es' : ''} conectado${count > 1 ? 's' : ''}${room.mod ? ' · sos moderador de esta sala' : ''}`;

    // Funciones de la sala (solo los moderadores las pueden cambiar)
    const box = $('rp-settings');
    box.innerHTML = '';
    const grid = document.createElement('div');
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
    list.append(row({ name: mine?.name ?? 'Vos', mod: room.mod, silenced: room.silenced, talking: rtc.talking }, true));
    for (const r of remotes.values()) {
      list.append(row({ id: r.id, userId: r.userId, name: r.name, mod: r.mod, afk: r.afk, talking: r.speaking, silenced: r.silenced, remote: r }, false));
    }

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
  }

  function open() {
    ui.openOverlay('roompanel');
    if (room.mod) net.send({ t: 'mod', op: 'bans' });
    render();
    clearInterval(timer);
    timer = setInterval(() => (ui.isOpen('roompanel') ? render() : clearInterval(timer)), 1000);
  }

  return {
    open, render, applyMutes, isIgnored,
    setRoom(r) { room = { ...room, ...r }; render(); },
    setBans(b) { bans = b ?? {}; render(); },
    get info() { return room; },
  };
}
