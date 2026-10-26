# Hallazgos — "el que sube archivos tramposos"

Tester adversarial de archivos subidos (diseños de artistas, obras del Museo, texturas, modelos GLB).
Servidor local de pruebas: `http://127.0.0.1:8788`. Todo lo marcado como REPRODUCIDO se corrió contra
`checkGLB` importado directo del repo (`server/glb.js`), sin modificar ningún archivo. Las subidas HTTP
en vivo quedaron bloqueadas por el freno de cuentas nuevas por IP (que funciona: "Se crearon muchas
cuentas desde tu conexión"), pero `designSubmit` devuelve **tal cual** el resultado de `checkGLB`
(`server/designs.js:59-61`), así que pasar `checkGLB` equivale a que la subida se acepte.

Scripts: `../bots/archivos/glbbuild.mjs` (armador de GLB), `../bots/archivos/probe.mjs`
(las 4 pruebas contra `checkGLB`), `../bots/archivos/live.mjs` (subida HTTP, bloqueada por el límite de IP).

Salida real de `node probe.mjs`:
```
A) min/max mentiroso:   { ok: true, tris: 1, size: [1,1,1], tex: 0 }   (geometría real = 30 m)
B) reuso de nodos:      { ok: true, tris: 5000, ... }                  (renderiza ~2.500.000 tris)
C) textura data: URI:   { ok: true, ..., tex: 0 }                      (no se midió la imagen)
D) grafo exponencial:   { ok: true, ... } tardó 14708 ms              (archivo de 744 bytes, D=24)
```

---

## CRÍTICA

### 1. Bomba de recursión en `checkGLB`: un GLB diminuto cuelga el Durable Object de cuentas
**Gravedad: crítica. REPRODUCIDO** (módulo; la subida llama a `checkGLB` dentro del DO `Accounts`).

`visit()` recorre la jerarquía de nodos para medir el tamaño. Tiene tope de profundidad (`depth > 64`)
pero **no lleva un conjunto de nodos ya visitados** y el factor de ramificación es libre. Un grafo donde
cada nodo apunta dos veces al siguiente genera 2^profundidad visitas.

Pasos (fragmento de `probe.mjs`, caso D):
```js
const D = 24;                                  // 2^24 ≈ 16 millones de visitas
const nodes = [];
for (let i = 0; i < D; i++) nodes.push({ children: [i + 1, i + 1] });
nodes.push({ mesh: 0 });                       // hoja
const json = { asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes,
  meshes:[{primitives:[{attributes:{POSITION:0}}]}],
  accessors:[{componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[0.5,0.5,0.5]}] };
checkGLB(buildGLB(json).buffer);               // tardó 14,7 s con un archivo de 744 bytes
```
Con `D = 27` son ~2 minutos; con `D = 30`, ~15 minutos, y el archivo sigue pesando menos de 1 KB
(muy por debajo del tope de 2 MB).

**Qué pasa:** `checkGLB` corre adentro de `Accounts` (`designSubmit`), que es un Durable Object de un
solo hilo. Mientras recorre el grafo, **se congelan TODAS las llamadas a la API de todos los usuarios**
(login, inventario, amigos, mensajes, presencia, red social): una sola subida de <1 KB tira abajo la
parte social del juego para todo el mundo. Cualquier cuenta registrada (no invitado) puede hacerlo.
**Qué debería pasar:** medir en tiempo acotado.
**Responsable:** `server/glb.js:45-61` (`visit` sin set de visitados; el `depth > 64` no frena el
ensanchamiento).
**Sugerencia:** llevar un `Set` de nodos visitados (un nodo glTF válido no se referencia más de una vez)
y cortar/fallar si se repite o si el total de visitas pasa un tope (p. ej. `nodes.length`). De paso,
rechazar cuando un nodo aparece como hijo más de una vez.

---

## ALTA

### 2. La obra "escultura" del Museo no pasa por `checkGLB`
**Gravedad: alta. REPRODUCIDO por lectura de código** (no se pudo subir en vivo por el límite de IP).

La postulación de obra tipo `escultura` (`server/works.js:116-123`) **solo** valida: pesa menos de 2 MB,
tiene al menos 12 bytes y el magic `glTF`. No hay control de triángulos, ni de texturas, ni de alto, ni
lista blanca de extensiones, ni medición de nodos. O sea: todo lo que el resto del informe esquiva en
`checkGLB`, acá entra directo sin siquiera esquivarlo.

**Qué pasa:** una obra con millones de triángulos, texturas enormes, extensiones que el juego no lee o
geometría gigante queda guardada y se sirve por `/api/workfile` a todo el que la mire en el Museo. Una
obra de alguien con el título "creador" queda `verificada` al toque (`works.js:124`, `this.rotate()`),
así que se expone sin curaduría.
**Qué debería pasar:** las esculturas deberían pasar el mismo `checkGLB` que los objetos 3D de diseño.
**Responsable:** `server/works.js:116-123` (no importa ni llama a `checkGLB`).
**Sugerencia:** `import { checkGLB } from './glb.js'` y aplicarlo igual que en `designs.js:59-61`.

### 3. Tamaño del modelo falseado: declara 1 m, la geometría real mide 30 m
**Gravedad: alta. REPRODUCIDO.**

`checkGLB` mide el tamaño con los `min`/`max` **declarados** del accesor de POSITION
(`server/glb.js:50-56`), nunca lee las coordenadas reales del BIN. Entonces un modelo puede declarar una
caja de 1 m y traer vértices a 30 m.

Pasos (`probe.mjs`, caso A):
```js
const bin = positions([[0,0,0],[30,30,30],[0,30,0]]);   // 30 m de verdad
accessors: [{ bufferView:0, componentType:5126, count:3, type:'VEC3', min:[0,0,0], max:[1,1,1] }]
// -> checkGLB: { ok:true, size:[1,1,1] }
```
**Qué pasa:** el cliente arma el objeto con la geometría real
(`src/world/furniture.js:434`, `src/world/ground.js:99`, `src/player/avatar.js:852`: todos hacen
`new THREE.Box3().setFromObject(obj)` sobre los vértices reales), así que se ve un objeto de 30 m donde
el servidor cree que hay uno de 1 m. El collider usa las medidas declaradas (`piece.design.dims` =
[1,1,1]), con lo cual queda un bloque visual gigante, flotando y tapando la cámara de todos, con un
collider chico. Peor: si se declara `dims` ≤ 0,5 m (`designHoldable`, `server/shared.js`), el objeto es
"de mano" y sigue al personaje: un objeto de 30 m pegado a la mano, en la pantalla de todos los que lo ven.
**Qué debería pasar:** medir con los vértices reales, o rechazar si los `min`/`max` no coinciden con el BIN.
**Responsable:** `server/glb.js:50-56` (confía en `a.min`/`a.max`).
**Sugerencia:** leer las posiciones reales del `bufferView` (al menos para accesores float32 sin
compresión) y comparar contra `min`/`max`; si no cierran, fallar. Para Draco/meshopt no se puede sin
decodificar: ahí conviene acotar el tamaño por el collider/escala y recortar en el cliente.

### 4. Multiplicador de triángulos por reuso de nodos (instancing "a mano")
**Gravedad: alta. REPRODUCIDO** (el conteo en el módulo + el clonado confirmado en three.js).

El conteo de triángulos recorre **las mallas** (`server/glb.js:33-40`), una sola vez por malla, sin
importar cuántos nodos la referencien. El recorrido de nodos (para el tamaño) sí visita cada nodo, pero
no suma triángulos. Entonces una malla de 5.000 tris referenciada por 500 nodos cuenta 5.000.

Pasos (`probe.mjs`, caso B): 500 nodos `{mesh:0}`, malla con `indices.count = 15000` →
`checkGLB: { ok:true, tris:5000 }`, pero el cliente renderiza ~2.500.000.

**Qué pasa:** `GLTFLoader._getNodeRef` (`node_modules/three/examples/jsm/loaders/GLTFLoader.js:2849-2853`)
**clona** el mesh cuando lo usan varios nodos (comparte geometría, pero crea N objetos Mesh = N draw calls,
cada uno dibujando toda la geometría). El límite de 10.000 tris se multiplica por la cantidad de nodos:
se le puede clavar el framerate a todos los que entren a la sala o miren el objeto. Lo mismo vale
combinando esto con `EXT_mesh_gpu_instancing` está bien bloqueado (no está en `OK_EXT`), pero el reuso de
nodos logra el mismo efecto sin extensión.
**Qué debería pasar:** contar triángulos por instancia (sumando por cada nodo que referencia la malla).
**Responsable:** `server/glb.js:32-41` (itera `meshes`, no los nodos) frente a `visit` que sí itera nodos.
**Sugerencia:** contar los triángulos dentro del recorrido de nodos (sumar los tris de `nodes[i].mesh`
por cada visita), de modo que el tope de 10.000 sea el total que se va a dibujar.

### 5. Textura-bomba por `data:` URI que no se mide
**Gravedad: alta. REPRODUCIDO el bypass** (el efecto de crash es razonado).

Al medir texturas, si la imagen viene por `img.uri` con `data:`, el código lo permite
(`server/glb.js:70`) y después busca `img.bufferView` (que no existe en ese caso), así que hace `continue`
y **no mide la imagen** (`glb.js:71-75`): `tex` queda en 0 y pasa el tope de 1.024 px.

Pasos (`probe.mjs`, caso C): `images:[{ uri:'data:image/png;base64,...' }]` → `checkGLB: { ok:true, tex:0 }`.

**Qué pasa:** se puede embeber un PNG que declara 16.384 × 16.384 (un color sólido comprime a pocos KB,
entra en los 2 MB) como `data:` URI. `GLTFLoader` lo decodifica a un ImageBitmap/textura; antes de que
three lo achique al `MAX_TEXTURE_SIZE`
(`node_modules/three/build/three.module.js:4484`) ya decodificó la imagen completa en memoria
(~1 GB en RGBA), lo que puede tumbar la pestaña de cualquiera que cargue el modelo.
**Qué debería pasar:** medir también las texturas embebidas en `data:` URI (o prohibir `data:` y exigir
que estén en el BIN, como ya exige para URIs externas).
**Responsable:** `server/glb.js:69-75` (la rama `data:` salta la medición).
**Sugerencia:** si `img.uri` empieza con `data:`, decodificar el base64 y pasar los primeros bytes por
`imageSize()` igual que con el `bufferView`; aplicar el mismo tope de 1.024 px.

---

## MEDIA

### 6. `EXT_meshopt_compression` / Draco: el conteo de triángulos cree en `count` sin verificar
**Gravedad: media. Hipótesis parcial (bypass de conteo confirmado por lectura).**

Con compresión permitida (`KHR_draco_mesh_compression`, `EXT_meshopt_compression` están en `OK_EXT`),
el conteo de tris sigue usando `acc[p.indices]?.count`. Si el accesor de índices declara un `count` bajo
pero el stream comprimido real decodifica a muchos más primitivos, el servidor contaría de menos. No lo
pude reproducir sin armar un stream Draco/meshopt válido. Queda como hipótesis: conviene que el equipo
revise si `count` puede mentir respecto de lo que decodifica el decoder.
**Responsable:** `server/glb.js:36`.
**Sugerencia:** para mallas comprimidas, acotar también por `bufferView.byteLength` del stream, o
decodificar del lado del servidor si algún día se puede.

---

## Hipótesis peligrosas no confirmadas

- **Extensión peligrosa solo en `primitive.extensions`/`node.extensions` sin declararla en
  `extensionsUsed`.** `checkGLB` valida únicamente `json.extensionsUsed` (`glb.js:27`). Si una extensión
  no figura ahí pero sí dentro de un primitivo, no se detecta. Hoy no encontré una extensión que
  three.js procese y sea dañina (ignora las que no conoce), así que es bajo; igual el whitelisting
  debería mirar también los `extensions` embebidos.
- **JSON gigante/profundo en el chunk JSON.** El tope de 2 MB acota el JSON; `JSON.parse` de 2 MB de
  anidamiento no colgó en las pruebas rápidas. El vector real de DoS es el grafo de nodos (hallazgo 1),
  no el `JSON.parse`.
- **`w`/`h` mentirosos en fotos** (`/api/photo`, `accounts.js:704`) y en cuadros de diseño: el servidor
  guarda lo que manda el cliente y solo lo usa para la relación de aspecto. Falsearlo deforma la vista,
  no vi un riesgo mayor (ya figura como mitigado en `docs/ramas/seguridad.md` #11, con `nosniff`).

## Cosas que probé y están bien

- **URIs externas en texturas**: `glb.js:70` rechaza cualquier `img.uri` que no sea `data:`
  ("Las texturas tienen que estar adentro del .glb"). Bien (evita SSRF/filtrado por textura externa).
  El agujero está solo en la rama `data:` (hallazgo 5).
- **`EXT_mesh_gpu_instancing`**: no está en `OK_EXT`, se rechaza con "usa algo que el juego no lee".
- **Lista blanca de extensiones**: el resto de las no listadas se rechaza correctamente.
- **Títulos con HTML/control/RTL**: `clip()` (`designs.js:14`) y `cleanDesign` (`shared.js:65`) sacan
  `<`, `>` y los caracteres de control y recortan a 60/80. No vi XSS almacenado por el título.
- **Polyglots / archivos que no son imagen con magic correcto**: `isImage` (`shared.js:144-150`) mira
  los primeros bytes por mime; y los archivos se sirven con `x-content-type-options: nosniff` +
  `content-security-policy: default-src 'none'; sandbox` (`worker.js:13`, aplicado en `designfile`,
  `workfile` y `photo`), con el `content-type` fijado al mime validado. Un SVG/HTML disfrazado no se
  ejecuta en el navegador de otro.
- **Freno de cuentas por IP**: bloqueó las subidas en vivo de este mismo informe. Funciona.

---

## Resumen por gravedad
- Crítica: 1  (bomba de recursión en `checkGLB` → DoS del Durable Object de cuentas)
- Alta: 4      (escultura del Museo sin `checkGLB`; tamaño falseado; multiplicador de tris por nodos; textura-bomba `data:` URI)
- Media: 1     (conteo de tris confía en `count` con mallas comprimidas — hipótesis parcial)
- Baja: 0
