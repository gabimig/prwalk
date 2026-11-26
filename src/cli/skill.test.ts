import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';

// These tests run the compiled binary; test/global-setup.ts builds it first.
const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const skillFile = (name: string) =>
  readFileSync(new URL(`../../skill/${name}`, import.meta.url), 'utf8');
const readme = () => readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const installCommand =
  'npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz';

function prwalk(...args: string[]) {
  const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe('prwalk skill', { timeout: 30_000 }, () => {
  it('prints the guide, and installs the skill stub, replacing an older copy', () => {
    expect(prwalk('skill')).toEqual({ code: 0, stdout: skillFile('GUIDE.md'), stderr: '' });

    const dir = join(tempDir(), 'skills');
    const installed = join(dir, 'prwalk', 'SKILL.md');
    expect(prwalk('skill', 'install', '--dir', dir)).toEqual({
      code: 0,
      stdout: `Installed the prwalk skill at ${installed}\n`,
      stderr: '',
    });
    writeFileSync(installed, 'an older version');
    expect(prwalk('skill', 'install', '--dir', dir).code).toBe(0);
    expect(readFileSync(installed, 'utf8')).toBe(skillFile('SKILL.md'));
  });

  it('says why it cannot install the skill in a folder it cannot write', () => {
    const file = join(tempDir(), 'not-a-folder');
    writeFileSync(file, '');
    const run = prwalk('skill', 'install', '--dir', file);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(
      new RegExp(
        `^Cannot install the skill in ${file}: .*ENOTDIR.*\\. Choose another folder with --dir\\.\n$`,
      ),
    );
  });

  it('tells a user without prwalk the same install command as the README', () => {
    expect(readme()).toContain(installCommand);
    expect(skillFile('SKILL.md')).toContain(installCommand);
  });
});
