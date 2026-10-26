# Hallazgos de las pruebas con agentes (26/10)

Seis agentes jugaron con robots contra un servidor local aparte (`npm run dev:alt`, puerto 8788) buscando
huecos: economía, acoso, saturación, permisos, archivos tramposos y mecánicas raras. Acá está todo junto,
sin repetidos y ordenado por gravedad. El detalle de cada uno (pasos para reproducir, fragmentos de script,
archivo y línea) está en [`docs/hallazgos/`](hallazgos/), un archivo por agente.

- **Rep.** = reproducido con robots (o, en archivos, contra `checkGLB` directo). **Hip.** = hipótesis (leído
  en el código, no se pudo completar en local).
- **🗳️ Decidir** = antes de arreglarlo hay que definir una regla (CLAUDE.md, regla 1).
- Para ir tachando: cambiá `[ ]` por `[x]` cuando esté arreglado (con su prueba en `test/`).

**Total: 2 críticos · 14 altos · 23 medios · 16 bajos** (sin contar las hipótesis menores de cada informe).

---

## Críticos

- [ ] **C1. Un `.glb` de menos de 1 KB congela las cuentas de todo el mundo.** `checkGLB` recorre la jerarquía
  de nodos sin recordar los ya visitados: un nodo que apunta dos veces al siguiente, 24 niveles, son 16 millones
  de visitas (14,7 s; con 30 niveles, ~15 min). Corre adentro de `Accounts` (un solo hilo): mientras tanto no
  anda login, inventario, amigos ni nada. Rep. — `server/glb.js` (`visit`). *Arreglo:* conjunto de visitados y
  rechazar nodos usados más de una vez (en glTF válido cada nodo tiene un solo padre). [archivos #1]
- [ ] **C2. Cualquiera ve en vivo en qué sala estás con solo mandarte una solicitud de amistad**, aunque sea un
  invitado descartable y aunque lo restrinjas o ignores: la lista de solicitudes pendientes trae la sala.
  Rep. — `server/accounts.js` (`friends`, ~l. 611). *Arreglo:* mostrar la sala solo a amigos aceptados. [acoso #1]

## Altos

- [ ] **A1. Voz: la distancia se controla solo al suscribirse.** Te acercás una vez, te alejás y seguís
  escuchando desde cualquier punto de la sala (probado a 195 m). `enforce` no corre al moverse.
  Rep. (lógica de la sala con SFU simulado) — `server/room.js` (`pullBlocked`/`enforce`). *Arreglo:* correr
  `enforce` periódicamente o cuando cambian las posiciones. [acoso #2, permisos H5]
- [ ] **A2. OAuth: el `state` no está atado al navegador.** Si alguien sin cuenta entra con Google desde un
  link armado por otro, queda dentro del invitado del atacante, que conserva la sesión (toma de cuenta).
  Hip. — `server/accounts.js` (`oauthStart`/`oauthCallback`). *Arreglo:* cookie o valor en el navegador que
  se compare al volver. [permisos H1]
- [ ] **A3. Google sin nick + `register`:** una cuenta entrada por Google y sin nick cuenta como invitado para
  `register`, se puede poner un mail ajeno con contraseña y queda `email_verified = 1`. Hip. — `accounts.js`
  (`register`, `isGuest`). [permisos H2]
- [ ] **A4. Las esculturas del Museo no pasan por `checkGLB`:** solo se mira que pese < 2 MB y empiece con
  `glTF` (sin triángulos, texturas, alto ni extensiones). Por código — `server/works.js` (~l. 116).
  *Arreglo:* usar el mismo `checkGLB`. [archivos #2]
- [ ] **A5. Tamaño del modelo falseado:** `checkGLB` mide con los `min`/`max` declarados, no con los vértices:
  declara 1 m y mide 30 m (o declara ≤ 50 cm, se sostiene en la mano y es gigante). Rep. — `server/glb.js`.
  *Arreglo:* leer las posiciones reales (float32 sin comprimir) y comparar; para Draco/meshopt acotar en el
  cliente. [archivos #3]
- [ ] **A6. Triángulos multiplicados reusando nodos:** se cuentan por malla, no por nodo; una malla de 5.000
  tris en 500 nodos pasa como 5.000 y dibuja 2,5 millones. Rep. — `server/glb.js`. *Arreglo:* contar
  dentro del recorrido de nodos. [archivos #4]
- [ ] **A7. Texturas por `data:` URI no se miden:** una imagen enorme embebida pasa el tope de 1024 px y puede
  tumbar la pestaña de quien carga el modelo. Rep. (el paso) — `server/glb.js`. *Arreglo:* medir también las
  `data:` o prohibirlas. [archivos #5]
- [ ] **A8. Cambiazo en el intercambio:** el "Estoy listo" no queda atado a la oferta vista; si el otro cambia
  justo antes, tu "listo" vale para la nueva (viste un minibar, recibiste espejos). Rep. — `server/room.js`
  (intercambio, ~l. 1088). *Arreglo:* el `ready` lleva la versión de la oferta. [economía #1]
- [ ] **A9. Eventos farmeables sin límite 🗳️:** una cuenta + 5 invitados de relleno + cabina con un `streamId`
  inventado (sin música); reenviando `dj on` con otro id arranca un evento nuevo. ~600 puntos/hora, niveles,
  objetos e insignia Fiestero. Rep. — `server/progress.js` (~l. 362-386), `room.js`. *Decidir:* ¿cuentan los
  invitados?, ¿hace falta música de verdad?, ¿tope de eventos por día? [mecánicas #1, economía #5, permisos H4]
- [ ] **A10. Cientos de conexiones bloquean una sala ~10 s:** 300 WebSocket con joins falsos llevan la
  latencia de 17 ms a 10 s; no hay tope por sala ni freno por IP en `/ws/`. Rep. — `server/worker.js`,
  `room.js`. *Arreglo:* tope de conexiones sin entrar por sala/IP y cerrar antes las mudas. [saturación #1]
- [ ] **A11. Spam de avisos de amistad:** cancelar y reenviar la solicitud en bucle llena los avisos de la víctima
  (aunque te haya restringido o ignorado, y desde invitados); el bloqueo de 24 h solo se arma si rechaza.
  Rep. — `server/accounts.js` (~l. 620, 651). [acoso #3, permisos H14]
- [ ] **A12. El antiflood del chat se reinicia al reconectar** (va por conexión, no por cuenta): 20 mensajes en
  1,3 s. Rep. — `server/room.js` (~l. 385). *Arreglo:* contarlo por cuenta. [acoso #4]
- [ ] **A13. Silenciar no frena casi nada:** el silenciado igual manda besos, invitaciones a intercambio y a
  grupo, y gestos. Rep. — `server/room.js`. *Arreglo:* que silenciado frene todo lo que llega a otros. [acoso #5]
- [ ] **A14. Granja de cuentas 🗳️:** cada cuenta nueva trae 15 objetos al azar (con muebles raros y exóticos) que
  se pasan a la principal por intercambio; con el freno por IP, ~300 objetos/hora. Rep. — `accounts.js`
  (`giveStarter`). *Decidir:* paquete inicial más chico, sin especiales, o intransferible por un tiempo. [economía #2]

## Medios

- [ ] **M1. Teletransporte reconectando:** la posición del `join` (y la primera `s`) no pasa por el control de
  velocidad; reconectar te deja aparecer donde quieras (probado juntando un objeto a 40 m). Rep. —
  `server/room.js` (~l. 292). *Arreglo:* validar el `join` contra la entrada de la sala o la última posición
  conocida de la cuenta. [saturación #2, mecánicas #8, permisos H3]
- [ ] **M2. La altura no tiene control:** se puede "volar" 480 m, soltar algo a 300 m y juntarlo desde arriba.
  Rep. — `room.js` (case `s`). *Decidir/arreglar:* incluir `y` en el saldo con margen para caídas. [saturación #3, mecánicas #9, permisos H16]
- [ ] **M3. `consume` y `kiss` fuera del antiflood pesado (`HEAVY`):** una conexión fuerza ~70 llamadas/s a
  `Accounts`. Rep. — `room.js` (~l. 55). [saturación #4, mecánicas #16]
- [ ] **M4. Diseños y copias sin tope 🗳️:** se aceptaron 25 estampas de 800 KB y 200 copias seguidas (el Museo
  tiene 5 por día; los diseños, nada). Rep. — `server/designs.js`. *Decidir:* tope por día/cuenta. [saturación #5]
- [ ] **M5. Muebles ocultos de los mapas públicos en la sala propia:** el editor deja poner `hidden` (la barra
  de la Cafetería reparte café gratis y desvaloriza Cafetera/Minibar/Barra). Rep. — `server/editor.js`
  (~l. 65). *Arreglo:* rechazar `hidden` en `add`. [economía #3, permisos H8]
- [ ] **M6. Obras fijas inventadas en la progresión:** `progressview` con `fixed` cualquiera cumple "Mirá 3
  obras" y el paso 1 del camino. Rep. — `server/progress.js` (~l. 305). *Arreglo:* lista de obras fijas
  válidas. [economía #4, mecánicas #11, permisos H15]
- [ ] **M7. La cabina y la consola se toman desde cualquier punto de la sala** (el servidor no mira la
  distancia). Rep. — `room.js` (~l. 417-461). [mecánicas #2, permisos H10]
- [ ] **M8. Una persona acapara DJ + luces + pantalla (+ 2ª pantalla)** aunque la decisión es una parte cada uno.
  Rep. — `room.js`. [mecánicas #3]
- [ ] **M9. Spam de avisos del sistema** con `dj on` / `part on/off` en bucle (~5/s, "ignorar" no los filtra).
  Rep. — `room.js`. [mecánicas #4]
- [ ] **M10. El "track" del DJ es un chat libre** sin antiflood, sin "chat deshabilitado" y sin "ignorar".
  Rep. — `room.js` (~l. 433). [mecánicas #5]
- [ ] **M11. Sacar la cabina/consola/pantalla o cambiar de plantilla no baja al DJ ni a los artistas.** Rep. —
  `server/editor.js`. [mecánicas #6]
- [ ] **M12. Grupo de voz acéfalo 🗳️:** si el líder cierra la pestaña sigue como líder y ocupando lugar; nadie
  puede invitar ni sacarlo. Rep. — `room.js` (~l. 1157). *Decidir:* ¿pasa el liderazgo?, ¿se disuelve? [mecánicas #7]
- [ ] **M13. Al hibernar la sala (unos 30 s sin mensajes) se pierde quién tiene la cabina, la consola y las luces**,
  y también intercambios y efectos: otro puede tomar la cabina con el DJ adentro. Rep. — `room.js` (estado
  en memoria). *Arreglo:* guardar en storage lo que tiene que sobrevivir. [permisos H19, economía]
- [ ] **M14. Intercambio:** rechazar no tiene bloqueo creciente, reconectar renueva la invitación al instante y
  no hace falta estar cerca (30 m). Rep. — `room.js`. 🗳️ (¿mismo bloqueo que grupos/beso? ¿distancia?) [acoso #6]
- [ ] **M15. Invitados descartables 🗳️** esquivan ignorar, el bloqueo del beso y el baneo de una sala personal.
  Rep. *Decidir:* ¿se banea por IP/navegador?, ¿invitados sin ciertas interacciones? [acoso #7, permisos H12]
- [ ] **M16. "Ignorar" no impide que el ignorado escuche tu voz** (la sala no consulta los ignorados al
  suscribir). Rep. (lógica) — `room.js` (`pullBlocked`). [acoso #8]
- [ ] **M17. Restringir o ignorar a un amigo no le saca nada 🗳️:** sigue viendo tu sala en vivo, entra a tu
  sala "solo amigos", ve y le da me gusta a tus fotos (hoy es coherente con la regla actual). [acoso #9]
- [ ] **M18. Cerrar la sala o sacar a alguien de amigos no echa a quien ya está adentro 🗳️.** Rep. [acoso #10, permisos H11]
- [ ] **M19. Suplantación de nombres:** un invitado se llama igual que una cuenta con letras cirílicas o un
  espacio invisible (U+200B), o con un nombre invisible. Rep. — `shared.js` (`cleanName`). *Arreglo:* sacar
  invisibles/bidi y comparar con nicks registrados (normalizado). [acoso #11, permisos H7]
- [ ] **M20. Chat:** caracteres invisibles esquivan el filtro de repetidos; pasan texto invertido (U+202E) y
  "zalgo" (281 combinantes). Rep. — `room.js`. [acoso #12]
- [ ] **M21. Pedidos de beso y grupo sin respuesta repetibles cada minuto para siempre 🗳️** (es la regla
  actual; ¿alcanza?). [acoso #13]
- [ ] **M22. Curadores: `reviewvote` acepta cualquier obra pendiente por id**, no solo la que les tocó al azar.
  Hip. — `server/works.js`. [permisos H6]
- [ ] **M23. Mallas comprimidas (Draco/meshopt): el conteo de triángulos cree en `count`.** Hip. —
  `server/glb.js`. [archivos #6]

## Bajos

- [ ] **B1.** Todos los de la sala ven quién está en un grupo privado con quién (llegan los ids). [acoso #14]
- [ ] **B2.** Solicitudes de amistad sin tope (6 en 75 ms) y mandarlas ya suma progresión. [acoso #15]
- [ ] **B3.** El buscador le muestra a cualquiera si estás conectado. [acoso #16]
- [ ] **B4.** Gestos: 5 por segundo a toda la sala (también silenciado). [acoso #17]
- [ ] **B5.** Una sala cerrada muestra nombre, descripción y dueño a cualquiera sin sesión. [acoso #18]
- [ ] **B6.** Se puede tomar `escenario2` en el Museo, que no tiene segunda pantalla (`hasGear` sin layout). [mecánicas #10]
- [ ] **B7.** El efecto de 2 minutos vive en cada sala: en otra se toma otro enseguida. [mecánicas #12, economía #8]
- [ ] **B8. 🗳️** El beso renueva el efecto aunque esté activo; su distancia no mira la altura. [mecánicas #13]
- [ ] **B9.** `consume` (barra) usa `CONSUMABLES[kind]` sin `Object.hasOwn`: `'constructor'` se acepta y se
  reparte a la sala. Rep. — `room.js`. [saturación #6, mecánicas #14]
- [ ] **B10.** Las salas favoritas aceptan salas que no existen (falta `isRoomName`). [mecánicas #15]
- [ ] **B11.** Si los dos ofrecen a la vez en un intercambio, una oferta se descarta en silencio (contador de
  versión compartido). [economía #6]
- [ ] **B12.** Dos consumibles a la vez: se gastan los dos y el efecto es uno. [economía #7]
- [ ] **B13.** Se dejan corazones en una sala sin atril. [permisos H9]
- [ ] **B14. 🗳️** Los invitados pueden tener amigos y con eso entran a salas "solo amigos". [permisos H13]
- [ ] **B15. 🗳️** Los invitados pueden reportar, leer el muro y guardar favoritas (no están en la lista de vedadas). [permisos H17]
- [ ] **B16.** `PUT me` sin `look` borra el personaje; `oauthstart` acepta cualquier origen https (no explotable:
  Google/Discord validan la vuelta). [permisos H18]

---

## Decisiones que hacen falta (🗳️)

1. **Eventos (A9):** ¿cuentan los invitados como "personas"?, ¿hace falta música real (audio publicado)?, ¿tope
   de eventos por día?
2. **Paquete inicial (A14):** ¿se achica, sin especiales, o intransferible por un tiempo?
3. **Diseños (M4):** tope de subidas y de copias por día.
4. **Grupo sin líder (M12):** ¿pasa al siguiente o se disuelve?
5. **Intercambio (M14):** ¿bloqueo creciente al rechazar y distancia mínima, como grupos y beso?
6. **Invitados (M15, B14, B15):** ¿cómo frenar al que vuelve como invitado?, ¿pueden tener amigos, reportar,
   favoritas?
7. **Restringir/ignorar a un amigo (M17)** y **cerrar sala / sacar de amigos con la persona adentro (M18):**
   ¿se lo echa o se lo deja?
8. **Beso y grupos (M21, B8):** ¿bloqueo para pedidos sin respuesta?, ¿el beso renueva el efecto?
9. **Altura (M2):** ¿se controla?

## Cómo se probó

- Servidor aparte (`npm run dev:alt`, 8788) con datos propios; nunca contra lo online.
- Robots: los clientes de `test/helpers.mjs`. Para no chocar con el freno de 20 cuentas por hora por IP
  (compartido entre los agentes), en local mandaron un `CF-Connecting-IP` inventado; online Cloudflare lo
  pisa, así que no es un hallazgo.
- Voz: el servidor de audio real no se usó (la clave de `.dev.vars` llamaría a Cloudflare); la lógica de la
  sala se probó con una respuesta simulada.
- Lo que anda bien está en la sección "Cosas que probé y están bien" de cada informe en `docs/hallazgos/`.
