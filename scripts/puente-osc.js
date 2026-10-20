#!/usr/bin/env node
// Puente OSC para artistas: recibe OSC en tu PC y se lo pasa al juego (la pestaña de Galería Online).
//
// Uso:  node scripts/puente-osc.js            (escucha OSC en el puerto 9000)
//       node scripts/puente-osc.js 7000       (otro puerto)
//
// En TouchDesigner (OSC Out), Ableton/Max (udpsend) o Blender, mandá a 127.0.0.1 y ese puerto.
// En el juego: E en la consola de artistas → "Tomar las luces". Direcciones en src/net/osc.js
// (por ejemplo /luces/color 1 0 0.5, /luces/focos/mover 0.3 -0.2, /luces/flash 1).
// Sin dependencias: solo Node 18 o más nuevo.

import dgram from 'node:dgram';
import http from 'node:http';

const OSC_PORT = Number(process.argv[2]) || 9000;
const WEB_PORT = 9001; // el juego se conecta acá (src/net/osc.js)

// ---------- Lectura de OSC (mensajes y bundles) ----------
function readString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = buf.toString('utf8', off, end);
  return [s, (end + 4) & ~3]; // termina en múltiplo de 4
}

function parse(buf, out = []) {
  if (buf.toString('utf8', 0, 8) === '#bundle\0') {
    let off = 16; // "#bundle" + marca de tiempo
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off);
      parse(buf.subarray(off + 4, off + 4 + size), out);
      off += 4 + size;
    }
    return out;
  }
  let [address, off] = readString(buf, 0);
  if (!address.startsWith('/')) return out;
  let types = ',';
  if (off < buf.length) [types, off] = readString(buf, off);
  const args = [];
  for (const t of types.slice(1)) {
    if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
    else if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
    else if (t === 'd') { args.push(buf.readDoubleBE(off)); off += 8; }
    else if (t === 'h') { args.push(Number(buf.readBigInt64BE(off))); off += 8; }
    else if (t === 's') { let s; [s, off] = readString(buf, off); args.push(s); }
    else if (t === 'T') args.push(1);
    else if (t === 'F') args.push(0);
    else if (t === 'b') { const n = buf.readInt32BE(off); off += 4 + ((n + 3) & ~3); }
  }
  out.push({ address, args });
  return out;
}

// ---------- Pestañas del juego conectadas ----------
const clients = new Set();
const server = http.createServer((req, res) => {
  // El juego está en otro sitio (https): hay que permitirle leer de esta PC
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Headers': '*' }); return res.end(); }
  if (req.url !== '/eventos') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Puente OSC de Galería Online funcionando.'); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': hola\n\n');
  clients.add(res);
  console.log(`Juego conectado (${clients.size}).`);
  req.on('close', () => { clients.delete(res); console.log(`Juego desconectado (${clients.size}).`); });
});
server.listen(WEB_PORT, '127.0.0.1');
setInterval(() => { for (const c of clients) c.write(': sigo\n\n'); }, 15000);

let count = 0;
const udp = dgram.createSocket('udp4');
udp.on('message', (buf) => {
  let msgs;
  try { msgs = parse(buf); } catch { return; }
  for (const m of msgs) {
    const line = `data: ${JSON.stringify(m)}\n\n`;
    for (const c of clients) c.write(line);
    if (++count <= 5 || count % 500 === 0) console.log(`OSC ${m.address} ${m.args.join(' ')}`);
  }
});
udp.on('error', (e) => { console.error(`No se pudo escuchar OSC en el puerto ${OSC_PORT}: ${e.message}`); process.exit(1); });
udp.bind(OSC_PORT, () => {
  console.log(`Puente OSC listo. Mandá OSC a 127.0.0.1:${OSC_PORT}.`);
  console.log('En el juego: E en la consola de artistas → "Tomar las luces". Ctrl+C para cerrar.');
});
