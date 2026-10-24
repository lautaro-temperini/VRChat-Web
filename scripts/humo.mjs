// Prueba de humo en el navegador (con npm run dev abierto): dos jugadores entran al Museo, se ven,
// chatean, abren los paneles, la cabina y la consola; uno va a su sala, elige plantilla y abre el
// editor; y al abrir otra pestaña con la misma cuenta, la vieja se desconecta.
// Uso: node scripts/humo.mjs [http://localhost:5173]   (necesita Playwright; ver CLAUDE.md)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const BASE = process.argv[2] ?? 'http://localhost:5173';
const errors = [];
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FALLA'} ${what}`); if (!ok) failed++; };

async function account(prefix) {
  const nick = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 20);
  const r = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${nick}@humo.test`, nick, password: 'secreto123', terms: true }) }).then((x) => x.json());
  if (!r.ok) throw new Error(r.error);
  return { token: r.token, id: r.user.id, nick };
}

const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
async function page(acc, sala = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.addInitScript((t) => localStorage.setItem('token', t), acc.token);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${acc.nick}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|404|audio|SFU|servidor de audio/i.test(m.text())) errors.push(`${acc.nick}: ${m.text()}`); });
  await p.goto(`${BASE}/${sala ? `?sala=${sala}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await p.waitForFunction(() => window.__game?.net?.ready, null, { timeout: 120_000 });
  return p;
}
const has = (p, cls) => p.evaluate((c) => document.body.classList.contains(c), cls);
const esc = (p) => p.keyboard.press('Escape');

try {
  const a = await account('humoa'), b = await account('humob');
  const pa = await page(a), pb = await page(b);
  await pa.waitForTimeout(800);
  await esc(pa); await esc(pb); // cartel de controles
  check(await pa.evaluate((id) => [...window.__game.remotes.values()].some((r) => r.userId === id || r.info?.userId === id) || window.__game.remotes.size > 0, b.id), 'A ve a B en el Museo');

  // B se mueve: A recibe la posición
  await pb.evaluate(() => { const g = window.__game; g.ctrl.pos.x += 1; for (let i = 0; i < 30; i++) g.ctrl.update(1 / 60); });
  await pb.waitForTimeout(600);
  check(await pa.evaluate(() => window.__game.remotes.size === 1), 'A sigue viendo a un solo jugador (sin fantasmas)');

  // Chat
  await pa.keyboard.press('Enter');
  await pa.keyboard.type('hola humo');
  await pa.keyboard.press('Enter');
  await pb.waitForFunction(() => document.getElementById('messages').textContent.includes('hola humo'), null, { timeout: 5000 }).then(() => check(true, 'chat llega al otro'), () => check(false, 'chat llega al otro'));

  // Paneles (botones de la pantalla)
  for (const [btn, cls] of [['btn-inv', 'inventory'], ['btn-friends', 'friends'], ['btn-mundi', 'mundi'], ['btn-gestures', 'gestures'], ['btn-look', 'editing'], ['btn-settings', 'settings']]) {
    await pa.click(`#${btn}`);
    await pa.waitForTimeout(250);
    check(await has(pa, cls), `abre ${cls}`);
    await esc(pa);
    await pa.waitForTimeout(150);
    if (await has(pa, cls)) await pa.click(`#${btn}`).catch(() => {});
  }
  // Cabina del DJ, consola de artistas, atril del Museo
  await pa.evaluate(() => window.__game.openDJPanel());
  await pa.waitForTimeout(200);
  check(await has(pa, 'djing'), 'abre la cabina del DJ');
  await esc(pa);
  await pa.evaluate(() => window.__game.openArtists());
  await pa.waitForTimeout(200);
  check(await has(pa, 'artists'), 'abre la consola de artistas');
  await esc(pa);
  await pa.evaluate(() => window.__game.works.open());
  await pa.waitForTimeout(600);
  check(await has(pa, 'works'), 'abre el atril del Museo (obras)');
  await esc(pa);
  // Gesto
  await pa.evaluate(() => window.__game.gesture('saludar'));
  check(true, 'gesto sin errores');

  // Sala personal de A: elegir plantilla y abrir el editor
  await pa.goto(`${BASE}/?sala=u-${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await pa.waitForFunction(() => window.__game?.net?.ready, null, { timeout: 120_000 });
  await pa.waitForTimeout(800);
  await esc(pa);
  await pa.evaluate(() => window.__game.net.send({ t: 'edit', op: 'template', template: 'club' }));
  await pa.waitForTimeout(800);
  await pa.evaluate(() => document.getElementById('btn-roomedit')?.click());
  await pa.waitForTimeout(600);
  check(await has(pa, 'roomedit'), 'abre el editor de la sala propia');
  await esc(pa); await esc(pa);
  await pa.evaluate(() => document.getElementById('btn-roomedit')?.click());

  // B visita la sala de A
  await pb.goto(`${BASE}/?sala=u-${a.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await pb.waitForFunction(() => window.__game?.net?.ready, null, { timeout: 120_000 });
  await pb.waitForTimeout(800);
  check(await pb.evaluate(() => window.__game.remotes.size === 1), 'B entra a la sala de A y lo ve');

  // Una sola conexión por cuenta: otra pestaña de A desconecta a la anterior
  const pa2 = await page(a);
  await pa.waitForFunction(() => document.body.classList.contains('kicked'), null, { timeout: 8000 }).then(() => check(true, 'la pestaña vieja dice "Abriste el juego en otra pestaña"'), () => check(false, 'la pestaña vieja se desconecta'));
  check(/otra pestaña/.test(await pa.textContent('#kicked-title')), 'cartel de otra pestaña');
  await pa2.close();
} catch (e) {
  check(false, e.message);
}
await browser.close();
for (const e of errors) console.log('ERROR en la página:', e);
check(errors.length === 0, 'sin errores en la consola');
process.exit(failed ? 1 : 0);
