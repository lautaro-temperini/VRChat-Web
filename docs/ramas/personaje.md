# Rama agente/personaje

## Qué se hizo
- **Investigación de la base del personaje** → el usuario eligió **MakeHuman** (CC0), trabajado en Blender con
  el MCP en su PC. Descartados: Meshy/Tripo como cuerpo (malla única con pelo y ropa, un modelo por cuerpo;
  quedan para objetos), Ready Player Me (cerró en enero de 2026), VRoid (anime), MB-Lab (AGPL), MetaPerson/Avaturn (pagos).
- **Editor de personaje con dos pestañas** (la de "Avanzado" estaba deshabilitada):
  - Básico: muestras de color (como antes) + **tipo de cuerpo** fijo: flaco, promedio, gordo, musculoso.
  - Avanzado: deslizadores **peso** y **músculo** + **selector RGB completo** por cada color (`src/ui/colorpicker.js`).
  - Se sacó el deslizador "Contextura".
- **Avatar**: `applyBuild()` → `applyShape()`. Si el modelo trae deformaciones `peso_bajo/peso_alto/musculo_bajo/musculo_alto`
  (cuerpo, pelo y ropa), las usa; si no (Superhero de hoy), aproxima ensanchando huesos como antes.
- Pedido para la sesión de Blender: `docs/ramas/personaje-blender.md` (formato exacto de los `.glb`).

## Archivos tocados
`server/shared.js` (agregado `BODY_TYPES` y validación de `weight`/`muscle`), `src/player/avatar.js`,
`src/main.js` (solo el bloque "Editor de personaje" e imports), `index.html` (panel `#editor`), `src/style.css`
(estilos del editor y del selector RGB), `src/ui/colorpicker.js` (nuevo), `docs/ROADMAP.md` (decisiones).

## Formato del look y migración
- Nuevos: `weight` y `muscle` (0..1, por defecto 0,5 = promedio). El tipo de cuerpo del básico no se guarda:
  sale de esos dos valores (`BODY_TYPES` en `server/shared.js`).
- `build` (contextura) se sigue aceptando y guardando, pero el personaje ya no lo usa. Las cuentas existentes
  no tienen `weight`/`muscle` → `DEFAULT_LOOK` los completa con 0,5 (promedio). No hace falta migrar la base.
- Los colores ahora pueden ser cualquier `#rrggbb` (la validación ya lo permitía).

## Licencias
No se bajó nada todavía. Lo de MakeHuman (assets CC0, MPFB GPL como herramienta) lo baja la sesión de la PC.

## Para el master
- Sin conflictos esperables fuera de `src/main.js` (bloque del editor) e `index.html` (`#editor`).
- Falta (cuando lleguen los modelos de MakeHuman): apuntar `BODIES`/`HAIR_FILES` de `avatar.js` a
  `public/models/makehuman/`, medir los anclajes de accesorios (`head`/`face`/`chest`), reconocer el material
  "Body" además de "Superhero", sumar `rulos` y `coleta` reales y sacar `LEGACY_HAIR`. Después: ropa con volumen
  y capa 2 de cara (consultar).
