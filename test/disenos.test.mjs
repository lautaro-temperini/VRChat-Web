// Diseños de artistas como objetos: subir, copias (solo el autor), archivos públicos, equipar estampas
// y objetos chicos en la mano, el título de Diseñador y los rechazos del control automático.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, guest, joined, inventory, api, BASE } from './helpers.mjs';

// PNG de 1×1 (el servidor mira el encabezado; el tamaño lo manda el cliente y se valida el rango)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

// GLB mínimo: una malla de un triángulo con la caja que se pida (alto = y)
function glb([x, y, z]) {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [x, y, z] }] };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(12 + 8 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, body.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

async function upload(token, fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  for (const [k, [bytes, mime]] of Object.entries(files)) fd.set(k, new Blob([bytes], { type: mime }), k);
  const res = await fetch(`${BASE}/api/design`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return res.json();
}
const stamp = (token, extra = {}) => upload(token, { kind: 'estampa', title: 'Mi estampa', place: 'espalda', size: 'grande', w: 512, h: 512, ...extra }, { img: [PNG, 'image/png'] });
const model = (token, dims, title = 'Objeto') => upload(token, { kind: 'objeto', title }, { model: [glb(dims), 'model/gltf-binary'] });

test('diseños: los invitados no suben', async () => {
  const g = await guest();
  const r = await stamp(g.token);
  assert.equal(r.ok, false);
});

test('diseños: subir una estampa deja una copia en el inventario, con sus datos', async () => {
  const a = await account('ds');
  const r = await stamp(a.token);
  assert.ok(r.ok, r.error);
  const it = (await inventory(a.token)).find((i) => i.design?.id === r.id);
  assert.ok(it, 'no está en el inventario');
  assert.equal(it.type, 'estampa');
  assert.equal(it.design.place, 'espalda');
  assert.equal(it.design.size, 'grande');
  assert.equal(it.design.author.id, a.user.id);
  // El archivo es público (se ve sobre la gente)
  const file = await fetch(`${BASE}/api/designfile?id=${r.id}&f=img`);
  assert.equal(file.status, 200);
  assert.equal((await file.arrayBuffer()).byteLength, PNG.length);
  assert.equal((await fetch(`${BASE}/api/designfile?id=${r.id}&f=model`)).status, 404);
});

test('diseños: solo el autor hace copias', async () => {
  const a = await account('ds'), b = await account('ds');
  const r = await stamp(a.token);
  const mine = (await inventory(a.token)).find((i) => i.design?.id === r.id);
  const c = await api('designcopy', { method: 'POST', token: a.token, body: { iid: mine.iid } });
  assert.ok(c.ok, c.error);
  assert.equal(c.items.filter((i) => i.design?.id === r.id).length, 2);
  // Otro no puede copiar un objeto que no tiene, ni (aunque lo tuviera) un diseño ajeno
  const d = await api('designcopy', { method: 'POST', token: b.token, body: { iid: mine.iid } });
  assert.equal(d.ok, false);
});

test('diseños: la estampa se equipa y viaja con lo que tiene puesto', async () => {
  const a = await account('ds');
  const r = await stamp(a.token);
  const it = (await inventory(a.token)).find((i) => i.design?.id === r.id);
  const e = await api('equip', { method: 'POST', token: a.token, body: { iid: it.iid, on: true } });
  assert.ok(e.ok, e.error);
  const s = e.equip.find((x) => x.type === 'estampa');
  assert.equal(s?.design.id, r.id);
  // La sala lo manda a los demás tal cual
  const ca = await joined(a.token);
  const b = await account('ds');
  const cb = await joined(b.token);
  const me = cb.welcome.players.find((p) => p.userId === a.user.id);
  assert.equal(me?.equip.find((x) => x.type === 'estampa')?.design.id, r.id);
  await ca.close(); await cb.close();
});

test('diseños: objetos 3D, control automático, mano y título de Diseñador', async () => {
  const a = await account('ds');
  // Más alto que 3 m: no pasa
  const big = await model(a.token, [0.5, 3.5, 0.5]);
  assert.equal(big.ok, false);
  assert.match(big.error, /alto/);
  // No es un GLB
  const bad = await upload(a.token, { kind: 'objeto', title: 'X' }, { model: [PNG, 'model/gltf-binary'] });
  assert.equal(bad.ok, false);
  const small = await model(a.token, [0.2, 0.3, 0.2], 'Taza');
  assert.ok(small.ok, small.error);
  const large = await model(a.token, [1, 1.2, 0.6], 'Silla');
  assert.ok(large.ok, large.error);
  assert.equal(large.designer, false);
  const inv = await inventory(a.token);
  const sm = inv.find((i) => i.design?.id === small.id), lg = inv.find((i) => i.design?.id === large.id);
  assert.equal(sm.type, 'disenoObjeto');
  assert.deepEqual(sm.design.dims, [0.2, 0.3, 0.2]);
  // Chico: en la mano; grande: no
  assert.ok((await api('equip', { method: 'POST', token: a.token, body: { iid: sm.iid, on: true } })).ok);
  assert.equal((await api('equip', { method: 'POST', token: a.token, body: { iid: lg.iid, on: true } })).ok, false);
  // El tercer objeto da el título de Diseñador
  const third = await model(a.token, [0.4, 0.4, 0.4]);
  assert.ok(third.ok && third.designer, 'no dio el título');
  const p = await api('progress', { token: a.token });
  assert.ok(p.titles.includes('disenador'));
});

test('diseños: hasta 5 subidas y 2 copias por día (M4)', async () => {
  const a = await account('ds');
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const r = await stamp(a.token);
    assert.ok(r.ok, r.error);
    ids.push(r.id);
  }
  const sixth = await stamp(a.token);
  assert.equal(sixth.ok, false);
  assert.match(sixth.error, /hoy/);
  const inv = await inventory(a.token);
  const mine = inv.find((i) => i.design?.id === ids[0]);
  for (let i = 0; i < 2; i++) assert.ok((await api('designcopy', { method: 'POST', token: a.token, body: { iid: mine.iid } })).ok);
  const third = await api('designcopy', { method: 'POST', token: a.token, body: { iid: mine.iid } });
  assert.equal(third.ok, false);
  assert.match(third.error, /hoy/);
});
