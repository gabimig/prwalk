import type { DiffFile } from './diff.js';

/**
 * The changed files of a diff as a folder tree, like GitHub's file tree beside a pull request,
 * and which of its rows a path in a script points at. Only files in the diff are in it.
 */

export type TreeFile = { kind: 'file'; name: string; path: string; file: DiffFile };

export type TreeDir = {
  kind: 'dir';
  /** One or more folder names: a chain of folders with a single child is one row, `a/b/c`. */
  name: string;
  /** From the root of the repository, without a trailing slash. */
  path: string;
  /** Changed files anywhere under it. */
  files: number;
  children: TreeNode[];
};

export type TreeNode = TreeFile | TreeDir;

/** Folders before files, each in alphabetical order; folder chains with one child compressed. */
export function buildFileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeDir = { kind: 'dir', name: '', path: '', files: 0, children: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    let dir = root;
    for (const [index, name] of segments.entries()) {
      dir.files++;
      const path = segments.slice(0, index + 1).join('/');
      if (index === segments.length - 1) {
        dir.children.push({ kind: 'file', name, path, file });
        break;
      }
      let child = dir.children.find(
        (node): node is TreeDir => node.kind === 'dir' && node.name === name,
      );
      if (child === undefined) {
        child = { kind: 'dir', name, path, files: 0, children: [] };
        dir.children.push(child);
      }
      dir = child;
    }
  }
  return root.children.map(compress).sort(byKindThenName);
}

function compress(node: TreeNode): TreeNode {
  if (node.kind === 'file') return node;
  let dir = node;
  let only = dir.children[0];
  while (dir.children.length === 1 && only?.kind === 'dir') {
    dir = { ...only, name: `${dir.name}/${only.name}` };
    only = dir.children[0];
  }
  return { ...dir, children: dir.children.map(compress).sort(byKindThenName) };
}

function byKindThenName(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * The rows `path` lights: the file it names, or the folder it names with everything under it (a
 * folder inside a compressed row lights that row). Paths are compared by whole segments, and a
 * renamed file also answers to its old path. Returns the rows' paths; empty if it names nothing.
 */
export function pathTargets(nodes: TreeNode[], path: string): Set<string> {
  const lit = new Set<string>();
  const visit = (node: TreeNode) => {
    const paths =
      node.kind === 'file' && node.file.oldPath !== undefined
        ? [node.path, node.file.oldPath]
        : [node.path];
    if (paths.some((candidate) => isWithin(candidate, path))) lit.add(node.path);
    if (node.kind === 'dir') node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return lit;
}

/** Whether `path` is `folder` itself or somewhere under it, by whole segments. */
export function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** Every path a script may point at: each changed file (old paths too) and each folder above. */
export function diffPaths(files: DiffFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    for (const path of file.oldPath === undefined ? [file.path] : [file.path, file.oldPath]) {
      const segments = path.split('/');
      for (let end = 1; end <= segments.length; end++) paths.add(segments.slice(0, end).join('/'));
    }
  }
  return [...paths];
}
