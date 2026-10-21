// Arranca el servidor de salas en local.
// Los datos locales (chat, etc.) se guardan en una carpeta temporal de ruta corta,
// porque en Windows las rutas largas hacen fallar la base SQLite de wrangler.
// GAME_PORT permite correr una segunda copia del proyecto a la vez (otro puerto y otra
// carpeta de datos, para que las dos no escriban la misma base).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const port = process.env.GAME_PORT || '8787';
mkdirSync('dist', { recursive: true });
const state = join(tmpdir(), port === '8787' ? 'galeria-state' : `galeria-state-${port}`);
const child = spawn('npx', ['wrangler', 'dev', '--port', port, '--inspector-port', '0', '--persist-to', state], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
