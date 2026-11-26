import { execFile } from 'node:child_process';
import type { SessionMeta } from '../../shared/session.js';
import { UserError } from '../errors.js';

export type DiffSource = { meta: SessionMeta; patch: string };

export type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv };

/** Large enough for any diff the daemon accepts (50 MB). */
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

const INSTALL_HINT: Record<string, string> = {
  gh: 'Install it from https://cli.github.com and run "gh auth login".',
  git: 'Install it from https://git-scm.com.',
};

type Failure = { kind: 'failed'; stderr: string };

/**
 * Runs a command with an argument list (never through a shell) and returns its stdout.
 * A missing command throws a UserError; a failing one resolves to a Failure so the caller can
 * either fall back or report it with its own hint.
 */
export function tryCommand(
  command: string,
  args: string[],
  options: RunOptions,
): Promise<string | Failure> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { ...options, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(
            new UserError(
              `${command} is not installed or not on the PATH. ${INSTALL_HINT[command] ?? ''}`.trim(),
            ),
          );
        }
        resolve({ kind: 'failed', stderr: stderr.trim() || error.message });
      },
    );
  });
}

/** Like tryCommand, but a failing command becomes a UserError with its stderr and `hint`. */
export async function runCommand(
  command: string,
  args: string[],
  options: RunOptions,
  hint: string,
): Promise<string> {
  const result = await tryCommand(command, args, options);
  if (typeof result === 'string') return result;
  throw new UserError(`${command} ${args.join(' ')} failed:\n${result.stderr}\n${hint}`);
}

export function requireChanges(source: DiffSource): DiffSource {
  if (source.patch.trim() === '') {
    throw new UserError('The diff is empty: there is nothing to walk through.');
  }
  return source;
}
