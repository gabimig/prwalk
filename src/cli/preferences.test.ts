import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { preferencesPath } from '../server/state.js';
import { guideWithPreferences, readPreferences, resetPreferences } from './skill-commands.js';

const skillFile = (name: string) =>
  readFileSync(new URL(`../../skill/${name}`, import.meta.url), 'utf8');
const defaults = skillFile('PREFERENCES.md');

describe('preferences', () => {
  it('creates the file with the defaults, readable by its owner only, when it is missing', () => {
    const home = join(tempDir(), 'home');
    const path = preferencesPath(home);
    expect(readPreferences(home)).toEqual({ path, text: defaults, created: true });
    expect(readFileSync(path, 'utf8')).toBe(defaults);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('returns an existing file as it is, without touching it', () => {
    const home = tempDir();
    const path = preferencesPath(home);
    writeFileSync(path, 'Always start with the key files.\n');
    expect(readPreferences(home)).toEqual({
      path,
      text: 'Always start with the key files.\n',
      created: false,
    });
    expect(readFileSync(path, 'utf8')).toBe('Always start with the key files.\n');
  });

  it('resets the file to the defaults, keeping the previous one, if any, as a backup', () => {
    const home = tempDir();
    const path = preferencesPath(home);
    expect(resetPreferences(home)).toEqual({ path });
    writeFileSync(path, 'mine\n');
    chmodSync(path, 0o644);
    expect(resetPreferences(home)).toEqual({ path, backup: `${path}.bak` });
    expect(readFileSync(path, 'utf8')).toBe(defaults);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe('mine\n');

    rmSync(`${path}.bak`);
    mkdirSync(`${path}.bak`);
    writeFileSync(path, 'mine\n');
    expect(() => resetPreferences(home)).toThrow(/EISDIR/);
    expect(readFileSync(path, 'utf8')).toBe('mine\n');
  });

  it('gives the guide with the default preferences and a warning when it cannot create the file', () => {
    const file = join(tempDir(), 'not-a-folder');
    writeFileSync(file, '');
    const { text, warning } = guideWithPreferences(join(file, 'home'));
    expect(text.startsWith(skillFile('GUIDE.md'))).toBe(true);
    expect(text.endsWith(defaults)).toBe(true);
    expect(warning).toMatch(/^Cannot read or create .*preferences\.md: .*ENOTDIR/);
  });
});
