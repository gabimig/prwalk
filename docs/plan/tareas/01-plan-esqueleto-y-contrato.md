# 01 · Plan: esqueleto y contrato

Lee antes `AGENTS.md` (qué es el proyecto, arquitectura y convenciones) y abre `prototype/index.html` para ver el comportamiento acordado. Este plan es todo el contexto que necesitas; no hay conversación previa que consultar.

- **Rama:** `feat/01-skeleton-and-contract`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` del apartado "Al terminar" las hace el agente de la PR de ese workflow, no el implementador.

## Objetivo

Dejar el repositorio listo para trabajar y fijar el contrato que comparten el demonio, la CLI y el visor: el formato del guion y las reglas de la reproducción. En esta tarea no hay demonio, ni navegador, ni diff.

## Qué hay que entregar

### 1. Esqueleto del proyecto

- `package.json` de un solo paquete, ESM, `"engines": { "node": ">=22" }`, gestor pnpm, binario `prwalk` apuntando a la CLI compilada. Nombre del paquete: `prwalk`. Sin campo `license` todavía y sin fichero `LICENSE`: está pendiente de decidir.
- TypeScript estricto. Compilación con `tsc` a `dist/`.
- Scripts: `build`, `lint` (Biome, lint y formato), `typecheck`, `test` (Vitest).
- `.gitignore` (como mínimo `node_modules`, `dist`).
- CI en `.github/workflows/ci.yml`: en cada PR y en `main`, instalar con pnpm y ejecutar `lint`, `typecheck` y `test` con Node 22.
- Carpetas según `AGENTS.md`. Crea solo las que esta tarea usa: `src/shared`, `src/cli`, `test`. No crees `src/server`, `web` ni `skill` vacías.
- No toques `prototype/`, `docs/plan/` (salvo lo indicado al final) ni `.claude/`.

### 2. Esquema del guion (`src/shared/script.ts`)

Con `zod`. Exporta los tipos y una función `validateScript(input: unknown)` que devuelve el guion tipado o una lista de errores.

```ts
type Script = {
  version: 1;
  lang: string;                 // BCP-47: "es", "en", "es-ES"
  level: 'overview' | 'key-files' | 'full';
  steps: Step[];                // al menos uno
};

type Step = {
  id: string;                   // único en el guion; minúsculas, cifras y guiones
  title: string;                // etiqueta corta para la tira de pasos
  focus?: Focus;                // paso de código
  card?: Card;                  // paso sin código (resumen, tests, cierre)
  say: Sentence[];              // al menos una
};

type Focus = {
  file: string;                 // ruta tal como aparece en el diff
  side?: 'new' | 'old';         // por defecto 'new'
  lines: [number, number];      // 1-based, inclusivo, inicio <= fin
};

type Card = {
  heading: string;
  lead?: string;
  items: { title: string; text?: string }[];
};

type Sentence =
  | string
  | { text: string; lines?: [number, number]; side?: 'new' | 'old' };
```

Reglas, además de los tipos:

- Un paso lleva **exactamente uno** de `focus` o `card`.
- Los `id` no se repiten.
- `lines` es siempre inicio <= fin y ambos >= 1.
- Una frase con `lines` propio estrecha el resaltado dentro del fichero del paso, así que solo es válida en pasos con `focus`.
- Los textos (`title`, `text`, `heading`, frases) no pueden estar vacíos ni ser solo espacios.

Los errores son para que un agente corrija su guion sin ayuda: cada uno dice **dónde** (índice del paso y su `id` si lo tiene, y el campo) y **qué se esperaba**. Ejemplo del nivel de detalle que se busca: `steps[3] (id "controller-block"): must have exactly one of "focus" or "card", found both`.

Esta tarea valida solo la estructura. Comprobar que el fichero y las líneas existen en el diff llega en la tarea 04; no lo adelantes.

### 3. Máquina de estados de la reproducción (`src/shared/playback.ts`)

Un reductor puro: `reduce(state, action, script) => state`. Sin temporizadores, sin voz, sin efectos.

```ts
type PlaybackState = {
  status: 'idle' | 'playing' | 'paused' | 'finished';
  step: number;      // índice en script.steps
  sentence: number;  // índice en steps[step].say
};

type PlaybackAction =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'toggle' }
  | { type: 'sentenceEnded' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'restartStep' }
  | { type: 'restartAll' }
  | { type: 'goto'; step: number };
```

Reglas (son las del prototipo; cada una es una decisión y lleva su test):

- Estado inicial: `idle`, paso 0, frase 0. `start` pasa a `playing` sin mover la posición.
- `sentenceEnded` en `playing`: avanza a la frase siguiente; si era la última del paso, al paso siguiente en la frase 0; si era la última del guion, pasa a `finished` sin mover la posición. En cualquier otro estado se ignora (una frase cancelada por una pausa no debe hacer avanzar).
- `pause` conserva la posición. `resume` vuelve a `playing` en la misma frase: el reproductor la repetirá desde el principio.
- `toggle` alterna entre `playing` y `paused`. Desde `finished` o `idle`, pasa a `playing` en la posición actual.
- `next` y `prev` van a la frase 0 del paso siguiente o anterior y dejan `playing`. En los extremos no se salen: `prev` en el paso 0 y `next` en el último reinician ese mismo paso.
- `restartStep` va a la frase 0 del paso actual en `playing`. `restartAll` va al paso 0, frase 0, en `playing`.
- `goto` con un índice válido va a la frase 0 de ese paso en `playing`. Con un índice fuera de rango no cambia nada.

### 4. Comando `prwalk validate` (`src/cli`)

Con `commander`.

- `prwalk validate <fichero>` y `prwalk validate -` (lee de la entrada estándar).
- Guion válido: código de salida 0 y una línea de resumen por la salida estándar, por ejemplo `OK: 8 steps, level key-files, lang es`.
- Guion inválido: código de salida 1 y los errores por stderr, uno por línea.
- JSON mal formado o fichero inexistente: código de salida 1 y un mensaje claro, sin traza.
- `--json`: imprime por la salida estándar `{ "ok": true, "steps": 8, ... }` o `{ "ok": false, "errors": [...] }`, con el mismo código de salida.
- `prwalk --version` y `prwalk --help` funcionan.

### 5. Guion de ejemplo (`test/fixtures/example-script.json`)

Transcribe a este formato el guion del prototipo: las constantes `STEPS` y `CARDS` de `prototype/index.html`. Ojo: allí los rangos son índices de fila del diff empezando en 0; aquí son números de línea del lado nuevo empezando en 1, así que hay que convertirlos con el `start` de cada fichero en `FILES`. Sirve de ejemplo en los tests y lo reutilizarán las tareas siguientes.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| El guion de ejemplo es válido | `shared/script` | Uno |
| Cada regla del esquema (uno de `focus`/`card`, `id` repetido, `lines` invertido, frase con `lines` en paso de tarjeta, texto vacío) | `shared/script` | Uno por regla, comprobando que el error nombra el paso y el campo |
| Cada regla del reductor de la lista de arriba | `shared/playback` | Uno por regla |
| `validate` conecta fichero, validación y salida | CLI, ejecutando el binario compilado | Tres: guion válido (0), inválido (1 con el error por stderr), `--json` con guion inválido |

La CLI no repite las reglas del esquema: solo prueba el cableado.

## Qué no hay que hacer

- Nada de demonio, WebSocket, navegador, React, `@pierre/diffs` ni lectura de diffs.
- No añadas dependencias fuera de `zod`, `commander`, `typescript`, `vitest`, `@biomejs/biome` y `@types/node` sin justificarlo en la PR.
- No publiques el paquete en npm.
- No hagas merge de la PR ni empujes a `main`.

## Al terminar

1. `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde, y `pnpm build` genera un binario que funciona: `node dist/cli/index.js validate test/fixtures/example-script.json`.
2. Abre la PR en borrador. En la descripción: qué se entrega, cómo probarlo a mano en tres o cuatro comandos, la licencia de cada dependencia añadida, y las desviaciones respecto a este plan con su motivo.
3. En `docs/plan/TASKS.md`, marca la fila 01 como `[~]` y pon el enlace a la PR. No toques `ESTADO.md`.
4. Si alguna regla de este plan resulta ambigua o contradictoria al implementarla, elige lo más simple, sigue, y déjalo anotado en la PR como duda. No pares a preguntar.
