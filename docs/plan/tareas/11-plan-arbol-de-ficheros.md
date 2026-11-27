# 11 · Plan: árbol de ficheros a la izquierda y pasos que señalan carpetas

Lee antes `AGENTS.md`, `skill/GUIDE.md`, `src/shared/script.ts`, `src/shared/check-script.ts`, `src/shared/diff.ts`, `src/shared/protocol.ts`, `web/src/App.tsx`, `web/src/Player.tsx`, `web/src/FileView.tsx`, `web/src/playback/focus.ts`, `web/src/styles.css`, `test/e2e/` y `prototype/index.html`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/11-file-tree`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR. Este fichero de plan todavía no está en `main`: cópialo a `docs/plan/tareas/` de tu rama para que viaje en la PR, añade la fila 11 a `docs/plan/TASKS.md` y, de paso, marca la fila 10 como `[x]` (está mergeada y publicada como 0.1.1).

## Por qué

Gabriel ha oído un recorrido de alto nivel y le falta el mapa: sin ver el árbol de carpetas no se forma una imagen global de la PR. En GitHub el árbol de ficheros está siempre a la izquierda y sirve para dos cosas: moverse y entender de un vistazo qué zonas toca el cambio. Quiere eso en PRWalk:

1. Un árbol de los ficheros de la PR, a la izquierda, siempre visible.
2. Mientras el recorrido avanza, el fichero que se está explicando se ilumina en el árbol.
3. El agente puede **señalar una carpeta entera** (o varias, una tras otra) y decir "en esta zona va esto, en esta otra va esto otro". Es lo que más falta hace en el recorrido de alto nivel.

## Qué hay que entregar

### 1. El árbol en el visor

- Un panel a la izquierda del diff con los ficheros **cambiados** de la sesión, agrupados por carpeta. Las cadenas de carpetas con un solo hijo se comprimen en una fila (`src/auth/limits`), como en GitHub. Carpetas antes que ficheros, orden alfabético.
- Cada fichero enseña su estado (añadido, modificado, borrado, renombrado) y sus `+` y `−`, con los mismos colores que ya usa la página. Cada carpeta, el número de ficheros cambiados que contiene.
- Todo desplegado por defecto. Una carpeta se pliega y despliega con un clic; es solo estado de la página.
- **Clic en un fichero:** lo enseña en el panel del diff. Si el recorrido está sonando, lo pausa, igual que hace hoy la página cuando el usuario navega por su cuenta. Al reanudar o cambiar de paso, la página vuelve a lo que diga el paso. Mira cómo se comporta hoy la lista de ficheros de `App.tsx` y los controles de `Player.tsx` y sigue ese mismo criterio; el árbol sustituye a esa lista donde hoy se enseña.
- **Fichero actual:** el fichero del foco en curso (paso con `focus`, `prwalk focus`, o una respuesta de `prwalk say --file`) queda resaltado en el árbol, sus carpetas se despliegan si estaban plegadas y la fila se desplaza hasta verse.
- **Panel estrecho:** el visor suele verse en el panel de navegador de la app de Claude, que es estrecho. El árbol tiene un botón para ocultarlo y enseñarlo; empieza abierto si la página mide 720 px de ancho o más y cerrado si mide menos; lo que elija el usuario se recuerda en `localStorage` (con `try/catch`). El diff no puede quedar inservible con el árbol abierto: fija un ancho de árbol contenido (unos 220 a 260 px) y corta los nombres largos con puntos suspensivos y `title`.
- Tema claro y oscuro, y el lenguaje visual del prototipo. Accesible: `role="tree"`, `treeitem`, `aria-expanded`, `aria-current` en el fichero actual, y manejable con teclado sin robar los atajos del reproductor (Espacio, ←, →, R siguen siendo del reproductor salvo cuando el foco del teclado está dentro del árbol).
- Los textos nuevos van por `web/src/i18n.ts`, como el resto.

### 2. Señalar carpetas desde el guion

Sin tipo de paso nuevo: se amplían los pasos de tarjeta (`card`), que son los que ya se usan para el resumen.

- **`card.items[].path`** (opcional): una carpeta o un fichero del diff al que se refiere ese elemento.
- **`path` en una frase** de un paso de tarjeta (opcional): `{ "text": "...", "path": "src/auth" }`.
- Mientras suena un paso de tarjeta:
  - si la frase en curso tiene `path`, el árbol ilumina esa carpeta con todo lo que cuelga de ella (o ese fichero) y atenúa el resto, y en la tarjeta se resalta el elemento cuyo `path` coincide;
  - si no, el árbol ilumina todos los `path` de los elementos de la tarjeta, sin atenuar tanto el resto;
  - una tarjeta sin ningún `path` deja el árbol como está.
- Si el árbol está oculto cuando empieza un paso que señala rutas, se abre solo durante ese paso y vuelve a como estaba al salir. Es el único caso en que la página lo abre por su cuenta.
- Un `path` es una ruta relativa a la raíz del repositorio, con `/`, sin barra final. Es válido si es un fichero cambiado o una carpeta que contiene al menos un fichero cambiado; la comparación es por segmentos (`src/au` no casa con `src/auth`). En un fichero renombrado valen la ruta nueva y la antigua.
- `path` solo se admite en pasos de tarjeta. En pasos con `focus` se rechaza con un mensaje que diga dónde sí vale (el fichero de esos pasos ya se ilumina solo).
- Validación en dos sitios, como hoy: la forma en `src/shared/script.ts`; que la ruta exista en el diff en `src/shared/check-script.ts`, con un mensaje que nombre el paso, la ruta y dos o tres rutas parecidas que sí existen.
- `version` del guion sigue siendo `1`: el cambio solo añade campos opcionales.

El cálculo del árbol (a partir del índice del diff) y el de "qué nodos ilumina esta ruta" son funciones puras en `src/shared`, para que las usen el visor, la validación y los tests.

### 3. La guía (`skill/GUIDE.md`)

Cambios cortos, sin reescribirla:

- **Sección 4 (orden):** la tarjeta de resumen presenta el cambio **por zonas**: cuando la PR toca más de una carpeta, cada elemento es una zona (una carpeta, o un fichero suelto que importe) con su `path` y una línea sobre su papel, y la narración las recorre una a una con frases que llevan `path`, de modo que el oyente ve iluminarse cada zona mientras se nombra. Con uno o dos ficheros, basta con los ficheros.
- **Nivel `overview`:** este recorrido por zonas es su parte principal.
- **Sección 6 (guion):** el ejemplo y las reglas recogen `path` en elementos y frases de tarjeta.
- **Sección 8:** a una pregunta del tipo "¿qué hay en esta carpeta?" se responde con `prwalk say` enseñando el fichero más representativo de esa carpeta con `--file`.

### 4. Documentación y versión

- `README.md`: una viñeta en "Why you will like it" (ves el mapa: el árbol de ficheros a la izquierda, y el agente señala cada zona mientras la explica). Nada más.
- `docs/commands.md`: el árbol en los controles del visor.
- `AGENTS.md`: requisitos (el árbol y las rutas en tarjetas) y los ficheros nuevos en la arquitectura.
- `docs/plan/ESTADO.md`: una entrada fechada, en español, de las tareas 10 y 11.
- El guion de ejemplo de `test/fixtures` que usa el README pasa a usar `path` en su tarjeta de resumen.
- `version` a `0.2.0` en `package.json`. La etiqueta y la publicación las hace la sesión coordinadora.

## Tests

Un test por decisión, en la capa más baja. Sin matrices.

| Qué se decide | Capa | Test |
|---|---|---|
| Del índice del diff sale el árbol: carpetas agrupadas, cadenas de un solo hijo comprimidas, orden, recuentos | función pura | Uno |
| Qué nodos ilumina una ruta: fichero, carpeta con descendientes, carpeta dentro de una fila comprimida, comparación por segmentos | función pura | Uno, con esos casos como filas de una tabla |
| `path` solo en pasos de tarjeta; forma de la ruta | esquema | Uno |
| Una ruta que no está en el diff se rechaza nombrando paso y sugerencias; la ruta antigua de un renombrado vale | `check-script` | Dos |
| Qué rutas están iluminadas según la frase en curso de un paso de tarjeta (frase con `path`, sin `path`, tarjeta sin rutas) | función pura junto a `web/src/playback/focus.ts` | Uno |
| El árbol se pinta y el fichero del paso en curso queda marcado al cambiar de paso | navegador (`test/e2e`) | Uno |
| Una frase con `path` ilumina la carpeta y el elemento de la tarjeta | navegador | Uno |
| Clic en un fichero del árbol lo enseña y pausa | navegador | Uno |
| El botón oculta y enseña el árbol, y por debajo de 720 px empieza cerrado | navegador | Uno |

## Qué no hay que hacer

- No enseñes ficheros que no están en el diff: el árbol es el de la PR, no el del repositorio.
- No añadas comandos nuevos ni opciones a los que hay (`say --path` queda para más adelante si hace falta).
- No cambies el reductor de reproducción ni el protocolo más de lo imprescindible: el foco de un paso ya llega al visor con el guion.
- No añadas dependencias: el árbol es HTML y CSS propios, no un componente de terceros.
- No añadas caja de texto ni buscador al árbol.
- No crees etiquetas ni publiques versiones.
- No instales nada en esta máquina: `PRWALK_HOME` temporal y otro puerto siempre; no toques `~/.prwalk` (hay una instalación real del dueño con su demonio en el puerto 4517: no la pares ni la uses), `~/.claude/skills` ni `~/.local/bin`. No dejes demonios vivos.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:pack` y `pnpm build` en verde.
2. A mano, con `PRWALK_HOME` temporal y otro puerto: abre el ejemplo con `--patch`, reproduce el guion de ejemplo y mira en el navegador, a 1100 px y a 600 px de ancho, en claro y en oscuro, que el árbol se ve bien, que el fichero actual se ilumina al cambiar de paso y que la tarjeta de resumen va iluminando cada zona. Haz capturas para ti si te ayudan; no hacen falta en la PR.
3. En la PR y en tu mensaje final: cómo queda el JSON de una tarjeta con rutas, las decisiones que tomaste sobre el clic en un fichero y el panel estrecho, y las dudas.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
