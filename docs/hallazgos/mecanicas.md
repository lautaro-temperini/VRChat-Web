# Hallazgos: mecánicas raras y huecos de diseño

Tester: "el que explora mecánicas raras". Servidor local de pruebas `http://127.0.0.1:8788` (rama `main`, commit 99ea0d6).
Scripts en `C:\Users\xvvave\AppData\Local\Temp\claude\E--Proyectos-VRChat-Web\2f29601f-5f33-48e3-a6f0-45d92e7d9cc3\scratchpad\bots\mecanicas\`
(`lib.mjs` reusa `test/helpers.mjs`; se corren con `node <script>.mjs`, por defecto contra el 8788).

> Nota del entorno: otros testers comparten el mismo 127.0.0.1 y se llenó el freno de 20 altas por IP y por hora.
> Para seguir, `lib.mjs` manda un `CF-Connecting-IP` inventado en cada alta. **Eso solo anda en local**: en Cloudflare
> ese encabezado lo pone el borde y no se puede falsear, así que no lo cuento como hallazgo.

Convención: **[BUG]** = el código no cumple una decisión ya tomada (o es incoherente). **[HUECO]** = falta una regla:
hay que decidirla con el dueño (CLAUDE.md, regla 1) antes de tocar nada.

---

## Resumen

| # | Título | Tipo | Gravedad | Estado |
|---|---|---|---|---|
| 1 | Farmeo infinito de eventos: 1 cuenta + 5 invitados, y cada cambio de `streamId` cuenta como un set nuevo | BUG + HUECO | **alta** | REPRODUCIDO |
| 2 | La cabina y la consola se toman desde cualquier lugar de la sala (el servidor no mira la distancia) | BUG | media | REPRODUCIDO |
| 3 | Una sola persona acapara DJ + luces + pantalla (+ 2ª pantalla) a la vez | HUECO / BUG | media | REPRODUCIDO |
| 4 | Spam de avisos del sistema con `dj on` / `part on/off` repetidos (se saltea el antiflood del chat) | BUG | media | REPRODUCIDO |
| 5 | El "track" del DJ es un canal de texto libre: se saltea el antiflood, el "ignorar" y el chat deshabilitado | BUG | media | REPRODUCIDO |
| 6 | El dueño saca la cabina / consola / pantalla (o cambia de plantilla) y el DJ y los artistas siguen | BUG | media | REPRODUCIDO |
| 7 | Grupo de voz acéfalo: si el líder cierra la pestaña nadie puede invitar ni sacarlo y ocupa un lugar | BUG | media | REPRODUCIDO |
| 8 | Teletransporte reconectando: la posición del `join` (y la primera `s`) no pasa por el control de velocidad | BUG | media | REPRODUCIDO |
| 9 | Altura (`y`) sin ningún control: volar, esconder objetos a 300 m, juntar cosas "desde arriba" | BUG / HUECO | baja-media | REPRODUCIDO |
| 10 | 2ª pantalla (`escenario2`) en el Museo, que no tiene segunda pantalla | BUG | baja | REPRODUCIDO |
| 11 | Diaria "Mirá 3 obras" y paso 1 del camino con claves de obras fijas inventadas | BUG | baja | REPRODUCIDO |
| 12 | El efecto de 2 min es por sala: en otra sala se puede tomar otro enseguida | BUG | baja | REPRODUCIDO |
| 13 | El beso renueva el efecto aunque esté activo (consumibles no) y no mira la altura | HUECO | baja | REPRODUCIDO |
| 14 | `consume` desde la barra valida `kind` con `CONSUMABLES[x]` (sin `Object.hasOwn`) | BUG | baja | REPRODUCIDO |
| 15 | Salas favoritas acepta salas que no existen | BUG | baja | REPRODUCIDO |
| 16 | `kiss` y `consume` no están en el balde `HEAVY` del antiflood | BUG | baja | por lectura de código |

Totales: **alta 1 · media 7 · baja 8** (más 6 hipótesis peligrosas sin confirmar, abajo).

---

## 1. Farmeo infinito de eventos (puntos, niveles, recompensas, insignia Fiestero) — ALTA

**Tipo:** BUG (cada re-"on" crea un set nuevo) + HUECO (los invitados cuentan como "personas").
**Estado:** REPRODUCIDO (`eventos2.mjs`, que mira el progreso cada 30 s; el primer intento, `eventos.mjs`, miró justo antes de que se cumplieran los 5 min contando el arranque en la alarma de 30 s)

**Pasos** (`eventos.mjs`):
```js
const A = await account('mxev');                       // una cuenta registrada
const room = `u-${A.user.id}`;                          // su propia sala
const ca = await joined(A.token, room);
ca.send({ t: 'edit', op: 'template', template: 'club' }); // la plantilla club trae cabina
for (let i = 0; i < 5; i++) gs.push(await joined((await guest(`bot${i}`)).token, room)); // 5 invitados
ca.send({ t: 'dj', on: true, streamId: 'set1' });      // nadie pasa música de verdad (no hay push al SFU)
await sleep(5.6 * 60_000);                              // → evento 1
ca.send({ t: 'dj', on: true, streamId: 'set2' });      // sin bajarse de la cabina
await sleep(5.6 * 60_000);                              // → evento 2
```
**Resultado** (log `eventos2.log`):
```
05:47:22 → dj on streamId=set1
05:52:53 5.5 min nivel 2 puntos 50 eventos 1
05:55:23 → dj on streamId=set2        (mismo DJ, sin bajarse)
06:00:53 13.5 min nivel 2 puntos 100 eventos 2
```
O sea: 1 cuenta + 5 invitados alcanzan, y cambiar el `streamId` arma un evento nuevo cada ~5,5 min.

**Qué pasa:**
- `roomEventTick` (server/progress.js:364-387) cuenta `people` con todas las conexiones, **invitados incluidos**
  (línea 375). Los invitados se crean sin mail (hasta 20 por IP por hora) y con una pestaña cada uno alcanza.
- La clave del evento es `dj:<id>:<streamId>` (línea 368) y el `streamId` lo manda el cliente. Re-mandar
  `{t:'dj', on:true, streamId:'otro'}` estando ya en la cabina pasa el chequeo de `room.js:427` (`this.dj.id !== meta.id`
  es falso → no está "ocupada") y reemplaza `this.dj` (room.js:431) → en la próxima alarma `st.key !== key` y arranca
  un evento nuevo con `start` nuevo, o sea una `ref` nueva para `progressOnce`. Con la consola pasa lo mismo soltando y
  volviendo a tomar las luces después de una alarma (30 s) sin show.
- No hace falta pasar música de verdad: nunca se valida que el DJ haya publicado la pista (`pubs.dj`).
- Ritmo: 50 puntos cada ~5 min = ~600 puntos por hora → nivel 5 (500) en <1 h, nivel 8 (1.400, requisito de
  Curador) en ~2,5 h, nivel 10 (2.250, objeto **exótico**) en ~4 h, todo con un objeto por nivel. También sube
  la insignia Fiestero (3/15/50) y completa el paso "evento" del camino y la diaria "evento".

**Qué debería pasar:** "Eventos: cualquier set… con más de 5 personas presentes" y "cada set es un evento"
(ROADMAP). Un set no debería renacer cambiando un texto, y "personas" probablemente no debería incluir invitados
(los invitados no suman progresión, pero acá le hacen sumar a otro).

**Arreglo sugerido (sin implementar):**
- BUG: que la clave del evento no dependa de `streamId` (usar la hora de inicio del set que guarda el servidor),
  y que un `dj on` del que ya es DJ no reinicie `this.dj` (o que se ignore). Igual para la consola: guardar el `start`
  del show en `this.parts[part]` y no borrarlo por un hueco entre alarmas.
- HUECO para el dueño: ¿los invitados cuentan para las 6 personas? ¿cuentan los AFK (hoy sí, por decisión)?
  ¿Hace falta música de verdad (pista `dj` publicada)? ¿Tope de eventos por día por persona? ¿Un mínimo de
  cuentas *registradas distintas* (no del mismo IP)?

---

## 2. La cabina y la consola se toman desde cualquier punto de la sala — MEDIA

**Tipo:** BUG (decisión: "Se arranca con E en la cabina; el DJ queda fijo ahí"). **REPRODUCIDO** (`cabina.mjs`, paso 1).
```js
const ca = await joined(A.token, 'inmersiva', [0, 0, 6.8, 0, 0, 0]); // en la entrada; la cabina está en z = -6,6
ca.send({ t: 'dj', on: true, streamId: 'x' });
// → {"t":"dj","on":true,...}  aceptado a 13,4 m de la cabina
```
Lo mismo con `part` (luces, escenario). El "quedar fijo en la cabina" lo hace solo el cliente (`ctrl.enterBooth`);
el servidor no controla que el DJ siga ahí (puede seguir caminando por la sala con otro cliente).
**Responsable:** `server/room.js:417-461` (no hay chequeo de distancia; compará con `consumeMessage`, que sí usa `near`).
**Arreglo sugerido:** medir con `this.near(meta, cabina.x, cabina.z, ~3)` usando el mueble del `layout()` (en el
Museo, una posición fija como la barra). Opcional: soltar la cabina si el DJ se aleja (HUECO: ¿se quiere?).

---

## 3. Una persona acapara DJ + luces + pantalla (+ 2ª pantalla) — MEDIA

**Tipo:** HUECO / BUG. Decisión: "Varios a la vez, **una parte cada uno**: luces y pantalla → 1 VJ + 1 DJ + 1 de luces".
**REPRODUCIDO** (`cabina.mjs`, paso 2):
```js
ca.send({ t: 'dj', on: true, streamId: 'x' });
ca.send({ t: 'part', part: 'luces', on: true });
ca.send({ t: 'part', part: 'escenario', on: true, streamId: 'y' });
// B recibe: [["luces",true,"mxA…"],["escenario",true,"mxA…"]]  + el DJ: los tres para la misma persona
```
Con un cliente de verdad no se puede (al tomar una queda "fijo en la cabina"), pero un cliente modificado deja
las tres ocupadas y nadie más puede usarlas (sin cola, "la cabina está ocupada por X").
**Responsable:** `server/room.js:419-458`.
**Arreglo sugerido:** si se decide que es "una parte cada uno", rechazar `dj on` / `part on` cuando la persona ya
tiene otra. **Preguntar al dueño**: ¿un DJ puede también manejar sus luces (show de una sola persona)?

---

## 4. Spam de avisos del sistema con `dj on` / `part on/off` — MEDIA

**Tipo:** BUG. **REPRODUCIDO** (`cabina.mjs`, pasos 3 y 5):
```js
for (let i = 0; i < 10; i++) ca.send({ t: 'dj', on: true, streamId: `x${i}` });
// → a B le llegan 10 {t:'dj',on:true}; cada uno muestra "🎧 X empezó a pasar música en la cabina."
for (let i = 0; i < 6; i++) { ca.send({ t: 'part', part: 'luces', on: false }); ca.send({ t: 'part', part: 'luces', on: true }); }
// → 12 avisos "💡 X tomó / soltó las luces"
```
El único freno es el balde `heavy` (ráfaga 30, 5 por segundo): ~5 avisos por segundo para toda la sala, sin
el antiflood del chat (5 cada 10 s) y sin que "ignorar" lo filtre (`onDJ`/`onPart` en `src/app/escenario.js:156-200`
no miran `isIgnored`). Además reinicia el evento (ver #1).
**Responsable:** `server/room.js:427-432` (re-"on" del mismo DJ) y `:448-459` (tomar/soltar sin pausa).
**Arreglo sugerido:** ignorar el `on` del que ya la tiene; cooldown corto para volver a tomar una parte
(HUECO: ¿cuánto?); en el cliente, no mostrar avisos de alguien ignorado.

---

## 5. El "track" del DJ como canal de texto sin antiflood ni "ignorar" — MEDIA

**Tipo:** BUG. **REPRODUCIDO** (`cabina.mjs`, paso 4; B había ignorado a A con `POST ignore`):
```js
for (let i = 0; i < 10; i++) ca.send({ t: 'dj', track: `texto libre por el cartel del DJ #${i}` });
// → a B (que ignoró a A) le llegan los 10 → "♪ Ahora suena: texto libre…" en su chat
```
Hasta 120 caracteres libres, a ~5 por segundo, que se ven en el chat de todos y en el cartel de la cabina.
No pasa por el antiflood del chat, ni por `settings.chat = false`, ni por "ignorar"; solo se frena si el DJ está
silenciado (porque silenciar lo baja de la cabina).
**Responsable:** `server/room.js:433-437`; cliente `src/app/escenario.js:169-171`.
**Arreglo sugerido:** aplicar el mismo antiflood del chat (o uno propio, p. ej. un cambio de tema cada 20 s), respetar
`settings.chat` y filtrar en el cliente si el DJ está ignorado.

---

## 6. Sacar la cabina / consola / pantalla (o cambiar de plantilla) no baja al DJ ni a los artistas — MEDIA

**Tipo:** BUG (incoherencia: `hasGear` se mira solo al tomar). **REPRODUCIDO** (`sacarcabina.mjs`):
```js
// A (dueño) pone la plantilla club; B toma DJ, luces y pantalla
for (const t of ['cabina', 'consola', 'pantalla']) for (const p of byType(t)) ca.send({ t: 'edit', op: 'remove', id: p.id });
// B solo recibe piece- ×3: ningún dj off / part off
cb.send({ t: 'dj', track: 'sigo pasando música sin cabina' });  // → se reparte a todos
ca.send({ t: 'edit', op: 'template', template: 'loft' });       // loft no tiene cabina
// welcome de alguien que entra después: dj = {"id":…,"track":"sigo pasando música sin cabina"}, parts = {luces, escenario}
```
La música sigue sonando "desde ningún lado" (los parlantes también se pueden sacar) y quien entra ve un DJ en una
sala sin cabina. Si el VJ tenía `escenario2` y se saca una pantalla, sigue publicando la 2ª pista.
**Responsable:** `server/editor.js:121-127` (remove) y `:59-69` (template) no llaman a `stopDJ` / `releasePart`.
**Arreglo sugerido:** después de `remove`/`template`, revisar `hasGear('dj'|'luces'|'escenario'|'escenario2')` y bajar
lo que ya no tiene equipo (con aviso).

---

## 7. Grupo de voz acéfalo cuando el líder se va de la sala — MEDIA

**Tipo:** BUG respecto de "si se va, pasa al siguiente". **REPRODUCIDO** (`grupos.mjs`, sala `taller`):
```js
await invite(ca, cb); await invite(ca, cc); await invite(ca, cd);   // A líder, grupo de 4
await ca.close();                                                   // A cierra la pestaña
// grupos: {"leader":"<A>","members":[A,B,C,D]}  (A sigue como líder y ocupando un lugar)
cb.send({ t: 'group', op: 'invite', to: ce.id }); // → "Solo quien armó el grupo puede invitar."
cb.send({ t: 'group', op: 'kick', userId: A.user.id }); // → no pasa nada (solo el líder saca)
```
El grupo queda lleno (4/4) con un fantasma y sin nadie que pueda invitar ni sacar, hasta que se vayan todos o A
vuelva a esa sala. A, mientras tanto, puede armar otro grupo en otra sala.
**Responsable:** `server/room.js:1157-1163` (al salir solo se disuelve si no queda nadie; nunca pasa el liderazgo).
**Arreglo sugerido:** al salir de la sala, si era el líder, pasar el liderazgo al siguiente presente. **HUECO**:
¿el que se fue de la sala debería salir del grupo del todo (decisión: "Solo en la misma sala")? ¿o conservar su
lugar un rato por si se le cortó internet?

---

## 8. Teletransporte reconectando (se saltea el control de velocidad nuevo) — MEDIA

**Tipo:** BUG (el control de velocidad de 99ea0d6 se esquiva). **REPRODUCIDO** (`posiciones.mjs`, pasos 2-4, sala `azotea`):
```js
ca.send({ t: 's', s: [0, 0, -6.8, 0, 0, 0] });     // salto de 13,6 m → pos-fix (bien)
await ca.close();
ca = await joined(A.token, 'azotea', [0.3, 0, -6.4, 0, 0, 0]); // reconecta "pegado a la cabina"
// → los demás lo ven en [0.3,0,-6.4]: aceptado
// join sin "s" + primera {t:'s'} a [11,0,-8.5] → también aceptada (no hay posición previa)
```
Cerrar y abrir el WebSocket tarda ~100 ms, así que el control de velocidad sirve contra el lag pero no contra
alguien que quiera ir a cualquier lado (adentro de paredes, a la cabina, a la barra para tomar, al lado de
alguien para el beso o para juntar un objeto). El `bring`/`spawn` de un mod también deja una posición libre
(`freeMove`), que el cliente puede usar para ir a cualquier otro lado en vez del destino.
**Responsable:** `server/room.js:292-293` (estado del `join` sin validar) y `:334` (sin `prev` no se controla).
**Arreglo sugerido:** que el servidor ignore la posición del `join` y ponga al jugador en la entrada de la sala
(`SPAWN`/`ROOM_SPAWN`/`PUBLIC_MAPS[x].spawn`), o que el primer `s` tenga que estar cerca de la entrada. Con `freeMove`,
validar que la siguiente posición quede cerca del destino del teletransporte. HUECO: ¿volver a la misma sala
(recargar) debería dejarte donde estabas?

---

## 9. La altura (`y`) no tiene ningún control — BAJA-MEDIA

**Tipo:** BUG / HUECO (el servidor no conoce la geometría). **REPRODUCIDO** (`posiciones.mjs` paso 1, `suelo.mjs`):
```js
ca.send({ t: 's', s: [0, 400, 6.8, 0, 0, 0] });         // → aceptado, sin pos-fix (solo se mide x/z)
// Objetos: A "vuela" a 300 m y suelta un objeto en y = 302,5
ca.send({ t: 's', s: [0, 300, 22, 0, 0, 0] });
ca.send({ t: 'drop', iid, x: 0.5, y: 302.5, z: 22 });   // aceptado
cb.send({ t: 'pickup', iid });                          // desde el piso → "Está muy lejos"
cb.send({ t: 's', s: [1, 301, 22, 0, 0, 0] }); cb.send({ t: 'pickup', iid }); // → picked
```
Consecuencias: volar/flotar a la vista de todos; pararse sobre lo "no pisable" (`noStand`) o sobre el techo;
soltar objetos donde nadie con un cliente normal llega (en la práctica, se pierden a los 60 s: solo te dañás a vos,
salvo que sea para "esconderlo" de otros durante un intercambio de mentira); y juntar objetos detrás de paredes.
**Responsable:** `server/room.js:324-344` (solo `Math.hypot` en x/z), `:515-519` (`inReach` confía en la `y` guardada).
**Arreglo sugerido:** límite de altura por sala (techo de la plantilla `h`, o un máximo del mapa) y velocidad vertical
máxima (caída libre aparte). HUECO: ¿se quiere controlar la altura en el servidor (costo/beneficio)?

---

## 10. Segunda pantalla (`escenario2`) en el Museo — BAJA

**Tipo:** BUG. **REPRODUCIDO** (`cabina.mjs` paso 6):
```js
const cm = await joined(A.token, 'museo', [-27.5, 0, 0, 0, 0, 0]);
cm.send({ t: 'part', part: 'escenario2', on: true, streamId: 'z' });
// → {"t":"part","part":"escenario2","on":true,...} a todos
```
`hasGear` devuelve `true` para todo cuando no hay `layout` (el Museo), también para `escenario2`, que el Museo no tiene.
Los clientes muestran "🎬 X está pasando visuales en la pantalla" (texto genérico de `onPart`), y el que la tiene
puede publicar una pista `stage2` que nadie ve.
**Responsable:** `server/room.js:142-151` (`if (!layout) return true`).
**Arreglo sugerido:** en el Museo, `escenario2` → `false`.

---

## 11. Diaria "Mirá 3 obras con E" y paso 1 del camino con claves inventadas — BAJA

**Tipo:** BUG. **REPRODUCIDO** (`diarias.mjs`):
```js
const c = await joined(A.token, 'museo');
for (const k of ['inventada1', 'inventada2', 'inventada3'])
  await api('progressview', { method: 'POST', token: A.token, body: { fixed: k } });
// → "Camino: 'Mirá tu primera obra con E' ✓ (+20 puntos, Anteojos de sol)" y "Misión diaria … ✓ Ganaste: Mochila"
```
`fixed` es cualquier texto de hasta 60 caracteres; no se mira que sea una obra de base del Museo ni que estés cerca.
No da puntos de obra (bien), pero sí 20 puntos del camino, el objeto del paso y el objeto de la diaria.
**Responsable:** `server/progress.js:305-307`.
**Arreglo sugerido:** lista de claves válidas de obras de base (los 9 cuadros + 5 esculturas) en `shared.js`.

---

## 12. El efecto de 2 minutos es por sala — BAJA

**Tipo:** BUG (decisión: "Mientras el efecto está activo no se puede tomar otro"). **REPRODUCIDO** (`consumir2.mjs`):
```js
c = await joined(C.token, 'cafeteria', [1.8, 0, -3.3, 0, 0, 0]);
c.send({ t: 'consume', from: 'piece', piece: 'm0' });     // café en la barra del café → ok
// sale, entra al Museo 1 s después
c.send({ t: 'consume', from: 'bar', kind: 'trago' });     // → ok otra vez (debería ser "Todavía te dura el efecto")
```
`this.boosts` vive en la memoria de cada Room. Con consumibles de la mochila se gasta un objeto sin necesidad.
Además el efecto en sí (no gastar stamina) lo aplica solo el cliente, así que el servidor solo "frena" el gesto.
**Responsable:** `server/room.js:90, 857-863`.
**Arreglo sugerido:** guardar el "hasta cuándo" en la cuenta (Accounts) o mandarlo en el `join` desde la sala anterior.

---

## 13. El beso renueva el efecto aunque esté activo, y no mira la altura — BAJA (HUECO)

**REPRODUCIDO** (`consumir.mjs` pasos 3/4): A con el efecto activo, B a 5 m de altura (balcón) en la misma x/z:
```js
const cb = await joined(B.token, 'museo', [-20.5, 5, 9.7, 0, 0, 0]);
ca.send({ t: 'kiss', op: 'ask', to: cb.id }); /* B acepta */ // → {"t":"kiss","op":"do",...}
```
- El comentario del código dice "aunque ya tuvieran uno, se renueva", pero la decisión de consumibles dice que con
  el efecto activo no se puede tomar otro. Dos amigos pueden besarse cada 2 min y no cansarse nunca. **Preguntar**:
  ¿el beso es la excepción a "no se puede tomar otro"?
- `closeTo` usa solo x/z (`server/room.js:892-895`): se puede "besar" a alguien del piso de arriba.
**Arreglo sugerido:** sumar la `y` a `closeTo` (o `|dy| < 1`), y lo que decida el dueño sobre la renovación.

---

## 14. `consume` desde la barra: `CONSUMABLES[msg.kind]` sin `Object.hasOwn` — BAJA

**REPRODUCIDO** (`consumir.mjs` paso 1):
```js
ca.send({ t: 'consume', from: 'bar', kind: 'constructor' }); // en la barra del Museo
// → {"t":"consume","id":"…","kind":"constructor"} a todos, y efecto de 2 min
```
Rompe la regla de seguridad del proyecto ("nunca `CATALOGO[x]` con lo que manda el cliente"). Hoy el cliente lo
dibuja como un trago, así que no rompe nada, pero el `kind` basura se reparte a todos.
**Responsable:** `server/room.js:866`. **Arreglo:** `Object.hasOwn(CONSUMABLES, msg.kind)` (o el `has()` del archivo).

---

## 15. Salas favoritas acepta salas que no existen — BAJA

**REPRODUCIDO** (`favoritas.mjs`): `POST favorite {room:'no-existe'}` y `{room:'u-0000000000000000'}` se guardan y
la lista devuelve "Sala no-existe" / "Sala u-0000…". Al entrar, la sala inexistente responde `error: private`
("Sala privada"), un mensaje engañoso. Ocupan lugar del máximo de favoritas.
**Responsable:** `server/accounts.js` → `setFavorite` (solo `^[a-z0-9-]{1,32}$`). **Arreglo:** usar `isRoomName` de
`shared.js` y, para `u-<id>`, que la cuenta exista y no sea invitada.

---

## 16. `kiss` y `consume` no están en el balde `HEAVY` — BAJA (por lectura de código)

`HEAVY` (`server/room.js:54`) no incluye `kiss` ni `consume`. `kiss ask` a alguien que te ignoró o que te bloqueó
por rechazos llama a `accounts().groupInviteCheck` en **cada** mensaje (no se guarda el pedido, room.js:904-908), y
`consume from:item` llama a `useConsumable`: hasta 40 por segundo por conexión pegándole al Durable Object global de
cuentas. No lo medí (no se ve desde afuera). **Arreglo:** sumarlos a `HEAVY`.

---

## Huecos de diseño (reglas que no existen; decidir con el dueño)

1. **¿Los invitados cuentan como "personas" para un evento?** Hoy sí (ver #1).
2. **¿Hace falta música/show de verdad para que haya evento?** Hoy alcanza con "tomar" la cabina sin publicar nada.
3. **¿Tope de eventos por día?** Cada set da 50 puntos sin límite.
4. **¿Una persona puede tener varias partes (DJ + luces + VJ)?** (#3).
5. **¿Qué pasa con el grupo si el líder se va de la sala?** (#7) ¿Y un miembro que se va: conserva su lugar?
6. **¿El beso renueva el efecto activo?** (#13).
7. **¿Dónde se puede soltar objetos?** Hoy en cualquier sala (pública o ajena) mientras `settings.items` esté
   prendido; en los mapas públicos no hay dueño que lo apague (solo un admin). ¿Se quiere en la Plaza / el Galpón?
8. **¿Controlar la altura en el servidor?** (#9).
9. **Farmeo con cuentas propias**: cada cuenta nueva trae 15 objetos al azar (puede salir un trono exótico) que se
   pueden regalar a la principal con un intercambio, y cada sala de una cuenta propia da 5 puntos + avanza
   Trotamundos y la diaria "Visitá 2 salas". El freno real es el de 20 altas por IP por hora. ¿Se acepta?
10. **Curaduría "al azar"**: `reviewVote` deja votar cualquier obra pendiente por id, no solo la que te tocó, y
    "Otra" se puede apretar hasta que salga la que querés (ver hipótesis H4).

---

## Hipótesis peligrosas no confirmadas

- **H1 — Hibernación de la sala borra el estado en memoria.** `this.dj`, `this.parts`, `this.lights`,
  `this.boosts`, `this.kisses`, `this.trades`, `this.states`, `this.moveBudget` y el `shows` de los eventos viven solo
  en memoria (`server/room.js:73-93`, `progress.js:362`). Los clientes mandan `ping` cada 5 s
  (`src/net/net.js:12`), pero Chrome frena los `setInterval` de pestañas ocultas a 1 por minuto: si todos los de una
  sala están AFK con la pestaña oculta, la sala podría hibernar (~10 s sin mensajes). Al despertar: el DJ sigue
  pasando música para su cliente pero el servidor dice que no hay DJ (otro puede tomar la cabina → dos DJs), las
  luces vuelven a nada, un intercambio a medio hacer se pierde, el próximo `s` de cada uno no se controla y el
  efecto de 2 min se puede volver a tomar. No lo pude provocar con wrangler local.
- **H2 — Intercambio y hibernación**: si la sala hiberna con `trade.busy` a medias, `this.trades` se pierde;
  la cuenta hace el cambio todo o nada, así que no debería duplicar, pero los clientes quedan con la ventana abierta.
- **H3 — Cliente sin `world.artists.spots[part]`**: en una sala personal con pantalla pero sin consola,
  `hasGear('escenario')` da `true` y el cliente llama a `ctrl.enterBooth(world.artists.spots.escenario)` (`src/app/escenario.js:190`);
  si ese lugar no existe, el VJ podría quedar trabado o en (0,0,0). No lo probé en el navegador (la consigna era sin navegador).
- **H4 — Curador que elige qué obra revisar**: `reviewVote` (`server/works.js:197`) no verifica que la obra le haya
  tocado con `reviewNext`; con el id (que el autor ve en "Mis obras" y puede pasarle) un curador vota la que quiere,
  o aprieta "Otra" hasta que salga. Con dos curadores amigos entre sí (pero no del autor) se puede denegar a propósito;
  con uno solo se puede verificar la obra de un conocido "no amigo" y regalarle la racha de Creador (3 seguidas → sus
  obras entran sin revisión). No tuve un curador en local para probarlo.
- **H5 — Prioridad de la cola**: la decisión dice "orden fijo (fecha de postulación, con prioridad para usuarios)",
  pero `rotate()` ordena solo por `created` (`server/works.js:258`); no vi qué significa "prioridad para usuarios"
  (¿frente a obras cargadas por el admin?). Para revisar con el dueño.
- **H6 — Liderazgo fantasma entre salas**: un líder que se fue de la sala X (grupo acéfalo, #7) puede volver más tarde
  y seguir siendo líder del mismo grupo aunque los demás ya se acomodaron; no lo probé con tiempos largos.

---

## Cosas que probé y están bien

- **DJ en un mapa sin cabina** (Plaza): `{t:'dj', denied:true}` (`cabina.mjs` paso 7). Taller/Azotea/Galpón respetan
  qué equipo tiene cada uno (por lectura del `layout` fijo).
- **Sala `u-<id>` de una cuenta que no existe**: no se puede entrar (`canEnter` → `false`), así que no se pueden
  inventar salas para farmear "visitar salas".
- **Un solo café por vez en la misma sala**: el segundo da "Todavía te dura el efecto de lo que tomaste".
- **Barra del café de la Cafetería** (`barraCafe`, `from:'piece', piece:'m0'`) funciona y exige estar cerca (3,5 m).
- **Grupos**: no se puede invitar a alguien que ya está en un grupo; el que no es líder no invita; el máximo de 4
  se respeta (aceptaciones en orden); los grupos son por sala (en otra sala el mismo usuario no figura en grupo).
- **Beso**: hay que estar cerca al pedir y al aceptar ("Se alejaron…"); el pedido vence al minuto y un segundo
  "aceptar" del mismo pedido no hace nada; con otro número de conexión (reconectó) el pedido viejo no sirve.
- **Objetos en el suelo**: `PICKUP_LOCK` de 5 s para los demás y sin espera para el dueño; dos que juntan a la vez →
  solo uno (prueba existente `test/objetos.test.mjs`); soltar lejos de vos → "Está muy lejos".
- **Teletransporte común**: un salto de 13,6 m en un solo mensaje da `pos-fix` (el control de velocidad anda mientras
  no se reconecte).
- **Diarias**: lo que se repite en el día no cuenta dos veces (`daily_refs`); los me gusta no dan puntos.
- **Cambiar de pestaña / takeover** mientras sos DJ: abrir la cuenta en la Plaza baja la cabina de la Sala inmersiva
  (`takeover.mjs` → `{"t":"dj","on":false}`).

> Nota: el servidor de pruebas se reinició con datos limpios después de estas corridas; los scripts crean cuentas
> nuevas solos (`lib.mjs` → `account()`/`guest()`), y `pool.json` se regenera si las cuentas guardadas ya no existen.
