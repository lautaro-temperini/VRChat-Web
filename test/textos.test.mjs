// Textos que escribe la gente fuera del chat (sobre mí, notas, salas, mensajes): sin invisibles, texto
// invertido ni "zalgo", como el chat y los nombres (hallazgo M20 extendido)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, api } from './helpers.mjs';

const DIRTY = 'ho​la ‮dado vuelta ź̂̃̄̅';
const CLEAN = 'hola dado vuelta ź̂';

test('textos: sobre mí, notas y salas se limpian igual que el chat', async () => {
  const a = await account('tx');
  await api('me', { method: 'PUT', token: a.token, body: { name: a.nick, bio: `${DIRTY}\nsegunda línea` } });
  assert.equal((await api('me', { token: a.token })).user.bio, `${CLEAN}\nsegunda línea`);
  const n = await api('note', { method: 'POST', token: a.token, body: { text: DIRTY } });
  assert.equal(n.note.text, CLEAN);
  const r = await api('myroom', { method: 'PUT', token: a.token, body: { name: 'Sala‮ rara', desc: DIRTY } });
  assert.equal(r.room.customName, 'Sala rara');
  assert.equal(r.room.desc, CLEAN);
});

test('textos: los mensajes privados también', async () => {
  const a = await account('tx'), b = await account('tx');
  await api('friendrequest', { method: 'POST', token: a.token, body: { id: b.user.id } });
  await api('friendrespond', { method: 'POST', token: b.token, body: { id: a.user.id, accept: true } });
  const s = await api('dm', { method: 'POST', token: a.token, body: { to: b.user.id, text: DIRTY } });
  assert.ok(s.ok, s.error);
  const conv = await api(`dm?id=${a.user.id}`, { token: b.token });
  assert.equal(conv.messages.at(-1).text, CLEAN);
});
