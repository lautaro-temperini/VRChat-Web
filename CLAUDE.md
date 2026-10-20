# CLAUDE.md

Guía para trabajar en este proyecto con Claude Code. Leé también [docs/ROADMAP.md](docs/ROADMAP.md)
(próximos pasos y decisiones de diseño ya tomadas).

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
  - `Accounts` (una instancia global): usuarios, sesiones, inventario, amigos, presencia.
  - `Room` (una por sala): tiempo real por WebSocket con hibernación.
- **Voz y pantalla:** WebRTC P2P en malla; la sala solo pasa las señales. Sin TURN todavía.

## Comandos

```bash
npm run dev      # cliente (5173) + servidor (8787) juntos
npm run build    # compila el cliente en dist/
npm run deploy   # build + wrangler deploy
```

## Cosas a saber

- **Windows:** wrangler falla con SQLite si la ruta del proyecto es muy larga; por eso
  `scripts/dev-server.js` guarda el estado local en `%TEMP%/galeria-state`.
- **PowerShell 5.1** lee UTF-8 sin BOM como ANSI y rompe los acentos: para editar archivos con
  scripts usar `[IO.File]::ReadAllText/WriteAllText` con UTF-8, o las herramientas de edición.
- **Pruebas:** en desarrollo existe `window.__game` (ctrl, world, remotes, rtc, social, net,
  ground, roomPanel, `setHour(h)` para probar día/noche…). Si el panel del navegador está oculto,
  el juego corre a muy pocos cuadros: para probar física llamar a `ctrl.update(1/60)` en un bucle.
- **Protocolo de la sala** (mensajes `t`): `join`, `s` (estado `[x,y,z,yaw,vel,pose]`), `afk`,
  `mic`, `look`, `chat`, `rtc`, `screen`, `drop`, `pickup`, `mod`, `trade`, `emote` (gestos). El servidor nunca
  confía en el cliente para nombre, ropa ni objetos: los lee de `Accounts`.
- **Catálogos compartidos** (objetos, peinados, validaciones) en `server/shared.js`, importados
  también por el cliente.
- **Admins:** `wrangler.jsonc` → `vars.ADMIN_IDS`. El dueño de una sala `u-<id>` es esa cuenta.
- La interfaz de avatar (`setLook`, `setEquip`, `gesture(nombre)`, `update(dt, {speed, pose, turn, landing})`,
  `root`, `scale`, `phase`, `mats.skin/shirt`) la usan el controlador, los jugadores remotos y los brazos
  de 1ª persona. El modelo (Quaternius) se carga en segundo plano: `avatar.model` es `null` hasta entonces.
- **Animaciones** en `src/player/anims.js`: se adaptan al esqueleto de Quaternius comparando con la pose
  de reposo (todas en pose T). Para sumar una de Mixamo: FBX Binary, Without Skin, 30 fps, en
  `public/models/anims/mixamo/` y agregarla en `GESTURE_CLIPS`.
- **Calidad gráfica** automática en `src/quality.js` (`?calidad=low|medium|high` la fuerza en desarrollo).
- Para probar el personaje sin entrar al juego: `devtest/` (no se sube) con páginas sueltas de Vite.
