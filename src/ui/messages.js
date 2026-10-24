import { api } from '../net/api.js';
import { toast } from './toast.js';

// App "Mensajes" del celular: chat 1 a 1 con amigos (aunque estén en otra sala o desconectados).
// Lista de conversaciones → conversación con un amigo, con "Ir allá" si está en otra sala.
// Los mensajes nuevos llegan al instante por la sala (mensaje `dm`); además se revisa cada tanto.

const $ = (id) => document.getElementById(id);
const MAX = 200;

function hora(ts) {
  const d = new Date(ts), hoy = new Date();
  const hm = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoy.toDateString() ? hm : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${hm}`;
}

export function createMessages({ me, room, roomLabel, go, showApp, isOpen, onCount }) {
  const box = $('dm-box');
  let chat = null; // id del amigo con la conversación abierta

  function setCount(n) {
    const el = $('dm-count');
    el.hidden = !n;
    el.textContent = n;
    onCount(n);
  }

  // Cartel de dónde está el amigo y botón para ir
  function whereRow(f) {
    const row = document.createElement('div');
    row.className = 'dm-where';
    const where = document.createElement('span');
    where.textContent = roomLabel(f.room);
    if (f.room) where.className = 'online';
    row.append(where);
    if (f.room && f.room !== room) {
      const b = document.createElement('button');
      b.className = 'act on';
      b.textContent = 'Ir allá';
      b.onclick = () => go(f.room);
      row.append(b);
    }
    return row;
  }

  // El título de la app solo en la lista (en una conversación manda la cabecera con el nombre)
  const title = () => box.parentElement.querySelector('h1');
  async function renderList() {
    chat = null;
    title().hidden = false;
    const r = await api('dms');
    if (!r.ok) { box.innerHTML = ''; return; }
    setCount(r.unread);
    if (chat) return; // abrió una conversación mientras cargaba
    box.innerHTML = '';
    if (!r.conversations.length) {
      box.innerHTML = '<p class="meta">Todavía no tenés mensajes. Para escribirle a alguien, en Amigos apretá "Escribir".</p>';
      return;
    }
    for (const c of r.conversations) {
      const row = document.createElement('button');
      row.className = `dm-conv ${c.unread ? 'new' : ''}`;
      const name = document.createElement('b');
      name.textContent = c.name;
      const last = document.createElement('span');
      last.className = 'meta';
      last.textContent = `${c.last.mine ? 'Vos: ' : ''}${c.last.text}`;
      const when = document.createElement('span');
      when.className = 'meta dm-when';
      when.textContent = c.unread ? `${c.unread} nuevo${c.unread > 1 ? 's' : ''}` : hora(c.last.created);
      row.append(name, when, last);
      row.onclick = () => openChat(c.id);
      box.append(row);
    }
  }

  async function openChat(id) {
    chat = id;
    showApp('mensajes');
    const r = await api(`dm?id=${encodeURIComponent(id)}`);
    if (chat !== id) return;
    if (!r.ok) { toast(r.error); return renderList(); }
    box.innerHTML = '';
    title().hidden = true;
    const head = document.createElement('div');
    head.className = 'dm-head';
    const back = document.createElement('button');
    back.className = 'act';
    back.textContent = '‹ Mensajes';
    back.onclick = renderList;
    const name = document.createElement('b');
    name.textContent = r.friend.name;
    head.append(back, name);
    const list = document.createElement('div');
    list.className = 'dm-list';
    for (const m of r.messages) list.append(bubble(m));
    if (!r.messages.length) list.innerHTML = '<p class="meta">Escribile algo. Si no está conectado, lo lee cuando entre.</p>';
    const form = document.createElement('form');
    form.className = 'dm-form';
    const input = document.createElement('input');
    input.maxLength = MAX;
    input.placeholder = 'Mensaje…';
    input.autocomplete = 'off';
    const send = document.createElement('button');
    send.className = 'act on';
    send.textContent = 'Enviar';
    form.append(input, send);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      const res = await api('dm', { method: 'POST', body: { to: id, text } });
      send.disabled = false;
      if (!res.ok) return toast(res.error);
      input.value = '';
      list.querySelector('p.meta')?.remove();
      list.append(bubble(res.message));
      list.scrollTop = list.scrollHeight;
    };
    // Que las teclas del juego no se disparen mientras escribís
    input.addEventListener('keydown', (e) => e.stopPropagation());
    box.append(head, whereRow(r.friend), list, form);
    list.scrollTop = list.scrollHeight;
    input.focus();
    refreshCount();
  }

  function bubble(m) {
    const el = document.createElement('div');
    el.className = `dm-msg ${m.mine ? 'mine' : ''}`;
    const t = document.createElement('p');
    t.textContent = m.text;
    const w = document.createElement('span');
    w.className = 'meta';
    w.textContent = hora(m.created);
    el.append(t, w);
    return el;
  }

  async function refreshCount() {
    const r = await api('dms');
    if (r.ok) setCount(r.unread);
  }

  // Llegó un mensaje por la sala
  function onMessage({ from, text }) {
    if (chat === from.id && isOpen()) return openChat(from.id); // la tenés abierta: se actualiza (y queda leída)
    refreshCount();
    toast(`💬 ${from.name}: ${text}`, { actions: [{ label: 'Responder', yes: true, onClick: () => openChat(from.id) }], time: 8000 });
  }

  return { renderList, openChat, onMessage, refreshCount, get chat() { return chat; } };
}
