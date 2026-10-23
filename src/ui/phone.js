import { api, photoUrl } from '../net/api.js';
import { renderGallery, openPhoto } from './gallery.js';
import { toast } from './toast.js';
import { guestGate, lock } from './guest.js';

// El celular del jugador: la red social. Inicio = Amigos (conectados + buscador).
// Apps: Muro (tipo Facebook: lo tuyo y de amigos, después "Destacados"; tus notas también
// se leen en el atril de tu sala), Galería (la mía) y Avisos.
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
    // Invitados: pueden leer el muro, pero no publicar ni tener galería
    const guest = !!me()?.guest;
    $('mynotes-form').hidden = guest;
    if (name === 'notas') renderMyNotes();
    if (name === 'galeria' && me()) {
      if (guest) $('phone-gallery').innerHTML = '<div class="guest-note">Los invitados no tienen galería. Creá tu cuenta (Personaje → Crear cuenta) para subir fotos y publicar en el muro.</div>';
      else renderGallery($('phone-gallery'), me().id);
    }
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

  // ---------- Muro (tipo Facebook): lo tuyo y de tus amigos, después "Destacados" ----------
  function post(it) {
    const el = document.createElement('article');
    el.className = 'note post';
    const head = document.createElement('div');
    head.className = 'post-head';
    const who = document.createElement('button');
    who.className = 'link who';
    who.textContent = it.mine ? 'Vos' : it.author.name;
    who.title = it.mine ? '' : `Ir a la sala de ${it.author.name}`;
    if (!it.mine) who.onclick = () => go(`u-${it.author.id}`);
    const when = document.createElement('span');
    when.className = 'meta';
    when.textContent = `${it.type === 'photo' ? 'subió una foto · ' : ''}${ago(it.created)}`;
    head.append(who, when);
    el.append(head);
    if (it.type === 'note') {
      const p = document.createElement('p');
      p.textContent = it.text;
      el.append(p);
    } else {
      const img = document.createElement('img');
      img.className = 'post-photo';
      img.alt = '';
      if (it.w && it.h) img.style.aspectRatio = `${it.w} / ${it.h}`;
      photoUrl(it.id).then((url) => { if (url) img.src = url; });
      img.onclick = () => img.src && openPhoto(img.src);
      el.append(img);
    }
    const foot = document.createElement('div');
    foot.className = 'post-foot';
    const like = document.createElement('button');
    like.className = `like ${it.liked ? 'on' : ''}`;
    const paint = () => { like.textContent = `${it.liked ? '♥' : '♡'} ${it.likes || ''}`.trim(); like.classList.toggle('on', it.liked); };
    paint();
    lock(like, me()?.guest);
    like.onclick = async () => {
      if (me()?.guest) return guestGate('dar me gusta');
      const r = await api('like', { method: 'POST', body: { type: it.type, id: it.id, on: !it.liked } });
      if (!r.ok) return toast(r.error);
      it.liked = r.liked;
      it.likes = r.likes;
      paint();
    };
    foot.append(like);
    if (it.mine) {
      const del = document.createElement('button');
      del.className = 'link';
      del.textContent = 'Borrar';
      del.onclick = () => toast(it.type === 'note' ? '¿Borrar esta nota?' : '¿Borrar esta foto de tu galería?', { actions: [
        { label: 'Borrar', yes: true, onClick: async () => { await api(it.type === 'note' ? 'notedelete' : 'photodelete', { method: 'POST', body: { id: it.id } }); renderFeed(); } },
        { label: 'No' },
      ] });
      foot.append(del);
    }
    el.append(foot);
    return el;
  }

  async function renderFeed() {
    const list = $('mynotes-list');
    const r = await api('feed');
    list.innerHTML = '';
    if (!r.ok) return;
    const mine = r.items.filter((i) => i.section === 'amigos');
    const featured = r.items.filter((i) => i.section === 'destacados');
    if (!mine.length) {
      const p = document.createElement('p');
      p.className = 'meta';
      p.textContent = 'Todavía no hay nada tuyo ni de tus amigos. Escribí algo arriba o subí una foto en Galería.';
      list.append(p);
    }
    for (const it of mine) list.append(post(it));
    if (featured.length) {
      const h = document.createElement('h2');
      h.className = 'feed-h';
      h.textContent = 'Destacados';
      list.append(h);
      for (const it of featured) list.append(post(it));
    }
  }
  const renderMyNotes = renderFeed;
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
