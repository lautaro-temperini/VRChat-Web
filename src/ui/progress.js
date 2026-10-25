import { api } from '../net/api.js';
import { toast } from './toast.js';
import './progress.css';

// Títulos (solo reconocimiento): cómo se ven en el progreso y en el perfil
const TITLE_BADGES = { curador: { icon: '🏛️', name: 'Curador' }, creador: { icon: '✒️', name: 'Creador' }, disenador: { icon: '🧩', name: 'Diseñador' } };

// Progresión en el cliente:
// - Barrita de nivel en el HUD (arriba a la izquierda). Tocándola se abre la app.
// - App "Progreso" en el celular: nivel y puntos (privado), camino inicial, diarias e insignias.
// - Avisos cortos al subir de nivel, completar misiones o ganar insignias.
// - Insignias públicas en el perfil de otros (E sobre alguien).
// Todo se calcula en el servidor (server/progress.js); acá solo se muestra.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function createProgress({ net, me, openPhone }) {
  let state = null;
  let timer = null;

  // ---------- Barrita del HUD ----------
  const bar = el('button', 'lvlbar');
  bar.hidden = true;
  bar.title = 'Tu progreso (solo lo ves vos)';
  bar.innerHTML = '<b class="lv"></b><span class="track"><span class="fill"></span></span>';
  $('hud').append(bar);
  bar.onclick = () => open();

  // ---------- App del celular ----------
  const app = el('section', 'app');
  app.dataset.app = 'progreso';
  app.hidden = true;
  app.innerHTML = '<h1 class="display">Progreso</h1><div class="progress-app"></div>';
  document.querySelector('#friends .phone-screen').append(app);
  const dockBtn = el('button');
  dockBtn.dataset.app = 'progreso';
  dockBtn.title = 'Progreso';
  dockBtn.innerHTML = '⭐<span>Progreso</span>';
  const dock = document.querySelector('#friends .phone-dock');
  dock.insertBefore(dockBtn, dock.querySelector('[data-close-panel]'));
  // El celular cambia de app con su propio botón; acá se hace lo mismo para la nueva
  dockBtn.addEventListener('click', () => showApp());

  function showApp() {
    for (const s of document.querySelectorAll('#friends .app')) s.hidden = s !== app;
    for (const b of document.querySelectorAll('.phone-dock [data-app]')) b.classList.toggle('on', b === dockBtn);
    render();
    refresh();
  }

  async function open() {
    await openPhone();
    showApp();
  }

  function paintBar() {
    const guest = !state || state.guest;
    bar.hidden = guest;
    if (guest) return;
    bar.querySelector('.lv').textContent = `Nv ${state.level}`;
    const pct = Math.min(100, Math.max(0, ((state.points - state.from) / (state.to - state.from)) * 100));
    bar.querySelector('.fill').style.width = `${pct}%`;
  }

  function render() {
    const box = app.querySelector('.progress-app');
    box.innerHTML = '';
    if (!state) { box.append(el('p', 'meta', 'Cargando…')); return; }
    if (state.guest) {
      box.append(el('div', 'guest-note', 'Los invitados no suman progreso. Creá tu cuenta (Personaje → Crear cuenta) para subir de nivel, ganar insignias y objetos.'));
      return;
    }
    // Nivel (privado)
    const lvl = el('div', 'pg-level');
    const toNext = state.to - state.points;
    lvl.append(el('b', 'pg-num', state.level), el('div', 'pg-lvtext'));
    lvl.querySelector('.pg-lvtext').append(
      el('span', null, `Nivel ${state.level} · ${state.points} puntos`),
      el('span', 'track big', null),
      el('span', 'meta', `Faltan ${toNext} para el nivel ${state.level + 1} · Solo lo ves vos`),
    );
    const fill = el('span', 'fill');
    fill.style.width = `${Math.min(100, ((state.points - state.from) / (state.to - state.from)) * 100)}%`;
    lvl.querySelector('.track').append(fill);
    box.append(lvl);

    // Camino inicial
    if (!state.pathDone) {
      box.append(el('h2', 'pg-h', 'Para empezar'));
      const list = el('ol', 'pg-list');
      for (const s of state.path) {
        const li = el('li', s.done ? 'done' : s.current ? 'current' : 'later', s.done || s.current ? s.text : '…');
        list.append(li);
      }
      box.append(list);
    }

    // Diarias
    box.append(el('h2', 'pg-h', 'Misiones de hoy'));
    const daily = el('ul', 'pg-list');
    for (const m of state.daily) {
      const li = el('li', m.done ? 'done' : 'current', m.text);
      if (m.goal > 1) li.append(el('span', 'meta', ` ${m.n}/${m.goal}`));
      daily.append(li);
    }
    box.append(daily);
    box.append(el('p', 'meta', state.dailyBonus ? '¡Completaste las de hoy! Mañana hay nuevas (00:00).' : 'Cada una da un objeto. Completá las 3 para una chance de un objeto raro.'));

    // Insignias (públicas)
    box.append(el('h2', 'pg-h', 'Insignias (se ven en tu perfil)'));
    const grid = el('div', 'pg-badges');
    for (const t of state.titles) grid.append(badgeEl({ ...TITLE_BADGES[t], title: true }));
    for (const b of state.badges) {
      const e = badgeEl(b);
      e.append(el('span', 'meta', b.next ? `${b.count}/${b.next} ${b.what}` : `${b.count} ${b.what}`));
      grid.append(e);
    }
    box.append(grid);
  }

  function badgeEl(b) {
    const e = el('div', `pg-badge ${b.title ? 'title' : b.tierName ?? 'none'}`);
    e.append(el('span', 'ico', b.icon), el('b', null, b.name));
    if (b.tierName) e.append(el('span', 'tier', b.tierName));
    return e;
  }

  function showNews(news) {
    for (const n of news ?? []) toast(n.kind === 'level' ? `⭐ ${n.text}` : n.text, { time: 6000 });
  }

  async function refresh() {
    if (!me()) return;
    const r = await api('progress');
    if (!r.ok) return;
    state = r;
    showNews(r.news);
    paintBar();
    if (!app.hidden) render();
  }

  // La sala avisa lo que pasa ahí (gestos, salas, eventos) apenas pasa
  net.on('progress', (m) => { showNews(m.news); refresh(); });

  return {
    // Al entrar a la sala: primera lectura y después cada 45 s (me gusta, muro, curar… llegan así)
    start() {
      refresh();
      clearInterval(timer);
      timer = setInterval(refresh, 45_000);
    },
    refresh,
    open,
    // Miró una obra con E: del público (id) o de base del Museo (título)
    async viewed(item) {
      if (!me() || me().guest || !item?.info) return;
      const body = item.work?.id ? { id: item.work.id } : { fixed: item.info.title };
      const r = await api('progressview', { method: 'POST', body });
      if (r.ok && r.news?.length) { showNews(r.news); refresh(); }
    },
    // Insignias públicas en el perfil de alguien
    async profileBadges(userId) {
      let box = $('profile-badges');
      if (!box) {
        box = el('div', 'pg-badges small');
        box.id = 'profile-badges';
        $('profile-since').after(box);
      }
      box.innerHTML = '';
      if (!userId) return;
      const r = await api(`badges?id=${encodeURIComponent(userId)}`);
      if (!r.ok) return;
      for (const t of r.titles) box.append(badgeEl({ ...TITLE_BADGES[t], title: true }));
      for (const b of r.badges) box.append(badgeEl(b));
    },
  };
}
