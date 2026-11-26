# 09 · Plan: versión 0.1 instalable desde la URL

Lee antes `AGENTS.md`, `README.md`, `skill/SKILL.md`, `skill/GUIDE.md`, `package.json`, `scripts/check-pack.mjs` y `.github/workflows/ci.yml`. Este plan es todo el contexto que necesitas.

- **Rama:** `feat/09-public-release`, desde `main`.
- **PR:** en borrador contra `main`, en inglés.
- **Ejecución:** con el workflow `docs/plan/workflows/tarea.js`. La PR y la edición de `TASKS.md` las hace el agente de la PR.

## Objetivo

Gabriel va a abrir una conversación nueva con un agente que no sabe nada de prwalk y le dirá solo: **"Instala esto: https://github.com/gabimig/prwalk"**. Tiene que funcionar a la primera, sin más ayuda: el agente lee el README, ejecuta un comando, deja `prwalk` y la skill instalados, y a partir de ahí puede dar un recorrido. La primera vez, el agente le ofrece seguir con la voz del navegador, instalar la voz local recomendada (`kokoro`) o acoplar otro proveedor.

Esta tarea deja el repositorio preparado. **Crear la etiqueta, publicar la versión y hacer público el repositorio lo hace la sesión coordinadora después de mergear**; tú no.

## Qué hay que entregar

### 1. Licencia y metadatos

- `LICENSE`: MIT, año 2026, titular "Gabriel Miguez Miguez".
- `package.json`: `"license": "MIT"`, `repository`, `homepage`, `bugs`, `description`, `keywords`; quita `"private": true`. La versión sigue en `0.1.0`. `files` incluye también `LICENSE` y lo que ya haya (`dist`, `skill`, `examples`, el catálogo de voces).
- Sección de licencia en el README: MIT; las voces instalables tienen sus propias licencias, que enseña `prwalk voice list`.

### 2. Publicación por versiones de GitHub, sin npm

- `.github/workflows/release.yml`: al empujar una etiqueta `v*` (y con `workflow_dispatch` sobre una etiqueta existente), instala, pasa lint, tipos y tests, compila, empaqueta con `pnpm pack`, comprueba que la versión de `package.json` coincide con la etiqueta, y crea la versión de GitHub con dos ficheros: `prwalk-<versión>.tgz` y una copia llamada **`prwalk.tgz`**. Permisos mínimos (`contents: write` solo en ese job). Acciones de terceros fijadas por SHA, igual que en `ci.yml` si allí ya se hace; si no, usa solo acciones oficiales de `actions/*` y la CLI `gh` que trae el runner.
- El comando de instalación único, que usa la URL estable de la última versión:

  ```sh
  npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz
  ```

  El `.tgz` lleva `dist` ya compilado: quien instala no compila nada ni necesita pnpm.
- `pnpm test:pack` ya instala el `.tgz` en una carpeta temporal: amplíalo para que haga **lo mismo que hará el usuario** (`npm install -g` con un `--prefix` temporal, y después `prwalk --version`, `prwalk skill`, `prwalk skill install --dir <temporal>`, `prwalk voice list`, `prwalk validate` del ejemplo), y que falle si el paquete instalado arrastra dependencias de desarrollo.

### 3. README pensado para que lo siga un agente

Reescribe el principio del README. En inglés, corto, sin insignias ni capturas. Orden:

1. Qué es, en tres o cuatro frases.
2. **Install**: los pasos exactos, numerados, cada uno con su comando y con lo que debe salir, escritos de forma que un agente los ejecute tal cual:
   1. comprobar `node --version` (22 o más) y, para PRs de GitHub, `gh auth status`;
   2. el comando de `npm install -g` de arriba;
   3. `prwalk --version`; si el comando no se encuentra, la carpeta de binarios globales de npm (`npm prefix -g` más `/bin`) no está en el `PATH`, y con gestores de versiones como asdf hace falta `asdf reshim nodejs`;
   4. `prwalk skill install` (Claude Code) o `prwalk skill install --dir <carpeta>` para otro agente;
   5. qué decirle al usuario al acabar: que ya puede pedir "walk me through PR 482".
3. Una nota para el agente que acaba de instalarlo: **en la misma conversación la skill todavía no está cargada**, pero no hace falta: ejecuta `prwalk skill` y sigue la guía que imprime.
4. Actualizar y desinstalar: el mismo comando de instalación; `npm uninstall -g prwalk`, borrar la carpeta de la skill y `~/.prwalk`.
5. Lo demás que ya hay (uso, comandos, voces, privacidad, limitaciones), revisado para que no contradiga lo anterior. La instalación desde el código (clonar, `pnpm install`, `pnpm build`) pasa a una sección "Development". En limitaciones: Windows no está probado.

Comprueba cada comando del README ejecutándolo. No documentes nada que no hayas ejecutado.

### 4. La guía del agente, repaso final

- `skill/GUIDE.md`: comprueba que el flujo de la primera vez (voz sin elegir: navegador, `prwalk voice install kokoro` o `prwalk voice guide`) está claro y que cada comando que menciona existe. Corrige discrepancias; no reescribas las recomendaciones.
- `skill/SKILL.md`: si el comando no existe, que el agente diga cómo instalarlo (el comando de `npm install -g`), en vez de solo parar. Sigue siendo mínima.

### 5. Antes de hacerlo público

- Busca en el árbol **y en todo el historial de git** secretos, tokens, claves y datos personales o de terceros que no deban publicarse (correos distintos del de los commits, rutas con nombres de usuario, nombres de empresas o cuentas ajenas al proyecto). Arregla lo que esté en el árbol. **No reescribas el historial**: lista lo que encuentres en él, con commit y fichero, en la PR y en tu mensaje final, para que Gabriel decida.
- `docs/plan/` (en español) y `prototype/` se quedan en el repositorio pero fuera del paquete.
- `SECURITY.md` de cuatro líneas: es una herramienta local, cómo avisar de un problema (issue privado de GitHub, "Report a vulnerability").

### 6. `AGENTS.md`

Cómo se publica una versión (subir `version`, etiqueta `vX.Y.Z`, el workflow hace el resto) y el comando de instalación.

## Tests

| Qué se decide | Capa | Test |
|---|---|---|
| El paquete instalado globalmente desde el `.tgz` funciona fuera del repositorio y no trae dependencias de desarrollo | `pnpm test:pack`, en la CI | El script ampliado |
| La versión de `package.json` y la etiqueta coinciden | paso del workflow de publicación | Comprobación en el propio workflow |
| El README y la skill nombran el mismo comando de instalación | test que lee los dos ficheros | Uno |

Nada más: no hay lógica nueva.

## Qué no hay que hacer

- **No crees etiquetas, no publiques versiones, no cambies la visibilidad del repositorio y no publiques en npm.**
- No reescribas el historial de git.
- No cambies comandos, formato del guion ni contrato de voces.
- Dependencias nuevas: ninguna.
- No instales nada globalmente de verdad: `npm install -g` siempre con `--prefix` a una carpeta temporal. No toques `~/.claude/skills`, `~/.local/bin` ni `~/.prwalk`.

## Al terminar

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm test:pack` y `pnpm build` en verde.
2. A mano: `pnpm pack`, instalar el `.tgz` con `npm install -g --prefix <temporal>`, y desde otra carpeta, con ese `bin` en el `PATH` y un `PRWALK_HOME` temporal, seguir el README de principio a fin como lo haría un agente, incluido el inicio rápido con el ejemplo. No dejes demonios vivos.
3. En la PR y en tu mensaje final: el comando de instalación, lo que encontraste al buscar secretos y datos personales (árbol e historial), y las dudas.
4. Si alguna regla de este plan resulta ambigua, elige lo más simple, sigue y déjalo anotado como duda.
