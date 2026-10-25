// Chat de la sala y comandos (/ayuda, /ir, /bailar…).
import { api } from '../net/api.js';
import { DANCES, PUBLIC_MAPS } from '../../server/shared.js';
import { G, $, body } from './state.js';

const { ctrl, social, net } = G;

// ---------- Chat ----------
function pushLine(el) {
  const box = $('messages');
  box.append(el);
  while (box.children.length > 60) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function addMessage({ name: n, text }) {
  const el = document.createElement('div');
  el.className = 'msg';
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
    case 'salas':
      system(`Salas: Museo · ${Object.values(PUBLIC_MAPS).map((m) => m.name).join(' · ')} · Tu sala${friends.length ? ' · ' + friends.map((f) => `Sala de ${f.name}${f.room ? `  (${social.roomLabel(f.room).toLowerCase()})` : ''}`).join(' · ') : ''}`);
      break;
    case 'ir': {
      if (!arg) return system('Usá: /ir museo · /ir plaza · /ir mi sala · /ir <amigo>');
      if (arg === 'museo') return social.go('museo');
      const map = Object.entries(PUBLIC_MAPS).find(([id, m]) => id === arg || m.name.toLowerCase() === arg);
      if (map) return social.go(map[0]);
      if (arg === 'mi sala' || arg === 'casa') return G.account && social.go(`u-${G.account.id}`);
      const f = friends.find((x) => x.name.toLowerCase().startsWith(arg) || x.username?.startsWith(arg));
      if (!f) return system(`No encontré a "${arg}" en tus amigos. Agregalo desde su perfil (E sobre su personaje).`);
      social.go(f.room ?? `u-${f.id}`);
      break;
    }
    default:
      system(`Comando desconocido: /${cmd}. Escribí /ayuda.`);
  }
}
input.addEventListener('blur', () => { if (ctrl.typing) closeChat(); });


Object.assign(G, { addMessage, system, openChat, closeChat });
