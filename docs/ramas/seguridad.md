# Rama `agente/seguridad` — Revisión de seguridad, pruebas automáticas y main.js partido

El sitio ya está publicado: cualquiera puede mandarle a la sala mensajes de WebSocket armados a mano
y llamar a la API desde la consola. Se revisó cada mensaje de la sala (`webSocketMessage` en
`server/room.js`) y cada ruta de `/api` (`server/worker.js` → `accounts.js`, `works.js`, `progress.js`,
`editor.js`) mirando **quién** (sesión, invitado, admin, dueño, mod), **sobre qué** (que el objeto sea de
quien dice y exista), **dónde** (la sala correcta) y **datos** (tipo, largo, rango).

Todos los arreglos tienen su prueba en `test/` (`npm test`). Todo se probó contra el servidor local.

## Hallazgos (de más grave a menos)

| # | Gravedad | Qué pasaba | Cómo se reproducía | Arreglo |
|---|---|---|---|---|
| 1 | **Alta** | Robo de cuenta por mail sin confirmar: alguien registraba una cuenta con contraseña usando el mail de otra persona; cuando esa persona entraba con Google (mismo mail = misma cuenta) caía en la cuenta del atacante, que seguía entrando con su contraseña | Registrar `victima@gmail.com` con contraseña; la víctima entra con Google | **Decisión del usuario:** manda Google. Si la cuenta tiene contraseña y el mail nunca se confirmó, la contraseña deja de valer y se cierran las otras sesiones (`email_verified`, `oauthCallback`) |
| 2 | **Alta** | Duplicar muebles especiales: `edit` con plantilla `constructor` (o `toString`, `__proto__`…) pasaba el control (`ROOM_TEMPLATES[x]` encuentra cosas heredadas de JavaScript), devolvía los especiales al inventario y después se rompía: el mueble quedaba puesto **y** en el inventario (se podía intercambiar y volver a poner) | `{t:'edit',op:'template',template:'constructor'}` con un especial puesto | `Object.hasOwn` en todos los catálogos (plantillas, muebles, gestos, ajustes, tipos de obra, motivos); al cambiar de plantilla primero se cambia la sala y después se devuelven |
| 3 | **Alta** | Sin freno para probar contraseñas ni para crear cuentas/invitados (llenar la base) | Bucle de `POST /api/login` | **Decisión del usuario:** 10 contraseñas mal cada 15 min por cuenta+IP; 20 cuentas nuevas por IP por hora (tabla `limits`, la IP se guarda como hash) |
| 4 | **Media** | Intercambio ejecutado dos veces: dos "listo" seguidos mientras la cuenta hacía el cambio lo corrían de nuevo (el segundo fallaba, pero mandaba "falló" después de "hecho"; con otra combinación de objetos podía dejar estados raros). Una oferta vieja podía pisar a una nueva | Mandar `ready` 4 veces seguidas | El intercambio queda trabado (`busy`) mientras se ejecuta; cada oferta lleva versión |
| 5 | **Media** | Vista previa de links: abierta sin sesión (cualquiera usaba el servidor para bajar páginas) y seguía redirecciones sin revisarlas (un sitio público podía mandar a una dirección interna) | `GET /api/preview?url=` a un sitio que redirige a `127.0.0.1` | Pide sesión; redirecciones a mano (hasta 3) revisando cada destino; más rangos privados, puertos y tamaño |
| 6 | **Media** | Flood de mensajes que no son chat: posiciones, gestos, celular, AFK, pedidos de voz… sin límite (cada uno se reenvía a toda la sala o llama a la API de audio, que se cobra) | 600 `s` seguidos | Antiflood por conexión con tres baldes (`RATE`: todo 120 + 40/s; lo pesado 30 + 5/s; voz 40 + 10/s). Lo que sobra se descarta en silencio; el juego normal queda muy por debajo |
| 7 | **Media** | Moderar sin destinatario (`{t:'mod',op:'silence'}`) tiraba un error dentro de la sala | El dueño de una sala lo manda | Esas acciones exigen a alguien que esté en la sala |
| 8 | **Media** | El invitado era "dueño" de la sala `u-<su id>`: podía editarla y moderarla | Invitado entra a `u-<su id>` y manda `edit` | El dueño tiene que tener cuenta (`isMod`, editor) |
| 9 | **Media** | DJ, luces y pantallas se podían tomar en una sala personal sin cabina, consola ni pantalla (música en cualquier sala) | `{t:'dj',on:true}` en un loft | `hasGear`: tienen que estar los muebles (la 2ª pantalla, en modo "propia") |
| 10 | **Media** | Varias pestañas de la misma cuenta a la vez (fantasmas, intercambio consigo mismo) | Dos pestañas, invitarse | **Decisión del usuario:** una sola conexión por cuenta, la nueva manda, también entre salas (`claimConn` en la cuenta, `takeover` en la sala; mensaje `elsewhere`, cierre 4005) |
| 11 | **Media** | Fotos y obras: se aceptaba cualquier archivo con tipo "imagen" (por ejemplo un HTML) y se servía sin `nosniff` | `POST /api/photo` con `content-type: image/png` y HTML adentro | Se revisan los primeros bytes (JPG/PNG/WebP); archivos servidos con `nosniff` y `sandbox` |
| 12 | Baja | El buscador decía en qué sala estaba cualquiera (no solo amigos) | `GET /api/search?q=nick` | La sala solo para amigos; conectado sí/no para todos (`online`) |
| 13 | Baja | Corazones del atril sin estar en la sala (por la API, a cualquier sala) | `POST /api/heart` desde el Museo | Hay que estar en `u-<dueño>` (la presencia la avisa la sala) |
| 14 | Baja | Restringir, ignorar y reportar guardaban cualquier id (hasta MB de texto) | `POST /api/block` con un id gigante | Solo cuentas que existen |
| 15 | Baja | Salas con cualquier nombre (`/ws/lo-que-sea`) y de cuentas inexistentes: salas sin fin | Conectar a `/ws/hola` | Solo `museo` y `u-<16 hex>` de una cuenta que existe |
| 16 | Baja | Conexiones que nunca mandan `join` quedaban abiertas para siempre | Abrir muchos WebSocket sin entrar | Se cierran a los 15 s (`JOIN_TIMEOUT`) y ya no pueden entrar |
| 17 | Baja | Invitación a intercambiar repetida: le aparecía al otro cada vez | 20 `trade invite` seguidos | Mientras está pendiente (1 min) no se vuelve a mandar. **Decisión del usuario:** si te ignoró o restringió, no le llega |
| 18 | Baja | Ingreso con Google: el sitio de vuelta lo decía el cliente (cualquier `https://`). Google lo frena, pero no hay que confiar en eso | `POST /api/oauthstart` con `origin` ajeno | Tiene que coincidir con el `Origin` del navegador |
| 19 | Baja | Posiciones enormes, `mid` de voz sin tope (puede pasar el límite de 2 KB del estado de cada conexión), anchos/altos `Infinity`, pantalla vieja del hall que cualquiera podía "tomar" (ya no la usa el cliente) | Mensajes armados | Rangos acotados (±500 m), `mid` de hasta 16 caracteres, medidas hasta 10.000, se sacó el mensaje `screen` |
| 20 | Baja | Carreras: dos registros con el mismo nickname a la vez (error 500), muebles agregados a la vez pasando el tope de 100 | Pedidos en paralelo | Se vuelve a mirar después de cada espera |
| 21 | Baja | Spam en el muro y solicitudes de amistad insistentes | Bucles de `note` / `friendrequest` | **Decisión del usuario:** 20 notas por hora; amistad rechazada, 24 h sin poder volver a mandarla |
| 22 | Baja | Los invitados podían pasar música y tomar la consola | `{t:'dj',on:true}` como invitado | **Decisión del usuario:** no pueden (candado en el cliente, aviso en la sala) |

### Lo que ya estaba bien
- SQL siempre con parámetros (las únicas partes armadas son nombres de tablas fijos del código).
- Nombre, ropa y objetos se leen de la cuenta, nunca del cliente; admins solo por `ADMIN_IDS`.
- Intercambio todo o nada en la cuenta: si un objeto cambió de dueño a mitad (lo soltó, lo puso en la sala),
  el intercambio falla sin duplicar. Soltar y juntar a la vez: la cuenta es una sola y no se duplica.
- Fotos privadas, obras pendientes, progreso y avisos solo para quien corresponde.
- Tokens de sesión guardados como hash; contraseñas con PBKDF2.

## Queda para decidir / a futuro
- **El alcance de 3 m se mide desde la posición que manda el cliente**: alguien puede "teletransportarse"
  mandando posiciones falsas. Controlar la velocidad (rechazar saltos imposibles) cambia cómo se juega
  con lag y teletransportes de mods: consultar antes.
- **Las sesiones no vencen nunca** (se borran solo al salir). Ponerles vencimiento es una decisión de diseño
  ("no pedir datos al recargar").
- **Login CSRF**: el `state` del ingreso con Google no está atado al navegador (alguien podría hacerte
  entrar a su cuenta). Riesgo bajo.
- **Obras de base del Museo** (`progressview` con `fixed`): el título no se valida contra la lista de obras
  fijas; solo da avance a las diarias "mirá 3 obras" (tope diario), no puntos.
- **Curadores**: por la API pueden votar una obra pendiente cuyo id conozcan aunque no les haya "tocado".
- La base de cuentas guarda las fotos (hasta 30 × 700 KB por persona): con el freno de cuentas por IP
  alcanza por ahora; vigilar el tamaño del Durable Object.
- `npm audit` marca 3 avisos en dependencias de desarrollo (wrangler/vite); no se tocaron.

## Pruebas automáticas
`npm test` levanta un servidor propio (puerto 8790, datos en una carpeta temporal que se borra) y corre
`test/*.test.mjs` con `node:test` y el WebSocket de Node 22 (sin navegador):
- `test/sala.test.mjs`: dos jugadores se ven y se mueven, chat y antiflood, invitado sin micrófono,
  corte y reconexión sin fantasmas, se liberan DJ / consola / grupo / intercambio al cortarse.
- `test/objetos.test.mjs`: intercambio completo, objetos ajenos, doble aceptación, soltar a mitad,
  invitados e ignorados, juntar y soltar a la vez, muebles especiales (plantilla trucha, no se
  intercambian ni sueltan), solo edita el dueño.
- `test/seguridad.test.mjs`: una prueba por cada agujero de la tabla y por cada decisión nueva.
Con `TEST_BASE=http://127.0.0.1:8787 npm test` corre contra un `npm run dev` ya abierto.
El freno de cuentas por IP se sube en las pruebas (`--var CREATE_PER_HOUR:100000`).

## Protocolo y datos nuevos
- Sala → cliente: `elsewhere` (abriste el juego en otro lado) y cierre 4005 (el cliente no reconecta).
- Se sacó `screen` (pantalla vieja del hall; el cliente ya no la mandaba).
- Cuentas (SQLite, sin migración a mano: se crean solas): tablas `limits`, `friend_rejects`, `conns`;
  columna `users.email_verified`.
- Variables opcionales: `LOGIN_FAILS`, `CREATE_PER_HOUR` (por defecto 10 y 20).
