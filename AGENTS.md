# PRWalk

A local tool that lets any coding agent give a human a **spoken, guided walkthrough of a pull request**, the way a PR author would on a call before the review.

The human sees a web page with the diff; the agent drives it through a CLI (`prwalk`): it loads a script of steps, the page highlights code and speaks the narration, and the human can pause, jump between steps, or ask the agent questions in the agent's own chat.

Planning docs (in Spanish) live in `docs/plan/`: start with `docs/plan/ESTADO.md`, then `docs/plan/TASKS.md`. The agreed look and behaviour of the viewer is the static prototype in `prototype/index.html` (serve it with `python3 -m http.server 4173 --directory prototype`).

## Requirements (agreed with the user)

- **Diff source:** a GitHub PR by number or URL (through `gh`, private repos included) or local git changes (branch vs base) without a PR.
- **Walkthrough shape:** high-level summary, presented by zones of the repository, then files in a logical order with the explained range highlighted, then the tests at a high level. Three levels of detail: overview only, key files, full. The agent picks the level from what the user asks.
- **Scripted but live:** the agent prepares the whole script up front and the page plays it with no gaps. The agent can still answer questions, jump, or rewrite the remaining steps at any time.
- **Controls in the page:** play/pause, previous step, next step, restart step, restart walkthrough, clickable step strip. Shortcuts: Space, ←, →, R. Everything else (questions, "skip this", "more detail") goes through the agent's chat. No text box and no microphone in the page.
- **History panel:** everything said so far, grouped by step, scrollable; it grows while paused.
- **File tree:** the changed files, by folder, always on the left of the diff (a button hides it; hidden by default below 720 px). The file being explained is marked. Card steps may point at folders or files (`path` on an item or a sentence) and the tree lights them while they are named.
- **Voice:** spoken by the page, not by the agent, with a silence after each sentence and a longer one between steps. Local by default: the browser's Web Speech API. Any other engine plugs in as a voice adapter (an ES module the daemon loads from the path in `config.json`); a cloud voice only if the user plugs in their own adapter for one. The narration language is the language the user speaks to the agent.
- **Agent-agnostic:** a small skill plus the CLI. No MCP server. The skill stub must stay tiny; the full guide is printed by the CLI.
- **Privacy:** code and narration never leave the machine (other than what `gh` already does, and what a cloud voice adapter the user chose sends). The only request prwalk makes on its own is, at most once a day, which version is the latest release on GitHub, with nothing about the user; `PRWALK_UPDATE_CHECK=0` turns it off.
- **Updates:** when a newer release is out, `prwalk skill` ends with a notice for the agent, `prwalk open` adds a line and the page shows a tag in the header. Only the user, through the agent, updates: `prwalk update`. The page never runs anything.
- **Out of scope for v1:** leaving review comments (local or on GitHub), more than one walkthrough session at a time.

## Architecture

One npm package, ESM, TypeScript strict, Node >= 22, pnpm.

```
src/shared/   Pure TypeScript, no Node or browser APIs; imported by everything else.
  script.ts        Script schema and validation (zod).
  diff.ts          Diff index (files, hunks, line ranges) and focus checks, on @pierre/diffs.
  check-script.ts  A script checked against the diff (ranges and card paths).
  tree.ts          The changed files as a folder tree, and the rows a path in a script lights.
  playback.ts      The playback reducer: what start, pause, next, goto... do.
  events.ts        Events derived from position reports (paused, jumped, finished...).
  protocol.ts      Daemon <-> viewer messages and the bodies of the HTTP API.
  replace.ts       Replacing the steps of a loaded script from one on.
  session.ts       Session metadata (GitHub PR, local changes or patch file).
src/server/   The local daemon.
  server.ts        HTTP API, viewer WebSocket and the built viewer (with a CSP). Owns the
                   session, the script, the last reported position, the event log and the
                   voice adapter (POST /api/tts); shuts down after a long idle time.
  adapter.ts       Voice adapters: loading and checking one, and running its syntheses (one at
                   a time, with a timeout and a cache).
  daemon.ts        The daemon process: token, state file, config, PRWALK_IDLE_MINUTES.
  state.ts         ~/.prwalk (PRWALK_HOME): daemon.json, daemon.log, config.json and
                   preferences.md.
  updates.ts       Whether a newer prwalk has been released: GitHub's redirect to the latest
                   release, asked at most once a day and kept in update-check.json.
src/cli/      The `prwalk` binary. Thin: parses arguments, starts the daemon if needed, talks
              to it over HTTP, prints results.
  index.ts         Commands and options (commander).
  session-commands.ts  open, diff, play, focus, status, stop.
  live-commands.ts     pause, resume, goto, say, replace, wait.
  skill-commands.ts    skill, skill install, preferences: the guide followed by the user's
                       preferences (<PRWALK_HOME>/preferences.md, created from the defaults)
                       and the notice of a newer version.
  update-command.ts    update: installs the latest release with npm into the same global prefix.
  voice-commands.ts    voice, voice list, voice install, voice remove, voice use, voice test,
                       voice guide.
  voice-catalog.ts     The catalog of installable voices; installing and removing one in
                       <PRWALK_HOME>/voices/<name>/.
  voice-download.ts    What an install runs outside the process: npm, and fetch plus tar for the
                       model.
  validate.ts      validate, and reading a script file or stdin.
  daemon-client.ts Finding or starting the daemon and calling its API.
  sources/         Where a diff comes from: github (gh), local (git), patch (a file).
web/          Viewer (Vite + React), built into dist/web and served by the daemon.
  connection.ts    WebSocket and API calls to the daemon.
  App.tsx, Player.tsx, FileView.tsx, FileTree.tsx, VoicePicker.tsx   The page; FileView
                   renders with @pierre/diffs, FileTree is the file tree on the left.
  playback/        PlaybackEngine (runs the shared reducer with a voice, and the pauses), the
                   queue of answers said aside, the history, the focus of each sentence and the
                   paths a card lights.
  voice/           Voice providers: the VoiceProvider interface, Web Speech (local voices
                   only, with the voice and speed choice), the remote voice (audio from the
                   daemon's adapter), the silent fallback.
skill/        SKILL.md stub, the full agent guide (GUIDE.md) printed by `prwalk skill`, the default
              preferences (PREFERENCES.md), and the guide to writing a voice adapter (VOICES.md)
              printed by `prwalk voice guide`.
examples/voices/  Example voice adapters, shipped in the package: macOS `say`, OpenAI-style.
voices/       The catalog of local voices `prwalk voice install` installs, shipped in the package:
              one folder each with voice.json (engine at exact versions, model URL, size,
              licences) and adapter.mjs. Engines and models are never prwalk dependencies.
scripts/      check-pack.mjs: packs and installs prwalk in a temporary folder (pnpm test:pack).
test/         Fixtures shared by the test suites, and the Playwright browser tests (test/e2e).
```

Who owns what:

- **The daemon owns the script and the diff.** The CLI never talks to the browser directly.
- **The browser owns the playback clock**, because only it knows when a sentence finished speaking. It reports its position (step, sentence, playing or paused) to the daemon over the WebSocket, and the daemon answers `prwalk status` from the last report.
- **Playback rules live in `src/shared`** as a pure reducer, so the browser and the tests share one definition of what "next", "pause" or "sentence ended" do.
- **Voice is a provider interface in `web/`** (`speak(text, lang)`, `cancel()`, end callback, optional `prepare`). There is always a silent, timer-based provider: it is the fallback when speech is unavailable and what the tests use (`?voice=silent` wins over any other voice).
- **The package owns the guide and the default preferences; the user owns `preferences.md`.** `prwalk skill` prints the guide and then `<PRWALK_HOME>/preferences.md`, creating it from `skill/PREFERENCES.md` when it is missing. Nothing overwrites an existing one but `prwalk preferences --reset` (which keeps a `.bak`). It is plain text for the agent, not a schema; only the CLI reads it, never the daemon.
- **A voice adapter runs in the daemon, chosen only by `config.json`.** The CLI writes it (`prwalk voice use`) and tells the daemon to read it again; no request, viewer message or script can name one. The viewer gets the adapter's name and a token good only for `POST /api/tts`, and falls back to its own voice for any sentence that fails.

## Commands

`prwalk open [pr | --base <ref> | --patch <file>]`, `diff [--file <path>]`, `validate <file>`, `play <file> | --clear`, `focus <file> --lines <a-b> | --clear`, `status`, `wait`, `pause`, `resume`, `goto <step>`, `say <text> [--question] [--file --lines] [--resume]`, `replace --from <step> <file>`, `voice`, `voice list`, `voice install <name> [--option k=v]`, `voice remove <name>`, `voice use <browser | adapter> [--option k=v]`, `voice test [text] [--lang] [--out]`, `voice guide`, `skill`, `skill install [--dir]`, `preferences [--path | --reset]`, `update [--check]`, `stop`, and the internal `daemon`. Every command but `skill`, `voice guide` and `daemon` takes `--json`; `prwalk <command> --help` has the details. `docs/commands.md` has a one-line description of each.

## Releases

prwalk is not published to npm. Users install the packed package from the latest GitHub release:

```sh
npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz
```

To publish a version: raise `version` in `package.json` in a PR, and once it is on `main`, push a tag `vX.Y.Z` with that same version. `.github/workflows/release.yml` checks that the tag matches `package.json`, runs lint, types, tests and `test:pack`, builds, packs, and creates the GitHub release with `prwalk-X.Y.Z.tgz` and a copy named `prwalk.tgz`. To redo the release of an existing tag, run the workflow by hand with that tag. The README and `skill/SKILL.md` name the install command above; a test keeps them in step. The package holds `dist`, `skill`, `examples`, `voices`, the example diff and script from `test/fixtures` (for the README's quick start) and `LICENSE`; `docs/` and `prototype/` stay out of it.

## Conventions

- **Name:** the product is PRWalk in prose; the command, the package and the skill are `prwalk`.
- **README:** it sells the project and gets it installed, nothing else. Reference material goes in `docs/` (`commands.md`, `voices.md`, `development.md`), linked from it.
- **Language:** code, comments, commit messages, PRs and README in English. Planning docs in `docs/plan/` in Spanish.
- **Licences:** dependencies must be MIT, Apache-2.0, BSD or ISC. Nothing GPL/AGPL/LGPL. Say which licence a new dependency has in the PR description.
- **Dependencies:** prefer few. Agreed so far: `zod` (schema), `commander` (CLI), `ws` (WebSocket), `@pierre/diffs` (diff rendering), `vitest`, `@biomejs/biome`, Playwright for browser tests.
- **CLI output:** short plain text by default, written for an agent to read cheaply; `--json` for a machine-readable version of the same thing. Errors go to stderr with a non-zero exit code and say how to fix the input.
- **Tests:** one test per decision, at the lowest layer that can observe it. Upper layers (CLI, browser) get one test per wiring, not the matrix of the layer below again. No N x M matrices.
- **No demo videos:** a change to the viewer does not need a demo video or screenshots for the owner. Write browser tests, take screenshots or record video only when you need them yourself to build or verify the change.
- **Branches and PRs:** one task, one branch (`feat/NN-slug`), one draft PR against `main`. Never merge your own PR and never push to `main`.
- **Checks before opening a PR:** `pnpm lint`, `pnpm typecheck`, `pnpm test` all green.
