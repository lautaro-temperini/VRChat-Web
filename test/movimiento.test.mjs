// Posiciones falsas (teletransporte) y vencimiento de sesiones (decisiones del usuario, 26/10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, joined, sleep } from './helpers.mjs';
import { sessionState, SESSION_IDLE } from '../server/sessions.js';

// Se entra junto a la puerta del Museo (la sala corrige a quien aparece lejos de la entrada)
const X0 = -27.5;

test('movimiento: un salto imposible no se acepta y vuelve a la última posición válida', async () => {
  const a = await account('mv'), b = await account('mv');
  const ca = await joined(a.token, 'museo', [X0, 0, 0, 0, 0, 0]), cb = await joined(b.token);
  ca.send({ t: 's', s: [X0 + 40, 0, 0, 0, 0, 0] });
  const fix = await ca.wait('pos-fix', { what: 'la corrección' });
  assert.deepEqual([fix.x, fix.z], [X0, 0]);
  assert.ok(await cb.none((m) => m.t === 's' && m.id === ca.id && m.s[0] === X0 + 40, 500), 'los demás lo vieron teletransportarse');
  await ca.close(); await cb.close();
});

test('movimiento: caminar (aunque sea rápido o con lag) se acepta', async () => {
  const a = await account('mv'), b = await account('mv');
  const ca = await joined(a.token, 'museo', [X0, 0, 0, 0, 0, 0]), cb = await joined(b.token);
  for (let i = 1; i <= 6; i++) { ca.send({ t: 's', s: [X0 + i * 0.4, 0, 0, 0, 0, 0] }); await sleep(100); }
  ca.send({ t: 's', s: [X0 + 8, 0, 0, 0, 0, 0] }); // lag: llega todo junto (dentro del margen)
  await cb.wait((m) => m.t === 's' && m.id === ca.id && m.s[0] === X0 + 8, { what: 'la posición' });
  assert.ok(!ca.msgs.some((m) => m.t === 'pos-fix'));
  await ca.close(); await cb.close();
});

test('movimiento: muchos pasitos seguidos no sirven para ir más rápido', async () => {
  const a = await account('mv');
  const ca = await joined(a.token, 'museo', [X0, 0, 0, 0, 0, 0]);
  for (let i = 1; i <= 40; i++) ca.send({ t: 's', s: [X0 + i * 0.9, 0, 0, 0, 0, 0] });
  await ca.wait('pos-fix', { what: 'la corrección' });
  await ca.close();
});

test('sesiones: vencen a los 30 días sin usarse y el uso corre la fecha', () => {
  const now = Date.now();
  assert.equal(sessionState(now - 1000, null, now), 'ok');
  assert.equal(sessionState(now - 2 * 3_600_000, null, now), 'refresh');
  assert.equal(sessionState(now - SESSION_IDLE - 1, null, now), 'expired');
  // Creada hace mucho pero usada hace poco: sigue valiendo
  assert.equal(sessionState(now - 90 * 86_400_000, now - 86_400_000, now), 'refresh');
  assert.equal(sessionState(now - 90 * 86_400_000, now - 31 * 86_400_000, now), 'expired');
});
