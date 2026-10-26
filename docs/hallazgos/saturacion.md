# Saturación y robustez — Galería Online

Tester adversarial "el que satura y rompe". Todo contra el servidor local **127.0.0.1:8788**.
Clientes robot de `test/helpers.mjs`. Scripts en `../bots/saturacion/`.
No se modificó ningún archivo del repo. El servidor nunca se cayó del todo (se recupera), pero
sí quedó bloqueado segundos (ver hallazgo 1).

---

## Hallazgos

### 1. (ALTA) Cientos de WebSocket a una misma sala bloquean el Durable Object ~10 s — REPRODUCIDO
Un Durable Object corre en un solo hilo. Abrí 300 conexiones a `ws://127.0.0.1:8788/ws/plaza`
(cada una con 30 `join` de token falso) y la latencia de `GET /api/museum`... en realidad la del
propio DO de la sala y el handshake pasó de **17 ms a 10.312 ms**. Durante esos ~11 s la sala
atiende a todos muy lento: los que ya estaban adentro quedan trabados.

Script (`bots/saturacion/p4.mjs`):
```js
await Promise.all(Array.from({ length: 300 }, () => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:8788/ws/plaza');
  ws.onopen = () => { for (let k = 0; k < 30; k++) ws.send(JSON.stringify({ t: 'join', token: 'x'.repeat(64) })); res(); };
})));
// latencia base 17 ms  ->  durante el flood 10.312 ms
```
- **Qué pasa:** cada `fetch` del Worker a la sala crea y acepta el WebSocket (`Room.fetch` →
  `acceptWebSocket` + `scheduleAlarm` que recorre **todas** las conexiones) antes de que el
  `JOIN_TIMEOUT` las limpie (recién a los ~27 s, ver hallazgo 8). No hay tope de conexiones
  concurrentes por sala ni freno por IP en el handshake WebSocket (el freno por IP solo está en
  `/api/guest|register|login`, no en `/ws/`).
- **Qué debería pasar:** un atacante no debería poder dejar lenta una sala pública con conexiones
  baratas. Debería haber un tope de conexiones "sin entrar" simultáneas y/o un freno por IP en el
  upgrade.
- **Responsable:** `server/room.js` `fetch()` (~línea 148) y `scheduleAlarm()` (~línea 200), que
  itera `this.ctx.getWebSockets()` en cada mensaje/alarma; `server/worker.js` ruta `/ws/` (~240)
  sin límite ni freno por IP.
- **Sugerencia (no implementada):** limitar conexiones sin `join` por IP (CF-Connecting-IP) en el
  Worker antes del upgrade; bajar `JOIN_TIMEOUT` y cerrar enseguida las que llegan sin join cuando
  ya hay muchas pendientes; evitar recorrer todas las conexiones en cada `scheduleAlarm`.

### 2. (MEDIA) Teletransporte reconectando: `join` con cualquier posición saltea el control de velocidad — REPRODUCIDO
El control de velocidad (`moveBudget`) solo mira los mensajes `s`. Al entrar, la posición del
`join` se acepta tal cual. Reconectando (la nueva conexión desplaza a la anterior por `claimConn`)
uno aparece donde quiera, instantáneo.

Script (`bots/saturacion/p3.mjs`):
```js
let a = await joined(A.token, 'museo', [0,0,0,0,0,0]);
await a.close();
a = await joined(A.token, 'museo', [200,0,200,0,0,0]);  // los demás lo ven en [200,0,200]
```
- **Qué pasa:** `cleanState(msg.s)` en el `join` guarda la posición sin compararla con la anterior
  ni gastar `moveBudget`. Teletransporte libre dentro de ±500 m reconectando (≈1 vez por segundo
  es sostenible).
- **Qué debería pasar:** o se ignora la posición del `join` (entrar siempre en el spawn) o, si se
  conserva, que no permita saltos imposibles respecto de la última posición conocida de esa cuenta.
- **Responsable:** `server/room.js`, rama `if (msg.t === 'join' ...)` (~línea 300): `const s =
  cleanState(msg.s); if (s) this.states.set(meta.id, s);`.
- **Sugerencia:** entrar siempre en el spawn de la sala (ya existe `SPAWN`/`ROOM_SPAWN`), o validar
  el salto contra la última posición guardada de la cuenta.

### 3. (MEDIA) El control de velocidad no mira el eje Y (altura) — REPRODUCIDO
`moveBudget` mide solo `Math.hypot(dx, dz)`. Se puede teletransportar verticalmente sin límite
(hasta ±500 m de alto) con un solo `s`.

Script (`bots/saturacion/p3.mjs`):
```js
a.send({ t: 's', s: [200, 480, 200, 0, 0, 0] });  // aceptado: salto de 480 m de alto
```
- **Qué pasa:** `case 's'` calcula `d = Math.hypot(s[0]-prev[0], s[2]-prev[2])` (sin `s[1]`), así
  que la altura no gasta saldo. Un tramposo puede plantarse sobre obras, en el aire, sobre el
  balcón, etc.
- **Qué debería pasar:** el salto vertical también debería acotarse (o al menos limitar Y a un rango
  mucho más chico que ±500 m).
- **Responsable:** `server/room.js` `case 's'` (~línea 336): `const d = Math.hypot(s[0]-prev[0],
  s[2]-prev[2])`.
- **Sugerencia:** incluir `s[1]` en la distancia, o acotar Y a un rango realista por sala.

### 4. (MEDIA) `consume` y `kiss` no están en el balde HEAVY: una conexión fuerza ~70 llamadas/s a Accounts — REPRODUCIDO
`HEAVY` cubre `look, emote, phone, afk, mic, group, trade, edit, drop, pickup, mod, dj, part`, pero
**no** `consume` ni `kiss`. `consume {from:'item'}` llama a `accounts().useConsumable()` (lectura +
escritura en SQLite de la cuenta) en cada mensaje, limitado solo por el balde `all` (120 ráfaga +
40/s).

Script (`bots/saturacion/p6.mjs`):
```js
for (let i = 0; i < 400; i++) a.send({ t: 'consume', from: 'item', iid: 'z'+i });
// 144 respuestas de Accounts en 2 s desde UNA conexión
```
- **Qué pasa:** 144 idas a la DB de cuentas en 2 s por conexión (y se cobra/consume CPU del DO
  Accounts, que es global y compartido por todo el juego). Con varias conexiones escala.
- **Qué debería pasar:** lo que toca la DB o pide algo a Accounts debería pasar por el balde HEAVY
  (30 + 5/s), igual que `drop`/`pickup`.
- **Responsable:** `server/room.js` línea ~55: `const HEAVY = new Set([...])` sin `consume` ni
  `kiss`; `consumeMessage` (~línea 858) y `kissMessage` (~línea 893).
- **Sugerencia:** agregar `'consume'` y `'kiss'` al `Set` HEAVY.

### 5. (MEDIA) Subida de diseños sin tope por día ni por cuenta — REPRODUCIDO
`server/works.js` tiene `DAILY_LIMIT = 5` obras/24 h, pero `designSubmit` (`server/designs.js`) **no
tiene ningún límite de cantidad** (salvo 4 MB por archivo). Subí 25 estampas de ~800 KB seguidas:
las 25 aceptadas. Cada una guarda archivo en R2 + fila en `designs` + item en `items`. Además
`designcopy` no tiene tope: 200 copias aceptadas (inventario quedó en 240 items).

Script (`bots/saturacion/p1.mjs`):
```js
// 25 POST /api/design de ~800 KB  -> 25/25 aceptados
// 200 POST /api/designcopy        -> 200/200 aceptados; inventario = 240
```
- **Qué pasa:** una cuenta puede llenar R2 (`ART`) y la DB de Accounts sin freno (25 × 800 KB =
  20 MB en segundos; sostenido es ilimitado). Las copias inflan la tabla `items` sin costo.
- **Qué debería pasar:** un tope por día como el de las obras, y un tope de copias/diseños por
  cuenta (el usuario pidió explícitamente frenos de este tipo).
- **Responsable:** `server/designs.js` `designSubmit` (~línea 44, no cuenta `COUNT(*)` ni
  `created > since`); `designCopy` (~línea 109) sin tope.
- **Sugerencia:** replicar el patrón de `works.js` (COUNT por autor en las últimas 24 h) en
  `designSubmit`, y un `DESIGNS_MAX`/`COPIES_MAX` por cuenta. **Es una decisión de diseño (cuántos
  por día): consultar al usuario el número antes de implementar.**

### 6. (BAJA) `consume` usa acceso por corchete al catálogo (`CONSUMABLES[kind]`): pasa con `constructor` — REPRODUCIDO
Es exactamente la clase de bug que el `docs/ramas/seguridad.md` (hallazgo 2) dijo haber cerrado con
`Object.hasOwn`, pero quedó sin arreglar en `consume`.

Script (`bots/saturacion/p2.mjs`):
```js
a.send({ t: 'consume', from: 'bar', kind: 'constructor' });
// se reenvía a todos: { t:'consume', id:'...', kind:'constructor' }
```
- **Qué pasa:** `!CONSUMABLES[msg.kind]` con `kind='constructor'` da `!(Object) === false`, así que
  no corta y hace `startBoost` con `kind:'constructor'`, que se broadcastea a toda la sala. Impacto
  bajo (el efecto de boost es el mismo; el cliente podría romperse al no encontrar el ícono), pero
  es acceso a propiedad heredada sobre datos del cliente.
- **Qué debería pasar:** usar `Object.hasOwn(CONSUMABLES, msg.kind)`.
- **Responsable:** `server/room.js` `consumeMessage` línea ~866 (`!CONSUMABLES[msg.kind]`) y el
  caso `from:'piece'`/`item` que reenvían `r.kind`. También `server/progress.js` ~línea 126
  (`CONSUMABLES[type]`, aunque ahí `type` sale del server).
- **Sugerencia:** `has(CONSUMABLES, msg.kind)` (ya existe el helper `has` en room.js).

---

## Hipótesis peligrosas no confirmadas

- **Crecimiento de `items` por `designcopy` sin límite (confirmado parcial):** llegué a 240 items en
  una cuenta en segundos. No llené la DB a propósito (fui razonable con el volumen), pero no hay nada
  que lo frene: sostenido crece sin fin. Ligado al hallazgo 5.
- **Objetos en el suelo (`ground`):** se guardan en el storage de la sala con `storage.put('ground',
  ...)` en cada `drop`. Tienen `GROUND_LIFE` de 60 s y dependen del inventario (limitado), así que no
  crece indefinido, pero cada `drop`/`pickup` reescribe todo el array `ground` completo: con muchos
  objetos y muchos jugadores podría ser caro. No lo forcé.
- **DO Accounts como cuello de botella global:** todas las salas comparten un único DO `Accounts`
  ('global'). Floods de `consume`/`kiss`/`drop`/`pickup` desde muchas salas a la vez pegan todos
  contra ese mismo DO. No lo probé con varias salas en paralelo.
- **`moveBudget`/`rates`/`pulls` en memoria:** se limpian en `leave`, pero si una conexión queda
  "zombi" (sin close ni alarma) podrían acumularse. No lo reproduje.

## Cosas que probé y están bien

- **Antiflood general funciona para los tipos cubiertos:** `emote` (HEAVY) → 0 reenviados de 300 en
  1,5 s (cae por debajo del tope casi de inmediato). `s` acotado a 40/s por el balde `all`.
- **Control de velocidad en el plano X/Z:** con 5 s de "lag" trotando y 50 posiciones de golpe, solo
  aceptó hasta el saldo (~11,5 m) y mandó `pos-fix` por el resto. Funciona como se describe.
- **JSON raro / malicioso no tira la sala:** probé `1e400` (Infinity), `__proto__`/`constructor`
  como `t`, `s` como objeto `{length:6}`, 2000 corchetes anidados, `text` objeto, `iids` string,
  `piece:null`, etc. La sala siguió respondiendo (chat posterior llegó) y la conexión no se cerró.
  `cleanState` rechaza no-finitos y arrays mal formados; los `switch` ignoran tipos desconocidos.
- **Mensajes > 64 KB se descartan** (`raw.length > 64_000`), y > 4 KB salvo `sfu`.
- **`JOIN_TIMEOUT`:** las conexiones mudas (sin `join`) se cierran con código 4001 a los ~27 s
  (15 s + ciclo de alarma). Funciona, aunque algo lento (ver hallazgo 1 sobre el costo mientras
  tanto).
- **Tokens falsos en `join`:** se rechazan y cierran con 4001; dos `join` seguidos → el segundo se
  ignora (`meta.joining`).
- **Freno de cuentas/invitados por IP también sin `CF-Connecting-IP`:** en local la IP va vacía pero
  igual cuenta (hash de `''`): creé 18/30 invitados y después bloqueó. El freno existe también local.
- **Topes que sí están:** fotos 30/usuario, notas 20/h, favoritos 100, obras 5/24 h, intercambio
  12 items/lado, piezas de sala 100, DM 200 chars con antiflood propio.

---

## Resumen por gravedad

- **Crítica:** 0
- **Alta:** 1 (hallazgo 1: WS masivos bloquean el DO de la sala)
- **Media:** 4 (2 teletransporte por reconexión, 3 Y sin control, 4 consume/kiss fuera de HEAVY,
  5 diseños sin tope por día)
- **Baja:** 1 (hallazgo 6: `CONSUMABLES[kind]` sin `Object.hasOwn`)

Total: **6 hallazgos reproducidos.** El servidor nunca quedó caído de forma permanente.
