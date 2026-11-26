import { z } from 'zod';
import { UserError } from '../errors.js';
import { type DiffSource, type RunOptions, requireChanges, runCommand } from './exec.js';

const HINT = 'Check the PR number or URL, and that "gh auth status" shows you are logged in.';

const prViewSchema = z.object({
  number: z.int().positive(),
  title: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
});

/**
 * A GitHub pull request through `gh`. A PR number is resolved against the repository in the
 * working directory; a URL works from anywhere.
 */
export async function githubSource(pr: string, options: RunOptions = {}): Promise<DiffSource> {
  if (!/^\d+$/.test(pr) && !/^https?:\/\/\S+$/i.test(pr)) {
    throw new UserError(
      `The PR must be a number like 482 or a URL like https://github.com/owner/repo/pull/482, got ${JSON.stringify(pr)}. For local changes, run prwalk open without a PR.`,
    );
  }
  const viewArgs = ['pr', 'view', pr, '--json', 'number,title,url,headRefName,baseRefName'];
  const viewOutput = await runCommand('gh', viewArgs, options, HINT);

  let view: z.infer<typeof prViewSchema>;
  try {
    view = prViewSchema.parse(JSON.parse(viewOutput));
  } catch (error) {
    const reason = error instanceof z.ZodError ? z.prettifyError(error) : String(error);
    throw new UserError(`gh pr view returned unexpected output: ${reason}`);
  }

  const patch = await runCommand('gh', ['pr', 'diff', pr, '--color=never'], options, HINT);
  return requireChanges({
    meta: {
      kind: 'github',
      title: view.title,
      number: view.number,
      url: view.url,
      headRef: view.headRefName,
      baseRef: view.baseRefName,
    },
    patch,
  });
}
