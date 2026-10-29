// npm test: levanta un servidor de salas propio (puerto 8790, datos en una carpeta temporal que
// se borra al terminar) y corre las pruebas de test/ con node:test contra él.
// Con TEST_BASE=http://127.0.0.1:8787 usa un servidor que ya esté corriendo (no levanta otro).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const files = process.argv.slice(2);
const args = ['--test', '--test-concurrency=1', ...(files.length ? files : ['test/*.test.mjs'])];

function run(env) {
  return new Promise((resolve) => {
    const t = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    t.on('exit', (code) => resolve(code ?? 1));
  });
}

if (process.env.TEST_BASE) process.exit(await run({}));

const port = process.env.TEST_PORT || '8790';
mkdirSync('dist', { recursive: true });
const state = mkdtempSync(join(tmpdir(), 'galeria-test-'));
const server = spawn('npx', ['wrangler', 'dev', '--port', port, '--ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session=false',
  // Las pruebas crean muchas cuentas seguidas desde la misma PC: se sube ese freno
  '--var', 'CREATE_PER_HOUR:100000',
  // El paquete inicial ya no trae muebles especiales: en las pruebas se suma uno
  '--var', 'TEST_STARTER_EXTRA:esculturaNeon',
  // Las cuentas "curtest…" nacen curadoras (test/curaduria.test.mjs)
  '--var', 'TEST_CURATOR_PREFIX:curtest'],
  { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', detached: process.platform !== 'win32' });
let log = '';
const ready = new Promise((resolve, reject) => {
  const onData = (d) => { log += d; if (/Ready on/.test(log)) resolve(); };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
  server.on('exit', (code) => reject(new Error(`wrangler terminó (${code}):\n${log}`)));
  setTimeout(() => reject(new Error(`wrangler no arrancó en 60 s:\n${log}`)), 60_000);
});

function stop() {
  try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']) : process.kill(-server.pid, 'SIGTERM'); } catch { /* ya terminó */ }
}

let code = 1;
try {
  await ready;
  code = await run({ TEST_BASE: `http://127.0.0.1:${port}` });
} catch (e) {
  console.error(e.message);
} finally {
  stop();
  setTimeout(() => { try { rmSync(state, { recursive: true, force: true }); } catch { /* Windows: queda en temp */ } process.exit(code); }, 500);
}
