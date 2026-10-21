import { api } from '../net/api.js';
import { renderGallery } from './gallery.js';
import { toast } from './toast.js';

// El celular del jugador: la red social. Inicio = Amigos (conectados + buscador).
// Apps: Notas (las mías, que se leen en el atril de mi sala), Galería (la mía) y Avisos.
// El Mapa NO está acá: tiene su propio botón (decisión del usuario).

const $ = (id) => document.getElementById(id);

const NOTIF_TEXT = {
  friend_request: (n) => `${n} te mandó una solicitud de amistad`,
  friend_accepted: (n) => `${n} aceptó tu solicitud de amistad`,
};

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export function createPhone({ social, me, go }) {
  let app = 'amigos';

  // ---------- Apps ----------
  function show(name) {
    app = name;
    for (const s of document.querySelectorAll('#friends .app')) s.hidden = s.dataset.app !== name;
    for (const b of document.querySelectorAll('.phone-dock [data-app]')) b.classList.toggle('on', b.dataset.app === name);
    if (name === 'notas') renderMyNotes();
    if (name === 'galeria' && me()) renderGallery($('phone-gallery'), me().id);
    if (name === 'avisos') renderNotifications(true);
    if (name === 'amigos') social.refreshFriends();
  }
  for (const b of document.querySelectorAll('.phone-dock [data-app]')) b.onclick = () => show(b.dataset.app);

  // Reloj de la barra de estado
  const tick = () => { $('phone-clock').textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 20_000);

  // ---------- Buscador de gente ----------
  let searchTimer = null;
  const input = $('friend-search');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 300);
  });
  async function search() {
    const box = $('search-results');
    const q = input.value.trim();
    box.innerHTML = '';
    if (q.length < 2) return;
    const r = await api(`search?q=${encodeURIComponent(q)}`);
    if (!r.ok) return;
    box.className = 'flist';
    const h = document.createElement('h2');
    h.textContent = r.results.length ? 'Resultados' : 'No encontramos a nadie con ese nombre';
    box.append(h);
    for (const u of r.results) {
      const row = document.createElement('div');
      row.className = 'friend';
      const who = document.createElement('div');
      who.className = 'who';
      const b = document.createElement('b');
      b.textContent = u.name + (u.username ? ` · @${u.username}` : '');
      const s = document.createElement('span');
      s.textContent = u.room ? 'Conectado' : 'Desconectado';
      if (u.room) s.className = 'online';
      who.append(b, s);
      const act = document.createElement('button');
      act.className = 'act';
      const label = { none: 'Agregar', outgoing: 'Enviada', incoming: 'Aceptar', friends: 'Amigos ✓' }[u.relation];
      act.textContent = label;
      act.disabled = u.relation === 'outgoing' || u.relation === 'friends';
      if (u.relation === 'none' || u.relation === 'incoming') act.classList.add('on');
      act.onclick = async () => {
        const res = u.relation === 'incoming'
          ? await api('friendrespond', { method: 'POST', body: { id: u.id, accept: true } })
          : await api('friendrequest', { method: 'POST', body: { id: u.id } });
        if (!res.ok) return toast(res.error);
        toast(res.relation === 'friends' ? `Ahora sos amigo de ${u.name}.` : `Le mandaste una solicitud a ${u.name}.`);
        search();
        social.refreshFriends();
      };
      const visit = document.createElement('button');
      visit.className = 'act';
      visit.textContent = 'Su sala';
      visit.onclick = () => go(`u-${u.id}`);
      row.append(who, act, visit);
      box.append(row);
    }
  }

  // ---------- Mis notas ----------
  async function renderMyNotes() {
    const list = $('mynotes-list');
    if (!me()) return;
    const r = await api(`notes?id=${encodeURIComponent(me().id)}`);
    list.innerHTML = '';
    if (!r.ok) return;
    if (!r.notes.length) list.innerHTML = '<p class="meta">Todavía no escribiste notas.</p>';
    for (const n of r.notes) {
      const el = document.createElement('article');
      el.className = 'note';
      const p = document.createElement('p');
      p.textContent = n.text;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = ago(n.created);
      const del = document.createElement('button');
      del.className = 'link';
      del.textContent = 'Borrar';
      del.onclick = async () => { await api('notedelete', { method: 'POST', body: { id: n.id } }); renderMyNotes(); };
      meta.append(' · ', del);
      el.append(p, meta);
      list.append(el);
    }
  }
  $('mynotes-form').onsubmit = async (e) => {
    e.preventDefault();
    const t = $('mynotes-input');
    const r = await api('note', { method: 'POST', body: { text: t.value } });
    if (!r.ok) return toast(r.error);
    t.value = '';
    $('mynotes-count').textContent = `0/${t.maxLength}`;
    renderMyNotes();
  };
  $('mynotes-input').oninput = (e) => { $('mynotes-count').textContent = `${e.target.value.length}/${e.target.maxLength}`; };

  // ---------- Avisos ----------
  function setBadge(n) {
    for (const id of ['notif-count', 'friends-count']) {
      const el = $(id);
      if (!el) continue;
      el.hidden = !n;
      el.textContent = n;
    }
  }
  async function renderNotifications(markSeen = false) {
    const r = await api('notifications');
    if (!r.ok) return;
    setBadge(markSeen ? 0 : r.unseen);
    const list = $('notif-list');
    list.innerHTML = '';
    if (!r.items.length) list.innerHTML = '<p class="meta">No tenés avisos.</p>';
    for (const n of r.items) {
      const el = document.createElement('div');
      el.className = `notif ${n.seen ? '' : 'new'}`;
      const text = document.createElement('p');
      text.textContent = (NOTIF_TEXT[n.type] ?? (() => 'Aviso'))(n.from?.name ?? 'Alguien');
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = ago(n.created);
      el.append(text, meta);
      list.append(el);
    }
    if (markSeen && r.unseen) await api('notificationsseen', { method: 'POST' });
  }

  return {
    open() { show(app); },
    refreshBadge: () => renderNotifications(false),
  };
}
