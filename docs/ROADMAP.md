# Roadmap y decisiones

## Próximos pasos

### En curso
1. **Personaje realista estilizado (Quaternius).** ✅ Primera versión hecha (`src/player/avatar.js`,
   reemplaza al personaje hecho por código). Modelos en `public/models/quaternius/` (CC0).
   - Ropa pintada por el sombreador según el hueso que mueve cada vértice (torso, brazos, piernas, pies).
   - Accesorios enganchados a `Head` (gorros, auriculares, anteojos) y a `spine_03` (cadena, mochila).
   - Animación procedural sobre los huesos (las mismas poses que el personaje anterior).
   - Texturas de 2K en PC y copias de 1K (`textures/1k/`) en calidad baja (celular).
   - Falta: parpadeo (el modelo no tiene párpados animables), ropa con volumen (ver pendientes).
2. **Animaciones** ✅ (`src/player/anims.js`): movimiento básico de la Universal Animation Library
   (Quaternius, mismo esqueleto) y gestos/bailes de Mixamo adaptados al esqueleto de Quaternius.
   Falta: trepar (no hay animación; usa la de salto), Clapping (aplaudir sigue hecho por código).
   Los packs originales están en `assets-src/` (no se publican); en `public/models/anims/` solo lo que se usa. Lista pedida: Idle, Walking, Jogging, Fast Run,
   Jump, Falling Idle, Crouch Idle, Crouch Walk Forward, Sitting Idle, Climbing / Braced Hang To Crouch,
   Talking, Waving, Clapping, Pointing, y 2-3 bailes. Formato FBX Binary, Without Skin, 30 fps,
   In Place en las de desplazamiento.

### Pendientes (a consultar antes de implementar)
- **Modelos de personaje:** el pack gratis de Universal Base Characters trae solo los 2 cuerpos
  Superhero (Regular/Teen están en la versión Source, USD 19,99). El usuario no quiere seguir por ahí:
  investigar alternativas fuera de Quaternius.
- **Ropa del personaje nuevo:** hoy remera y buzo solo cambian el largo de la manga (el buzo no
  tiene capucha ni bolsillo) y la ropa se ve pegada al cuerpo. "Luego lo vemos".
- **Peinados rulos y coleta** con el estilo del pack (hacerlos en Blender). Hoy se muestran como
  corto y rodete, pero el dato guardado de cada cuenta no se toca.
- **Puente OSC para artistas** (TouchDesigner, Ableton/Max for Live, Blender): programa local que
  recibe OSC y lo manda a la sala; luces/visuales reaccionando a lo que hacen en vivo. Showcase con
  varias pantallas compartidas.
- **Música del DJ** desde una PC a los parlantes del escenario (la M ya silencia "música y pantalla").
- **Salas de usuario tipo Fotolog/Instagram**: subir fotos que se cuelgan como cuadros, libro de visitas.
- **Cartelera tipo muro** (Facebook/Twitter) en el hall.
- **AR** en las dos direcciones (obras/avatar en tu habitación; fotos/escaneos del mundo real al juego).
- **Editor avanzado (capa 2)** con sliders de cara y cuerpo.
- **Nombre y marca definitivos** (hoy "Galería Online" es provisorio).
- **Arrastrar objetos al suelo: ¿alcance máximo?** Hoy no tiene límite (cae donde se suelta).
- **Selfie → avatar:** MetaPerson (Avatar SDK) requiere plan pago (~800 USD/mes para integrar);
  no se encontró alternativa gratuita vigente. Queda en espera.

### Técnicos
- Servidor TURN (Cloudflare Calls) para que la voz/pantalla conecten en redes cerradas.
- Comprimir modelos y texturas (KTX2/Draco) para celulares.
- Mutear/ignorar hoy se guarda en el navegador (no en la cuenta).
- Los baneos son por cuenta: un invitado nuevo puede volver a entrar.

## Decisiones de diseño (tomadas por el usuario)

| Tema | Decisión |
|---|---|
| Estilo visual | Estilizado tipo Fortnite |
| Plataformas | PC y celular |
| Público | Comunidad / amigos |
| Personalización | Dos capas: básica (ropa + rasgos) y avanzada (completa) |
| Hosting | Gratis (Cloudflare); local primero |
| AFK | No se expulsa por AFK; solo una etiqueta "AFK" debajo del nombre. Se sale al cerrar la pestaña |
| Cuentas | Invitado persistente o usuario + contraseña; no pedir datos al recargar |
| Cámara | Cambio 1ª/3ª persona con la rueda (sin botón en PC; en celular sí) |
| Teclas | E usar · P personaje · V (mantener) hablar · M silenciar música de la sala · Tab (mantener) jugadores/info · Esc menú con pestañas · I inventario · F amigos · Y Mundi · R gestos |
| Stamina | Correr gasta stamina (barra visible) |
| Interactuar | E en cuadros: ficha + vista previa del sitio; E en jugadores: perfil con pestaña galería (estilo Second Life) |
| Objetos en el suelo | Otro jugador puede juntarlo a los 5 s; si nadie lo junta en 60 s, **se pierde para siempre** |
| Inventario | No frena al personaje; se puede arrastrar un objeto a la escena para soltarlo |
| Paneles que no frenan | Inventario, amigos (F), jugadores (Tab), gestos (R) y editor (P). En el editor la cámara es de vitrina hasta que te movés; ahí pasa a la normal |
| Gestos | Con comandos (/saludar, /aplaudir, /festejar, /señalar, /bailar) y con un menú en la R. El baile sigue hasta que te movés; el resto se hace una vez |
| Bailes | 10 bailes: /bailar = uno al azar, /bailar N = ese; en el menú de la R cada uno con su nombre |
| Aplaudir / festejar | Como no hay Clapping, se agregó /festejar (Cheering); aplaudir sigue hecho por código |
| Hablar | Con el micrófono abierto y quieto, el personaje usa la animación de hablar |
| Mutear / ignorar | Mutear = silenciar su voz. Ignorar = silenciar voz y texto |
| Moderación | Dueño de cada sala personal; el usuario "xvvave" es admin del Museo y de todas las salas. Expulsar, banear, silenciar, traer, mandar a la entrada, habilitar/deshabilitar chat/voz/pantalla/objetos |
| Mapas | Botón Mundi + comandos en el chat (`/ir`, `/salas`) |
| Día y noche | Según la hora GMT-3 |
| Web3 | No por ahora |
| Personaje | Modelo Quaternius para todos (se reemplaza el hecho por código, sin respaldo) |
| Tipo de cuerpo | Masculino / femenino; todo libre (cualquier cuerpo puede usar cualquier peinado y barba) |
| Peinados | corto, largo, rapado, rodete. Rulos → corto y coleta → rodete hasta que existan (sin preferencia del usuario; opción reversible) |
| Calidad gráfica | Siempre automática (sin selector): baja/media/alta según GPU, memoria y celular; si anda lento baja sola. KTX2 para celular más adelante (todavía no se instalan las herramientas) |
| Botones | PC: Gestos, Sala, Personaje y Ajustes arriba a la derecha; Inventario, Amigos y Mundi abajo a la derecha; Hablar y Audio debajo del chat. Celular: todo arriba con íconos (mochila, celular, mundo); Hablar y Audio arriba del chat |
