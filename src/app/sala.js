// Mensajes de la sala: entrar (join), quién está conectado, todo lo que llega por la conexión
// (net.on), expulsiones, el cartel de controles y el AFK.
import { RemotePlayer } from '../net/remote.js';
import { session } from '../net/api.js';
import { toast } from '../ui/toast.js';
import { BOOST_TIME } from '../../server/shared.js';
import { G, $, body } from './state.js';

const { scene, world, ctrl, me, isTouch, room, net, remotes, rtc, groups, applyGroups, roomPanel, social, phone, progress, ground, roomEditor } = G;

// Expulsado / baneado
function showKicked(title, text) {
  net.stop();
  $('kicked-title').textContent = title;
  $('kicked-text').textContent = text;
  $('kicked-go').textContent = room === 'museo' ? 'Reintentar' : 'Ir al Museo';
  $('kicked-go').onclick = () => (room === 'museo' ? location.reload() : social.go('museo'));
  G.openOverlay('kicked');
}
// Una sola conexión por cuenta: si se abre el juego en otra pestaña (o en otro dispositivo), esta se
// desconecta. "Usar aquí" la vuelve a conectar (y desconecta a la otra)
function showElsewhere() {
  showKicked('Abriste el juego en otra pestaña', 'Tu cuenta solo puede estar conectada en un lugar a la vez.');
  $('kicked-go').textContent = 'Usar aquí';
  $('kicked-go').onclick = () => location.reload();
}

// Controles: al entrar (una vez por visita), con /controls o desde el menú
let controlsShown = false;
function openControls() {
  $('controls-list').innerHTML = isTouch
    ? '<dl><dt>Joystick</dt><dd>Moverse (hasta el borde: trotar)</dd><dt>Arrastrar</dt><dd>Mirar</dd><dt>Saltar · Agachar</dt><dd>Botones de la derecha</dd><dt>Usar</dt><dd>Lo que tenés adelante</dd><dt>Chat</dt><dd>Escribir · /ayuda para ver comandos</dd></dl>'
    : document.querySelector('.mtab[data-mtab=controls] dl').outerHTML;
  G.openOverlay('controls');
}
$('controls-ok').onclick = G.closeOverlays;

function join() {
  G.joined = true;
  G.refreshState();
  if (!controlsShown) { controlsShown = true; setTimeout(openControls, 400); }
  net.connect(() => ({ token: session.token, s: ctrl.state(), afk }));
  social.refreshFriends();
  phone.refreshBadge();
  progress.start();
  roomPanel.syncBlocks();
  setInterval(() => { social.refreshFriends(); phone.refreshBadge(); }, 25_000);
}

function setStatus() {
  const on = net.ready;
  $('status-dot').classList.toggle('on', on);
  $('status').innerHTML = on
    ? `<b>${G.roomTitle}</b> · ${remotes.size + 1} conectado${remotes.size ? 's' : ''}`
    : `<b>${G.roomTitle}</b>${G.joined ? ' · conectando…' : ''}`;
}
function addRemote(p) {
  if (p.id === net.id || remotes.has(p.id)) return;
  remotes.set(p.id, new RemotePlayer(scene, p));
}
function removeRemote(id) {
  rtc.playerLeft(id);
  remotes.get(id)?.dispose();
  remotes.delete(id);
}

net
  .on('welcome', (m) => {
    for (const id of [...remotes.keys()]) removeRemote(id);
    if (rtc.djStream || ctrl.booth) G.endMySet(); // cambié de sala o se reconectó: la cabina (de DJ o de artistas) ya no es mía
    rtc.reset(); // conexión nueva con el servidor de audio (vuelve a publicar mi micrófono si lo tenía)
    groups.all = m.groups ?? {};
    rtc.setScreen(m.screen);
    G.setDJ(m.dj);
    // Si tenía luces o pantalla y me reconecté o cambié de sala, las suelto de mi lado
    if (G.hasMyLights()) G.endPart('luces');
    if (rtc.stageStream) G.endPart('escenario');
    for (const part of Object.keys(G.parts)) delete G.parts[part];
    Object.assign(G.parts, m.parts ?? {});
    world.artists.setLights(m.lights ?? null);
    rtc.setStage(G.parts.escenario ? { id: G.parts.escenario.id, streamId: G.parts.escenario.streamId } : null);
    G.refreshArtists();
    m.players.forEach(addRemote);
    applyGroups();
    if (rtc.mic) net.send({ t: 'mic', v: rtc.micState });
    roomPanel.setRoom(m.room ?? {});
    roomEditor?.onWelcome(m);
    if (me.phone) net.send({ t: 'phone', v: true });
    roomPanel.applyMutes();
    ground.clear();
    for (const g of m.ground ?? []) ground.add(g);
    $('messages').innerHTML = '';
    m.chat.filter((c) => !roomPanel.isIgnored(c.userId)).forEach(G.addMessage);
    G.system(`Entraste a ${G.roomTitle}.${m.room?.mod ? ' Sos moderador de esta sala (Tab para ver las herramientas).' : ''}`);
    setStatus();
  })
  .on('settings', ({ settings, by }) => {
    roomPanel.setRoom({ settings });
    const off = Object.entries(settings).filter(([, v]) => !v).map(([k]) => ({ chat: 'chat', voice: 'voz', screen: 'pantalla', dj: 'pasar música', items: 'soltar objetos' }[k]));
    G.system(`${by} cambió la sala.${off.length ? ` Deshabilitado: ${off.join(', ')}.` : ' Todo habilitado.'}`);
    if (!settings.voice && !roomPanel.info.mod) G.talk(false);
  })
  .on('silenced', ({ id, v }) => {
    if (id === net.id) {
      roomPanel.setRoom({ silenced: v });
      if (v) { G.talk(false); toast('Un moderador te silenció en esta sala.'); } else toast('Ya no estás silenciado.');
    }
    const r = remotes.get(id);
    if (r) { r.silenced = v; roomPanel.applyMutes(); }
    roomPanel.render();
  })
  .on('elsewhere', () => showElsewhere())
  .on('kicked', ({ ban, by }) => showKicked(ban ? 'Te banearon de esta sala' : 'Te sacaron de la sala', `${by} ${ban ? 'te baneó: no vas a poder volver a entrar a esta sala.' : 'te expulsó. Podés volver a entrar más tarde.'}`))
  .on('teleport', ({ x, y, z, by }) => {
    ctrl.stand();
    ctrl.pos.set(x, y, z);
    ctrl.vel.set(0, 0);
    toast(`${by} te movió.`);
  })
  .on('bans', ({ bans }) => roomPanel.setBans(bans))
  .on('notice', ({ text }) => toast(text))
  .on('mic-denied', () => { rtc.talk(false); })
  .on('ground+', (g) => ground.add(g))
  .on('ground-', ({ iid, by, expired }) => {
    const it = ground.remove(iid);
    if (it && expired && it.owner === G.account?.id) G.system(`Se perdió tu objeto (${it.name}): nadie lo juntó a tiempo.`);
    else if (it && by && by !== G.account?.name) G.system(`${by} juntó ${it.name.toLowerCase()}.`);
  })
  .on('picked', () => { toast('¡Lo juntaste! Está en tu inventario (I).'); if (body.classList.contains('inventory')) social.openInventory(); })
  .on('dropped', ({ equip }) => G.setEquip(equip))
  .on('join', (p) => { addRemote(p); roomPanel.applyMutes(); applyGroups(); G.system(`${p.name} entró a la sala.`); setStatus(); })
  .on('leave', ({ id }) => {
    const r = remotes.get(id);
    if (r) G.system(`${r.name} salió.`);
    removeRemote(id);
    setStatus();
  })
  .on('s', ({ id, s }) => remotes.get(id)?.setState(s))
  .on('afk', ({ id, v }) => remotes.get(id)?.setAfk(v))
  .on('phone', ({ id, v }) => { const r = remotes.get(id); if (r) r.avatar.phone = v; })
  .on('look', ({ id, name: n, look: l, equip }) => { const r = remotes.get(id); if (r) { r.setLook(l, equip); r.setName(n); } })
  .on('mic', ({ id, v }) => remotes.get(id)?.setMic(v))
  .on('emote', ({ id, e }) => remotes.get(id)?.avatar.gesture(e))
  .on('sfu', (m) => rtc.onSfu(m))
  .on('sfu-cut', ({ mids }) => rtc.cut(mids))
  .on('pub', ({ id, kind }) => { const r = remotes.get(id); if (r && kind === 'voice') r.hasVoice = true; })
  .on('groups', ({ groups: g }) => { groups.all = g ?? {}; applyGroups(); })
  .on('dm', (m) => phone.onDM(m))
  .on('group', (m) => {
    if (m.op === 'sent') toast(`Invitaste a ${m.name} a tu grupo de voz.`);
    else if (m.op === 'invite') {
      toast(`${m.name} te invita a su grupo de voz (privado: solo se escuchan entre ustedes).`, { actions: [
        { label: 'Aceptar', yes: true, onClick: () => net.send({ t: 'group', op: 'respond', from: m.from, accept: true }) },
        { label: 'Rechazar', onClick: () => net.send({ t: 'group', op: 'respond', from: m.from, accept: false }) },
      ], time: 60_000 });
    } else if (m.op === 'joined') G.system(m.me ? '🔒 Entraste al grupo de voz: ahora solo te escucha tu grupo.' : `🔒 ${m.name} entró a tu grupo de voz.`);
    else if (m.op === 'left') G.system('Saliste del grupo de voz: volvés a escuchar a los que tenés cerca.');
    else if (m.op === 'gone') G.system(`${m.name} salió de tu grupo de voz.`);
    else if (m.op === 'kicked') G.system('Te sacaron del grupo de voz.');
  })
  // Alguien tomó algo (trago o café): se le ve el vaso; si fui yo, 2 minutos sin gastar stamina
  .on('consume', ({ id, kind }) => {
    if (id === net.id) {
      me.drink(kind);
      ctrl.boostUntil = performance.now() + BOOST_TIME;
      toast(`${kind === 'cafe' ? '☕ Café' : '🍹 Trago'}: por 2 minutos no te cansás.`);
    } else remotes.get(id)?.avatar.drink(kind);
  })
  .on('inventory-changed', () => social.loadInventory())
  // Beso: pedido (aceptar / rechazar), aviso de enviado y el beso en sí (los dos se inclinan)
  .on('kiss', (m) => {
    if (m.op === 'sent') toast(`Le pediste un beso a ${m.name}.`);
    else if (m.op === 'ask') {
      toast(`${m.name} te quiere dar un beso.`, { actions: [
        { label: 'Aceptar', yes: true, onClick: () => net.send({ t: 'kiss', op: 'respond', from: m.from, accept: true }) },
        { label: 'Rechazar', onClick: () => net.send({ t: 'kiss', op: 'respond', from: m.from, accept: false }) },
      ], time: 60_000 });
    } else if (m.op === 'do') {
      const mine = m.a === net.id ? m.b : m.b === net.id ? m.a : null;
      for (const id of [m.a, m.b]) (id === net.id ? me : remotes.get(id)?.avatar)?.kiss();
      if (mine) {
        // Me giro hacia el otro y recibo el efecto
        const other = remotes.get(mine);
        if (other) {
          const d = other.avatar.root.position.clone().sub(ctrl.pos);
          ctrl.yaw = Math.atan2(-d.x, -d.z);
          ctrl.bodyYaw = ctrl.yaw + Math.PI; // el cuerpo también (en 3ª persona no sigue a la cámara)
        }
        ctrl.boostUntil = performance.now() + BOOST_TIME;
        toast('💋 Por 2 minutos no te cansás.');
      }
    }
  })
  .on('screen', (m) => {
    if (m.busy) return toast(`Ya está compartiendo ${remotes.get(m.id)?.name ?? 'otra persona'}. Esperá a que termine.`);
    if (m.id === net.id) return;
    if (m.on) {
      rtc.setScreen({ id: m.id, streamId: m.streamId });
      G.system(`🎬 ${remotes.get(m.id)?.name ?? 'Alguien'} está compartiendo su pantalla en la pantalla del hall.`);
    } else rtc.setScreen(null);
    G.refreshArtists();
  })
  .on('dj', (m) => G.onDJ(m))
  .on('part', (m) => G.onPart(m))
  .on('luces', ({ s }) => world.artists.setLights(s))
  .on('trade', (m) => social.onTrade(m))
  .on('chat', (m) => {
    if (roomPanel.isIgnored(m.userId)) return; // ignorado: no veo sus mensajes
    G.addMessage(m);
    remotes.get(m.id)?.say(m.text);
  })
  .on('error', (m) => {
    if (m.code === 'auth') { session.token = null; location.reload(); }
    if (m.code === 'banned') showKicked('Estás baneado de esta sala', 'El dueño de la sala o un admin te baneó.');
    if (m.code === 'private') showKicked('Sala privada', 'El dueño de esta sala eligió que solo entren sus amigos, o nadie más.');
  })
  .on('status', setStatus);


// ---------- AFK: sin tocar nada por 90 s, o con la pestaña oculta ----------
let afk = false;
let lastInput = performance.now();
function setAfk(v) {
  if (afk === v) return;
  afk = v;
  body.classList.toggle('afk', v);
  if (net.ready) net.send({ t: 'afk', v });
}
const activity = () => { lastInput = performance.now(); if (!document.hidden) setAfk(false); };
for (const ev of ['keydown', 'pointerdown', 'mousemove', 'touchstart', 'wheel']) addEventListener(ev, activity, { passive: true });
// Cartel de AFK: a los 5 minutos sin tocar nada (también con la pestaña oculta)
document.addEventListener('visibilitychange', () => { if (!document.hidden) activity(); });
setInterval(() => { if (performance.now() - lastInput > 5 * 60_000) setAfk(true); }, 5000);


Object.assign(G, { showKicked, openControls, join, setStatus });
