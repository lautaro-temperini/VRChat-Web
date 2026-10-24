// Lo básico de la sala con varios clientes: verse, moverse, chat, cortes y reconexión.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, guest, joined, Client, sleep } from './helpers.mjs';

test('dos jugadores se ven y se mueven', async () => {
  const a = await account('ver'), b = await account('ver');
  const ca = await joined(a.token);
  const cb = await joined(b.token, 'museo', [1, 0, 1, 0, 0, 0]);
  assert.ok(cb.welcome.players.some((p) => p.id === ca.id && p.userId === a.user.id), 'B ve a A al entrar');
  const j = await ca.wait((m) => m.t === 'join' && m.id === cb.id);
  assert.equal(j.name, b.nick, 'el nombre sale de la cuenta');
  cb.send({ t: 's', s: [2.5, 0, -3, 1.2, 1.6, 0] });
  const s = await ca.wait((m) => m.t === 's' && m.id === cb.id);
  assert.deepEqual(s.s, [2.5, 0, -3, 1.2, 1.6, 0]);
  await ca.close(); await cb.close();
});

test('chat: llega a todos y respeta el antiflood', async () => {
  const a = await account('chat'), b = await account('chat');
  const ca = await joined(a.token), cb = await joined(b.token);
  ca.send({ t: 'chat', text: '  hola <b>museo</b>\u0007 ' });
  const m = await cb.wait((x) => x.t === 'chat' && x.id === ca.id);
  assert.equal(m.text, 'hola <b>museo</b>');
  assert.equal(m.name, a.nick);
  // El mismo mensaje dos veces seguidas no pasa
  ca.send({ t: 'chat', text: 'hola <b>museo</b>' });
  await ca.wait((x) => x.t === 'notice' && /Ya mandaste/.test(x.text));
  // Más de 5 en 10 s tampoco
  for (let i = 0; i < 6; i++) ca.send({ t: 'chat', text: `msg ${i}` });
  await ca.wait((x) => x.t === 'notice' && /muy rápido/.test(x.text));
  await ca.close(); await cb.close();
});

test('el invitado chatea pero no prende el micrófono', async () => {
  const g = await guest('Mirón');
  const c = await joined(g.token);
  c.send({ t: 'mic', v: 'on' });
  await c.wait('mic-denied');
  await c.close();
});

test('corte y reconexión: el otro deja de verlo y lo vuelve a ver, sin fantasmas', async () => {
  const a = await account('rec'), b = await account('rec');
  const ca = await joined(a.token), cb = await joined(b.token);
  await ca.wait((m) => m.t === 'join' && m.id === cb.id);
  await cb.close();
  await ca.wait((m) => m.t === 'leave' && m.id === cb.id);
  const cb2 = await joined(b.token);
  const j = await ca.wait((m) => m.t === 'join' && m.id === cb2.id);
  assert.equal(j.userId, b.user.id);
  // Quien entra después solo ve conexiones vivas
  const c3 = await joined((await account('rec')).token);
  const ids = c3.welcome.players.map((p) => p.id);
  assert.ok(!ids.includes(cb.id), 'la conexión vieja no quedó como fantasma');
  assert.ok(ids.includes(cb2.id) && ids.includes(ca.id));
  await ca.close(); await cb2.close(); await c3.close();
});

test('al cortarse se liberan DJ, consola, grupo e intercambio', async () => {
  const a = await account('lib'), b = await account('lib');
  const ca = await joined(a.token), cb = await joined(b.token);
  ca.send({ t: 'dj', on: true, streamId: 's1' });
  await cb.wait((m) => m.t === 'dj' && m.on && m.id === ca.id);
  ca.send({ t: 'part', part: 'luces', on: true });
  await cb.wait((m) => m.t === 'part' && m.part === 'luces' && m.on);
  // Grupo de voz
  ca.send({ t: 'group', op: 'invite', to: cb.id });
  await cb.wait((m) => m.t === 'group' && m.op === 'invite');
  cb.send({ t: 'group', op: 'respond', from: ca.id, accept: true });
  await cb.wait((m) => m.t === 'groups' && Object.keys(m.groups).length === 1);
  // Intercambio abierto
  cb.send({ t: 'trade', op: 'invite', to: ca.id });
  await ca.wait((m) => m.t === 'trade' && m.op === 'invite');
  ca.send({ t: 'trade', op: 'accept', from: cb.id });
  await cb.wait((m) => m.t === 'trade' && m.op === 'open');

  await ca.close();
  await cb.wait((m) => m.t === 'dj' && m.on === false && m.id === ca.id);
  await cb.wait((m) => m.t === 'part' && m.part === 'luces' && m.on === false);
  await cb.wait((m) => m.t === 'trade' && m.op === 'closed');
  await cb.close();
  // Se fueron los dos: el grupo no queda colgado y la cabina está libre
  const c = await joined((await account('lib')).token);
  assert.deepEqual(c.welcome.groups, {});
  assert.equal(c.welcome.dj, null);
  assert.deepEqual(c.welcome.parts, {});
  await c.close();
});

test('sin sesión no se entra', async () => {
  const c = new Client('x'.repeat(64));
  const w = await c.join();
  assert.equal(w.t, 'error');
  assert.equal(w.code, 'auth');
  await sleep(100);
  assert.ok(c.closed, 'la sala cierra la conexión');
});
