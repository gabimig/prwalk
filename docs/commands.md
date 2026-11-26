# PRWalk commands and settings

[Back to the README](../README.md)

You rarely type these yourself: your agent does. They are here for reference and for trying PRWalk by hand.

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
| `prwalk voice list`                   | Lists the local voices PRWalk can install, with their size and licences, and which are installed.                                                       |
| `prwalk voice install <name>`         | Installs a local voice from that list and chooses it (`--option key=value` for its options).                                                            |
| `prwalk voice remove <name>`          | Deletes an installed voice; if it was in use, goes back to the browser's voices.                                                                        |
| `prwalk voice test [text]`            | Synthesizes a sentence with the chosen adapter (`--lang`, `--out <file>` to save it).                                                                   |
| `prwalk voice guide`                  | Prints the guide to writing a voice adapter.                                                                                                            |
| `prwalk skill`                        | Prints the full guide for agents.                                                                                                                       |
| `prwalk skill install`                | Installs the skill stub (`--dir <folder>` for other agents).                                                                                            |
| `prwalk stop`                         | Stops the local daemon.                                                                                                                                 |

## Try it without an agent

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

## The viewer

- **Step strip:** every step of the walkthrough; click one to jump to it.
- **Controls:** restart the walkthrough, previous step, restart step, play and pause, next step.
- **Shortcuts:** Space plays and pauses, ← and → go to the previous and next step, R restarts the step.
- **History:** everything said so far, grouped by step, with the agent's answers.
- **Voice and speed:** chosen in the header, remembered per language.

Questions, "skip this" or "more detail" go to the agent, in its chat: the page has no text box and no microphone.

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

## Update and uninstall

To update, run the install command again. To uninstall:

```sh
prwalk stop
npm uninstall -g prwalk
rm -r ~/.claude/skills/prwalk   # or <folder>/prwalk if you used prwalk skill install --dir <folder>
rm -r ~/.prwalk                 # settings, logs and installed voices
```

## Known limitations

- One walkthrough at a time: opening another replaces it.
- No review comments, neither local nor on GitHub.
- Local changes leave out files git does not track yet.
- The browser speaks only after a click in the page, hence the Start button.
- With the browser's voices, quality depends on the voices installed on the machine; with none, the page shows subtitles only. A voice adapter can do better.
- Tested on macOS and Linux. Windows is not tested.
