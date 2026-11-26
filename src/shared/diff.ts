import { type FileDiffMetadata, processFile } from '@pierre/diffs';
import type { Focus } from './script.js';

/**
 * What an agent needs from a diff to write a walkthrough script: which files changed and which
 * line ranges each hunk covers. Parsing is delegated to @pierre/diffs, the library the viewer
 * renders with, so line numbers here match the ones on screen by construction.
 */

export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number };

export type DiffFile = {
  /** New path; for a deleted file, the old one. */
  path: string;
  /** Only for renamed files. */
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};

export type DiffIndex = { files: DiffFile[] };

export type DiffLine =
  | { type: 'context'; old: number; new: number; text: string }
  | { type: 'deletion'; old: number; text: string }
  | { type: 'addition'; new: number; text: string };

export type DiffLinesHunk = { header: string; lines: DiffLine[] };

const STATUS: Record<FileDiffMetadata['type'], DiffFile['status']> = {
  new: 'added',
  change: 'modified',
  deleted: 'deleted',
  'rename-pure': 'renamed',
  'rename-changed': 'renamed',
};

const BINARY_MARKER = /^(Binary files .* differ|GIT binary patch)$/m;

/** Each file of a unified git diff, with the parsed form @pierre/diffs renders. */
export type ParsedDiffFile = { file: DiffFile; metadata: FileDiffMetadata };

/** Parses a unified git diff file by file. Throws if the patch is malformed. */
export function parseDiff(patch: string): ParsedDiffFile[] {
  return parseFiles(patch).map(({ raw, metadata }) => ({
    file: toDiffFile(raw, metadata),
    metadata,
  }));
}

/** Builds the index of a unified git diff. Throws if the patch is malformed. */
export function buildDiffIndex(patch: string): DiffIndex {
  return { files: parseDiff(patch).map(({ file }) => file) };
}

/** The lines of one file in the diff, numbered on both sides, or undefined if it is not there. */
export function fileDiffLines(patch: string, path: string): DiffLinesHunk[] | undefined {
  const found = parseDiff(patch).find(({ file }) => file.path === path);
  if (found === undefined) return undefined;
  const { metadata } = found;
  return metadata.hunks.map((hunk) => {
    const lines: DiffLine[] = [];
    let oldNumber = hunk.deletionStart;
    let newNumber = hunk.additionStart;
    for (const block of hunk.hunkContent) {
      if (block.type === 'context') {
        for (let offset = 0; offset < block.lines; offset++) {
          const text = clean(metadata.additionLines[block.additionLineIndex + offset]);
          lines.push({ type: 'context', old: oldNumber++, new: newNumber++, text });
        }
        continue;
      }
      for (let offset = 0; offset < block.deletions; offset++) {
        const text = clean(metadata.deletionLines[block.deletionLineIndex + offset]);
        lines.push({ type: 'deletion', old: oldNumber++, text });
      }
      for (let offset = 0; offset < block.additions; offset++) {
        const text = clean(metadata.additionLines[block.additionLineIndex + offset]);
        lines.push({ type: 'addition', new: newNumber++, text });
      }
    }
    const context = hunk.hunkContext ? ` ${hunk.hunkContext}` : '';
    const header = `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@${context}`;
    return { header, lines };
  });
}

/**
 * Whether `focus` can be shown: its file is in the diff and the whole range falls inside one hunk
 * of its side (new by default). Returns the reason it cannot, naming the ranges that can.
 */
export function checkFocus(index: DiffIndex, focus: Focus): string | undefined {
  const file = index.files.find((candidate) => candidate.path === focus.file);
  if (file === undefined) {
    const paths = index.files.map((candidate) => candidate.path).join(', ');
    return `${JSON.stringify(focus.file)} is not in the diff. Files in the diff: ${paths}`;
  }
  if (file.binary) return `${file.path} is a binary file: it has no lines to focus on.`;
  const side = focus.side ?? 'new';
  const [start, end] = focus.lines;
  const ranges = hunkRanges(file, side);
  if (ranges.some(([first, last]) => first <= start && end <= last)) return undefined;
  const other = side === 'new' ? 'old' : 'new';
  const listed = ranges.length === 0 ? 'none' : ranges.map(([a, b]) => `${a}-${b}`).join(', ');
  const hint =
    ranges.length === 0 && hunkRanges(file, other).length > 0 ? ` Try the ${other} side.` : '';
  return `Lines ${start}-${end} of ${file.path} are not inside one hunk of the ${side} side. Ranges on the ${side} side: ${listed}.${hint}`;
}

/** The first and last line each hunk covers on one side; hunks with no lines there are left out. */
function hunkRanges(file: DiffFile, side: 'new' | 'old'): [number, number][] {
  return file.hunks.flatMap((hunk) => {
    const [first, count] =
      side === 'new' ? [hunk.newStart, hunk.newLines] : [hunk.oldStart, hunk.oldLines];
    return count === 0 ? [] : [[first, first + count - 1] as [number, number]];
  });
}

// Split per file ourselves (as @pierre/diffs does) so each file keeps its raw text, which is
// where git says a file is binary; the library does not report that.
function parseFiles(patch: string): { raw: string; metadata: FileDiffMetadata }[] {
  const parsed: { raw: string; metadata: FileDiffMetadata }[] = [];
  for (const raw of patch.split(/(?=^diff --git )/m)) {
    if (!raw.startsWith('diff --git ')) continue;
    const metadata = processFile(raw, { isGitDiff: true, throwOnError: true });
    if (metadata !== undefined) parsed.push({ raw, metadata });
  }
  return parsed;
}

function toDiffFile(raw: string, metadata: FileDiffMetadata): DiffFile {
  const status = STATUS[metadata.type];
  const file: DiffFile = {
    path: status === 'deleted' ? (metadata.prevName ?? metadata.name) : metadata.name,
    status,
    binary: BINARY_MARKER.test(raw),
    additions: 0,
    deletions: 0,
    hunks: [],
  };
  if (status === 'renamed' && metadata.prevName !== undefined) file.oldPath = metadata.prevName;
  for (const hunk of metadata.hunks) {
    file.additions += hunk.additionLines;
    file.deletions += hunk.deletionLines;
    file.hunks.push({
      oldStart: hunk.deletionStart,
      oldLines: hunk.deletionCount,
      newStart: hunk.additionStart,
      newLines: hunk.additionCount,
    });
  }
  return file;
}

function clean(line: string | undefined): string {
  return (line ?? '').replace(/\r?\n$/, '');
}
