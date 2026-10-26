# Tester adversarial: "el acosador"

Servidor de pruebas: `http://127.0.0.1:8788` (no se tocó el repo ni la versión online).
Scripts en `C:\Users\xvvave\AppData\Local\Temp\claude\E--Proyectos-VRChat-Web\2f29601f-5f33-48e3-a6f0-45d92e7d9cc3\scratchpad\bots\acoso\`:

| Script | Qué prueba | Cómo se corre |
|---|---|---|
| `h.mjs` | atajos (cuentas e invitados con IP inventada) | — |
| `social.mjs` | amistad, ubicación, avisos, DMs, galería | `TEST_BASE=http://127.0.0.1:8788 node social.mjs` |
| `sala.mjs`, `sala2.mjs` | beso, intercambio, chat, invitados, nombres | idem |
| `grupos.mjs` | grupos de voz, ignorados | idem |
| `privada.mjs`, `extra.mjs` | salas personales, baneo, silenciados, fotos | idem |
| `sfu-logica.mjs` | permisos de voz (`sfuMessage`/`pullBlocked`/`enforce`) | `node --import ./cf-hook.mjs sfu-logica.mjs` |

Nota sobre el método: en local la IP llega vacía y el freno de "20 cuentas por hora" es compartido por todos
los robots, así que `h.mjs` crea cada cuenta con un `CF-Connecting-IP` inventado (en producción Cloudflare pisa
ese encabezado: **no es un hallazgo**). El `.dev.vars` tiene `REALTIME_APP_TOKEN`, así que mandar `sfu` al 8788
habría llamado a la API real de Cloudflare: para no salir de 127.0.0.1, la voz se probó importando
`server/room.js` del repo (sin modificarlo) con un sustituto de `cloudflare:workers` y una respuesta falsa del SFU.
Es el código real de la sala; lo único simulado es la respuesta de Cloudflare.

Resumen: **1 crítica · 4 altas · 8 medias · 5 bajas** (18 hallazgos: 11 bugs y 7 huecos de diseño; el 5 es mixto
y se cuenta como bug). Todos reproducidos, menos el 13, que sale de leer el código y está reproducido en parte.
Los 2 y 8 están reproducidos sobre la lógica real de la sala, sin el SFU real.

---

## Crítica

### 1. Cualquiera, incluso un invitado descartable, ve en vivo en qué sala estás con solo mandarte una solicitud de amistad
- **Gravedad:** crítica · **Tipo:** bug · **REPRODUCIDO** (`social.mjs`, pasos 2, 3 y 9)
- **Pasos:**
  ```js
  await api('friendrequest', { method: 'POST', token: acosador.token, body: { id: V } }); // V = userId (lo ve cualquiera en la sala)
  const f = await api('friends', { token: acosador.token });
  f.outgoing.find((x) => x.id === V).room;   // → "cafeteria"; después "azotea" cuando se mueve
  ```
  Salida: `outgoing={"id":"92b5…","name":"vic…","room":"cafeteria"}` → `"room":"azotea"` cuando la víctima cambió
  de sala. **Sigue andando después de que la víctima lo restringe y lo ignora.** Con un **invitado** recién creado
  (`POST guest`, sin mail) pasa lo mismo: `invitado ve en outgoing: {…"room":"azotea"}`.
- **Qué pasa:** `friends()` calcula `room: this.where(other.id)` para *todas* las filas (pendientes salientes y
  entrantes incluidas), no solo para las amistades aceptadas. El buscador sí lo limita ("en qué sala está, solo
  sus amigos"), pero la lista de amigos no.
- **Qué debería pasar:** la sala solo se ve en amistades aceptadas (igual que en `search`). Y quien te ignoró o
  restringió no debería verla nunca (ver hallazgo 9).
- **Dónde:** `server/accounts.js:611` (`const info = { …, room: this.where(other.id) }`).
- **Arreglo sugerido:** `room: r.status === 'accepted' && !this.shields(other.id, me.id) ? this.where(other.id) : null`.
  Además frenar las solicitudes de invitados (hallazgo 3).

---

## Altas

### 2. La voz se controla solo al suscribirse: si te acercás una vez, después te alejás y seguís escuchando desde cualquier punto de la sala
- **Gravedad:** alta · **Tipo:** bug · **REPRODUCIDO en la lógica** (`sfu-logica.mjs`; sin SFU real)
- **Pasos:**
  ```js
  room.states.set('aco1', [3,0,0,…]);                                    // a 3 m de la víctima
  await say(acosador, { t: 'sfu', op: 'pull', items: [{ id: 'vic1', kind: 'voice' }] });   // → mid "0" (permitido)
  for (let x = 3; x <= 200; x += 6) await say(acosador, { t: 's', s: [x,0,0,0,0,0] });      // se va caminando
  await room.alarm();
  ```
  Salida: `posición final del acosador: [195,0,0] | sigue escuchando: ['vic1:voice'] | sfu-cut recibidos: 0`.
  Un pull nuevo desde ahí sí da `denied`: el control existe, pero solo al pedir.
- **Qué pasa:** `pullBlocked` mide la distancia (20 m) solo en el `pull`. `enforce()` solo corre al cambiar grupos,
  silenciar o apagar la voz de la sala, nunca al moverse ni en la alarma. El cliente oficial hace `unsubscribe`
  pasando los 18 m, pero un cliente modificado no lo hace: se acerca un segundo (o se suscribe al entrar) y queda
  escuchando a la víctima en toda la sala (Galpón, Plaza de 50 × 50 m), también cuando ella se aparta para hablar
  "en privado" sin armar grupo. Un **invitado** puede hacerlo igual, porque los invitados escuchan voces públicas.
- **Qué debería pasar:** dejar de recibir la pista cuando se pasa del rango (como dice CLAUDE.md: "corta las que ya no valen").
- **Dónde:** `server/room.js:694-707` (`pullBlocked`) y `server/room.js:795` (`enforce`, sin llamarse desde `case 's'`, `:324`, ni desde `alarm`).
- **Arreglo sugerido:** correr un `enforce` liviano (solo distancia) cada 1–2 s, desde la alarma o cada N mensajes
  `s`, y cortar las voces que pasen de `VOICE_RANGE`.

### 3. Spam ilimitado de avisos: cancelar y reenviar la solicitud de amistad (también si te restringieron, y desde invitados)
- **Gravedad:** alta · **Tipo:** bug · **REPRODUCIDO** (`social.mjs`, paso 4)
- **Pasos:**
  ```js
  for (let i = 0; i < 40; i++) {
    await api('friendremove',  { method: 'POST', token: acosador.token, body: { id: V } });
    await api('friendrequest', { method: 'POST', token: acosador.token, body: { id: V } });
  }
  ```
  Salida: `avisos sin ver: 1 -> 41; de los últimos 30, 30 son del acosador`. La víctima ya lo había restringido e ignorado.
- **Qué pasa:** `friendRemove` borra la solicitud pendiente propia sin dejar rastro. El freno de 24 h
  (`friend_rejects`) solo se arma si la víctima *rechaza*, y el acosador cancela antes. Cada reenvío crea un aviso
  nuevo con `notify`. Como la app Avisos muestra los últimos 30, el acosador tapa los avisos reales. `friendRequest`
  no consulta `shields` (ignorado/restringido) y también lo aceptan los invitados.
- **Qué debería pasar:** un aviso por persona, que no se repita al cancelar y reenviar, y que no le llegue a quien te ignoró o restringió.
- **Dónde:** `server/accounts.js:620-638` (`friendRequest`) y `:651` (`friendRemove`).
- **Arreglo sugerido:** al cancelar una pendiente, guardar un `friend_rejects` corto (o no volver a avisar si ya
  hubo un aviso de esa persona en 24 h); en `friendRequest`, si `this.shields(otherId, me.id)` devolver ok sin
  insertar ni avisar (como los grupos); y `guestError()` para invitados.
  *Decisión a consultar:* ¿los invitados pueden agregar amigos? Hoy pueden (ver 1).

### 4. El antiflood del chat se reinicia al reconectar: 20 mensajes en 1,3 s
- **Gravedad:** alta · **Tipo:** bug · **REPRODUCIDO** (`sala.mjs`, "CHAT")
- **Pasos:**
  ```js
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 5; i++) ca.send({ t: 'chat', text: `molesto ${round}-${i}` });
    await sleep(150);
    await ca.close(); ca = new Client(aco.token, ROOM); await ca.join([1,0,0,0,0,0]);
  }
  ```
  Salida: `20 mensajes en 1.3 s (FLOOD_MAX = 5 cada 10 s)`. De paso, cada reconexión manda `join`/`leave` a toda la sala.
- **Qué pasa:** `chatTimes` y `lastText` van por id de conexión y `leave()` los borra; los baldes `RATE` también son
  por conexión. Reconectar es gratis (no hay freno de `join` por cuenta). En el Museo, que "no depende de que el
  admin esté conectado", alguien puede tapar el chat (y los 50 de historial) a voluntad.
- **Qué debería pasar:** 5 mensajes cada 10 s por **cuenta**, aunque reconecte.
- **Dónde:** `server/room.js:385-404` (`case 'chat'`, claves `meta.id`) y `server/room.js:1141-1143` (`leave` borra el antiflood).
- **Arreglo sugerido:** indexar `chatTimes`/`lastText` por `meta.userId` y no borrarlos en `leave` (que venzan
  solos), o guardarlos en el storage de la sala. Lo mismo para el antiflood de `join`.

### 5. Ser silenciado por el dueño o un admin no frena besos, intercambios, grupos ni gestos
- **Gravedad:** alta · **Tipo:** bug / hueco · **REPRODUCIDO** (`extra.mjs`)
- **Pasos:** el dueño manda `{ t:'mod', op:'silence', target: ca.id, v:true }`; el silenciado manda chat, `kiss ask`,
  `trade invite`, `group invite` y 10 `emote`. Salida al otro visitante: `{"kiss:ask":1,"emote":10,"trade:invite":1,"group:invite":1}` (el chat sí se frenó).
- **Qué pasa:** `silenced` solo se mira en chat, mic, DJ y consola. Silenciar es la única herramienta del moderador
  antes de expulsar, y el silenciado sigue mandando ventanas emergentes a la gente.
- **Dónde:** `server/room.js:319` (se calcula) y no se usa en `:408` (`group`), `:414` (`kiss`), `:483` (`trade`), `:359` (`emote`).
- **Arreglo sugerido:** si `silenced`, devolver "Estás silenciado en esta sala." en kiss/group/trade (y quizá en emote).
  *Decisión a consultar:* qué abarca "silenciar".

---

## Medias

### 6. Intercambio: rechazar no tiene bloqueo creciente, reconectar renueva la invitación y no hay distancia
- **Gravedad:** media · **Tipo:** bug (las dos primeras) + hueco · **REPRODUCIDO** (`sala.mjs`, "INTERCAMBIO")
- **Pasos:**
  ```js
  ca.send({ t: 'trade', op: 'invite', to: cv.id });   // la víctima rechaza → se repite 10 veces
  // sin que conteste: cerrar y reabrir el socket, invitar de nuevo (4 veces)
  ```
  Salida: `10/10 invitaciones llegaron aunque la víctima rechazó cada una`; `4/4 invitaciones nuevas sin que la
  víctima conteste`; `invitación desde 30 m`.
- **Qué pasa:** a diferencia del beso y los grupos, el intercambio no usa `groupRejected`. La clave de la invitación
  pendiente es `${me}>${msg.to}` (ids de **conexión**), y `leave()` la borra: con reconectar se saltea el "una
  invitación pendiente por vez". Se invita desde cualquier punto de la sala.
- **Dónde:** `server/room.js:1043` (clave por conexión), `:1071` (`decline` sin bloqueo) y `:1144` (`leave` borra invitaciones).
- **Arreglo sugerido:** clave por `userId` y que dure aunque reconecte; `decline` → `groupRejected(…, 'trade')` y
  `groupInviteCheck(…, 'trade')` al invitar. *Decisión a consultar:* ¿el intercambio usa el mismo bloqueo creciente? ¿hace falta estar cerca?

### 7. Los invitados descartables esquivan ignorar, el bloqueo del beso y los baneos
- **Gravedad:** media · **Tipo:** hueco de diseño · **REPRODUCIDO** (`sala2.mjs`, `privada.mjs`)
- **Pasos:** la víctima ignora y restringe la cuenta del acosador; el acosador crea `POST guest` y entra.
  Salida: `invitado-evade-ignorar-beso [{"t":"kiss","op":"ask",…}]`. La víctima rechaza, el acosador crea otro
  invitado y vuelve a pedir enseguida: llega. El dueño banea la cuenta y abre la sala: `invitado nuevo entra a la sala de la que lo banearon: welcome`.
- **Qué pasa:** ignorar, restringir, el bloqueo creciente y `bans` son por `userId`, y un invitado es un `userId`
  nuevo sin mail. El único freno es 20 por IP por hora (con IPv6 o datos móviles rinde mucho). Según la decisión del
  25/10 los invitados pueden besar, así que el beso es la vía de contacto que queda abierta.
- **Dónde:** `server/accounts.js:255` (`guest`), `server/room.js:276` (`bans[user.id]`) y `kissMessage`.
- **Arreglo sugerido (a decidir):** opción "no recibir pedidos de invitados" (beso, amistad); baneo que también
  frene a invitados de la misma IP (hash) por un rato; o que los invitados no puedan pedir besos.

### 8. "Ignorar" no impide que el ignorado escuche tu voz
- **Gravedad:** media · **Tipo:** hueco de diseño · **REPRODUCIDO en la lógica** (`sfu-logica.mjs`, paso 4)
- **Qué pasa:** ignorar vive en `Accounts` (tabla `ignores`) y la sala no lo consulta: `pull del ignorado → mid "2"`.
  El que ignora deja de oír al otro (lo filtra su cliente), pero el ignorado sigue oyéndolo, y con el hallazgo 2 desde toda la sala.
- **Dónde:** `server/room.js:694` (`pullBlocked` no mira `ignores`).
- **Arreglo sugerido (a decidir):** si `tm` ignoró a `viewer`, devolver `denied` (la sala puede cargar al entrar los
  ignores de cada uno, como pasa con el resto de la cuenta).

### 9. Restringir/ignorar a un amigo no le saca nada: sigue viendo tu sala en vivo, entra a tu sala "solo amigos" y ve y le da me gusta a tus fotos
- **Gravedad:** media · **Tipo:** hueco de diseño · **REPRODUCIDO** (`social.mjs` paso 7, `extra.mjs`)
- **Salida:** `amigo-restringido-sigue-viendo-sala {"room":"azotea"}`; `amigo-restringido-entra-sala-amigos welcome`;
  `el dueño lo restringió pero la foto "amigos" le aparece y le pudo dar me gusta (1)`. Los DMs sí se frenan bien.
- **Qué pasa:** la decisión actual de restringir es unidireccional (no veo lo suyo), así que el código cumple, pero
  la víctima cree que lo cortó. La única salida es sacarlo de amigos, y entonces vuelve con el hallazgo 1 o 3.
- **Dónde:** `server/accounts.js:611` (`friends`), `:669` (`canEnter`), `feed`/`like`.
- **Sugerencia (a decidir):** que restringir también oculte tu ubicación y te cierre la sala a esa persona, o que
  restringir a un amigo lo saque de amigos.

### 10. Cerrar la sala o sacar a alguien de amigos no echa a quien ya está adentro
- **Gravedad:** media · **Tipo:** bug · **REPRODUCIDO** (`privada.mjs`)
- **Pasos:** el amigo entra a la sala "amigos"; el dueño lo saca de amigos, lo restringe y pasa la sala a "cerrada".
  Salida: `sigue-adentro-tras-cerrar-sala conexión abierta=true` (chatea normalmente).
- **Dónde:** `canEnter` solo se mira en el `join` (`server/room.js:283`); `setMyRoom` (`server/accounts.js`) no le avisa a la sala.
- **Arreglo sugerido:** al cambiar la privacidad o quitar un amigo, avisar a la sala `u-<id>` para que vuelva a
  correr `canEnter` sobre los conectados y mande a la entrada o desconecte (con aviso) a quien ya no puede estar.
  *A decidir:* ¿se los echa o se los deja hasta que salgan?

### 11. Suplantación de nombres: un invitado puede llamarse "xvvаve" (con "а" cirílica) o "xvvave" + espacio invisible
- **Gravedad:** media · **Tipo:** bug · **REPRODUCIDO** (`sala.mjs`, último bloque)
- **Salida:** `homoglifo=true invisible=true`. Las mayúsculas del nick sí se frenan (`nameTaken`).
- **Qué pasa:** `cleanName` solo saca controles ASCII y `<>`; los invitados aceptan cualquier Unicode. Se puede
  hacer pasar por el admin o por la víctima frente a sus amigos.
- **Dónde:** `server/shared.js:112-115` (`cleanName`) y `server/accounts.js:258`.
- **Arreglo sugerido:** sacar los caracteres invisibles o de formato (`\p{Cf}`, U+200B–U+200F, U+2060, U+202A–U+202E,
  U+FEFF) y comparar con `nameTaken` usando un "esqueleto" sin homoglifos (NFKC + tabla de confusables), o limitar
  los nombres de invitado a letras latinas.

### 12. El chat deja pasar caracteres invisibles, inversión de texto (bidi) y "zalgo"
- **Gravedad:** media · **Tipo:** bug · **REPRODUCIDO** (`sala.mjs`, `sala2.mjs`)
- **Salida:** `5/5 "mismo texto" (con caracteres invisibles) pasaron el filtro de repetidos`;
  `"‮oicats ut" (10)` (U+202E da vuelta la línea, y también cómo se ve el nombre siguiente en el chat del cliente);
  un mensaje de 281 caracteres combinantes llega tal cual (en pantalla se "derrama" sobre las líneas de arriba y abajo).
- **Dónde:** `server/room.js:388` (solo saca `\u0000-\u001f`) y `:395` (repetidos por igualdad exacta).
- **Arreglo sugerido:** sacar `\p{Cf}`, limitar a 2–3 marcas combinantes seguidas y comparar repetidos sobre el
  texto normalizado (NFKC, sin invisibles ni espacios). Lo mismo en `server/messages.js` (`clean`) y en las notas.

### 13. Pedidos de beso e invitaciones a grupo sin respuesta se pueden repetir cada minuto para siempre
- **Gravedad:** media · **Tipo:** hueco de diseño (lo dice la decisión: "vence al minuto y no cuenta como rechazo") · por código + parcialmente reproducido
- **Qué pasa:** si la víctima no toca nada (AFK, o no quiere interactuar), le aparece una ventana por minuto y por
  acosador. Para cortarlo tiene que rechazar tres veces o ignorar. Con varias cuentas se multiplica.
- **Dónde:** `server/room.js` `kissMessage` / `groupMessage` (limpieza de `kisses`/`ginvites` a los 60 s).
- **Sugerencia (a decidir):** que vencer sin respuesta cuente como "medio rechazo" a partir del 2º o 3º, o un
  "no recibir pedidos de beso / grupos" en Cuidarse.

---

## Bajas

### 14. Todos ven quién está en un grupo privado con quién
- **Gravedad:** baja · **Tipo:** bug de privacidad · **REPRODUCIDO** (`grupos.mjs`)
- **Salida:** al mirón le llega `{"t":"groups","groups":{"3fa7…":{"leader":"bad5…","members":["bad5…","396b…"]}}}`
  con los `userId` de la víctima y su amiga. La decisión dice que todos ven "En grupo", no con quién.
  El aviso "X ya está en un grupo." también le llega a un inviter ignorado.
- **Dónde:** `server/room.js:832` (`saveGroups` → `broadcast`), `welcome` (`groups: this.groups`) y `:943`.
- **Arreglo sugerido:** mandar a todos solo `{ userId: true }` (quién está en grupo) y los detalles solo a los miembros.

### 15. Solicitudes de amistad en masa sin tope
- **Gravedad:** baja · **Tipo:** bug · **REPRODUCIDO** (`social.mjs`, paso 6: `6/6 en 75 ms`)
- **Dónde:** `server/accounts.js:620`. Además suma progresión ("agregar un amigo") con solo mandarla.
- **Arreglo sugerido:** tope por hora (como `NOTES_PER_HOUR`) y dar los puntos recién al aceptarse.

### 16. El buscador dice si alguien está conectado a cualquiera, aunque lo hayas restringido o sea un invitado
- **Gravedad:** baja · **Tipo:** hueco de diseño · **REPRODUCIDO** (`social.mjs`: `"online":true` sin ser amigos)
- **Dónde:** `server/accounts.js:932`. Sirve para saber cuándo entra la víctima y salir a buscarla por las salas públicas.
- **Sugerencia (a decidir):** `online` solo para amigos, o nunca para quien te restringió.

### 17. Spam de gestos: 5 por segundo a toda la sala (también silenciado)
- **Gravedad:** baja · **Tipo:** hueco · **REPRODUCIDO** (`extra.mjs`: 10 `emote` en 0,8 s)
- **Dónde:** `server/room.js:359` (solo el balde `heavy` 30 + 5/s). **Arreglo sugerido:** tope propio de gestos (por ejemplo 1 por segundo).

### 18. La sala cerrada sigue mostrando nombre, descripción y dueño a cualquiera sin sesión
- **Gravedad:** baja · **Tipo:** hueco de diseño · **REPRODUCIDO** (`privada.mjs`: `roominfo` de una sala "cerrada" sin token)
- **Dónde:** `server/accounts.js` `roomInfo`. Poco riesgo; se anota por si "cerrada" debería ser invisible.

---

## Hipótesis peligrosas no confirmadas

- **Escuchar de lejos con el SFU real (hallazgo 2):** la lógica está comprobada con el código real de la sala, pero
  no pude probar de punta a punta que Cloudflare siga entregando el audio (no quise usar la clave real). Lo esperable
  es que sí: nadie cierra la pista.
- **Flood con varios invitados en producción:** 20 invitados por IP por hora; con IPv6 (un /64 da millones de IPs) o
  rotando datos móviles, el freno se esquiva y se suma al hallazgo 4. No se puede probar en local (la IP llega vacía).
- **El dueño de una sala acosando visitas:** `mod bring` teletransporta a cualquier visita al lado del dueño cuantas
  veces quiera, y `spawn` lo manda a la entrada. La visita puede irse, pero un cliente sin protección queda a merced
  de esos tirones. No lo probé.
- **Notas difamatorias en "Destacados" y en el atril de la Cafetería:** cualquiera publica 20 notas por hora (×N
  cuentas) que ven todos. Solo quien restringe deja de verlas; no hay reporte. Por decisión el contenido no se
  modera, pero el acoso dirigido ("@victima …") queda expuesto a toda la comunidad.
- **Historial del chat:** los últimos 50 mensajes, incluidos los de un acosador ya ignorado o baneado, se mandan a
  cada uno que entra; depende de que el cliente los filtre por `userId` (no lo revisé en `src/`).

## Cosas que probé y están bien

- **Beso:** después de un rechazo no se puede volver a pedir (bloqueo de 1 min); un ignorado o restringido no puede
  pedirlo (le dice "enviado" y no llega); hace falta estar cerca.
- **Grupos:** bloqueo tras el rechazo; un ignorado no puede invitar; los invitados no arman grupos; al armar un grupo
  `enforce` corta a quien escuchaba (`sfu-cut`); no se puede pedir la voz de alguien que está en un grupo ajeno (`denied`).
- **Voz:** pedir `dj`/`stage` de quien no es DJ/VJ, o tipos raros (`constructor`) → `denied`; desde 200 m un pull nuevo → `denied`.
- **Intercambio:** un ignorado no puede invitar; los invitados no intercambian.
- **Mensajes privados:** solo entre amigos; si te restringió o ignoró, no le llega (y vos no te enterás).
- **Amistad:** si la víctima *rechaza*, no se puede reenviar por 24 h (siempre que no cancelen antes: ver 3).
- **Salas personales:** quien tiene la solicitud pendiente no entra a la sala "amigos" (`private`); la cuenta baneada
  queda afuera (4003).
- **Fotos:** con galería "nadie", la lista sale oculta, no aparece en el muro y `/api/photo?id=` da 404 con y sin sesión.
- **Nombres:** un invitado no puede usar el nick de una cuenta registrada (ni en mayúsculas).
