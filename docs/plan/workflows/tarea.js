// Flujo de implementación de una tarea de prwalk con agentes independientes.
// Es la adaptación a este repositorio del workflow de la skill `tarea` de Gabriel: mismo ciclo y
// mismas reglas de tests. No lleva la variante legacy ni la comparación de tests.
//
// Lo lanza la sesión hija de cada tarea, desde su propio worktree:
//   Workflow({ scriptPath: '<repo>/docs/plan/workflows/tarea.js',
//              args: { tarea: '01', plan, repo, worktree, branch, base: 'main' } })
//
// Cada agent() arranca con el contexto limpio: solo sabe lo que le pasa el prompt.
// El plan (args.plan) es el contrato entre todos.
//
// Modelos: cada agent() hereda el modelo y el esfuerzo de la sesión que lanza el workflow
// (Opus 5.5 en medio). Los verificadores suben el esfuerzo a 'high' y el agente de la PR
// baja a Sonnet, igual que en el original.

export const meta = {
  name: 'tarea-prwalk',
  description: 'Implementar un plan aprobado de prwalk con TDD, pasarlo por rival reviews, corregir y abrir la PR',
  phases: [
    { title: 'Implementar', detail: 'un agente ejecuta el plan con TDD en la rama' },
    { title: 'Review', detail: 'rival reviews en paralelo: seguridad, regresiones, general, tests (cobertura + mutation + solapamiento), frontend si aplica' },
    { title: 'Verificar', detail: 'cada hallazgo intenta refutarse antes de corregir' },
    { title: 'Corregir', detail: 'aplica los hallazgos confirmados y relanza los tests' },
    { title: 'PR', detail: 'abre la PR en borrador y devuelve la URL' },
  ],
}

// Con args.revisar = true solo hace Review → Verificar → Corregir sobre una rama ya implementada
// (args.resumen describe el cambio); no implementa ni abre la PR.
const { tarea, plan, repo, worktree, branch, base = 'main', revisar = false, resumen = '' } = args
if (!tarea || !plan || !repo || !worktree || !branch) {
  throw new Error('args.tarea, args.plan, args.repo, args.worktree y args.branch son obligatorios')
}

const MUTANTES = `/tmp/mutantes-prwalk-${String(tarea).toLowerCase()}`

const CONTEXTO = `Repositorio: ${repo} (GitHub: gabimig/prwalk, privado). Tarea: ${tarea}. Rama de trabajo: ${branch} (base ${base}).
Trabaja SIEMPRE en el worktree ${worktree} (si no existe, créalo con \`git -C ${repo} worktree add ${worktree} -b ${branch} ${base}\`; si ya existe, úsalo tal cual). No toques el checkout principal de ${repo}.
Lee antes AGENTS.md (qué es el proyecto, arquitectura y convenciones). El plan aprobado está en ${plan}; léelo entero y sigue los enlaces que dé. El comportamiento acordado del visor es el prototipo prototype/index.html.
Reparto: lo que el plan diga de abrir la PR y de editar docs/plan/TASKS.md lo hace el agente de la PR, no el implementador ni el corrector. Nadie hace merge ni empuja a ${base}.
GitHub: este repositorio es de la cuenta personal gabimig. Antes de usar \`gh\`, comprueba \`gh auth status\`; si la cuenta activa no es gabimig, antepón \`GH_CONFIG_DIR="$HOME/.config/gh-personal"\` a cada orden de \`gh\`. \`git push\` ya usa esa cuenta por la configuración del repositorio.
Responde en castellano. El código, los comentarios, los commits y la PR van en inglés.`

// ---------- esquemas ----------
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string', description: 'qué se ha implementado, en 5-10 líneas' },
    commits: { type: 'array', items: { type: 'string' } },
    tests: { type: 'string', description: 'comando(s) de test ejecutados y resultado final' },
    toca_frontend: { type: 'boolean', description: 'true si el diff toca web/' },
    dependencias: { type: 'array', items: { type: 'string' }, description: 'dependencias añadidas, cada una con su licencia' },
    desviaciones: { type: 'array', items: { type: 'string' }, description: 'dónde se apartó del plan y por qué' },
    dudas: { type: 'array', items: { type: 'string' }, description: 'decisiones que debería tomar Gabriel' },
  },
  required: ['resumen', 'commits', 'tests', 'toca_frontend', 'dependencias', 'desviaciones', 'dudas'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    hallazgos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          fichero: { type: 'string' },
          linea: { type: 'integer' },
          severidad: { type: 'string', enum: ['alta', 'media', 'baja'] },
          descripcion: { type: 'string', description: 'qué está mal y cómo se manifiesta' },
          propuesta: { type: 'string', description: 'cómo corregirlo' },
        },
        required: ['titulo', 'fichero', 'severidad', 'descripcion', 'propuesta'],
      },
    },
  },
  required: ['hallazgos'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refutado: { type: 'boolean' },
    motivo: { type: 'string' },
  },
  required: ['refutado', 'motivo'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    corregidos: { type: 'array', items: { type: 'string' } },
    descartados: { type: 'array', items: { type: 'string' }, description: 'hallazgos que decidió no corregir y por qué' },
    tests: { type: 'string' },
  },
  required: ['corregidos', 'descartados', 'tests'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: { url: { type: 'string' }, titulo: { type: 'string' } },
  required: ['url', 'titulo'],
}

// ---------- reglas de tests (las nuevas de la skill, del 23/11) ----------
const FALLOS_EXTERNOS = `FALLOS DE DEPENDENCIAS EXTERNAS. Dependencia externa es todo lo que sale del proceso: ejecutar \`gh\` o \`git\`, la red, el sistema de ficheros, el WebSocket con el navegador, la voz del navegador. Para cada llamada externa que haga el código nuevo:
- Lee cómo falla de verdad (comando que no existe, código de salida distinto de cero, salida vacía o con otro formato, fichero que no está, puerto ocupado, conexión cerrada, voz no disponible) en vez de fiarte de la lista de errores del plan.
- Agrupa los fallos por lo que hace el código NUEVO con ellos: cada rama distinta (cada \`catch\`, cada traducción a un mensaje o código de salida, cada reintento, cada propagación a propósito) es una clase de fallo. Una excepción sin capturar o una traza en pantalla solo vale si es una decisión explícita.
- Un test por clase, no por causa: si tres causas acaban en la misma rama, basta un test con una de ellas, provocada como ocurre de verdad.
- Fallos a medias (el primer paso va bien y el segundo falla; la dependencia responde "bien" pero sin el dato esperado): solo donde el código nuevo encadena pasos, un test por estado intermedio distinto.
- El test provoca el fallo en el punto de la llamada y comprueba el resultado observable: el mensaje, el código de salida, o que no se ejecutan los pasos siguientes.
Si el diff no hace ninguna llamada externa, este apartado no aplica: dilo y no inventes casos.`

const ECONOMIA_TESTS = `ECONOMÍA DE TESTS. Cada test nuevo tiene que fijar una decisión que ningún otro test fija ya.
- Una decisión, un test, en la capa más baja que pueda observarla (unidad antes que CLI, CLI antes que navegador). Las capas de arriba prueban el cableado: un camino feliz y un rechazo, no la matriz de la capa de abajo otra vez.
- Nada de N × M: si dos ejes son independientes, prueba cada eje por separado (N + M). Los \`it.each\` y los bucles multiplican: antes de añadir un caso a una tabla, cuenta cuántos ejemplos genera.
- No pruebes la librería, el framework ni código que el diff no toca; tampoco un test por literal o por campo cuando uno con la estructura entera dice lo mismo.
- Antes de crear un test, mira si basta con reforzar una aserción de uno que ya se ha escrito en esta rama.
- Si el diseño cambia a mitad de camino, retira o funde los tests de ESTA rama que el diseño nuevo deja repetidos. Los tests que ya existían en la base no se tocan nunca.`

// ---------- 1. Implementar ----------
if (!revisar) phase('Implementar')
const impl = revisar
  ? { resumen, commits: [], tests: '', toca_frontend: false, dependencias: [], desviaciones: [], dudas: [] }
  : await agent(`${CONTEXTO}

Eres el agente implementador. Ejecuta el plan con TDD, en este orden y sin saltarte el rojo:
1. Sitúate en el worktree. Si hay ficheros sin commitear de un intento anterior, descártalos (\`git status\`, \`git clean -fd\`, \`git checkout -- .\`) y parte de la rama limpia. Instala dependencias con pnpm cuando exista package.json.
2. Por cada criterio de aceptación, escribe primero el test que lo cubre, en la capa más baja que pueda observarlo, y comprueba que FALLA. Un criterio que ya cubre un test de esta rama no necesita otro. El andamiaje del proyecto (package.json, configuración, CI) no lleva tests propios: lo prueban los comandos del paso 5.
3. Implementa lo mínimo para que pase. Refactoriza con los tests en verde.
3b. Si el código hace llamadas externas, haz el inventario de fallos descrito abajo ANTES de dar la implementación por buena. Cada CLASE de fallo es un ciclo TDD más. Si el plan no dice qué hacer con un fallo, elige lo más claro para quien usa la CLI y anótalo en "desviaciones".
3c. Consolidación, antes de la suite final: repasa los tests que has añadido con las reglas de economía de abajo y funde o retira los que repiten una decisión.
3d. Mientras desarrollas, lanza solo los ficheros de test que tocan el cambio.
4. Commits pequeños, en inglés, con prefijo de tipo ("feat: ...", "test: ...", "chore: ..."). Sin líneas de atribución a Claude.
5. Al final ejecuta \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\` y \`pnpm build\`, y los comandos de comprobación manual que pida el plan. Todo en verde antes de terminar.

Reglas duras: no debilites ni borres tests existentes para que pasen; si un test existente contradice el plan, anótalo en "dudas" y no lo toques. Solo dependencias con licencia MIT, Apache-2.0, BSD o ISC, y solo las que el plan o AGENTS.md permiten; anota cada una con su licencia en "dependencias". Si el plan es ambiguo, elige la lectura más simple, sigue y anótalo en "dudas". Si resulta imposible o incoherente con el código, para en ese punto y explícalo en "desviaciones" en vez de improvisar otra cosa. No hagas push ni abras la PR.

${FALLOS_EXTERNOS}

${ECONOMIA_TESTS}`,
    { label: `implementar ${tarea}`, phase: 'Implementar', schema: IMPL_SCHEMA })

if (!impl) throw new Error('El implementador no devolvió resultado')
log(`Implementado: ${impl.commits.length} commits · frontend=${impl.toca_frontend} · desviaciones=${impl.desviaciones.length}`)

// ---------- 2+3. Review → verificar (cada review verifica sus hallazgos sin esperar a las demás) ----------
const DIFF = `Repositorio prwalk. El cambio a revisar es el diff de la rama ${branch} contra ${base}; ejecuta \`git diff ${base}...${branch}\` dentro de ${worktree} y lee ahí el código. No modifiques nada en ese worktree: eres solo lectura. Lee AGENTS.md para las convenciones. El plan que debía cumplir: ${plan}. Resumen del implementador: ${impl.resumen}
Responde en castellano.`

const REVIEWS = [
  {
    key: 'seguridad',
    prompt: `${DIFF}

Eres el rival reviewer de SEGURIDAD. prwalk es una herramienta local: un demonio en la máquina del usuario, una CLI y una página que pinta diffs. Busca lo que aquí puede hacer daño: argumentos del usuario o del guion que llegan a un comando (\`gh\`, \`git\`) a través de una shell en vez de como lista de argumentos; rutas que permiten leer o servir ficheros fuera de donde toca; el demonio escuchando en algo que no sea la interfaz local, o aceptando peticiones de cualquier origen del navegador; contenido del diff o del guion que se inserta en la página como HTML; cualquier cosa que envíe código o narración fuera de la máquina (el requisito es que nada sale); dependencias nuevas con licencia no permitida. Solo hallazgos con un escenario concreto de explotación o de fuga; nada de "podría ser". Si el diff no toca ninguna de estas superficies, devuelve la lista vacía.`,
  },
  {
    key: 'regresiones',
    prompt: `${DIFF}

Eres el rival reviewer de REGRESIONES. Busca comportamiento ya existente o ya acordado que este diff rompe o cambia sin que el plan lo pida: el formato del guion y sus reglas de validación, las reglas de la reproducción, la salida y los códigos de salida de los comandos de la CLI (los agentes dependen de ellos), el comportamiento del visor acordado en prototype/index.html, tests existentes debilitados o borrados, scripts de package.json o CI que dejan de comprobar algo. Verifica cada sospecha leyendo el código que llama, no solo el diff. Si la rama es la primera con código, limítate a lo acordado en AGENTS.md, el plan y el prototipo.`,
  },
  {
    key: 'general',
    prompt: `${DIFF}

Eres el rival reviewer GENERAL. Comprueba (a) que el diff cumple TODOS los criterios del plan y nada más: lo que sobra también es hallazgo, incluidas carpetas, dependencias o comandos que el plan no pide; (b) que los tests prueban comportamiento observable y no implementación; (c) corrección: casos límite, entradas vacías o mal formadas, errores que acaban en una traza en vez de un mensaje, promesas sin esperar; (d) que sigue las convenciones de AGENTS.md: reparto de carpetas, \`src/shared\` sin APIs de Node ni del navegador, salida de la CLI corta por defecto y \`--json\` equivalente, errores por stderr que dicen cómo arreglar la entrada. Ignora el estilo puro: de eso se ocupa el linter.`,
  },
  {
    key: 'tests',
    prompt: `${DIFF}

Eres el rival reviewer de TESTS. Dos preguntas con el mismo peso: si alguien rompe el código nuevo, ¿algún test se pone rojo?; y ¿hay tests de esta rama que no fijan nada que otro no fije ya? Las otras reviews leen ${worktree} a la vez que tú, así que NO lo modifiques: crea tu propio worktree desechable con \`git -C ${repo} worktree add --detach ${MUTANTES} ${branch}\`, instala ahí con pnpm, trabaja ahí y bórralo al acabar con \`git -C ${repo} worktree remove --force ${MUTANTES}\`.
1. Cobertura: ejecuta UNA vez la suite con cobertura (\`pnpm vitest run --coverage\`; si falta el proveedor, instálalo solo en tu worktree desechable con \`pnpm add -D @vitest/coverage-v8\`). Fíjate solo en las líneas y ramas que añade o cambia el diff: cada una sin cubrir es un hallazgo.
2. Mutation testing, acotado: entre 3 y 8 mutaciones según el tamaño del diff, solo en lógica de las líneas cambiadas (negar o invertir una condición, quitar una guarda o un return temprano, borrar una llamada con efecto, devolver vacío). No mutes lo que el paso 1 ya da por descubierto, ni constantes ni textos. Escribe un script que aplique cada mutación, ejecute solo el fichero de test relevante y revierta con \`git checkout -- <fichero>\`, y lánzalo una vez para todas. Cada mutante que sobrevive es un hallazgo: en la descripción va la mutación exacta y en la propuesta, primero la aserción de un test existente de la rama que habría que reforzar; un test nuevo solo si ninguno ejercita esa línea.
3. Completitud frente al plan: cada criterio y cada regla que el plan enumera tiene al menos un test que falla si no se cumple; también los caminos de error y los límites que el plan o el código nuevo distinguen.
4. Fallos externos: haz TÚ el inventario descrito abajo, sin fiarte de lo que diga el implementador. Es hallazgo cada CLASE de fallo que ningún test ejercita y cada fallo real que acaba en una traza sin que nadie lo haya decidido. No es hallazgo una causa más de una clase que ya tiene su test.
5. Solapamiento: repasa los tests que AÑADE el diff con las reglas de economía de abajo. Es hallazgo, con severidad baja, cada grupo de tests de la rama que repite una decisión: la misma matriz en dos capas, un N × M donde bastaba N + M, tests de la librería, un test subsumido por otro. En la propuesta: qué tests se retiran o se funden y cuál queda fijando la decisión. Nunca propongas tocar tests que ya existían en ${base}.
No son hallazgos los mutantes equivalentes (que no cambian el comportamiento observable) ni el código que el diff no toca. En la descripción de cada hallazgo, incluye el comando con el que se reproduce.

${FALLOS_EXTERNOS}

${ECONOMIA_TESTS}`,
  },
]
if (impl.toca_frontend) {
  REVIEWS.push({
    key: 'frontend',
    prompt: `${DIFF}

Eres el rival reviewer de FRONTEND. Contrasta lo que el diff hace en web/ con el comportamiento acordado en prototype/index.html y con los requisitos de AGENTS.md: controles y atajos (Espacio, ←, →, R), tira de pasos clicable, panel de historial agrupado por paso que crece en pausa, resaltado que atenúa el resto, tema claro y oscuro, panel estrecho sin scroll horizontal de página, pantalla de inicio por el clic que exige el navegador, proveedor de voz silencioso como reserva. Además: accesibilidad básica (botones con nombre, foco visible) y que los tests de navegador prueban lo que ve y oye la persona. Solo lo que contradiga el prototipo, el plan o AGENTS.md, con la referencia.`,
  })
} else {
  log('El diff no toca web/: se omite la review de frontend')
}

const hallazgos = {}
const verificados = await pipeline(
  REVIEWS,
  r => agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  (res, r) => {
    if (!res) return []
    hallazgos[r.key] = res.hallazgos.length
    log(`review:${r.key} → ${res.hallazgos.length} hallazgos`)
    return parallel(res.hallazgos.map(h => () =>
      agent(`${DIFF}

Un reviewer de ${r.key} afirma este hallazgo en ${h.fichero}${h.linea ? ':' + h.linea : ''}:
"${h.titulo}" — ${h.descripcion}

Tu trabajo es REFUTARLO. Lee el código real, quién lo llama y los tests. Si el hallazgo es falso, no reproducible, ya lo cubre un test, queda fuera de lo que pide el plan, o es una preferencia sin consecuencia, refutado=true. Si dudas, refutado=true. Un hallazgo que pide un test nuevo se refuta también por redundancia: si otro test de la rama ya ejercita esa misma rama del código o esa misma clase de fallo, refutado=true. Una clase de fallo externo que ningún test ejercita no es "sin consecuencia" aunque el código ya la maneje. Un hallazgo de solapamiento se refuta si alguno de los tests que propone retirar fija algo que el que queda no fija, o si ya existía en la base. Explica el motivo en dos líneas.`,
        { label: `verificar:${r.key}:${h.titulo.slice(0, 40)}`, phase: 'Verificar', schema: VERDICT_SCHEMA, effort: 'high' })
        .then(v => (v && !v.refutado) ? { ...h, origen: r.key } : null)
    ))
  },
)

const confirmados = verificados.flat(2).filter(Boolean)
log(`Hallazgos confirmados: ${confirmados.length}`)

// ---------- 4. Corregir ----------
let fix = null
if (confirmados.length) {
  phase('Corregir')
  fix = await agent(`${CONTEXTO}

Eres el agente corrector. En la rama ${branch} hay una implementación revisada. Estos hallazgos han sobrevivido a una verificación adversaria y hay que atenderlos:

${JSON.stringify(confirmados, null, 2)}

Para cada uno: corrígelo (rojo → verde) o, si tras leer el código concluyes que corregirlo empeora el resultado o excede el plan, déjalo en "descartados" con el motivo. Commits separados por hallazgo, en inglés, sin líneas de atribución a Claude. Al final relanza \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\` y \`pnpm build\`. No toques nada que no venga de un hallazgo. No hagas push ni abras la PR.
Tests: antes de crear uno, refuerza una aserción de un test existente de la rama si con eso el hallazgo queda cubierto. Si añades un caso a una tabla o un bucle, cuenta cuántos ejemplos nuevos genera; si son más de dos, escribe el caso suelto. Los hallazgos de solapamiento se corrigen retirando o fundiendo tests creados en esta rama, nunca los que ya existían en ${base}.

${ECONOMIA_TESTS}`,
    { label: 'corregir', phase: 'Corregir', schema: FIX_SCHEMA })
} else {
  log('Sin hallazgos confirmados: se salta la corrección')
}

if (revisar) return { tarea, branch, hallazgos, confirmados, fix }

// ---------- 5. PR ----------
phase('PR')
const pr = await agent(`${CONTEXTO}

Eres el agente que abre la PR. Empuja la rama ${branch} y abre la PR contra ${base} con \`gh\` en gabimig/prwalk, siempre en borrador. Título y descripción en inglés. La descripción es corta y al grano: una o dos frases con qué entrega la tarea; tres o cuatro comandos para probarlo a mano; la licencia de cada dependencia añadida; y, solo si las hay, un <details><summary>Decision log</summary> con las desviaciones del plan y las dudas abiertas, una frase cada una. Sin listas de tests, sin el proceso (cómo se probó, rival reviews, hallazgos corregidos o descartados) y sin ninguna línea de atribución a Claude ni a Claude Code.
Después, en ese mismo worktree, edita docs/plan/TASKS.md: marca la fila de la tarea ${tarea} como \`[~]\` y pon el enlace a la PR en la última columna; commitea ("docs: link PR for task ${tarea}") y empuja a la misma rama. No toques docs/plan/ESTADO.md. No hagas merge.

Resumen del implementador: ${impl.resumen}
Dependencias: ${JSON.stringify(impl.dependencias)}
Desviaciones: ${JSON.stringify(impl.desviaciones)}
Dudas: ${JSON.stringify(impl.dudas)}
Corrección: ${JSON.stringify(fix)}`,
  { label: `pr ${tarea}`, phase: 'PR', schema: PR_SCHEMA, model: 'sonnet' })

return { tarea, branch, impl, hallazgos, confirmados, fix, pr }
