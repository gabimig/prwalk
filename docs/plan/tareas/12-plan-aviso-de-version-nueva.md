# 12 · Plan: aviso de versión nueva y `prwalk update`

Lee antes `AGENTS.md`, `skill/GUIDE.md`, `src/cli/index.ts`, `src/cli/skill-commands.ts`, `src/cli/session-commands.ts`, `src/cli/daemon-client.ts`, `src/cli/voice-download.ts` (cómo se lanza `npm` desde la CLI), `src/server/state.ts`, `src/server/server.ts`, `src/server/daemon.ts`, `src/shared/protocol.ts`, `web/src/App.tsx`, `web/src/i18n.ts`, `.github/workflows/release.yml` y `docs/commands.md`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/12-update-notice`, desde `main` (commit `0165a86`, versión 0.1.1).
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR. Este fichero de plan todavía no está en `main`: cópialo a `docs/plan/tareas/` de tu rama para que viaje en la PR, añade la fila 12 a `docs/plan/TASKS.md` y marca la fila 10 como `[x]`.
- **Ojo:** la tarea 11 (árbol de ficheros) tiene una PR abierta y congelada, sin mergear. No la toques ni dependas de ella; esta tarea sale antes.

## Por qué

prwalk se instala desde la última versión publicada en GitHub, pero una vez instalado nadie se entera de que hay una versión nueva: ni el usuario ni su agente. Gabriel quiere que:

1. cuando la instalación no está al día, **se avise**: el agente lo dice en el chat y la página lo enseña arriba a la derecha;
2. baste con decirle al agente "actualiza" para que **él lo haga todo**.

Sale como versión **0.1.2**, antes que el árbol de ficheros, para que quien la instale vea llegar las siguientes.

## Qué hay que entregar

### 1. Saber si hay versión nueva

Un módulo pequeño, usado por la CLI y por el demonio:

- **Cómo se consulta:** una petición `GET` a `https://github.com/gabimig/prwalk/releases/latest` **sin seguir la redirección**; la cabecera `Location` acaba en `/releases/tag/vX.Y.Z`. No uses `api.github.com` (tiene límite de peticiones sin autenticar). La petición no lleva nada del usuario: sin cuerpo, sin parámetros, y un `User-Agent` genérico (`prwalk`), sin versión ni identificadores.
- **Cuándo:** como mucho una vez cada 24 horas. El resultado se guarda en `<PRWALK_HOME>/update-check.json` (`{ "checkedAt": ..., "latest": "0.2.0" }`, permisos 0600). Entre medias se responde de ese fichero, sin red.
- **Nunca molesta:** tiempo máximo de 2 segundos; sin red, con un error, con una respuesta rara o con un fichero corrupto, el resultado es "no se sabe" y no se imprime ni se enseña nada. Ningún comando falla ni tarda más de esos 2 segundos por esto.
- **Comparación:** `X.Y.Z` numérica, con una función propia (sin dependencia). Hay versión nueva solo si la publicada es **mayor** que la instalada; una versión local más alta (desarrollo) no avisa. Una etiqueta que no sea `vX.Y.Z` se ignora.
- **Apagarlo:** con `PRWALK_UPDATE_CHECK=0` no se consulta nunca ni se lee el fichero.
- La versión instalada es la de `package.json` del paquete, como ya hace `prwalk --version`.

### 2. Dónde se avisa

- **En el chat, por el agente.** `prwalk skill` añade al final de lo que imprime (después de las preferencias) un bloque corto cuando hay versión nueva: versión instalada, versión disponible, y que el agente se lo diga al usuario en una línea y ejecute `prwalk update` si acepta. Sin versión nueva no añade nada. `prwalk skill` es lo primero que ejecuta el agente, así que aquí es donde se hace la consulta por parte de la CLI.
- **En la página.** Arriba a la derecha de la cabecera, una etiqueta discreta: "Versión 0.2.0 disponible" y, al pasar el ratón o enfocarla, "Dile a tu agente que actualice PRWalk". No es un botón que ejecute nada: la página no instala ni lanza comandos. Una × la oculta para esa versión (se recuerda en `localStorage`, con `try/catch`); con otra versión nueva vuelve a salir. Textos por `web/src/i18n.ts`. Tema claro y oscuro, y que no rompa la cabecera en un panel estrecho.
  - El dato llega del demonio: al arrancar y al abrir una sesión, el demonio hace la misma consulta (en segundo plano, sin retrasar nada) y lo manda al visor con el mensaje de estado que ya existe, como un campo opcional `update: { current, latest }`. El visor no habla nunca con GitHub: la CSP no cambia.
- **En `prwalk open`:** una línea más en su salida de texto cuando hay versión nueva (y un campo en `--json`), leída del fichero, sin hacer otra consulta.

### 3. `prwalk update`

- Consulta la última versión (esta vez siempre, sin mirar las 24 horas). Si ya está al día, lo dice y termina con código 0.
- Si hay una nueva: para el demonio si está vivo (corre el código viejo), ejecuta `npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz` y comprueba la versión que ha quedado ejecutando el binario instalado. Imprime `Updated prwalk 0.1.2 -> 0.2.0` y, si había una sesión abierta, que hay que volver a abrirla (`prwalk open ...` y `prwalk play ...`). Va contando por dónde va en la salida de error.
- `--check`: solo dice si hay versión nueva; no instala ni para nada.
- `--json`, como el resto.
- Si falla `npm` (sin permisos, sin red), código 1 y un mensaje con el comando exacto para hacerlo a mano. El demonio no se para hasta saber que hay algo que instalar.
- Si prwalk no está instalado como paquete global de npm (por ejemplo se ejecuta desde un checkout del repositorio), no instala nada: lo dice y da el comando.
- No toca la skill, las preferencias, la configuración de voz ni las voces instaladas.

### 4. La guía (`skill/GUIDE.md`)

Una sección corta, "Updates": si la salida de `prwalk skill` termina con el aviso de versión nueva, dilo en una línea dentro del mensaje de "listo" (sección 7), sin esperar respuesta y sin repetirlo en la misma conversación. Si el usuario dice que sí: `prwalk update`; si había un recorrido en marcha, vuelve a abrir la sesión y a cargar el mismo guion, y dile que pulse Start. Si dice que no, no insistas.

### 5. Documentación y versión

- `README.md`: en "Private" o junto a él, una frase honesta: lo único que prwalk pide por su cuenta a la red es, una vez al día, cuál es la última versión publicada en GitHub; no envía nada y se apaga con `PRWALK_UPDATE_CHECK=0`. En "Install", una línea: para actualizar, dile a tu agente "actualiza PRWalk".
- `docs/commands.md`: `prwalk update`, la variable nueva, el fichero `update-check.json`, y la sección de privacidad al día.
- `AGENTS.md`: comando, módulo y fichero nuevos; en los requisitos de privacidad, la consulta de versión.
- `SECURITY.md` si menciona que no hay llamadas de red.
- `version` a `0.1.2` en `package.json`. La etiqueta y la publicación las hace la sesión coordinadora.

## Tests

Un test por decisión, en la capa más baja. Sin matrices. **Ningún test sale a la red ni ejecuta `npm` de verdad:** la petición y el instalador se inyectan.

| Qué se decide | Capa | Test |
|---|---|---|
| Comparar versiones: mayor, igual, menor, etiqueta que no es `vX.Y.Z` | función pura | Uno, con los casos como filas |
| De la cabecera `Location` sale la versión | función pura | Uno |
| Con un resultado de menos de 24 horas no se consulta; con uno más viejo sí, y se guarda | función, con reloj y petición inyectados | Dos |
| Error, tiempo agotado o fichero corrupto dan "no se sabe" sin lanzar | función | Uno |
| `PRWALK_UPDATE_CHECK=0` no consulta ni lee | función | Uno |
| `prwalk skill` añade el aviso solo cuando hay versión nueva | CLI o función | Uno |
| `update`: al día no hace nada; con versión nueva para el demonio, instala y comprueba; si `npm` falla, código 1 con el comando | función, con instalador falso | Tres |
| `update` fuera de una instalación global no instala | función | Uno |
| El demonio manda `update` al visor y la página enseña la etiqueta; la × la oculta para esa versión | navegador (`test/e2e`), con el resultado sembrado en `update-check.json` | Uno |
| `prwalk update --check` funciona con el paquete instalado | `pnpm test:pack`, con `PRWALK_UPDATE_CHECK=0` o el fichero sembrado, sin red | Amplía el script |

## Qué no hay que hacer

- No actualices nunca solo: siempre lo pide el usuario a través de su agente.
- No añadas telemetría ni mandes la versión instalada, el sistema o cualquier identificador en la consulta.
- La página no ejecuta nada ni habla con GitHub.
- No publiques en npm ni cambies cómo se instala.
- Dependencias nuevas: ninguna.
- No crees etiquetas ni publiques versiones.
- No instales ni actualices nada de verdad en esta máquina: `PRWALK_HOME` temporal, puerto distinto de 4517 y `npm install -g` solo con `--prefix` a una carpeta temporal. El dueño tiene una instalación real (0.1.0, con su demonio en el 4517 y `~/.prwalk`): no la pares, no la uses y no la actualices. No toques `~/.claude/skills` ni `~/.local/bin`. No dejes demonios vivos.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:pack` y `pnpm build` en verde.
2. A mano, con `PRWALK_HOME` temporal: una consulta real a GitHub desde el paquete compilado (la versión de la rama es 0.1.2 y la publicada 0.1.1: no debe avisar); después siembra `update-check.json` con una versión mayor y comprueba el aviso en `prwalk skill`, en `prwalk open` y en la página (a 1100 y 600 px); `prwalk update --check`. Para probar la instalación de verdad: empaqueta, instala el `.tgz` en un `--prefix` temporal y ejecuta desde ahí `prwalk update` con el fichero sembrado; reinstalará la 0.1.1 publicada en ese prefijo, que es justo lo que hay que ver.
3. En la PR y en tu mensaje final: el texto exacto del aviso que imprime `prwalk skill`, cómo detectas que la instalación es global, y las dudas.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
