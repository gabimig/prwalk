import { describe, expect, it } from 'vitest';
import example from '../../test/fixtures/example-script.json' with { type: 'json' };
import { validateScript } from './script.js';

// A deep copy of the example script, so each test can break one thing.
function exampleCopy() {
  return structuredClone(example) as {
    steps: Array<Record<string, unknown> & { say: unknown[] }>;
  };
}

function errorsOf(input: unknown): string[] {
  const result = validateScript(input);
  if (result.ok) throw new Error('expected the script to be invalid');
  return result.errors;
}

describe('validateScript', () => {
  it('accepts the example script and returns it typed', () => {
    const result = validateScript(example);
    expect(result).toEqual({ ok: true, script: example });
  });

  it('requires exactly one of focus or card in a step', () => {
    const input = exampleCopy();
    input.steps[3] = { ...input.steps[3], card: { heading: 'Both', items: [] } } as never;
    expect(errorsOf(input)).toEqual([
      'steps[3] (id "controller-block"): must have exactly one of "focus" or "card", found both',
    ]);
  });

  it('rejects a repeated step id', () => {
    const input = exampleCopy();
    input.steps[2] = { ...input.steps[2], id: 'limiter-structure' } as never;
    expect(errorsOf(input)).toEqual([
      'steps[2] (id "limiter-structure") id: must be unique, already used by steps[1]',
    ]);
  });

  it('rejects a line range whose start is after its end', () => {
    const input = exampleCopy();
    const step = input.steps[1];
    input.steps[1] = {
      ...step,
      focus: { file: 'src/auth/rateLimiter.ts', lines: [10, 4] },
    } as never;
    expect(errorsOf(input)).toEqual([
      'steps[1] (id "limiter-structure") focus.lines: start must be <= end, got [10, 4]',
    ]);
    input.steps[1] = {
      ...step,
      focus: { file: 'src/auth/rateLimiter.ts', lines: [4, 4] },
    } as never;
    expect(validateScript(input).ok).toBe(true);
  });

  it('rejects a sentence with its own lines in a card step', () => {
    const input = exampleCopy();
    input.steps[0]?.say.push({ text: 'Look here.', lines: [1, 2] });
    expect(errorsOf(input)).toEqual([
      'steps[0] (id "overview") say[3].lines: only allowed in steps with "focus", this step has "card"',
    ]);
  });

  it('allows a path only in card steps, as a repository path without a trailing slash', () => {
    const input = exampleCopy();
    input.steps[1]?.say.push({ text: 'This folder.', path: 'src/auth' });
    const card = input.steps[0] as { card: { items: Array<{ path?: string }> } };
    if (card.card.items[0] === undefined) throw new Error('fixture changed');
    card.card.items[0].path = 'src/auth/';
    expect(errorsOf(input)).toEqual([
      'steps[0] (id "overview") card.items[0].path: must be a path from the root of the repository, like "src/auth" or "src/auth/login.ts", with no leading or trailing "/", got "src/auth/"',
      'steps[1] (id "limiter-structure") say[3].path: only allowed in steps with "card": the file of a step with "focus" is highlighted in the tree on its own',
    ]);
  });

  it('allows a note only in steps with focus', () => {
    const input = exampleCopy();
    input.steps[0] = { ...input.steps[0], note: 'Summary' } as never;
    expect(errorsOf(input)).toEqual([
      'steps[0] (id "overview") note: only allowed in steps with "focus", this step has "card"',
    ]);
  });

  it('rejects blank text', () => {
    const input = exampleCopy();
    input.steps[5] = { ...input.steps[5], title: '   ' } as never;
    expect(errorsOf(input)).toEqual([
      'steps[5] (id "config") title: must be a non-empty string, got "   "',
    ]);
  });
});
