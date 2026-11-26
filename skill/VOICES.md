# Writing a voice adapter for prwalk

Before writing one, check `prwalk voice list`: prwalk can install a good local voice with one command (`prwalk voice install <name>`).

By default the viewer speaks with the browser's own voices. A voice adapter replaces them with any other speech engine: a local model, a command-line program, or a cloud service. You write it once, with the user, as one small JavaScript file.

The prwalk daemon (Node.js) loads the adapter, not the page. For each sentence the page asks the daemon for audio, the daemon calls the adapter, and the page plays what it returns.

Before you start:

- **It runs with the user's permissions.** Loading an adapter executes its code as the user. Only `prwalk voice use` chooses it, by writing its path to `config.json`; nothing the page or a script sends can change it. Write it with the user and keep it in a folder of theirs.
- **Privacy.** With a local engine nothing leaves the machine. With a cloud service, the narration and the answers (which describe the code) are sent to that service. Say so to the user before setting one up.

## The contract

A `.mjs` (or `.js` ES module) file whose default export has a `synthesize` function:

```js
// my-voice.mjs: speaks with espeak-ng, a local program (any engine that writes a wav works alike).
import { spawn } from 'node:child_process';

export default {
  // name: 'my-voice', // optional; shown in the viewer. Defaults to the file name.
  async synthesize({ text, lang, options }) {
    const child = spawn('espeak-ng', ['--stdin', '--stdout', '-v', options.voice ?? lang]);
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    const exited = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    });
    child.stdin.end(text);
    await exited;
    return { audio: Buffer.concat(chunks), mimeType: 'audio/wav' };
  },
};
```

`synthesize` receives:

- `text`: one sentence, at most 2000 characters.
- `lang`: its BCP-47 language, like `es` or `en-GB`: the language of the script.
- `options`: the strings saved with `prwalk voice use ... --option key=value`.

It returns `{ audio, mimeType }`: `audio` is a `Uint8Array` or a `Buffer`, `mimeType` is `audio/wav`, `audio/mpeg` or `audio/ogg`.

## Rules

- One sentence per call. Do not split or join sentences, and do not add pauses: the viewer leaves its own silences between sentences and steps.
- Do not change the speed: the viewer plays the audio at the speed the user picks, keeping the pitch.
- At most 20 MB of audio and 30 seconds per sentence. The daemon runs one synthesis at a time and remembers the last 200 sentences, so restarting a step does not synthesize again.
- On any failure, throw an `Error` with a short message. The viewer says that sentence with the browser voice and moves on; after three failures in a row it stops asking the adapter. The message goes to `~/.prwalk/daemon.log` and `prwalk status` shows it.
- Options are saved in plain text in `~/.prwalk/config.json`. Never put an API key in them: read it from an environment variable whose name is an option. The daemon sees the environment of the command that started it (the first `prwalk open`).
- Use only Node's built-in modules, or packages the user installs next to the adapter on purpose. prwalk adds nothing.

## Set it up and try it

```sh
prwalk voice use ./my-voice.mjs --option voice=es   # loads it, checks the contract, saves it
prwalk voice test "Hola, esto es una prueba." --lang es --out /tmp/prwalk-test.wav
```

`prwalk voice use` refuses an adapter that does not load or does not follow the contract, and changes nothing. `prwalk voice test` calls it once and says the type, the size and how long it took; play the file (`afplay` on macOS, `aplay` on Linux) and ask the user whether they like it. If the viewer is open, it switches to the new voice from the next sentence. After editing the adapter, run `prwalk voice use` again so the daemon loads the new version.

To go back to the browser's voices: `prwalk voice use browser`.

## Examples

Two complete adapters ship with prwalk, in `{{examples}}`:

- `macos-say.mjs`: wraps macOS's `say` command. Local, no dependencies. `--option voice=<name>` picks a voice (`say -v '?'` lists them).
- `openai-compatible.mjs`: calls an OpenAI-style `/v1/audio/speech` endpoint, with the URL, the model and the voice as options and the key in an environment variable. A cloud service: the text leaves the machine.

Copy one to the user's own folder and change it there.
