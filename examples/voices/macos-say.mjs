// A prwalk voice adapter that wraps macOS's `say` command: local, no dependencies.
//
//   prwalk voice use examples/voices/macos-say.mjs --option voice=Mónica
//
// Options: `voice`, the name of a voice installed on the Mac (`say -v '?'` lists them; pick one
// that speaks the narration's language). Without it, `say` uses the system voice.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export default {
  name: 'macos-say',
  async synthesize({ text, options }) {
    const dir = await mkdtemp(join(tmpdir(), 'prwalk-say-'));
    try {
      // The text goes in a file, so a sentence that starts with "-" is not read as an option.
      const input = join(dir, 'sentence.txt');
      const output = join(dir, 'sentence.wav');
      await writeFile(input, text);
      const voice = options.voice ? ['-v', options.voice] : [];
      await run('say', [
        ...voice,
        '-f',
        input,
        '-o',
        output,
        '--file-format=WAVE',
        '--data-format=LEI16@22050',
      ]);
      return { audio: await readFile(output), mimeType: 'audio/wav' };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
