# CLAUDE.md

Guía para trabajar en este proyecto con Claude Code. Leé también [docs/ESTADO.md](docs/ESTADO.md)
(qué se hizo y qué falta, para retomar) y [docs/ROADMAP.md](docs/ROADMAP.md) (plan y decisiones de diseño ya tomadas).

## Reglas de trabajo (pedidas por el dueño del proyecto)

1. **Cada comportamiento de diseño se consulta por separado.** No definas reglas, principios
   ni comportamientos de diseño por tu cuenta (mecánicas, cooldowns, límites, políticas de
   moderación, monetización, qué pasa con objetos, etc.). Si un pedido deja un comportamiento
   ambiguo, preguntá antes de implementarlo. Las decisiones puramente técnicas (librerías,
   estructura del código) sí pueden tomarse con criterio propio.
2. **Las decisiones ya tomadas están en docs/ROADMAP.md** → "Decisiones de diseño". Respetalas
   y anotá ahí cada decisión nueva que tome el usuario.
3. **Idioma:** la interfaz, los textos y los comentarios del código van en español rioplatense
   (vos, "apretá", "juntá").
4. **Descargas:** antes de bajar cualquier archivo (modelos, packs), decir nombre, origen y
   tamaño y esperar el OK. Descargas en una carpeta aparte, revisar la licencia.
5. Probar los cambios en el navegador (`npm run dev`) antes de darlos por terminados.

## Stack

- **Cliente:** Three.js + Vite, JavaScript sin framework. Post-procesado (GTAO + bloom con umbral
  alto, para que brillen solo los neones) solo en calidad "alta".
- **Servidor:** Cloudflare Worker + Durable Objects con SQLite (plan gratuito).
  - `Accounts` (una instancia global): usuarios, sesiones, inventario, amigos, presencia y toda la
    red social (fotos, notas, muro, me gusta, corazones, favoritas, avisos, restringidos).
  - `Room` (una por sala): tiempo real por WebSocket con hibernación.
  - **R2** (binding `ART`, bucket `galeria-obras`): archivos del Museo rotativo. La lógica está en
    `server/works.js` (se mezcla en `Accounts`); los archivos se sirven por `/api/workfile` (públicos solo
    si están o estuvieron expuestos). En desarrollo wrangler lo simula.
- **Voz, música del DJ y pantalla del escenario:** por Cloudflare Realtime SFU (`src/net/rtc.js`):
  nadie se conecta directo con nadie, así nadie ve la IP de otro. La sala (`server/room.js` →
  `sfuMessage`) es la intermediaria con la API (tiene la clave) y decide quién puede escuchar a quién.
  Clave: `REALTIME_APP_TOKEN` en `.dev.vars` (local, ignorado por git) y con
  `npx wrangler secret put REALTIME_APP_TOKEN` online. El App ID está en `wrangler.jsonc`.

## Comandos

```bash
npm run dev      # cliente (5173) + servidor (8787) juntos
npm run dev:alt  # segunda copia: servidor en el 8788 con sus propios datos
npm run puente   # puente OSC para artistas
npm run build    # compila el cliente en dist/
npm run deploy   # build + wrangler deploy
npm test         # pruebas automáticas (levanta su propio servidor en el 8790; ver docs/ramas/seguridad.md)
TEST_BASE=http://127.0.0.1:8787 npm test   # las mismas, contra un npm run dev ya abierto
node scripts/test.mjs test/sala.test.mjs  # un solo archivo de pruebas
```

Cada agujero de seguridad que se cierre lleva su prueba en `test/` (clientes WebSocket reales, sin navegador).

## Cosas a saber

- **Ramas:** se trabaja sobre `main` (todas las ramas anteriores ya se juntaron ahí).
- **Cuentas:** registro con mail + nickname único; se entra con cualquiera de los dos, o con **Google / Discord**
  (`oauthStart` → `/api/oauth/<proveedor>/callback` → `#login=<código>` → `oauthFinish`; si es nueva, `oauthNick`).
  Client ID en `wrangler.jsonc`; `GOOGLE_CLIENT_SECRET` y `DISCORD_CLIENT_SECRET` en `.dev.vars` / `wrangler secret`. Invitado =
  cuenta sin `username` (`isGuest` en `accounts.js`): chatean por texto y escuchan voces públicas; sin hablar, grupos, me gusta, corazones, objetos, intercambios, muro, galería
  ni sala propia (cada método lo frena con `guestError()`). En el cliente esas opciones se ven con candado
  y avisan (`src/ui/guest.js`: `guestGate`, `lock`). Registrarse conserva el id.
- **Cuidarse** (`src/ui/roompanel.js`): mutear (voz) se guarda en el navegador; ignorar (voz + texto,
  rutas `ignores`/`ignore`) y restringir (oculta sus publicaciones del muro, rutas `blocks`/`block`) viven en la cuenta. Reportar está
  postergado: las rutas `report`/`reports` existen en el servidor pero no hay botón.
- **Antiflood** del chat en `server/room.js` (`FLOOD_MAX`, `FLOOD_WINDOW`, `REPEAT_WINDOW`).
- **Voz:** el cliente se suscribe a los más cercanos (`updateVoices`, cada 0,5 s) y suenan los 4 más
  cercanos que hablan dentro de 10 m. La sala valida cada suscripción (`pullBlocked`: distancia con margen,
  grupos, silenciados) y corta las que ya no valen (`enforce` → mensaje `sfu-cut`). Pistas: `<idConexión>-voice|dj|stage`.
- **Grupos de voz** (`groupMessage` en la sala, guardados por cuenta en el storage de la sala): privados,
  hasta 4, maneja el que lo armó. Anti-acoso en `accounts.js` (`groupInviteCheck`, `groupRejected`,
  tabla `group_rejects`); ignorar ahora vive en la cuenta (tabla `ignores`, rutas `ignores`/`ignore`).
- **Salas personales y editor** (`src/world/rooms.js`, `templates.js`, `furniture.js`, `editor.js`; servidor
  `server/editor.js`): el diseño de cada sala vive en el storage de su Room (clave `layout`); catálogos
  `ROOM_TEMPLATES` y `FURNITURE` en `server/shared.js`. Muebles especiales puestos: `items.owner_id = 'room:<id>'`.
- **Progresión** (`server/progress.js` mezclado en `Accounts`, `src/ui/progress.js`): puntos una sola vez por
  cosa (`progress_log`), insignias, camino y diarias. Enganches con `progressTrack(...)` en works/accounts/room.
- **Carga de modelos:** usar `loadGLTF` de `src/loaders.js` (Draco, meshopt, KTX2), no `new GLTFLoader()`.
- **Museo y `merge.js`:** las mallas quietas se juntan al final de `buildMuseum`. Lo que se mueve o cambia
  después lleva `userData.dynamic = true` (ver `docs/ramas/rendimiento.md`).
- **No pisables:** `noStand` en los colliders (obras, cabinas, atril); el controlador no te deja parado encima.

- **Windows:** wrangler falla con SQLite si la ruta del proyecto es muy larga; por eso
  `scripts/dev-server.js` guarda el estado local en `%TEMP%/galeria-state`.
- **Dos copias a la vez** (ej. la del usuario en `E:\Proyectos` y una rama de prueba): `npm run dev:alt`
  usa el servidor de salas en el puerto 8788 con su propia carpeta de datos (`GAME_PORT`). Si dos
  `npm run dev` comunes corren juntos, el segundo NO toma el 8787 y su página habla con el primero.
- **Red social** (`src/ui/phone.js`, `notes.js`, `gallery.js`, `src/world/lectern.js`): el celular es el
  panel `#friends`; mensaje de sala `phone` (el personaje lo saca). Rutas: `photos`, `photo` (archivo),
  `notes`/`note`, `hearts`/`heart`, `roominfo`/`myroom`, `favorites`/`favorite`, `search`, `notifications`.
  Las fotos se guardan en SQLite del Durable Object de cuentas (no R2, para no necesitar tarjeta).
- **PowerShell 5.1** lee UTF-8 sin BOM como ANSI y rompe los acentos: para editar archivos con
  scripts usar `[IO.File]::ReadAllText/WriteAllText` con UTF-8, o las herramientas de edición.
- **Cliente (`src/main.js` → `src/app/`):** main.js solo importa las partes en orden y arranca. Cada módulo
  corre al importarse y comparte lo suyo en `G` (`src/app/state.js`, con `$`, `body`, `pref`, `loading`):
  `escena.js` (render, mundo, jugador local, botones) · `overlays.js` (un panel a la vez, `refreshState`) ·
  `cuenta.js` (ingreso, Google/Discord, editor de personaje) · `menu.js` (Esc, audio) · `red.js` (Net, voz,
  grupos, panel Tab) · `social.js` (suelo, Mapa, gestos, inventario, celular, progreso) · `museo.js` (atril del
  Museo, obras expuestas, notas, editor de sala) · `sala.js` (join y `net.on`) · `chat.js` (chat y comandos) ·
  `escenario.js` (DJ, consola, pantalla) · `interaccion.js` (E, fichas, perfiles, teclado) · `loop.js` (bucle,
  día/noche, `window.__game`). Un módulo solo puede usar al cargarse lo de los anteriores.
- **Pruebas:** en desarrollo existe `window.__game` (ctrl, world, remotes, rtc, social, net,
  ground, roomPanel, `setHour(h)` para probar día/noche…). Si el panel del navegador está oculto,
  el juego corre a muy pocos cuadros: para probar física llamar a `ctrl.update(1/60)` en un bucle.
- **Protocolo de la sala** (mensajes `t`): `join`, `s` (estado `[x,y,z,yaw,vel,pose]`, pose 0–5: parado, agachado, sentado, trepando, aire, saltando baranda), `afk`,
  `mic`, `look`, `chat`, `sfu` (pedidos al servidor de audio: push/unpush/pull/unpull/answer), `sfu-cut`,
  `pub` (alguien publicó su voz), `sfu` op `ice` (servidores TURN), `group` (invite/respond/leave/kick), `groups` (estado de los grupos), `screen`, `drop`, `pickup`, `mod`, `trade`, `emote` (gestos), `dj` (cabina: on/off, track), `part` (consola de artistas: luces / escenario), `luces` (estado de las luces por OSC), `edit` (editor: template/add/update/remove) → `layout`, `piece`, `piece-`, `edit-fail`, `progress` (avisos de progresión).
- **Puente OSC:** `npm run puente` (sin dependencias) recibe OSC en el puerto 9000 y lo pasa a la pestaña
  del juego por http://127.0.0.1:9001. Direcciones en `src/net/osc.js`.
- El servidor nunca confía en el cliente para nombre, ropa ni objetos: los lee de `Accounts`.
- **Seguridad** (ver `docs/ramas/seguridad.md`): catálogos con `Object.hasOwn` (nunca `CATALOGO[x]` con lo
  que manda el cliente: `constructor` existe en todo objeto); antiflood general por conexión (`RATE`/`allow`
  en room.js); una sola conexión por cuenta (`claimConn` → `takeover`, mensaje `elsewhere`); frenos por IP
  en ingreso y cuentas nuevas (`limits`); salas válidas: `museo` y `u-<16 hex>`.
- **Catálogos compartidos** (objetos, peinados, validaciones) en `server/shared.js`, importados
  también por el cliente.
- **Admins:** `wrangler.jsonc` → `vars.ADMIN_IDS`. El dueño de una sala `u-<id>` es esa cuenta. Los
  admins entran también a salas cerradas.
- La interfaz de avatar (`setLook`, `setEquip`, `gesture(nombre)`, `update(dt, {speed, pose, turn, landing})`,
  `root`, `scale`, `phase`, `mats.skin/shirt`) la usan el controlador, los jugadores remotos y los brazos
  de 1ª persona. El modelo (Quaternius) se carga en segundo plano: `avatar.model` es `null` hasta entonces.
- **Animaciones** en `src/player/anims.js`: se adaptan al esqueleto de Quaternius comparando con la pose
  de reposo (todas en pose T). Para sumar una de Mixamo: FBX Binary, Without Skin, 30 fps, en
  `public/models/anims/mixamo/` y agregarla en `GESTURE_CLIPS`.
- **Calidad gráfica** automática en `src/quality.js` (`?calidad=low|medium|high` la fuerza en desarrollo).
- Para probar el personaje sin entrar al juego: `devtest/` (no se sube) con páginas sueltas de Vite.
