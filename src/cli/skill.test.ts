import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';

// These tests run the compiled binary; test/global-setup.ts builds it first.
const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const skillFile = (name: string) =>
  readFileSync(new URL(`../../skill/${name}`, import.meta.url), 'utf8');
const readme = () => readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const installCommand =
  'npm install -g https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz';

/** Runs prwalk with its own PRWALK_HOME, never the user's, and `env` on top. */
function run(env: NodeJS.ProcessEnv, args: string[]) {
  const run = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PRWALK_HOME: home, ...env },
  });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}
const prwalk = Object.assign((...args: string[]) => run({}, args), {
  with: (env: NodeJS.ProcessEnv, ...args: string[]) => run(env, args),
});

let home: string;
beforeEach(() => {
  home = tempDir();
});

describe('prwalk skill', { timeout: 30_000 }, () => {
  it('prints the guide followed by the user preferences, and installs the skill stub, replacing an older copy', () => {
    const preferences = join(home, 'preferences.md');
    const printed = prwalk('skill');
    expect(printed.code).toBe(0);
    expect(printed.stderr).toBe('');
    expect(printed.stdout.startsWith(skillFile('GUIDE.md'))).toBe(true);
    expect(printed.stdout).toContain(preferences);
    expect(printed.stdout.endsWith(skillFile('PREFERENCES.md'))).toBe(true);
    writeFileSync(preferences, 'Always start with the key files.\n');
    expect(prwalk('skill').stdout.endsWith('Always start with the key files.\n')).toBe(true);

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
    expect(readFileSync(preferences, 'utf8')).toBe('Always start with the key files.\n');
  });

  it('prints, creates and resets the preferences file', () => {
    const path = join(home, 'preferences.md');
    expect(prwalk('preferences')).toEqual({
      code: 0,
      stdout: `Preferences: ${path} (created with the defaults)\n\n${skillFile('PREFERENCES.md')}`,
      stderr: '',
    });
    expect(prwalk('preferences', '--path')).toEqual({ code: 0, stdout: `${path}\n`, stderr: '' });
    writeFileSync(path, 'mine\n');
    expect(JSON.parse(prwalk('preferences', '--json').stdout)).toEqual({
      path,
      created: false,
      text: 'mine\n',
    });
    expect(prwalk('preferences', '--reset')).toEqual({
      code: 0,
      stdout: `Reset ${path} to the defaults. The previous version is in ${path}.bak\n`,
      stderr: '',
    });

    const file = join(tempDir(), 'not-a-folder');
    writeFileSync(file, '');
    home = join(file, 'home');
    const failed = prwalk('preferences');
    expect(failed.code).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toMatch(/^Cannot read or create .*: .*ENOTDIR.*PRWALK_HOME/);
  });

  it('tells about a newer version after the preferences and in prwalk open, from update-check.json', () => {
    const version = (
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        version: string;
      }
    ).version;
    const check = join(home, 'update-check.json');
    const on = { PRWALK_UPDATE_CHECK: '1' };
    writeFileSync(check, JSON.stringify({ checkedAt: Date.now(), latest: version }));
    const upToDate = prwalk.with(on, 'skill').stdout;
    expect(upToDate.endsWith(skillFile('PREFERENCES.md'))).toBe(true);

    writeFileSync(check, JSON.stringify({ checkedAt: Date.now(), latest: '99.0.0' }));
    const printed = prwalk.with(on, 'skill').stdout;
    expect(printed.startsWith(upToDate)).toBe(true);
    expect(printed.slice(upToDate.length)).toBe(
      `\n---\n\nA newer version of prwalk is available: 99.0.0 (installed: ${version}). Tell the user in one line in your "ready" message, and run prwalk update if they agree (see "Updates").\n`,
    );

    const patch = fileURLToPath(new URL('../../test/fixtures/example.diff', import.meta.url));
    try {
      const opened = prwalk.with({ ...on, PRWALK_PORT: '0' }, 'open', '--patch', patch);
      expect(opened.stdout).toContain(
        `\nprwalk 99.0.0 is available (installed: ${version}); see "Updates" in prwalk skill.`,
      );
      const json = JSON.parse(
        prwalk.with({ ...on, PRWALK_PORT: '0' }, 'open', '--patch', patch, '--json').stdout,
      );
      expect(json.update).toEqual({ current: version, latest: '99.0.0' });
    } finally {
      prwalk('stop');
    }
  });

  it('makes overview the default level, in the guide and in the default preferences', () => {
    expect(skillFile('GUIDE.md')).toContain('`overview` by default');
    expect(skillFile('PREFERENCES.md')).toContain('**Default level:** `overview`');
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
    expect(existsSync(join(home, 'preferences.md'))).toBe(false);
  });

  it('tells a user without prwalk the same install command as the README', () => {
    expect(readme()).toContain(installCommand);
    expect(skillFile('SKILL.md')).toContain(installCommand);
  });
});
