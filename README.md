# VRChat-Web (nombre provisorio: "Galería Online")

Mundo social 3D que se juega desde el navegador, sin descargar nada. Inspirado en
Boombang, Second Life, Habbo y la onda de Fortnite (estilizado), pero con dinámica
social y no de combate: salas tipo museo, personajes personalizables, voz por
proximidad, pantallas compartidas, amigos, objetos e intercambios.

Funciona en PC y celular. Hecho con **Three.js** (cliente) y **Cloudflare Workers +
Durable Objects** (servidor), que corre gratis en local y en el plan gratuito de Cloudflare.

## Probarlo

Requisitos: Node.js 22 o más nuevo.

```bash
npm install
npm run dev
```

- Abrí http://localhost:5173
- Desde el celular u otra PC de tu Wi-Fi: la dirección "Network" que muestra la consola.
- Otra sala: `http://localhost:5173/?sala=nombre`. Cada jugador tiene su sala personal (`?sala=u-<id>`).

## Qué hay

| Área | Estado |
|---|---|
| Sala museo | Tragaluz con sol, columnas, cuadros con ficha, esculturas, pantalla gigante, pista de baile y cabina de DJ |
| Día y noche | Según la hora de Argentina (GMT-3) |
| Personaje | Estilizado y armado por código, con editor (piel, ojos, pelo, ropa, altura, contextura). Modelo Quaternius descargado, **integración en curso** |
| Movimiento | Inercia estilo Fortnite, stamina, saltar, trepar, agacharse, sentarse; 1ª/3ª persona con la rueda; manos tipo GoPro en 1ª persona |
| Cuentas | Invitado persistente o usuario + contraseña (PBKDF2) |
| Social | Chat, AFK, perfiles (E sobre alguien), amigos, presencia, Mundi y comandos `/ir` |
| Voz y pantalla | WebRTC P2P: voz con audio espacial (mantener V), compartir pantalla en la pantalla gigante |
| Objetos | Inventario, equipar accesorios, intercambiar, soltar en el suelo (arrastrando o con botón) |
| Moderación | Dueño de sala y admins: expulsar, banear, silenciar, traer, mandar a la entrada, habilitar/deshabilitar chat, voz, pantalla y objetos |

## Controles

| PC | Celular |
|---|---|
| Click para tomar el mouse y mirar | Arrastrar para mirar |
| WASD / flechas, Shift corre (gasta stamina) | Joystick (al máximo corre) |
| Espacio salta; contra algo bajo, trepa | Botón Saltar |
| C (alterna) o Ctrl (mantener) para agacharse | Botón Agachar |
| E o click: usar lo que apuntás | Botón Usar |
| Rueda: acerca la cámara hasta 1ª persona; en 1ª hace zoom | Botón de cámara |
| V (mantener): hablar | Botón Hablar (mantener) |
| M: silenciar música y pantalla de la sala | Botón Sala |
| Tab: jugadores, info y moderación de la sala | — |
| Esc: menú (General, Audio, Controles) | Engranaje |
| P personaje · I inventario · F amigos | Botones de arriba |
| Enter: chat (`/ayuda`, `/salas`, `/ir …`) | Botón Chat |

## Estructura

```
server/
  worker.js     Entrada: rutas /api/* (cuentas) y /ws/<sala> (tiempo real)
  accounts.js   Durable Object global (SQLite): usuarios, sesiones, inventario, amigos, presencia
  room.js       Durable Object por sala: posiciones, chat, señales WebRTC, pantalla,
                intercambios, objetos en el suelo, moderación
  shared.js     Validaciones y catálogos compartidos con el cliente (objetos, estilos)
src/
  main.js       Arma todo: render, interfaz, red, interacción, bucle principal
  world/        Sala (museum.js), texturas generadas, fichas de obras, objetos en el suelo
  player/       Personaje, accesorios, controles/física, manos de 1ª persona
  net/          WebSocket de la sala, jugadores remotos, API de cuentas, WebRTC (voz y pantalla)
  ui/           Social (inventario, amigos, intercambios), panel de sala, avisos, íconos
public/models/  Modelos 3D (Quaternius, CC0)
scripts/        Arranque del servidor local
```

## Subirlo online (gratis)

```bash
npx wrangler login
npm run deploy
```

Queda en `https://galeria-online.<tu-usuario>.workers.dev`. Los admins se configuran en
`wrangler.jsonc` → `vars.ADMIN_IDS` (IDs de cuenta separados por coma).

## Créditos

- Personajes base y peinados: [Quaternius – Universal Base Characters](https://quaternius.itch.io/universal-base-characters), licencia CC0.
- Three.js, Vite, Cloudflare Workers.

Próximos pasos y decisiones de diseño: ver [docs/ROADMAP.md](docs/ROADMAP.md).
