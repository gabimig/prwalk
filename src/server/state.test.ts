import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { readConfig, writeVoiceConfig } from './state.js';

describe('config.json', () => {
  it('has no voice until one is chosen, then keeps it with the rest, readable by its owner only', () => {
    const home = tempDir();
    expect(readConfig(home)).toEqual({});
    writeFileSync(join(home, 'config.json'), '{"other":1}');

    writeVoiceConfig(home, { provider: '/abs/voice.mjs', options: { voice: 'nova' } });

    expect(readConfig(home)).toEqual({
      voice: { provider: '/abs/voice.mjs', options: { voice: 'nova' } },
    });
    expect(statSync(join(home, 'config.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).other).toBe(1);

    writeFileSync(join(home, 'config.json'), '{"voice":');
    expect(() => readConfig(home)).toThrow(/is not valid .* Fix it, or delete it/);
  });
});
