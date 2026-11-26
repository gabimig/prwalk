import { describe, expect, it } from 'vitest';
import { sentenceFocus } from './focus.js';
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
