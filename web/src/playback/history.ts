/** What has been said in one visit to a step: the indexes of its sentences, in order. */
export type HistoryBlock = { step: number; sentences: number[] };

/**
 * Adds the sentence now being said to the history. Moving forward within a step extends its
 * block; anything else (another step, or starting a step again) opens a new block, so going back
 * never erases what was said before.
 */
export function recordHistory(
  history: HistoryBlock[],
  { step, sentence }: { step: number; sentence: number },
): HistoryBlock[] {
  const last = history.at(-1);
  const lastSentence = last?.sentences.at(-1);
  if (last?.step === step && lastSentence !== undefined) {
    if (sentence === lastSentence) return history;
    if (sentence > lastSentence) {
      return [...history.slice(0, -1), { step, sentences: [...last.sentences, sentence] }];
    }
  }
  return [...history, { step, sentences: [sentence] }];
}
