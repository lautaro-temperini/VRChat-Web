// Control automático de los modelos 3D que suben los usuarios (diseños y obras del Museo).
// Lee el GLB sin cargarlo en una escena: cuenta triángulos, mide el tamaño con los mínimos y
// máximos de cada malla (con las transformaciones de los nodos) y el tamaño de las texturas.
// Lo usan el servidor (no confía en el cliente) y el cliente (para avisar antes de subir).

export const MODEL_RULES = { bytes: 2 * 1024 * 1024, tris: 10_000, tex: 1024, height: 3 };
// Extensiones que el juego sabe leer (loadGLTF: Draco, meshopt, KTX2 y las de materiales)
const OK_EXT = /^(KHR_materials_\w+|KHR_texture_transform|KHR_mesh_quantization|KHR_draco_mesh_compression|EXT_meshopt_compression|KHR_texture_basisu|EXT_texture_webp|KHR_lights_punctual)$/;

// Devuelve { ok, tris, size: [x, y, z] (m), tex (lado más grande) } o { ok: false, error }
export function checkGLB(buf) {
  const fail = (error) => ({ ok: false, error });
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 20) return fail('El modelo tiene que ser un archivo .glb.');
  if (buf.byteLength > MODEL_RULES.bytes) return fail('El modelo pesa más de 2 MB.');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) return fail('El modelo tiene que ser un archivo .glb.');
  let json = null, bin = null;
  for (let off = 12; off + 8 <= buf.byteLength;) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (off + 8 + len > buf.byteLength) return fail('El archivo .glb está dañado.');
    if (type === 0x4e4f534a && !json) {
      try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len))); } catch { return fail('El archivo .glb está dañado.'); }
    } else if (type === 0x004e4942 && !bin) bin = { off: off + 8, len };
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || typeof json !== 'object') return fail('El archivo .glb está dañado.');
  // Extensiones: las declaradas y también las que aparecen adentro de cada parte sin declarar
  const used = new Set((json.extensionsUsed ?? []).map(String));
  for (const list of [json.meshes, json.nodes, json.materials, json.textures, json.images, json.bufferViews, json.accessors]) {
    for (const o of list ?? []) {
      for (const k of Object.keys(o?.extensions ?? {})) used.add(k);
      for (const p of o?.primitives ?? []) for (const k of Object.keys(p?.extensions ?? {})) used.add(k);
    }
  }
  const bad = [...used].find((e) => !OK_EXT.test(e));
  if (bad) return fail(`El modelo usa algo que el juego no lee (${bad.slice(0, 40)}).`);
  const acc = json.accessors ?? [], meshes = json.meshes ?? [], nodes = json.nodes ?? [], views = json.bufferViews ?? [];

  // Caja real de las posiciones (float32 sin comprimir): se lee del binario. Si no coincide con la declarada,
  // el modelo miente su tamaño. Comprimidas (Draco/meshopt): se usa la declarada y el cliente la acota.
  const boxes = new Map();
  const boxOf = (p) => {
    const ai = p.attributes?.POSITION, a = acc[ai];
    if (!a || !Array.isArray(a.min) || !Array.isArray(a.max)) return null;
    if (boxes.has(ai)) return boxes.get(ai);
    let box = { min: a.min.map(Number), max: a.max.map(Number) };
    const view = views[a.bufferView];
    const compressed = p.extensions?.KHR_draco_mesh_compression || view?.extensions?.EXT_meshopt_compression;
    if (!compressed && view && bin && a.componentType === 5126 && a.type === 'VEC3' && !a.sparse) {
      const stride = view.byteStride || 12, base = bin.off + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
      if (base + stride * (a.count - 1) + 12 > bin.off + bin.len) return 'roto';
      const real = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let i = 0; i < a.count; i++) {
        for (let k = 0; k < 3; k++) {
          const v = dv.getFloat32(base + i * stride + k * 4, true);
          if (!Number.isFinite(v)) return 'roto';
          if (v < real.min[k]) real.min[k] = v;
          if (v > real.max[k]) real.max[k] = v;
        }
      }
      const tol = (k) => 0.001 + Math.abs(box.max[k] - box.min[k]) * 0.01;
      for (let k = 0; k < 3; k++) if (real.min[k] < box.min[k] - tol(k) || real.max[k] > box.max[k] + tol(k)) return 'miente';
      box = real;
    }
    boxes.set(ai, box);
    return box;
  };

  // Recorrido de la escena: cada nodo una sola vez (en glTF válido un nodo tiene un solo padre). Así no hay
  // forma de multiplicar el trabajo ni los triángulos reusando nodos. Triángulos por cada vez que se dibuja
  // una malla; tamaño con las cajas llevadas por las transformaciones de los nodos.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const seen = new Set();
  let tris = 0, problem = null;
  const visit = (i, parent, depth) => {
    if (problem) return;
    const n = nodes[i];
    if (!n || depth > 64) return;
    if (seen.has(i)) { problem = 'El modelo repite partes (un mismo nodo en dos lugares).'; return; }
    seen.add(i);
    const m = mul(parent, nodeMatrix(n));
    if (m.some((v) => !Number.isFinite(v))) { problem = 'El modelo tiene transformaciones inválidas.'; return; }
    for (const p of meshes[n.mesh]?.primitives ?? []) {
      const mode = p.mode ?? 4;
      const count = acc[p.indices]?.count ?? acc[p.attributes?.POSITION]?.count ?? 0;
      if (mode === 4) tris += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) tris += Math.max(0, count - 2);
      const b = boxOf(p);
      if (b === 'roto') { problem = 'El archivo .glb está dañado.'; return; }
      if (b === 'miente') { problem = 'El tamaño que declara el modelo no coincide con su geometría.'; return; }
      if (!b) continue;
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? b.max[0] : b.min[0], c & 2 ? b.max[1] : b.min[1], c & 4 ? b.max[2] : b.min[2]];
        const w = apply(m, v);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
      }
    }
    for (const c of n.children ?? []) visit(c, m, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const r of scene?.nodes ?? nodes.map((_, i) => i)) visit(r, IDENT, 0);
  if (problem) return fail(problem);
  if (tris > MODEL_RULES.tris) return fail(`El modelo tiene ${tris} triángulos: el máximo es ${MODEL_RULES.tris}.`);
  if (!Number.isFinite(min[0])) return fail('El modelo no tiene nada para mostrar.');
  const size = max.map((v, k) => Math.round((v - min[k]) * 1000) / 1000);
  if (size[1] > MODEL_RULES.height) return fail(`El modelo mide ${size[1].toFixed(2)} m de alto: el máximo es ${MODEL_RULES.height} m (está en metros).`);
  if (Math.max(...size) > MODEL_RULES.height * 2) return fail(`El modelo mide ${Math.max(...size).toFixed(2)} m de largo: es demasiado grande.`);
  if (Math.max(...size) < 0.02) return fail('El modelo es demasiado chico (¿está en metros?).');

  // Texturas: todas adentro del binario del .glb (ni links ni data:) y de hasta 1024 px
  let tex = 0;
  for (const img of json.images ?? []) {
    if (img.uri) return fail('Las texturas tienen que estar adentro del .glb.');
    const view = views[img.bufferView];
    if (!view || !bin) return fail('El archivo .glb está dañado.');
    const bytes = new Uint8Array(buf, bin.off + (view.byteOffset ?? 0), Math.max(0, Math.min(view.byteLength ?? 0, 65536, bin.len - (view.byteOffset ?? 0))));
    const dims = imageSize(bytes);
    if (!dims) return fail('Hay una textura en un formato que el juego no lee (PNG, JPG, WebP o KTX2).');
    tex = Math.max(tex, dims[0], dims[1]);
  }
  if (tex > MODEL_RULES.tex) return fail(`Las texturas miden ${tex} px: el máximo es ${MODEL_RULES.tex} px.`);
  return { ok: true, tris, size, tex };
}

// ---------- Matrices 4x4 (por columnas, como glTF) ----------
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function nodeMatrix(n) {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix.map(Number);
  const [x, y, z, w] = Array.isArray(n.rotation) ? n.rotation.map(Number) : [0, 0, 0, 1];
  const [sx, sy, sz] = Array.isArray(n.scale) ? n.scale.map(Number) : [1, 1, 1];
  const [tx, ty, tz] = Array.isArray(n.translation) ? n.translation.map(Number) : [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

// Ancho y alto de una imagen PNG, JPEG, WebP o KTX2 leyendo su encabezado
export function imageSize(b) {
  const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b.length >= 24) return [u32(16), u32(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [(b[i + 7] << 8) | b[i + 8], (b[i + 5] << 8) | b[i + 6]];
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x52 && b[8] === 0x57 && b.length >= 30) { // RIFF....WEBP
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return [((b[27] << 8) | b[26]) & 0x3fff, ((b[29] << 8) | b[28]) & 0x3fff];
    if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
    if (kind === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  }
  if (b[0] === 0xab && b[1] === 0x4b && b.length >= 28) { const le = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); return [le(20), le(24)]; }
  return null;
}
