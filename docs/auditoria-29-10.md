# Auditoría general (29/10, trabajo autónomo)

Recorrido de todas las áreas del juego mientras el dueño no estaba. Lo que era bug se arregló (con prueba cuando
toca el servidor); lo que es de diseño quedó anotado para decidir. Ver también [ui-auditoria.md](ui-auditoria.md)
(revisión de pantallas con capturas y propuesta de reagrupado).

## Arreglado

### Personaje
- **La ropa, el pelo y los accesorios no seguían el peso ni el músculo** (ni los presets de cara): al armar cada
  prenda se creaba una malla nueva que perdía los nombres de las formas. En un cuerpo gordo o musculoso la piel
  atravesaba la ropa. *(avatar.js)*
- **El color de ojos del editor no se veía**: la textura de los ojos trae dos iris (uno por ojo) y la máscara
  apuntaba al centro, donde no hay nada; además el umbral de la pupila no tenía en cuenta que la textura es lineal.
- **Pelo atravesado por el cuero cabelludo** con las caras redonda, corazón y alargada: lo que va en la cabeza
  ahora sigue la piel con más precisión y un margen hacia afuera *(build.py; modelos regenerados)*.
- Celular y trago en la mano (brazo por cinemática inversa), manos de 1ª persona al saltar, postura (hombros).

### Rendimiento
- Mapas públicos y salas: lo quieto se junta en pocas mallas. Plaza de 335 a 130 llamadas de dibujo, Cafetería de
  229 a 113, Azotea de 149 a 101. Cada mueble junta sus piezas; el estante pasó de 46 mallas a 5.
- `mergeStatic` podía colgar la página (bucle sin fin si la raíz quedaba vacía).
- `THREE.Timer` en lugar de `Clock` (obsoleto) y `PCFShadowMap`.

### Servidor y seguridad
- Textos de la gente (sobre mí, notas, salas, mensajes, títulos de obras y diseños) sin invisibles, texto invertido
  ni "zalgo" (antes solo el chat y los nombres). *Prueba: test/textos.test.mjs*
- Pedidos JSON de más de 64 KB no se leen (413): antes una nota de varios MB ocupaba la cuenta global.
  *Prueba en seguridad.test.mjs*
- La sala limpia lo que guarda en memoria por persona (antes crecía sin límite en salas con mucho tráfico).
- Cuentas: mantenimiento por hora (sesiones vencidas que nadie volvió a usar e invitados abandonados).
- `/item` solo para admins. *Prueba en seguridad.test.mjs*

### Interfaz
- Premios en la mochila con ícono propio y el color de su rareza (antes: un sillón sobre fondo blanco).
- Premios soltados en el piso: un paquete de regalo del color de su rareza (antes no se veían).
- Gestos sin barra horizontal, aire en el panel del DJ, historial del chat a la izquierda, cartel tocable y cruz del
  chat en celular.

## Decisiones provisorias (las tomó Claude para no frenarse: revisarlas)

| Qué | Dónde |
|---|---|
| Tope de 10 salas creadas por día por cuenta (contra crear y borrar en bucle) | `ROOMS_PER_DAY`, server/rooms.js |
| Ojos de fantasía de premio: reptil, gato, demonio, brillantes, hielo (nombres, colores, rarezas) | `MH_EYES`, server/avatarCatalog.js |
| Rarezas y nombres de todos los premios de MakeHuman | server/avatarCatalog.js |
| Postura: hombros 0,14 rad atrás, cuello 0,08 | `POSTURE`, src/player/avatar.js |
| Chat: tus mensajes al medio; el historial (sin posición) a la izquierda | `sideOf`, src/app/chat.js |
| Premio en el piso = paquete de regalo del color de la rareza | `prizeMini`, src/world/ground.js |

## Para decidir (diseño)

- La propuesta de UX/UI ([ui-auditoria.md](ui-auditoria.md)).
- Premios 3D CC0 (Poly Pizza, Kenney, Quaternius): hay que bajar archivos (necesita tu OK con nombre y tamaño).
- Ojos de fantasía: ¿alguno libre en el editor? (la decisión "mezcla" dice que algunos sí).

## Revisado sin problemas

- Rutas del servidor: todas piden sesión donde corresponde; fotos, salas y notas respetan la privacidad.
- Peso del cliente: 1,1 MB el principal (≈300 KB comprimido, casi todo Three.js); Draco se baja solo si hace falta.
- Celular: 145 llamadas de dibujo en el Museo, sin sombras y con resolución 1×.
- Ninguna sala pública tira errores en la consola al cargar.
- Editor de salas: agregar, mover y sacar muebles sigue andando con el juntado por mueble.
