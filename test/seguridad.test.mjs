// Una prueba por cada agujero cerrado (ver docs/ramas/seguridad.md), para que no vuelvan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, guest, joined, Client, api, sleep, moveTo, BASE } from './helpers.mjs';

// ---------- Sala (WebSocket) ----------

test('gestos y ajustes con nombres de JavaScript (constructor, toString…) no pasan', async () => {
  const a = await account('js'), b = await account('js');
  const own = await joined(a.token, `u-${a.user.id}`); // el dueño modera su sala
  const cb = await joined(b.token, `u-${a.user.id}`);
  const from = cb.msgs.length;
  for (const e of ['constructor', '__proto__', 'toString']) own.send({ t: 'emote', e });
  for (const key of ['toString', '__proto__', 'constructor']) own.send({ t: 'mod', op: 'setting', key, value: false });
  await sleep(500);
  assert.ok(!cb.since(from).some((m) => m.t === 'emote' || m.t === 'settings'));
  own.send({ t: 'emote', e: 'saludar' });
  await cb.wait((m) => m.t === 'emote' && m.e === 'saludar');
  await own.close(); await cb.close();
});

test('moderar sin decir a quién no rompe la sala', async () => {
  const a = await account('mo');
  const own = await joined(a.token, `u-${a.user.id}`);
  own.send({ t: 'edit', op: 'template', template: 'club' });
  await own.wait('layout');
  own.send({ t: 'dj', on: true, streamId: 'x' });
  await own.wait((m) => m.t === 'dj' && m.on);
  for (const op of ['kick', 'ban', 'silence', 'bring', 'spawn']) own.send({ t: 'mod', op });
  await sleep(400);
  // La sala sigue entera: el que entra ve al DJ (si se hubiera roto, se perdería lo que está en memoria)
  const c = await joined((await account('mo')).token, `u-${a.user.id}`);
  assert.equal(c.welcome.dj?.id, own.id);
  await own.close(); await c.close();
});

test('solo moderan los mods: en el Museo nadie que no sea admin', async () => {
  const a = await account('mo'), b = await account('mo');
  const ca = await joined(a.token), cb = await joined(b.token);
  ca.send({ t: 'mod', op: 'kick', target: cb.id });
  await ca.wait((m) => m.t === 'notice' && /permisos/.test(m.text));
  assert.equal(cb.closed, null);
  await ca.close(); await cb.close();
});

test('el dueño no puede moderar a un admin ni el invitado es dueño de "su" sala', async () => {
  const g = await guest(), b = await account('mo');
  const cg = await joined(g.token, `u-${g.user.id}`);
  assert.equal(cg.welcome.room.mod, false, 'un invitado no modera');
  const cb = await joined(b.token, `u-${g.user.id}`).catch(() => null);
  if (cb) {
    cg.send({ t: 'mod', op: 'kick', target: cb.id });
    await cg.wait((m) => m.t === 'notice' && /permisos/.test(m.text));
    await cb.close();
  }
  await cg.close();
});

test('antiflood general: una ráfaga de posiciones no se reenvía entera', async () => {
  const a = await account('fl'), b = await account('fl');
  const ca = await joined(a.token), cb = await joined(b.token);
  const from = cb.msgs.length;
  for (let i = 0; i < 600; i++) ca.send({ t: 's', s: [i / 100, 0, 0, 0, 0, 0] });
  await sleep(800);
  const got = cb.since(from).filter((m) => m.t === 's' && m.id === ca.id).length;
  assert.ok(got > 50 && got < 300, `llegaron ${got} de 600`);
  // Y a ritmo normal (10 por segundo) llega todo
  await sleep(3000);
  const from2 = cb.msgs.length;
  for (let i = 0; i < 10; i++) { ca.send({ t: 's', s: [1 + i, 0, 0, 0, 0, 0] }); await sleep(100); }
  await sleep(200);
  assert.equal(cb.since(from2).filter((m) => m.t === 's' && m.id === ca.id).length, 10);
  await ca.close(); await cb.close();
});

test('antiflood: los gestos en ráfaga no le llegan todos a los demás', async () => {
  const a = await account('fl'), b = await account('fl');
  const ca = await joined(a.token), cb = await joined(b.token);
  const from = cb.msgs.length;
  for (let i = 0; i < 200; i++) ca.send({ t: 'emote', e: 'saludar' });
  await sleep(800);
  const got = cb.since(from).filter((m) => m.t === 'emote').length;
  assert.ok(got <= 40, `llegaron ${got} de 200`);
  await ca.close(); await cb.close();
});

test('posiciones: números raros se rechazan y las enormes se acotan', async () => {
  const a = await account('po'), b = await account('po');
  const ca = await joined(a.token), cb = await joined(b.token);
  for (const s of [[1, 2, 3], ['1', 0, 0, 0, 0, 0], [null, 0, 0, 0, 0, 0], [1e400, 0, 0, 0, 0, 0], 'hola', { 0: 1 }]) ca.send({ t: 's', s });
  ca.send('{"t":"s","s":[NaN,0,0,0,0,0]}');
  ca.send({ t: 's', s: [1e300, -1e300, 0, 0, 0, 99] });
  const m = await cb.wait((x) => x.t === 's' && x.id === ca.id);
  assert.deepEqual(m.s, [500, -500, 0, 0, 0, 5]);
  await ca.close(); await cb.close();
});

test('mensajes mal formados no rompen la sala', async () => {
  const a = await account('mf');
  const c = await joined(a.token);
  for (const raw of ['null', '1', '"t"', '[]', '{"t":5}', '{"t":{"x":1}}', '{"t":"trade","op":"invite","to":{"a":1}}',
    '{"t":"group","op":"invite","to":["x"]}', '{"t":"sfu","op":"pull","items":[null,5,{"id":{"a":1}}]}', '{"t":"edit","op":"add"}',
    '{"t":"part","part":"__proto__","on":true}', '{"t":"luces","s":{"focos":"x"}}', '{"t":"pickup","iid":{"x":1}}', '{"t":"drop","iid":[1],"x":"a"}', 'x'.repeat(70_000)]) c.send(raw);
  c.send({ t: 'chat', text: 'sigo vivo' });
  await c.wait((m) => m.t === 'chat' && m.text === 'sigo vivo');
  await c.close();
});

test('una conexión que no entra se cierra sola (y ya no puede entrar)', { timeout: 30_000 }, async () => {
  const a = await account('nj');
  const c = new Client(a.token);
  await c.open();
  await sleep(16_500);
  // En producción la sala la cierra; wrangler dev a veces no le avisa el cierre al cliente,
  // así que se prueba lo que importa: esa conexión ya no sirve para entrar
  if (c.closed === null) {
    c.send({ t: 'join', token: a.token, s: [0, 0, 0, 0, 0, 0] });
    assert.ok(await c.none('welcome', 1000), 'no entra después del tiempo límite');
  }
  await c.close();
});

test('el invitado no puede pasar a otro intercambio ni grupo por la API de la sala', async () => {
  const g = await guest(), b = await account('gu');
  const cg = await joined(g.token), cb = await joined(b.token);
  cg.send({ t: 'group', op: 'invite', to: cb.id });
  await cg.wait((m) => m.t === 'notice' && /cuenta/.test(m.text));
  cb.send({ t: 'group', op: 'invite', to: cg.id });
  await cb.wait((m) => m.t === 'notice' && /invitado/.test(m.text));
  await cg.close(); await cb.close();
});

test('grupo: alguien ignorado no te puede invitar (y no se entera)', async () => {
  const a = await account('ig'), b = await account('ig');
  assert.ok((await api('ignore', { method: 'POST', token: b.token, body: { id: a.user.id, on: true } })).ok);
  const ca = await joined(a.token), cb = await joined(b.token);
  ca.send({ t: 'group', op: 'invite', to: cb.id });
  await ca.wait((m) => m.t === 'group' && m.op === 'sent');
  assert.ok(await cb.none((m) => m.t === 'group' && m.op === 'invite'));
  await ca.close(); await cb.close();
});

test('grupo: no pasa de 4 aunque acepten a la vez', async () => {
  const lead = await account('gr');
  const others = await Promise.all([1, 2, 3, 4, 5].map(() => account('gr')));
  const cl = await joined(lead.token);
  const cs = [];
  for (const o of others) cs.push(await joined(o.token));
  // Arma el grupo con el primero
  cl.send({ t: 'group', op: 'invite', to: cs[0].id });
  await cs[0].wait((m) => m.t === 'group' && m.op === 'invite');
  cs[0].send({ t: 'group', op: 'respond', from: cl.id, accept: true });
  await cl.wait((m) => m.t === 'groups' && Object.keys(m.groups).length === 1);
  // Invita a los otros 4 y aceptan todos juntos
  for (const c of cs.slice(1)) { cl.send({ t: 'group', op: 'invite', to: c.id }); await c.wait((m) => m.t === 'group' && m.op === 'invite'); }
  for (const c of cs.slice(1)) c.send({ t: 'group', op: 'respond', from: cl.id, accept: true });
  await sleep(600);
  const last = [...cl.msgs].reverse().find((m) => m.t === 'groups');
  assert.equal(Object.values(last.groups)[0].members.length, 4);
  await cl.close(); for (const c of cs) await c.close();
});

test('DJ y consola: en una sala personal solo si están los muebles', async () => {
  const a = await account('dj'), b = await account('dj');
  const own = await joined(a.token, `u-${a.user.id}`); // sin elegir plantilla: loft, sin cabina ni consola
  const cb = await joined(b.token, `u-${a.user.id}`);
  cb.send({ t: 'dj', on: true, streamId: 'x' });
  await cb.wait((m) => m.t === 'dj' && m.denied);
  cb.send({ t: 'part', part: 'luces', on: true });
  await cb.wait((m) => m.t === 'part' && m.denied);
  cb.send({ t: 'part', part: 'escenario2', on: true });
  await cb.wait((m) => m.t === 'part' && m.denied);
  own.send({ t: 'edit', op: 'template', template: 'club' }); // el club trae cabina, consola y una pantalla
  await cb.wait('layout');
  cb.send({ t: 'dj', on: true, streamId: 'x' });
  await cb.wait((m) => m.t === 'dj' && m.on && m.id === cb.id);
  await own.close(); await cb.close();
});

test('la pantalla vieja del hall ya no se puede tomar', async () => {
  const a = await account('sc'), b = await account('sc');
  const ca = await joined(a.token), cb = await joined(b.token);
  ca.send({ t: 'screen', on: true, streamId: 'x' });
  assert.ok(await cb.none('screen'));
  await ca.close(); await cb.close();
});

test('salas: solo el Museo y las de cuentas que existen', async () => {
  const a = await account('sa');
  const bad = new Client(a.token, 'cualquiera');
  await assert.rejects(bad.open());
  const c = new Client(a.token, 'u-0000000000000000');
  const w = await c.join();
  assert.equal(w.t, 'error');
  await c.close();
});

test('soltar: no se puede usar una posición inventada lejos de la propia', async () => {
  const a = await account('so');
  const c = await joined(a.token);
  const [x] = (await api('inventory', { token: a.token })).items;
  await moveTo(c, 10, 0, 10);
  c.send({ t: 'drop', iid: x.iid, x: 0, y: 0, z: 0 });
  await c.wait((m) => m.t === 'notice' && /lejos/.test(m.text));
  await c.close();
});

// ---------- API ----------

test('API: restringir, ignorar y reportar solo a cuentas que existen', async () => {
  const a = await account('ap');
  for (const path of ['block', 'ignore']) {
    const r = await api(path, { method: 'POST', token: a.token, body: { id: 'x'.repeat(5000), on: true } });
    assert.equal(r.ok, false, path);
  }
  const r = await api('report', { method: 'POST', token: a.token, body: { target: { a: 1 }, reason: 'spam' } });
  assert.equal(r.ok, false);
});

test('API: el buscador no dice en qué sala está alguien que no es tu amigo', async () => {
  const a = await account('bu'), b = await account('bu');
  const cb = await joined(b.token);
  const r = await api(`search?q=${b.nick}`, { token: a.token });
  const hit = r.results.find((x) => x.id === b.user.id);
  assert.ok(hit);
  assert.equal(hit.online, true);
  assert.equal(hit.room, null);
  // Siendo amigos, sí
  await api('friendrequest', { method: 'POST', token: a.token, body: { id: b.user.id } });
  await api('friendrespond', { method: 'POST', token: b.token, body: { id: a.user.id, accept: true } });
  const r2 = await api(`search?q=${b.nick}`, { token: a.token });
  assert.equal(r2.results.find((x) => x.id === b.user.id).room, 'museo');
  await cb.close();
});

test('API: el corazón se deja estando en la sala', async () => {
  const a = await account('co'), b = await account('co');
  let r = await api('heart', { method: 'POST', token: b.token, body: { id: a.user.id } });
  assert.equal(r.ok, false);
  const cb = await joined(b.token, `u-${a.user.id}`);
  r = await api('heart', { method: 'POST', token: b.token, body: { id: a.user.id } });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  await cb.close();
});

test('API: la vista previa de links pide sesión y no entra a direcciones internas', async () => {
  let r = await api(`preview?url=${encodeURIComponent('https://example.com')}`);
  assert.equal(r.ok, false);
  const a = await account('pv');
  for (const u of ['http://127.0.0.1:8790/api/museum', 'http://localhost/', 'http://169.254.169.254/', 'http://2130706433/', 'http://[::1]/', 'file:///etc/passwd', `${BASE}/api/museum`]) {
    r = await api(`preview?url=${encodeURIComponent(u)}`, { token: a.token });
    assert.equal(r.ok, false, u);
  }
});

test('API: una "foto" que no es imagen no se guarda, y las fotos se sirven con nosniff', async () => {
  const a = await account('fo');
  let r = await api('photo?w=10&h=10', { method: 'POST', token: a.token, headers: { 'content-type': 'image/png' }, raw: '<html><script>alert(1)</script></html>' });
  assert.equal(r.ok, false);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001', 'hex');
  r = await api('photo?w=Infinity&h=-5', { method: 'POST', token: a.token, headers: { 'content-type': 'image/png' }, raw: png });
  assert.ok(r.ok, r.error);
  const res = await fetch(`${BASE}/api/photo?id=${r.id}`, { headers: { Authorization: `Bearer ${a.token}` } });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const list = await api(`photos?id=${a.user.id}`, { token: a.token });
  const p = list.photos.find((x) => x.id === r.id);
  assert.equal(p.w, 10000, 'se acota');
  assert.equal(p.h, 0);
});

test('API: fotos privadas no se ven de afuera', async () => {
  const a = await account('fp'), b = await account('fp');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const up = await api('photo?w=1&h=1', { method: 'POST', token: a.token, headers: { 'content-type': 'image/png' }, raw: png });
  assert.ok(up.ok);
  await api('galleryprivacy', { method: 'POST', token: a.token, body: { privacy: 'nadie' } });
  const res = await fetch(`${BASE}/api/photo?id=${up.id}`, { headers: { Authorization: `Bearer ${b.token}` } });
  assert.equal(res.status, 404);
  const list = await api(`photos?id=${a.user.id}`, { token: b.token });
  assert.equal(list.hidden, true);
  assert.equal(list.photos.length, 0);
});

test('API: el ingreso con Google solo vuelve al mismo sitio', async () => {
  const r = await api('oauthstart', { method: 'POST', body: { provider: 'google', origin: 'https://otro-sitio.example' }, headers: { Origin: BASE } });
  assert.equal(r.ok, false);
  const ok = await api('oauthstart', { method: 'POST', body: { provider: 'google', origin: BASE }, headers: { Origin: BASE } });
  assert.equal(ok.ok, true);
  assert.ok(ok.url.includes(encodeURIComponent(`${BASE}/api/oauth/google/callback`)));
});

test('API: lo privado de otro no se lee (progreso, avisos, obras, inventario)', async () => {
  const a = await account('pr');
  for (const path of ['progress', 'notifications', 'myworks', 'inventory', 'friends', 'favorites', 'ignores', 'blocks', 'review', 'worksadmin', 'reports']) {
    const r = await api(path);
    assert.equal(r.ok, false, `${path} sin sesión`);
  }
  for (const path of ['review', 'worksadmin', 'reports']) {
    const r = await api(path, { token: a.token });
    assert.equal(r.ok, false, `${path} sin ser curador/admin`);
  }
  const t = await api('title', { method: 'POST', token: a.token, body: { nick: a.nick, title: 'curador' } });
  assert.equal(t.ok, false, 'nadie se nombra curador solo');
});

test('API: los invitados no usan lo de cuentas', async () => {
  const g = await guest();
  for (const [path, body] of [['note', { text: 'hola' }], ['like', { type: 'note', id: 'x', on: true }], ['heart', { id: 'x' }], ['equip', { iid: 'x', on: true }]]) {
    const r = await api(path, { method: 'POST', token: g.token, body });
    assert.equal(r.ok, false, path);
  }
  const r = await api('myroom', { method: 'PUT', token: g.token, body: { name: 'mía' } });
  assert.equal(r.ok, false);
});
