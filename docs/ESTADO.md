# Estado del proyecto (23/10/2026)

Resumen para retomar el trabajo en otra sesión. Leé antes [CLAUDE.md](../CLAUDE.md) (reglas de trabajo,
stack, cómo probar) y [ROADMAP.md](ROADMAP.md) (todas las decisiones de diseño, una por fila).

> **Regla principal:** cada comportamiento de diseño se consulta con el usuario por separado antes de
> implementarlo, y cada decisión nueva se anota en ROADMAP.md → "Decisiones de diseño".

## Qué es

"Galería Online" (nombre provisorio): **exposición artística digital gamificada**, pública, para
artistas de 20 a 40 años (+18). Mundo 3D en el navegador (Three.js + Vite) con servidor en Cloudflare
Workers + Durable Objects. Todo se trabaja sobre `main` (no hay otras ramas).

## Qué se hizo (sesiones del 20 al 23/10)

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
privacidad, favoritas, personaje Quaternius con animaciones de Mixamo, inventario e intercambios.

### Diseño definido (sin programar todavía)
- **Diseños de artistas:** estampas, cuadros y modelos 3D; control automático (no de contenido);
  copias ilimitadas para regalar; título Diseñador (solo reconocimiento).
- **Stamina:** cualquier consumible o gesto con consentimiento → 2 minutos sin gastar.

## Qué falta

### Para el usuario
- **Probar el ingreso con Google y con Discord** con una cuenta real (no se pudo probar sin iniciar sesión).
- **Probar la voz con personas reales** (se probó con un tono generado) y la pantalla del escenario (VJ).
- **Registrar la cuenta xvvave** si todavía es de invitado (Personaje → Crear cuenta): conserva id y admin.
- **Para subirlo online:** cargar las 3 claves con `wrangler secret put` (ver README → "Subirlo online")
  y agregar la dirección de vuelta online en Google Cloud y en Discord. Para el Museo rotativo: activar
  R2 en Cloudflare (pide tarjeta, tiene capa gratis) y `npx wrangler r2 bucket create galeria-obras`.
- **TURN (opcional, voz en redes cerradas):** `npx wrangler secret put TURN_KEY_ID` y `TURN_KEY_API_TOKEN`
  (Cloudflare → Realtime → TURN). Revisar antes cómo se cobra.
- **Nombrar curadores fundadores** con `/curador nick` en el chat (mientras tanto verifican los admins).

### Para programar, en este orden
1. **Conectar recompensas con muebles:** que la progresión también dé muebles especiales (falta definir
   la rareza de cada uno; ver `docs/ramas/progresion.md` → "Pendiente para conectar con el editor").
2. **Personaje MakeHuman:** cuando lleguen los `.glb` de Blender, apuntar `avatar.js` a ellos (ver
   `docs/ramas/personaje.md`). Y achicar las animaciones (ual.glb y FBX) para celular.
3. **Diseños de artistas como objetos** y más mapas públicos (paso 5).
4. **Revisión de permisos del servidor y pruebas automáticas** (cuando se junten las ramas de los agentes):
   revisar que cada acción (intercambios, moderación, Museo, grupos) valide quién, qué y dónde, como ya
   se hizo con soltar/juntar objetos; pruebas con dos clientes, desconexión, reconexión y acciones a la
   vez; y partir `src/main.js` en módulos.
5. **Primera prueba con gente real:** inauguración con 5–10 artistas exponiendo.

### Pendientes sueltos (consultar antes)
Más ropa/peinados/cejas, stamina con consumibles (falta cómo se consigue
cada uno), reportar, nombre y marca definitivos, AR.

## Cómo probar

- `npm run dev` → http://localhost:5173 (servidor de salas en el 8787). Necesita `.dev.vars` con las claves.
- Dos jugadores en la misma PC: una pestaña en `localhost:5173` y otra en `127.0.0.1:5173` (cada una
  guarda su propia sesión). En desarrollo existe `window.__game` para inspeccionar.
- Si la pestaña está en segundo plano, el bucle del juego no corre (la elección de voces tampoco):
  para probar a mano, llamar `__game.rtc.updateVoices(...)`.
- Ojo con servidores viejos: si otro `npm run dev` ya ocupa el 8787, la página nueva habla con el viejo.
