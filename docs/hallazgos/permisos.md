# Hallazgos — "el que quiere hacer lo que no puede" (permisos)

Tester adversarial contra el servidor local `http://127.0.0.1:8788` (26/10). Clientes robot sobre
`test/helpers.mjs`; scripts en
`C:\Users\xvvave\AppData\Local\Temp\claude\E--Proyectos-VRChat-Web\2f29601f-5f33-48e3-a6f0-45d92e7d9cc3\scratchpad\bots\permisos\`
(`lib.mjs` + `01-rest.mjs` … `07-teleport-diarias.mjs`, `04b`/`04c` de diagnóstico). No se tocó ningún archivo del repo.
Todo lo REPRODUCIDO se volvió a correr el 26/10 contra el servidor reiniciado (datos limpios) con el mismo resultado.
En `02-sala.mjs` dos líneas salen "HUECO" por la forma de esperar del script y NO son huecos: "luces ocupadas"
(rehecha bien en `03-luces-cafe.mjs` → `busy`) y "diseño falso sin tenerlo" (el servidor lo descarta en silencio, no se agrega).

> **Nota del entorno:** en local no hay `CF-Connecting-IP`, así que todas las cuentas comparten el freno de
> "IP vacía" (20 cuentas/invitados por hora) y ya estaba agotado por otros testers. Para poder probar,
> `lib.mjs` manda un `CF-Connecting-IP` inventado en cada alta: wrangler dev lo deja pasar. Online Cloudflare
> pisa ese encabezado, así que **no es un hallazgo de producción**, pero ojo: con `npm run dev` el freno por IP
> se puede saltear y a la vez lo comparten todos.

Resumen por gravedad (hallazgos, sin contar "probé y está bien"):

| Gravedad | Cantidad | Cuáles |
|---|---|---|
| Crítica | 0 | — |
| Alta | 2 | H1 (OAuth: el link con state de un invitado ajeno), H2 (OAuth + `register` deja `email_verified` viejo) — ambas hipótesis con evidencia de código (no se puede completar Google en local) |
| Media | 6 | H3 (teletransporte reconectando), H4 (farmeo de eventos/puntos/objetos), H5 (voz: no se corta al alejarse — hipótesis), H6 (curador vota cualquier obra por id — hipótesis), H7 (invitado con el nick de una cuenta usando caracteres invisibles), H19 (al hibernar la sala se pierde quién tiene la cabina/consola) |
| Baja | 11 | H8 … H18 |

---

## Hallazgos

### H1 — OAuth: quien entra con Google desde un link armado por otro queda dentro del invitado del atacante (toma de cuenta)
- **Gravedad:** alta · **Tipo:** bug de seguridad (login CSRF / fijación de sesión)
- **Estado:** HIPÓTESIS con evidencia de código. Reproducido solo el paso 1 (`oauthstart` desde fuera del navegador
  devuelve el link); el paso de Google no se puede completar en local.
- **Pasos:**
  1. El atacante crea un invitado y pide el link con su token (fuera del navegador el `Origin` se pone a mano):
     ```js
     const g = await guest('x');
     const r = await api('oauthstart', { method: 'POST', token: g.token,
       body: { provider: 'google', origin: 'https://<el sitio real>' }, headers: { Origin: 'https://<el sitio real>' } });
     // r.url = https://accounts.google.com/o/oauth2/v2/auth?client_id=<el del juego>&...&state=<ligado al invitado g>
     ```
  2. Le pasa `r.url` a alguien que todavía no tiene cuenta ("entrá con Google acá"). Es un link legítimo de Google con el client_id del juego.
  3. La víctima entra con Google → `oauthCallback`: no hay vínculo ni cuenta con ese mail → `id = st.guest_id` (el invitado del atacante).
     El Google de la víctima queda vinculado a esa cuenta, la víctima elige su nick, etc.
  4. El atacante sigue teniendo la sesión del invitado `g` (nunca se cierra) → entra a la cuenta de la víctima cuando quiera.
- **Qué pasa:** el `state` recuerda "convertir a este invitado" pero no está atado al navegador que empezó el ingreso.
- **Debería:** el invitado que se convierte tiene que ser el del mismo navegador que vuelve de Google.
- **Dónde:** `server/accounts.js:330-333` (guarda `guest_id` en el state) y `:382` (`if (!id && st.guest_id && ...) id = st.guest_id`).
- **Arreglo sugerido:** atar el state al navegador (cookie `HttpOnly` con un secreto que se compara en el callback), o no convertir
  invitados en el callback y hacerlo en `oauthFinish` con el token del invitado que manda el propio juego; y al convertir, cerrar
  las demás sesiones del invitado.

### H2 — OAuth + `register`: una cuenta de Google sin nick puede "cambiarse" el mail a uno ajeno y conservar `email_verified = 1`
- **Gravedad:** alta · **Tipo:** bug (se saltea la protección "manda Google" del 24/10)
- **Estado:** HIPÓTESIS con evidencia de código (hace falta un ingreso real con Google/Discord).
- **Pasos:**
  1. El atacante entra con SU Google (mail confirmado) → cuenta nueva sin `username`, `email_verified = 1`; `oauthFinish` le da el token (`needsNick: true`).
  2. En vez de `oauthnick`, llama a `register` con ese token y el mail de la víctima:
     ```js
     await api('register', { method: 'POST', token: tokenOAuth,
       body: { email: 'victima@gmail.com', nick: 'cualquiera', password: 'secreto123', terms: true } });
     ```
     `register` ve la cuenta como "invitado" (`isGuest` = sin username) y la convierte: pone mail y contraseña nuevos y **no toca `email_verified`**.
  3. Cuando la víctima entra con Google (`victima@gmail.com`): se encuentra la cuenta por mail y, como `email_verified = 1`,
     NO se anula la contraseña ni se cierran las sesiones (`accounts.js:377`). El Google de la víctima queda vinculado a la cuenta del atacante.
- **Qué pasa:** la víctima no puede tener su propia cuenta con su mail (ya está tomado) y, si entra con Google, entra a una cuenta que el atacante sigue manejando con su contraseña.
- **Debería:** un mail puesto a mano nunca puede quedar marcado como confirmado.
- **Dónde:** `server/accounts.js:287-289` (conversión en `register`, sin `email_verified = 0`), `:187` (`isGuest` = "sin username" incluye cuentas OAuth sin nick), `:377`.
- **Arreglo sugerido:** en `register`, si la cuenta tiene `oauth_links` → rechazar (que use `oauthnick`); y siempre que se cambie `email`, poner `email_verified = 0`.

### H3 — Teletransporte reconectando: la posición del `join` no pasa por el control de velocidad
- **Gravedad:** media · **Tipo:** bug (hueco del control de velocidad recién agregado)
- **Estado:** REPRODUCIDO (`07-teleport-diarias.mjs`).
- **Pasos:**
  ```js
  A.send({ t: 'drop', iid, x: 0, y: 0, z: 22 });              // A suelta algo en la Plaza
  let B = await joined(b.token, 'plaza', [-20, 0, -20, 0, 0, 0]);
  B.send({ t: 's', s: [0, 0, 22, 0, 0, 0] });                  // → pos-fix (bien, salto rechazado)
  await B.close(); await sleep(5200);
  B = new Client(b.token, 'plaza'); await B.join([0.5, 0, 22, 0, 0, 0]);  // reconecta al lado
  B.send({ t: 'pickup', iid });                                 // → "picked"
  ```
- **Qué pasa:** el `s` del `join` se acepta tal cual (`room.js:292-293`), con cualquier valor dentro de ±500 m. Reconectar (o abrir otra
  pestaña: la nueva manda) = aparecer donde quieras. Sirve para juntar objetos, ponerse a menos de 20 m de alguien para escuchar su voz,
  pararse en la barra, besar, etc.
- **Debería:** al entrar, el servidor pone a cada uno en la entrada (o valida contra la última posición conocida).
- **Dónde:** `server/room.js:292-293`.
- **Arreglo sugerido:** ignorar `msg.s` en el `join` y arrancar en el spawn de la sala (`SPAWN` / `PUBLIC_MAPS[..].spawn` / `ROOM_SPAWN`);
  si se quiere conservar la posición al recargar, guardar la última posición del usuario en la sala y aceptar el `join` solo cerca de esa.

### H4 — Farmeo de eventos: puntos, niveles y objetos sin pasar música, con 5 invitados de relleno
- **Gravedad:** media · **Tipo:** hueco de diseño + bug chico
- **Estado:** REPRODUCIDO (`04-eventos.mjs`, 26/10 en el servidor limpio). Resultado real:
  ```
  19:49 antes:               nivel 1,   0 puntos, fiestero=0
  19:54 después del set 1:   nivel 2,  50 puntos, fiestero=1  avisos: "¡Subiste a nivel 2! Ganaste: Mochila", "Misión diaria ... ✓ Gorro de lana"
  20:00 después del set 2:   nivel 2, 100 puntos, fiestero=2
  ```
  (Los bots mandan `ping` cada 3 s; con pings cada 20 s la sala hiberna y pierde el DJ, ver H19.)
- **Pasos:**
  ```js
  // Sala propia con plantilla club (trae cabina). 1 cuenta + 5 invitados (los invitados cuentan como "personas")
  o.send({ t: 'dj', on: true, streamId: 'falso-1' });  // no se publica ningún audio
  // 5 min después: evento (+50 puntos a cada cuenta presente). Se repite con otro streamId
  o.send({ t: 'dj', on: true, streamId: 'falso-2' });  // el DJ re-manda "on" sin soltar → evento nuevo
  ```
- **Qué pasa:**
  - Para "tomar la cabina" no hace falta publicar música: el evento se cuenta por `dj.streamId`, un texto que manda el cliente.
  - El DJ puede re-mandar `dj on` con otro `streamId` sin soltar (`room.js:427-432` lo acepta porque `this.dj.id === meta.id`) → la clave del
    evento cambia (`progress.js:368`) y arranca un evento nuevo.
  - Los invitados cuentan para las "más de 5 personas" (`progress.js:374-376`), y se crean hasta 20 por hora por IP.
  - Resultado: 50 puntos cada 5 min por cada cuenta propia presente → nivel 8 (1.400 puntos) en ~2 h 20 min, con un objeto por nivel
    (raro cada 5, exótico cada 10). Junto con 30 obras vistas, es uno de los dos requisitos de Curador.
- **Debería (a confirmar con el dueño):** que un "evento" sea un set real (con pista `dj`/`stage` publicada en el SFU, y quizás con mínimo
  de duración) y que cuenten cuentas registradas distintas.
- **Dónde:** `server/room.js:417-432`, `server/progress.js:364-387`.
- **Arreglo sugerido:** (técnico) no aceptar `dj on` si ya sos el DJ (o no cambiar el `streamId`), y contar el evento solo si `meta.pubs.dj`
  existe; (diseño, consultar) contar solo cuentas registradas y un tope de eventos por día.

### H5 — Voz: una suscripción no se corta cuando el que escucha se aleja (escuchar de lejos)
- **Gravedad:** media · **Tipo:** bug
- **Estado:** HIPÓTESIS (no probé el SFU: llamaría a la API real de Cloudflare). Evidencia de código.
- **Qué pasa:** `pullBlocked` mide la distancia solo cuando se pide la pista (`room.js:705-707`). `enforce()` (lo único que corta pistas,
  `room.js:795-811`) se llama solo al silenciar, al cambiar grupos y al apagar la voz (`room.js:598, 630, 833`), nunca al moverse. Un cliente
  modificado se acerca (o se teletransporta, H3), hace `pull` de la voz de alguien y después se aleja sin `unpull`: lo sigue escuchando
  desde cualquier punto de la sala.
- **Debería:** como dice CLAUDE.md, "corta las que ya no valen".
- **Dónde:** `server/room.js:694-708, 795-811`.
- **Arreglo sugerido:** llamar a `enforce()` en la alarma (cada 30 s ya corre) o cada N mensajes `s`, con el mismo margen de 20 m.
- **Cómo comprobarlo:** con `REALTIME_APP_TOKEN`, dos bots: B hace `sfu push` voz, A se para a 5 m, hace `pull`, camina 40 m; esperar `sfu-cut` (no llega).

### H6 — Curadores: `reviewvote` acepta cualquier obra por id (no solo la que "les tocó al azar")
- **Gravedad:** media · **Tipo:** hueco de diseño/bug
- **Estado:** HIPÓTESIS (en local no hay admin ni curador para probar). Evidencia de código.
- **Qué pasa:** la decisión es "revisan obras que les tocan al azar (no eligen ni ven la lista) y nunca de sus amigos". `reviewNext` reparte
  al azar, pero `reviewVote` acepta cualquier `id` pendiente (`works.js:197-206`): solo frena la propia y la de amigos *en ese momento*.
  El autor ve el id de su obra en `myworks`, así que con una cuenta alternativa (o sacando la amistad un minuto) un curador verifica la obra que quiera.
- **Debería:** solo se puede votar la obra que el servidor le asignó.
- **Dónde:** `server/works.js:177-206`.
- **Arreglo sugerido:** guardar la asignación (`review_assign(user_id, work_id, at)`) en `reviewNext` y exigirla en `reviewVote`.
  (La colusión con cuentas alternativas es de diseño: consultar.)

### H7 — Un invitado se pone el nick de una cuenta registrada con un carácter invisible
- **Gravedad:** media · **Tipo:** bug (suplantación)
- **Estado:** REPRODUCIDO (`01-rest.mjs`).
- **Pasos:**
  ```js
  await api('me', { method: 'PUT', token: g.token, body: { name: `${nickDeOtro}\u200b` } }); // ok: true
  await api('me', { method: 'PUT', token: g.token, body: { name: '\u202Eevavvx' } });         // ok: se ve "xvvave"
  await api('me', { method: 'PUT', token: g.token, body: { name: '\u200b\u200b' } });         // ok: nombre invisible
  ```
- **Qué pasa:** `cleanName` solo saca `\u0000-\u001f` y `<>`; `nameTaken` compara el texto exacto en minúsculas. Con U+200B (espacio de ancho
  cero) o U+202E (escritura de derecha a izquierda) un invitado se ve igual que `xvvave` (el admin) o que cualquier cuenta. También se puede
  llamar "nada" (solo invisibles).
- **Debería:** el nombre de un invitado no puede verse igual que el nick de una cuenta.
- **Dónde:** `server/shared.js:112-115` (`cleanName`), `server/accounts.js:192-194` (`nameTaken`).
- **Arreglo sugerido:** en `cleanName` sacar los caracteres de formato (`\p{Cf}`: U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+FEFF) y
  normalizar NFKC; en `nameTaken` comparar contra el nombre normalizado (y, a definir con el dueño, también confusables como la "а" cirílica).

### H8 — El dueño pone en su sala muebles "hidden" de los mapas públicos, y la barra del café reparte café gratis
- **Gravedad:** baja · **Tipo:** bug
- **Estado:** REPRODUCIDO (`02-sala.mjs`, `03-luces-cafe.mjs`).
- **Pasos:**
  ```js
  o.send({ t: 'edit', op: 'add', piece: { id: 'h1', type: 'barraCafe', x: 0, z: 2 } }); // → piece barraCafe
  o.send({ t: 'edit', op: 'add', piece: { id: 'h2', type: 'probador', x: 1, z: 1 } });  // → piece probador
  v.send({ t: 'consume', from: 'piece', piece: idDeLaBarra });                          // visitante → consume kind=cafe
  ```
- **Qué pasa:** `editMessage` solo mira `has(FURNITURE, type)`; los `hidden` no salen en el catálogo pero el servidor los acepta. La `barraCafe`
  no es especial (no sale del inventario) y tiene `gives: 'cafe'`: es un dispensador gratis, cuando los de las salas (barra de tragos, minibar,
  cafetera) son especiales que hay que tener.
- **Dónde:** `server/editor.js:66` (+ `server/shared.js:297-301`).
- **Arreglo sugerido:** en `add`, rechazar `FURNITURE[type].hidden` (los mapas públicos no pasan por `add`).

### H9 — Corazones en una sala sin atril
- **Gravedad:** baja · **Tipo:** hueco (decisión: "Sin atril, los visitantes no ven las notas ni dan corazones")
- **Estado:** REPRODUCIDO (`02-sala.mjs`): el dueño saca el atril, un visitante entra y `POST heart` → `{ ok: true, count: 1 }`.
- **Dónde:** `server/accounts.js:843-855` (solo mira la presencia).
- **Arreglo sugerido:** que la sala avise a Accounts si tiene atril (o que el corazón se pida por WebSocket y lo valide la sala, como el consumo).

### H10 — La cabina y la consola se toman desde cualquier lugar de la sala
- **Gravedad:** baja · **Tipo:** hueco (decisión: "Se arranca con E en la cabina")
- **Estado:** REPRODUCIDO (`02-sala.mjs`): en la Azotea, parado en el spawn (z 6,8) se toma la cabina (z −6,8, a 13,6 m).
- **Dónde:** `server/room.js:417-461` (no hay chequeo de distancia, a diferencia de la barra o los muebles que dan consumibles).
- **Arreglo sugerido:** exigir `near(meta, cabina.x, cabina.z, 3.5)` (y para la consola / pantalla) con la pieza del layout; en el Museo, las coordenadas fijas.

### H11 — Al cerrar la sala o sacar a alguien de amigos, el que ya estaba adentro se queda
- **Gravedad:** baja · **Tipo:** hueco de diseño (consultar)
- **Estado:** REPRODUCIDO (`02-sala.mjs`): visitante adentro, el dueño pone `privacy: 'cerrada'`, 1,5 s después el visitante sigue chateando en la sala.
- **Dónde:** `canEnter` solo se mira en el `join` (`server/room.js:281-287`).
- **Arreglo sugerido (si el dueño lo quiere):** al cambiar la privacidad (o al sacar una amistad), avisar a la sala para que saque a quien ya no puede estar (o mandarlo a la entrada / al Museo).

### H12 — Baneo por cuenta: el baneado vuelve al toque como invitado
- **Gravedad:** baja · **Tipo:** hueco de diseño (consultar)
- **Estado:** REPRODUCIDO (`02-sala.mjs`): banear en una sala personal abierta y volver con un invitado nuevo → `welcome`.
- **Dónde:** `server/room.js:276-280` (los baneos son por `userId`).
- **Arreglo sugerido (a decidir):** opción por sala de "no se admiten invitados", o banear también por hash de IP durante un tiempo.

### H13 — Los invitados tienen amigos, y con eso entran a salas "solo amigos"
- **Gravedad:** baja · **Tipo:** hueco de diseño (consultar)
- **Estado:** REPRODUCIDO (`01-rest.mjs`, `02-sala.mjs`): un invitado manda `friendrequest`, la cuenta acepta y el invitado entra a la sala `amigos`.
  Además el invitado ve galerías "amigos" de esa cuenta.
- **Qué pasa:** `friendRequest`/`friendRespond` no frenan invitados (la lista de vedadas no dice "amigos", pero sí "sin galería" y los
  invitados sin DM, así que la amistad queda a medias).
- **Dónde:** `server/accounts.js:620-649`.
- **Arreglo sugerido:** decidir con el dueño; si los invitados no tienen amigos, `guestError()` en `friendRequest` y `friendRespond(accept)`.

### H14 — Spam de avisos de amistad: pedir y cancelar en bucle
- **Gravedad:** baja · **Tipo:** bug (acoso)
- **Estado:** REPRODUCIDO (`01-rest.mjs`): 5 vueltas de `friendrequest` + `friendremove` en un segundo → 5 avisos `friend_request` del mismo.
  Funciona también desde invitados (que se crean de a 20 por hora).
- **Qué pasa:** el freno de 24 h (`friend_rejects`) solo existe si el otro rechaza; cancelar la propia solicitud no deja rastro.
- **Dónde:** `server/accounts.js:620-634` y `:651-656`.
- **Arreglo sugerido:** no repetir el aviso si ya hubo uno del mismo en las últimas 24 h (o anotar en `friend_rejects` también al cancelar una pendiente propia).

### H15 — Misión diaria "Mirá 3 obras" con claves inventadas
- **Gravedad:** baja · **Tipo:** bug (farmeo de objetos)
- **Estado:** REPRODUCIDO (`07-teleport-diarias.mjs`): estando en el Museo, 3 × `POST progressview { fixed: 'inventadaN' }` → misión completa (premio básico).
- **Dónde:** `server/progress.js:305-307` (cualquier texto de hasta 60 caracteres vale como "obra de base").
- **Arreglo sugerido:** aceptar solo las claves de las obras de base reales (lista fija compartida en `shared.js`).

### H16 — La altura no gasta saldo de movimiento
- **Gravedad:** baja · **Tipo:** bug
- **Estado:** REPRODUCIDO (`07-teleport-diarias.mjs`): `s` con `y = 400` de golpe se acepta (sin `pos-fix`).
- **Dónde:** `server/room.js:335` (solo `x` y `z`). La voz mide en 3D (`room.js:707`) y los objetos ±3 m de altura (`room.js:518`).
- **Arreglo sugerido:** sumar el cambio de altura al saldo (con un tope propio para caídas/saltos).

### H17 — Rutas sin freno de invitado que la lista de "vedadas" no menciona: reportar, muro (leer), favoritas
- **Gravedad:** baja · **Tipo:** hueco de diseño (consultar)
- **Estado:** REPRODUCIDO (`01-rest.mjs`): invitado → `POST report` ok, `GET feed` ok (11 publicaciones), `POST favorite` ok.
- **Qué pasa:** "sin muro" seguramente es "no publica", y leer las notas igual es público (`notes`); reportar no tiene botón todavía. Lo anoto
  porque los reportes de invitados son gratis de crear (10 por día por invitado × 20 invitados por hora).
- **Dónde:** `server/accounts.js:777` (`feed`), `:904` (`setFavorite`), `:1051` (`report`).

### H18 — `PUT me` sin `look` borra el personaje; `oauthstart` acepta cualquier origen https
- **Gravedad:** baja · **Tipo:** bugs chicos
- **Estado:** REPRODUCIDO (`01-rest.mjs`).
  - `PUT me { bio: 'x' }` deja `look = {}` (`accounts.js:439` y `:449` usan `cleanLook(look)` aunque no venga). El juego siempre manda `look`
    (`src/app/cuenta.js:258`), así que solo pasa por API. Arreglo: `look === undefined ? row.look : JSON.stringify(cleanLook(look))`.
  - `oauthstart` con `Origin: https://evil.example` (fuera del navegador el encabezado se pone a mano) devuelve un link con
    `redirect_uri=https://evil.example/api/oauth/google/callback`. Google/Discord rechazan redirect_uri no registrados, así que no se explota,
    pero el chequeo de `worker.js:162` no protege nada fuera del navegador. Arreglo: lista fija de orígenes permitidos (variable `ALLOWED_ORIGINS`).

### H19 — Si la sala hiberna, se pierde quién tiene la cabina y la consola (y otro las "toma" con el DJ todavía adentro)
- **Gravedad:** media · **Tipo:** bug (el permiso "una persona a la vez" se rompe solo)
- **Estado:** REPRODUCIDO (`04c-hiber.mjs`).
- **Pasos:**
  ```js
  const o = await joined(a.token, 'azotea', [0, 0, 6.8, 0, 0, 0]);
  o.send({ t: 'dj', on: true, streamId: 'x' });  // → dj on
  await sleep(30_000);                            // el DJ no manda nada por 30 s (sigue conectado)
  const c = await joined(b.token, 'azotea', ...); // c.welcome.dj === null
  ```
- **Qué pasa:** `this.dj`, `this.parts`, `this.lights`, `this.screen` (y también `moveBudget`, `trades`, `ginvites`, `kisses`, `boosts`, `pulls`)
  viven solo en memoria (`room.js:75-92`). Con la hibernación de WebSockets, la sala se descarga si un rato nadie manda nada, y al despertar
  la cabina figura libre: cualquiera la toma aunque el DJ siga en la cabina pasando música (el DJ quieto no manda `s`). Pasa lo mismo con
  las luces / la pantalla. También se pierden los intercambios e invitaciones en curso y el saldo de movimiento (vuelve a 10 m).
- **Debería:** la cabina sigue siendo del DJ mientras esté conectado.
- **Dónde:** `server/room.js:72-93` (estado en memoria) y `:427` (`this.dj && ... this.byId(this.dj.id)`).
- **Arreglo sugerido:** guardar `dj`, `parts` y `lights` en el attachment del WebSocket de quien las tiene (o en `ctx.storage`) y
  reconstruirlas al despertar (como ya se hace con `groups`, `bans`, etc. en `load()`).

---

## Hipótesis peligrosas no confirmadas

- **H1, H2, H5, H6** (arriba): con evidencia de código, sin poder cerrarlas en local (Google real, SFU real, curador/admin).
- **`register` sobre una cuenta OAuth sin nick también saltea `oauthnick`**: además del mail (H2), deja ponerle contraseña a una cuenta de
  Google. No es grave en sí, pero es el camino de H2.
- **Puntos de "visitar salas" con cuentas propias:** cada cuenta nueva trae una sala `u-<id>`; 20 cuentas por hora por IP → 100 puntos/hora
  y la diaria "visitá 2 salas". Más lento que H4. No lo corrí.
- **Colusión de curadores con cuentas alternativas** (diseño): la regla "nunca de sus amigos" no alcanza contra una cuenta propia no amiga. Consultar.

## Cosas que probé y están bien

- **Invitados:** `like`, `heart`, `note`, `PUT myroom`, `equip`, `designcopy`, `dm`, `POST photo`, `POST design`, `POST work` → `guestError()`.
  En la sala: `mic on` → `mic-denied`; `dj on` y `part luces` → `denied`; `sfu push` de voz → `denied`; grupo (invitar, ser invitado,
  aceptar una invitación ajena) → frenado; intercambio → frenado; soltar/juntar → frenado por la cuenta.
- **Rutas de admin con cuenta común:** `reports`, `reportresolve`, `worksadmin`, `workremove`, `title` (incluso darse "creador" a uno mismo) → "Solo para admins".
  `review` / `reviewvote` sin ser curador → "Solo para curadores"; el autor no se autoverifica.
- **Editor:** un visitante no puede `add`/`update`/`remove`/`template` en sala ajena; nadie edita los mapas públicos (Plaza); el dueño no
  puede elegir plantillas `public` (rave); especiales y diseños sin tenerlos en el inventario → `edit-fail` / descartado.
- **Moderación:** sin ser mod, `kick/ban/silence/bring/spawn/setting/bans` → "No tenés permisos"; en los mapas públicos una cuenta común no es mod.
  El baneado no vuelve con su cuenta.
- **Cabina y consola:** ocupadas → `busy`; el otro no las suelta ni cambia el track ni manda `luces`; `escenario2` sin 2 pantallas → `denied`;
  `part` con nombres raros (`__proto__`) se ignora.
- **Salas:** cerrada → `private`; una conexión por cuenta: la vieja recibe `elsewhere`.
- **Museo rotativo:** el archivo de una obra pendiente lo ve solo el autor (otra cuenta, invitado y sin sesión → 404); `f=model` en un cuadro y
  `f=../hd` → 404; la obra pendiente no aparece en `museum` ni en `myworks` de otro.
- **Diseños:** `designfile` con un archivo de otro tipo (`hd`/`model` de una estampa) o id con `/../` → 404; `designcopy` con iid ajeno o por
  quien recibió la copia → frenado.
- **Objetos:** soltar uno ajeno → "no es tuyo"; juntar lo de otro antes de 5 s → "Todavía no"; soltar lejos → "muy lejos"; ofrecer en un
  intercambio objetos ajenos → se filtran (`ownedItems`).
- **Registro:** nick usado en mayúsculas o con espacios, mail usado con mayúsculas/espacios, nick con espacio adentro o con letra cirílica → rechazados;
  registrar con el token de una cuenta ya registrada crea otra y no pisa la existente.
- **Nombres:** un invitado no puede llamarse como una cuenta (ni en mayúsculas, ni con espacios, ni con punto final si ese nick existe); una cuenta
  no se pone el nick de otra ni uno inválido; `look` con basura se limpia (`{ "height": 1.95 }`).
- **OAuth:** `oauthfinish` con código inventado y `oauthnick` de un invitado sin vínculo → frenados; el callback con `state` inventado vuelve al propio sitio.
- **Red social:** galería "nadie" oculta; borrar nota ajena no hace nada; DM y leer conversación con no-amigo → frenado; corazón sin estar en la sala → frenado.
- **Grupos, beso, intercambio:** el miembro que no armó el grupo no invita ni echa; aceptar invitación o beso inexistente → "venció";
  ignorado no llega con grupo/intercambio/beso; beso desde lejos → "Acercate".
- **Teletransporte por `s`:** un salto de 40 m → `pos-fix`.
