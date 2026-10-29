// Curaduría (docs/hallazgos.md: M22, H5, H6): a cada curador le toca una obra por fecha y solo puede votar esa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, api, BASE } from './helpers.mjs';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

async function submit(token, title) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ kind: 'cuadro', title, description: 'x', technique: 'x', year: '2026', w: 100, h: 100 })) fd.set(k, String(v));
  for (const k of ['hd', 'wall']) fd.set(k, new Blob([PNG], { type: 'image/png' }), k);
  const res = await fetch(`${BASE}/api/work`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return res.json();
}

test('curaduría: toca la obra más vieja y solo se vota la que tocó (M22, H5)', async () => {
  const author = await account('au'), other = await account('au');
  const cur = await account('curtest');
  const w1 = await submit(author.token, 'Primera');
  const w2 = await submit(other.token, 'Segunda');
  assert.ok(w1.ok && w2.ok, w1.error ?? w2.error);
  const next = await api('review', { token: cur.token });
  assert.ok(next.ok, next.error);
  // Por fecha: la más vieja pendiente (puede haber otras de pruebas anteriores, siempre antes que la Segunda)
  assert.notEqual(next.work.title, 'Segunda');
  // Votar otra que no le tocó: no
  const target = next.work.id === w2.id ? w1.id : w2.id;
  const wrong = await api('reviewvote', { method: 'POST', token: cur.token, body: { id: target, vote: 'ok' } });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /no te tocó/);
  // La que le tocó, sí
  const right = await api('reviewvote', { method: 'POST', token: cur.token, body: { id: next.work.id, vote: 'ok' } });
  assert.ok(right.ok, right.error);
  // Y un usuario común no revisa
  assert.equal((await api('review', { token: author.token })).ok, false);
});
