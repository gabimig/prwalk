import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDiffIndex, checkFocus, type DiffFile, fileDiffLines } from './diff.js';

const patch = readFileSync(new URL('../../test/fixtures/sample.diff', import.meta.url), 'utf8');
const index = buildDiffIndex(patch);

function file(path: string): DiffFile | undefined {
  return index.files.find((candidate) => candidate.path === path);
}

describe('buildDiffIndex', () => {
  it('lists an added file with its new-side range', () => {
    expect(file('src/added.ts')).toEqual({
      path: 'src/added.ts',
      status: 'added',
      binary: false,
      additions: 2,
      deletions: 0,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 }],
    });
  });

  it('lists a modified file with the ranges of each hunk', () => {
    expect(file('src/limit.ts')).toEqual({
      path: 'src/limit.ts',
      status: 'modified',
      binary: false,
      additions: 4,
      deletions: 3,
      hunks: [
        { oldStart: 1, oldLines: 5, newStart: 1, newLines: 5 },
        { oldStart: 12, oldLines: 4, newStart: 12, newLines: 5 },
      ],
    });
  });

  it('lists a deleted file under its old path', () => {
    expect(file('src/old.ts')).toEqual({
      path: 'src/old.ts',
      status: 'deleted',
      binary: false,
      additions: 0,
      deletions: 3,
      hunks: [{ oldStart: 1, oldLines: 3, newStart: 0, newLines: 0 }],
    });
  });

  it('lists a renamed file under its new path and keeps the old one', () => {
    expect(file('src/renamed.ts')).toMatchObject({
      path: 'src/renamed.ts',
      oldPath: 'src/name.ts',
      status: 'renamed',
      additions: 1,
      deletions: 1,
    });
  });

  it('marks a binary file, which has no hunks', () => {
    expect(file('logo.png')).toEqual({
      path: 'logo.png',
      status: 'modified',
      binary: true,
      additions: 0,
      deletions: 0,
      hunks: [],
    });
  });
});

describe('fileDiffLines', () => {
  it('numbers each line with its old and new line numbers', () => {
    const hunks = fileDiffLines(patch, 'src/limit.ts');
    expect(hunks?.[1]).toEqual({
      header: '@@ -12,4 +12,5 @@ export const g = 7;',
      lines: [
        { type: 'context', old: 12, new: 12, text: 'export const h = 8;' },
        { type: 'context', old: 13, new: 13, text: 'export const i = 9;' },
        { type: 'context', old: 14, new: 14, text: 'export const j = 10;' },
        { type: 'deletion', old: 15, text: 'export const k = 11;' },
        { type: 'addition', new: 15, text: 'export const k = 12;' },
        { type: 'addition', new: 16, text: 'export const l = 13;' },
      ],
    });
  });
});

describe('checkFocus', () => {
  it('accepts a range inside one hunk of the new side', () => {
    expect(checkFocus(index, { file: 'src/limit.ts', lines: [13, 16] })).toBeUndefined();
  });

  it('rejects a file that is not in the diff and lists the files that are', () => {
    expect(checkFocus(index, { file: 'src/nope.ts', lines: [1, 1] })).toBe(
      '"src/nope.ts" is not in the diff. Files in the diff: logo.png, src/added.ts, src/limit.ts, src/old.ts, src/renamed.ts',
    );
  });

  it('rejects a range outside every hunk and lists the ranges on that side', () => {
    expect(checkFocus(index, { file: 'src/limit.ts', lines: [7, 9] })).toBe(
      'Lines 7-9 of src/limit.ts are not inside one hunk of the new side. Ranges on the new side: 1-5, 12-16.',
    );
  });

  it('rejects a range that spans two hunks', () => {
    expect(checkFocus(index, { file: 'src/limit.ts', lines: [4, 13] })).toMatch(
      /^Lines 4-13 of src\/limit\.ts are not inside one hunk of the new side\./,
    );
  });

  it('checks the old side against the old line numbers', () => {
    expect(checkFocus(index, { file: 'src/old.ts', side: 'old', lines: [1, 3] })).toBeUndefined();
    expect(checkFocus(index, { file: 'src/old.ts', lines: [1, 3] })).toBe(
      'Lines 1-3 of src/old.ts are not inside one hunk of the new side. Ranges on the new side: none. Try the old side.',
    );
  });

  it('rejects a binary file', () => {
    expect(checkFocus(index, { file: 'logo.png', lines: [1, 1] })).toBe(
      'logo.png is a binary file: it has no lines to focus on.',
    );
  });
});
