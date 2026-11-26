import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { buildDiffIndex } from '../../shared/diff.js';
import { UserError } from '../errors.js';
import { type DiffSource, requireChanges } from './exec.js';

/** A unified git diff saved in a file: for demos and tests without a real PR. */
export async function patchSource(file: string, title?: string): Promise<DiffSource> {
  let patch: string;
  try {
    patch = await readFile(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UserError(`Cannot read the patch file "${file}": ${reason}`);
  }
  const source = requireChanges({
    meta: { kind: 'patch', title: title ?? basename(file), headRef: '', baseRef: '' },
    patch,
  });
  let files = 0;
  try {
    files = buildDiffIndex(patch).files.length;
  } catch {}
  if (files === 0) {
    throw new UserError(
      `"${file}" is not a git diff: it has no "diff --git" sections. Make one with git diff or gh pr diff.`,
    );
  }
  return source;
}
