# Rama `agente/editor-salas` — Editor de salas (paso 3 del plan)

## Qué hace
- Las salas personales (`u-<id>`) dejan de ser una copia del Museo: usan una **plantilla** (loft, galería,
  club, terraza; ~12 × 10 m, entrada al sur) con **muebles** que pone el dueño. El Museo queda igual.
- La primera vez que el dueño entra a su sala elige la plantilla (hasta entonces se ve el loft vacío).
- **Editor** (botón "Editar sala", solo el dueño en su sala): vista desde arriba (se ocultan techo y
  paredes que tapan), catálogo por categorías con miniaturas, arrastrar para mover (grilla de 25 cm,
  Alt = libre), girar de a 15° (R / botones), color RGB libre + muestras, sacar (Supr), Esc cancela el
  arrastre. Los cambios se mandan al soltar. Celular: tocar y arrastrar, hoja de catálogo con "Agregar",
  botones grandes, pellizcar para acercar.
- Cuadros con **fotos de la galería** del dueño (solo si su galería es visible para todos); E abre la ficha.
- **Muebles especiales** (trono, bola de espejos, sillón de terciopelo con neón, escultura de neón) salen
  del inventario al ponerlos y vuelven al sacarlos o al cambiar de plantilla.
- Cabina de DJ, consola de artistas, parlantes y **hasta 2 pantallas** son muebles (en cualquier plantilla).
  La 2ª pantalla muestra lo mismo que la 1ª ("espejo") o tiene **su propio VJ** ("propia", se toma con E
  sobre ella; quien la toma no queda fijo en la consola).
- El atril (notas + corazones) es un mueble opcional.
- Paquete inicial: las cuentas nuevas reciben 15 objetos al azar entre prendas y muebles especiales.

## Archivos
Nuevos: `server/editor.js`, `src/world/rooms.js`, `src/world/templates.js`, `src/world/furniture.js`,
`src/world/editor.js`, `src/world/editor.css`, `src/world/stage2.js`.
Tocados (enganches chicos): `server/shared.js` (al final: `ROOM_TEMPLATES`, `FURNITURE`, `FURNITURE_CATS`,
`SPECIAL_FURNITURE`, `TEMPLATE_PIECES`, `cleanPiece`…), `server/room.js` (mixin, `layout` en `welcome`,
caso `edit`, `escenario2`/`stage2`, entrada de salas personales en "mandar a la entrada"),
`server/accounts.js` (mixin, paquete inicial, los muebles no se equipan), `src/net/rtc.js` (los métodos
de la pantalla aceptan `slot`: `'stage'` | `'stage2'`, sin cambiar lo de antes), `src/main.js` (imports,
crear el mundo según la sala, overlay `roomedit`, el atril pasa a ser mueble, `roomEditor.onWelcome/update`,
E y cartel de `screen2`), `src/world/ground.js` y `src/ui/social.js` / `src/ui/icons.js` (muebles en el
suelo y en el inventario), `docs/ROADMAP.md` (decisiones nuevas al final de la tabla).

## Protocolo de la sala (nuevo)
- Cliente → sala: `edit` con `op`: `template` (`template`), `add` (`piece` con id provisorio), `update`
  (`id`, `piece` con los campos que cambian), `remove` (`id`). Solo el dueño de la sala.
- Sala → todos: `layout` (`layout`, `back` = especiales devueltos), `piece` (`piece`, `tmp` = id provisorio
  al agregar), `piece-` (`id`, `back`), y al que falló `edit-fail` (`op`, `id`, `piece`).
- `welcome` trae `layout` (`null` en el Museo).
- Parte nueva de la consola `escenario2` y pista `stage2` (la segunda pantalla con su propio VJ).

## Datos y migraciones
- Diseño de cada sala en el storage del Durable Object de la sala: clave `layout` =
  `{ template, pieces: [{ id, type, x, y, z, r, c, iid?, photo?, w?, m? }], chosen }`. Sin migración.
- Muebles especiales puestos: en la tabla `items`, `owner_id = 'room:<userId>'` (como `ground:`). Sin
  cambios de esquema.

## Para la progresión
Los muebles se referencian por id de `FURNITURE` (en `server/shared.js`). Un mueble especial nuevo =
agregar una entrada con `special: true` y su modelo en `buildFurniture` (`src/world/furniture.js`);
para darlo, `addItem(userId, tipo, FURNITURE[tipo].color)` en `Accounts`.

## Al juntar
- `server/shared.js`: mi bloque va al final del archivo; si otra rama también agregó al final, quedan los dos.
- `src/main.js`: mis cambios son líneas sueltas (buscar `roomEditor`, `isPersonalRoom`, `'roomedit'`).
- Las salas personales que ya existían arrancan sin `layout`: al entrar el dueño elige plantilla.
- Pendiente de probar con gente real: la segunda pantalla con video (en desarrollo no hay clave del SFU).
