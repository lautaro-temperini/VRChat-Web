// Arranca el servidor de salas en local.
// Los datos locales (chat, etc.) se guardan en una carpeta temporal de ruta corta,
// porque en Windows las rutas largas hacen fallar la base SQLite de wrangler.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

mkdirSync('dist', { recursive: true });
const state = join(tmpdir(), 'galeria-state');
const child = spawn('npx', ['wrangler', 'dev', '--port', '8787', '--persist-to', state], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
