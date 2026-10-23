# Rama `agente/progresion`: progresión, misiones e insignias (paso 4 del plan)

Notas para el master que junta las ramas. Las decisiones del usuario están en
[ROADMAP.md](../ROADMAP.md) → "Decisiones de diseño" (filas nuevas al final, desde "Progresión: orden con el editor").

## Qué se hizo

- **Puntos y niveles privados**: cada cosa suma una sola vez (tabla `progress_log`). Ver obra del público 10 ·
  sala ajena 5 · obra propia expuesta 100 · curar 15 · evento 50 · paso del camino 20. Nivel N desde 25·N·(N−1).
- **Insignias públicas** con bronce/plata/oro (Explorador, Trotamundos, Artista, Ojo crítico, Fiestero, Querido)
  + los títulos Curador y Creador. Se ven en el perfil (E sobre alguien).
- **Camino inicial** de 7 pasos en orden y **3 misiones diarias** al azar (cambian a las 00:00 GMT-3).
- **Recompensas como datos**: objetos al azar dentro de una rareza (básico / raro / exótico).
- **Curador automático**: nivel 8 + 30 obras del público vistas.
- **Eventos**: 5 minutos en la sala durante un set de DJ (o show de la consola) con más de 5 personas.
- **Interfaz**: barrita "Nv N" en el HUD (al tocarla abre la app), app **Progreso** en el celular, avisos
  (toasts) al subir de nivel / completar misiones / ganar insignias, insignias en el perfil, borde de color por
  rareza en el inventario.

## Archivos nuevos

- `server/progress.js`: tablas, `progressMethods` (se mezclan en `Accounts`), `roomTrack` y `roomEventTick` (para la sala).
- `src/ui/progress.js` + `src/ui/progress.css`: interfaz. Inyecta la app del celular y la barrita por JS
  (no toca `index.html` ni `style.css`).
- `docs/ramas/progresion.md` (este archivo).

## Rutas nuevas (server/worker.js)

| Ruta | Qué hace |
|---|---|
| `GET progress` | Todo lo mío (privado): nivel, puntos, camino, diarias, insignias, títulos y avisos nuevos (los marca vistos) |
| `POST progressview` `{ id }` o `{ fixed }` | Miré una obra con E. `id` = obra del público (suma si está expuesta y estoy en el Museo); `fixed` = título de una obra de base (solo camino y diarias) |
| `GET badges?id=` | Insignias públicas y títulos de alguien |

Mensaje nuevo de la sala al cliente: `{ t: 'progress', news: [{ text, kind }] }`.

## Tablas nuevas (SQLite de Accounts)

`progress` (puntos, nivel, paso del camino, curator_given) · `progress_log` (lo que ya sumó: user, kind, ref) ·
`daily` (misiones del día en JSON) · `daily_refs` (para no contar dos veces lo mismo en el día) ·
`badges` (escalón más alto ganado) · `progress_news` (avisos para mostrar en pantalla).

## Enganches en código ajeno (lista exacta)

- `server/accounts.js`: import de `progress.js`; `setupProgress(this.sql)` en el constructor;
  `progressTrack(me.id, 'amigo')` en `friendRequest` y en `friendRespond` (al aceptar);
  `progressTrack(me.id, 'muro')` en `noteAdd`; `progressTrack(…'like'…)` + `progressBadges(post.owner)` en `like`;
  `progressTrack(me.id, 'corazon', ownerId)` en `heartGive`; `Object.assign(Accounts.prototype, progressMethods)` al final.
- `server/works.js`: `progressTrack(me.id, 'postular')` en `workSubmit`; `progressTrack(me.id, 'curada', w.id)` en
  `reviewVote`; `progressTrack(next.author, 'expuesta', next.id)` en `rotate`.
- `server/room.js`: import; `roomEventTick(this)` en `alarm`; `roomTrack(this, ws, user.id, 'sala')` al entrar;
  `roomTrack(this, ws, meta.userId, 'gesto')` en `emote`.
- `server/worker.js`: 3 rutas (`GET progress`, `POST progressview`, `GET badges`).
- `server/shared.js` (al final): `RARITIES`, `ITEM_RARITY`, `rarityOf`.
- `src/main.js`: import; `createProgress(…)` después de `togglePhone`; `progress.start()` en `join()`;
  `progress.viewed(item)` en `openInspect`; `progress.profileBadges(…)` en `openProfile`.
- `src/ui/social.js`: import de `rarityOf` y clase `r-<rareza>` en `card()` (inventario).
- `src/ui/phone.js`: texto del aviso `title_curator` en `NOTIF_TEXT`.

## Pendiente para conectar con el editor de salas

- **Muebles como recompensa**: agregar en `server/shared.js` → `ITEM_RARITY` el id de cada mueble especial con su
  rareza. `progressReward` (en `progress.js`) hoy elige de los que están en `ITEMS` y usa `ITEMS[tipo].colors`:
  si los muebles viven en otro catálogo, cambiar esas dos líneas para que busque también ahí (y que el objeto
  vaya al inventario de muebles especiales). Las reglas de qué rareza da cada cosa están en `REWARDS`.
- **Rareza de los objetos actuales (provisoria, la puse yo)**: gorra, gorro, auriculares, anteojos, lentes y mochila =
  básico; cadena = raro; corona = exótico. Consultar al usuario cuando haya muebles.

## Qué tiene que saber el master

- **Interpretaciones mías (confirmar con el usuario si hace falta):**
  - Los **invitados no suman** progreso (no pueden tener objetos para recibir las recompensas).
  - El **camino es estricto**: solo cuenta el paso que toca (si ya habías agregado un amigo antes de llegar a ese
    paso, hay que agregar otro).
  - "Ver 3 obras" de las diarias cuenta también las obras **de base** del Museo (no dan puntos de nivel).
  - El **curador automático se da una sola vez**: si un admin lo saca con `/curador`, no vuelve solo.
  - "Querido" cuenta los me gusta recibidos en notas y fotos; si borrás la publicación, la insignia ya ganada no se pierde.
- **Limitación ya existente que afecta a los eventos:** si la sala "hiberna" (nadie manda nada ~10 s), se pierde en
  memoria quién es el DJ (`this.dj`) y también el reloj del evento. Con jugadores reales no pasa (el cliente manda
  `ping` cada 5 s), pero con todas las pestañas en segundo plano podría.
- Los avisos de me gusta / muro / curar llegan a la pantalla con la consulta cada 45 s (`GET progress`); los de la
  sala (gestos, salas, eventos) y ver obras, al instante.
- Probado con `npm run dev`: scripts contra el servidor (camino, diarias, obra expuesta y curada por un admin,
  anti-farmeo fuera del Museo / repetida, evento con 6 personas y DJ durante 5 min, sala propia que no cuenta) y en
  el navegador (Playwright, PC y celular): barrita, app Progreso, ver obra con E → aviso, rareza en el inventario.
