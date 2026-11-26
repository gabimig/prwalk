import { checkFocus, type DiffIndex } from './diff.js';
import { describePath, type Script } from './script.js';

/**
 * Whether every range a valid script points at can be shown on this diff: each step's focus and
 * each sentence's own range (on the step's file). Returns every problem, each prefixed with its
 * position in the script like validateScript's errors; an empty list means the script fits.
 */
export function checkScriptAgainstDiff(script: Script, index: DiffIndex): string[] {
  const errors: string[] = [];
  script.steps.forEach((step, stepIndex) => {
    const { focus } = step;
    if (focus === undefined) return;
    const report = (path: PropertyKey[], problem: string | undefined) => {
      if (problem !== undefined) {
        errors.push(`${describePath(['steps', stepIndex, ...path], script)}: ${problem}`);
      }
    };
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
