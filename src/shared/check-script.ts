import { checkFocus, type DiffIndex } from './diff.js';
import { describePath, type Script } from './script.js';
import { diffPaths } from './tree.js';

/**
 * Whether every place a valid script points at can be shown on this diff: each step's focus,
 * each sentence's own range (on the step's file) and each path of a card step. Returns every
 * problem, each prefixed with its position in the script like validateScript's errors; an empty
 * list means the script fits.
 */
export function checkScriptAgainstDiff(script: Script, index: DiffIndex): string[] {
  const errors: string[] = [];
  const paths = diffPaths(index.files);
  script.steps.forEach((step, stepIndex) => {
    const report = (path: PropertyKey[], problem: string | undefined) => {
      if (problem !== undefined) {
        errors.push(`${describePath(['steps', stepIndex, ...path], script)}: ${problem}`);
      }
    };
    const { focus, card } = step;
    if (card !== undefined) {
      card.items.forEach((item, itemIndex) => {
        if (item.path !== undefined) {
          report(['card', 'items', itemIndex, 'path'], checkPath(paths, item.path));
        }
      });
      step.say.forEach((sentence, sentenceIndex) => {
        if (typeof sentence !== 'string' && sentence.path !== undefined) {
          report(['say', sentenceIndex, 'path'], checkPath(paths, sentence.path));
        }
      });
    }
    if (focus === undefined) return;
    report(['focus'], checkFocus(index, focus));
    step.say.forEach((sentence, sentenceIndex) => {
      if (typeof sentence === 'string' || sentence.lines === undefined) return;
      const side = sentence.side ?? focus.side;
      report(
        ['say', sentenceIndex, 'lines'],
        checkFocus(index, {
          file: focus.file,
          lines: sentence.lines,
          ...(side !== undefined && { side }),
        }),
      );
    });
  });
  return errors;
}

/** Why `path` names no file or folder of the diff, with the closest ones that it could mean. */
function checkPath(paths: string[], path: string): string | undefined {
  if (paths.includes(path)) return undefined;
  const similar = paths
    .map((candidate) => ({ candidate, distance: editDistance(candidate, path) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.length - b.candidate.length)
    .slice(0, 3)
    .map(({ candidate }) => candidate);
  return `${JSON.stringify(path)} is not a file or folder of the diff. Similar paths: ${similar.join(', ')}`;
}

/** Levenshtein distance: the fewest single-character edits that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
