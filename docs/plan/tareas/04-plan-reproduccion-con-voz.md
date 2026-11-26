# 04 · Plan: reproducción del guion con voz

Lee antes `AGENTS.md` y abre `prototype/index.html` en un navegador: reprodúcelo entero, pausa, salta entre pasos. Esta tarea convierte ese prototipo en la aplicación real. Lee también lo que ya existe: `src/shared/script.ts`, `src/shared/playback.ts` (el reductor ya implementa las reglas de la reproducción; úsalo, no lo reescribas), `src/shared/diff.ts` (`checkFocus`), `src/shared/protocol.ts`, `src/server/server.ts`, `web/src/` y `test/e2e/viewer.spec.ts`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/04-script-playback`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Objetivo

Que `prwalk play guion.json` cargue un guion y la página lo reproduzca hablando, con la tira de pasos, los controles y el historial del prototipo. La página informa al demonio de por dónde va y `prwalk status` lo refleja. Todavía no hay preguntas ni respuestas en directo: eso es la tarea 05.

## Qué hay que entregar

### 1. Guion: un campo nuevo y validación contra el diff (`src/shared/`)

- **Campo `note` opcional en el paso:** texto corto que se muestra a la derecha del nombre del fichero (en el prototipo, "La pieza nueva"). Solo en pasos con `focus`.
- **`checkScriptAgainstDiff(script, index): string[]`:** recorre los pasos y comprueba con `checkFocus` el foco de cada paso y el rango propio de cada frase que lo tenga. Cada error va precedido de la posición, con el mismo formato que usa `validateScript` (`steps[3] (id "...") ...`). Devuelve todos los errores, no solo el primero.
- Actualiza `test/fixtures/example-script.json` con las notas del prototipo (el campo `why` de `STEPS`).
- Añade `test/fixtures/example.diff`: un diff unificado de git equivalente a los ficheros inventados del prototipo (constante `FILES`), de modo que el guion de ejemplo sea válido contra él.

### 2. Demonio

- **`PUT /api/script`** (con token): valida con `validateScript` y `checkScriptAgainstDiff`. Si hay errores, 422 con la lista. Si es válido: lo guarda, pone la posición a cero, borra el foco suelto de la tarea 03 y difunde un mensaje `script`. Sin sesión abierta, 409.
- **`DELETE /api/script`** (con token): descarga el guion y lo difunde.
- **`GET /api/script`**: el guion cargado, o 404.
- **Posición:** el visor envía por el WebSocket un mensaje `position` (`{ step, sentence, status }`, con el estado del reductor) cada vez que cambia. El demonio guarda la última y la incluye en `GET /api/session` como `playback`. Valida el mensaje con un esquema: un mensaje mal formado se ignora, no tumba la conexión.
- **Un solo visor activo:** al conectarse un visor nuevo, los anteriores reciben un mensaje `superseded`, dejan de reproducir y muestran que el recorrido se ha abierto en otra pestaña. Solo cuenta la posición del visor activo.
- **Al conectarse**, el visor activo recibe el guion vigente y la última posición conocida, y arranca en pausa en ese punto: recargar la página no hace perder el sitio.
- **`POST /api/focus` con un guion cargado:** 409 con un mensaje que dice que hay un guion en reproducción y que `prwalk play --clear` lo descarga.
- **Abrir una sesión nueva** descarga el guion.

### 3. Comandos

- **`prwalk play <fichero | ->`**: envía el guion. Salida, por ejemplo: `Loaded 8 steps (1 viewer). The viewer starts when the user presses Start.` Si no hay visor, avisa por stderr de que hay que abrir la URL. Guion inválido: código 1 con todos los errores, uno por línea.
- **`prwalk play --clear`**: descarga el guion.
- **`prwalk status`** añade una línea con la reproducción, por ejemplo `Playback: playing, step 3 of 8 "controller-block", sentence 2 of 3`, o `Playback: no script loaded`. En `--json`, los mismos datos.
- **`prwalk open --patch <fichero> [--title <texto>]`**: tercer origen del diff, un fichero de parche. Sirve para demos y pruebas sin una PR real. Mismo tratamiento de errores que los otros orígenes.

### 4. Visor: reproducción (`web/`)

Todo lo que sigue reproduce el prototipo. Donde este plan no diga otra cosa, manda el prototipo.

- **Motor de reproducción separado de React:** un módulo que recibe el guion y un proveedor de voz, aplica las acciones con el reductor de `src/shared/playback.ts` y ejecuta los efectos (decir la frase actual; al terminar, despachar `sentenceEnded`; al pausar o saltar, cancelar la voz). Tiene que ignorar el final de una frase cancelada: una pausa a mitad de frase no puede hacer avanzar. Así se prueba sin navegador.
- **Proveedor de voz**, como interfaz: decir un texto en un idioma con aviso al terminar, cancelar, y un nombre para mostrar.
  - **Web Speech:** usa `speechSynthesis`. Elige voz para el idioma del guion prefiriendo las de más calidad (las que el sistema marca como mejoradas o premium) y, a igualdad, la de la región exacta. Si la voz no arranca en 2,5 segundos, se cambia al proveedor silencioso y se indica en la cabecera. Espera a `voiceschanged` si la lista llega vacía.
  - **Silencioso:** temporizador proporcional a la longitud del texto. Es la reserva y lo que usan los tests. Se fuerza con `?voice=silent`, y `?voice=silent&speed=<n>` lo acelera.
  - Pausar es cancelar; reanudar repite la frase desde el principio. No uses la pausa nativa del navegador: falla con algunas voces.
- **Pantalla de inicio:** el navegador no deja hablar a una página sin un clic previo. Si llega un guion y la página aún no ha recibido ninguna interacción, muestra la tarjeta "Start" del prototipo. Si ya la hubo (por ejemplo, se carga un segundo guion), empieza sola.
- **Tira de pasos:** un botón por paso con su número y título, el actual destacado y los anteriores marcados; pulsar uno salta a ese paso. Se desplaza sola para mantener visible el actual.
- **Zona principal:** en un paso con `focus`, el fichero con el rango resaltado como en la tarea 03 y la nota del paso junto al nombre. Si la frase que suena tiene rango propio, el resaltado se estrecha a ese rango mientras dura. En un paso con `card`, la tarjeta del prototipo: encabezado, frase de entrada y lista de elementos.
- **Barra inferior:** barra de progreso; controles con iconos y texto alternativo: reiniciar recorrido, paso anterior, reiniciar paso, reproducir o pausar (más grande), paso siguiente. Atajos: Espacio, ←, →, R. Los atajos no actúan mientras está la pantalla de inicio.
- **Historial:** todo lo dicho hasta ahora, agrupado por paso con su título, la frase actual destacada. Se desplaza solo al final. En pausa crece hasta el 40 % de la altura y todo el texto se ve con contraste normal. Saltar a un paso ya visto añade un bloque nuevo; no borra lo anterior.
- **Cabecera:** añade el nivel del guion y la voz en uso.
- **Idioma de la interfaz:** los pocos textos fijos (Start, etiquetas de los controles, avisos) van en español o inglés según el idioma del guion; sin guion, según el navegador; cualquier otro idioma, inglés. Un diccionario pequeño en un fichero; nada de librerías.
- **Fin del recorrido:** al terminar queda en el último paso, con el estado `finished`; reproducir repite la última frase, como en el prototipo.
- **Sin guion**, la página se comporta como en la tarea 03.
- **Panel estrecho, tema claro y oscuro y accesibilidad básica** como en el prototipo: a 380 px los controles pasan a su propia fila; botones con nombre; foco visible.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| `note` solo en pasos con foco; `checkScriptAgainstDiff` detecta foco de paso inválido y rango de frase inválido y acepta el ejemplo contra `example.diff` | `shared` | Uno por decisión |
| Motor: una frase terminada avanza; una pausa cancela y el final tardío se ignora; reanudar repite la frase; saltar cancela y empieza el paso nuevo; al final queda `finished` | motor, con un proveedor de voz falso | Uno por decisión |
| Elección de voz: prefiere la mejorada, luego la región exacta, luego cualquiera del idioma, y nada si no hay | función pura | Uno con una lista de voces que cubra los cuatro casos |
| Historial: se acumula por paso y un salto atrás añade bloque | función pura | Uno |
| Guion inválido da 422 con todos los errores; uno válido se guarda y se difunde; la posición del visor llega a `GET /api/session`; un visor nuevo desbanca al anterior; `focus` con guion da 409; sesión nueva descarga el guion; mensaje `position` mal formado se ignora | servidor en proceso | Uno por decisión |
| `play` y `open --patch` conectan fichero, demonio y salida | CLI, binario compilado | Uno: abrir `example.diff`, cargar el guion de ejemplo, `status`, y un guion inválido |
| El recorrido de ejemplo se reproduce entero y el historial contiene todas las frases; Espacio pausa y no avanza; pulsar un paso salta a él; un paso de código muestra su rango resaltado y su nota; recargar conserva el paso | navegador, Playwright con `?voice=silent` acelerado | Uno por decisión |

## Qué no hay que hacer

- Nada de preguntas, respuestas habladas ni reescritura del guion en vivo: tarea 05. Ningún comando `pause`, `resume`, `goto`, `say` ni `replace`.
- No añadas voces en la nube ni modelos locales: solo Web Speech y el silencioso.
- No añadas selector de voz ni de velocidad en la interfaz.
- Dependencias nuevas: ninguna prevista. Si hace falta alguna, justificada en la PR con su licencia.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` y `pnpm build` en verde.
2. Comprobación a mano con un `PRWALK_HOME` temporal: `prwalk open --patch test/fixtures/example.diff --title "Add login rate limit"`, abrir la URL en un navegador, `prwalk play test/fixtures/example-script.json`, pulsar Start, y comprobar reproducción, pausa, saltos y `prwalk status`. `prwalk stop` al acabar. No dejes demonios ni navegadores vivos.
3. Si alguna regla de este plan resulta ambigua, elige lo que haga el prototipo, sigue y déjalo anotado como duda.
