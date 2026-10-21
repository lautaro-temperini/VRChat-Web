// Segunda copia del proyecto corriendo a la vez que otra (por ejemplo, una rama de prueba):
// servidor de salas en el puerto 8788 con sus propios datos; Vite toma el siguiente puerto libre.
import { spawn } from 'node:child_process';

const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true, env: { ...process.env, GAME_PORT: '8788' } });
child.on('exit', (code) => process.exit(code ?? 0));
