// Control automático de modelos 3D (server/glb.js) contra los archivos tramposos de docs/hallazgos.md
// (C1, A5, A6, A7): se prueba el módulo directo, sin servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGLB } from '../server/glb.js';

// Arma un GLB con el JSON y (opcional) un binario
function glb(json, bin = null) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const j = new TextEncoder().encode(text);
  const b = bin ? new Uint8Array(bin.buffer ?? bin) : null;
  const bl = b ? b.length + ((4 - (b.length % 4)) % 4) : 0;
  const out = new Uint8Array(12 + 8 + j.length + (b ? 8 + bl : 0));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  if (b) {
    const o = 20 + j.length;
    dv.setUint32(o, bl, true); dv.setUint32(o + 4, 0x004e4942, true);
    out.set(b, o + 8);
  }
  return out.buffer;
}
const tri = (max) => ({ accessors: [{ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] });

test('glb: un modelo normal pasa', () => {
  const r = checkGLB(glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], ...tri([0.3, 0.3, 0.3]) }));
  assert.ok(r.ok, r.error);
});

test('glb: un grafo de nodos que se repite no cuelga el servidor (C1)', () => {
  const D = 40; // 2^40 visitas si se recorriera entero
  const nodes = [];
  for (let i = 0; i < D; i++) nodes.push({ children: [i + 1, i + 1] });
  nodes.push({ mesh: 0 });
  const t0 = Date.now();
  const r = checkGLB(glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes, ...tri([0.5, 0.5, 0.5]) }));
  assert.ok(Date.now() - t0 < 200, 'tardó demasiado');
  assert.equal(r.ok, false);
});

test('glb: reusar la misma malla en muchos nodos cuenta todos los triángulos (A6)', () => {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [...Array(500).keys()] }], nodes: Array.from({ length: 500 }, () => ({ mesh: 0 })),
    accessors: [{ componentType: 5126, count: 15000, type: 'VEC3', min: [0, 0, 0], max: [0.2, 0.2, 0.2] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] };
  const r = checkGLB(glb(json));
  assert.equal(r.ok, false);
  assert.match(r.error, /triángulos/);
});

test('glb: declarar 1 m con vértices a 30 m no pasa (A5)', () => {
  const pos = new Float32Array([0, 0, 0, 30, 30, 30, 0, 30, 0]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] };
  const r = checkGLB(glb(json, pos));
  assert.equal(r.ok, false);
  assert.match(r.error, /no coincide/);
});

test('glb: los vértices reales mandan el tamaño (y los honestos pasan)', () => {
  const pos = new Float32Array([0, 0, 0, 0.4, 0.2, 0.1, 0, 0.2, 0]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.4, 0.2, 0.1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] };
  const r = checkGLB(glb(json, pos));
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.size, [0.4, 0.2, 0.1]);
});

test('glb: texturas por data: URI o sin binario no pasan (A7)', () => {
  const base = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], ...tri([0.3, 0.3, 0.3]) };
  assert.equal(checkGLB(glb({ ...base, images: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }] })).ok, false);
  assert.equal(checkGLB(glb({ ...base, images: [{ mimeType: 'image/png' }] })).ok, false);
});

test('glb: extensiones sin declarar adentro de una parte también se revisan', () => {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: {} } }], ...tri([0.3, 0.3, 0.3]) };
  assert.equal(checkGLB(glb(json)).ok, false);
});
