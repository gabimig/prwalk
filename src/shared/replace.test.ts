import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import example from '../../test/fixtures/example-script.json' with { type: 'json' };
import { buildDiffIndex } from './diff.js';
import { positionAfterReplace, replaceSteps, resolveStep } from './replace.js';
import { type Script, validateScript } from './script.js';

const index = buildDiffIndex(
  readFileSync(new URL('../../test/fixtures/example.diff', import.meta.url), 'utf8'),
);

function exampleScript(): Script {
  const result = validateScript(structuredClone(example));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.script;
}

const newStep = {
  id: 'store-down',
  title: 'Si el almacén se cae',
  focus: { file: 'src/auth/rateLimiter.ts', lines: [12, 18] },
  say: ['Si el almacén falla, el error sube hasta el controlador.'],
};

describe('replaceSteps', () => {
  it('replaces the steps from the given one to the end', () => {
    const result = replaceSteps(exampleScript(), 6, [newStep], index);
    expect(result).toEqual({
      ok: true,
      script: { ...exampleScript(), steps: [...exampleScript().steps.slice(0, 6), newStep] },
    });
  });

  it('rejects a result that is not valid, or does not fit the diff, and changes nothing', () => {
    const script = exampleScript();
    const offDiff = { ...newStep, focus: { file: 'nope.ts', lines: [1, 1] } };
    const result = replaceSteps(script, 6, [{ ...newStep, id: 'overview' }, offDiff], index);
    expect(result).toEqual({
      ok: false,
      errors: [expect.stringMatching(/^steps\[6\] \(id "overview"\) id: must be unique/)],
    });
    expect(replaceSteps(script, 6, [offDiff], index)).toEqual({
      ok: false,
      errors: [expect.stringMatching(/^steps\[6\] \(id "store-down"\) focus: "nope\.ts" is not/)],
    });
    expect(script).toEqual(exampleScript());
  });

  it('shortens the script with an empty list, as long as one step is left', () => {
    const result = replaceSteps(exampleScript(), 6, [], index);
    expect(result.ok && result.script.steps.map(({ id }) => id)).toEqual(
      exampleScript()
        .steps.slice(0, 6)
        .map(({ id }) => id),
    );
    expect(replaceSteps(exampleScript(), 0, [], index)).toEqual({
      ok: false,
      errors: ['steps: must have at least one step'],
    });
  });
});

describe('positionAfterReplace', () => {
  it('keeps a position before the replaced steps, else pauses at the first new one or finishes', () => {
    const shortened = { ...exampleScript(), steps: exampleScript().steps.slice(0, 6) };
    const playing = { status: 'playing', step: 3, sentence: 1 } as const;
    expect(positionAfterReplace(playing, 4, shortened)).toEqual(playing);
    expect(positionAfterReplace(playing, 2, shortened)).toEqual({
      status: 'paused',
      step: 2,
      sentence: 0,
    });
    expect(positionAfterReplace({ ...playing, step: 7 }, 6, shortened)).toEqual({
      status: 'finished',
      step: 5,
      sentence: 1,
    });
  });
});

describe('resolveStep', () => {
  it('finds a step by its id or by its number counted from 1', () => {
    const script = exampleScript();
    expect(resolveStep(script, 'config')).toBe(5);
    expect(resolveStep(script, '6')).toBe(5);
    expect(resolveStep(script, '9')).toBeUndefined();
    expect(resolveStep(script, '0')).toBeUndefined();
  });
});
