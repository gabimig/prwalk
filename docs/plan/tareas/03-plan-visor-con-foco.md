# 03 · Plan: visor web con foco dirigido

Lee antes `AGENTS.md`, abre `prototype/index.html` en un navegador (es el aspecto y el comportamiento acordados) y lee lo que dejaron las tareas 01 y 02: `src/shared/` (guion, reproducción, índice del diff, sesión), `src/server/server.ts`, `src/server/page.ts`, `src/cli/session-commands.ts` y `src/cli/daemon-client.ts`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/03-web-viewer-focus`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Objetivo

Que el navegador muestre el diff de la sesión con el aspecto del prototipo, y que un comando de la CLI lo dirija en directo: abrir un fichero, hacer scroll a un rango de líneas y resaltarlo atenuando el resto. Es la tarea que confirma que `@pierre/diffs` sirve para esto. Todavía no hay guion, pasos, voz ni controles de reproducción.

## Qué hay que entregar

### 1. Comprobación de un foco contra el diff (`src/shared/diff.ts`)

```ts
type Focus = { file: string; side?: 'new' | 'old'; lines: [number, number] };  // ya existe en script.ts
function checkFocus(index: DiffIndex, focus: Focus): string | undefined;        // mensaje de error, o nada
```

Un foco es válido si el fichero está en el diff y el rango entero cae dentro de un mismo hunk de ese lado. El mensaje de error dice qué rangos sí están disponibles en ese fichero y lado. Un fichero binario no admite foco. La tarea 04 reutilizará esta función para validar el guion; no la dupliques.

### 2. Protocolo y WebSocket (`src/shared/protocol.ts`, `src/server/`)

- Dependencia nueva: `ws` (MIT).
- El visor se conecta a `/ws`. El demonio rechaza la conexión si la cabecera `Origin` no es la del propio demonio (`http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`): los WebSocket no pasan por CORS, así que sin esto cualquier web abierta podría escuchar. La comprobación de `Host` que ya existe se aplica también aquí.
- Mensajes del demonio al visor, tipados en `src/shared/protocol.ts`:
  - `session`: hay sesión nueva; el visor vuelve a pedir `GET /api/session` y `GET /api/diff`.
  - `focus`: `{ file, side, lines }`, o foco vacío para quitarlo.
- Al conectarse, un visor recibe el foco vigente, si lo hay, para que recargar la página no lo pierda.
- En esta tarea el visor no envía nada al demonio.

### 3. Rutas nuevas del demonio

- `POST /api/focus` (con token): valida con `checkFocus`; si no es válido responde 422 con el mensaje; si lo es, lo guarda como foco vigente, lo difunde y responde cuántos visores hay conectados. Con cuerpo vacío de foco, lo quita.
- `GET /api/session` añade `viewers`: número de visores conectados.
- `GET /` y los ficheros estáticos sirven la aplicación compilada desde `dist/web`. Una ruta que intente salir de esa carpeta se rechaza. Si `dist/web` no existe (alguien ejecuta sin compilar), responde con un mensaje que lo explica. Borra `src/server/page.ts` si deja de usarse.
- Abrir una sesión nueva borra el foco vigente.

### 4. Comando `prwalk focus`

- `prwalk focus <fichero> --lines <a-b> [--side old]` y `prwalk focus --clear`. `--lines 12` equivale a `12-12`.
- Salida: una línea, por ejemplo `Focused src/auth/login.ts 15-17 (1 viewer)`. Si no hay ningún visor conectado, el foco se guarda igualmente y se avisa por stderr de que hay que abrir la URL; el código de salida sigue siendo 0.
- Foco inválido: código 1 con el mensaje de `checkFocus`.
- `prwalk status` muestra el número de visores.

### 5. Visor (`web/`)

Vite + React + TypeScript. Se compila a `dist/web`. `pnpm build` compila servidor y visor.

- **Diseño del prototipo:** cabecera con el título de la PR, las ramas, número de ficheros y líneas añadidas y borradas; debajo, la zona principal. No pintes todavía la tira de pasos ni la barra inferior: llegan en la tarea 04.
- **Sin foco:** lista de ficheros del diff con su estado y contadores. Al pulsar uno se muestra su diff sin resaltar nada.
- **Con foco:** se muestra solo ese fichero, con su cabecera fija (estado y ruta), en formato unificado. El rango queda resaltado como en el prototipo (borde y fondo de acento), el resto de líneas atenuado, y el rango se desplaza al centro de la zona visible. Si llega otro foco, cambia de fichero o de rango con transición suave.
- **Pintado del diff con `@pierre/diffs`**, con resaltado de sintaxis. Usa sus APIs documentadas de scroll, selección de líneas y temas. Para atenuar lo no resaltado puede hacer falta CSS propio sobre lo que la librería exponga.
- **Tema claro y oscuro** según el sistema, con los colores del prototipo como referencia.
- **Panel estrecho:** tiene que funcionar a 380 px de ancho sin scroll horizontal de página (el código sí puede desplazarse dentro de su zona).
- **Conexión:** si el WebSocket se cae, reintenta con espera creciente y lo indica con un aviso discreto. Al reconectar recupera sesión y foco.
- **Sin sesión:** mensaje que dice que hay que ejecutar `prwalk open`.
- Todo texto que venga del diff o de la PR se pinta como texto, nunca como HTML.

### 6. Si `@pierre/diffs` no da la talla

Antes de construir el visor entero, haz una prueba mínima: pintar un fichero del diff de ejemplo, desplazar a una línea y resaltar un rango por programa. Si alguna de las tres cosas no se puede hacer de forma razonable, cambia a `react-diff-view` (MIT) para el pintado, mantén `@pierre/diffs` solo como parser si sigue encajando, y explícalo en la PR. No sigas adelante con apaños frágiles.

Lo mismo con TypeScript 7: si Vite, React o sus tipos no funcionan con él, baja a la última 5.x en todo el repositorio y anótalo.

### 7. Ajustes pendientes de la tarea 02

- `prwalk open --port <n>` con un demonio ya vivo en otro puerto: avisa por stderr de que se reutiliza el existente y en qué puerto.
- Con `--json`, los errores salen como JSON por la salida estándar (`{ "ok": false, "error": "..." }`) con código 1, igual que en `validate`. Unifícalo en todos los comandos.
- `prwalk open <pr>`: si el argumento no es un número ni una URL `http(s)`, error inmediato sin llamar a `gh`.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| `checkFocus`: fichero ausente, rango fuera de hunk, rango a caballo entre dos hunks, lado antiguo, binario, caso válido | `shared/diff` | Uno por caso |
| `Origin` ajeno no puede abrir el WebSocket; un foco válido se difunde; uno inválido da 422 y no se difunde; el visor que se conecta recibe el foco vigente; sesión nueva borra el foco | servidor en proceso, con un cliente `ws` | Uno por decisión |
| Los estáticos no sirven nada fuera de `dist/web` | servidor en proceso | Uno |
| `focus` conecta argumentos, demonio y salida; aviso sin visores | CLI, binario compilado | Uno |
| Los tres ajustes de la tarea 02 | donde viva cada decisión | Uno por ajuste |
| Un foco resalta las líneas correctas, las deja visibles y muestra la cabecera del fichero; un segundo foco en otro fichero cambia la vista; recargar conserva el foco | navegador, con Playwright contra el demonio real y el diff de ejemplo | Tres |

Los tests de navegador van en un script aparte, `pnpm test:e2e`, y en un trabajo propio de la CI que instala Chromium. `pnpm test` sigue sin necesitar navegador. Playwright es Apache-2.0.

## Qué no hay que hacer

- Nada de guion, pasos, reproducción, voz ni controles: tarea 04.
- No amplíes el contexto del diff con el contenido completo de los ficheros.
- No añadas vista lado a lado ni selector de tema.
- Dependencias nuevas permitidas: `ws`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@playwright/test`, y los tipos correspondientes. Cualquier otra, justificada en la PR con su licencia.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` y `pnpm build` en verde.
2. Comprobación a mano con un `PRWALK_HOME` temporal: `prwalk open 2` en este repositorio, abrir la URL en un navegador, lanzar tres o cuatro `prwalk focus` sobre ficheros distintos y comprobar el resaltado y el scroll; `prwalk focus --clear`; `prwalk stop`. No dejes demonios vivos.
3. En la PR, di expresamente si `@pierre/diffs` cumplió para scroll, resaltado y atenuado, o qué hubo que hacer.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
