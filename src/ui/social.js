import { api } from '../net/api.js';
import { ITEMS } from '../../server/shared.js';
import { itemIcon } from './icons.js';
import { toast } from './toast.js';
import { guestGate } from './guest.js';

// Lo social: inventario, amigos, salas e intercambios.
// ui: { openOverlay(clase), closeOverlays(), isOpen(clase) }
// onEquip(lista): se llama cuando cambian los objetos que tengo puestos.

const $ = (id) => document.getElementById(id);

export function createSocial({ net, ui, me, room, onEquip, onDrop }) {
  let items = [];
  let isGuest = false;
  let friendsData = { friends: [], incoming: [], outgoing: [] };
  let seenIncoming = null;
  let trade = null;

  // ---------- Inventario ----------

  async function loadInventory() {
    const r = await api('inventory');
    if (r.ok) { items = r.items; isGuest = !!r.guest; }
    return items;
  }

  function card(it, { onClick, extraClass = '' } = {}) {
    const def = ITEMS[it.type];
    const b = document.createElement('button');
    b.className = `item ${it.equipped ? 'equipped' : ''} ${def?.rare ? 'rare' : ''} ${extraClass}`;
    b.innerHTML = `${itemIcon(it.type, it.color)}<span></span>`;
    b.querySelector('span:last-child').textContent = def?.name ?? it.type;
    if (onClick) b.onclick = onClick; else b.disabled = true;
    return b;
  }

  function renderInventory() {
    const grid = $('inv-grid');
    grid.innerHTML = '';
    if (isGuest) { grid.innerHTML = '<div class="empty">Los invitados no tienen objetos. Creá tu cuenta (Personaje → Crear cuenta) y recibís tus primeros objetos.</div>'; return; }
    if (!items.length) grid.innerHTML = '<div class="empty">No tenés objetos todavía.</div>';
    for (const it of items) {
      const c = card(it, {
        onClick: async () => {
          const r = await api('equip', { method: 'POST', body: { iid: it.iid, on: !it.equipped } });
          if (!r.ok) return toast(r.error);
          items = r.items;
          onEquip(r.equip);
          renderInventory();
        },
      });
      // Soltar en el suelo (lo pueden juntar otros a los 5 s; a los 60 s se pierde)
      const drop = document.createElement('span');
      drop.className = 'drop';
      drop.textContent = 'Soltar';
      drop.title = 'Soltar en el suelo';
      drop.onclick = (e) => {
        e.stopPropagation();
        onDrop?.(it);
        items = items.filter((x) => x.iid !== it.iid);
        renderInventory();
      };
      c.append(drop);
      // Arrastrar a la escena para soltarlo en ese lugar (PC)
      c.draggable = true;
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/iid', it.iid); e.dataTransfer.effectAllowed = 'move'; });
      grid.append(c);
    }
  }

  function dropByIid(iid, at) {
    const it = items.find((x) => x.iid === iid);
    if (!it) return;
    onDrop?.(it, at);
    items = items.filter((x) => x.iid !== iid);
    renderInventory();
  }

  async function openInventory() {
    renderInventory();
    ui.openOverlay('inventory');
    await loadInventory();
    renderInventory();
  }

  // ---------- Amigos y salas ----------

  const roomOf = (userId) => `u-${userId}`;
  function go(target) {
    if (target === room) return toast('Ya estás en esa sala.');
    location.search = `?sala=${encodeURIComponent(target)}`;
  }
  function roomLabel(r) {
    if (!r) return 'Desconectado';
    if (r === 'museo') return 'En el Museo';
    if (r === roomOf(me()?.id)) return 'En tu sala';
    if (r.startsWith('u-')) {
      const owner = friendsData.friends.find((f) => roomOf(f.id) === r);
      return owner ? `En la sala de ${owner.name}` : 'En una sala personal';
    }
    return `En la sala ${r}`;
  }

  async function refreshFriends() {
    const r = await api('friends');
    if (!r.ok) return;
    friendsData = r;
    // Avisar solicitudes nuevas (no las que ya se vieron)
    const ids = new Set(r.incoming.map((f) => f.id));
    if (seenIncoming) {
      for (const f of r.incoming) {
        if (!seenIncoming.has(f.id)) {
          toast(`${f.name} quiere ser tu amigo`, { actions: [
            { label: 'Aceptar', yes: true, onClick: () => respond(f.id, true) },
            { label: 'Después' },
          ] });
        }
      }
    }
    seenIncoming = ids;
    if (ui.isOpen('friends')) renderFriends();
  }

  async function respond(id, accept) {
    const r = await api('friendrespond', { method: 'POST', body: { id, accept } });
    if (!r.ok) return toast(r.error);
    await refreshFriends();
  }

  function friendRow(f, buttons) {
    const row = document.createElement('div');
    row.className = 'friend';
    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('b');
    name.textContent = f.name + (f.username ? ` · @${f.username}` : '');
    const where = document.createElement('span');
    where.textContent = roomLabel(f.room);
    if (f.room) where.className = 'online';
    who.append(name, where);
    row.append(who);
    for (const [label, onClick, cls] of buttons) {
      const b = document.createElement('button');
      b.className = `act ${cls ?? ''}`;
      b.textContent = label;
      b.onclick = onClick;
      row.append(b);
    }
    return row;
  }

  function renderFriends() {
    const box = $('friends-list');
    box.innerHTML = '';
    box.className = 'flist';
    const section = (title, list, buttons, empty) => {
      const h = document.createElement('h2');
      h.textContent = title;
      box.append(h);
      if (!list.length && empty) {
        const p = document.createElement('p');
        p.className = 'meta';
        p.textContent = empty;
        box.append(p);
      }
      for (const f of list) box.append(friendRow(f, buttons(f)));
    };
    if (friendsData.incoming.length) {
      section('Solicitudes', friendsData.incoming, (f) => [
        ['Aceptar', () => respond(f.id, true), 'on'],
        ['Rechazar', () => respond(f.id, false)],
      ]);
    }
    const friendButtons = (f) => [
      ...(f.room && f.room !== room ? [['Ir', () => go(f.room), 'on']] : []),
      ['Su sala', () => go(roomOf(f.id))],
    ];
    const online = friendsData.friends.filter((f) => f.room);
    const offline = friendsData.friends.filter((f) => !f.room);
    section(`Conectados (${online.length})`, online, friendButtons,
      friendsData.friends.length ? 'Ninguno de tus amigos está conectado ahora.' : 'Todavía no tenés amigos. Buscalos arriba o apretá E sobre alguien y "Agregar amigo".');
    if (offline.length) section(`Desconectados (${offline.length})`, offline, friendButtons);
    if (friendsData.outgoing.length) {
      section('Enviadas', friendsData.outgoing, (f) => [
        ['Cancelar', async () => { await api('friendremove', { method: 'POST', body: { id: f.id } }); refreshFriends(); }],
      ]);
    }
  }

  async function openFriends() {
    renderFriends();
    ui.openOverlay('friends');
    await refreshFriends();
    renderFriends();
  }

  // Botones del perfil de otro jugador
  function profileActions(player, profile) {
    const actions = $('profile-actions');
    actions.hidden = !profile || profile.relation === 'self';
    if (actions.hidden) return;
    const fb = $('act-friend');
    const setRel = (rel) => {
      profile.relation = rel;
      fb.disabled = rel === 'outgoing';
      fb.classList.toggle('on', rel === 'friends');
      fb.textContent = { none: 'Agregar amigo', outgoing: 'Solicitud enviada', incoming: 'Aceptar solicitud', friends: 'Amigos ✓' }[rel] ?? 'Agregar amigo';
      fb.title = rel === 'friends' ? 'Click para dejar de ser amigos' : '';
    };
    setRel(profile.relation);
    fb.onclick = async () => {
      if (profile.relation === 'friends') {
        toast(`¿Dejar de ser amigo de ${profile.name}?`, { actions: [
          { label: 'Sí, quitar', onClick: async () => { const r = await api('friendremove', { method: 'POST', body: { id: profile.id } }); if (r.ok) setRel('none'); refreshFriends(); } },
          { label: 'No' },
        ] });
        return;
      }
      const r = profile.relation === 'incoming'
        ? await api('friendrespond', { method: 'POST', body: { id: profile.id, accept: true } })
        : await api('friendrequest', { method: 'POST', body: { id: profile.id } });
      if (!r.ok) return toast(r.error);
      setRel(r.relation);
      refreshFriends();
    };
    $('act-trade').onclick = () => {
      if (me()?.guest) return guestGate('intercambiar objetos');
      net.send({ t: 'trade', op: 'invite', to: player.id });
      toast(`Invitaste a ${player.name} a intercambiar. Esperando respuesta…`);
      ui.closeOverlays();
    };
    $('act-visit').onclick = () => go(roomOf(profile.id));
    // Grupo de voz privado: la sala responde si se mandó (o por qué no)
    $('act-group').onclick = () => {
      if (me()?.guest) return guestGate('invitar a grupos de voz');
      if (player.guest) return toast(`${player.name} entró como invitado: los invitados no usan la voz.`);
      net.send({ t: 'group', op: 'invite', to: player.id });
      ui.closeOverlays();
    };
  }

  // ---------- Intercambios ----------

  function renderTrade() {
    if (!trade) return;
    $('trade-name').textContent = trade.name;
    $('trade-them-name').textContent = trade.name;
    const you = trade.state?.you ?? { items: [], ready: false };
    const them = trade.state?.them ?? { items: [], ready: false };
    const fill = (el, list, empty) => {
      el.innerHTML = '';
      if (!list.length) el.innerHTML = `<div class="empty">${empty}</div>`;
      for (const it of list) el.append(card(it));
    };
    fill($('trade-you'), you.items, 'Nada todavía');
    fill($('trade-them'), them.items, 'Nada todavía');
    const offered = new Set(you.items.map((i) => i.iid));
    const inv = $('trade-inv');
    inv.innerHTML = '';
    for (const it of items) {
      inv.append(card(it, {
        extraClass: offered.has(it.iid) ? 'offered' : '',
        onClick: () => {
          const next = new Set(offered);
          next.has(it.iid) ? next.delete(it.iid) : next.add(it.iid);
          net.send({ t: 'trade', op: 'offer', iids: [...next] });
        },
      }));
    }
    $('trade-you-ready').classList.toggle('on', you.ready);
    $('trade-them-ready').classList.toggle('on', them.ready);
    const rb = $('trade-ready');
    rb.classList.toggle('on', you.ready);
    rb.textContent = you.ready ? 'Esperando…' : 'Estoy listo';
    $('trade-status').textContent = you.ready && !them.ready
      ? `Esperando que ${trade.name} confirme.`
      : 'Si alguno cambia su oferta, los dos tienen que volver a confirmar.';
  }
  $('trade-ready').onclick = () => net.send({ t: 'trade', op: 'ready', v: !trade?.state?.you?.ready });
  $('trade-cancel').onclick = () => cancelTrade();

  function cancelTrade() {
    if (trade) net.send({ t: 'trade', op: 'cancel' });
  }

  function endTrade() {
    trade = null;
    if (ui.isOpen('trading')) ui.closeOverlays();
  }

  async function onTrade(msg) {
    switch (msg.op) {
      case 'invite':
        toast(`${msg.name} quiere intercambiar objetos con vos`, { actions: [
          { label: 'Aceptar', yes: true, onClick: () => net.send({ t: 'trade', op: 'accept', from: msg.from }) },
          { label: 'No', onClick: () => net.send({ t: 'trade', op: 'decline', from: msg.from }) },
        ] });
        break;
      case 'busy': toast('Ahora no se puede: alguno ya está en otro intercambio.'); break;
      case 'declined': toast(`${msg.name} no quiso intercambiar.`); break;
      case 'expired': toast('Esa invitación ya venció.'); break;
      case 'open':
        trade = { id: msg.id, with: msg.with, name: msg.name, state: null };
        await loadInventory();
        ui.openOverlay('trading');
        renderTrade();
        break;
      case 'state':
        if (!trade) return;
        trade.state = msg;
        renderTrade();
        break;
      case 'done': {
        endTrade();
        toast('¡Intercambio hecho! Mirá tu inventario.');
        await loadInventory();
        const r = await api('me');
        if (r.ok) onEquip(r.user.equip);
        break;
      }
      case 'failed': endTrade(); toast(msg.error ?? 'No se pudo hacer el intercambio.'); break;
      case 'closed': endTrade(); toast(msg.byMe ? 'Cancelaste el intercambio.' : `${msg.name} canceló el intercambio.`); break;
    }
  }

  return {
    openInventory, openFriends, refreshFriends, profileActions, onTrade, cancelTrade, loadInventory, go, roomLabel, dropByIid,
    get friends() { return friendsData; },
    get trading() { return !!trade; },
  };
}
