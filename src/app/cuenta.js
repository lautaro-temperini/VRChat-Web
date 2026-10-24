// Cuentas: pantalla de ingreso (invitado, mail o nickname, registro, Google y Discord) y el editor
// de personaje (básico con muestras, avanzado con RGB). Acá viven el nombre, la bio y el look propios.
import { api, session } from '../net/api.js';
import { DEFAULT_LOOK, LOOK_OPTIONS } from '../player/avatar.js';
import { colorPicker } from '../ui/colorpicker.js';
import { setRegister } from '../ui/guest.js';
import { BODY_TYPES } from '../../server/shared.js';
import { G, $, body } from './state.js';

let look = { ...DEFAULT_LOOK };
let name = '';
let bio = '';

function setLook(next) {
  look = next;
  G.me.setLook(look);
  G.fpArms.syncLook();
}

// ---------- Pantalla de entrada (invitado / login / registro) ----------
const authEl = $('auth');
function showAuth(tab, upgrade = false) {
  authEl.dataset.tab = tab;
  if (upgrade) authEl.dataset.upgrade = ''; else delete authEl.dataset.upgrade;
  for (const b of authEl.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  $('auth-submit').textContent = { guest: 'Entrar como invitado', login: 'Entrar', register: 'Crear cuenta', nick: 'Listo' }[tab];
  $('auth-pass').autocomplete = tab === 'register' ? 'new-password' : 'current-password';
  $('auth-user-label').textContent = tab === 'login' ? 'Mail o nickname' : 'Nickname';
  $('auth-user').placeholder = tab === 'login' ? 'vos@mail.com o tu_nick' : 'tu_nick';
  $('auth-error').textContent = '';
  G.openOverlay('auth');
  setTimeout(() => $(tab === 'guest' ? 'auth-name' : tab === 'register' ? 'auth-email' : 'auth-user').focus(), 50);
}
// Condiciones de uso (se abren desde la casilla de +18)
$('open-terms').onclick = (e) => { e.preventDefault(); $('terms').classList.add('show'); };
$('close-terms').onclick = () => $('terms').classList.remove('show');
for (const b of authEl.querySelectorAll('.tab')) b.onclick = () => showAuth(b.dataset.tab, 'upgrade' in authEl.dataset);
$('auth-cancel').onclick = () => openEditor();

// Ingresar con Google o Discord: se va a su página y vuelve con #login=<código de un solo uso>
for (const b of authEl.querySelectorAll('.oauth-btn')) {
  b.onclick = async () => {
    b.disabled = true;
    if (G.joined) await saveProfile(); // si era invitado, su personaje pasa a la cuenta
    const r = await api('oauthstart', { method: 'POST', body: { provider: b.dataset.provider, origin: location.origin } });
    if (!r.ok) { b.disabled = false; $('auth-error').textContent = r.error; return; }
    location.href = r.url;
  };
}
async function finishOAuth() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('login') && !h.has('loginerror')) return false;
  history.replaceState(null, '', location.pathname + location.search); // saco el código de la dirección
  if (h.has('loginerror')) { showAuth('login'); $('auth-error').textContent = h.get('loginerror'); return true; }
  const r = await api('oauthfinish', { method: 'POST', body: { code: h.get('login') } });
  if (!r.ok) { showAuth('login'); $('auth-error').textContent = r.error; return true; }
  session.token = r.token;
  useAccount(r.user);
  if (r.needsNick) {
    // Cuenta nueva: falta el nickname (y aceptar +18 si no lo había hecho)
    if (r.needsTerms) authEl.dataset.terms = ''; else delete authEl.dataset.terms;
    showAuth('nick');
    $('auth-user').value = '';
  } else G.join();
  return true;
}

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const tab = authEl.dataset.tab;
  const btn = $('auth-submit');
  btn.disabled = true;
  let r;
  if (tab === 'guest') {
    r = await api('guest', { method: 'POST', body: { name: $('auth-name').value, look, terms: $('auth-terms').checked } });
  } else if (tab === 'nick') {
    r = await api('oauthnick', { method: 'POST', body: { nick: $('auth-user').value, terms: $('auth-terms').checked } });
  } else if (tab === 'login') {
    r = await api('login',{ method: 'POST', body: { login: $('auth-user').value, password: $('auth-pass').value } });
  } else {
    r = await api('register', { method: 'POST', body: { email: $('auth-email').value, nick: $('auth-user').value, password: $('auth-pass').value, look, terms: $('auth-terms').checked } });
  }
  btn.disabled = false;
  $('auth-pass').value = '';
  if (!r.ok) { $('auth-error').textContent = r.error; return; }

  if (G.joined) {
    // Ya estaba en la sala: o convirtió su invitado en cuenta, o cambió de cuenta
    if (G.account && r.user.id === G.account.id) { G.account = r.user; openEditor(); }
    else location.reload();
    return;
  }
  useAccount(r.user);
  if (tab === 'login') { G.closeOverlays(); G.join(); } else openEditor(); // cuenta nueva: primero el personaje
};

function useAccount(user) {
  G.account = user;
  name = user.name;
  bio = user.bio ?? '';
  setLook({ ...DEFAULT_LOOK, ...user.look });
  G.setEquip(user.equip);
}

// El botón "Crear cuenta" de los avisos para invitados
setRegister(async () => { G.closeOverlays(); await saveProfile(); showAuth('register', true); });

function renderAccount() {
  const el = $('account');
  el.innerHTML = '';
  const text = document.createElement('span');
  const btn = document.createElement('button');
  if (G.account?.username) {
    text.append('Cuenta: ', Object.assign(document.createElement('b'), { textContent: `@${G.account.username}` }));
    btn.textContent = 'Cerrar sesión';
    btn.onclick = async () => { await api('logout', { method: 'POST' }); session.token = null; location.reload(); };
  } else {
    text.textContent = 'Estás como invitado.';
    btn.textContent = 'Crear cuenta';
    btn.onclick = async () => { await saveProfile(); showAuth('register', true); };
  }
  el.append(text, btn);
}

// ---------- Editor de personaje (capa 1) ----------
const GROUPS = [
  ['body', 'Cuerpo'], ['skin', 'Piel'], ['eyes', 'Ojos'], ['hairStyle', 'Peinado'], ['beard', 'Barba'], ['hair', 'Color de pelo'],
  ['top', 'Arriba'], ['shirt', 'Color de remera / buzo'], ['pants', 'Pantalón'], ['shoes', 'Zapatillas'],
];
const CHIP_LABELS = { masc: 'masculino', fem: 'femenino', false: 'sin barba', true: 'con barba' };
// Tipo de cuerpo del básico: el que coincide con los deslizadores del avanzado (si no, ninguno)
const bodyTypeOf = (L) => Object.keys(BODY_TYPES).find((k) => Math.abs(BODY_TYPES[k].weight - L.weight) < 0.005 && Math.abs(BODY_TYPES[k].muscle - L.muscle) < 0.005);
function swatchGroup(title, values, isSel, label, pick) {
  const group = document.createElement('div');
  group.className = 'group';
  group.innerHTML = `<h2>${title}</h2>`;
  const row = document.createElement('div');
  row.className = 'swatches';
  for (const value of values) {
    const b = document.createElement('button');
    if (String(value).startsWith('#')) { b.className = 'swatch'; b.style.background = value; b.title = value; }
    else { b.className = 'chip'; b.textContent = label(value); }
    if (isSel(value)) b.classList.add('sel');
    b.onclick = () => { pick(value); renderSwatches(); };
    row.append(b);
  }
  group.append(row);
  return group;
}
function renderSwatches() {
  const root = $('swatches');
  root.innerHTML = '';
  for (const [key, title] of GROUPS) {
    // Un color elegido en el avanzado que no está entre las muestras se ve primero, marcado
    const values = String(look[key]).startsWith('#') && !LOOK_OPTIONS[key].includes(look[key]) ? [look[key], ...LOOK_OPTIONS[key]] : LOOK_OPTIONS[key];
    root.append(swatchGroup(title, values, (v) => look[key] === v, (v) => CHIP_LABELS[v] ?? v, (v) => setLook({ ...look, [key]: v })));
    if (key === 'body') {
      const type = bodyTypeOf(look);
      root.append(swatchGroup('Tipo de cuerpo', Object.keys(BODY_TYPES), (v) => v === type, (v) => BODY_TYPES[v].name,
        (v) => setLook({ ...look, weight: BODY_TYPES[v].weight, muscle: BODY_TYPES[v].muscle })));
    }
  }
}
// Avanzado: selector RGB completo por color (uno abierto a la vez)
let openRgb = null;
function renderAdvanced() {
  $('weight').value = look.weight;
  $('muscle').value = look.muscle;
  const root = $('rgb-colors');
  root.innerHTML = '';
  for (const [key, title] of GROUPS) {
    if (!String(look[key]).startsWith('#')) continue;
    const row = document.createElement('button');
    row.className = 'rgb-row';
    row.innerHTML = `<span class="swatch" style="background:${look[key]}"></span>${title}<code>${look[key]}</code>`;
    row.onclick = () => { openRgb = openRgb === key ? null : key; renderAdvanced(); };
    root.append(row);
    if (openRgb === key) {
      root.append(colorPicker(look[key], (hex) => {
        setLook({ ...look, [key]: hex });
        row.firstElementChild.style.background = hex;
        row.lastElementChild.textContent = hex;
      }));
    }
  }
}
$('look-tabs').onclick = (e) => {
  const tab = e.target.closest('[data-ltab]')?.dataset.ltab;
  if (!tab) return;
  for (const b of $('look-tabs').children) b.classList.toggle('active', b.dataset.ltab === tab);
  for (const el of $('editor').querySelectorAll(':scope > [data-ltab]')) el.hidden = el.dataset.ltab !== tab;
  if (tab === 'basic') renderSwatches(); else renderAdvanced();
};
for (const key of ['height', 'weight', 'muscle']) {
  $(key).oninput = (e) => {
    setLook({ ...look, [key]: Number(e.target.value) });
    if (key === 'height') $('height-val').textContent = `${look.height.toFixed(2)} m`;
  };
}

function openEditor() {
  if (!G.account) return;
  $('name').value = name;
  $('bio').value = bio;
  $('height').value = look.height;
  $('height-val').textContent = `${look.height.toFixed(2)} m`;
  $('btn-enter').textContent = G.joined ? 'Guardar' : 'Entrar al museo';
  renderSwatches();
  renderAdvanced();
  renderAccount();
  G.openOverlay('editing');
  G.ctrl.showcase = G.joined; // vitrina hasta que el personaje se mueva
}

async function saveProfile() {
  name = $('name').value.trim().slice(0, 20) || 'Visitante';
  bio = $('bio').value.trim().slice(0, 280);
  const r = await api('me', { method: 'PUT', body: { name, look, bio } });
  if (r.ok) G.account = r.user;
}

async function closeEditor() {
  G.closeOverlays();
  await saveProfile();
  if (!G.joined) G.join();
  else G.net.send({ t: 'look', name, look });
}
$('btn-look').onclick = () => (body.classList.contains('editing') ? closeEditor() : openEditor());
$('btn-enter').onclick = () => closeEditor();
$('name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.stopPropagation(); // que el mismo Enter no abra el chat
  closeEditor();
});


Object.assign(G, { showAuth, finishOAuth, useAccount, openEditor, closeEditor, saveProfile });
