import { type Script, validateScript } from '../../../src/shared/script.js';
import example from '../../../test/fixtures/example-script.json' with { type: 'json' };

/** The example walkthrough, validated and typed, for the viewer's unit tests. */
export function exampleScript(): Script {
  const result = validateScript(structuredClone(example));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.script;
}
