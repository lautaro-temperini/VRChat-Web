// Amistad, restringir, invitados y OAuth (docs/hallazgos.md: C2, A2, A11, B10, B14, B15, B16, M17, M18)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, guest, joined, api, sleep, BASE, Client } from './helpers.mjs';

async function friends(a, b) {
  await api('friendrequest', { method: 'POST', token: a.token, body: { id: b.user.id } });
  await api('friendrespond', { method: 'POST', token: b.token, body: { id: a.user.id, accept: true } });
}

test('amistad: la sala en vivo solo la ven los amigos, y nunca quien te restringió (C2)', async () => {
  const a = await account('am'), b = await account('am');
  const cb = await joined(b.token, 'plaza');
  await api('friendrequest', { method: 'POST', token: a.token, body: { id: b.user.id } });
  let f = await api('friends', { token: a.token });
  assert.equal(f.outgoing.find((x) => x.id === b.user.id)?.room, null, 'una solicitud pendiente ve la sala');
  await api('friendrespond', { method: 'POST', token: b.token, body: { id: a.user.id, accept: true } });
  f = await api('friends', { token: a.token });
  assert.equal(f.friends.find((x) => x.id === b.user.id)?.room, 'plaza');
  await api('block', { method: 'POST', token: b.token, body: { id: a.user.id, on: true } });
  f = await api('friends', { token: a.token });
  assert.equal(f.friends.find((x) => x.id === b.user.id)?.room, null, 'el restringido sigue viendo la sala');
  const s = await api(`search?q=${b.nick}`, { token: a.token });
  assert.equal(s.results.find((x) => x.id === b.user.id)?.room, null);
  await cb.close();
});

test('amistad: los invitados no mandan ni reciben solicitudes (B14)', async () => {
  const g = await guest(), a = await account('am');
  assert.equal((await api('friendrequest', { method: 'POST', token: g.token, body: { id: a.user.id } })).ok, false);
  assert.equal((await api('friendrequest', { method: 'POST', token: a.token, body: { id: g.user.id } })).ok, false);
});

test('amistad: cancelar y reenviar no llena los avisos (A11)', async () => {
  const a = await account('am'), b = await account('am');
  for (let i = 0; i < 5; i++) {
    await api('friendrequest', { method: 'POST', token: a.token, body: { id: b.user.id } });
    await api('friendremove', { method: 'POST', token: a.token, body: { id: b.user.id } });
  }
  const n = await api('notifications', { token: b.token });
  assert.equal(n.items.filter((x) => x.type === 'friend_request').length, 1);
});

test('invitados: solo leen — sin favoritas ni reportes (B15); favoritas solo de salas que existen (B10)', async () => {
  const g = await guest(), a = await account('am');
  assert.equal((await api('favorite', { method: 'POST', token: g.token, body: { room: 'museo', on: true } })).ok, false);
  assert.equal((await api('report', { method: 'POST', token: g.token, body: { target: a.user.id, reason: 'otro' } })).ok, false);
  assert.equal((await api('favorite', { method: 'POST', token: a.token, body: { room: 'no-existe', on: true } })).ok, false);
  assert.ok((await api('favorite', { method: 'POST', token: a.token, body: { room: 'plaza', on: true } })).ok);
});

test('salas de amigos: restringir o sacar de amigos echa a quien está adentro (M17, M18)', async () => {
  const owner = await account('am'), x = await account('am'), y = await account('am');
  await friends(owner, x);
  await friends(owner, y);
  assert.ok((await api('myroom', { method: 'PUT', token: owner.token, body: { privacy: 'amigos' } })).ok);
  const room = `u-${owner.user.id}`;
  const cx = await joined(x.token, room), cy = await joined(y.token, room);
  await api('block', { method: 'POST', token: owner.token, body: { id: x.user.id, on: true } });
  await cx.wait((m) => m.t === 'kicked' && m.access, { what: 'que lo echen al restringirlo' });
  await api('friendremove', { method: 'POST', token: owner.token, body: { id: y.user.id } });
  await cy.wait((m) => m.t === 'kicked' && m.access, { what: 'que lo echen al sacarlo de amigos' });
  // Y ya no entra
  const again = new Client(x.token, room);
  const w = await again.join();
  assert.notEqual(w.t, 'welcome');
  await again.close();
});

test('salas: cerrar la sala echa a quien no es el dueño (M18)', async () => {
  const owner = await account('am'), x = await account('am');
  const room = `u-${owner.user.id}`;
  const cx = await joined(x.token, room);
  await api('myroom', { method: 'PUT', token: owner.token, body: { privacy: 'cerrada' } });
  await cx.wait((m) => m.t === 'kicked' && m.access, { what: 'que lo echen al cerrar' });
});

test('perfil: guardar sin el personaje no lo borra (B16)', async () => {
  const a = await account('am');
  const me = await api('me', { token: a.token });
  await api('me', { method: 'PUT', token: a.token, body: { name: me.user.name, bio: 'hola' } });
  const after = await api('me', { token: a.token });
  assert.deepEqual(after.user.look, me.user.look);
});

test('oauth: el ingreso queda atado al navegador que lo empezó (A2)', async () => {
  const origin = new URL(BASE).origin;
  const res = await fetch(`${BASE}/api/oauthstart`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify({ provider: 'google', origin }) });
  const r = await res.json();
  if (!r.ok) return; // sin client id configurado en este servidor
  assert.match(res.headers.get('set-cookie') ?? '', /g_oauth=[0-9a-f]{32}/);
  const state = new URL(r.url).searchParams.get('state');
  // Otro navegador (sin la cookie) que abre la vuelta con ese state: no entra
  const cb = await fetch(`${BASE}/api/oauth/google/callback?state=${state}&code=x`, { redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location') ?? '', /loginerror/);
  // Volver a un sitio ajeno no se permite
  const evil = await fetch(`${BASE}/api/oauthstart`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://otro.example' }, body: JSON.stringify({ provider: 'google', origin: 'https://otro.example' }) });
  assert.equal((await evil.json()).ok, false);
  await sleep(10);
});

test('nombres: un invitado no se puede llamar como una cuenta con letras que se confunden ni invisibles (M19)', async () => {
  const a = await account('mi');
  for (const fake of [a.nick.replace('i', 'і'), `${a.nick.slice(0, 2)}​${a.nick.slice(2)}`, a.nick.toUpperCase().replace('I', '1')]) {
    const r = await api('guest', { method: 'POST', body: { name: fake, terms: true } });
    assert.equal(r.ok, false, `entró como "${fake}"`);
  }
  // Un nombre todo invisible no queda vacío
  const g = await api('guest', { method: 'POST', body: { name: '​​‮', terms: true } });
  assert.ok(g.ok);
  assert.equal(g.user.name, 'Visitante');
});
