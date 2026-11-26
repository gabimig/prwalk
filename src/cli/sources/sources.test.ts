import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, repo, tempDir } from '../../../test/git-repo.js';
import { buildDiffIndex } from '../../shared/diff.js';
import { githubSource } from './github.js';
import { localSource } from './local.js';
import { patchSource } from './patch.js';

const fixturePatch = readFileSync(
  new URL('../../../test/fixtures/sample.diff', import.meta.url),
  'utf8',
);

/** A fake `gh` on its own PATH that runs `body` and logs its arguments to `calls.log`. */
function fakeGh(body: string): { env: NodeJS.ProcessEnv; calls: () => string[] } {
  const dir = tempDir();
  const log = join(dir, 'calls.log');
  const script = join(dir, 'gh');
  writeFileSync(script, `#!/bin/sh\necho "$*" >> "${log}"\n${body}\n`);
  chmodSync(script, 0o755);
  return {
    env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
    calls: () => readFileSync(log, 'utf8').trim().split('\n'),
  };
}

const prJson = JSON.stringify({
  number: 482,
  title: 'Add login rate limit',
  url: 'https://github.com/acme/app/pull/482',
  headRefName: 'feat/rate-limit',
  baseRefName: 'main',
});

describe('local source', () => {
  it('diffs the working tree, uncommitted changes included, against the fork point', async () => {
    const dir = repo();
    git(dir, 'checkout', '-qb', 'feature');
    writeFileSync(join(dir, 'a.txt'), 'one\ncommitted\n');
    git(dir, 'commit', '-qam', 'feature work');
    git(dir, 'checkout', '-q', 'main');
    writeFileSync(join(dir, 'main-only.txt'), 'later on main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'main moves on');
    git(dir, 'checkout', '-q', 'feature');
    writeFileSync(join(dir, 'a.txt'), 'one\ncommitted\nuncommitted\n');
    writeFileSync(join(dir, 'untracked.txt'), 'not in git\n');

    const { meta, patch } = await localSource({}, { cwd: dir });

    expect(meta).toEqual({ kind: 'local', title: 'feature', headRef: 'feature', baseRef: 'main' });
    expect(buildDiffIndex(patch).files.map((file) => [file.path, file.additions])).toEqual([
      ['a.txt', 2],
    ]);
  });
});

describe('github source', () => {
  it('joins the PR metadata from gh pr view with the diff from gh pr diff', async () => {
    const diffFile = join(tempDir(), 'pr.diff');
    writeFileSync(diffFile, fixturePatch);
    const gh = fakeGh(`case "$2" in view) echo '${prJson}';; diff) cat "${diffFile}";; esac`);

    const source = await githubSource('482', { env: gh.env });

    expect(source).toEqual({
      meta: {
        kind: 'github',
        title: 'Add login rate limit',
        number: 482,
        url: 'https://github.com/acme/app/pull/482',
        headRef: 'feat/rate-limit',
        baseRef: 'main',
      },
      patch: fixturePatch,
    });
    expect(gh.calls()).toEqual([
      'pr view 482 --json number,title,url,headRefName,baseRefName',
      'pr diff 482 --color=never',
    ]);
  });
});

describe('source failures', () => {
  it('says when the command is not installed', async () => {
    await expect(githubSource('482', { env: { PATH: tempDir() } })).rejects.toThrow(
      'gh is not installed or not on the PATH. Install it from https://cli.github.com and run "gh auth login".',
    );
  });

  it('shows the stderr of a failing command and a hint', async () => {
    await expect(localSource({ base: 'no-such-branch' }, { cwd: repo() })).rejects.toThrow(
      /^git merge-base no-such-branch HEAD failed:\n.*no-such-branch.*\nRun prwalk open inside a git repository, and pass --base with a branch or commit that exists\.$/s,
    );
  });

  it('says when the patch file cannot be read', async () => {
    await expect(patchSource('missing.diff')).rejects.toThrow(
      /^Cannot read the patch file "missing\.diff": ENOENT/,
    );
  });

  it('refuses a patch file that is not a git diff', async () => {
    const file = join(tempDir(), 'notes.txt');
    writeFileSync(file, 'just some notes\n');
    await expect(patchSource(file)).rejects.toThrow(
      `"${file}" is not a git diff: it has no "diff --git" sections. Make one with git diff or gh pr diff.`,
    );
  });

  it('refuses an empty diff', async () => {
    await expect(localSource({}, { cwd: repo() })).rejects.toThrow(
      'The diff is empty: there is nothing to walk through.',
    );
  });

  it('refuses a PR that is neither a number nor a URL without running gh', async () => {
    const gh = fakeGh(`echo '${prJson}'`);
    await expect(githubSource('main', { env: gh.env })).rejects.toThrow(
      'The PR must be a number like 482 or a URL like https://github.com/owner/repo/pull/482, got "main". For local changes, run prwalk open without a PR.',
    );
    expect(() => gh.calls()).toThrow(/ENOENT/);
  });

  it('stops before fetching the diff when gh pr view answers without the expected fields', async () => {
    const gh = fakeGh(`echo '{"number": 482}'`);

    await expect(githubSource('482', { env: gh.env })).rejects.toThrow(
      /^gh pr view returned unexpected output: /,
    );
    expect(gh.calls()).toEqual(['pr view 482 --json number,title,url,headRefName,baseRefName']);
  });
});
