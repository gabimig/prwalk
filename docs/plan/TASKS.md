# Tareas

Estados: `[ ]` pendiente · `[~]` en curso o con PR abierta · `[x]` mergeada.

Cada tarea es una rama, una PR en borrador y un entregable que se puede comprobar a mano. Van en orden: cada una parte de `main` con la anterior ya mergeada. El plan detallado de una tarea se escribe en `tareas/NN-plan-<slug>.md` justo antes de lanzarla, con lo aprendido en las anteriores.

| # | Estado | Tarea | Plan | PR |
|---|---|---|---|---|
| 01 | `[x]` | Esqueleto y contrato | [plan](tareas/01-plan-esqueleto-y-contrato.md) | [PR #1](https://github.com/gabimig/prwalk/pull/1) |
| 02 | `[x]` | Demonio, origen del diff y CLI base | [plan](tareas/02-plan-demonio-y-diff.md) | [#2](https://github.com/gabimig/prwalk/pull/2) |
| 03 | `[x]` | Visor web con foco dirigido | [plan](tareas/03-plan-visor-con-foco.md) | https://github.com/gabimig/prwalk/pull/3 |
| 04 | `[x]` | Reproducción del guion con voz | [plan](tareas/04-plan-reproduccion-con-voz.md) | [PR #4](https://github.com/gabimig/prwalk/pull/4) |
| 05 | `[x]` | Interacción en vivo | [plan](tareas/05-plan-interaccion-en-vivo.md) | [#5](https://github.com/gabimig/prwalk/pull/5) |
| 06 | `[x]` | Skill, empaquetado y pulido | [plan](tareas/06-plan-skill-y-empaquetado.md) | [PR #6](https://github.com/gabimig/prwalk/pull/6) |
| 07 | `[x]` | Proveedores de voz enchufables y pausas | [plan](tareas/07-plan-voces-enchufables-y-pausas.md) | https://github.com/gabimig/prwalk/pull/7 |
| 08 | `[x]` | Voz local recomendada, instalable con un comando | [plan](tareas/08-plan-voz-local-recomendada.md) | [PR #8](https://github.com/gabimig/prwalk/pull/8) |
| 09 | `[x]` | Repositorio público y versión 0.1 | [plan](tareas/09-plan-version-publica.md) | https://github.com/gabimig/prwalk/pull/9 |
| 10 | `[x]` | Preferencias del usuario | [plan](tareas/10-plan-preferencias-del-usuario.md) | https://github.com/gabimig/prwalk/pull/2 |
| 12 | `[~]` | Aviso de versión nueva y `prwalk update` | [plan](tareas/12-plan-aviso-de-version-nueva.md) | https://github.com/gabimig/prwalk/pull/4 |

## 01 · Esqueleto y contrato

Deja el repositorio listo para trabajar y fija el contrato que usan todas las demás piezas.

- **Entrega:** proyecto TypeScript con lint, tipos, tests y CI; el esquema del guion con su validación; la máquina de estados de la reproducción como función pura; el comando `prwalk validate`.
- **Cómo se comprueba:** `pnpm lint && pnpm typecheck && pnpm test` en verde; `prwalk validate` acepta el guion de ejemplo y rechaza uno roto diciendo en qué paso está el error; la CI pasa en la PR.

## 02 · Demonio, origen del diff y CLI base

- **Entrega:** `prwalk open <PR | --base rama>` obtiene el diff (con `gh` o `git`), arranca el demonio local si no está y devuelve la URL; `prwalk diff` imprime el índice de ficheros y hunks con sus rangos de líneas, que es lo que el agente necesita para escribir el guion; `prwalk status` y `prwalk stop`.
- **Cómo se comprueba:** contra un repositorio git de prueba y contra una PR real: el índice coincide con el diff, el demonio arranca una sola vez y se para limpio. La URL sirve una página provisional.
- **Riesgo que cierra:** elegir el parser de diffs del lado servidor y confirmar que sus números de línea casan con los del visor.

## 03 · Visor web con foco dirigido

- **Entrega:** la página real con el diff pintado por `@pierre/diffs`, cabecera de la PR y el diseño del prototipo; `prwalk focus <fichero> --lines a-b` hace que el navegador abra ese fichero, haga scroll y resalte el rango atenuando el resto.
- **Cómo se comprueba:** con el visor abierto en el navegador integrado, lanzar varios `focus` seguidos y ver el resaltado moverse entre ficheros; tema claro y oscuro; panel estrecho.
- **Riesgo que cierra:** que el scroll y el resaltado programáticos de `@pierre/diffs` funcionen como dice su documentación. Si no, se cambia de librería aquí y no más tarde.

## 04 · Reproducción del guion con voz

- **Entrega:** `prwalk play guion.json` carga el guion validado contra el diff; la página lo reproduce como el prototipo: tira de pasos clicable, controles y atajos, tarjetas para los pasos sin código, panel de historial, pantalla de inicio por el clic que exige el navegador, voz con la Web Speech API y proveedor silencioso de reserva. La posición llega al demonio y `prwalk status` la refleja.
- **Cómo se comprueba:** el guion de ejemplo se reproduce entero y suena; pausar, saltar y reiniciar paso se comportan como en el prototipo; `status` dice paso y frase correctos tras cada acción.

## 05 · Interacción en vivo

- **Entrega:** `prwalk pause`, `resume`, `goto <paso>`; `prwalk say "..." [--file --lines]` para responder una pregunta en voz alta enseñando código si hace falta, que queda en el historial como respuesta; `prwalk replace --from <paso>` para reescribir lo que queda; `prwalk wait` y un registro de eventos para que el agente sepa qué hizo el usuario (pausó en tal frase, saltó a tal paso).
- **Cómo se comprueba:** un escenario completo por CLI: reproducir, pausar desde la página, preguntar, responder con `say`, reanudar, reescribir los pasos finales.

## 06 · Skill y empaquetado

- **Entrega:** la skill mínima y la guía completa que imprime `prwalk skill` (cómo construir el guion, los tres niveles de detalle, el orden de los ficheros, el resumen de tests, cómo reaccionar a pausas y preguntas, idioma); instalación con un comando; README.
- **Cómo se comprueba:** un agente en blanco, solo con la skill, hace un walkthrough de una PR real de principio a fin, y se repite pidiendo otro nivel de detalle.

## 07 · Proveedores de voz enchufables y pausas

- **Entrega:** la voz pasa a ser una pieza enchufable: por defecto la del navegador, y cualquier otro proveedor (local o en la nube) con un adaptador pequeño que carga el demonio. Comandos `prwalk voice`, `voice use`, `voice test`, `voice guide`. Silencios entre frases y entre pasos. La guía del agente pregunta por la voz la primera vez.
- **Cómo se comprueba:** con el adaptador de ejemplo que envuelve `say`, el visor reproduce el audio que sirve el demonio; si el adaptador falla, sigue con la voz del navegador; las pausas se notan.

## 08 · Voz local recomendada

- **Entrega:** `prwalk voice install <nombre>` descarga e instala bajo demanda una voz neuronal local de licencia permisiva que suene bien en español e inglés (candidata: Kokoro), fuera de las dependencias del paquete. La guía la ofrece la primera vez.
- **Cómo se comprueba:** en una máquina limpia, un comando la deja funcionando y Gabriel la oye.

## 09 · Repositorio público y versión 0.1

- **Entrega:** licencia, README pensado para que un agente instale prwalk a partir de la URL del repositorio, versión 0.1.0 publicada e instalable con un comando, repositorio público.
- **Cómo se comprueba:** en una sesión nueva, "instala esto: <URL>" deja `prwalk` y la skill funcionando sin más ayuda.
