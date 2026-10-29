// Varias salas por persona (decisiones del 26 y 27/10): hasta 3, plantilla fija al crear, ajustes y corazones
// por sala, borrar con la gente adentro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, joined, Client, api, inventory, moveTo } from './helpers.mjs';

test('salas: cada cuenta arranca con una y llega hasta 3', async () => {
  const a = await account('sl');
  let r = await api('myrooms', { token: a.token });
  assert.equal(r.rooms.length, 1);
  assert.equal(r.rooms[0].id, a.user.id);
  for (const template of ['club', 'galeria']) assert.ok((await api('roomcreate', { method: 'POST', token: a.token, body: { template } })).ok);
  const fourth = await api('roomcreate', { method: 'POST', token: a.token, body: { template: 'loft' } });
  assert.equal(fourth.ok, false);
  // Plantillas de mapas públicos o inventadas no
  const b = await account('sl');
  for (const template of ['plaza', 'constructor', 'x']) assert.equal((await api('roomcreate', { method: 'POST', token: b.token, body: { template } })).ok, false);
  r = await api('myrooms', { token: a.token });
  assert.equal(r.rooms.length, 3);
});

test('salas: la plantilla queda fija desde que se crea', async () => {
  const a = await account('sl');
  const created = await api('roomcreate', { method: 'POST', token: a.token, body: { template: 'club', name: 'Mi club' } });
  const c = await joined(a.token, created.room.room);
  assert.equal(c.welcome.room.owner, a.user.id);
  c.send({ t: 'edit', op: 'template', template: 'loft' });
  await c.wait((m) => m.t === 'edit-fail' && m.op === 'template');
  await c.close();
  // La primera (la de antes) se elige una vez al entrar y después tampoco cambia
  const first = await joined(a.token, `u-${a.user.id}`);
  first.send({ t: 'edit', op: 'template', template: 'galeria' });
  await first.wait('layout');
  first.send({ t: 'edit', op: 'template', template: 'club' });
  await first.wait((m) => m.t === 'edit-fail' && m.op === 'template');
  const mine = await api('myrooms', { token: a.token });
  assert.equal(mine.rooms.find((r) => r.id === a.user.id).template, 'galeria');
  await first.close();
});

test('salas: la privacidad es de cada sala', async () => {
  const a = await account('sl'), b = await account('sl');
  const second = (await api('roomcreate', { method: 'POST', token: a.token, body: { template: 'loft' } })).room;
  assert.ok((await api('myroom', { method: 'PUT', token: a.token, body: { id: second.id, privacy: 'cerrada' } })).ok);
  const closed = new Client(b.token, second.room);
  assert.equal((await closed.join()).code, 'private');
  await closed.close();
  const open = await joined(b.token, `u-${a.user.id}`);
  await open.close();
  // Las salas que ve otro: solo las abiertas para él
  const seen = await api(`rooms?owner=${a.user.id}`, { token: b.token });
  assert.deepEqual(seen.rooms.map((r) => r.id), [a.user.id]);
  // Ajustar una sala ajena, no
  assert.equal((await api('myroom', { method: 'PUT', token: b.token, body: { id: second.id, privacy: 'todos' } })).ok, false);
});

test('salas: borrar echa a quien está, devuelve los especiales y la sala deja de existir', async () => {
  const a = await account('sl'), b = await account('sl');
  const room = `u-${a.user.id}`;
  const own = await joined(a.token, room);
  own.send({ t: 'edit', op: 'template', template: 'club' });
  await own.wait('layout');
  const sp = (await inventory(a.token)).find((i) => i.type === 'esculturaNeon');
  own.send({ t: 'edit', op: 'add', piece: { id: 'tmp1', type: sp.type, iid: sp.iid, x: 1, z: 1 } });
  await own.wait((m) => m.t === 'piece' && m.piece.iid === sp.iid);
  assert.ok(!(await inventory(a.token)).some((i) => i.iid === sp.iid));
  const cb = await joined(b.token, room);
  // Solo el dueño la borra
  assert.equal((await api('roomdelete', { method: 'POST', token: b.token, body: { id: a.user.id } })).ok, false);
  const del = await api('roomdelete', { method: 'POST', token: a.token, body: { id: a.user.id } });
  assert.ok(del.ok, del.error);
  await cb.wait((m) => m.t === 'kicked' && m.gone, { what: 'que lo echen' });
  assert.ok((await inventory(a.token)).some((i) => i.iid === sp.iid), 'el especial no volvió a la mochila');
  const again = new Client(b.token, room);
  assert.equal((await again.join()).code, 'noroom');
  await again.close(); await own.close(); await cb.close();
  // Puede quedarse sin salas y crear otra después (vuelve a tener el id de la cuenta, sin lo de antes)
  assert.equal((await api('myrooms', { token: a.token })).rooms.length, 0);
  const re = await api('roomcreate', { method: 'POST', token: a.token, body: { template: 'terraza' } });
  assert.equal(re.room.id, a.user.id);
  const c = await joined(a.token, room);
  assert.equal(c.welcome.layout.template, 'terraza');
  await c.close();
});

test('salas: los corazones son de cada sala y el perfil suma todos', async () => {
  const a = await account('sl'), b = await account('sl');
  const second = (await api('roomcreate', { method: 'POST', token: a.token, body: { template: 'club' } })).room; // el club trae atril
  const cb = await joined(b.token, second.room);
  await moveTo(cb, 0, 0, 3);
  const h = await api('heart', { method: 'POST', token: b.token, body: { id: second.id } });
  assert.ok(h.ok, h.error);
  assert.equal((await api(`hearts?id=${second.id}`, { token: b.token })).count, 1);
  assert.equal((await api(`hearts?id=${a.user.id}`, { token: b.token })).count, 0);
  assert.equal((await api(`profile?id=${a.user.id}`)).profile.hearts, 1);
  await cb.close();
});

test('salas: crear y borrar en bucle tiene tope por día', async () => {
  const a = await account('sl');
  await api('roomdelete', { method: 'POST', token: a.token, body: { id: a.user.id } });
  let last;
  for (let i = 0; i < 11; i++) {
    last = await api('roomcreate', { method: 'POST', token: a.token, body: { template: 'loft' } });
    if (!last.ok) break;
    await api('roomdelete', { method: 'POST', token: a.token, body: { id: last.room.id } });
  }
  assert.equal(last.ok, false);
  assert.match(last.error, /hoy/);
});
