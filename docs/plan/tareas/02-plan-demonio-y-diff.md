# 02 · Plan: demonio, origen del diff y CLI base

Lee antes `AGENTS.md` y lo que dejó la tarea 01: `src/shared/script.ts`, `src/shared/playback.ts`, `src/cli/index.ts`, `src/cli/validate.ts` y sus tests (van junto al código, `*.test.ts`; `test/global-setup.ts` compila antes de los tests para poder ejecutar el binario). Este plan es todo el contexto que necesitas; no hay conversación previa que consultar.

- **Rama:** `feat/02-daemon-and-diff`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR de ese workflow, no el implementador.

## Objetivo

Que un agente pueda abrir una sesión de walkthrough sobre una PR o sobre cambios locales y obtener el índice de ficheros y líneas que necesita para escribir el guion. Al terminar existe un demonio local que guarda la sesión y sirve una página provisional. Todavía no hay visor real, ni WebSocket, ni reproducción.

## Reparto de responsabilidades

- **La CLI obtiene el diff**, porque es ella la que corre en el directorio y con el entorno del agente (repositorio actual, cuenta de `gh`). Luego se lo entrega al demonio.
- **El demonio solo guarda y sirve.** No ejecuta `gh` ni `git`.
- **Una sesión a la vez.** Abrir otra sustituye a la anterior.

## Qué hay que entregar

### 1. Índice del diff (`src/shared/diff.ts`)

Tipos compartidos, sin APIs de Node ni del navegador:

```ts
type DiffIndex = { files: DiffFile[] };

type DiffFile = {
  path: string;                 // ruta nueva; en un borrado, la antigua
  oldPath?: string;             // solo en renombrados
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number }[];
};
```

Y una función que construye el `DiffIndex` a partir del texto de un diff unificado de git.

**Parser:** no escribas uno propio. Por orden de preferencia:

1. El parser de `@pierre/diffs` (Apache-2.0), si se puede usar en Node sin DOM. Es la librería con la que la tarea 03 pintará el diff, así que los números de línea coincidirían por construcción.
2. Si no funciona fuera del navegador o arrastra demasiado, `parse-diff` o `gitdiff-parser` (comprueba que la licencia es MIT y que se mantiene).

Deja dicho en la PR cuál has elegido y por qué. El resto del código depende solo de `DiffIndex`, no de la librería.

### 2. Orígenes del diff (`src/cli/sources/`)

Cada origen devuelve `{ meta, patch }`, donde `patch` es el diff unificado en texto y `meta` es:

```ts
type SessionMeta = {
  kind: 'github' | 'local';
  title: string;
  number?: number;        // solo github
  url?: string;           // solo github
  headRef: string;
  baseRef: string;
};
```

- **GitHub:** `prwalk open <número | URL>`. Usa `gh pr view <pr> --json number,title,url,headRefName,baseRefName` y `gh pr diff <pr>`. Con un número se ejecuta en el directorio actual; con una URL funciona desde cualquier sitio.
- **Local:** `prwalk open` sin argumento, con `--base <ref>` opcional. Compara el punto de bifurcación con el árbol de trabajo, cambios sin commitear incluidos: `git diff <merge-base de base y HEAD>`. Si no se pasa `--base`, usa la rama por defecto del remoto (`git symbolic-ref refs/remotes/origin/HEAD`) y, si no hay, `main`. El título es el nombre de la rama actual. Los ficheros sin seguimiento de git no entran; dilo en la ayuda del comando.

Los comandos se ejecutan **siempre con lista de argumentos** (`execFile` o `spawn` sin shell), nunca componiendo una cadena.

Clases de fallo que el usuario tiene que entender, cada una con su mensaje por stderr y código de salida 1, sin traza:

- `gh` o `git` no están instalados.
- El comando termina con error (PR inexistente, sin autenticar, no es un repositorio, la base no existe): se muestra el stderr del comando y una pista de una línea.
- El diff está vacío: no hay nada que recorrer.

### 3. Demonio (`src/server/`)

Servidor HTTP con el módulo `http` de Node, sin framework.

- **Escucha solo en `127.0.0.1`.** Puerto por defecto 4517; se cambia con `--port` o `PRWALK_PORT`. Si el puerto está ocupado por otra cosa, error claro.
- **Estado en disco:** `~/.prwalk/daemon.json` con `pid`, `port` y `token`, con permisos `0600`. La carpeta se puede cambiar con `PRWALK_HOME`, que es lo que usan los tests. La salida del demonio va a `daemon.log` en esa carpeta.
- **Protección frente a páginas web locales**, porque cualquier web abierta en el navegador puede lanzar peticiones a `127.0.0.1`:
  - Toda petición cuya cabecera `Host` no sea `127.0.0.1:<puerto>` o `localhost:<puerto>` se rechaza con 403.
  - Las peticiones que cambian algo exigen el token del fichero de estado en una cabecera; sin él, 401. El token se genera al arrancar con el generador criptográfico de Node.
  - No se envía ninguna cabecera CORS.
- **Rutas:**
  - `GET /api/health`: para saber si está vivo.
  - `PUT /api/session` (con token): recibe `{ meta, patch }`, construye el `DiffIndex` y sustituye la sesión. Límite de tamaño del cuerpo: 50 MB.
  - `GET /api/session`: `{ meta, index }`, o 404 si no hay sesión.
  - `GET /api/diff`: el diff en texto, para el visor de la tarea 03.
  - `POST /api/stop` (con token): apaga el demonio y borra el fichero de estado.
  - `GET /`: página provisional en HTML plano con el título y la lista de ficheros. El texto que venga del diff o de la PR se **escapa** siempre antes de meterlo en el HTML.
- La lógica del servidor es una función que recibe opciones y devuelve cómo pararlo, para poder arrancarla dentro de los tests en un puerto libre. El punto de entrada del proceso es un fichero aparte.

### 4. Comandos (`src/cli/`)

Mismas convenciones que `validate`: texto corto por defecto, `--json` equivalente, errores por stderr con código 1.

- **`prwalk open [pr] [--base <ref>] [--port <n>]`**: obtiene el diff, arranca el demonio si no está vivo (proceso separado y desligado, y espera a que responda `health`), le entrega la sesión e imprime un resumen y la URL. Ejemplo: `Opened PR #482 "Add login rate limit": 4 files, +78 -4` y debajo `Viewer: http://127.0.0.1:4517/`. Si el fichero de estado apunta a un proceso muerto, lo ignora y arranca uno nuevo.
- **`prwalk diff [--file <ruta>]`**: sin opciones, el índice: una línea por fichero con estado y contadores, y debajo sus hunks con el rango del lado nuevo y el del antiguo. Con `--file`, el contenido de ese fichero en el diff con los números de línea antiguo y nuevo delante de cada línea, que es lo que el agente necesita para elegir rangos sin contar a mano. Una ruta que no está en el diff es un error que lista las rutas válidas.
- **`prwalk status`**: si el demonio está vivo y qué sesión tiene (origen, título, número de ficheros, URL). Si no está vivo lo dice y sale con 0.
- **`prwalk stop`**: apaga el demonio. Si no había ninguno, lo dice y sale con 0.
- **`prwalk daemon`**: arranca el demonio en primer plano. Es para depurar y para los tests; márcalo como interno en la ayuda.

`diff` sin sesión abierta es un error con código 1 que dice que hay que ejecutar `prwalk open`.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| Estado de cada fichero (añadido, modificado, borrado, renombrado, binario) y rangos de sus hunks | `shared/diff` | Un diff de ejemplo en `test/fixtures` que los contenga todos; un test por tipo |
| El origen local incluye cambios sin commitear y parte del punto de bifurcación | `cli/sources` | Uno, con un repositorio git temporal creado en el test |
| El origen de GitHub junta metadatos y diff | `cli/sources` | Uno, con un `gh` falso en el `PATH` |
| Clases de fallo: comando no instalado, comando con error, diff vacío | `cli/sources` | Uno por clase |
| `Host` ajeno se rechaza; cambio sin token se rechaza; sesión se guarda y se lee; sin sesión, 404; el HTML escapa el título | servidor en proceso | Uno por decisión |
| El demonio se arranca una vez, sobrevive al comando y se apaga limpio | CLI, binario compilado | Uno: `open` local, `status`, `diff`, `diff --file`, `stop`, con `PRWALK_HOME` temporal y puerto libre |

El test de la CLI no puede dejar procesos vivos aunque falle: apaga el demonio en la limpieza.

## Qué no hay que hacer

- Nada de WebSocket, React, Vite ni reproducción: es la tarea 03 en adelante.
- No valides el guion contra el diff todavía: es la tarea 04.
- No añadas apagado automático por inactividad ni varias sesiones.
- No toques el esquema del guion ni el reductor de la tarea 01.
- Dependencias nuevas: solo el parser de diffs. Si crees que hace falta otra, justifícala en la PR.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en verde.
2. Comprobación a mano, en este mismo repositorio: en una rama con algún cambio, `prwalk open`, `prwalk status`, `prwalk diff`, `prwalk diff --file <uno>`, abrir la URL con `curl` y ver la lista de ficheros, `prwalk stop`. Y `prwalk open 1` contra la PR 1 de este repositorio, ya mergeada.
3. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
