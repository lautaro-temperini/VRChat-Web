// Chat de la sala y comandos (/ayuda, /ir, /bailar…).
import * as THREE from 'three';
import { api } from '../net/api.js';
import { DANCES, PUBLIC_MAPS, ITEMS, CONSUMABLES, FURNITURE } from '../../server/shared.js';
import { G, $, body } from './state.js';

const { ctrl, social, net } = G;

// ---------- Chat ----------
// En celular, con el chat cerrado, se ven solo los últimos mensajes y se desvanecen (style.css: .old)
const FADE_AFTER = 12000;
function pushLine(el) {
  const box = $('messages');
  box.append(el);
  setTimeout(() => el.classList.add('old'), FADE_AFTER);
  while (box.children.length > 60) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
// Dónde estaba quien habló respecto de la cámara: a la izquierda, al medio o a la derecha (decisión 29/10)
const _v = new THREE.Vector3();
function sideOf(id) {
  const r = id && id !== net.id ? G.remotes.get(id) : null;
  if (!r) return id === net.id ? 'center' : 'left'; // yo al medio; el historial al entrar (sin posición), a la izquierda
  r.avatar.root.getWorldPosition(_v);
  _v.applyMatrix4(G.camera.matrixWorldInverse); // x: derecha de la cámara, z negativo: adelante
  const x = _v.z < 0 ? _v.x / -_v.z : Math.sign(_v.x) * 2; // detrás: según de qué lado está
  return x < -0.25 ? 'left' : x > 0.25 ? 'right' : 'center';
}
function addMessage({ name: n, text, id }) {
  const el = document.createElement('div');
  el.className = `msg from-${sideOf(id)}`;
  const b = document.createElement('b');
  b.textContent = n;
  el.append(b, document.createTextNode(text));
  pushLine(el);
}
function system(text) {
  const el = document.createElement('div');
  el.className = 'msg sys';
  el.textContent = text;
  pushLine(el);
}

const input = $('chat-input');
function openChat() {
  if (!G.joined) return;
  document.exitPointerLock?.();
  ctrl.typing = true;
  ctrl.keys.clear();
  body.classList.add('typing');
  G.refreshState();
  input.focus();
}
function closeChat() {
  ctrl.typing = false;
  body.classList.remove('typing');
  input.blur();
  G.refreshState();
}
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text.startsWith('/')) command(text);
  else if (text) net.send({ t: 'chat', text });
  input.value = '';
  closeChat();
};

// Comandos del chat: /ayuda, /salas, /ir …
function command(text) {
  const [cmd, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim().toLowerCase().replace(/^@/, '');
  const friends = social.friends.friends;
  switch (cmd.toLowerCase()) {
    case 'controls':
    case 'controles':
      G.openControls();
      break;
    case 'ayuda':
    case 'help':
      system('Comandos: /controls (teclas) · /salas (ver salas) · /ir museo · /ir mi sala · /ir <amigo> (va a donde está, o a su sala)');
      system('Gestos: /saludar · /aplaudir · /festejar · /señalar · también con la R');
      system(`Bailes (siguen hasta que te movés): /bailar (uno al azar) o /bailar 1 a ${DANCES.length}: ${DANCES.map((d, i) => `${i + 1} ${d}`).join(' · ')}`);
      break;
    case 'saludar':
    case 'aplaudir':
    case 'festejar':
    case 'señalar':
    case 'senalar':
      G.gesture(cmd.toLowerCase().replace('ñ', 'n'));
      break;
    case 'bailar': {
      const n = parseInt(arg, 10);
      G.gesture(`baile${n >= 1 && n <= DANCES.length ? n : 1 + Math.floor(Math.random() * DANCES.length)}`);
      break;
    }
    case 'curador':
    case 'creador': {
      // Solo admins: da o quita el título (curadores fundadores, o quitar Creador)
      if (!arg) return system(`Usá: /${cmd.toLowerCase()} nick`);
      api('title', { method: 'POST', body: { nick: arg, title: cmd.toLowerCase() } }).then((r) => {
        system(r.ok ? `${r.name} ${r.on ? 'ahora es' : 'ya no es'} ${cmd.toLowerCase()}.` : r.error);
      });
      break;
    }
    case 'item': {
      // Solo admins: se da un objeto (por id o por nombre). Sin nada: la lista
      const raw = rest.join(' ').trim();
      const all = [...Object.entries(ITEMS).map(([id, d]) => [id, d.name]), ...Object.entries(CONSUMABLES).map(([id, d]) => [id, d.name]),
        ...Object.entries(FURNITURE).filter(([, d]) => d.special && !d.design).map(([id, d]) => [id, d.name])];
      if (!raw) return system(`Usá: /item <id>. Objetos: ${all.map(([id, n]) => `${id} (${n})`).join(' · ')}`);
      const low = raw.toLowerCase();
      const hit = all.find(([id, n]) => id.toLowerCase() === low || n.toLowerCase() === low);
      api('adminitem', { method: 'POST', body: { type: hit?.[0] ?? raw } }).then((r) => {
        system(r.ok ? `Te diste: ${r.name}. Está en tu mochila.` : r.error);
        if (r.ok) social.loadInventory?.();
      });
      break;
    }
    case 'salas':
      system(`Salas: Museo · ${Object.values(PUBLIC_MAPS).map((m) => m.name).join(' · ')} · Tu sala${friends.length ? ' · ' + friends.map((f) => `Sala de ${f.name}${f.room ? `  (${social.roomLabel(f.room).toLowerCase()})` : ''}`).join(' · ') : ''}`);
      break;
    case 'ir': {
      if (!arg) return system('Usá: /ir museo · /ir plaza · /ir mi sala · /ir <amigo>');
      if (arg === 'museo') return social.go('museo');
      const map = Object.entries(PUBLIC_MAPS).find(([id, m]) => id === arg || m.name.toLowerCase() === arg);
      if (map) return social.go(map[0]);
      if (arg === 'mi sala' || arg === 'casa') return G.account && social.goUser(G.account.id, 'Vos');
      const f = friends.find((x) => x.name.toLowerCase().startsWith(arg) || x.username?.startsWith(arg));
      if (!f) return system(`No encontré a "${arg}" en tus amigos. Agregalo desde su perfil (E sobre su personaje).`);
      if (f.room) social.go(f.room);
      else social.goUser(f.id, f.name);
      break;
    }
    default:
      system(`Comando desconocido: /${cmd}. Escribí /ayuda.`);
  }
}
input.addEventListener('blur', () => { if (ctrl.typing) closeChat(); });
// En celular: cruz para cerrar el chat
$('chat-close').addEventListener('pointerdown', (e) => { e.preventDefault(); closeChat(); });


Object.assign(G, { addMessage, system, openChat, closeChat });
