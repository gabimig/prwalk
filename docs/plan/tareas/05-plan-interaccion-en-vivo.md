# 05 · Plan: interacción en vivo

Lee antes `AGENTS.md` y lo que ya existe, sobre todo `src/shared/protocol.ts`, `src/shared/playback.ts`, `src/server/server.ts`, `src/cli/session-commands.ts`, `web/src/playback/` (el motor de reproducción), `web/src/voice/`, `web/src/Player.tsx` y `test/e2e/`. Arranca la aplicación una vez para verla funcionar: `pnpm build`, `prwalk open --patch test/fixtures/example.diff --title Example`, `prwalk play test/fixtures/example-script.json`, y abre la URL con `?voice=silent&speed=4`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/05-live-interaction`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Objetivo

Que el agente pueda acompañar el recorrido en directo, como alguien que presenta una PR en una llamada: saber qué hace el usuario, pausar y saltar, responder una pregunta en voz alta enseñando el código que haga falta, y reescribir lo que queda del guion cuando la pregunta cambia el plan.

Hay tres niveles, de más a menos frecuente:

1. **Pausar y continuar.** Lo hace el usuario en la página; el agente solo se entera.
2. **Paréntesis.** El agente responde una pregunta. **No toca el guion.** El recorrido queda en pausa donde estaba, la respuesta se dice en voz alta con un foco opcional en cualquier código del diff, queda en el historial, y después se vuelve al paso.
3. **Reescribir lo que queda.** Solo cuando la pregunta cambia el plan.

## Qué hay que entregar

### 1. Eventos: que el agente sepa qué ha pasado

- El mensaje `position` del visor añade `cause`: `user` (botón, atajo o clic en un paso), `agent` (orden recibida del demonio) o `auto` (terminó una frase).
- El demonio deriva de esos mensajes un registro de eventos numerados, en memoria, con un máximo de 200: `paused`, `resumed`, `jumped` (de qué paso a cuál), `finished`, `aside-ended`. Cada uno guarda su causa y la posición.
- El demonio recuerda hasta qué evento ha visto el agente. `prwalk status` y `prwalk wait` devuelven los no vistos y los marcan como vistos.
- **`prwalk status`** añade: el texto de la frase actual (para que el agente sepa a qué se refiere el usuario con "eso"), si hay un paréntesis en curso, y los eventos no vistos, uno por línea. Ejemplo de evento: `user paused at step 3 "limiter-failures", sentence 2`.
- **`prwalk wait [--timeout <segundos>]`**: se queda esperando hasta que haya un evento no visto causado por el usuario, o `finished`, o `aside-ended`, y entonces imprime lo mismo que `status`. Si ya había alguno al llamarlo, vuelve al momento. Tiempo máximo por defecto 300 segundos; al agotarse imprime el estado con una línea que dice que no ha pasado nada y sale con 0. Se implementa con una petición HTTP que el demonio retiene.

### 2. Órdenes de transporte

- **`prwalk pause`**, **`prwalk resume`**, **`prwalk goto <paso>`**, donde el paso es su `id` o su número empezando en 1.
- El demonio las reenvía al visor activo por el WebSocket; el visor las aplica con el mismo motor que los botones. El comando espera hasta 2 segundos a la siguiente posición del visor y la imprime en una línea; si no llega, dice que la orden se envió pero el visor no ha respondido.
- Sin guion cargado o sin visor activo: código 1 con un mensaje que dice qué falta.
- `goto` con un paso que no existe: código 1 con la lista de pasos válidos.

### 3. Paréntesis: `prwalk say`

`prwalk say <texto | -> [--question <texto>] [--file <ruta> --lines <a-b> [--side old]] [--resume]`

- El texto es la respuesta. El visor lo parte en frases para decirlo, igual que la narración.
- `--question` es la pregunta del usuario tal como la entendió el agente; se muestra en el historial encima de la respuesta.
- `--file` y `--lines` son un foco opcional sobre cualquier fichero del diff, validado con `checkFocus`; inválido, 422 y código 1.
- **En el visor:**
  - La reproducción principal pasa a pausa, conservando su posición.
  - Si hay foco, la zona principal lo muestra con una etiqueta que indica que es una respuesta, no un paso del guion. Si no hay foco, la zona principal no cambia.
  - La barra inferior indica que hay un paréntesis en curso y en qué paso espera el recorrido.
  - El historial añade, dentro del bloque del paso actual, la pregunta y la respuesta, diferenciadas visualmente de la narración.
  - La tira de pasos no cambia.
  - Mientras suena la respuesta, Espacio la pausa y la reanuda (repitiendo la frase). Cualquier salto (siguiente, anterior, reiniciar, clic en un paso, `goto`) cancela el paréntesis y hace el salto.
  - **Al terminar la respuesta**, la zona principal vuelve al paso donde estaba y la página **se queda en pausa esperando**. Reproducir repite la frase interrumpida y sigue con el guion. Con `--resume`, retoma sola.
- Varios `say` seguidos se encolan y se dicen en orden. El paréntesis termina cuando la cola se vacía.
- El comando vuelve en cuanto el demonio entrega el mensaje; no espera a que termine de hablar. Para esperar está `prwalk wait`, que recibe `aside-ended`.
- El estado del paréntesis vive en el motor del visor, al lado del estado principal, no dentro del reductor de `src/shared/playback.ts`: el reductor sigue describiendo solo el guion. La posición que el visor informa añade un campo `aside` con su estado.
- Sin guion cargado, `say` funciona igual, como voz y foco sueltos.
- `prwalk focus` con un guion cargado sigue rechazado; su mensaje pasa a recomendar `prwalk say --file ... --lines ...`.

### 4. Reescribir lo que queda: `prwalk replace`

`prwalk replace --from <paso> <fichero | ->`

- El fichero es un array JSON de pasos, con el mismo formato que `steps` en el guion. Sustituye los pasos desde `--from` (incluido) hasta el final. Un array vacío es válido si queda al menos un paso antes: sirve para acortar.
- El guion resultante se valida entero (`validateScript` y `checkScriptAgainstDiff`); con errores, 422 y no cambia nada.
- **En el visor:** si el paso actual es anterior a `--from`, la reproducción no se interrumpe y solo cambia la tira de pasos. Si no, va a la primera frase del paso `--from` y queda en pausa; si ese paso ya no existe porque el guion se acortó, queda en `finished` en el último. El historial se conserva siempre.
- `prwalk play` con un guion entero sigue sirviendo para empezar de cero.

### 5. Ajustes pendientes de la tarea 04

- **Elección de voz:** en macOS se está eligiendo "Eddy", una de las voces de baja calidad del sistema. Entre las voces locales de un idioma, las de este grupo van siempre al final: Eddy, Flo, Grandma, Grandpa, Reed, Rocko, Sandy, Shelley, y las de broma (Albert, Bad News, Bahh, Bells, Boing, Bubbles, Cellos, Good News, Jester, Organ, Superstar, Trinoids, Whisper, Wobble, Zarvox). El orden queda: mejorada o premium, luego voz normal de la región exacta, luego voz normal del idioma, y solo al final las de ese grupo.
- **Recentrar al cambiar el tamaño:** al pausar, el historial crece y tapa parte del rango resaltado. Cuando la zona principal cambia de altura, el rango vuelve a centrarse.
- **`prwalk play --json` con guion inválido:** añade `errors` como array, además de `error`.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| Motor: un paréntesis pausa el guion y conserva la posición; al acabar queda en pausa; con `resume` retoma; un salto lo cancela; dos se encolan; Espacio pausa el paréntesis y no el guion | motor, con voz falsa | Uno por decisión |
| Partir un texto en frases | función pura | Uno con varios signos de puntuación y abreviaturas sencillas |
| Derivar eventos de una secuencia de posiciones con su causa | función pura en `shared` o servidor | Uno por tipo de evento |
| Fusión de `replace`: sustituye desde el paso; rechaza un resultado inválido sin cambiar nada; array vacío acorta | función pura en `shared` | Uno por decisión |
| Orden de voces con el grupo de baja calidad al final | función pura | Amplía el test existente con ese caso |
| Demonio: `wait` vuelve al llegar un evento de usuario y no con uno `auto`; vuelve al momento si había no vistos; se agota el tiempo; `status` marca como vistos; una orden se reenvía solo al visor activo; `say` con foco inválido da 422; `replace` difunde el guion nuevo | servidor en proceso, con un cliente `ws` que hace de visor | Uno por decisión |
| Los comandos nuevos conectan argumentos, demonio y salida | CLI, binario compilado, con un visor falso por `ws` | Uno, como escenario: `pause`, `status`, `say`, `goto`, `replace`, `wait` |
| Una respuesta aparece en el historial con su pregunta, muestra su foco y al acabar se vuelve al paso en pausa; `replace` cambia la tira de pasos sin perder el historial; pausar en la página produce el evento que `status` enseña | navegador, Playwright con `?voice=silent` acelerado | Uno por decisión |

## Qué no hay que hacer

- No añadas caja de texto ni micrófono en la página: las preguntas llegan por el chat del agente.
- No añadas selector de voz ni de velocidad en la interfaz.
- No persistas eventos ni historial en disco.
- No cambies el formato del guion ni las reglas del reductor.
- Dependencias nuevas: ninguna prevista.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` y `pnpm build` en verde.
2. Comprobación a mano con un `PRWALK_HOME` temporal y un navegador con `?voice=silent&speed=3`: abrir el ejemplo, reproducir, pausar desde la página, `prwalk status`, `prwalk say "..." --question "..." --file src/config/auth.ts --lines 6-7`, `prwalk wait`, `prwalk resume`, `prwalk replace --from 7` con dos pasos nuevos, `prwalk goto 1`. `prwalk stop` al acabar. No dejes demonios ni navegadores vivos.
3. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
