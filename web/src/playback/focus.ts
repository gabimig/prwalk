import type { ViewerFocus } from '../../../src/shared/protocol.js';
import type { Sentence, Step } from '../../../src/shared/script.js';

export function sentenceText(sentence: Sentence): string {
  return typeof sentence === 'string' ? sentence : sentence.text;
}

/**
 * What to highlight while sentence `index` of `step` is said: the sentence's own range if it has
 * one, else the step's focus. Undefined for a card step.
 */
export function sentenceFocus(step: Step, index: number): ViewerFocus | undefined {
  const { focus } = step;
  if (focus === undefined) return undefined;
  const sentence = step.say[index];
  const own = typeof sentence === 'object' ? sentence : undefined;
  if (own?.lines === undefined) {
    return { file: focus.file, side: focus.side ?? 'new', lines: focus.lines };
  }
  return { file: focus.file, side: own.side ?? focus.side ?? 'new', lines: own.lines };
}

/**
 * The paths of the repository a card step lights in the file tree while sentence `index` is
 * said: the sentence's own path (`sentence` true: the rest of the tree is dimmed more), else the
 * paths of the card's items. Undefined when there are none, and for a step with a focus.
 */
export function cardPaths(
  step: Step,
  index: number,
): { paths: string[]; sentence: boolean } | undefined {
  if (step.card === undefined) return undefined;
  const sentence = step.say[index];
  if (typeof sentence === 'object' && sentence.path !== undefined) {
    return { paths: [sentence.path], sentence: true };
  }
  const paths = step.card.items.flatMap((item) => (item.path === undefined ? [] : [item.path]));
  return paths.length === 0 ? undefined : { paths, sentence: false };
}
