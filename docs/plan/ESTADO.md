# Estado

Bitácora del proyecto, lo más reciente arriba.

## 27/11/2026 · Tareas 10 y 11

- **Tarea 10:** [#2](https://github.com/gabimig/prwalk/pull/2), mergeada y publicada como 0.1.1. Las preferencias del usuario viven en `<PRWALK_HOME>/preferences.md`; `prwalk skill` imprime la guía y detrás las preferencias, y `prwalk preferences` las enseña, da su ruta o las restablece.
- **Tarea 11:** árbol de ficheros a la izquierda del diff (el fichero en curso se marca; un botón lo oculta, y empieza oculto por debajo de 720 px). Los pasos de tarjeta pueden señalar carpetas o ficheros con `path` en sus elementos y frases, y el árbol los ilumina mientras se nombran; `check-script` rechaza rutas que no están en el diff y sugiere parecidas. La guía pide presentar el resumen por zonas. Versión 0.2.0.
- **Siguiente paso:** revisar la PR de la tarea 11; la etiqueta y la publicación las hace la sesión coordinadora.


## 26/11/2026 · Tarea 09 mergeada, licencia GPL y repositorio limpio

- **PR:** [#9](https://github.com/gabimig/prwalk/pull/9), mergeada. Metadatos del paquete, publicación por versiones de GitHub (`release.yml`), README que un agente puede seguir, `SECURITY.md`. 175 tests.
- **Licencia:** Gabriel cambia de opinión: GPL-3.0-or-later en vez de MIT ("pon licencia GPL, luego si eso cambio a otra"). Las dependencias (MIT, Apache-2.0, BSD, ISC) son compatibles.
- **Repositorio limpio:** el historial antiguo y la PR 1 nombraban otra cuenta de GitHub de Gabriel. El repositorio se publica con un historial nuevo; el antiguo queda privado como archivo. Por eso los enlaces a las PR 1 a 9 de este documento y de `TASKS.md` no se abren desde el repositorio público.
- **Siguiente paso:** que Gabriel lo instale desde la URL en una conversación nueva y elija voz.

## 25/11/2026 · Tarea 08 mergeada

- **PR:** [#8](https://github.com/gabimig/prwalk/pull/8), mergeada. Catálogo de voces instalables con una voz, `kokoro` (Kokoro-82M v1.0 sobre `sherpa-onnx-node` 1.13.8, español e inglés); `prwalk voice list`, `voice install`, `voice remove`. 174 tests.
- **Verificado a mano:** instalación real en una carpeta temporal en 46 segundos (unos 430 MB en disco); una frase de 10 segundos se sintetiza en unos 2. Muestras de audio entregadas a Gabriel (Dora, Alex y Santa en español; inglés).
- **Descartado:** `kokoro-js`, que solo convierte a fonemas en inglés.
- **Licencias:** el motor y el modelo son Apache-2.0, pero llevan dentro `espeak-ng` (GPL-3). Se instalan aparte, a petición del usuario; prwalk ni los incluye ni depende de ellos.
- **Abierto:** que Gabriel oiga las muestras y elija la voz española por defecto (ahora `ef_dora`); Windows sin probar.
- **Siguiente paso:** tarea 09. La etiqueta, la versión y la visibilidad del repositorio las hace la sesión coordinadora tras el merge.

## 25/11/2026 · Tarea 07 mergeada

- **PR:** [#7](https://github.com/gabimig/prwalk/pull/7), mergeada. La voz es enchufable: `browser` por defecto o un adaptador (`synthesize({ text, lang, options })`) que carga el demonio y sirve por `POST /api/tts`; comandos `voice`, `voice use`, `voice test`, `voice guide`; pausas de 600 ms entre frases y 1500 ms entre pasos. 161 tests.
- **Verificado a mano:** `voice use` con el ejemplo de `say`, `voice test` genera un wav válido, el visor pide el audio y avanza, cambio de voz en vivo, 401 sin token y 403 con otro `Host`.
- **Decisión de la sesión hija, aceptada:** la página recibe un segundo token que solo vale para `/api/tts`; el token principal no llega a la página.
- **Siguiente paso:** tarea 08.

## 25/11/2026 · Primera prueba real y tareas 07 a 09

- **Prueba de Gabriel:** el recorrido funciona, con dos problemas: la voz del navegador no le vale y la narración no deja pausas entre frases ni entre pasos.
- **Decidido:** la voz será enchufable. Por defecto la del navegador; cualquier otro proveedor, local o en la nube, con un adaptador que carga el demonio. Cambia el requisito "sin voces en la nube": pasa a ser "local por defecto; la nube solo si el usuario acopla su adaptador".
- **Tareas nuevas:** 07 (proveedores enchufables y pausas), 08 (voz local recomendada, instalable con un comando), 09 (licencia, repositorio público y versión 0.1 instalable desde la URL).
- **Instalación de prueba en la máquina de Gabriel:** `prwalk` enlazado en `~/.local/bin`; la skill local se borra para que la prueba final sea una instalación limpia.
- **Licencia:** MIT en un primer momento; cambiada después a GPL (ver arriba).
- **Siguiente paso:** lanzar la 07.

## 25/11/2026 · Tarea 06 mergeada y prueba final

- **PR:** [#6](https://github.com/gabimig/prwalk/pull/6), mergeada. Entrega `prwalk skill` y `prwalk skill install`, el paquete 0.1.0 instalable desde un `.tgz`, README, selector de voz y velocidad, apagado por inactividad, aviso de órdenes antes de Start y cabecera CSP. 138 tests y 12 de navegador.
- **Instalación:** clonar, compilar y enlazar. `npm install -g github:...` no funciona.
- **Prueba final:** un agente en blanco (Opus), solo con el fichero de la skill, hizo un walkthrough de la PR 5 a nivel ficheros clave: 11 pasos, `prwalk play` válido al primer intento, sin ningún comando fallido. Reproducido en el navegador. A una pregunta a mitad del paso 3 respondió con `status` y `say --question --file --lines`, sin tocar el guion.
- **Guía:** ajustada con lo que ese agente encontró ambiguo (rangos entre hunks, rango propio de una frase, tamaño de las respuestas, cuándo dar la URL, `wait` opcional).
- **Arreglo en `main`:** `skill/` queda fuera del formateador, que rompía la cabecera de `SKILL.md`.
- **Estado:** listo para que Gabriel lo pruebe. La tarea 07 (voz local mejor) queda pendiente de su opinión sobre la voz.

## 25/11/2026 · Tarea 05 mergeada

- **PR:** [#5](https://github.com/gabimig/prwalk/pull/5), mergeada. Entrega los eventos y `prwalk wait`, las órdenes `pause`, `resume` y `goto`, el paréntesis con `prwalk say` y la reescritura con `prwalk replace`. 126 tests y 12 de navegador.
- **Verificado a mano:** un paréntesis con pregunta y foco en otro fichero se ve y queda en el historial; al acabar la página espera en el paso; `wait` devuelve el fin del paréntesis; `replace` cambia los pasos finales y el recorrido termina en ellos.
- **Incidencia:** la CI falló por dos tests de la CLI que superaban los 5 segundos en el ejecutor de GitHub. Se les dio más margen en un commit aparte.
- **Skill:** `skill/SKILL.md` y `skill/GUIDE.md` los ha escrito la sesión coordinadora, porque son decisiones de producto: niveles de detalle, orden de los pasos, cómo narrar y cómo reaccionar a preguntas.
- **Siguiente paso:** tarea 06, la última antes de probar con un agente real.

## 25/11/2026 · Tarea 04 mergeada

- **PR:** [#4](https://github.com/gabimig/prwalk/pull/4), mergeada. Entrega `prwalk play`, `open --patch`, la reproducción completa en el visor (tira de pasos, controles, atajos, historial, tarjetas, pantalla de inicio), voz con Web Speech y proveedor silencioso, y la posición en `prwalk status`. 96 tests más los de navegador. El workflow confirmó y corrigió 11 hallazgos.
- **Verificado a mano:** el ejemplo se reproduce entero en el navegador integrado, Espacio pausa, `status` refleja la pausa, recargar conserva el paso, y la voz real habla.
- **Privacidad:** las voces que no son locales (las "Google ..." de Chrome, que envían el texto a un servidor) se descartan.
- **Problema detectado:** en macOS elige la voz "Eddy", de baja calidad. Se corrige en la tarea 05.
- **Siguiente paso:** tarea 05.

## 25/11/2026 · Tarea 03 mergeada

- **PR:** [#3](https://github.com/gabimig/prwalk/pull/3), mergeada. Entrega el visor (Vite + React) servido por el demonio, el WebSocket y `prwalk focus`. 70 tests y 3 de navegador con Playwright en un trabajo propio de la CI.
- **Riesgo cerrado:** `@pierre/diffs` sirve para scroll, resaltado y atenuado por programa. Se mantiene TypeScript 7.
- **Verificado a mano:** foco y cambio de fichero en el navegador integrado, recarga que conserva el foco, 380 px sin scroll horizontal, WebSocket rechazado desde otro origen, estáticos sin salida de `dist/web`.
- **Decidido:** los textos fijos de la interfaz van en el idioma del guion (español o inglés). Entra en la tarea 04.
- **Pendiente menor:** sin cabecera Content-Security-Policy, porque `@pierre/diffs` inyecta estilos en línea. Se revisa en la tarea 06.
- **Siguiente paso:** tarea 04.

## 25/11/2026 · Tarea 02 mergeada

- **PR:** [#2](https://github.com/gabimig/prwalk/pull/2), mergeada. Entrega `prwalk open` (PR de GitHub o cambios locales), `diff`, `status`, `stop`, y el demonio local con página provisional. 52 tests.
- **Parser:** el de `@pierre/diffs`; los binarios se detectan aparte porque la librería no los marca.
- **Cuenta personal en sesiones hijas:** confirmado, la PR la abrió `gabimig`.
- **Forma de trabajo desde ahora:** Gabriel ha pedido seguir del tirón, verificando y mergeando cada PR sin esperar su visto bueno, hasta que la herramienta esté lista para probar (tarea 06).
- **Siguiente paso:** tarea 03, que incluye tres ajustes pequeños que quedaron de la 02.

## 25/11/2026 · Tarea 01 mergeada

- **PR:** [#1](https://github.com/gabimig/prwalk/pull/1), mergeada. Entrega el esqueleto (TypeScript 7, pnpm, Biome, Vitest, CI), el esquema del guion con `validateScript`, el reductor de la reproducción y `prwalk validate`. 25 tests.
- **Workflow:** 19 hallazgos de las reviews, 1 confirmado y corregido.
- **Repositorio:** transferido a la cuenta personal, `gabimig/prwalk`. El proyecto usa esa cuenta para `git` y `gh` (configuración local del repositorio y `GH_CONFIG_DIR` en los ajustes locales de Claude). Historial reescrito con el correo personal.
- **Siguiente paso:** tarea 02.

### Decidido al revisar la 01

- **Preguntas a mitad del recorrido:** el caso normal es un paréntesis que no toca el guion: el agente responde en voz alta con un foco opcional en cualquier código, la respuesta queda en el historial del paso, y al continuar se repite la frase interrumpida. Reescribir los pasos que quedan es la excepción, cuando la pregunta cambia el plan. Entra en la tarea 05 y añade un estado "en paréntesis" a la reproducción; el formato del guion no cambia.
- **Claves desconocidas en el guion:** se rechazan, para que las erratas del agente salgan como error.

### Abierto tras la 01

- Al acabar un paréntesis, ¿la página espera a que el usuario continúe o retoma sola? Por defecto, espera. Pendiente de que Gabriel lo confirme antes de la tarea 05.
- Nota corta junto al nombre del fichero (el `why` del prototipo): el esquema no la tiene. Añadirla como campo opcional del paso en la tarea 04.
- TypeScript 7 puede dar problemas con Vite y React: se comprueba en la tarea 03.
- Un guion muy roto puede necesitar dos rondas de corrección, porque los errores entre campos solo salen con la estructura básica válida. Se deja así salvo que moleste en el uso real.

## 25/11/2026 · Arranque

- **Hecho:** investigación de lo que ya existe (nada cubre la idea completa), requisitos acordados y prototipo estático aprobado en `prototype/index.html`. Arquitectura y tareas definidas en `AGENTS.md` y `TASKS.md`.
- **Forma de trabajo:** la sesión principal planifica y verifica; cada tarea la ejecuta una sesión hija (Opus 5.5, esfuerzo medio) que lanza `docs/plan/workflows/tarea.js` desde su worktree. Ese workflow es la adaptación a este repo del de la skill `tarea`: implementador con TDD, rival reviews en paralelo (seguridad, regresiones, general, tests y, si toca `web/`, frontend), verificación adversaria de cada hallazgo, corrector y PR en borrador. Gabriel revisa cada PR y decide el merge.
- **Siguiente paso:** lanzar la tarea 01.

### Decisiones tomadas

- Desarrollo propio, sin forks. Librerías solo con licencia permisiva.
- Skill más CLI, sin servidor MCP.
- La voz la habla la página; nada sale de la máquina.
- El guion se prepara entero antes de reproducir, y el agente puede modificarlo en vivo.
- Código y PRs en inglés; documentos de planificación en español.

### Abierto

- Licencia del proyecto: se decide si el repositorio se hace público.
- Tarea 07 (voz local mejor): depende de cómo suene la voz del sistema en el uso real.
- Cómo se enlaza el paso de una frase con un resaltado más estrecho dentro del mismo fichero: el esquema de la tarea 01 lo permite; se valida de verdad en la 04.
