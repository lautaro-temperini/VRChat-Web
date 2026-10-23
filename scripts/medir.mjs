// Mide lo que cuesta entrar al juego: bytes descargados, tiempo de carga y lo que dibuja
// (draw calls, triángulos, texturas). Para comparar antes/después de una optimización.
//
//   npx vite build && npm run dev:server     (wrangler sirve dist/ + la API en el 8787)
//   node scripts/medir.mjs [url] [calidad]   (por defecto http://localhost:8787 y low)
//
// Necesita Playwright (no es dependencia del proyecto): NODE_PATH=<carpeta con playwright>.
// Emula un celular de gama media: pantalla 412×915, red "4G rápida" (9 Mbps, 60 ms).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:8787';
const calidad = process.argv[3] ?? 'low';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });

// Bytes reales por la red (comprimidos), agrupados por tipo
const bytes = {};
const sizes = new Map();
cdp.on('Network.responseReceived', (e) => sizes.set(e.requestId, { url: e.response.url, type: e.type }));
cdp.on('Network.loadingFinished', (e) => {
  const r = sizes.get(e.requestId);
  if (!r) return;
  const kind = /\.(glb|gltf|bin|fbx)(\?|$)/.test(r.url) ? 'modelos' : /\.(png|jpe?g|webp|ktx2)(\?|$)/.test(r.url) ? 'texturas' : /\.wasm/.test(r.url) ? 'wasm' : r.type === 'Script' ? 'js' : 'otros';
  bytes[kind] = (bytes[kind] ?? 0) + e.encodedDataLength;
  r.size = e.encodedDataLength;
});

const t0 = Date.now();
await page.goto(`${url}/?calidad=${calidad}`);
// Pantalla de carga: se va cuando el personaje y sus animaciones están listos
await page.waitForSelector('#loading', { state: 'detached', timeout: 120_000 }).catch(() => {});
const carga = (Date.now() - t0) / 1000;

// Entra como invitado para medir la escena con la red andando
await page.fill('#auth-name', 'Medidor').catch(() => {});
await page.check('#auth-terms').catch(() => {});
await page.click('#auth-submit').catch(() => {});
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  const r = g.renderer;
  let scene = g.me.root;
  while (scene.parent) scene = scene.parent;
  // Dos vistas fijas: desde la entrada mirando al hall, y desde la pista mirando al escenario
  const vistas = [[-27, 1.6, 0, -Math.PI / 2], [0, 1.6, 0, -Math.PI / 2]];
  const out = [];
  for (const [x, y, z, yaw] of vistas) {
    g.camera.position.set(x, y, z);
    g.camera.rotation.set(0, yaw, 0, 'YXZ');
    g.camera.updateMatrixWorld();
    r.info.autoReset = false;
    r.info.reset();
    r.render(scene, g.camera);
    out.push({ calls: r.info.render.calls, tris: r.info.render.triangles });
    r.info.autoReset = true;
  }
  return out;
}).catch((e) => String(e));

// Lo mismo pero midiendo los cuadros que dibuja el propio juego (incluye todo lo que agrega main.js)
const frame = await page.evaluate(() => new Promise((ok) => {
  const r = window.__game?.renderer;
  if (!r) return ok(null);
  let n = 0, calls = 0, tris = 0;
  const t = performance.now();
  const loop = () => {
    calls = Math.max(calls, r.info.render.calls);
    tris = Math.max(tris, r.info.render.triangles);
    if (++n < 60) requestAnimationFrame(loop);
    else ok({ calls, tris, fps: +(60 / ((performance.now() - t) / 1000)).toFixed(1), geometrias: r.info.memory.geometries, texturas: r.info.memory.textures, programas: r.info.programs?.length });
  };
  requestAnimationFrame(loop);
}));

// Memoria de texturas estimada: ancho × alto × 4 bytes (+1/3 por mipmaps)
const texMem = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  const seen = new Set();
  let total = 0;
  let scene = g.me.root;
  while (scene.parent) scene = scene.parent;
  const add = (t) => {
    if (!t || seen.has(t.uuid)) return;
    seen.add(t.uuid);
    const img = t.image;
    const w = img?.width ?? img?.videoWidth ?? 0, h = img?.height ?? img?.videoHeight ?? 0;
    total += w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
  };
  scene.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) for (const v of Object.values(m)) if (v?.isTexture) add(v);
  });
  return { texturas: seen.size, mb: +(total / 1048576).toFixed(1) };
});

const total = Object.values(bytes).reduce((a, b) => a + b, 0);
const mb = (n) => +(n / 1048576).toFixed(2);
const grandes = [...sizes.values()].filter((r) => r.size > 200_000).sort((a, b) => b.size - a.size).slice(0, 12).map((r) => `${mb(r.size)} MB ${r.url.replace(url, '')}`);
console.log(JSON.stringify({ calidad, carga_s: carga, descarga_mb: mb(total), por_tipo_mb: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, mb(v)])), vistas: info, frame, texMem, grandes }, null, 2));
await browser.close();
