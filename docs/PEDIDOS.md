# Pedidos del usuario (20/10/2026) — para la próxima sesión

> Leer junto con [CLAUDE.md](../CLAUDE.md) y [ROADMAP.md](ROADMAP.md).
> **Regla:** cada comportamiento de diseño se consulta con el usuario por separado antes de implementarlo
> (cooldowns, permisos, límites, quién puede hacer qué, qué pasa con los objetos, etc.).
> Las decisiones que tome, anotarlas en ROADMAP.md → "Decisiones de diseño".

## 1. Música del DJ (prioridad)
Pasar música en vivo desde una PC a los parlantes del escenario de la sala.
- Base técnica sugerida: el audio P2P que ya existe para la pantalla compartida (WebRTC, suena en 3D
  desde una posición). El DJ comparte el audio de su PC (Serato, Rekordbox, Traktor, VirtualDJ,
  Spotify…) y suena desde los parlantes del escenario. La M ya silencia "música y pantalla".
- **Consultar antes:** quién puede pasar música (cualquiera, el dueño, una lista de DJs, turnos), si
  hay cola de DJs, si la música se escucha en toda la sala o solo cerca del escenario, si la pista de
  baile y las luces reaccionan al ritmo, calidad/latencia aceptable.

## 2. Puente OSC para artistas (después de la música)
Que los artistas conecten su software (TouchDesigner, Ableton con Max for Live, Blender con add-on)
y lo que hacen se vea/escuche en vivo en la sala: tipo showcase donde todos crean y los demás miran.
- Idea técnica: programa local ("puente") que recibe OSC/MIDI en la PC del artista y lo manda a la
  sala; parámetros que mueven luces, visuales, pantallas. Más varias pantallas compartidas.
- No hace falta el MCP de TouchDesigner para el juego (solo serviría para que Claude pruebe/arme
  la parte de TouchDesigner en la PC del usuario).
- **Consultar antes:** qué puede controlar cada artista, si hace falta permiso del dueño de la sala,
  cuántos artistas a la vez, qué pasa si dos controlan lo mismo.

## 3. Editor de sala dentro del juego + modelos subidos por usuarios
- **Editor básico dentro del juego**: elegir objetos de un catálogo y ponerlos, moverlos, rotarlos y
  escalarlos en la sala; se guarda por sala.
- **Cualquiera puede subir modelos** siempre y cuando cumplan los requisitos.
  - **Consultar los requisitos concretos** (propuesta para discutir, NO decidida): GLB/glTF,
    tamaño máximo por archivo, cantidad máxima de triángulos, texturas hasta 2K, escala en metros,
    sin scripts, licencia propia o CC0, moderación/reportes.
  - Almacenamiento sugerido: Cloudflare R2. Validación en el servidor.
- Mientras tanto, convención para modelos que se agregan a mano (ver "Cómo agregar modelos" abajo).

## 4. Personaje
Estilo pedido: **semi-realista tipo MetaPerson, NO anime** (esto reemplaza la decisión anterior de
"estilizado tipo Fortnite"). Herramientas posibles que mencionó el usuario: **Tripo** (generar
modelos 3D con IA) o el **MCP de Blender**. Investigar y proponer.

- **Tipos de cuerpo (estereotipos):** hoy la contextura al mínimo sigue siendo superhéroe musculoso.
  Pide cuerpos distintos: flaco, gordo, musculoso, atlético, etc. (consultar la lista final).
  Técnica sugerida: morph targets / bases distintas; escalar huesos no alcanza.
- **Más peinados y más cejas.**
- **Más ropa y accesorios.**
- **Selector de color RGB completo**: en vez de filas de muestras, un cuadradito "RGB +" que abre un
  selector con todos los colores (más variedad en menos espacio). Aplica a piel, ojos, pelo, ropa.
- Personalización objetivo (completa): contextura, altura, peinados, ojos, piel, boca, nariz, cejas,
  orejas, forma de la cara, aros, lentes, gorro, remera, buzo, pantalones, zapatos.
  Técnicas: escala de huesos (altura/proporciones), morph targets (cara y cuerpo), tinte de
  materiales (colores), mallas modulares con el mismo esqueleto (pelo, ropa), objetos pegados a
  huesos (accesorios).

## 5. Más adelante (anotado, no ahora)
- **Usuarios suben sus propios modelos** (avatares y objetos) — ver punto 3; para avatares, esqueleto
  estándar para que funcionen las animaciones.
- **Usuarios suben sus propios gestos/scripts** — **después** de lo de modelos. Sugerencia técnica:
  gestos como datos (animación + sonido + texto), no código; scripts de verdad solo en un entorno
  aislado con funciones habilitadas (tipo LSL de Second Life / Luau de Roblox). Consultar.

---

## Cómo agregar modelos a mano hoy (sillones, bandejas, luces, decoración)

Hasta que exista el editor y la subida de modelos, se agregan al proyecto:

1. **Conseguir o hacer el modelo**
   - Bibliotecas gratis con licencia libre: Poly Pizza (poly.pizza), Sketchfab (filtrar por licencia
     CC0 o CC-BY y "Downloadable"), Quaternius y KayKit (itch.io), Kenney (kenney.nl).
   - Generarlo con IA: Tripo (exporta GLB).
   - Modelarlo en Blender.
2. **Requisitos para que ande bien en el navegador**
   - Formato **.glb** (o .gltf con sus texturas al lado).
   - Escala en **metros** (un sillón mide ~0,8 m de alto), eje Y hacia arriba, origen en la base.
   - Liviano: idealmente menos de 20.000 triángulos por objeto y texturas de 1K–2K.
   - Revisar la licencia (CC0 es lo más simple; CC-BY pide dar crédito).
3. **Dónde ponerlo:** `public/models/props/` (ej. `public/models/props/sillon.glb`) y pedirle a Claude
   dónde ubicarlo en la sala ("un sillón frente a la pantalla", "cambiar las bandejas del DJ por este
   modelo").
4. **Luces:** se pueden exportar desde Blender (glTF soporta luces puntuales y focos), o pedir que una
   parte brille como neón: nombrar el material con `NEON_` (convención propuesta, a implementar).
5. **Convención de nombres propuesta** (para salas armadas en Blender, a implementar):
   `COL_` sólido/colisión · `SEAT_` asiento · `ART_` cuadro con ficha · `SPAWN` punto de entrada ·
   `NEON_` material que brilla.

## Notas técnicas para la sesión
- Windows: el repo tiene rutas largas (`assets-src/...`); hace falta `git config --global core.longpaths true`.
- El usuario prueba en local con `git pull` + `npm run dev` sobre esta rama.
