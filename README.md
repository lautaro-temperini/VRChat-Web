# VRChat-Web (nombre provisorio: "Galería Online")

**Exposición artística digital gamificada** que se juega desde el navegador, sin descargar nada.
Pública, para artistas de 20 a 40 años (+18). Un museo en 3D con obras, salas personales, DJ y
artistas en vivo, voz por proximidad, red social en el celular del personaje, objetos e intercambios.
Inspirado en Boombang, Second Life y Habbo, con dinámica social y no de combate.

Funciona en PC y celular. Hecho con **Three.js** (cliente) y **Cloudflare Workers + Durable Objects**
(servidor), que corre gratis en local y en el plan gratuito de Cloudflare.

## Probarlo

Requisitos: Node.js 22 o más nuevo. En Windows: `git config --global core.longpaths true`.

```bash
npm install
npm run dev
```

- Abrí http://localhost:5173
- Desde el celular u otra PC de tu Wi-Fi: la dirección "Network" que muestra la consola.
- Otra sala: `http://localhost:5173/?sala=nombre`. Cada cuenta tiene su sala personal (`?sala=u-<id>`).
- Para correr dos copias a la vez: `npm run dev:alt` (servidor en el 8788, con sus propios datos).

## Qué hay

| Área | Estado |
|---|---|
| Museo | Hall con barra, baño y esculturas; pista con balcón en U, escenario, cabina de DJ, consola de artistas y una pantalla gigante |
| DJ y artistas | El DJ pasa el audio de su PC por los parlantes del escenario; las luces laten con los graves. Artistas: luces por OSC (TouchDesigner, Ableton…) y visuales en la pantalla |
| Día y noche | Según la hora de Argentina (GMT-3) |
| Personaje | Modelo MakeHuman con editor (piel, ojos, 8 peinados, barbas, ropa, altura, peso y músculo), animaciones de Mixamo y gestos/bailes |
| Movimiento | Caminar, trotar (gasta stamina), saltar, trepar, agacharse, sentarse; 1ª/3ª persona con la rueda; manos en 1ª persona |
| Cuentas | Registro con mail + nickname único (PBKDF2), o con Google o Discord. Invitados (sin cuenta) solo para probar: miran, chatean por texto y escuchan voces públicas; lo demás aparece con candado 🔒 |
| Red social | Celular del personaje: amigos y buscador, muro (notas y fotos de amigos + destacados, me gusta), galería y avisos. Atril con notas y corazones en cada sala personal |
| Salas personales | Nombre, descripción y quién entra (abierta / amigos / cerrada); salas favoritas en el Mapa |
| Voz | Por el servidor de audio de Cloudflare (nadie ve la IP de otro): escuchás a los 4 más cercanos que hablan (10 m), con audio 3D. Grupos de voz privados de hasta 4 (E sobre alguien → Invitar al grupo) |
| Objetos | Inventario, equipar accesorios, intercambiar o regalar, soltar en el suelo |
| Cuidarse | Mutear (voz), ignorar (voz y texto) y restringir (publicaciones). Antiflood en el chat |
| Moderación | Dueño de sala y admins: expulsar, banear, silenciar, traer, mandar a la entrada, habilitar/deshabilitar chat, voz, pantalla, objetos, DJ y consola |

## Controles

| PC | Celular |
|---|---|
| Click para tomar el mouse y mirar | Arrastrar para mirar |
| WASD / flechas; Shift trota (gasta stamina) | Joystick |
| Espacio salta; contra algo bajo, trepa | Botón Saltar |
| C agacharse | Botón Agachar |
| E: usar lo que apuntás (cuadros, gente, cabina, atril…) | Botón Usar |
| Rueda: acerca la cámara hasta 1ª persona | Botón de cámara |
| V (mantener): hablar | Botón Hablar (mantener) |
| M: silenciar música y pantalla de la sala | Botón Audio |
| Tab (mantener): jugadores, info y moderación de la sala | Botón Sala |
| F celular · Y Mapa · R gestos · P personaje · I inventario | Botones de arriba |
| Esc: menú (General, Audio, Controles) | Engranaje |
| Enter: chat (`/ayuda`, `/salas`, `/ir …`, `/bailar`…) | Botón Chat |

## Estructura

```
server/
  worker.js     Entrada: rutas /api/* (cuentas y red social) y /ws/<sala> (tiempo real)
  accounts.js   Durable Object global (SQLite): usuarios, sesiones, inventario, amigos, presencia,
                fotos, notas, muro, corazones, favoritas, avisos, restringidos
  room.js       Durable Object por sala: posiciones, chat, señales WebRTC, pantallas, DJ, consola,
                intercambios, objetos en el suelo, moderación
  shared.js     Validaciones y catálogos compartidos con el cliente (objetos, estilos)
src/
  main.js       Arma todo: render, interfaz, red, interacción, bucle principal
  world/        Museo, texturas, fichas de obras, objetos en el suelo, atril
  player/       Personaje, animaciones, accesorios, controles/física, manos de 1ª persona
  net/          WebSocket de la sala, jugadores remotos, API, WebRTC, OSC
  ui/           Celular, muro, galería, notas, inventario/amigos/intercambios, panel de sala, avisos
public/models/  Modelos 3D y animaciones
scripts/        Servidor local, segunda copia (dev:alt) y puente OSC (npm run puente)
```

## Agregar modelos a mano (sillones, luces, decoración)

Hasta que exista el editor de salas:

1. **Conseguirlo**: Poly Pizza, Sketchfab (CC0 o CC-BY, "Downloadable"), Quaternius, KayKit, Kenney;
   o generarlo con IA (Tripo, Meshy) o modelarlo en Blender. Revisar la licencia (CC-BY pide crédito).
2. **Requisitos**: `.glb`, escala en metros, eje Y hacia arriba, origen en la base, idealmente menos de
   20.000 triángulos y texturas de 1K–2K.
3. **Dónde**: `public/models/props/` y pedir dónde ubicarlo en la sala.

## Claves

La voz (Cloudflare Realtime) y el ingreso con Google/Discord necesitan claves secretas. En local van en
un archivo `.dev.vars` en la raíz (ignorado por git), una por línea:

```
REALTIME_APP_TOKEN=...
GOOGLE_CLIENT_SECRET=...
DISCORD_CLIENT_SECRET=...
```

Los IDs públicos (App ID de Realtime, Client ID de Google y Discord) están en `wrangler.jsonc`.

## Subirlo online (gratis)

Antes, una sola vez: activá **R2** en el panel de Cloudflare (pide tarjeta, tiene capa gratis) para las
obras del Museo. Después, desde la carpeta del proyecto, creá el bucket, cargá las tres claves y subilo:

```bash
npx wrangler login
npx wrangler r2 bucket create galeria-obras
npx wrangler secret put REALTIME_APP_TOKEN
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put DISCORD_CLIENT_SECRET
npm run deploy
```

En Google Cloud y en Discord hay que agregar también la dirección de vuelta online:
`https://<tu-sitio>/api/oauth/google/callback` y `https://<tu-sitio>/api/oauth/discord/callback`.

Queda en `https://galeria-online.<tu-usuario>.workers.dev`. Los admins se configuran en
`wrangler.jsonc` → `vars.ADMIN_IDS` (IDs de cuenta separados por coma). Online la base de datos
arranca vacía: creá tu cuenta ahí, poné su ID en `ADMIN_IDS` y volvé a correr `npm run deploy`.

## Créditos

- Personajes (cuerpos, peinados, barbas): [MakeHuman](https://static.makehumancommunity.org/) (assets CC0), armados con MPFB 2 en Blender.
- Animaciones básicas: [Quaternius](https://quaternius.itch.io/), licencia CC0.
- Animaciones de movimiento, gestos y bailes: [Mixamo](https://www.mixamo.com/) (Adobe).
- Three.js, Vite, Cloudflare Workers.

Próximos pasos y decisiones de diseño: ver [docs/ROADMAP.md](docs/ROADMAP.md). Resumen para retomar el trabajo: [docs/ESTADO.md](docs/ESTADO.md).
