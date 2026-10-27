// Sala, segunda tanda de hallazgos (docs/hallazgos.md: A8, B11, M14, A12, M20, M1, M2, M7, M8, M10, M12, M15,
// B1, B4, B6, B9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, guest, joined, Client, sleep, moveTo, inventory } from './helpers.mjs';

async function tradeOpen(ca, cb) {
  cb.send({ t: 'trade', op: 'invite', to: ca.id });
  await ca.wait((m) => m.t === 'trade' && m.op === 'invite');
  ca.send({ t: 'trade', op: 'accept', from: cb.id });
  await cb.wait((m) => m.t === 'trade' && m.op === 'open');
  await ca.wait((m) => m.t === 'trade' && m.op === 'open');
}

test('intercambio: "listo" no vale si la oferta del otro cambió sin verla (A8, B11)', async () => {
  const a = await account('tr'), b = await account('tr');
  const ca = await joined(a.token), cb = await joined(b.token);
  await tradeOpen(ca, cb);
  const [ia] = await inventory(a.token), [ib, ib2] = await inventory(b.token);
  ca.send({ t: 'trade', op: 'offer', iids: [ia.iid] });
  cb.send({ t: 'trade', op: 'offer', iids: [ib.iid] });
  const st = await ca.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items.length === 1 && m.you.items.length === 1);
  // B cambia lo que ofrece justo antes de que A diga "listo" con lo viejo
  cb.send({ t: 'trade', op: 'offer', iids: [ib2.iid] });
  await ca.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items[0]?.iid === ib2.iid);
  ca.send({ t: 'trade', op: 'ready', v: true, seen: { you: st.you.v, them: st.them.v } });
  const after = await ca.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items[0]?.iid === ib2.iid);
  assert.equal(after.you.ready, false, 'quedó listo con una oferta que no vio');
  // Con lo que ve ahora, sí
  ca.send({ t: 'trade', op: 'ready', v: true, seen: { you: after.you.v, them: after.them.v } });
  await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.ready);
  await ca.close(); await cb.close();
});

test('intercambio: hay que estar cerca y rechazar bloquea reinvitar (M14)', async () => {
  const a = await account('tr'), b = await account('tr');
  const ca = await joined(a.token), cb = await joined(b.token);
  await moveTo(cb, -15, 0, 0);
  cb.send({ t: 'trade', op: 'invite', to: ca.id });
  assert.ok(await ca.none((m) => m.t === 'trade' && m.op === 'invite'), 'llegó la invitación de lejos');
  await moveTo(cb, -27, 0, 0);
  cb.send({ t: 'trade', op: 'invite', to: ca.id });
  await ca.wait((m) => m.t === 'trade' && m.op === 'invite');
  ca.send({ t: 'trade', op: 'decline', from: cb.id });
  await cb.wait((m) => m.t === 'trade' && m.op === 'declined');
  cb.send({ t: 'trade', op: 'invite', to: ca.id });
  assert.ok(await ca.none((m) => m.t === 'trade' && m.op === 'invite'), 'pudo reinvitar enseguida');
  await ca.close(); await cb.close();
});

test('chat: el antiflood sigue al reconectar y no se esquiva con invisibles (A12, M20)', async () => {
  const a = await account('ch');
  let c = await joined(a.token);
  for (let i = 0; i < 5; i++) c.send({ t: 'chat', text: `hola ${i}` });
  await sleep(300);
  await c.close();
  c = await joined(a.token);
  c.send({ t: 'chat', text: 'otra cosa' });
  await c.wait((m) => m.t === 'notice' && /rápido/.test(m.text), { what: 'aviso de antiflood' });
  await c.close();
  const b = await account('ch');
  const cb = await joined(b.token);
  cb.send({ t: 'chat', text: 'repetido' });
  await cb.wait((m) => m.t === 'chat' && m.text === 'repetido');
  cb.send({ t: 'chat', text: 'Re​pe​tido!!' });
  await cb.wait((m) => m.t === 'notice' && /Ya mandaste/.test(m.text), { what: 'aviso de repetido' });
  cb.send({ t: 'chat', text: 'ź̂̃̄̅a‮' });
  const z = await cb.wait((m) => m.t === 'chat' && m.text.startsWith('z'));
  assert.equal(z.text, 'ź̂a');
  await cb.close();
});

test('posición: al entrar lejos de la entrada o en el aire, la sala lo corrige (M1, M2)', async () => {
  const a = await account('po'), b = await account('po');
  const c = new Client(a.token);
  await c.join([20, 0, 5, 0, 0, 0]);
  assert.deepEqual(c.joinedAt, [-27.5, 0, 0]);
  const ob = await joined(b.token);
  ob.send({ t: 's', s: [-27.5, 30, 0, 0, 0, 4] });
  await ob.wait('pos-fix');
  await c.close(); await ob.close();
});

test('cabina y consola: de cerca y una parte por persona; temas cada 20 s (M7, M8, M10)', async () => {
  // En una sala propia con cabina y consola (el Museo lo usan otras pruebas a la vez)
  const a = await account('dj'), b = await account('dj');
  const room = `u-${a.user.id}`;
  const ca = await joined(a.token, room);
  ca.send({ t: 'edit', op: 'template', template: 'club' });
  await ca.wait('layout');
  const cb = await joined(b.token, room);
  await moveTo(ca, 0, 0, 3);
  ca.send({ t: 'dj', on: true, streamId: 's' });
  await ca.wait((m) => m.t === 'dj' && m.denied, { what: 'cabina de lejos' });
  await moveTo(ca, 0, 0, -2.8);
  ca.send({ t: 'dj', on: true, streamId: 's' });
  await cb.wait((m) => m.t === 'dj' && m.on && m.id === ca.id, { what: 'cabina de cerca' });
  ca.send({ t: 'dj', track: 'Tema 1' });
  await cb.wait((m) => m.t === 'dj' && m.track === 'Tema 1', { what: 'tema 1' });
  ca.send({ t: 'dj', track: 'Tema 2' });
  assert.ok(await cb.none((m) => m.t === 'dj' && m.track === 'Tema 2'), 'cambió el tema antes de los 20 s');
  // Con la cabina no puede tomar también la consola (aunque vaya hasta ella)
  await moveTo(ca, 3.6, 0, 2.6);
  ca.send({ t: 'part', part: 'luces', on: true });
  await ca.wait((m) => m.t === 'part' && m.part === 'luces' && m.denied, { what: 'luces con la cabina' });
  await ca.close(); await cb.close();
});

test('el Museo no tiene segunda pantalla (B6)', async () => {
  const a = await account('dj');
  const ca = await joined(a.token);
  await moveTo(ca, -4, 0, 0.8);
  ca.send({ t: 'part', part: 'escenario2', on: true, streamId: 'x' });
  await ca.wait((m) => m.t === 'part' && m.part === 'escenario2' && m.denied, { what: 'denegado' });
  await ca.close();
});

test('grupos: los de afuera no ven quién está con quién, y si se va el líder pasa al siguiente (B1, M12)', async () => {
  const a = await account('gr'), b = await account('gr'), c = await account('gr'), d = await account('gr');
  const ca = await joined(a.token), cb = await joined(b.token), cc = await joined(c.token), cd = await joined(d.token);
  ca.send({ t: 'group', op: 'invite', to: cb.id });
  await cb.wait((m) => m.t === 'group' && m.op === 'invite');
  cb.send({ t: 'group', op: 'respond', from: ca.id, accept: true });
  ca.send({ t: 'group', op: 'invite', to: cc.id });
  await cc.wait((m) => m.t === 'group' && m.op === 'invite');
  cc.send({ t: 'group', op: 'respond', from: ca.id, accept: true });
  const mine = await cb.wait((m) => m.t === 'groups' && Object.values(m.groups).some((g) => g.members.length === 3));
  const out = await cd.wait((m) => m.t === 'groups' && Object.keys(m.groups).length === 3);
  assert.ok(Object.values(out.groups).every((g) => g.members.length === 1 && !g.leader), 'el de afuera ve el grupo armado');
  assert.ok(Object.values(mine.groups).some((g) => g.leader === a.user.id));
  await ca.close();
  const after = await cb.wait((m) => m.t === 'groups' && Object.values(m.groups).some((g) => g.members.length === 3 && g.leader !== a.user.id));
  const g = Object.values(after.groups).find((x) => x.members.length === 3);
  assert.ok([b.user.id, c.user.id].includes(g.leader));
  await cb.close(); await cc.close(); await cd.close();
});

test('baneo: también la IP por 24 h, pero el dueño sigue entrando (M15)', async () => {
  const owner = await account('ba'), x = await account('ba');
  const room = `u-${owner.user.id}`;
  const own = await joined(owner.token, room), cx = await joined(x.token, room);
  own.send({ t: 'mod', op: 'ban', target: cx.id });
  await cx.wait((m) => m.t === 'kicked' && m.ban, { what: 'el baneo' });
  // Un invitado nuevo desde la misma IP no entra
  const g = await guest();
  const cg = new Client(g.token, room);
  const w = await cg.join();
  assert.equal(w.code, 'banned');
  await cg.close();
  // El dueño sí
  await own.close();
  const again = await joined(owner.token, room);
  await again.close(); await cx.close();
});

test('gestos con tope, y consumibles raros no rompen la sala (B4, B9)', async () => {
  const a = await account('ge'), b = await account('ge');
  const ca = await joined(a.token), cb = await joined(b.token);
  const from = cb.msgs.length;
  for (let i = 0; i < 6; i++) ca.send({ t: 'emote', e: 'saludar' });
  await sleep(500);
  assert.ok(cb.since(from).filter((m) => m.t === 'emote').length <= 2);
  ca.send({ t: 'consume', from: 'bar', kind: 'constructor' });
  ca.send({ t: 'chat', text: 'sigo vivo' });
  await cb.wait((m) => m.t === 'chat' && m.text === 'sigo vivo');
  await ca.close(); await cb.close();
});
