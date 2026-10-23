# Rama `agente/rendimiento`: celulares y conexión

Nota para el master (y para retomar). Todo está probado en el navegador (Chromium con SwiftShader,
pantalla de celular 412×915, red "4G" emulada a 9 Mbps / 60 ms).

## Mediciones

Con `scripts/medir.mjs` (ver "Cómo medir"). Draw calls y triángulos en dos vistas fijas: la entrada
mirando al hall y la pista mirando al escenario.

| Calidad | Qué | Antes | Después |
|---|---|---|---|
| baja | Draw calls (hall / pista) | 221 / 61 | **116 / 42** |
| baja | Triángulos (hall / pista) | 121k / 38k | **103k / 33k** |
| baja | Memoria de texturas (estimada, con el personaje) | 92 MB | **72 MB** |
| media | Draw calls (hall / pista) | 221 / 60 | **126 / 44** |
| alta | Draw calls con sombras (hall / pista) | 532 / 371 | **225 / 132** |
| todas | Descarga al entrar (producción) | 17,2 MB | 17,2 MB (sin cambio, ver abajo) |
| todas | JS inicial (gzip) | 263 KB | 266 KB |
| todas | Carga con 4G emulada | ~24 s | ~22 s |

Los cuadros por segundo no sirven acá (la placa es por software); lo que importa en celulares es
la cantidad de draw calls y de triángulos, que es lo que bajó.

### Lo más pesado de la descarga NO es del mundo
De los 17,2 MB que se bajan al entrar, **13,2 MB son del personaje** (zona del agente de Personaje,
no se tocó): `public/models/anims/ual.glb` (7,3 MB, la biblioteca de animaciones entera),
los FBX de Mixamo (`quieto_masc.fbx` 2,2 MB y otros), y texturas PNG de 1K del cuerpo y el pelo
(3,7 MB). El Museo no baja archivos: se arma por código (texturas en canvas).
**Es la mejora más grande que queda para celulares:** sacar de ual.glb solo los clips que se usan,
pasar los FBX a un .glb con meshopt, y las texturas a KTX2/WebP. El módulo `src/loaders.js` ya
entiende todo eso (ver abajo), solo falta que el personaje lo use.

## Qué se hizo

1. **Piezas quietas del Museo juntas** (`src/world/merge.js`, se llama al final de `buildMuseum`).
   Las mallas que no se mueven y comparten material se juntan en una por zona (16 m). Mismo aspecto:
   comparé capturas antes/después en baja y alta, difieren en menos del 0,03% de los píxeles (la
   escultura que gira). Reglas para quien toque `museum.js`:
   - Algo que se **mueve, se oculta o cambia de geometría** después de armarse: `userData.dynamic = true`
     (o que sea usable con E: lo usable no se junta).
   - Algo usable con E que **nunca se mueve** (sillones, banquetas): `userData.mergeable = true` en el
     grupo. Se dibuja junto con el resto y el grupo sale de la escena, pero sigue en `world.interactables`.
   - Los `blockers` (paredes, columnas) se juntan para dibujar, pero siguen en `world.blockers`
     fuera de la escena, así la cámara y la E los siguen tocando.
   - Transparentes: no se juntan, salvo `userData.mergeTransparent` (botellas, vidrios).
   - Lo que se agrega a la escena después de `buildMuseum` (atril, objetos del piso, avatares) no se toca.
2. **Calidad baja** (decisión del usuario, anotada en ROADMAP.md): bordes redondeados con 2 segmentos
   en vez de 4 y el collage del baño a 512 px. `buildMuseum` ahora recibe la calidad tal cual
   (`'low' | 'medium' | 'high'`), antes medium llegaba como `'low'`.
3. **Carga de modelos compartida** (`src/loaders.js`): `loadGLTF(url)` / `parseGLTF(buffer)` con
   Draco, meshopt y KTX2. Ya la usan las obras 3D del Museo (antes un .glb exportado de Blender con
   Draco no abría). El código de los loaders y los decodificadores se bajan solo cuando se abre el
   primer modelo; Vite los copia solo desde `node_modules/three` (no hay archivos nuevos en `public/`).
   `setLoaderRenderer(renderer)` se llama en `main.js` (lo necesita KTX2).
   **Para el agente de Personaje y el de Editor:** usar `loadGLTF` en vez de `new GLTFLoader()`.
4. **TURN de Cloudflare para la voz** (redes de empresas, facultades, datos móviles con NAT estricto):
   el cliente le pide los servidores a la sala (`{ t: 'sfu', op: 'ice' }`), la sala genera credenciales
   temporales (6 h, reusa las mismas 1 h) y filtra las del puerto 53 (los navegadores lo bloquean).
   Sin los secretos, todo sigue como antes (solo STUN). Código: `RTC.iceServers()` / `peer()` en
   `src/net/rtc.js`, `turnServers()` en `server/room.js`.
5. **`scripts/medir.mjs`**: mide descarga, tiempo de carga, draw calls, triángulos y memoria de texturas.

## Secretos nuevos (opcionales)

En Cloudflare: Realtime → TURN Server → crear una clave. Da un **ID de la clave** (Turn Token ID) y un **API Token** (los nombres del panel pueden variar).

```bash
npx wrangler secret put TURN_KEY_ID          # el Turn Token ID
npx wrangler secret put TURN_KEY_API_TOKEN   # el API Token
```

En local, las dos líneas en `.dev.vars`. No se pudo probar contra la API real (no hay claves en esta
sesión): se probó el parseo con respuestas simuladas y que sin claves sigue andando con STUN.
Antes de activarlo, revisar en la página de precios de Cloudflare Realtime cómo se cobra el tráfico
que pasa por TURN (solo lo usan quienes no pueden conectarse directo al SFU).

## Cómo medir

```bash
npx vite build && npm run dev            # wrangler sirve dist/ en el 8787; Vite en el 5173
NODE_PATH=<carpeta con playwright> node scripts/medir.mjs http://localhost:8787 low   # descarga (producción)
NODE_PATH=<carpeta con playwright> node scripts/medir.mjs http://localhost:5173 low   # render (necesita window.__game)
```

## Para juntar

- Toca poco de archivos compartidos: `src/main.js` (3 líneas: import de `loaders.js`,
  `setLoaderRenderer`, `buildMuseum(..., quality)` y la carga de obras 3D), `src/ui/works.js` (el loader),
  `server/room.js` (op `ice` + `turnServers`), `src/net/rtc.js` (`peer()` ahora es async).
- `src/world/museum.js`: marcas `userData.*` y la llamada a `mergeStatic` al final. Si el Editor de
  salas reusa `buildMuseum` o arma salas con muebles quietos, puede llamar `mergeStatic(scene)` igual.
- Ya está mergeado `origin/main` al 23/10 (conflicto en la baranda de la escalera, resuelto con los dos cambios).

## Ideas que quedan (no hechas)

- Personaje: lo de "Lo más pesado de la descarga" (lejos lo que más suma).
- Cargar el post-procesado (GTAO, bloom) solo en calidad alta con `import()`: ~15 KB gzip menos
  para celulares. No se hizo para no reordenar `main.js` mientras trabajan otros agentes.
- Los 9 cuadros del hall son 4 draw calls cada uno (marco, obra, foco, ficha): se podrían juntar
  marcos y focos si se rehace `setWork` para que no cambie la geometría.
