import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { loadAdapter } from './adapter.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('adapter examples', () => {
  it('the example in the adapter guide and the ones shipped follow the contract', async () => {
    const guide = readFileSync(join(root, 'skill', 'VOICES.md'), 'utf8');
    const example = /```js\n([\s\S]*?)```/.exec(guide)?.[1];
    expect(example).toBeDefined();
    const fromGuide = join(tempDir(), 'my-voice.mjs');
    writeFileSync(fromGuide, example ?? '');

    const examples = join(root, 'examples', 'voices');
    const paths = [fromGuide, ...readdirSync(examples).map((name) => join(examples, name))];
    const names = await Promise.all(paths.map(async (path) => (await loadAdapter(path)).name));
    expect(names).toEqual(['my-voice', 'macos-say', 'openai-compatible']);
  });
});
