# Hallazgos: economía (objetos, intercambios, suelo, muebles, consumibles, progresión)

Tester: "el que busca ventajas en la economía". Servidor de prueba: http://127.0.0.1:8788 (solo ese).
Scripts en `C:\Users\xvvave\AppData\Local\Temp\claude\E--Proyectos-VRChat-Web\2f29601f-5f33-48e3-a6f0-45d92e7d9cc3\scratchpad\bots\economia\`
(`lib.mjs` reexporta `test/helpers.mjs` y agrega `acct()`, que registra cuentas `@prueba.test`). Se corren con
`TEST_BASE=http://127.0.0.1:8788 node <script>`.

> Nota: para no chocar con el freno de 20 cuentas por hora por IP (que comparten todos los testers locales), `acct()`
> manda un `CF-Connecting-IP` al azar. En local wrangler lo respeta; en producción Cloudflare lo pisa, así que eso
> NO es un hallazgo, solo una comodidad de la prueba.

Resumen: **0 críticas · 2 altas · 3 medias · 3 bajas** (más hipótesis abajo).

---

## 1. Cambiazo en el intercambio: el "Estoy listo" no queda atado a la oferta que viste — ALTA — REPRODUCIDO

**Qué pasa.** A ofrece algo valioso, B lo ve y aprieta "Estoy listo". Si justo antes de que llegue ese "listo" A
cambió la oferta por algo barato, el servidor procesa: (1) la oferta nueva de A → borra los "listo"; (2) el "listo"
de B → queda en `true`, ahora sobre la oferta barata. A confirma y el intercambio se hace con lo barato. B nunca
confirmó viendo esa oferta. La ventana es la latencia de B (lo que tarda su "listo" en llegar), y A puede provocarla
cambiando la oferta en el momento en que B está por confirmar (ej.: le dice por chat "dale, aceptá").

**Debería pasar:** un "listo" mandado viendo una oferta vieja no debería contar para la nueva.

**Pasos** (`t1_trade.mjs`, bloque 1):
```js
ca.send({ t: 'trade', op: 'offer', iids: [valioso.iid] });
await cb.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.items.some((i) => i.iid === valioso.iid));
ca.send({ t: 'trade', op: 'offer', iids: [barato.iid] });   // A cambia
await sleep(150);
cb.send({ t: 'trade', op: 'ready', v: true });               // B confirma "viendo" lo valioso
await ca.wait((m) => m.t === 'trade' && m.op === 'state' && m.them.ready);
ca.send({ t: 'trade', op: 'ready', v: true });
```
Resultado: `B ve en la oferta: minibar` → `Cambiazo: done | B recibió: [ 'espejos' ]`.

**Código:** `server/room.js` 1088-1091 (`case 'ready'`: `trade.ready[me] = !!msg.v` sin mirar versión);
el cliente manda `{ op: 'ready', v: bool }` en `src/ui/social.js` 353.

**Arreglo sugerido:** que cada `state` lleve un número de versión de la oferta (`trade.v` o uno propio que suba
solo cuando cambia `items`), que el cliente lo devuelva en `ready` (`{ op: 'ready', v: true, ver }`) y que el
servidor ignore el `ready` si `ver` no es el actual. Opcional: después de un cambio de oferta, no aceptar "listo"
por 1-2 s (como hacen otros juegos) para que el otro alcance a ver el cambio.

---

## 2. Granja de cuentas: cada cuenta nueva trae 15 objetos (incluye muebles especiales y exóticos) que se pasan a la principal — ALTA — REPRODUCIDO

**Qué pasa.** `register` da el paquete inicial de 15 objetos al azar entre prendas y **muebles especiales**
(`SPECIAL_FURNITURE`, incluye el Trono dorado, que es exótico, y Minibar/Cafetera/Barra de tragos/Bola de espejos/
Sillón de neón, que son raros). No hace falta verificar el mail ni jugar nada: se registra, se entra y se le pasa
todo a la cuenta principal por intercambio (o soltándolo en el piso). El único freno es 20 cuentas/hora por IP:
**300 objetos por hora por IP**, cada 1-2 cuentas sale un objeto exótico. Además cada cuenta nueva:
- es una sala personal nueva para visitar (+5 puntos y misión "visitá 2 salas" para la principal),
- da para hacer las diarias/camino (ver hallazgo 4) y sacar consumibles.

En la prueba, la primera cuenta creada ya trajo `minibar, trono, ..., cafetera, minibar, espejos, ..., barraTragos, barraTragos`.
En `t6_consumibles.mjs` se crean cuentas, se les sacan los premios y se pasan a una sola por intercambio sin problema.

**Pasos** (`t0.mjs` + `t6_consumibles.mjs`):
```js
const a = await acct();                     // register
const inv = await inventory(a.token);       // 15 objetos, con muebles especiales
// …invite/accept/offer(inv)/ready ×2 con la cuenta principal
```

**Debería pasar:** el paquete inicial tendría que ser poco valioso o atarse a algo que no sea gratis (mail
verificado, tiempo de juego, primer nivel), y los raros/exóticos no deberían poder pasarse apenas creada la cuenta.

**Código:** `server/accounts.js` 485-493 (`giveStarter`: `pool = [...STARTER_ITEMS, ...SPECIAL_FURNITURE]`),
297 (se da al registrarse), 64 (`CREATE_PER_HOUR = 20`); `server/room.js` 1022+ (intercambio sin restricción
por antigüedad de la cuenta).

**Arreglo sugerido (es decisión de diseño, consultar al dueño):** sacar los muebles especiales/exóticos del paquete
inicial o darlos al llegar a cierto nivel; bloquear intercambiar/soltar objetos los primeros N días o hasta mail
verificado; o marcar los objetos del paquete inicial como "no intercambiables".

---

## 3. Mueble oculto `barraCafe` (de la Cafetería pública) se puede poner gratis en la sala propia y reparte café sin límite — MEDIA — REPRODUCIDO

**Qué pasa.** El editor acepta cualquier tipo de `FURNITURE`, incluidos los `hidden: true` que son de los mapas
públicos. `barraCafe` no es especial (no sale del inventario), no tiene `max` y tiene `gives: 'cafe'`: el dueño la
pone gratis las veces que quiera y él y sus visitas toman café igual que de una **Cafetera** (mueble especial,
rareza "raro"). Eso le quita todo el valor a Cafetera/Minibar/Barra de tragos. Lo mismo con `bancoPlaza`,
`mesaCafe`, `sillaCafe` y `probador` (no reparten nada, pero tampoco deberían estar).

**Pasos** (`t2_sala.mjs`, bloque 3):
```js
co.send({ t: 'edit', op: 'add', piece: { id: 'tmp4', type: 'barraCafe', x: 0, z: 2 } });  // → piece barraCafe
co.send({ t: 'consume', from: 'piece', piece: p.piece.id });                              // → consume cafe
```
Resultado: `add barraCafe (oculto): piece barraCafe` · `consumir de barraCafe: consume cafe` · `add bancoPlaza/probador/mesaCafe: piece`.

**Código:** `server/editor.js` 65-66 (solo chequea `has(FURNITURE, type)`), `server/shared.js` 300 (`barraCafe ... hidden: true, gives: 'cafe'`).

**Arreglo sugerido:** en `op === 'add'` rechazar `def.hidden` (y de paso en `cleanPiece` cuando la plantilla no es
pública), o mover esos muebles a un catálogo aparte solo para `PUBLIC_MAPS`.

---

## 4. "Obras fijas" inventadas: `progressview` con `fixed` cualquiera cumple el paso del camino y la diaria "Mirá 3 obras" — MEDIA — REPRODUCIDO

**Qué pasa.** `progressView(token, id, fixed)` acepta como `fixed` cualquier texto de hasta 60 caracteres, sin
compararlo con la lista de obras de base del Museo. Con tres pedidos `fixed: 'f1' | 'f2' | 'f3'` (estando conectado
al Museo, sin moverse ni mirar nada) se gana el paso 1 del camino (+20 puntos + objeto básico) y, si salió la
diaria de obras, otro objeto básico. Junto con el hallazgo 2, es un sacadero de objetos y consumibles (`trago`/`cafe`
están en la rareza básica): en `t6_consumibles.mjs` se juntaron 3 cafés en pocas cuentas.

**Pasos** (`t4_progreso.mjs`):
```js
await joined(A.token, 'museo');
for (const k of ['inventada-1', 'inventada-2', 'inventada-3']) await api('progressview', { method: 'POST', token: A.token, body: { fixed: k } });
```
Resultado: `Camino: "Mirá tu primera obra con E" ✓ (+20 puntos, Mochila (básico))` · `Misión diaria: "Mirá 3 obras con E" ✓ Ganaste: Lentes redondos (básico)` · objetos 15 → 17.

**Código:** `server/progress.js` 305-307.

**Arreglo sugerido:** validar `fixed` contra la lista real de obras de base (las mismas claves que usa el cliente
en el Museo; ponerlas en `shared.js`), y opcionalmente exigir que el jugador esté cerca de esa obra (la sala sabe la
posición).

---

## 5. Eventos truchos: 6 cuentas propias AFK + cabina prendida sin música real = 50 puntos cada 5 minutos — MEDIA — REPRODUCIDO (ver resultado abajo)

**Qué pasa.** Un "evento" es cualquier set de DJ con más de 5 personas en la sala; la clave del evento incluye el
`streamId` que manda el cliente y la hora de inicio. El dueño de una sala con plantilla `club` (trae cabina) mete 5
cuentas propias quietas/AFK, prende la cabina con un `streamId` inventado (no se controla que haya audio), espera 5
minutos, apaga y vuelve a prender con otro `streamId` → evento nuevo → +50 puntos para las 6 cuentas, una y otra
vez. 600 puntos/hora para cada cuenta → niveles → objetos (raro cada 5 niveles, exótico cada 10).

**Pasos** (`t5_eventos.mjs`):
```js
co.send({ t: 'edit', op: 'template', template: 'club' });
// 5 cuentas más entran a u-<dueño> y mandan { t: 'afk', v: true } cada 20 s
co.send({ t: 'dj', on: true, streamId: `falso-${ronda}-${Math.random()}` });
// esperar 5 min + 70 s; { t: 'dj', on: false }; repetir
```
Resultado (`t5b_eventos.mjs`, ronda 1, 6 min 10 s): puntos `[0, 5, 5, 5, 5, 5]` → `[50, 55, 55, 55, 55, 55]` y aviso
al dueño `¡Subiste a nivel 2! Ganaste: Café (básico)`. Nadie pasó música, todos AFK. La ronda 2 (apagar/prender con
otro `streamId`) no llegó a terminar porque se reinició el servidor de pruebas, pero por código (`key` nueva → `st`
nuevo con `done` vacío y `ref` con `start` nuevo) cuenta como otro evento.

Detalle técnico: en la primera corrida (`t5_eventos.mjs` / `t5_debug.mjs`, solo `afk` cada 20 s) **no** sumó nada,
porque la sala hibernó y al despertar `this.dj` volvió a `null` sin avisar a nadie (el observador ve `dj = null` a
los 35 s). Con el dueño mandando `s` cada 3 s la sala no hiberna y el truco funciona. Ver también "Otros" al final:
que el DJ se pierda al hibernar es un bug aparte.

**Código:** `server/progress.js` 362-386 (`roomEventTick`: clave con `streamId` y `start`, sin tope por persona),
`server/room.js` 431 (`streamId` tal cual lo manda el cliente).

**Arreglo sugerido (consultar diseño):** contar personas distintas que NO sean AFK y que no sean cuentas nuevas;
tope de eventos que suman por persona por día (o por DJ/sala por día); exigir que el set dure de verdad (que el SFU
tenga la pista `-dj` publicada) y que el apagar/prender rápido siga siendo el mismo evento.

---

## 6. Una oferta se pierde si los dos ofrecen a la vez — BAJA — REPRODUCIDO

**Qué pasa.** El contador de versión de ofertas (`trade.v`) es uno solo para los dos jugadores. Si A y B mandan su
oferta casi a la vez, la de quien llegó primero se descarta en silencio (`trade.v !== v`). La interfaz muestra lo que
manda el servidor, así que se ve que falta, pero si los dos confirman rápido sale un intercambio desparejo: en la
prueba A dio su objeto y no recibió nada (`A tiene y: false | B tiene x: true`).

**Pasos** (`t1_trade.mjs`, bloque 3): `ca.send(offer [x]); cb.send(offer [y]);` y después los dos `ready`.

**Código:** `server/room.js` 1079-1082.

**Arreglo sugerido:** versión por jugador (`trade.v[me]`), así una oferta nueva solo pisa una oferta vieja del mismo jugador.

---

## 7. Dos consumibles a la vez: se gastan los dos y el efecto es uno solo — BAJA — REPRODUCIDO

**Qué pasa.** `consumeMessage` mira si ya hay efecto antes de esperar a la cuenta, y lo marca después. Dos
`consume from item` seguidos pasan los dos el control, se borran los dos objetos y el efecto dura lo mismo. Es una
pérdida para el propio jugador (doble clic), no una ventaja.

**Pasos** (`t6_consumibles.mjs`): `consume iid1; consume iid2` → `efectos: 2 | se gastaron: 2`.

**Código:** `server/room.js` 863 y 884-888 (el `boosts.set` va en `startBoost`, después del `await useConsumable`).

**Arreglo sugerido:** marcar el efecto (o un "tomando" en memoria) antes del `await` y deshacerlo si falla.

---

## 8. El efecto del consumible vive en cada sala: cambiar de sala permite tomar otro enseguida — BAJA — REPRODUCIDO

**Qué pasa.** `this.boosts` es memoria de cada Room. Con el efecto activo en la Plaza, entrar a la Cafetería y tomar
otro funciona (`[ 'consume' ]`). Hoy el efecto es solo stamina y en el Museo hay barra gratis, así que el impacto es
chico; importa si algún día el efecto da algo más.

**Código:** `server/room.js` 90, 858, 863.

**Arreglo sugerido:** guardar "hasta cuándo dura" en la cuenta (`Accounts`) o pasarlo en el `join`.

---

## Hipótesis peligrosas no confirmadas

- **Efecto del consumible y los intercambios se pierden cuando la sala hiberna:** `this.boosts`, `this.trades`,
  `this.dj` y `this.parts` viven en memoria de la Room (`server/room.js` 82-90). Comprobé que `this.dj` se borra solo
  al hibernar (con ~30 s sin mensajes). Por lo mismo, el efecto de un trago debería poder renovarse esperando a que la
  sala duerma, y un intercambio abierto desaparecería sin aviso (no duplica nada: la cuenta valida todo al final).
  No lo reproduje por separado.

- **Curador + obras basura de cuentas propias:** cada curación da 15 puntos (`progressTrack('curada')`, `server/works.js` 214)
  una vez por obra. Un curador con cuentas propias que postulan obras sin parar podría curar sin fin. No lo probé
  (hace falta un curador: nivel 8 + 30 obras vistas, o un admin). Sugerencia: tope diario de puntos por curar.
- **"Exponer" 100 puntos con cuentas propias votando:** si la exposición depende de votos de curadores, un grupo de
  cuentas propias podría hacerse exponer. No lo revisé a fondo.
- **Visitar salas de cuentas recién creadas:** cada cuenta nueva = +5 puntos y avance de "Visitá 2 salas" para la
  principal (`t4_progreso.mjs`: nivel 1 → 2 con 4 cuentas nuevas). Es parte del hallazgo 2; con 20 cuentas/hora/IP
  son ~100 puntos/hora. Sugerencia: no contar salas de cuentas sin nickname verificado o con pocos días.
- **Paso "Agregá un amigo" con solo mandar la solicitud** (`server/accounts.js` 631): no hace falta que acepten. Solo da el paso del camino.

## Cosas que probé y están bien

- **Ofrecer y después soltar el objeto** antes de confirmar: el intercambio falla ("Algún objeto ya no está disponible") y nadie recibe nada.
- **Spam de "listo"** de los dos lados (5 veces cada uno): se ejecuta una sola vez (`trade.busy`).
- **Ofrecer objetos ajenos, repetidos, `constructor` / `__proto__`**: `ownedItems` solo deja los propios y sin repetir.
- **Poner un mueble especial y soltarlo a la vez**: uno solo gana (quedó puesto; el `drop` dice "Ese objeto no es tuyo").
- **Poner el mismo mueble especial dos veces a la vez**: queda una sola pieza.
- **Sacar dos veces el mismo mueble + cambiar de plantilla a la vez**: vuelve una sola vez al inventario (sin duplicar).
- **Equipar algo que está en el piso** (`POST equip`): "Ese objeto no es tuyo".
- **Juntar a la vez desde tres cuentas** (dueño y dos más, pasado el bloqueo de 5 s): lo tiene una sola.
- **Soltar el mismo objeto tres veces a la vez desde dos salas** (dos conexiones de la misma cuenta): aparece una sola
  vez en el piso; la conexión vieja se corta (`4005`, una conexión por cuenta).
- **Consumir algo que no es consumible**: rechazado (y el objeto queda).
- **Consumir de un mueble estando lejos**: lo frena (`near` 3,5 m) / el efecto activo.
- **`designcopy`**: solo el autor (ya cubierto en `test/disenos.test.mjs`; no encontré forma de copiar uno ajeno ni
  de hacerlo con un diseño puesto en la sala o tirado en el piso, porque exige `owner_id = vos`).
- **Intercambios y suelo con objetos puestos en la sala** (`room:<id>`): fallan, no son del jugador.
- **Registro doble con el mismo token de invitado** (solo leyendo el código, no lo corrí): entre el último `await` y
  `giveStarter` no hay espera, así que el paquete inicial se da una sola vez (`starter`). Eso sí: el segundo registro
  pisa nickname/mail del primero (`server/accounts.js` 287-289); no es de economía.

## Otros (fuera de economía, para otro tester)

- **El DJ se pierde solo cuando la sala hiberna** (REPRODUCIDO con `t5_debug.mjs`): el DJ prende la cabina, la gente
  está quieta y a los ~35 s alguien que entra recibe `welcome.dj = null`; los que ya estaban no reciben ningún `dj off`.
  `server/room.js` 82 (`this.dj = null` en el constructor). Sugerencia: guardar `dj`/`parts` en el storage de la sala
  (o con `serializeAttachment` del que pasa música) y restaurarlos en `load()`.
