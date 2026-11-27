import { describe, expect, it } from 'vitest';
import type { DiffFile } from './diff.js';
import { buildFileTree, pathTargets, type TreeNode } from './tree.js';

function changed(path: string, oldPath?: string): DiffFile {
  return {
    path,
    ...(oldPath !== undefined && { oldPath }),
    status: oldPath === undefined ? 'modified' : 'renamed',
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [],
  };
}

/** The tree with only what the test is about: names, counts and nesting. */
type Shape = string | { dir: string; files: number; children: Shape[] };
function shape(nodes: TreeNode[]): Shape[] {
  return nodes.map((node) =>
    node.kind === 'file'
      ? node.name
      : { dir: node.name, files: node.files, children: shape(node.children) },
  );
}

describe('buildFileTree', () => {
  it('groups files by folder, compresses single-child chains and sorts folders first', () => {
    const tree = buildFileTree([
      changed('src/z.ts'),
      changed('README.md'),
      changed('src/auth/limits/b.ts'),
      changed('docs/x/y/z.md'),
      changed('src/auth/limits/a.ts'),
    ]);
    expect(shape(tree)).toEqual([
      { dir: 'docs/x/y', files: 1, children: ['z.md'] },
      {
        dir: 'src',
        files: 3,
        children: [{ dir: 'auth/limits', files: 2, children: ['a.ts', 'b.ts'] }, 'z.ts'],
      },
      'README.md',
    ]);
    expect(tree[1]?.kind === 'dir' && tree[1].children[0]?.path).toBe('src/auth/limits');
  });
});

describe('pathTargets', () => {
  const tree = buildFileTree([
    changed('src/auth/limits/a.ts'),
    changed('src/auth/limits/b.ts'),
    changed('src/authz.ts'),
    changed('src/new.ts', 'lib/old.ts'),
  ]);
  it.each([
    ['a file', 'src/auth/limits/a.ts', ['src/auth/limits/a.ts']],
    [
      'a folder and all it holds',
      'src',
      [
        'src',
        'src/auth/limits',
        'src/auth/limits/a.ts',
        'src/auth/limits/b.ts',
        'src/authz.ts',
        'src/new.ts',
      ],
    ],
    [
      'a folder inside a compressed row',
      'src/auth',
      ['src/auth/limits', 'src/auth/limits/a.ts', 'src/auth/limits/b.ts'],
    ],
    ['nothing for part of a segment', 'src/au', []],
    ['a renamed file by its old path', 'lib/old.ts', ['src/new.ts']],
  ])('lights %s', (_, path, lit) => {
    expect([...pathTargets(tree, path)].sort()).toEqual([...lit].sort());
  });
});
