import { api } from '../net/api.js';
import { toast } from './toast.js';
import { guestGate, lock } from './guest.js';

// El atril de cada sala personal: un libro abierto con las notas del dueño (tipo Twitter).
// - Solo el dueño escribe y borra; los visitantes solo leen.
// - Cada visitante puede dejar UN corazón (cuenta para la sala y para el dueño).

const $ = (id) => document.getElementById(id);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export function createNotes({ ui, onHearts, me }) {
  let ownerId = null;

  async function renderHearts() {
    const h = await api(`hearts?id=${encodeURIComponent(ownerId)}`);
    if (!h.ok) return;
    onHearts?.(h.count);
    $('notes-hearts').textContent = `♥ ${h.count}`;
    const b = $('notes-heart');
    b.hidden = h.self;
    b.disabled = h.given;
    b.textContent = h.given ? 'Ya dejaste tu corazón' : 'Dejar un corazón ♥';
    lock(b, me?.()?.guest);
    b.onclick = async () => {
      if (me?.()?.guest) return guestGate('dejar corazones');
      const r = await api('heart', { method: 'POST', body: { id: ownerId } });
      if (!r.ok) return toast(r.error);
      renderHearts();
    };
  }

  async function renderNotes() {
    const r = await api(`notes?id=${encodeURIComponent(ownerId)}`);
    const list = $('notes-list');
    list.innerHTML = '';
    if (!r.ok) { list.textContent = r.error; return; }
    $('notes-title').textContent = r.owner.room;
    $('notes-sub').textContent = `Notas de ${r.owner.name}`;
    const mine = $('notes').classList.contains('mine');
    if (!r.notes.length) {
      const p = document.createElement('p');
      p.className = 'meta';
      p.textContent = mine ? 'Todavía no escribiste notas. La primera aparece arriba de todo.' : 'Todavía no escribió notas.';
      list.append(p);
    }
    for (const n of r.notes) {
      const el = document.createElement('article');
      el.className = 'note';
      const text = document.createElement('p');
      text.textContent = n.text;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = ago(n.created);
      el.append(text, meta);
      if (mine) {
        const del = document.createElement('button');
        del.className = 'link';
        del.textContent = 'Borrar';
        del.onclick = async () => { await api('notedelete', { method: 'POST', body: { id: n.id } }); renderNotes(); };
        meta.append(' · ', del);
      }
      list.append(el);
    }
  }

  $('notes-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('notes-input');
    const r = await api('note', { method: 'POST', body: { text: input.value } });
    if (!r.ok) return toast(r.error);
    input.value = '';
    $('notes-count').textContent = `0/${input.maxLength}`;
    renderNotes();
  };
  $('notes-input').oninput = (e) => { $('notes-count').textContent = `${e.target.value.length}/${e.target.maxLength}`; };

  return {
    async open(id, isMine) {
      ownerId = id;
      $('notes').classList.toggle('mine', isMine);
      $('notes-list').innerHTML = '';
      ui.openOverlay('notes');
      await Promise.all([renderNotes(), renderHearts()]);
    },
    async hearts(id) {
      const h = await api(`hearts?id=${encodeURIComponent(id)}`);
      if (h.ok) onHearts?.(h.count);
    },
  };
}
