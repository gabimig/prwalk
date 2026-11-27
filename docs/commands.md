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
| `prwalk skill`                        | Prints the full guide for agents, followed by your preferences, and a notice when a newer version is out.                                               |
| `prwalk skill install`                | Installs the skill stub (`--dir <folder>` for other agents).                                                                                            |
| `prwalk preferences`                  | Prints your preferences and the file they are in (`--path` for the path only, `--reset` to go back to the defaults).                                    |
| `prwalk update`                       | Updates PRWalk to the latest release with npm, stopping the daemon first (`--check` only says whether there is a newer one).                             |
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

- **File tree:** the changed files of the diff, by folder, on the left. The file being explained is marked; a summary card lights each folder as the agent names it. Click a folder to fold it, a file to see it (that pauses the walkthrough until you play again). The button before the title hides and shows it; it starts hidden in a page narrower than 720 px, and your choice is remembered. With the keyboard focus in it, the arrows move and fold, and Enter or Space opens.
- **Step strip:** every step of the walkthrough; click one to jump to it.
- **Controls:** restart the walkthrough, previous step, restart step, play and pause, next step.
- **Shortcuts:** Space plays and pauses, ← and → go to the previous and next step, R restarts the step.
- **History:** everything said so far, grouped by step, with the agent's answers.
- **Voice and speed:** chosen in the header, remembered per language.

Questions, "skip this" or "more detail" go to the agent, in its chat: the page has no text box and no microphone.

## Your preferences

How your agent gives you walkthroughs lives in `~/.prwalk/preferences.md` (in `PRWALK_HOME`): the default level of detail (the overview, unless you ask for more), how it opens, how it goes deeper when you ask, and the language. It is plain Markdown for your agent to read, created with the defaults the first time your agent runs `prwalk skill`.

Change it by editing the file, or tell your agent ("from now on start with the key files") and it edits it for you. What you ask in the conversation still wins over the file. Updating PRWalk or reinstalling the skill never touches it; `prwalk preferences --reset` puts the defaults back and keeps your version as `preferences.md.bak`.

## Privacy

- Everything runs on your machine. The daemon listens on `127.0.0.1` only, and refuses requests and pages from other origins.
- The code and the narration never leave it, other than what `gh` already does to fetch a PR, unless you plug in a voice adapter for a cloud service: then the narration and the answers go to that service.
- Of the browser's voices, only those that run on the machine are used: its cloud voices are discarded.
- The only request PRWalk makes on its own: at most once a day, `prwalk skill` and the daemon ask GitHub which version is the latest (`GET https://github.com/gabimig/prwalk/releases/latest`, without following the redirect). Nothing goes with it: no version, no system, no identifier, only a generic `User-Agent: prwalk`. The answer is kept in `update-check.json` in `PRWALK_HOME`, and `prwalk open` reads it from there. `PRWALK_UPDATE_CHECK=0` turns it off; `prwalk update`, which you or your agent run on purpose, still asks. The page never talks to GitHub.

## Configuration

| Variable              | Default     | What it sets                                                                                                       |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `PRWALK_PORT`         | `4517`      | Port of the daemon (`--port` on `prwalk open` too).                                                                |
| `PRWALK_HOME`         | `~/.prwalk` | Folder for the daemon's state file, its log, `config.json` (the voice), your preferences and the installed voices. |
| `PRWALK_IDLE_MINUTES` | `240`       | The daemon stops after this long with no viewer open and no command; `0` never.                                    |
| `PRWALK_UPDATE_CHECK` | `1`         | `0` turns off the daily check for a newer version (see Privacy).                                                   |

## Update and uninstall

When a newer version is out, your agent tells you, and the page shows it at the top right. To update, tell your agent "update PRWalk", or run `prwalk update` yourself: it stops the daemon (open walkthroughs close with it), installs the latest release with npm into the same global folder, and checks the version installed. It does not touch the skill, your preferences, the voice you chose or the installed voices. If npm fails, or PRWalk was not installed with `npm install -g`, it prints the command to run by hand, which is the install command again.

To uninstall:

```sh
prwalk stop
npm uninstall -g prwalk
rm -r ~/.claude/skills/prwalk   # or <folder>/prwalk if you used prwalk skill install --dir <folder>
rm -r ~/.prwalk                 # settings, your preferences, logs and installed voices
```

## Known limitations

- One walkthrough at a time: opening another replaces it.
- No review comments, neither local nor on GitHub.
- Local changes leave out files git does not track yet.
- The browser speaks only after a click in the page, hence the Start button.
- With the browser's voices, quality depends on the voices installed on the machine; with none, the page shows subtitles only. A voice adapter can do better.
- Tested on macOS and Linux. Windows is not tested.
