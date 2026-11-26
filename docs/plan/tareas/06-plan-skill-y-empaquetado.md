# 06 · Plan: skill, empaquetado y pulido

Lee antes `AGENTS.md`, `skill/SKILL.md` y `skill/GUIDE.md` (ya escritos por la sesión coordinadora), y recorre la aplicación una vez de principio a fin: `pnpm build`, `prwalk open --patch test/fixtures/example.diff --title Example`, `prwalk play test/fixtures/example-script.json`, abrir la URL con `?voice=silent&speed=4`, y probar `status`, `say`, `goto`, `replace` y `stop`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/06-skill-and-packaging`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Objetivo

Que alguien pueda instalar `prwalk` con un par de comandos y que cualquier agente, solo con la skill, sepa dar un walkthrough. Más cuatro retoques que quedaron de las tareas anteriores.

## Qué hay que entregar

### 1. La skill

- **`prwalk skill`** imprime `skill/GUIDE.md` por la salida estándar, tal cual. La guía viaja dentro del paquete.
- **`prwalk skill install [--dir <carpeta>]`** copia `skill/SKILL.md` a `<carpeta>/prwalk/SKILL.md`. Carpeta por defecto: `~/.claude/skills`. Crea las carpetas que falten, sobrescribe una instalación anterior de esta misma skill, e imprime dónde la ha dejado. Con otra carpeta sirve para agentes distintos de Claude Code.
- **Repasa la guía contra la CLI real.** Cada comando, opción y formato que menciona `skill/GUIDE.md` tiene que existir y comportarse como dice; el ejemplo de guion tiene que pasar `prwalk validate`. Corrige las discrepancias en la guía, o en la CLI si el fallo está ahí. **No reescribas las recomendaciones** (niveles de detalle, orden, cómo narrar, los tres tipos de intervención): son decisiones de producto ya tomadas.
- Un test comprueba que el ejemplo de guion incrustado en la guía es válido, para que no se desincronice.

### 2. Empaquetado

- `package.json`: quita `"private": true` solo si hace falta para instalar; `files` incluye `dist` y `skill`; el campo `license` sigue sin ponerse (pendiente de decisión de Gabriel).
- **Instalación desde el repositorio**, sin publicar en npm:
  - Clonar, `pnpm install`, `pnpm build`, `pnpm link --global` deja `prwalk` en el `PATH`.
  - Comprueba además si `npm install -g github:gabimig/prwalk` funciona (necesita un script `prepare` que compile). Si funciona de forma razonable, documéntalo como vía corta; si arrastra demasiado o falla, déjalo fuera y dilo en la PR.
- Las dependencias que solo hacen falta para compilar o probar se quedan en `devDependencies`. En `dependencies`, solo lo que el paquete instalado necesita para ejecutarse.
- `prwalk --version` muestra la versión del paquete. Súbela a `0.1.0`.

### 3. README (en inglés)

Corto y útil: qué es y para quién, en tres o cuatro frases; requisitos (Node 22, `gh` para PRs de GitHub, un navegador con voces instaladas); instalación; instalar la skill; un inicio rápido con el ejemplo incluido, sin PR real; tabla de comandos con una línea cada uno; qué controles tiene la página y sus atajos; privacidad (todo local, las voces no locales se descartan, el demonio solo escucha en `127.0.0.1`); limitaciones conocidas. Sin insignias ni capturas. Sin sección de licencia.

### 4. Retoques pendientes

- **Selector de voz y de velocidad.** En la cabecera, donde ahora se muestra la voz en uso: un desplegable con las voces locales disponibles para el idioma del guion, en el orden de preferencia que ya existe, y otro con tres velocidades (normal, algo más rápida, rápida). La elección se guarda en `localStorage` por idioma y se aplica a partir de la frase siguiente. Si `localStorage` no está disponible, funciona igual sin recordar. No aparece con el proveedor silencioso.
- **Órdenes antes de que el usuario pulse Start.** `pause`, `resume`, `goto` y `say` se siguen aceptando, pero su salida añade una línea que dice que el visor está esperando a que el usuario pulse Start, para que el agente no crea que ya está sonando.
- **Registro de eventos al cargar otro guion.** `prwalk play` con un guion nuevo vacía el registro de eventos, igual que una sesión nueva.
- **Apagado por inactividad.** Si el demonio pasa 4 horas sin visores conectados y sin recibir ninguna petición, se apaga y borra su fichero de estado. El tiempo se cambia con `PRWALK_IDLE_MINUTES`; `0` lo desactiva.
- **Cabecera Content-Security-Policy** en las respuestas del visor, lo más estricta que permita `@pierre/diffs`: solo el propio origen para scripts y conexiones (incluido el WebSocket propio), estilos en línea permitidos si la librería los necesita, y lo que haga falta para sus workers. Compruébalo con los tests de navegador: si rompe el pintado del diff, relaja solo la directiva necesaria y explícalo.

### 5. Documentación interna

- `AGENTS.md`: actualiza la sección de arquitectura con las carpetas y piezas que existen de verdad (protocolo, motor de reproducción, proveedores de voz, eventos) y añade la lista de comandos. Quita de "Out of scope" lo que ya no aplique. Sin rehacer el documento.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| El guion de ejemplo de la guía es válido | `shared`, leyendo `skill/GUIDE.md` | Uno |
| `skill` imprime la guía; `skill install --dir` deja el fichero y sobrescribe | CLI, binario compilado | Uno |
| Las órdenes antes de Start avisan | servidor o CLI, donde se decida | Uno |
| `play` vacía el registro de eventos | servidor en proceso | Uno |
| El demonio se apaga tras el tiempo de inactividad y no mientras hay un visor | servidor en proceso, con el tiempo inyectado | Dos |
| La elección de voz y velocidad se recuerda por idioma y se ignora si la voz ya no existe | función pura | Uno |
| El visor sigue pintando y resaltando con la cabecera CSP | navegador | Lo cubren los tests de navegador existentes; añade uno solo si hace falta comprobar la cabecera |
| El paquete instalado funciona fuera del repositorio | script de comprobación | `pnpm pack`, instalar el `.tgz` en una carpeta temporal y ejecutar `prwalk --version`, `prwalk skill` y `prwalk validate` del ejemplo. Puede ser un test o un script `pnpm test:pack` ejecutado en la CI |

## Qué no hay que hacer

- No publiques en npm ni crees releases o etiquetas.
- No añadas licencia.
- No cambies el formato del guion ni los comandos existentes, salvo corregir una discrepancia con la guía.
- No añadas voces en la nube ni modelos de voz locales: es la tarea 07.
- Dependencias nuevas: ninguna prevista.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` y `pnpm build` en verde, y la comprobación del paquete instalado.
2. Comprobación a mano: instalar el paquete empaquetado en una carpeta temporal y, desde fuera del repositorio, repetir el inicio rápido del README tal como está escrito. `prwalk skill install --dir <carpeta temporal>` y comprobar el fichero. No instales la skill en `~/.claude/skills` de verdad ni dejes nada enlazado globalmente. No dejes demonios vivos.
3. En la PR, di si la instalación directa desde GitHub funciona y qué directivas de CSP han quedado.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
