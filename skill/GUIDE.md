# Giving a walkthrough with prwalk

You are about to present a pull request to a reviewer the way its author would on a call: a short orientation, then the code in the order that makes it understandable, then the tests. A web viewer shows the diff and speaks your narration; you drive it with the `prwalk` CLI. The user listens, can pause, and asks you questions in this chat.

The user does not see what you send to the viewer as text in the chat. Keep your chat messages short: the viewer is the presentation.

## 1. Open the session

- A GitHub PR: `prwalk open <number or URL>` (run it inside the repository when you give a number).
- Local changes without a PR: `prwalk open`, optionally `--base <branch>`.

The command prints the viewer URL. If you have a browser tool that shows pages to the user (for example a built-in browser pane), open the URL there. Otherwise always give the user the URL and ask them to open it, unless they have told you it is already open.

Then run `prwalk voice`. If it says the user has not chosen a voice yet, offer three choices in one or two lines of your "ready" message in step 7: keep the browser's voice; install the recommended local voice (`kokoro`: a download of about 385 MB, and nothing leaves the machine); or plug in another engine. Do not wait for the answer. Then, as they choose:

- Keep the browser's: `prwalk voice use browser`.
- The local voice: `prwalk voice install kokoro`. It takes a minute or two; run it in the background if you can and tell them when it is done (the viewer switches by itself). If it fails, it says which step and how to retry, and the voice does not change.
- Another engine: `prwalk voice guide`, and write the adapter with them.

Never ask again once they have chosen. `prwalk voice list` shows the installable voices with their licences.

## 2. Understand the change before writing anything

- `prwalk diff` lists the files with their status, size and line ranges.
- `prwalk diff --file <path>` prints one file with the old and new line numbers in front of each line. Take line ranges from here; never count lines by hand.
- Read the PR title and description if there is one (`gh pr view <pr>`), and read the surrounding code in the repository when you need it to explain why something is done.

Work out, for yourself: what problem this solves, which piece is the core of the change, what calls it, and what a reviewer most needs to look at.

## 3. Choose the level of detail

Take it from what the user asked; if they did not say, use key files.

| Level         | `level`     | What it contains                                                                | Typical size      |
| ------------- | ----------- | ------------------------------------------------------------------------------- | ----------------- |
| Overview only | `overview`  | The summary card, at most one or two decisive spots in the code, the tests card | 3 to 5 steps      |
| Key files     | `key-files` | Summary, the files and ranges that carry the change, tests, closing             | 6 to 12 steps     |
| Full          | `full`      | Every meaningful hunk; trivial ones grouped and mentioned in passing            | As many as needed |

Lock files, generated code and pure renames are named in the summary and not shown, at every level.

## 4. Order the steps for understanding

Not alphabetical, and not the order of the diff. A good default:

1. A summary card: what the PR does and the files involved, each with one line on its role.
2. The core of the change: the new type, function or module everything else depends on.
3. Where it is used: callers, wiring, routes.
4. Configuration, migrations and other supporting changes.
5. A tests card: what is covered, at a high level, and what is not.
6. A closing card inviting questions.

Split a large file into several steps, one idea each. One step shows one range of one file, and a range cannot cross from one hunk into the next: when what you want to show sits in two hunks, make two steps.

## 5. Write narration for the ear

- Write in the language the user is using with you, and set `lang` to it (`es`, `en`, ...).
- Two to five short sentences per step, one idea per sentence. Each entry of `say` is one sentence.
- A difficult idea goes alone in its sentence, after a short one that announces it ("Now the key part."). Never put two new concepts in a row: after a dense sentence, add one that says what it implies.
- Say why, not just what. The listener can see the code; tell them what to notice and what it implies.
- Do not read code aloud and do not mention line numbers. Naming an identifier is fine.
- Plain words only: no Markdown, no symbols, no file paths spelled out unless they matter.
- Be honest. Point out risks, shortcuts and missing tests as a careful author would. Do not sell the change.

## 6. The script

A JSON file:

```json
{
  "version": 1,
  "lang": "en",
  "level": "key-files",
  "steps": [
    {
      "id": "overview",
      "title": "Summary",
      "card": {
        "heading": "What this PR does",
        "lead": "Limits failed login attempts per email.",
        "items": [
          { "title": "src/auth/rateLimiter.ts", "text": "New class that counts failures." },
          { "title": "src/auth/loginController.ts", "text": "Checks the limit before verifying." }
        ]
      },
      "say": [
        "This PR adds a limit on failed logins.",
        "There are four files. We will take them in that order."
      ]
    },
    {
      "id": "limiter-failures",
      "title": "rateLimiter · counting",
      "note": "Where failures are counted",
      "focus": { "file": "src/auth/rateLimiter.ts", "lines": [12, 18] },
      "say": [
        "This is the core logic.",
        { "text": "Only the first failure sets the expiry.", "lines": [15, 17] },
        "So the window starts at the first failed attempt and is not extended by later ones."
      ]
    }
  ]
}
```

Rules:

- Each step has an `id` (lowercase letters, digits and hyphens, unique), a short `title` for the step strip, and `say`.
- Each step has exactly one of `focus` (code) or `card` (no code).
- `focus.lines` is `[first, last]`, inclusive, in the numbering of `prwalk diff --file`, and must lie inside one hunk. Line numbers are of the new version of the file; add `"side": "old"` to point at deleted lines.
- `note` is an optional short label shown next to the file name. Focus steps only.
- A sentence may be an object with its own `lines` to narrow the highlight while it is spoken. Keep it inside the step's own range. Focus steps only: sentences of a card step are plain strings.
- A card works best with three to seven `items`. An item's `title` is free text; a file path is common in the summary card but not required.
- Unknown keys are rejected.

## 7. Play it

1. Write the script to a temporary file.
2. `prwalk play <file>`. It checks the script against the diff and prints every problem with the step it is in. Fix them and run it again.
3. Tell the user, in one or two lines, that the walkthrough is ready, that they press Start in the viewer, and that they can pause with the space bar and ask you anything here. Then end your turn. Do not narrate the walkthrough in the chat.

## 8. While it plays

The user controls playback in the viewer: play and pause, previous and next step, restart step, and clicking any step. When they write to you:

1. Run `prwalk status`. It tells you the step and the exact sentence they were on, and what they did since you last looked. Use it to resolve "this", "that line" or "the previous one".
2. Decide which of three things they need.

**A question (the usual case).** Answer it as an aside. The script is not touched and the walkthrough waits where it was.

```sh
prwalk say "The counter expires by itself, fifteen minutes after the first failure." \
  --question "How long does the block last?" \
  --file src/config/auth.ts --lines 6-7
```

- `--question` is their question as you understood it; it is shown above your answer in the history.
- `--file` and `--lines` show any code in the diff while you answer. Leave them out if no code is needed.
- Write the answer for the ear, like the narration, in the user's language, and `--question` too. Keep it to two to four sentences; they can ask again.
- After the answer the viewer stays paused so they can follow up. Add `--resume` only if they asked you to carry on.
- The command returns at once and suggests `prwalk wait`. You do not need it: reply in the chat and end your turn.
- Also give the answer briefly in the chat, so it is there in writing.

**Navigation.** "Go back to the controller", "continue", "stop": `prwalk goto <step id or number>`, `prwalk resume`, `prwalk pause`.

**A change of plan.** "Skip the tests", "I already know this part", "show me the storage first", "more detail from here": rewrite the rest. Put the new steps, in the same format as `steps`, in a file and run `prwalk replace --from <step> <file>`. Steps before `--from` and the history are kept. Then `prwalk goto` the first new step if they are waiting for it.

If they want a different level of detail for the whole thing, write a new script and `prwalk play` it again.

If your environment lets you run a command in the background and be notified, `prwalk wait` returns when the user pauses, jumps, or the walkthrough ends, and prints the status. It is optional: never block the conversation on it.

## 9. Finish

When the user is done, run `prwalk stop`. It shuts the local daemon down; nothing was sent anywhere.
