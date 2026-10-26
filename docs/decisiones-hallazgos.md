# Decisiones de diseño sobre los hallazgos (26/10)

Decisiones del dueño del proyecto tomadas sobre los hallazgos de [hallazgos.md](hallazgos.md). Son las reglas que
hay que aplicar al arreglarlos (CLAUDE.md, regla 1). Los hallazgos que no están acá son bugs: el código tiene que
cumplir lo que ya dice la documentación, sin consultar.

Cada decisión sale de una pregunta con 3 opciones. Las marcadas "elegida" son las del dueño (algunas fueron
respuestas libres, y se anotan tal cual).

---

## Eventos y economía

- **Eventos — invitados (A9):** los invitados **cuentan** para el mínimo de personas, como hoy.
  - Regla: un evento necesita **más de 5 personas** en la sala.
- **Eventos — música (A9):** hace falta **música real**: el DJ tiene que estar reproduciendo audio (pista publicada).
  No hace falta sincronizar con Rekordbox ni tener tracklist.
- **Eventos — tope (A9):** **un evento por sala por día**. Un set más en la misma sala el mismo día no suma puntos.
  El tope es por sala, no por persona.
  - Interpretación de la respuesta libre: "La sala cuenta por día aunque haya más de un evento". Confirmar si
    era otra cosa.
- **Paquete inicial (A14):** solo **básicos**. Sin muebles especiales ni exóticos (el Trono no entra al paquete).
- **Visitas a salas de cuentas nuevas (economía #9):** **cuentan como hoy**. Visitar salas de cuentas recién
  creadas suma puntos y misiones. Se deja así a pesar del riesgo de farmeo.

## Diseños de artistas

- **Tope de diseños (M4):** **5 subidas por día** y **2 copias por día** por cuenta. Las copias son pocas para que
  sean más preciadas.

## Grupos, intercambio y beso

- **Grupo sin líder (M12):** si el líder se va de la sala, el liderazgo **pasa al siguiente** presente.
- **Intercambio — bloqueo al rechazar (M14):** el mismo bloqueo creciente que los grupos y el beso.
- **Intercambio — distancia (M14):** para invitar hace falta estar **cerca, ~3,5 m**.
- **Pedidos de beso/grupo sin respuesta (M21):** **se deja como está**. Un pedido que vence sin respuesta puede
  repetirse cada minuto; no cuenta como rechazo.
- **Beso y efecto del consumible (B8):** el beso **reinicia el efecto a 2 minutos** si ya hay uno activo.
  Es la excepción a la regla de "con efecto activo no se toma otro".
- **Silenciar (A13):** frena **chat y voz**, como hoy. Besos, intercambios, grupos y gestos del silenciado
  siguen llegando a los demás.

## Invitados y amistad

- **Invitado que vuelve tras ser baneado (M15):** baneo **por IP, 24 h**. Bloquea también a los invitados de
  la misma IP durante ese día.
- **Invitados y amigos (B14):** los invitados **no pueden tener amigos ni mandar solicitudes de amistad** (C2). Motivo del dueño: el invitado se
  reinicia al entrar y no guarda progreso, así que no tiene sentido.
- **Qué pueden hacer los invitados (B15):** **solo leer** (muro y notas). No reportan ni guardan favoritas.
- **Restringir a un amigo (M17):** **oculta tu ubicación y tu sala**. Ese amigo no ve tu sala en vivo y no puede
  entrar a tus salas de "solo amigos".
- **Cerrar sala o sacar de amigos con la persona adentro (M18):** **se la echa**, con aviso.

## Mapa social y privacidad

- **Buscador: estado conectado (B3):** **como hoy**. Cualquiera ve si estás conectado.
- **Sala cerrada sin sesión (B5):** **como hoy**. Nombre, descripción y dueño se ven sin sesión.

## Sala y mecánicas

- **Altura (M2):** **techo de altura por sala**, según la plantilla. No se suma al saldo de movimiento.
- **Track del DJ (M10):** **un cambio de tema cada 20 s** como máximo.
- **Partes de la sala (M8):** **una parte por persona**. Una persona no puede tener DJ, luces y pantalla a la vez.
  DJ y pantalla sí pueden estar activos al mismo tiempo, pero con personas distintas.

## Curaduría

- **Colusión de curadores (H6):** al mostrar obras para votar, **se priorizan** las de personas que no son amigas
  y no están en la misma IP. Es prioridad, no exclusión (la respuesta libre dice "se prioriza").
- **Cola de curación (H5):** **orden por fecha**, sin prioridad. No hay "prioridad para usuarios".

---

## Salas (26/10)

- **Plantilla fija:** la plantilla se elige al crear la sala y no se cambia. Para cambiarla hay que borrar la sala
  y crear otra (el juego avisa y pide confirmar antes de borrar), o crear una sala nueva.
- **Máximo 3 salas por persona.**
- Efecto en hallazgos: M11 (cambiar de plantilla no baja DJ ni artistas) deja de pasar por cambio de plantilla;
  queda por el borrado de la sala, que también tiene que bajar DJ, consola y pantallas.

Anotado también en [ROADMAP.md](ROADMAP.md), tabla de decisiones de diseño (filas nuevas y tachadas las viejas).

## No preguntados

Son bugs o cumplen reglas ya escritas en la documentación, así que no entran acá. Ejemplos: voz que no se
corta al alejarse (A1), ignorar sin cortar la voz (M16), cabina tomada desde cualquier lugar (M7), grupo con
nombres visibles (B1), corazones sin atril (H9).
