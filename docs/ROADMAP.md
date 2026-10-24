# Roadmap y decisiones

## Visión (21/10/2026)

**Exposición artística digital gamificada, pública, para artistas de 20 a 40 años (+18).**
El núcleo es el **Museo con obras del público** (rotan cada 24 h); lo social, la economía, las misiones
y las salas giran alrededor de exponer, descubrir y coleccionar arte.

## Plan acordado (21/10/2026), en orden

1. **Base para abrir al público**: registro con mail y nickname único; voz con IP oculta y grupos
   (escuchar a los más cercanos, party/grupo privado vs. público); antiflood en el chat; mutear,
   ignorar y restringir; aviso +18 y condiciones de uso; obras y cabinas no trepables; juntar las ramas.
   ✅ Hecho (23/10: voz, música y pantalla del escenario por Cloudflare Realtime SFU, con grupos de voz).
   Reportar quedó postergado. Para subirlo online falta cargar la clave con `wrangler secret put`.
2. **Museo rotativo con postulaciones**: cada obra dura 24 h, cola con prioridad para usuarios.
   Cuadros (arte digital, shaders, diseños) y esculturas (modelos 3D, instalaciones interactivas).
   Empezar por imágenes y modelos 3D; shaders e instalaciones después (corren código: aislar y limitar).
   ✅ Hecho (23/10): imágenes y modelos 3D, guardados en R2. Shaders e instalaciones, más adelante.
   Para subirlo online: activar R2 y crear el bucket (`npx wrangler r2 bucket create galeria-obras`).
3. **Editor de salas** y salas distintas entre sí (solo el Museo es igual para todos), con plantillas
   (loft, galería, club, terraza). ✅ Hecho (23/10): plantillas, muebles básicos y especiales, editor
   para PC y celular, fotos como cuadros, hasta 2 pantallas (ver `docs/ramas/editor-salas.md`).
   Falta: reemplazar los muebles hechos por código por un pack (a aprobar) y modelos subidos por usuarios.
4. **Progresión y misiones ligadas al arte** (descubrir, exponer, curar, asistir a eventos; no tiempo
   conectado), con objetos de recompensa. Niveles privados e insignias públicas. ✅ Hecho (23/10): puntos,
   niveles, insignias, camino inicial, misiones diarias y Curador automático (ver `docs/ramas/progresion.md`).
   Falta: que las recompensas incluyan los muebles especiales (definir la rareza de cada uno).
5. **Proceso de arte**: IA (Tripo/Meshy) para muebles, decoración y esculturas; Blender para cuerpos
   y ropa; **diseños de artistas como objetos del juego** (entran a la base y se pueden intercambiar).
   Más mapas públicos para exploradores. ✅ Diseño definido (copias ilimitadas para regalar, título Diseñador).

Pendientes transversales, en orden:
- **Revisión de permisos del servidor y pruebas automáticas** (dos clientes, desconexión, reconexión,
  acciones a la vez) y partir `src/main.js` en módulos. Antes de abrir al público.
- **Primera prueba con personas reales** (inauguración con 5–10 artistas exponiendo).

## Pedidos del 20/10 todavía pendientes

La música del DJ y el puente OSC ya están hechos. Falta:

- ~~Editor de sala dentro del juego~~ ✅ (paso 3). Falta: **modelos subidos por usuarios** si cumplen requisitos. **Consultar los requisitos**;
  propuesta NO decidida: GLB/glTF, tamaño máximo, tope de triángulos, texturas hasta 2K, escala en metros,
  sin scripts, licencia propia o CC0. Almacenamiento sugerido: R2, validación en el servidor.
- **Personaje**: ✅ tipos de cuerpo (flaco, promedio, gordo, musculoso + peso y músculo) y selector RGB
  completo (23/10; con Superhero se aproximan ensanchando huesos, con MakeHuman serán deformaciones reales).
  Falta: más peinados, cejas, ropa y accesorios. Personalización objetivo: contextura, altura, peinados, ojos, piel, boca, nariz, cejas,
  orejas, forma de la cara, aros, lentes, gorro, remera, buzo, pantalones, zapatos.
- **Más adelante**: avatares propios (esqueleto estándar) y después gestos/scripts propios (gestos como
  datos; scripts solo en un entorno aislado). Consultar.

## Próximos pasos

### Hecho
1. **Personaje realista estilizado (Quaternius).** ✅ Primera versión hecha (`src/player/avatar.js`,
   reemplaza al personaje hecho por código). Modelos en `public/models/quaternius/` (CC0).
   - Ropa pintada por el sombreador según el hueso que mueve cada vértice (torso, brazos, piernas, pies).
   - Accesorios enganchados a `Head` (gorros, auriculares, anteojos) y a `spine_03` (cadena, mochila).
   - Animación procedural sobre los huesos (las mismas poses que el personaje anterior).
   - Texturas de 2K en PC y copias de 1K (`textures/1k/`) en calidad baja (celular).
   - Falta: parpadeo (el modelo no tiene párpados animables), ropa con volumen (ver pendientes).
2. **Animaciones** ✅ (`src/player/anims.js`): movimiento básico de la Universal Animation Library
   (Quaternius, mismo esqueleto) y gestos/bailes de Mixamo adaptados al esqueleto de Quaternius.
   Caminar, trotar, correr, agacharse, caer, sentarse, trepar y quieto (masc/fem) son de Mixamo (más
   naturales que las de Quaternius, que se veían "superhéroe"); de Quaternius quedan hablar y un baile.
   Falta: Clapping (aplaudir sigue hecho por código).
   Los packs originales están en `assets-src/` (no se publican); en `public/models/anims/` solo lo que se usa. Lista pedida: Idle, Walking, Jogging, Fast Run,
   Jump, Falling Idle, Crouch Idle, Crouch Walk Forward, Sitting Idle, Climbing / Braced Hang To Crouch,
   Talking, Waving, Clapping, Pointing, y 2-3 bailes. Formato FBX Binary, Without Skin, 30 fps,
   In Place en las de desplazamiento.

### Pendientes (a consultar antes de implementar)
- **Modelos de personaje:** ✅ decidido (23/10): base **MakeHuman** (CC0), trabajada en Blender con el
  MCP en la PC del usuario. Especificación de los archivos en `docs/ramas/personaje-blender.md`.
  Hasta que estén, se sigue con los cuerpos Superhero (los tipos de cuerpo se aproximan ensanchando huesos).
- **Ropa del personaje nuevo:** hoy remera y buzo solo cambian el largo de la manga (el buzo no
  tiene capucha ni bolsillo) y la ropa se ve pegada al cuerpo. "Luego lo vemos".
- **Peinados rulos y coleta** con el estilo del pack (hacerlos en Blender). Hoy se muestran como
  corto y rodete, pero el dato guardado de cada cuenta no se toca.
- **AR** en las dos direcciones (obras/avatar en tu habitación; fotos/escaneos del mundo real al juego).
- **Editor avanzado (capa 2)** con sliders de cara y cuerpo.
- **Nombre y marca definitivos** (hoy "Galería Online" es provisorio).
- **Selfie → avatar:** MetaPerson (Avatar SDK) requiere plan pago (~800 USD/mes para integrar);
  no se encontró alternativa gratuita vigente. Queda en espera.

### Técnicos
- Redes muy cerradas: ✅ TURN de Cloudflare listo (23/10), se activa cargando `TURN_KEY_ID` y
  `TURN_KEY_API_TOKEN` con `wrangler secret put`. Revisar antes cómo se cobra.
- La sala valida la distancia solo cuando alguien se suscribe a una voz (con margen de 20 m); si
  después se aleja, el que dejó de escuchar es su cliente (que la suelta a los 18 m).
- Celulares: ✅ el Museo dibuja menos de la mitad de piezas (`src/world/merge.js`) y `src/loaders.js` ya
  entiende Draco/meshopt/KTX2. Falta lo más pesado: las animaciones y texturas del personaje (13 de los
  17 MB al entrar); hacerlo junto con el cambio a MakeHuman. Medir con `node scripts/medir.mjs`.
- Mutear se guarda en el navegador; ignorar y restringir viven en la cuenta.
- Los baneos son por cuenta: un invitado nuevo puede volver a entrar.

## Decisiones de diseño (tomadas por el usuario)

| Tema | Decisión |
|---|---|
| DJ: quién | Cualquiera puede pasar música si la cabina está libre; el dueño/mods pueden deshabilitarlo en la sala ("Pasar música (DJ)") |
| DJ: turnos | Sin cola: si está ocupada, avisa "la cabina está ocupada por X" |
| DJ: dónde suena | Desde los dos parlantes del escenario (canal izq./der.), más fuerte cerca, se oye en toda la sala. La M la silencia |
| DJ: cabina | Se arranca con E en la cabina; el DJ queda fijo ahí. Para salir, E de nuevo y confirma "Terminar mi set" |
| DJ: ritmo | Focos, luz del escenario, LEDs y pista de baile laten con los graves (cada uno lo calcula en su PC) |
| DJ + pantalla | Pueden estar las dos a la vez |
| DJ: cartel y avisos | Cartel "DJ: nombre" + track. En el chat: arranque, fin y "Ahora suena". El track se lee solo de un archivo de texto (Chrome/Edge); si no se configura, no se muestra |
| Artistas: qué | Luces por OSC (focos, luz del escenario, LEDs: una sola parte) y visuales como video desde su PC (pantalla compartida) |
| Artistas: quién y cuántos | Cualquiera (el dueño/mods pueden deshabilitar la consola). Varios a la vez, una parte cada uno: luces y pantalla → 1 VJ + 1 DJ + 1 de luces |
| Artistas: dónde | Cabina de VJ y luces, abajo del balcón oeste (E). La pantalla también se toma con E sobre ella. Al tomar el control quedan fijos en la cabina (como el DJ); para salir, E y "Soltar" |
| Pantalla del escenario | Ocupa toda la pared detrás del DJ, solo video (sin audio). Es la única pantalla |
| Luces + DJ | Si hay artista en luces, manda él (el latido con la música se apaga). Al soltar, vuelven a automático |
| Artistas: cartel y avisos | Cartel en la consola con quién tiene cada parte + aviso en el chat al tomar/soltar |
| Sala principal (planta) | 48 × 22 m. Hall (oeste): puerta doble de entrada, barra con banquetas (sur), baño con paredes de collage que sobresale al norte, esculturas junto a la pared del medio, plantas solo acá. Pista (este): paredes negras sin cuadros, balcón en U (2º piso) sobre tres paredes con sillones, escaleras desde el hall (norte y sur), cabina de VJ + luces abajo del balcón oeste, escenario con DJ |
| Piso | Cemento pulido en todo el edificio; sin pista de baile de cuadrados |
| Pantallas | Una sola: ocupa toda la pared del escenario (la del hall se sacó; ahí va la puerta). La toma un VJ, sin audio |
| Luces de la pista | Tiras de LED pixel en el techo + beams. Se encienden de noche o con DJ/artista; de día, apagadas. Sin los 4 haces del escenario ni los paneles blancos del techo. Sin carteles "Cabina DJ"/"Visuales" (el DJ y el track se ven en un cartelito en la cabina) |
| Moverse | Sin Shift camina (1,6 m/s); con Shift trota (3,2 m/s, gasta stamina). Saltar y agacharse, animación hecha por código |
| Controles | Aparecen en un cartel al entrar (una vez por visita); después con /controls o desde el menú |
| Estilo visual | ~~Estilizado tipo Fortnite~~ → **semi-realista tipo MetaPerson, no anime** (20/10). Posibles herramientas: Tripo o MCP de Blender |
| Plataformas | PC y celular |
| Público | ~~Comunidad / amigos~~ → público (ver "Visión y público") |
| Personalización | Dos capas: básica (ropa + rasgos) y avanzada (completa) |
| Hosting | Gratis (Cloudflare); local primero |
| AFK | No se expulsa por AFK; solo una etiqueta "AFK" debajo del nombre. Se sale al cerrar la pestaña |
| Cuentas | Invitado persistente o cuenta registrada; no pedir datos al recargar. El registro es con mail (ver "Registro") |
| Invitados (sin cuenta) | Solo para probar: miran, chatean **por texto**, se mueven y escuchan las voces públicas. No hablan por voz ni arman o entran a grupos, no dan me gusta ni corazones; sin objetos, intercambios, muro, galería ni sala propia. Sin verificar el mail por ahora |
| Cámara | Cambio 1ª/3ª persona con la rueda (sin botón en PC; en celular sí) |
| Teclas | E usar · P personaje · V (mantener) hablar · M silenciar música de la sala · Tab (mantener) jugadores/info · Esc menú con pestañas · I inventario · F amigos · Y Mapa · R gestos · C agacharse (Ctrl no: con Ctrl+W se cerraba la pestaña) |
| Stamina | Correr gasta stamina (barra visible) |
| Interactuar | E en cuadros: ficha + vista previa del sitio; E en jugadores: perfil con pestaña galería (estilo Second Life) |
| Objetos en el suelo | Otro jugador puede juntarlo a los 5 s; si nadie lo junta en 60 s, **se pierde para siempre** |
| Inventario | No frena al personaje; se puede arrastrar un objeto a la escena para soltarlo |
| Paneles que no frenan | Inventario, amigos (F), jugadores (Tab), gestos (R) y editor (P). En el editor la cámara es de vitrina hasta que te movés; ahí pasa a la normal |
| Gestos | Con comandos (/saludar, /aplaudir, /festejar, /señalar, /bailar) y con un menú en la R. El baile sigue hasta que te movés; el resto se hace una vez |
| Bailes | 10 bailes: /bailar = uno al azar, /bailar N = ese; en el menú de la R cada uno con su nombre |
| Aplaudir / festejar | Como no hay Clapping, se agregó /festejar (Cheering); aplaudir sigue hecho por código |
| Hablar | Con el micrófono abierto y quieto, el personaje usa la animación de hablar |
| Mutear / ignorar / restringir | Tres acciones distintas, solo para uno. Mutear = silenciar su voz. Ignorar = silenciar voz y texto en la sala. Restringir = que no aparezcan sus publicaciones (muro y fotos) |
| Reportar | Postergado: por ahora no hay botón (el código del servidor queda guardado) |
| Moderación | Dueño de cada sala personal; el usuario "xvvave" es admin del Museo y de todas las salas. Expulsar, banear, silenciar, traer, mandar a la entrada, habilitar/deshabilitar chat/voz/pantalla/objetos |
| Mapas | Botón "Mapa" (antes Mundi) + comandos en el chat (`/ir`, `/salas`) |
| Día y noche | Según la hora GMT-3 |
| Web3 | No por ahora |
| Editor de sala | Editor básico dentro del juego; cualquiera puede subir modelos si cumplen requisitos (requisitos a definir con el usuario) |
| Cuerpos | Tipos de cuerpo distintos (flaco, gordo, musculoso, atlético…), no solo ancho |
| Colores | ~~Selector RGB completo en vez de filas de muestras~~ → Básico: filas de muestras; Avanzado: selector RGB completo (23/10) |
| Contenido de usuarios | Primero modelos; gestos/scripts propios más adelante |
| Personaje | Modelo Quaternius para todos (se reemplaza el hecho por código, sin respaldo) |
| Tipo de cuerpo | Masculino / femenino; todo libre (cualquier cuerpo puede usar cualquier peinado y barba) |
| Peinados | corto, largo, rapado, rodete. Rulos → corto y coleta → rodete hasta que existan (sin preferencia del usuario; opción reversible) |
| Calidad gráfica | Siempre automática (sin selector): baja/media/alta según GPU, memoria y celular; si anda lento baja sola. KTX2 para celular más adelante (todavía no se instalan las herramientas) |
| Calidad baja: Museo (23/10) | Bordes redondeados más simples (2 segmentos en vez de 4: casi no se nota, ~40% menos triángulos) y el collage del baño a 512 px. Media y alta, sin cambios. El piso de cemento queda a 1024 px (a 512 se veía una trama) |
| Botones | PC: Gestos, Sala, Personaje y Ajustes arriba a la derecha; Inventario, Amigos y Mapa abajo a la derecha; Hablar y Audio debajo del chat. Celular: todo arriba con íconos (mochila, celular, mundo); Hablar y Audio arriba del chat |
| Red social: dónde | **Celular** (centro personal, desde cualquier sala) **y atril** (en cada sala personal). El Mapa queda aparte, fuera del celular |
| Celular | Inicio = Amigos (conectados primero) + buscador de gente. Apps: Notas (mías), Galería (mía), Avisos. Al abrirlo el personaje lo saca y los demás lo ven (también caminando) |
| Notas del dueño | Tipo Twitter: solo escribe el dueño; los visitantes solo leen (en el atril de su sala) |
| Atril | Libro abierto en la sala personal; E para leer las notas. Contador de corazones arriba |
| Corazones | Uno por visitante por sala (los invitados no dan corazones ni me gusta); cuentan para la sala y para el dueño. El dueño no se puede dar a sí mismo |
| Contador de corazones | Hoy en el atril. Con el editor, el dueño decide dónde va; también podría mostrarse en la red social o en un dashboard (idea, sin definir) |
| Galería del perfil | Subir y borrar fotos, hasta 30. Visibilidad la elige el dueño (todos / amigos / solo yo). No se cuelgan en la sala por defecto: el dueño decide qué objeto con imagen la muestra (llega con el editor) |
| Salas favoritas | Dentro del Mapa, con lista propia arriba; se puede marcar la sala actual |
| Avisos | Solo solicitudes de amistad (enviadas y aceptadas), en el celular |
| Agregar amigos | Desde el perfil (E sobre alguien) y desde el buscador del celular |
| Mi sala | En el Mapa: nombre, descripción y quién puede entrar (abierta / solo amigos / cerrada) |
| Salas de jugadores | Plantillas primero (loft, galería, club, depto, terraza…), caja editable después. Modo edición con muebles, colores y materiales |
| Paquete inicial | 15 objetos al azar entre muebles e indumentaria (cuando existan los muebles) |
| Sala de xvvave | La plantilla club, la misma que todo el mundo |
| Muro del celular | Reemplaza "Mis notas" (cuadro para escribir arriba). Muestra notas y fotos tuyas y de amigos; abajo "Destacados" con lo más nuevo del resto |
| Me gusta en el muro | Corazón en cada nota y cada foto (uno por persona, se puede sacar). No genera aviso |
| Fotos en el muro | Cada foto aparece solo para quien puede ver la galería de su dueño |
| Visión y público | Público, artistas de 20 a 40 años, +18. "Exposición artística digital gamificada" |
| Obras del Museo | Del público (el admin puede cargar algunas). Cada obra 24 h; postulaciones en cola con prioridad para usuarios |
| Salas | Todas distintas; solo el Museo (home de todos) es igual para todos |
| Economía | Sí. Fuentes: misiones/niveles y diseños subidos por artistas, que pasan a ser objetos intercambiables |
| Registro | Con mail (frena las cuentas múltiples; 3–4 por persona no rompen nada) y nickname único |
| Movimiento | Agacharse, sentarse y trepar se quedan (naturales). La stamina se recupera con **cualquier consumible** (trago, comida…) **o un gesto con consentimiento** (beso…): durante **2 minutos** la stamina no se gasta |
| Contenido | +18; no se modera el contenido en sí, pero hay mutear, ignorar y restringir; reportar queda para más adelante |
| Soltar objetos | Es la única forma de deshacerse de un objeto. Regalar = intercambio donde el otro no pone nada (ya funciona) |
| Cabinas y obras | No trepables (los parlantes sí) |
| Moderación del Museo | Ignorar/restringir + antiflood; no depende de que el admin esté conectado |
| Personajes | Mejorar con Blender + Tripo/Meshy (IA para objetos y decoración; cuerpos y ropa en Blender) |
| Base del personaje | **MakeHuman** (CC0, semi-realista, tipos de cuerpo como deformaciones de una sola malla). Descartados: Meshy como cuerpo (malla única con pelo y ropa, un modelo por cuerpo), Ready Player Me (cerró), VRoid (anime), MB-Lab (AGPL) |
| Blender: dónde | Con el MCP de Blender en la PC del usuario (no en la nube) |
| Tipos de cuerpo | Flaco, promedio, gordo y musculoso. Básico: esos 4 fijos. Avanzado: dos deslizadores libres, peso (flaco ↔ gordo) y músculo (poco ↔ mucho) |
| Contextura | Se saca del editor; las cuentas que la tenían quedan en "promedio" (el dato viejo se guarda sin usarse) |
| Exploradores | Más mapas públicos |
| Museo rotativo: lugares | Rotan los 9 cuadros y las 5 esculturas que ya hay; cada lugar rota por su cuenta cada 24 h. Mientras no haya obras del público, se ven las de ahora |
| Museo rotativo: cola vacía | Si no hay nadie esperando, la obra actual se queda otras 24 h |
| Museo rotativo: postular | Abierto: cualquiera postula. La cola tiene orden fijo (fecha de postulación, con prioridad para usuarios); verificar NO adelanta una obra, solo la deja lista para presentarse en su turno |
| Museo rotativo: verificación | Las obras sin verificar quedan en la cola hasta que alguien las verifique o deniegue (no vencen). Si le llega el turno a una sin verificar, se presenta la siguiente verificada y la otra conserva el primer lugar |
| Museo rotativo: votos | Verificar = 1 curador. Denegar = 2 curadores distintos; si no coinciden, decide un admin. Para denegar hay que elegir un motivo, que le llega al autor |
| Curadores | Título que se gana automáticamente por méritos (antigüedad, participación, reputación; los números se definen con la progresión). Revisan obras que les tocan **al azar** (no eligen ni ven la lista) y **nunca de sus amigos**. No pueden aprobar las propias (salvo que también sean Creadores). No bajan obras |
| Creadores | Título que se gana con **3 obras aceptadas seguidas** (un rechazo vuelve el contador a cero). Sus obras entran a la cola ya verificadas |
| Títulos: perderlos | Solo un admin quita el título de Creador o Curador, a mano |
| Bajar obras | Solo los admins pueden sacar una obra que ya entró (de la cola o del Museo) |
| Registro de curadores | Los admins ven quién verificó y quién denegó cada obra |
| Museo rotativo: por persona | Hasta 5 postulaciones en las últimas 24 h |
| Museo rotativo: dónde | Se postula (y los curadores revisan) en el **atril de la entrada del Museo** |
| Museo rotativo: ficha | Ficha completa: título (obligatorio), descripción, técnica, año y un link |
| Museo rotativo: invitados | No pueden postular (tienen que crear cuenta) |
| Museo rotativo: avisos | Al autor le llegan avisos al celular: verificada, denegada (con motivo), expuesta, título de Creador |
| Museo rotativo: motivos | No es obra propia / plagio · No cumple las condiciones de uso · Archivo con problemas · Spam o repetida · Otro (con texto) |
| Museo rotativo: fila | En "Mis obras" cada obra en espera muestra su puesto en la fila y una fecha estimada (aproximada) |
| Museo rotativo: saltear | El curador puede pedir "Otra" si no quiere revisar la que le tocó |
| Curadores: nombrar | Un admin escribe en el chat `/curador nick` (y `/creador nick`); el mismo comando lo quita |
| Museo rotativo: archivos | Se guardan en Cloudflare R2. Cuadros: hasta 2048 px (se ven a 1024 en la pared). Modelos: GLB hasta 2 MB, 10.000 triángulos, texturas de 1K y 3 m de alto |
| Curadores: arranque | Mientras no haya curadores, verifican los admins; además el admin puede nombrar curadores fundadores a mano |
| Curadores: requisitos | Nivel + participación (propuesta a ajustar: nivel 10+ y haber visto 50 obras distintas del Museo) |
| Curaduría: enfoque | Se mantiene como está (23/10). Primero se prueba que el título de Curador se gane solo, con un mínimo de actividad específica |
| Museo rotativo: escasez | Sin cambios por ahora (todavía no hay tanta gente). Que una persona ocupe varios lugares el mismo día está bien: da coherencia temática |
| Balcón: barandas | El vidrio del balcón se salta: pegado al vidrio y mirándolo, Espacio. Animación hecha por código (salto de costado apoyando una mano); al caer, aterrizaje normal. El salto común ya no lo pasa |
| Objetos del piso: alcance | Se sueltan y se juntan hasta 3 m (como la E). Si se arrastra más lejos, cae a 3 m en esa dirección. El servidor lo controla |
| Mensajes entre amigos | Chat 1 a 1 en la app **Mensajes** del celular, con historial (los últimos 50 por conversación). Si el amigo está desconectado, le queda guardado. Aviso en pantalla con "Responder" y contador en el botón Amigos. En el chat se ve dónde está y un botón **Ir allá** |
| Mensajes: límites | Solo entre amigos; hasta 200 caracteres; mismo antiflood que el chat de la sala. Si te ignoró o te restringió, no le llega (y no se entera) |
| Escaleras: costados | El vidrio de la escalera es barrera: no se atraviesa ni se salta |
| Progresión | Niveles por puntos (**privados**, solo los ve uno) + insignias por logros (**públicas**, se ven en el perfil) |
| Progresión: qué suma | Descubrir (ver obras, visitar salas), exponer (obras aceptadas), curar (verificar/denegar) y asistir a eventos (sets de DJ, inauguraciones, pasar música o luces). Cada cosa da puntos **una sola vez** (la misma obra o sala no suma dos veces) |
| Me gusta y progresión | Los me gusta son solo sociales: **no dan puntos** (para que no se farmee). Puede haber una insignia por recibir cierta cantidad |
| Misiones | Un camino fijo para empezar + misiones diarias |
| Recompensas | Niveles y misiones dan **objetos** (sin moneda). La progresión se hace **después del editor de salas**, cuando ya haya muebles para dar |
| Editor: plantillas | Para arrancar: loft, galería, club y terraza (después se suman más) |
| Editor: quién | Solo el dueño de la sala |
| Editor: qué ven los visitantes | Los cambios aparecen al soltar el click (no se ve el trayecto mientras arrastrás). Con Esc se cancela y el objeto vuelve a su lugar |
| Editor: máximo | 100 objetos por sala |
| Editor: muebles | Catálogo libre de muebles básicos para todos; los especiales salen del inventario (y vuelven si los levantás) |
| Editor: cambiar de plantilla | Se puede; los muebles especiales puestos vuelven al inventario |
| Editor: visitantes | Pueden usar los muebles (sentarse, ver cuadros con E), no moverlos |
| Diseños: qué | Estampas para ropa, cuadros y objetos 3D |
| Diseños: copias | El artista puede regalar copias ilimitadas; los demás las intercambian |
| Diseños: verificación | Nadie verifica el contenido; solo un control automático de que funcione en el juego |
| Diseños: reglas 3D | GLB, hasta 2 MB, hasta 10.000 triángulos, texturas hasta 1K, máximo 3 m de alto (se pueden ajustar) |
| Diseños: imágenes | Estampas a 1024 px. Cuadros y obras del Museo: 1024 px en la pared y hasta 2048 px (HD) al abrir la ficha con E |
| Diseños: crédito | "Diseño de X" solo en el inventario |
| Diseñadores | Título que se gana al subir 3 modelos que pasen el control automático. Solo reconocimiento (no da poderes). No se pierde |
| Orden del plan | El editor de salas va **antes** que la progresión (las recompensas necesitan muebles) |
| Eventos | Cualquier set de DJ o show de la consola, en cualquier sala, con **más de 5 personas** presentes. Cuenta haber estado **5 minutos** (aunque estés AFK) |
| Voz: servidor | Servidor de audio (Cloudflare Realtime SFU) para que nadie vea la IP de otro |
| Voz: a quién escuchás | Los 4 más cercanos **que estén hablando**, dentro de 10 m. Si uno se calla, entra el siguiente |
| Voz: grupos | Se invita con E desde el perfil. Hasta 4 personas. Solo en la misma sala (si alguien se va, deja de escucharse) |
| Voz: en grupo | Privado: solo te escucha el grupo y solo escuchás al grupo. La música del DJ y el audio de la sala siguen (eso se maneja con la M) |
| Voz: quién maneja el grupo | El que lo creó: solo él invita y puede sacar a alguien; si se va, pasa al siguiente |
| Voz: se ve | Los del grupo ven una marca sobre sus compañeros, y todos ven "En grupo" debajo del nombre |
| Voz: invitaciones (anti-acoso) | Bloqueo creciente al rechazar: 1º rechazo, no te puede reinvitar por 1 min; 2º, 10 min; 3º, hasta mañana. No se le avisa que lo rechazaste. Alguien ignorado o restringido no te puede invitar (y no se entera) |
| Invitados: cómo se ve lo bloqueado | Las opciones se ven igual, con un candado 🔒; al tocarlas aparece "Para … tenés que crear una cuenta (es gratis)" con un botón "Crear cuenta" |
| Voz: grupo | Suena como una llamada (sin distancia ni dirección). La invitación sin respuesta vence al minuto y no cuenta como rechazo. Quien está en un grupo figura "En grupo" y no se lo puede invitar a otro hasta que salga |
| Ingreso | Mail + contraseña, **Google** y **Discord** (Facebook no). Después de entrar con Google/Discord se elige el nickname único. Mismo mail confirmado por Google/Discord = la misma cuenta |
| Progresión: orden con el editor | Se hace la base ahora (puntos, niveles, insignias, misiones, interfaz) y las recompensas quedan como datos que apuntan a ids de objetos; los muebles se conectan al juntar el editor |
| Objetos: rareza | Tres rarezas: **básico / raro / exótico** (gris / azul / dorado en el inventario). Las recompensas salen al azar dentro de una rareza |
| Progresión: puntos | Ver una obra del público 10 · visitar una sala nueva 5 · que te expongan una obra 100 · curar (verificar o denegar) 15 · asistir a un evento 50 · cada paso del camino inicial 20. Cada cosa una sola vez |
| Progresión: niveles | Nivel N desde 25·N·(N−1) puntos (nivel 2 = 50, 5 = 500, 10 = 2.250, 20 = 9.500). Sin tope |
| Progresión: ver obras (anti-farmeo) | Suma solo si la obra está **expuesta ahora** y estás conectado **en el Museo** (lo controla el servidor) |
| Progresión: qué obras cuentan | Solo las del **público** (las de base del Museo no dan puntos) |
| Progresión: exponer | Suma el día que la obra **entra a una pared** del Museo |
| Curadores: requisitos (definido) | **Nivel 8 + 30 obras del público vistas**. Se da solo, con aviso al celular |
| Insignias | Con escalones bronce / plata / oro: Explorador (obras vistas 10/50/200) · Trotamundos (salas 5/20/50) · Artista (obras expuestas 1/5/20) · Ojo crítico (obras curadas 10/50/200) · Fiestero (eventos 3/15/50) · Querido (me gusta recibidos 25/100/500). Aparte, Curador y Creador. En el perfil se ve el escalón más alto de cada una |
| Camino inicial | En orden: ver una obra con E · visitar otra sala · hacer un gesto · agregar un amigo · publicar en el muro · postular una obra · asistir a un evento. Cada paso da un objeto básico y 20 puntos; terminarlo da uno raro |
| Misiones diarias | 3 al azar por día (00:00 GMT-3): ver 3 obras · visitar 2 salas · dar 3 me gusta · dejar un corazón · escribir en el muro · hacer 2 gestos · estar en un evento · curar 1 obra (solo curadores). Cada una da un objeto básico; las 3 juntas, 25% de chance de uno raro. Las diarias no dan puntos de nivel |
| Recompensas por nivel | Objeto básico en cada nivel; raro cada 5 (5, 15, 25…); exótico cada 10 (10, 20…) |
| Eventos: cómo cuenta | Estar al menos 5 minutos en la sala mientras el DJ pasa música (o hay show en la consola), aunque estés AFK. Cada set es un evento |
| Progresión: salas que cuentan | Las salas de otros (ni la propia ni el Museo) |
| Progresión: dónde se ve | App **Progreso** en el celular + **barrita de nivel** chica en pantalla (junto al nombre de la sala) |
| Editor: plantilla club | Un club nuevo y más chico: la parte de la pista (sin hall ni 2º piso). Luces y parlantes básicos por defecto. La cabina, los sillones, los parlantes y las pantallas son muebles que se pueden mover o cambiar |
| Editor: pantallas | Mueble "Pantalla", hasta 2 por sala, tamaño a elección, en cualquier pared o donde se quiera. Cada una la toma su propio VJ o repite el video de la otra (lo elige el dueño) |
| Editor: equipo de DJ | Cabina de DJ, consola de artistas, parlantes y pantallas se pueden poner en cualquier plantilla (una cabina y una consola por sala) |
| Editor: herramientas | Mover, rotar y cambiar color (RGB libre). Encastre a grilla de 25 cm y giros de 15° (con una tecla para moverlo libre). Sin escalar (salvo el tamaño de las pantallas) |
| Editor: celular | Tocar y arrastrar: tocás un mueble, lo arrastrás por el piso y aparecen botones grandes (rotar, color, guardar, listo) |
| Editor: fotos colgadas | Mueble básico "Cuadro" con una foto de tu galería elegida por el dueño; con E se abre la ficha. Solo fotos visibles para todos |
| Editor: modelos | Muebles hechos por código para arrancar; después se reemplazan por un pack (a aprobar) sin tocar las salas guardadas |
| Editor: salas existentes | La primera vez que el dueño entra a su sala elige la plantilla; hasta entonces se ve el loft |
| Editor: catálogo básico | Living (sillón de 3, sillón individual, puf, mesa ratona, alfombra), comedor/bar (mesa, silla, banqueta alta, barra chica), arte (cuadro, pedestal, atril, cartel de neón), deco y luz (planta, lámpara de pie, estante, cama, panel) |
| Editor: atril | Opcional: es un mueble más. Sin atril, los visitantes no ven las notas ni dan corazones |
| Editor: tamaño de las plantillas | Chicas, alrededor de 12 × 10 m |
| Editor: superponer | Los muebles se pueden superponer; solo no se pueden sacar de la sala |
| Editor: especiales de ejemplo | Trono dorado, bola de espejos, sillón de terciopelo con neón y escultura de neón |
| Paquete inicial (activado) | Las cuentas nuevas reciben 15 objetos al azar entre prendas y muebles especiales |
| Editor: cambiar de plantilla (muebles básicos) | Se borran (con confirmación); arrancás con lo que trae la plantilla nueva |
| Ingreso: mail sin confirmar (24/10) | Si alguien entra con Google/Discord a una cuenta con contraseña cuyo mail nunca se confirmó, **manda Google**: la contraseña deja de valer y se cierran las otras sesiones (evita que otro registre tu mail antes que vos) |
| Frenos por IP (24/10) | Hasta 10 contraseñas mal cada 15 min por cuenta + IP ("Demasiados intentos. Probá de nuevo en unos minutos"). Hasta 20 invitados/cuentas nuevas por IP por hora |
| Invitados: cabina y consola (24/10) | No pasan música ni toman luces o pantallas: candado y "Para pasar música tenés que crear una cuenta" |
| Una sola conexión por cuenta (24/10) | Como WhatsApp Web: la pestaña nueva manda (aunque sea en otra sala u otro dispositivo); la vieja muestra "Abriste el juego en otra pestaña" con "Usar aquí" |
| Muro: notas (24/10) | Hasta 20 notas por hora por persona |
| Amistad rechazada (24/10) | No se le vuelve a mandar solicitud a esa persona por 24 h ("Ya le mandaste una solicitud hace poco. Probá de nuevo mañana."). El que rechazó sí puede mandarla |
| Intercambios e ignorados (24/10) | Alguien ignorado o restringido no te puede invitar a intercambiar (no se entera, como con los grupos) |
| Rareza de los muebles especiales | Provisoria, para probar los porcentajes: trono dorado = exótico; bola de espejos y sillón con neón = raro; escultura de neón = básico. Las prendas quedan como están (cadena raro, corona exótico, el resto básico) |
| Modelos 3D de usuarios | Mismas reglas que los diseños de artistas: GLB, hasta 2 MB, 10.000 triángulos, texturas 1K, máximo 3 m, sin scripts; control automático, sin revisar el contenido |
| Consumibles: cuáles | Para empezar: trago y café |
| Consumibles: cómo se consiguen | En la barra del hall (E, sin límite), como recompensa de misiones y niveles (van al inventario), regalándolos o intercambiándolos, y con muebles especiales que el dueño pone en su sala y dan consumibles a los visitantes |
| Consumibles: efecto | 2 minutos sin gastar stamina. Mientras el efecto está activo no se puede tomar otro |
| Beso | E sobre alguien → "Beso": al otro le llega el pedido con Aceptar / Rechazar. Si acepta, los dos hacen el gesto y los dos reciben el efecto de stamina. Rechazar usa el mismo bloqueo creciente que las invitaciones a grupos |
| Cuerpo: base MakeHuman (24/10) | Peso y músculo se combinan como en MakeHuman (mucho peso + poco músculo = gordo; mucho peso + mucho músculo = grande). Tipos del básico: **flaco** = peso 0 y músculo 0; **promedio** = 0,5 y 0,5; **gordo** = peso 1 y músculo 0; **musculoso** = peso 0,75 y músculo 1 |
| Peinados MakeHuman (24/10) | corto = short01 (prolijo), largo = long01, rapado = short04, rulos = afro01, coleta = ponytail01. Nuevos: **trenza** (braid01), **bob** (bob02) y **corto con flequillo** (short03). El rodete sale: las cuentas que lo tenían se ven con trenza |
| Barba (24/10) | Se mantiene el interruptor sí/no; al activarlo aparece un selector: **tupida, completa corta, candado o bigote** (por defecto completa corta). Las cuentas que ya tenían barba quedan con completa corta |
| Ropa con volumen (24/10) | Prendas reales (MakeHuman, CC0) en vez de pintadas. **Arriba**: remera, manga larga, camisa, campera. **Abajo**: jean, short, calza, pollera. **Pies**: zapatillas (blancas), botas, zapatos. Se tiñen con el color elegido pero conservan su dibujo (logo, rayas, desgaste). Todo libre: cualquier cuerpo usa cualquier prenda |
| Botas y medias (24/10) | Botas: las botas cortas del pack Shoes 01 (CC0). Las medias que traen zapatillas y zapatos quedan siempre blancas; el calzado toma el color elegido |
| Editor de personaje: Básico y Avanzado (24/10) | ~~Básico con un estilo de ropa ya armado~~ → ver la fila siguiente |
| Editor de personaje: Básico y Avanzado (24/10, reemplaza la anterior) | **Básico**: **una sola fila por cosa**. Cuerpo y tipo de cuerpo; piel; peinados principales y color de pelo; barba; ropa como antes por tipo (arriba: remera, manga larga, camisa, campera · abajo: jean, short, calza, pollera · calzado: zapatillas, botas, zapatos), cada una con **una fila de colores predefinidos cuyo último botón abre el selector RGB**. **Sin color de ojos** en el básico (sí tendría sentido forma de la cara o tipo de ojos, más adelante). **Avanzado**: todos los tipos que existan (todos los peinados, barbas y prendas), color de ojos, más colores y RGB en todo, deslizadores de peso/músculo/altura. **Preparado para sumar**: cada modelo nuevo que se haga en Blender (otros tipos de remera, de zapatillas, etc.) aparece solo en el avanzado. Las **mechas** serían otro peinado (un modelo más) |
| Más peinados (24/10) | Se suma el pack Hair 01 de MakeHuman (CC0) |
| Peinados de Hair 01 (24/10) | Se suman 24 (todos los del pack menos el corto rosa con volumen y el anime, por pesados) + short02 del sistema. Hay un rodete de verdad: las cuentas que tenían "rodete" lo vuelven a ver. Básico: los 6 principales; Avanzado: los 32 |
| Recompensas con muebles (24/10) | Los premios de niveles y misiones salen al azar de la rareza que toca entre accesorios **y** muebles especiales, todo junto. Se pueden repetir (sirven para regalar o intercambiar) |
| Inventario en pestañas (24/10) | **Mochila** (ropa, accesorios y, cuando existan, consumibles) y **Mobiliario** (muebles especiales: se pueden soltar e intercambiar como los demás) |
| Tecla G (24/10) | Abre y cierra "Editar sala" (en tu sala) |
| Consumibles: barra y muebles (24/10) | En la barra del hall, E → dos botones "Trago" / "Café" y te lo tomás en el momento. Muebles especiales nuevos que reparten (se toma en el momento): **barra de tragos** y **minibar** (trago), **cafetera** (café); los tres **raros**. Al tomar, el personaje sostiene el vaso/taza y hace el gesto (los demás lo ven) |
| Beso: detalles (24/10) | Hay que estar a menos de 1,5 m. Ignorados y restringidos no pueden pedirlo (no se enteran). Se ve: los dos se acercan, se inclinan y se dan un beso corto (sin abrazo) |
| Cartel AFK (24/10) | Aparece a los **5 minutos** sin tocar nada (también si cambiaste de pestaña) |
| Sonido de la pista del museo (24/10) | Se suman **line arrays colgados** (música principal izq./der.), **subs de piso** (solo graves), **tweeters/frontfill** en el borde del escenario y **surround** en el fondo y costados de la pista. Todos suenan de verdad. Los de piso (subs, surround) se pueden trepar; los colgados no |
