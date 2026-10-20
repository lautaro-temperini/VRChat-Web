# Roadmap y decisiones

## Próximos pasos

### En curso
1. **Personaje realista estilizado (Quaternius).** Modelos ya descargados en
   `public/models/quaternius/` (CC0): 2 cuerpos (masc/fem, proporción "superhéroe") y 8 peinados,
   esqueleto estilo Unreal de 65 huesos, sin animaciones. Plan:
   - Clase `HumanAvatar` con la misma interfaz que `Avatar` (ver CLAUDE.md).
   - Ropa: pintar la textura automáticamente según qué hueso mueve cada triángulo
     (torso → remera/buzo, piernas → pantalón, pies → zapatillas), así el editor de colores sigue andando.
   - Accesorios enganchados al hueso `Head` y a `spine_03`.
   - Animación: primero mover los huesos con la animación procedural actual; después reemplazar
     por animaciones de Mixamo (retarget de `mixamorig:*` a los huesos de Quaternius).
   - Editor: tipo de cuerpo (masc/fem), barba; peinados del pack (corto, largo, rapado, rodete…).
     **Hay que consultar** cómo se mapean los peinados actuales (rulos, coleta no existen en el pack).
2. **Animaciones de Mixamo** (las baja el usuario). Lista pedida: Idle, Walking, Jogging, Fast Run,
   Jump, Falling Idle, Crouch Idle, Crouch Walk Forward, Sitting Idle, Climbing / Braced Hang To Crouch,
   Talking, Waving, Clapping, Pointing, y 2-3 bailes. Formato FBX Binary, Without Skin, 30 fps,
   In Place en las de desplazamiento.

### Pendientes (a consultar antes de implementar)
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
| Teclas | E usar · P personaje · V (mantener) hablar · M silenciar música de la sala · Tab jugadores/info · Esc menú con pestañas · I inventario · F amigos |
| Stamina | Correr gasta stamina (barra visible) |
| Interactuar | E en cuadros: ficha + vista previa del sitio; E en jugadores: perfil con pestaña galería (estilo Second Life) |
| Objetos en el suelo | Otro jugador puede juntarlo a los 5 s; si nadie lo junta en 60 s, **se pierde para siempre** |
| Inventario | No frena al personaje; se puede arrastrar un objeto a la escena para soltarlo |
| Mutear / ignorar | Mutear = silenciar su voz. Ignorar = silenciar voz y texto |
| Moderación | Dueño de cada sala personal; el usuario "xvvave" es admin del Museo y de todas las salas. Expulsar, banear, silenciar, traer, mandar a la entrada, habilitar/deshabilitar chat/voz/pantalla/objetos |
| Mapas | Botón Mundi + comandos en el chat (`/ir`, `/salas`) |
| Día y noche | Según la hora GMT-3 |
| Web3 | No por ahora |
