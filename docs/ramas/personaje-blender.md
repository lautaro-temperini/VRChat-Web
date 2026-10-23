# Personaje MakeHuman: pedido para la sesión de Blender (MCP en la PC del usuario)

Decidido el 23/10 (ver ROADMAP → "Base del personaje", "Blender: dónde", "Tipos de cuerpo").
Esta sesión **no programa el juego**: prepara los modelos `.glb` con el formato de abajo. El código
(`src/player/avatar.js`) ya los entiende o se adapta en la rama `agente/personaje`.

## Antes de empezar (en la PC del usuario)

1. **Blender** 4.2 LTS o más nuevo (blender.org, GPL). Es solo la herramienta: no se sube al repo.
2. **MPFB 2** (MakeHuman Plugin For Blender): Blender → Preferencias → Get Extensions → "MPFB".
   El código es GPL, pero lo que se exporta (malla, deformaciones, pelo y ropa del sistema) es **CC0**.
3. **Pack de assets del sistema de MakeHuman** (CC0), que se baja desde el propio MPFB (pestaña "Apply assets"
   / "Load pack"). Con eso vienen la piel, los ojos, las cejas, el pelo y la ropa.
4. **blender-mcp** (github.com/ahujasid/blender-mcp): se instala el `addon.py` en Blender (Preferencias →
   Add-ons → Install from disk), en el panel lateral "BlenderMCP" se aprieta "Connect" y en Claude
   Desktop se suma el servidor `uvx blender-mcp` (hace falta tener `uv` instalado). No hace falta
   activar Poly Haven / Sketchfab / Hyper3D.

Reglas de CLAUDE.md que siguen valiendo: antes de bajar cualquier cosa, decir nombre, origen, tamaño y
licencia y esperar el OK; **solo assets CC0** (algunos peinados de la comunidad son CC-BY: esos no, o se
consulta). Todo comportamiento de diseño se le consulta al usuario.

## Qué hay que entregar

Carpeta nueva `public/models/makehuman/` (los `.blend` de trabajo van en `assets-src/makehuman/`,
que no se publica):

```
public/models/makehuman/
  LICENSE-CC0.txt
  body/masc.glb    body/fem.glb
  hair/corto.glb  largo.glb  rapado.glb  rodete.glb  rulos.glb  coleta.glb  barba.glb
  textures/…  y  textures/1k/…   (2K para PC, copias de 1K para celular, mismos nombres)
```

### Cuerpos (`body/masc.glb`, `body/fem.glb`)

- **Esqueleto**: el "game engine" de MPFB, **renombrado para que los huesos se llamen igual que los de
  Quaternius** (así no cambian las animaciones ni el código):
  `root pelvis spine_01 spine_02 spine_03 neck_01 Head clavicle_l upperarm_l lowerarm_l hand_l`
  `thumb_01..03_l index_01..03_l middle_01..03_l ring_01..03_l pinky_01..03_l thigh_l calf_l foot_l ball_l`
  (y lo mismo con `_r`). Ojo: `Head` con mayúscula. Si sobran huesos (cara, dedos de los pies), se pueden dejar.
- **Pose de reposo en T**: brazos horizontales hacia ±X, palmas hacia abajo, piernas rectas. Las
  animaciones se adaptan comparando con la pose de reposo (`src/player/anims.js`) y el código de los
  brazos asume T (`ARM_DOWN` en `avatar.js`). Aplicar la pose como reposo antes de exportar.
- **Unidades y orientación**: metros, Y arriba, mirando a +Z (lo normal al exportar glTF desde Blender).
  Altura natural (~1,78 masc / ~1,68 fem); el juego la escala con el deslizador de altura.
- **Deformaciones (shape keys → morph targets)**, con estos nombres exactos, relativas al cuerpo promedio:
  - `peso_bajo` = macro de peso al mínimo · `peso_alto` = peso al máximo
  - `musculo_bajo` = músculo al mínimo · `musculo_alto` = músculo al máximo
  El juego las mezcla así: peso 0..0,5 → `peso_bajo` 1..0; 0,5..1 → `peso_alto` 0..1 (igual con músculo).
  Los 4 tipos del básico son: flaco (peso 0,15 / músculo 0,35), promedio (0,5 / 0,5), gordo (0,9 / 0,45),
  musculoso (0,5 / 0,95) — `BODY_TYPES` en `server/shared.js`. Sirve renderizarlos para mostrárselos al usuario.
- **Mallas** (una por material, sin aplicar modificadores que rompan las shape keys):
  - cuerpo: material con "Body" en el nombre (piel con textura neutra, mapa de normales y rugosidad);
  - ojos: material con "Eyes" en el nombre (el iris en el centro de la textura, como ahora);
  - cejas y pestañas: cualquier otro material (el juego les pone el color del pelo).
  Cejas, pestañas y ojos también tienen que llevar las 4 deformaciones si se mueven con la cara.
- **Peso**: apuntar a ~20.000 triángulos el cuerpo (usar el proxy de baja resolución de MakeHuman si hace
  falta) y menos de ~3 MB por `.glb` sin texturas. Exportar sin comprimir (Draco/KTX2 se ve después).

### Peinados y barba (`hair/*.glb`)

- Cada uno pesado (skinned) al **mismo esqueleto** del cuerpo, con las mismas 4 deformaciones
  transferidas (para que no se hunda la cabeza en un cuerpo gordo). Un solo `.glb` sirve para masc y
  fem si encaja en los dos; si no, `hair/<estilo>_fem.glb`.
- `rulos` y `coleta` son los que faltan hoy (las cuentas que los eligieron se ven como corto y rodete).
- Material del pelo sin color fijo (textura en gris con alfa): el juego lo tiñe con el color elegido.

### Ropa (segunda etapa, consultar antes)

Hoy la ropa la pinta el sombreador sobre la piel. La ropa con volumen (buzo con capucha, remera, pantalón,
zapatillas como mallas aparte, con las 4 deformaciones) **queda para consultar con el usuario** qué
prendas y cómo se ven antes de hacerla.

## Cómo entregarlo

Trabajar en la rama `agente/personaje` (hacer `git pull` antes), commitear solo `public/models/makehuman/`,
`assets-src/makehuman/` (si un `.blend` pasa de ~50 MB, dejarlo fuera de git y avisar) y notas en este archivo (qué se bajó, de dónde, licencia y tamaño). Mandar
capturas de los 4 tipos de cuerpo × masc/fem al usuario antes de dar por cerrado.
