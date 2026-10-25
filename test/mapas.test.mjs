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
