# Estado del proyecto (24/10/2026)

Resumen para retomar el trabajo en otra sesión. Leé antes [CLAUDE.md](../CLAUDE.md) (reglas de trabajo,
stack, cómo probar) y [ROADMAP.md](ROADMAP.md) (todas las decisiones de diseño, una por fila).

> **Regla principal:** cada comportamiento de diseño se consulta con el usuario por separado antes de
> implementarlo, y cada decisión nueva se anota en ROADMAP.md → "Decisiones de diseño".

## Qué es

"Galería Online" (nombre provisorio): **exposición artística digital gamificada**, pública, para
artistas de 20 a 40 años (+18). Mundo 3D en el navegador (Three.js + Vite) con servidor en Cloudflare
Workers + Durable Objects. Todo se trabaja sobre `main` (no hay otras ramas).

## Qué se hizo (sesiones del 20 al 24/10)

### Base para abrir al público (paso 1 del plan): ✅ terminado
- **Cuentas:** registro con mail + nickname único (se entra con cualquiera de los dos), y ahora también
  **con Google o Discord** (mismo mail confirmado = misma cuenta; si es nueva, elige nickname y acepta +18).
- **Invitados** (sin cuenta): miran, chatean por texto y escuchan voces públicas. No hablan, no arman ni
  entran a grupos, no dan me gusta ni corazones, sin objetos, intercambios, muro, galería ni sala propia.
  Esas opciones se ven con candado 🔒 y al tocarlas avisan "Para … tenés que crear una cuenta" con un botón.
- **Voz por Cloudflare Realtime (SFU):** nadie ve la IP de otro. Escuchás a los 4 más cercanos que hablan
  dentro de 10 m (audio 3D). La música del DJ y la pantalla del escenario también pasan por ahí.
- **Grupos de voz privados:** hasta 4, se invita con E → "Invitar al grupo"; solo se escuchan entre ellos
  (como una llamada); la música del DJ sigue. Todos ven "En grupo"; los compañeros ven "◆ Tu grupo".
  Lo maneja quien lo armó (invita y saca). Panel del grupo en Tab.
- **Anti-acoso en invitaciones:** si rechazás, esa persona no te puede reinvitar por 1 min, después 10 min,
  después hasta mañana (sin avisarle). Ignorados y restringidos no te pueden invitar.
- **Cuidarse:** mutear (voz), ignorar (voz + texto, guardado en la cuenta) y restringir (no ver sus
  publicaciones). Reportar quedó postergado (el servidor tiene el código, sin botón).
- **Antiflood** del chat, **condiciones de uso y aviso +18**, obras y cabinas **no pisables**.

### Museo rotativo (paso 2): ✅ terminado (23/10)
Obras del público (cuadros y modelos 3D) que rotan cada 24 h en los 9 cuadros y 5 esculturas del Museo.
Se postula en el atril de la entrada; curadores verifican (1) o deniegan (2, con motivo), un admin decide
los desacuerdos y baja obras; Creadores (3 aceptadas seguidas) entran sin verificar. Archivos en R2.
Código: `server/works.js`, `src/ui/works.js`, lugares en `src/world/museum.js` (`works`).

### Trabajo en paralelo (23/10): 4 agentes, juntados en main
Cada rama dejó su nota en `docs/ramas/` (qué hizo, archivos, protocolo, migraciones).
- **Editor de salas** (paso 3): ✅ salas personales con plantilla (loft, galería, club, terraza), muebles
  básicos y especiales, editor desde arriba (PC y celular), fotos como cuadros, hasta 2 pantallas.
  `src/world/{rooms,templates,furniture,editor,stage2}.js`, `server/editor.js`.
- **Progresión** (paso 4): ✅ puntos y niveles privados, insignias, camino inicial, misiones diarias,
  Curador automático (nivel 8 + 30 obras vistas). `server/progress.js`, `src/ui/progress.js`.
- **Personaje**: tipos de cuerpo (flaco, promedio, gordo, musculoso), peso/músculo y selector RGB. Base
  elegida: **MakeHuman** (CC0), que se arma en Blender en la PC del usuario (`docs/ramas/personaje-blender.md`).
- **Rendimiento**: piezas quietas del Museo juntas (menos de la mitad de draw calls), `src/loaders.js`
  (Draco/meshopt/KTX2), TURN opcional para la voz, `scripts/medir.mjs`. Lo más pesado que queda: las
  animaciones del personaje (13 MB de 17 MB).

### Antes de eso (ya estaba)
Museo con DJ (música desde la PC), consola de artistas (luces por OSC y visuales), red social en el
celular del personaje (amigos, muro, galería, avisos), atril con notas y corazones, salas personales con
privacidad, favoritas, personaje con animaciones de Mixamo, inventario e intercambios.

### Diseño definido (sin programar todavía)
- **Diseños de artistas:** estampas, cuadros y modelos 3D; control automático (no de contenido);
  copias ilimitadas para regalar; título Diseñador (solo reconocimiento).
- **Stamina:** cualquier consumible o gesto con consentimiento → 2 minutos sin gastar.

## Qué falta

### Online ✅ (24/10)
Publicado en **https://galeria-online.latta-romero.workers.dev**: R2 y bucket creados, las 3 claves
cargadas, ingreso con Google y Discord probado por el usuario (mismo mail = misma cuenta), app de Google
publicada (páginas `/privacidad` y `/condiciones`), y xvvave admin online (`22b06bd4aaf200c7` en `ADMIN_IDS`).
Para volver a subir: `npm run deploy` desde la carpeta del proyecto.

### Para el usuario
- **Probar la voz con personas reales** (se probó con un tono generado) y la pantalla del escenario (VJ).
- **TURN (opcional, voz en redes cerradas):** `npx wrangler secret put TURN_KEY_ID` y `TURN_KEY_API_TOKEN`
  (Cloudflare → Realtime → TURN). Revisar antes cómo se cobra.
- **Nombrar curadores fundadores** con `/curador nick` en el chat (mientras tanto verifican los admins).

### Personaje y ropa (24/10, sesión en la PC del usuario con el MCP de Blender)
- ✅ **Personaje MakeHuman** (online): cuerpos masc/fem con 8 formas de peso y músculo (bilineal, como
  MakeHuman), 8 peinados (corto, flequillo, largo, rapado, rulos, coleta, trenza, bob; rodete → trenza) y
  barba con tipo (completa corta, tupida, candado, bigote). Quaternius borrado del repo.
- ✅ **Ropa con volumen** (online): 11 prendas (arriba: remera, manga
  larga, camisa, campera; abajo: jean, short, calza, pollera; pies: zapatillas, botas, zapatos), teñidas
  conservando el dibujo, piel tapada escondida (`_cover`/`uHide`), medias siempre blancas.
- Todo se genera en Blender con `assets-src/makehuman/build.py` + `export.py` (`GENDER = 'masc'|'fem'`); los
  `.blend` de trabajo también están ahí. **Solo se puede regenerar en la PC del usuario** (Blender + MPFB 2 +
  MCP de Blender; `.mcp.json` local, fuera de git). Packs instalados en MPFB: sistema, Bodyparts 05, Shoes 01.
- ✅ **Hair 01**: 24 peinados sumados (32 en total en el avanzado).
- ✅ **Manos de primera persona reales** (online): antebrazo y mano del propio cuerpo + la manga (`src/player/fpArms.js`).
- ✅ **Editor Básico / Avanzado** (online, `src/app/cuenta.js`): Básico = una fila por cosa (6 peinados principales
  en `BASIC_HAIR`, 5 colores + botón "+" que abre el RGB); Avanzado = todo lo de `LOOK_OPTIONS` (lo nuevo aparece
  solo), barba con tipo, color de ojos, paletas completas + RGB, peso, músculo y altura.
- ✅ **Seguridad** (rama `agente/seguridad` juntada en `main` y online): 22 arreglos, `npm test` (54 pruebas),
  `scripts/humo.mjs`, `main.js` partido en `src/app/`. Ver `docs/ramas/seguridad.md`. Ojo: solo se entra al
  Museo o a salas `u-<id>` (las salas de prueba con otros nombres dan 404).

### Para programar, en este orden
1. ✅ **Peinados de Hair 01** (necesita la PC del usuario con Blender): instalar el pack, mostrarle los 24 y sumar
   los elegidos a `HAIRS` en `build.py`, a `HAIR_STYLES` (shared.js) y `LOOK_OPTIONS` (avatar.js).
2. ✅ **Accesorios** ajustados al cuerpo nuevo (`BODIES` en avatar.js; página de prueba local `devtest/avatar.html?body=fem&equip=cap,chain`, no se sube).
3. ✅ **Recompensas con muebles**: accesorios y muebles especiales juntos, con repetidos.
4. ✅ **Consumibles y beso**: barra del hall (E → Trago/Café), muebles que reparten (barra de tragos, minibar,
   cafetera), consumibles en la Mochila, beso con pedido y aceptar. Servidor: `consumeMessage`/`kissMessage` en
   `room.js`; gestos `drink`/`kiss` en avatar.js. Falta probarlo con dos personas reales.
5. ✅ **Sonido de la pista del museo**: 14 fuentes (`world.dj.sources` en museum.js; `buildMusic` en rtc.js con
   filtros por banda). Line arrays (HRTF), subs (graves, mono por lado), frontfill (agudos), surround en columnas y
   de piso; las torres de siempre quedaron como monitores bajitos. Volúmenes calculados, no escuchados con el SFU.
6. ✅ **Repaso de modelos y animaciones** (24–25/10): arreglados agachado (en cuclillas), aplaudir, bailes que se
   iban de lugar, beso (se acercan a 55 cm), DJ (manos en la consola), sillones (contra el respaldo), pose T al
   aparecer, corona/metales, anteojos, cadena y medias con calza. Revisado y bien: caminar, trotar, correr, saltar,
   trepar, baranda, sentado, gestos, celular, tomar, hablar, ropa en los dos cuerpos, muebles, 1ª persona.
   Herramientas locales: `devtest/avatar.html` (`__cap`) y `devtest/muebles.html`. Queda: la camisa asoma un poco
   entre el pelo largo en la espalda (difícil sin tocar los modelos).
7. **Diseños de artistas como objetos** y más mapas públicos (paso 5).
8. **Seguridad, lo que quedó para decidir** (ver `docs/ramas/seguridad.md`): teletransporte (posiciones falsas)
   y vencimiento de sesiones.
9. ✅ Animaciones achicadas: paquete JSON (`npm run empaquetar`), al entrar baja ~0,7 MB en vez de ~13 MB.
10. **Primera prueba con gente real** (inauguración con 5–10 artistas).

### Dudas para el usuario (juntadas durante el trabajo)
- Sonido: las dos torres del escenario siguen sonando bajito como monitores (¿o solo decorado?). Los frontfill
  (0,18 m) no tienen collider: se atraviesan caminando por el escenario.
- Beso: hoy los invitados pueden pedir y aceptar besos (el servidor no los frena). ¿Lo pueden hacer o va con candado?

### Pendientes sueltos (consultar antes)
Reportar, nombre y marca definitivos, AR, ajustes de cara en el avanzado.

## Cómo probar

- `npm run dev` → http://localhost:5173 (servidor de salas en el 8787). Necesita `.dev.vars` con las claves.
- Dos jugadores en la misma PC: una pestaña en `localhost:5173` y otra en `127.0.0.1:5173` (cada una
  guarda su propia sesión). En desarrollo existe `window.__game` para inspeccionar.
- Si la pestaña está en segundo plano, el bucle del juego no corre (la elección de voces tampoco):
  para probar a mano, llamar `__game.rtc.updateVoices(...)`.
- Ojo con servidores viejos: si otro `npm run dev` ya ocupa el 8787, la página nueva habla con el viejo.
