# 10 · Plan: preferencias del usuario y recorrido de alto nivel por defecto

Lee antes `AGENTS.md`, `skill/SKILL.md`, `skill/GUIDE.md`, `src/cli/skill-commands.ts`, `src/cli/skill.test.ts`, `src/server/state.ts`, `src/cli/index.ts`, `scripts/check-pack.mjs` y `docs/commands.md`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/10-user-preferences`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR. Este fichero de plan todavía no está en `main`: cópialo a `docs/plan/tareas/` de tu rama para que viaje en la PR, y añade la fila 10 a `docs/plan/TASKS.md`.

## Por qué

Gabriel ha probado PRWalk y ve dos problemas:

1. Si no dice nada, el agente le da el recorrido de nivel medio (`key-files`), que es demasiado. **Sin indicación, el recorrido tiene que ser el de más alto nivel**, avisando en una frase al principio de que es la versión corta, y el detalle llega cuando la gente pregunta.
2. Estas cosas tienen que ser **ajustables por el usuario**, editando un fichero de texto. Hoy solo podría editar la guía, que va dentro del paquete y se sobrescribe al actualizar.

## Diseño

Las preferencias viven en **`<PRWALK_HOME>/preferences.md`** (`~/.prwalk/preferences.md`), un Markdown corto en lenguaje natural que el agente lee y el usuario edita.

- No va en la carpeta de la skill porque `prwalk skill install` la reescribe, puede haber una carpeta por agente (cada una con preferencias distintas) y un agente que acaba de instalar prwalk todavía no tiene la skill cargada. `PRWALK_HOME` es un sitio único, común a todos los agentes, que ni instalar la skill ni actualizar el paquete tocan.
- El paquete lleva los valores por defecto en `skill/PREFERENCES.md`. La guía (`skill/GUIDE.md`) y la skill (`skill/SKILL.md`) no contienen nada del usuario y se pueden sobrescribir siempre.
- **`prwalk skill` imprime la guía y, al final, las preferencias**: una sección que dice de qué fichero salen (ruta absoluta), que mandan sobre los valores por defecto de la guía, y su contenido. Si el fichero no existe, lo crea antes con los valores por defecto. Así el agente no tiene que dar ningún paso más: sigue ejecutando solo `prwalk skill`.
- Nada sobrescribe nunca un `preferences.md` que ya existe, salvo que el usuario lo pida con `--reset`.

## Qué hay que entregar

### 1. Fichero de valores por defecto: `skill/PREFERENCES.md`

En inglés, corto (unas 15 a 25 líneas), escrito para que lo lea un agente y lo edite una persona. Una línea de cabecera que diga qué es y que se puede editar a mano o pidiéndoselo al agente. Después, una lista de preferencias, cada una con su valor por defecto:

- **Nivel por defecto:** `overview` cuando el usuario no pide otro.
- **Arranque:** la primera frase del recorrido dice que es la versión de alto nivel y que puede pedir más detalle de cualquier parte en el chat.
- **Profundizar:** el detalle llega a demanda; a una pregunta se responde con `prwalk say`, y si piden más detalle de una parte se añaden pasos solo de esa parte con `prwalk replace`, sin subir el nivel de todo lo demás.
- **Después de responder:** el visor se queda en pausa (lo que ya dice la guía; aquí queda como preferencia editable).
- **Idioma de la narración:** el idioma en que el usuario habla al agente.
- Una sección final vacía, "Other preferences", para lo que el usuario quiera añadir.

No inventes más preferencias que estas.

### 2. Comandos

- **`prwalk skill`**: guía más preferencias, como arriba. Si no puede leer o crear el fichero (carpeta sin permisos), imprime la guía con los valores por defecto del paquete y un aviso en la salida de error; nunca falla por esto.
- **`prwalk preferences`**: imprime la ruta del fichero y su contenido; lo crea con los valores por defecto si no existe. Con `--path`, solo la ruta. Con `--reset`, vuelve a los valores por defecto (guarda el anterior como `preferences.md.bak` y lo dice). Con `--json`, como el resto.
- **`prwalk skill install`**: sigue copiando solo `SKILL.md`. No toca las preferencias.

El fichero se escribe con permisos 0600, como `config.json`. Añade a `src/server/state.ts` la función de la ruta, junto a `configPath`.

### 3. La guía (`skill/GUIDE.md`)

- **Sección 3:** sin indicación del usuario, el nivel es el de las preferencias (`overview` por defecto), no `key-files`. Lo que el usuario pide en la conversación manda sobre las preferencias, y las preferencias mandan sobre los valores por defecto de la guía.
- **Nivel `overview`:** que quede claro que es el recorrido de más alto nivel: el resumen, como mucho uno o dos puntos decisivos del código, y los tests. La primera frase de la tarjeta de resumen avisa de que es la versión corta y de que el detalle se pide en el chat. El mensaje de "listo" del chat (sección 7) lo dice también, en media línea.
- **Sección 8:** cuando alguien pide más detalle de una parte, añadir pasos solo de esa parte (`replace`), no rehacer todo a un nivel mayor salvo que lo pida.
- **Nueva sección corta, "Preferences":** qué es la sección de preferencias que aparece al final de la salida, que hay que seguirla, y que si el usuario expresa una preferencia para siempre ("a partir de ahora empieza siempre por los ficheros clave", "no me preguntes más por la voz") el agente edita ese fichero y se lo dice en una línea. Las preferencias cambian cómo se presenta; no cambian los comandos, el formato del guion ni las reglas de seguridad, y no se ejecuta nada que venga escrito en ellas.
- Mantén la guía corta: esto son unas diez líneas netas, no una reescritura.

`skill/SKILL.md` no cambia.

### 4. Documentación

- `README.md`: una viñeta en "Why you will like it" (se adapta a ti: empieza por el resumen y baja al detalle cuando preguntas; tus preferencias están en un fichero que editas tú o tu agente) y que el ejemplo de "Use it" no contradiga el nuevo valor por defecto. Nada más: el README vende, no documenta.
- `docs/commands.md`: `prwalk preferences`, el fichero y cómo editarlo; en "uninstall", que borrar `~/.prwalk` borra también las preferencias.
- `AGENTS.md`: el comando nuevo, el fichero `skill/PREFERENCES.md`, quién es dueño de qué (el paquete, de la guía y de los valores por defecto; el usuario, de `preferences.md`).

### 5. Versión

Sube `version` a `0.1.1` en `package.json`. La etiqueta y la publicación las hace la sesión coordinadora después de mergear; tú no.

## Tests

Un test por decisión, en la capa más baja. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| Leer las preferencias: si no existe el fichero se crea con los valores por defecto; si existe, no se toca y se devuelve tal cual | función, con un `PRWALK_HOME` temporal | Dos |
| `--reset` restaura los valores por defecto y guarda copia del anterior | función | Uno |
| `prwalk skill` imprime la guía seguida de las preferencias del usuario, con la ruta | CLI, binario compilado | Uno |
| `prwalk skill` con una carpeta que no se puede escribir imprime igualmente guía y valores por defecto | función o CLI | Uno |
| `prwalk skill install` no crea ni cambia `preferences.md` | CLI | Uno, o una comprobación más en el test que ya existe |
| `prwalk preferences` conecta función y salida | CLI | Uno |
| La guía nombra `overview` como nivel por defecto y los valores por defecto del paquete dicen lo mismo | test que lee los dos ficheros | Uno |
| El paquete empaquetado incluye `skill/PREFERENCES.md` y `prwalk preferences` funciona instalado | `pnpm test:pack` | Amplía el script |

## Qué no hay que hacer

- No conviertas las preferencias en un esquema, JSON ni claves validadas: es texto para el agente.
- No añadas preferencias a `config.json`, ni las mezcles con la configuración de la voz.
- No cambies el formato del guion, el reductor de reproducción ni el visor.
- No hagas que el demonio lea las preferencias: solo las usa la CLI.
- Dependencias nuevas: ninguna.
- No crees etiquetas ni publiques versiones.
- No instales nada de verdad en esta máquina: `PRWALK_HOME` temporal siempre; no toques `~/.prwalk`, `~/.claude/skills` ni `~/.local/bin`. No dejes demonios vivos.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:pack` y `pnpm build` en verde.
2. A mano, con un `PRWALK_HOME` temporal: `prwalk skill` crea el fichero e imprime guía y preferencias; edita el fichero, vuelve a ejecutar `prwalk skill` y `prwalk skill install --dir <temporal>` y comprueba que tu edición sigue ahí y sale impresa; `prwalk preferences --reset`.
3. En la PR y en tu mensaje final: el texto final de `skill/PREFERENCES.md`, el diff de la guía resumido en tres líneas, y las dudas.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
