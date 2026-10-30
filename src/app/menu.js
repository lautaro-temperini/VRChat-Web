// Menú (Esc): General · Audio · Controles · Cuenta. Las preferencias de audio y la sensibilidad se guardan
// en el navegador.
import { api, session } from '../net/api.js';
import { G, $, body, pref } from './state.js';

// ---------- Menú (Esc): General · Audio · Controles · Cuenta ----------
const audioPrefs = { voiceEnabled: true, master: 1, voices: 1, media: 1, ...pref.get('audio', {}) };
function syncSettings() {
  $('sens').value = G.ctrl.sens;
  $('sens-val').textContent = `${G.ctrl.sens.toFixed(2)}×`;
  $('voice-enabled').checked = audioPrefs.voiceEnabled;
  for (const k of ['master', 'voices', 'media']) {
    $(`vol-${k}`).value = audioPrefs[k];
    $(`vol-${k}-val`).textContent = `${Math.round(audioPrefs[k] * 100)}%`;
  }
  // Cuenta: con qué nickname entraste (o que sos invitado)
  const acc = G.account;
  const guest = !acc?.username;
  const info = $('menu-account');
  info.textContent = '';
  if (guest) info.append('Estás como invitado. Creá tu cuenta para tener objetos, sala propia y amigos: tu personaje pasa a la cuenta.');
  else {
    const b = document.createElement('b');
    b.textContent = `@${acc.username}`;
    info.append('Entraste como ', b, '.');
  }
  $('btn-register-menu').hidden = !guest;
}
function applyAudioPrefs() {
  G.rtc.setVolumes({ master: audioPrefs.master, voices: audioPrefs.voices, media: audioPrefs.media });
  if (G.rtc.voiceEnabled !== audioPrefs.voiceEnabled) G.rtc.setVoiceEnabled(audioPrefs.voiceEnabled);
  pref.set('audio', audioPrefs);
}
$('sens').oninput = (e) => { G.ctrl.sens = Number(e.target.value); pref.set('sens', G.ctrl.sens); syncSettings(); };
$('voice-enabled').onchange = (e) => { audioPrefs.voiceEnabled = e.target.checked; applyAudioPrefs(); syncSettings(); };
for (const k of ['master', 'voices', 'media']) {
  $(`vol-${k}`).oninput = (e) => { audioPrefs[k] = Number(e.target.value); applyAudioPrefs(); syncSettings(); };
}
function showMenuTab(tab) {
  for (const b of document.querySelectorAll('#menu-tabs .tab')) b.classList.toggle('active', b.dataset.mtab === tab);
  for (const el of document.querySelectorAll('#settings .mtab')) el.hidden = el.dataset.mtab !== tab;
}
for (const b of document.querySelectorAll('#menu-tabs .tab')) b.onclick = () => showMenuTab(b.dataset.mtab);
function openMenu() {
  syncSettings();
  G.openOverlay('settings');
}
$('btn-settings').onclick = () => (body.classList.contains('settings') ? G.closeOverlays() : openMenu());
$('btn-profile-menu').onclick = () => { G.closeOverlays(); G.openEditor(); G.showZone('perfil'); };
$('btn-register-menu').onclick = async () => { G.closeOverlays(); await G.saveProfile(); G.showAuth('register', true); };
$('btn-logout-menu').onclick = async () => { await api('logout', { method: 'POST' }); session.token = null; location.reload(); };


Object.assign(G, { audioPrefs, openMenu });
