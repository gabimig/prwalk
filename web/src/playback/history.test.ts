import { describe, expect, it } from 'vitest';
import { type HistoryBlock, recordHistory } from './history.js';

describe('history', () => {
  it('groups what was said by step and opens a new block on a jump back', () => {
    const positions = [
      [0, 0],
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 0],
    ] as const;
    const history = positions.reduce<HistoryBlock[]>(
      (blocks, [step, sentence]) => recordHistory(blocks, { step, sentence }),
      [],
    );
    expect(history).toEqual([
      { step: 0, sentences: [0, 1] },
      { step: 1, sentences: [0, 1] },
      { step: 0, sentences: [0] },
    ]);
  });
});
