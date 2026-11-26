# prwalk

prwalk lets a coding agent give you a spoken, guided walkthrough of a pull request, the way its author would on a call before the review. You open a web page with the diff; the agent prepares a script and drives the page from a CLI, which highlights the code while a voice explains it. You can pause, jump between steps and ask the agent questions in its own chat. It is for anyone who reviews code with an agent at hand (Claude Code or any other that can run commands), on GitHub PRs or on local changes.

## Install

These steps are written so that a coding agent can follow them as they are. Run each command and check that it prints what is described.

1. Check the requirements. `node --version` must print `v22` or later, and git must be installed. To walk through GitHub PRs, `gh auth status` must say you are logged in to github.com ([GitHub CLI](https://cli.github.com/)); local changes and patch files do not need it.

   ```sh
   node --version
   gh auth status
   ```

2. Install prwalk from the latest release. It is a built package: nothing is compiled, and pnpm is not needed. npm ends with `added N packages`.

   ```sh
   npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz
   ```

3. Check that it is on the `PATH`. It prints the version, such as `0.1.0`.

   ```sh
   prwalk --version
   ```

   If the command is not found, npm's folder of global binaries is not on the `PATH`: add the folder that `echo "$(npm prefix -g)/bin"` prints. With a Node version manager such as asdf, run `asdf reshim nodejs` first.

4. Install the skill, which tells the agent when and how to use prwalk. It prints `Installed the prwalk skill at <path>`.

   ```sh
   prwalk skill install                  # Claude Code: ~/.claude/skills/prwalk/SKILL.md
   prwalk skill install --dir <folder>   # another agent that loads skills from a folder
   ```

   Agents without skills can be told to run `prwalk skill` and follow the guide it prints.

5. Tell the user it is ready: from now on they can ask for a walkthrough, such as "walk me through PR 482" or "explain my local changes out loud, overview only".

**For the agent that has just installed it:** in this same conversation the skill is not loaded yet, and it does not need to be. When the user asks for a walkthrough, run `prwalk skill` and follow the guide it prints. The first time, the guide has you offer the user a choice of voice: the browser's, the recommended local voice, or another engine.

### Update and uninstall

To update, run the install command again. To uninstall:

```sh
prwalk stop
npm uninstall -g prwalk
rm -r ~/.claude/skills/prwalk   # or <folder>/prwalk if you used prwalk skill install --dir <folder>
rm -r ~/.prwalk                 # settings, logs and installed voices
```

## Quick start

The package includes an example diff and a script for it (in Spanish), so you can try the viewer without an agent or a real PR:

```sh
cd "$(npm root -g)/prwalk"
prwalk open --patch test/fixtures/example.diff --title "Add login rate limit"
# open the Viewer URL it prints in your browser
prwalk play test/fixtures/example-script.json
# press Start in the page, then try the controls below
prwalk status                     # where the playback is and what you did
prwalk say "El contador caduca a los quince minutos." --file src/config/auth.ts --lines 6-7
prwalk stop
```

Answers are said in the script's language, hence the Spanish one.

## Commands

Every command prints short plain text; add `--json` for the same as JSON. `prwalk <command> --help` has the details.

| Command                               | What it does                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prwalk open [pr]`                    | Opens a session on a GitHub PR (number or URL), on local changes (`--base <branch>`), or on a patch file (`--patch <file>`), and prints the viewer URL. |
| `prwalk diff [--file <path>]`         | Lists the files and hunks, or prints one file with old and new line numbers.                                                                            |
| `prwalk validate <file>`              | Checks a script without loading it.                                                                                                                     |
| `prwalk play <file>`                  | Checks a script against the diff and loads it into the viewer; `--clear` unloads it.                                                                    |
| `prwalk status`                       | Says where the playback is, the sentence being said, and what happened since the last look.                                                             |
| `prwalk wait`                         | Waits until the user does something in the viewer, then prints the status.                                                                              |
| `prwalk pause` / `prwalk resume`      | Pauses or resumes the walkthrough.                                                                                                                      |
| `prwalk goto <step>`                  | Jumps to a step, by id or number.                                                                                                                       |
| `prwalk say <text>`                   | Answers a question out loud, aside from the script, optionally showing code (`--file`, `--lines`).                                                      |
| `prwalk replace --from <step> <file>` | Replaces the steps from one on with new ones.                                                                                                           |
| `prwalk focus <file> --lines <a-b>`   | Shows a range of the diff when no script is loaded.                                                                                                     |
| `prwalk voice`                        | Says which voice the viewer uses and whether you have chosen one.                                                                                       |
| `prwalk voice use <browser \| file>`  | Chooses the browser's voices or a voice adapter (`--option key=value` for its options).                                                                 |
| `prwalk voice list`                   | Lists the local voices prwalk can install, with their size and licences, and which are installed.                                                       |
| `prwalk voice install <name>`         | Installs a local voice from that list and chooses it (`--option key=value` for its options).                                                            |
| `prwalk voice remove <name>`          | Deletes an installed voice; if it was in use, goes back to the browser's voices.                                                                        |
| `prwalk voice test [text]`            | Synthesizes a sentence with the chosen adapter (`--lang`, `--out <file>` to save it).                                                                   |
| `prwalk voice guide`                  | Prints the guide to writing a voice adapter.                                                                                                            |
| `prwalk skill`                        | Prints the full guide for agents.                                                                                                                       |
| `prwalk skill install`                | Installs the skill stub (`--dir <folder>` for other agents).                                                                                            |
| `prwalk stop`                         | Stops the local daemon.                                                                                                                                 |

## The viewer

- **Step strip:** every step of the walkthrough; click one to jump to it.
- **Controls:** restart the walkthrough, previous step, restart step, play and pause, next step.
- **Shortcuts:** Space plays and pauses, ← and → go to the previous and next step, R restarts the step.
- **History:** everything said so far, grouped by step, with the agent's answers.
- **Voice and speed:** chosen in the header, remembered per language.

Questions, "skip this" or "more detail" go to the agent, in its chat: the page has no text box and no microphone.

## Voices

The page speaks with the browser's voices that run on your machine, leaving a short silence after each sentence and a longer one between steps. Use a browser with speech voices installed on the machine (Chrome, Edge or Safari); without one the page shows the narration as subtitles only. On macOS, the "Enhanced" and "Premium" voices from System Settings › Accessibility › Spoken Content sound much better.

### The recommended local voice

prwalk can install a better voice that runs on your machine, in Spanish and English:

```sh
prwalk voice list             # the voices it can install, their size and licences
prwalk voice install kokoro   # installs it and chooses it
prwalk voice remove kokoro    # deletes it and goes back to the browser's voices
```

`kokoro` is the [Kokoro-82M v1.0](https://huggingface.co/hexgrad/Kokoro-82M) model on the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) engine. `prwalk voice install kokoro` creates `~/.prwalk/voices/kokoro/`, installs the engine there with `npm install` (`sherpa-onnx-node`, about 35 MB), downloads the model from the sherpa-onnx releases on GitHub (about 350 MB), says a test sentence and chooses the voice. It is not one of prwalk's dependencies: installing prwalk does not bring it. It picks a Spanish voice (`ef_dora`) or an English one (`af_heart`) by the language of each sentence; `--option voice=em_alex` fixes another Kokoro voice. On a laptop without a GPU it says a sentence in a fraction of the time it takes to hear it. If a step fails, it says which and how to retry, and the voice in use does not change; running it again repairs or updates the install.

Licences: the model and its voices, Apache-2.0; `sherpa-onnx-node`, Apache-2.0, with onnxruntime (MIT) inside; espeak-ng, which turns the text into phonemes and is built into the engine with its data in the model folder, GPL-3.0-or-later. That is why it is installed apart, only when you ask, and is not part of prwalk.

### Your own voice adapter

To use another engine (a local model, a command-line program or a cloud service), plug in a **voice adapter**: one small JavaScript file the daemon loads, usually written with your agent's help.

```sh
prwalk voice guide                                     # how to write one, with two examples
prwalk voice use ./my-voice.mjs --option voice=nova    # check it and choose it
prwalk voice test "Hola, esto es una prueba." --lang es --out /tmp/test.wav
prwalk voice use browser                               # back to the browser's voices
```

The choice is saved in `~/.prwalk/config.json`; an open viewer switches from the next sentence. Loading an adapter runs its code with your permissions. The guide is [skill/VOICES.md](skill/VOICES.md), and the examples are in [examples/voices](examples/voices).

## Privacy

- Everything runs on your machine. The daemon listens on `127.0.0.1` only, and refuses requests and pages from other origins.
- The code and the narration never leave it, other than what `gh` already does to fetch a PR, unless you plug in a voice adapter for a cloud service: then the narration and the answers go to that service.
- Of the browser's voices, only those that run on the machine are used: its cloud voices are discarded.

## Configuration

| Variable              | Default     | What it sets                                                                                     |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `PRWALK_PORT`         | `4517`      | Port of the daemon (`--port` on `prwalk open` too).                                              |
| `PRWALK_HOME`         | `~/.prwalk` | Folder for the daemon's state file, its log, `config.json` (the voice) and the installed voices. |
| `PRWALK_IDLE_MINUTES` | `240`       | The daemon stops after this long with no viewer open and no command; `0` never.                  |

## Known limitations

- One walkthrough at a time: opening another replaces it.
- No review comments, neither local nor on GitHub.
- Local changes leave out files git does not track yet.
- The browser speaks only after a click in the page, hence the Start button.
- With the browser's voices, quality depends on the voices installed on the machine; with none, the page shows subtitles only. A voice adapter can do better.
- Tested on macOS and Linux. Windows is not tested.

## Development

To work on prwalk itself, build it from the repository with [pnpm](https://pnpm.io/) and git:

```sh
git clone https://github.com/gabimig/prwalk.git
cd prwalk
pnpm install
pnpm build
pnpm link --global   # puts this build of prwalk on your PATH; run `pnpm setup` first if pnpm asks for it
prwalk --version
```

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (in a browser, with Playwright) and `pnpm test:pack` (installs the packed prwalk in a temporary folder and runs it) are the checks. How a release is published is in [AGENTS.md](AGENTS.md).

## Licence

Copyright (C) 2026 Gabriel Miguez Miguez. prwalk is free software under the GNU General Public License, version 3 or (at your option) any later version; the full text is in [LICENSE](LICENSE). It comes with no warranty. The local voices that `prwalk voice install` installs are not part of prwalk and have their own licences, which `prwalk voice list` shows.
