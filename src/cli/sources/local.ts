import {
  type DiffSource,
  type RunOptions,
  requireChanges,
  runCommand,
  tryCommand,
} from './exec.js';

const HINT =
  'Run prwalk open inside a git repository, and pass --base with a branch or commit that exists.';

/**
 * Local changes without a PR: the working tree (uncommitted changes included, untracked files
 * not) against the point where the current branch forked from `base`.
 */
export async function localSource(
  { base }: { base?: string },
  options: RunOptions = {},
): Promise<DiffSource> {
  const git = (...args: string[]) => runCommand('git', args, options, HINT);

  const baseRef = base ?? (await defaultBase(options));
  const forkPoint = (await git('merge-base', baseRef, 'HEAD')).trim();
  const headRef = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  // Pin the output format so user configuration (colour, external diff tools, prefixes)
  // cannot change what the parser sees.
  const patch = await git(
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    forkPoint,
  );
  return requireChanges({ meta: { kind: 'local', title: headRef, headRef, baseRef }, patch });
}

/** The remote's default branch, or `main` when there is no remote HEAD. */
async function defaultBase(options: RunOptions): Promise<string> {
  const result = await tryCommand(
    'git',
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    options,
  );
  return typeof result === 'string' ? result.trim() : 'main';
}
