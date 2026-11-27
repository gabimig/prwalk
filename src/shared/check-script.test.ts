import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import example from '../../test/fixtures/example-script.json' with { type: 'json' };
import { checkScriptAgainstDiff } from './check-script.js';
import { buildDiffIndex } from './diff.js';
import { type Script, validateScript } from './script.js';

const fixture = (name: string) =>
  buildDiffIndex(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'));
const index = fixture('example.diff');

function exampleScript(): Script {
  const result = validateScript(structuredClone(example));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.script;
}

describe('checkScriptAgainstDiff', () => {
  it('accepts the example script against the example diff', () => {
    expect(checkScriptAgainstDiff(exampleScript(), index)).toEqual([]);
  });

  it('reports every step focus and sentence range the diff cannot show', () => {
    const script = exampleScript();
    const config = script.steps[5];
    const controller = script.steps[4];
    const block = script.steps[3];
    if (config?.focus === undefined || controller === undefined || block?.focus === undefined) {
      throw new Error('fixture changed');
    }
    config.focus = { file: 'src/config/missing.ts', lines: [1, 2] };
    controller.say[1] = { text: 'Out of the hunk.', lines: [40, 41] };
    // A sentence's range is checked on its step's side: lines 25-26 exist only on the new one.
    block.focus = { ...block.focus, side: 'old' };
    block.say[1] = { text: 'Only on the new side.', lines: [25, 26] };

    expect(checkScriptAgainstDiff(script, index)).toEqual([
      'steps[3] (id "controller-block") say[1].lines: Lines 25-26 of src/auth/loginController.ts are not inside one hunk of the old side. Ranges on the old side: 12-22.',
      'steps[4] (id "controller-failure-success") say[1].lines: Lines 40-41 of src/auth/loginController.ts are not inside one hunk of the new side. Ranges on the new side: 12-29.',
      'steps[5] (id "config") focus: "src/config/missing.ts" is not in the diff. Files in the diff: src/auth/rateLimiter.ts, src/auth/loginController.ts, src/config/auth.ts, test/auth/rateLimiter.test.ts',
    ]);
  });

  it('reports a card path that names no file or folder of the diff, with similar ones', () => {
    const script = exampleScript();
    const overview = script.steps[0];
    if (overview?.card === undefined) throw new Error('fixture changed');
    overview.card.items[0] = { title: 'Auth', path: 'src/aut' };
    overview.say[2] = { text: 'And the tests.', path: 'tests' };

    expect(checkScriptAgainstDiff(script, index)).toEqual([
      'steps[0] (id "overview") card.items[0].path: "src/aut" is not a file or folder of the diff. Similar paths: src/auth, src, test/auth',
      'steps[0] (id "overview") say[2].path: "tests" is not a file or folder of the diff. Similar paths: test, src, test/auth',
    ]);
  });

  it('accepts a card path that is a folder of the diff, or the old path of a renamed file', () => {
    const result = validateScript({
      version: 1,
      lang: 'en',
      level: 'overview',
      steps: [
        {
          id: 'summary',
          title: 'Summary',
          card: { heading: 'What changes', items: [{ title: 'Sources', path: 'src' }] },
          say: [{ text: 'The file that was renamed.', path: 'src/name.ts' }],
        },
      ],
    });
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(checkScriptAgainstDiff(result.script, fixture('sample.diff'))).toEqual([]);
  });
});
