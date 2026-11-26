import type { AsideAnswer } from '../../../src/shared/protocol.js';
import type { Script } from '../../../src/shared/script.js';
import { sentenceText } from './focus.js';
import { type HistoryBlock, recordHistory } from './history.js';

/** One line of the history: a sentence of the script, or an answer with its question. */
export type TranscriptLine =
  | { kind: 'sentence'; text: string }
  | { kind: 'answer'; question?: string; text: string };

/**
 * A block of the history as it is shown: the visit to a step (grouped like recordHistory does)
 * with the step's title and every line said in it, copied when said, so the history keeps what
 * was said after `prwalk replace` changes the steps.
 */
export type TranscriptBlock = HistoryBlock & { title: string; lines: TranscriptLine[] };

/** Adds the sentence now being said, if it is not there already. */
export function recordSentence(
  transcript: TranscriptBlock[],
  script: Script,
  position: { step: number; sentence: number },
): TranscriptBlock[] {
  const said = script.steps[position.step]?.say[position.sentence];
  if (said === undefined) return transcript;
  const line: TranscriptLine = { kind: 'sentence', text: sentenceText(said) };
  const last = transcript.at(-1);
  // A block opened by an answer before any sentence of its step was said.
  if (last?.step === position.step && last.sentences.length === 0) {
    return [
      ...transcript.slice(0, -1),
      { ...last, sentences: [position.sentence], lines: [...last.lines, line] },
    ];
  }
  const before = transcript.map(({ step, sentences }) => ({ step, sentences }));
  const after = recordHistory(before, position);
  // `prwalk replace` may change the step under the same position: what is said now opens a block.
  const replaced =
    last?.step === position.step &&
    (last.title !== script.steps[position.step]?.title ||
      (after === before &&
        last.lines.findLast((said) => said.kind === 'sentence')?.text !== line.text));
  if (after === before && !replaced) return transcript;
  if (last === undefined || replaced || after.length > before.length) {
    return [...transcript, newBlock(script, position.step, [position.sentence], line)];
  }
  return [
    ...transcript.slice(0, -1),
    { ...last, sentences: [...last.sentences, position.sentence], lines: [...last.lines, line] },
  ];
}

/** Adds an answer to the block of the step the walkthrough waits on. */
export function recordAnswer(
  transcript: TranscriptBlock[],
  script: Script,
  step: number,
  answer: AsideAnswer,
): TranscriptBlock[] {
  const line: TranscriptLine = {
    kind: 'answer',
    text: answer.text,
    ...(answer.question !== undefined && { question: answer.question }),
  };
  const last = transcript.at(-1);
  if (last === undefined || last.step !== step) {
    return [...transcript, newBlock(script, step, [], line)];
  }
  return [...transcript.slice(0, -1), { ...last, lines: [...last.lines, line] }];
}

function newBlock(
  script: Script,
  step: number,
  sentences: number[],
  line: TranscriptLine,
): TranscriptBlock {
  return { step, sentences, title: script.steps[step]?.title ?? '', lines: [line] };
}
