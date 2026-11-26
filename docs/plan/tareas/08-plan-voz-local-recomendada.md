# 08 · Plan: voz local recomendada, instalable con un comando

Lee antes `AGENTS.md`, `skill/GUIDE.md`, `skill/VOICES.md`, `examples/voices/`, `src/server/adapter.ts`, `src/server/state.ts` y `src/cli/voice-commands.ts`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/08-local-voice`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Por qué

La tarea 07 dejó la voz como pieza enchufable. A Gabriel la voz del navegador le resulta insufrible, y quiere que, la primera vez, su agente le ofrezca quedarse con ella o instalar otra, y que haya una **propuesta local buena lista para instalar con un comando**. Él habla con su agente en español y revisa código en inglés: la voz tiene que sonar bien en los dos idiomas.

## Qué hay que entregar

### 1. Voces instalables

- **`prwalk voice list`**: las voces instalables del catálogo (nombre, idiomas, tamaño aproximado de la descarga, licencias) y cuáles están ya instaladas, además de la voz en uso.
- **`prwalk voice install <nombre> [--option clave=valor]...`**:
  1. crea `<PRWALK_HOME>/voices/<nombre>/` con su propio `package.json` e instala allí, con `npm install`, las dependencias del motor **con versión exacta**;
  2. copia allí el adaptador, que viaja dentro del paquete de prwalk;
  3. descarga el modelo a esa misma carpeta, para que la primera frase no espere;
  4. sintetiza una frase de prueba;
  5. deja la voz elegida (lo mismo que `voice use` con ese adaptador) y avisa al demonio si está vivo.

  Va contando por dónde va en la salida de error, porque tarda. Si algo falla, código 1, un mensaje que diga qué paso falló y cómo reintentarlo, y **la voz que había no cambia**. Volver a ejecutarlo repara o actualiza la instalación.
- **`prwalk voice remove <nombre>`**: borra esa carpeta; si era la voz en uso, vuelve a `browser`.
- Todos con `--json`, como el resto.

El catálogo es una lista dentro del paquete (por ejemplo `voices/<nombre>/voice.json` más `adapter.mjs`): para añadir otra voz en el futuro basta otra carpeta. **El motor y el modelo no son dependencias de prwalk**: se instalan aparte, a petición del usuario, y `pnpm install` del repositorio no los trae.

### 2. Qué voz: decide probando

Tiene que ser local, con pesos de licencia permisiva, sonar natural en **español e inglés**, y sintetizar una frase normal en menos tiempo del que dura al decirla en un portátil sin GPU. El adaptador elige la voz según el idioma de la frase (`lang`), con una voz por defecto para `es` y otra para `en`, y cae al inglés para un idioma que no tenga. `--option voice=<id>` fija una concreta.

Candidatas, en este orden. **Comprueba cada una sintetizando de verdad en español**; no te fíes de lo que recuerdes de estas librerías, mira su documentación actual:

1. **Kokoro 82M v1.0** (pesos Apache-2.0), con el motor de Node que de verdad hable español con él. Mira `kokoro-js` y `sherpa-onnx-node` (con el modelo multilingüe de Kokoro). Kokoro trae voces españolas (`ef_dora`, `em_alex`, `em_santa`), pero algún motor solo hace el paso de texto a fonemas en inglés: eso lo descarta para español.
2. **Voces de Piper** en español e inglés mediante `sherpa-onnx-node`, eligiendo voces cuyo modelo tenga licencia permisiva (mira la ficha de cada una).

Cómo comprobar el español sin oído: que el motor reciba el idioma y use fonemas de español (inspecciona los fonemas o las opciones que acepta); que la duración del audio sea razonable para la frase (unas 2 a 4 sílabas por segundo); y que el audio no sea silencio ni esté saturado. Mide también el tiempo de síntesis.

Entrega **la mejor candidata con el nombre `kokoro`** si es Kokoro, o con el nombre del motor si no. Si una segunda candidata también funciona y es claramente distinta (por ejemplo Piper), añádela al catálogo solo si te cuesta poco; no es obligatorio.

**Licencias.** Los motores de este tipo suelen convertir el texto en fonemas con `espeak-ng`, que es GPL-3. Como la voz se instala aparte, a petición del usuario, y prwalk ni la incluye ni depende de ella, se acepta; pero `voice list`, `voice install` y la documentación tienen que decir las licencias del motor, del modelo y de sus piezas. No añadas nada GPL a `dependencies` ni a `devDependencies` de prwalk.

### 3. La primera vez (`skill/GUIDE.md`)

Cuando `prwalk voice` dice que el usuario no ha elegido, el mensaje de "listo" del agente ofrece tres caminos, en una o dos líneas: seguir con la voz del navegador; instalar la voz local recomendada (di su nombre, que es una descarga de tantos megas y que nada sale de la máquina); o acoplar otro proveedor. Según responda: `prwalk voice use browser`, `prwalk voice install <nombre>` (ejecútalo en segundo plano si tu entorno lo permite y avisa cuando esté), o `prwalk voice guide`. Sigue sin bloquear el recorrido. Guía corta.

### 4. Documentación

README (sección de voces: la recomendada, qué descarga, licencias, cómo quitarla), `skill/VOICES.md` (una línea que remite a `voice list`) y `AGENTS.md` (comandos y carpetas nuevas).

## Tests

Un test por decisión, en la capa más baja. Sin matrices. **Los tests y la CI no descargan modelos ni motores.**

| Qué se decide | Capa | Test |
|---|---|---|
| Leer el catálogo; un nombre desconocido se rechaza con la lista | función pura | Uno |
| `install`: crea la carpeta, instala, copia el adaptador, prueba y deja la voz elegida; si un paso falla, la voz anterior no cambia | CLI o función, con el instalador de dependencias y la descarga inyectados (falsos) y una voz de catálogo de prueba cuyo adaptador genera un wav mínimo | Dos |
| `remove` borra y vuelve a `browser` si era la voz en uso | igual | Uno |
| El adaptador elige la voz por idioma y respeta `--option voice` | función pura del adaptador, sin cargar el motor | Uno |
| `voice list` conecta catálogo, disco y salida | CLI, binario compilado | Uno |
| El adaptador real del catálogo cumple el contrato (forma, no síntesis) | como el test de los ejemplos | Uno |
| El paquete empaquetado incluye el catálogo | `pnpm test:pack` | Amplía el script |

La instalación real se comprueba a mano (abajo), no en la CI.

## Qué no hay que hacer

- No metas el motor ni el modelo en las dependencias de prwalk ni en el paquete.
- No cambies el contrato del adaptador de la 07; si te hace falta algo, dilo en la PR.
- No añadas voces en la nube al catálogo.
- No publiques nada ni toques la visibilidad del repositorio.
- No instales la skill en `~/.claude/skills`, no enlaces nada globalmente, no toques `~/.local/bin` ni el `~/.prwalk` real: `PRWALK_HOME` temporal y otro puerto. No dejes demonios vivos.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:pack` y `pnpm build` en verde.
2. A mano, con un `PRWALK_HOME` temporal: `prwalk voice list`; `prwalk voice install <nombre>` de verdad, con red; `prwalk voice test` en español y en inglés con `--out`, y deja los dos wav en la carpeta `samples/` de tu worktree (sin commitear) con una frase de narración realista de unos 15 a 20 palabras; abre el ejemplo en el navegador con esa voz y comprueba que el audio se pide y avanza; `prwalk voice remove <nombre>`.
3. En la PR: qué motor y modelo elegiste y por qué, qué candidatas descartaste y por qué, tamaño de la descarga, tiempo de síntesis medido frente a duración del audio, y todas las licencias.
4. En tu mensaje final, las rutas absolutas de los wav de muestra, para que Gabriel los oiga.
5. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
