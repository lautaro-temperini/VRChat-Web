# Revisión de UX/UI (29/10)

Recorrido de todas las pantallas en PC (1280×800) y celular (375×812, táctil), con capturas en
[ui-auditoria/](ui-auditoria/). Primero lo que está mal (problemas), después una **propuesta de reagrupado** para
que decidas. No se cambió nada de diseño: solo se arreglaron tres bugs chicos (al final).

---

## Problemas encontrados

### General (todas las pantallas)

1. **Botones repartidos en las 4 esquinas** (PC): arriba a la izquierda el estado, arriba a la derecha Gestos / Sala /
   Personaje / ajustes, abajo a la izquierda Hablar / Audio, abajo a la derecha Inventario / Amigos / Mapa. No hay una
   lógica de dónde está cada cosa y el chat queda encajado entre Hablar y la columna de mensajes.
   ([pc-gestos.jpg](ui-auditoria/pc-gestos.jpg))
2. **Nombres que no dicen lo que abren:** "Amigos" abre el *celular* (amigos, mensajes, muro, galería, avisos,
   progreso); "Sala" es la info de la sala y los jugadores; "Mapa" son las salas. "Personaje" e "Inventario" están
   separados aunque los dos son "cómo me veo".
3. **Cada panel cierra distinto:** botón amarillo enorme "CERRAR" / "LISTO" / "VOLVER AL JUEGO" abajo (Gestos, Sala,
   Consola, Menú), "GUARDAR" fijo (Personaje), una ✕ arriba (Postular), "✕ Guardar" en el celular (se lee como
   *guardar cambios* y significa *guardar el celular*). El botón amarillo de cerrar ocupa el lugar de la acción
   principal.
4. **Todos los paneles son la misma columna a la derecha**, de alto completo, aunque tengan 2 cosas (Menú →
   General tiene un deslizador y "Salir de la cuenta") ([pc-menu.jpg](ui-auditoria/pc-menu.jpg)).

### Celular (pantalla táctil)

5. **Barra de íconos sin texto arriba a la izquierda** (8 botones en dos filas: cámara, gestos, sala, personaje,
   mochila, celular, mapa y ajustes). No se sabe qué es cada uno ([cel-hud.jpg](ui-auditoria/cel-hud.jpg)).
6. **El chat ocupa el medio de la pantalla** y tapa al personaje y lo que tenés adelante.
7. **Los paneles son una hoja de abajo** que tapa la mitad inferior: en **Personaje** no ves a tu personaje mientras lo
   cambiás (la cámara no lo encuadra) ([cel-personaje.jpg](ui-auditoria/cel-personaje.jpg)).
8. **El celular del juego tapa la fila de íconos** de arriba y su barra tiene 7 botones apretados
   ([cel-celular.jpg](ui-auditoria/cel-celular.jpg)).
9. **Inventario en 3 columnas** con el botón "Soltar" encima de cada objeto: fácil de tocar sin querer
   ([cel-inventario.jpg](ui-auditoria/cel-inventario.jpg)).

### Por pantalla

10. **Inventario:** los repetidos no se agrupan (3 "Mochila", 3 "Lentes redondos"), no hay filtros (ropa, accesorios,
    premios, muebles, consumibles) ni se ve la rareza; "Soltar" está en todas las tarjetas
    ([pc-inventario.jpg](ui-auditoria/pc-inventario.jpg)).
11. **Personaje:** "Básico" y "Avanzado" son dos listas largas casi iguales; con los 61 tipos de ropa, sombreros,
    anteojos, cejas y 5 zonas de cara el avanzado es un scroll interminable. No hay vista previa grande del personaje
    ([pc-personaje.jpg](ui-auditoria/pc-personaje.jpg)).
12. **Mapa:** cada sala es una tarjeta alta con la descripción entera; con los mapas públicos, tus 3 salas, favoritas y
    amigos hay que bajar mucho para encontrar algo ([pc-mapa.jpg](ui-auditoria/pc-mapa.jpg)).
13. **Sala (Tab):** a quien no es dueño le muestra 6 casillas grises que no puede tocar (chat, voz, DJ…); ocupan más
    que la lista de jugadores ([pc-sala.jpg](ui-auditoria/pc-sala.jpg)).
14. **Celular → Progreso:** el camino muestra 6 renglones "…" vacíos ([pc-celular-progreso.jpg](ui-auditoria/pc-celular-progreso.jpg)).
15. **Cabina DJ:** mucho texto de instrucciones antes de lo importante (elegir entrada y empezar)
    ([pc-dj.jpg](ui-auditoria/pc-dj.jpg)).
16. **Postular obra:** el selector de archivo es el del navegador (gris, sin estilo) y el formulario es un cuadro
    centrado distinto de todos los demás paneles ([pc-postular.jpg](ui-auditoria/pc-postular.jpg)).
17. **Menú (Esc):** no tiene la calidad gráfica (solo se fuerza con `?calidad=` en desarrollo) ni la cuenta (cambiar
    mail/clave, salas); "Salir de la cuenta" queda suelto en General.
18. **Gestos:** una lista de 14 botones para algo que se usa rápido (en PC con la R); una rueda sería más cómoda.

---

## Propuesta de reagrupado (para decidir)

**A. Una sola barra de navegación** (abajo al centro en PC; abajo, con texto, en celular), con 5 lugares:

| Botón | Qué abre |
|---|---|
| **Mapa** | Salas: favoritas, públicas, tus salas, amigos (con buscador y filas compactas) |
| **Celular** | Amigos y mensajes, muro, galería, avisos (el punto rojo de avisos en el botón) |
| **Yo** | Personaje + Mochila juntos: probador con el personaje grande y pestañas Cuerpo / Cara / Pelo / Ropa / Accesorios / Mochila |
| **Gestos** | Rueda (mantener R en PC; en celular un abanico) |
| **Menú** | Audio, gráficos (calidad), controles, cuenta, salir |

Arriba a la izquierda queda solo el estado (sala, conectados, nivel: al tocarlo abre Progreso) y **Tab / Sala** pasa a
ser un botón chico junto al estado. Hablar y Audio quedan abajo a la izquierda (como los controles de voz de una
videollamada).

**B. Paneles iguales:** título + ✕ arriba a la derecha en todos; abajo solo la acción principal si existe (Guardar,
Postular, Empezar a pasar música). Nada de "CERRAR" amarillo. El celular del juego cierra con ✕ "Cerrar".

**C. Personaje como probador:** al abrirlo la cámara se pone de frente al personaje (PC: personaje a la izquierda,
opciones a la derecha; celular: personaje arriba, opciones abajo). Sin "básico/avanzado": pestañas por zona y, en cada
una, primero lo más usado.

**D. Mochila:** objetos agrupados con contador (×3), filtros por tipo, borde del color de la rareza, y al tocar un
objeto una ficha con Ponerse / Soltar / Intercambiar (en vez de "Soltar" en cada tarjeta).

**E. Chat:** en celular, solo los últimos 3 mensajes y se desvanecen; el historial completo al abrir el chat. En PC,
igual que hoy.

**F. Sala (Tab):** para quien no es dueño, los permisos en una línea ("Chat · Voz · DJ · Consola") y la lista de
jugadores primero.

**G. Menú:** sumar Gráficos (calidad baja / media / alta / automática) y Cuenta.

¿Cuáles querés? Se pueden hacer de a una (A y B son las que más ordenan).

---

## Arreglado en esta revisión (bugs, no diseño)

- Gestos: barra de desplazamiento horizontal que no debía estar.
- Cabina DJ: el texto quedaba pegado a "Entrada de audio".
- Chat: el historial al entrar (mensajes viejos, sin posición) salía centrado; ahora a la izquierda (los tuyos siguen
  al medio).
