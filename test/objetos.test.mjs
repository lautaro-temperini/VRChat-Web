// Intercambios, objetos en el suelo y muebles especiales: el caso normal y los intentos de trampa
// (objetos ajenos, doble aceptación, cosas que cambian de dueño a mitad, acciones a la vez).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, guest, joined, inventory, moveTo, sleep, api } from './helpers.mjs';

// Abre un intercambio entre dos clientes ya conectados
async function openTrade(ca, cb) {
  ca.send({ t: 'trade', op: 'invite', to: cb.id });
  await cb.wait((m) => m.t === 'trade' && m.op === 'invite' && m.from === ca.id);
  cb.send({ t: 'trade', op: 'accept', from: ca.id });
  await ca.wait((m) => m.t === 'trade' && m.op === 'open');
  await cb.wait((m) => m.t === 'trade' && m.op === 'open');
}
const ends = (m) => m.t === 'trade' && ['done', 'failed', 'closed'].includes(m.op);

test('intercambio completo: los objetos cambian de dueño', async () => {
  const a = await account('tr'), b = await account('tr');
  const [x] = await inventory(a.token), [y, y2] = await inventory(b.token);
  const ca = await joined(a.token), cb = await joined(b.token);
  await openTrade(ca, cb);
  ca.send({ t: 'trade', op: 'offer', iids: [x.iid] });
  await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items.length === 1);
  cb.send({ t: 'trade', op: 'offer', iids: [y.iid, y2.iid] });
  await ca.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items.length === 2);
  ca.send({ t: 'trade', op: 'ready', v: true });
  await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.ready);
  cb.send({ t: 'trade', op: 'ready', v: true });
  assert.equal((await ca.wait(ends)).op, 'done');
  const ia = (await inventory(a.token)).map((i) => i.iid), ib = (await inventory(b.token)).map((i) => i.iid);
  assert.ok(ia.includes(y.iid) && ia.includes(y2.iid) && !ia.includes(x.iid));
  assert.ok(ib.includes(x.iid) && !ib.includes(y.iid));
  await ca.close(); await cb.close();
});

test('intercambio: no se pueden ofrecer objetos ajenos', async () => {
  const a = await account('tr'), b = await account('tr');
  const [y] = await inventory(b.token);
  const ca = await joined(a.token), cb = await joined(b.token);
  await openTrade(ca, cb);
  ca.send({ t: 'trade', op: 'offer', iids: [y.iid, 'inventado', { a: 1 }, ...Array(50).fill('x')] });
  const st = await cb.wait((m) => m.t === 'trade' && m.op === 'state');
  assert.equal(st.them.items.length, 0);
  await ca.close(); await cb.close();
});

test('intercambio: aceptar dos veces seguidas lo ejecuta una sola vez', async () => {
  const a = await account('tr'), b = await account('tr');
  const [x] = await inventory(a.token);
  const ca = await joined(a.token), cb = await joined(b.token);
  await openTrade(ca, cb);
  ca.send({ t: 'trade', op: 'offer', iids: [x.iid] });
  await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items.length === 1);
  ca.send({ t: 'trade', op: 'ready', v: true });
  await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.ready);
  const from = cb.msgs.length;
  for (let i = 0; i < 4; i++) cb.send({ t: 'trade', op: 'ready', v: true });
  await sleep(800);
  const fin = cb.since(from).filter(ends);
  assert.deepEqual(fin.map((m) => m.op), ['done'], 'un solo final, sin "failed" de una segunda ejecución');
  assert.ok((await inventory(b.token)).some((i) => i.iid === x.iid));
  await ca.close(); await cb.close();
});

test('intercambio: si el objeto se suelta a mitad, el intercambio falla y no se duplica', async () => {
  const a = await account('tr'), b = await account('tr');
  const [x] = await inventory(a.token);
  const ca = await joined(a.token), cb = await joined(b.token);
  await moveTo(ca, 0, 0, 0);
  await openTrade(ca, cb);
  ca.send({ t: 'trade', op: 'offer', iids: [x.iid] });
  await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items.length === 1);
  ca.send({ t: 'drop', iid: x.iid, x: 1, y: 0, z: 0 });
  await cb.wait((m) => m.t === 'ground+' && m.iid === x.iid);
  ca.send({ t: 'trade', op: 'ready', v: true });
  cb.send({ t: 'trade', op: 'ready', v: true });
  assert.equal((await cb.wait(ends)).op, 'failed');
  assert.ok(!(await inventory(b.token)).some((i) => i.iid === x.iid));
  assert.ok(!(await inventory(a.token)).some((i) => i.iid === x.iid), 'sigue en el suelo');
  await ca.close(); await cb.close();
});

test('intercambio: no con invitados, ni si te ignoraron', async () => {
  const a = await account('tr'), g = await guest(), b = await account('tr');
  const c1 = await joined(a.token), cg = await joined(g.token);
  await api('ignore', { method: 'POST', token: b.token, body: { id: a.user.id, on: true } });
  const cb = await joined(b.token);
  c1.send({ t: 'trade', op: 'invite', to: cb.id });
  assert.ok(await cb.none((m) => m.t === 'trade' && m.op === 'invite'), 'al que lo ignoró no le llega');
  await cb.close();
  c1.send({ t: 'trade', op: 'invite', to: cg.id });
  await c1.wait((m) => m.t === 'notice' && /invitada/.test(m.text));
  cg.send({ t: 'trade', op: 'invite', to: c1.id });
  await cg.wait((m) => m.t === 'notice' && /cuenta/.test(m.text));
  await c1.close(); await cg.close();
});

test('intercambio: la invitación repetida no le llega 20 veces al otro', async () => {
  const a = await account('tr'), b = await account('tr');
  const ca = await joined(a.token), cb = await joined(b.token);
  const from = cb.msgs.length;
  for (let i = 0; i < 20; i++) ca.send({ t: 'trade', op: 'invite', to: cb.id });
  await sleep(600);
  assert.equal(cb.since(from).filter((m) => m.t === 'trade' && m.op === 'invite').length, 1);
  await ca.close(); await cb.close();
});

test('suelo: dos juntan el mismo objeto a la vez y solo uno se lo lleva', async () => {
  const a = await account('su'), b = await account('su'), c = await account('su');
  const [x] = await inventory(a.token);
  const ca = await joined(a.token), cb = await joined(b.token), cc = await joined(c.token);
  for (const k of [ca, cb, cc]) await moveTo(k, 0, 0, 0);
  ca.send({ t: 'drop', iid: x.iid, x: 1, y: 0, z: 0 });
  await cb.wait((m) => m.t === 'ground+' && m.iid === x.iid);
  await sleep(5200); // los demás lo pueden juntar a los 5 s
  cb.send({ t: 'pickup', iid: x.iid });
  cc.send({ t: 'pickup', iid: x.iid });
  await sleep(500);
  const ib = (await inventory(b.token)).some((i) => i.iid === x.iid), ic = (await inventory(c.token)).some((i) => i.iid === x.iid);
  assert.ok(ib !== ic, 'exactamente uno de los dos lo tiene');
  await ca.close(); await cb.close(); await cc.close();
});

test('suelo: soltar el mismo objeto dos veces a la vez deja uno solo en el piso', async () => {
  const a = await account('su');
  const [x] = await inventory(a.token);
  const ca = await joined(a.token);
  await moveTo(ca, 0, 0, 0);
  ca.send({ t: 'drop', iid: x.iid, x: 1, y: 0, z: 0 });
  ca.send({ t: 'drop', iid: x.iid, x: 1, y: 0, z: 0 });
  await sleep(500);
  assert.equal(ca.msgs.filter((m) => m.t === 'ground+' && m.iid === x.iid).length, 1);
  await ca.close();
});

test('suelo: no se suelta ni se junta lejos, y los invitados no sueltan', async () => {
  const a = await account('su'), g = await guest();
  const [x] = await inventory(a.token);
  const ca = await joined(a.token), cg = await joined(g.token);
  await moveTo(ca, 0, 0, 0);
  ca.send({ t: 'drop', iid: x.iid, x: 20, y: 0, z: 0 });
  await ca.wait((m) => m.t === 'notice' && /lejos/.test(m.text));
  await moveTo(cg, 0, 0, 0);
  cg.send({ t: 'drop', iid: x.iid, x: 1, y: 0, z: 0 });
  await cg.wait('notice');
  assert.ok((await inventory(a.token)).some((i) => i.iid === x.iid));
  await ca.close(); await cg.close();
});

// ---------- Muebles especiales en la sala propia ----------

async function myRoom(acc, template = 'club') {
  const c = await joined(acc.token, `u-${acc.user.id}`);
  c.send({ t: 'edit', op: 'template', template });
  await c.wait((m) => m.t === 'layout' && m.layout.template === template);
  return c;
}

test('editor: un mueble especial puesto no vuelve al inventario con una plantilla trucha', async () => {
  const a = await account('ed');
  const sp = (await inventory(a.token)).find((i) => ['trono', 'espejos', 'sillonNeon', 'esculturaNeon'].includes(i.type));
  assert.ok(sp, 'el paquete inicial trae algún especial');
  const c = await myRoom(a);
  c.send({ t: 'edit', op: 'add', piece: { id: 'tmp1', type: sp.type, iid: sp.iid, x: 0, z: 0 } });
  await c.wait((m) => m.t === 'piece' && m.piece.iid === sp.iid);
  for (const template of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) c.send({ t: 'edit', op: 'template', template });
  await sleep(400);
  assert.ok(!(await inventory(a.token)).some((i) => i.iid === sp.iid), 'sigue puesto en la sala, no en el inventario');
  // Y con el mismo iid no se puede poner otra vez (no se duplica)
  c.send({ t: 'edit', op: 'add', piece: { id: 'tmp2', type: sp.type, iid: sp.iid, x: 1, z: 1 } });
  await c.wait((m) => m.t === 'edit-fail');
  await c.close();
});

test('editor: tipos de mueble que no son del catálogo no entran', async () => {
  const a = await account('ed');
  const c = await myRoom(a);
  const from = c.msgs.length;
  for (const type of ['constructor', '__proto__', 'toString', 'valueOf']) c.send({ t: 'edit', op: 'add', piece: { id: `t${type.length}`, type, x: 0, z: 0 } });
  await sleep(400);
  assert.ok(!c.since(from).some((m) => m.t === 'piece'));
  await c.close();
});

test('editor: un mueble especial puesto no se puede intercambiar ni soltar', async () => {
  const a = await account('ed'), b = await account('ed');
  const sp = (await inventory(a.token)).find((i) => ['trono', 'espejos', 'sillonNeon', 'esculturaNeon'].includes(i.type));
  const c = await myRoom(a);
  c.send({ t: 'edit', op: 'add', piece: { id: 'tmp1', type: sp.type, iid: sp.iid, x: 0, z: 0 } });
  await c.wait((m) => m.t === 'piece' && m.piece.iid === sp.iid);
  await moveTo(c, 0, 0, 4);
  c.send({ t: 'drop', iid: sp.iid, x: 0, y: 0, z: 4 });
  await c.wait((m) => m.t === 'notice' && /no es tuyo/.test(m.text));
  const cb = await joined(b.token, `u-${a.user.id}`);
  await openTrade(c, cb);
  c.send({ t: 'trade', op: 'offer', iids: [sp.iid] });
  const st = await cb.wait((m) => m.t === 'trade' && m.op === 'state');
  assert.equal(st.them.items.length, 0);
  await c.close(); await cb.close();
});

test('editor: solo edita el dueño, y los invitados no tienen sala para editar', async () => {
  const a = await account('ed'), b = await account('ed'), g = await guest();
  const ca = await myRoom(a);
  const cb = await joined(b.token, `u-${a.user.id}`);
  cb.send({ t: 'edit', op: 'add', piece: { id: 'x1', type: 'silla', x: 0, z: 0 } });
  await cb.wait((m) => m.t === 'notice' && /dueño/.test(m.text));
  const cg = await joined(g.token, `u-${g.user.id}`);
  cg.send({ t: 'edit', op: 'template', template: 'club' });
  assert.ok(await cg.none('layout'));
  await ca.close(); await cb.close(); await cg.close();
});

test('premio: un objeto que ya no existe no se puede juntar del suelo de otra sala', async () => {
  const a = await account('su');
  const [x] = await inventory(a.token);
  const ca = await joined(a.token);
  await moveTo(ca, 0, 0, 0);
  ca.send({ t: 'drop', iid: x.iid, x: 1, y: 0, z: 0 });
  await ca.wait((m) => m.t === 'ground+');
  // En otra sala ese objeto no está en el piso
  const b = await account('su');
  const cb = await joined(b.token, `u-${b.user.id}`);
  await moveTo(cb, 0, 0, 4);
  cb.send({ t: 'pickup', iid: x.iid });
  await cb.wait((m) => m.t === 'notice' && /ya no está/.test(m.text));
  await ca.close(); await cb.close();
  assert.ok((await api('inventory', { token: b.token })).items.every((i) => i.iid !== x.iid));
});
