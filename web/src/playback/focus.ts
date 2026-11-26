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
