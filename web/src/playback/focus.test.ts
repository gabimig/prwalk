import { describe, expect, it } from 'vitest';
import { cardPaths, sentenceFocus } from './focus.js';
import { exampleScript } from './test-script.js';

describe('sentenceFocus', () => {
  it("narrows the step's focus to the range of the sentence being said, if it has one", () => {
    const step = exampleScript().steps[4];
    if (step === undefined) throw new Error('fixture changed');
    const file = 'src/auth/loginController.ts';
    expect(sentenceFocus(step, 0)).toEqual({ file, side: 'new', lines: [20, 26] });
    expect(sentenceFocus(step, 3)).toEqual({ file, side: 'new', lines: [26, 26] });
    expect(sentenceFocus(exampleScript().steps[0] ?? step, 0)).toBeUndefined();
  });
});

describe('cardPaths', () => {
  it("lights the sentence's own path, else every path of the card's items, else nothing", () => {
    const [overview, structure, , , , , tests] = exampleScript().steps;
    if (overview === undefined || structure === undefined || tests === undefined) {
      throw new Error('fixture changed');
    }
    expect(cardPaths(overview, 1)).toEqual({ paths: ['src/auth'], sentence: true });
    expect(cardPaths(overview, 0)).toEqual({
      paths: ['src/auth', 'src/config/auth.ts', 'test/auth'],
      sentence: false,
    });
    expect(cardPaths(tests, 0)).toBeUndefined();
    expect(cardPaths(structure, 0)).toBeUndefined();
  });
});
