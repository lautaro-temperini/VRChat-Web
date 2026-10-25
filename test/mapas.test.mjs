// Mapas públicos: se entra como al Museo, traen su diseño fijo y nadie (ni admins) lo edita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, joined, sleep } from './helpers.mjs';

test('mapas públicos: la Plaza trae su diseño fijo y no se edita', async () => {
  const a = await account('mp');
  const c = await joined(a.token, 'plaza');
  assert.equal(c.welcome.layout?.template, 'plaza');
  assert.ok(c.welcome.layout.pieces.length >= 8, 'faltan los bancos');
  assert.ok(c.welcome.layout.pieces.every((p) => p.type === 'bancoPlaza'));
  c.send({ t: 'edit', op: 'template', template: 'loft' });
  c.send({ t: 'edit', op: 'remove', id: 'm0' });
  await c.wait((m) => m.t === 'notice', { what: 'aviso de que no se edita' });
  await sleep(300);
  assert.ok(!c.msgs.some((m) => m.t === 'layout' || m.t === 'piece-'), 'se pudo editar');
  await c.close();
});

test('mapas públicos: una sala que no existe no abre', async () => {
  const a = await account('mp');
  await assert.rejects(joined(a.token, 'plazita'));
});

test('mapas públicos: en la Cafetería la barra da café (de cerca) y el atril muestra las últimas notas', async () => {
  const { moveTo, api } = await import('./helpers.mjs');
  const a = await account('mp');
  await api('note', { method: 'POST', token: a.token, body: { text: 'Hola desde el test del café' } });
  const notes = await api('latestnotes', { token: a.token });
  assert.ok(notes.ok && notes.notes.some((n) => n.text === 'Hola desde el test del café' && n.author.id === a.user.id));
  const c = await joined(a.token, 'cafeteria');
  const bar = c.welcome.layout.pieces.find((p) => p.type === 'barraCafe');
  assert.ok(bar, 'falta la barra');
  // De lejos no
  await moveTo(c, -5, 0, 3.5);
  c.send({ t: 'consume', from: 'piece', piece: bar.id });
  assert.ok(await c.none((m) => m.t === 'consume' && m.id === c.id, 600));
  await moveTo(c, bar.x, 0, bar.z + 1);
  c.send({ t: 'consume', from: 'piece', piece: bar.id });
  const m = await c.wait((x) => x.t === 'consume' && x.id === c.id, { what: 'el café' });
  assert.equal(m.kind, 'cafe');
  await c.close();
});
