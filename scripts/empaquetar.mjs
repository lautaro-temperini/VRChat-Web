// Empaquetar animaciones: recibe los JSON que arma scripts/empaquetar.html y los guarda en
// public/models/anims/pack/. Uso: con `npm run dev` andando, `npm run empaquetar` y abrir
// http://localhost:5173/scripts/empaquetar.html (hay que hacerlo cada vez que se suma o cambia una animación).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 9556;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'anims', 'pack');
fs.mkdirSync(dir, { recursive: true });

http.createServer((req, res) => {
  const head = { 'Access-Control-Allow-Origin': '*' };
  if (req.method !== 'POST') { res.writeHead(204, head); return res.end(); }
  const name = path.basename(decodeURIComponent(req.url));
  if (!/^[\w.-]+\.json$/.test(name)) { res.writeHead(400, head); return res.end('nombre inválido'); }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try { JSON.parse(body); } catch { res.writeHead(400, head); return res.end('no es JSON'); }
    fs.writeFileSync(path.join(dir, name), body);
    console.log(`guardado ${name} (${Math.round(body.length / 1024)} KB)`);
    res.writeHead(200, head);
    res.end('ok');
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Esperando animaciones en el puerto ${PORT}.`);
  console.log('Abrí http://localhost:5173/scripts/empaquetar.html (con npm run dev andando).');
});
