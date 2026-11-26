# 07 · Plan: proveedores de voz enchufables y pausas

Lee antes `AGENTS.md`, `skill/GUIDE.md`, `web/src/voice/` (sobre todo `voice.ts`, `create.ts`, `web-speech.ts`, `choice.ts`), `web/src/playback/engine.ts`, `src/server/server.ts`, `src/server/state.ts` y `src/cli/index.ts`. Arranca la aplicación una vez: `pnpm build`, `prwalk open --patch test/fixtures/example.diff --title Example`, `prwalk play test/fixtures/example-script.json`, y abre la URL. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/07-pluggable-voices`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Por qué

Gabriel probó el primer recorrido real y encontró dos problemas:

1. **La voz del navegador no le vale.** Quiere que la voz sea una pieza enchufable: prwalk trae por defecto la del navegador y cualquiera puede acoplar otro proveedor (un modelo local, un servicio en la nube) escribiendo un adaptador pequeño, normalmente con ayuda de su agente.
2. **No hay pausas.** La narración encadena una frase con la siguiente y un paso con el siguiente sin silencio, y no da tiempo a asimilar.

La tarea 08 añadirá encima una voz local recomendada que se instala con un comando. Aquí se construye el mecanismo; no instales ningún modelo.

## Diseño (ya decidido)

### Dónde corre un proveedor

- **`browser`**, el de siempre: la Web Speech API en la página. Es el valor por defecto.
- **Un adaptador**: un módulo ES que carga **el demonio** (Node), no la página. La página le pide al demonio el audio de cada frase y lo reproduce. Así un adaptador puede usar un modelo local, un ejecutable o una API con su clave sin tocar el navegador.

### El contrato del adaptador

Un fichero `.mjs` o `.js` con una exportación por defecto:

```js
export default {
  name: 'my-voice', // opcional; por defecto, el nombre del fichero
  async synthesize({ text, lang, options }) {
    // text: una frase. lang: BCP-47 ("es", "en-GB"). options: lo guardado con --option.
    return { audio: bytes, mimeType: 'audio/wav' }; // Uint8Array o Buffer; wav, mpeg u ogg
  },
};
```

Nada más. La velocidad no llega al adaptador: la aplica la página con `playbackRate` conservando el tono.

### Configuración

`config.json` en la carpeta de estado (`~/.prwalk`, o `PRWALK_HOME`), con permisos 0600:

```json
{ "voice": { "provider": "/abs/path/adapter.mjs", "options": { "voice": "nova" } } }
```

`provider` es `"browser"` o la ruta absoluta de un adaptador. **Sin clave `voice`, el usuario todavía no ha elegido**: se usa `browser` y los comandos lo dicen, para que el agente pregunte una vez.

### Comandos nuevos

- **`prwalk voice`**: muestra el proveedor en uso y si el usuario ya eligió. Si no, una línea que lo dice.
- **`prwalk voice use browser`** y **`prwalk voice use <ruta> [--option clave=valor]...`**: resuelve la ruta a absoluta, carga el módulo, comprueba que cumple el contrato y guarda la configuración. Con error, código 1 y no cambia nada. Si hay demonio vivo, le avisa y el visor cambia de voz a partir de la frase siguiente, sin recargar.
- **`prwalk voice test [texto] [--lang <idioma>] [--out <fichero>]`**: sintetiza una frase con el proveedor configurado y dice el tipo, el tamaño y lo que tardó; con `--out`, guarda el audio. Con `browser` dice que esa voz solo se puede oír en la página.
- **`prwalk voice guide`**: imprime la guía para escribir un adaptador (`skill/VOICES.md`, nueva, en inglés): el contrato, las reglas de abajo, cómo probarlo con `voice test`, y los dos ejemplos.

Todos con `--json` salvo `guide`, como el resto.

### En el demonio

- **`POST /api/tts`** con `{ text, lang }` devuelve los bytes con su `Content-Type`. Exige el token y la comprobación de `Host`, como las demás peticiones que cambian algo: una síntesis puede costar dinero. Sin adaptador configurado, 409.
- Límites: texto de 2000 caracteres como mucho, 30 segundos por síntesis, una síntesis a la vez por adaptador (las demás esperan en cola), tipos de audio permitidos `audio/wav`, `audio/mpeg`, `audio/ogg`, y 20 MB de respuesta.
- Caché en memoria de las últimas 200 frases (clave: proveedor, opciones, idioma, texto), para que reiniciar un paso no vuelva a sintetizar.
- **El adaptador solo sale de `config.json`.** Ninguna petición HTTP, ningún mensaje del visor y ningún campo del guion puede elegir ni cambiar la ruta: la escribe la CLI en disco y el demonio la relee cuando la CLI le avisa. Cargar un adaptador es ejecutar código elegido por el usuario con sus permisos; la guía lo dice.
- Un fallo del adaptador (excepción, tiempo agotado, forma incorrecta) responde 502 con un mensaje corto, queda en `daemon.log` y `prwalk status` lo enseña en una línea.
- El mensaje inicial al visor dice qué proveedor hay (`browser` o remoto, con su nombre); un cambio se difunde.
- CSP: añade solo lo que haga falta para reproducir el audio (`media-src 'self' blob:`).

### En el visor

- `VoiceProvider` gana un método opcional `prepare(text, lang)`. El motor lo llama con la frase siguiente cuando empieza la actual, para que no haya hueco entre frases.
- Nuevo `RemoteVoice`: pide el audio al demonio y lo reproduce. `cancel()` aborta la petición y corta el sonido. Aplica la velocidad elegida.
- **Si una frase falla, se dice con la voz del navegador** (o la silenciosa si no hay) y la cabecera lo indica; el recorrido no se para. Tras tres fallos seguidos deja de intentarlo hasta que cambie el proveedor.
- El selector de la cabecera, con un proveedor remoto, muestra su nombre y solo deja elegir la velocidad.
- `?voice=silent` sigue ganando a todo, para los tests.

### Pausas

- Un silencio después de cada frase antes de la siguiente, y uno más largo al cambiar de paso. Punto de partida: **600 ms entre frases, 1500 ms entre pasos**, divididos por la velocidad elegida. Con el proveedor silencioso se dividen por su `speed`, así los tests no se alargan.
- Valen para la narración y para las respuestas en paréntesis (entre frases; al acabar la respuesta no hace falta).
- Pausar durante el silencio funciona como pausar durante la frase que acaba de terminar: al reanudar se sigue con la siguiente, sin repetir. Un salto cancela el silencio.
- Viven en el motor del visor. **El reductor de `src/shared/playback.ts` no cambia.**
- Durante el silencio el resaltado se queda donde estaba.

### La guía del agente (`skill/GUIDE.md`)

- **Sección de narración:** una idea difícil va sola en su frase, precedida de una frase corta que la anuncia; no se encadenan dos conceptos nuevos seguidos; tras una idea densa, una frase que diga qué implica.
- **Primera vez:** después de `prwalk open`, ejecuta `prwalk voice`. Si dice que el usuario no ha elegido, el agente lo cuenta en su mensaje de "listo": el recorrido empieza con la voz del navegador, y puede quedarse con ella o usar otro proveedor. Según lo que responda: `prwalk voice use browser` deja la elección guardada; para otro proveedor, `prwalk voice guide` y escribir el adaptador con él. No se vuelve a preguntar. **No bloquea el recorrido.**
- Mantén la guía corta: el detalle de los adaptadores va en `skill/VOICES.md`.

### Ejemplos (`examples/voices/`, dentro del paquete)

- `macos-say.mjs`: usa el comando `say` de macOS para generar un wav. Local, sin dependencias; sirve de ejemplo de "envolver un ejecutable".
- `openai-compatible.mjs`: llama a un endpoint tipo `/v1/audio/speech`; la URL, el modelo y la voz vienen de `options`, y la clave de una variable de entorno cuyo nombre se da en `options`. Ejemplo de proveedor en la nube. Su cabecera advierte de que el texto de la narración sale de la máquina.

Ninguno se activa solo y ninguno añade dependencias.

### Documentación

- `AGENTS.md`: el requisito de voz pasa a ser "local por defecto; un proveedor en la nube solo si el usuario acopla su propio adaptador"; arquitectura y lista de comandos al día.
- `README.md`: una sección corta sobre las voces, que enlaza a la guía de adaptadores, y la nota de privacidad corregida.

## Tests

Un test por decisión, en la capa más baja que pueda observarla. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| Silencio entre frases y más largo entre pasos; pausar durante el silencio no repite; un salto lo cancela; escala con la velocidad | motor, con voz falsa y reloj falso | Uno por decisión |
| El motor prepara la frase siguiente | motor | Uno |
| Validar la forma de un adaptador y de lo que devuelve | función pura en `src/server` o `shared` | Uno con los casos de rechazo |
| Leer y escribir la configuración; sin clave `voice` es "sin elegir" | `src/server/state` | Uno |
| `/api/tts`: devuelve el audio; exige token; 409 sin adaptador; 502 si el adaptador falla; la caché evita la segunda síntesis; el límite de texto | servidor en proceso, con un adaptador de prueba que genera un wav mínimo | Uno por decisión |
| Ninguna petición HTTP cambia el adaptador | servidor en proceso | Uno |
| `voice`, `voice use`, `voice test`, `voice guide` conectan argumentos, disco y salida | CLI, binario compilado | Uno, como escenario |
| `RemoteVoice`: reproduce, cancela, y cae a la voz de reserva si falla | unidad en `web`, con `fetch` y audio falsos | Uno por decisión |
| Con un adaptador configurado el visor pide el audio y avanza; al fallar sigue con la voz de reserva | navegador, Playwright, con el adaptador de prueba | Uno |
| El ejemplo de la guía de adaptadores cumple el contrato | leyendo `skill/VOICES.md` | Uno |

## Qué no hay que hacer

- No instales ni empaquetes ningún modelo de voz, ni Kokoro: es la tarea 08.
- No añadas dependencias.
- No cambies el formato del guion ni el reductor.
- No añadas pausas configurables por guion ni por comando: valores fijos, de momento.
- No publiques nada ni toques la visibilidad del repositorio.
- No instales la skill en `~/.claude/skills` ni dejes nada enlazado globalmente. Usa un `PRWALK_HOME` temporal y otro puerto en tus pruebas; no dejes demonios vivos.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:pack` y `pnpm build` en verde.
2. Comprobación a mano con un `PRWALK_HOME` temporal: `prwalk voice` (sin elegir), `prwalk voice use examples/voices/macos-say.mjs --option voice=Mónica` (o la voz española que haya), `prwalk voice test "Hola, esto es una prueba." --lang es --out <fichero>` y comprobar que el fichero es un wav válido; abrir el ejemplo en el navegador y ver en la red que el audio se pide y se reproduce, y que las pausas se notan; `prwalk voice use browser` con el visor abierto y ver que cambia sin recargar.
3. En la PR: el contrato del adaptador tal como quedó, las directivas de CSP añadidas y cualquier desviación.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
