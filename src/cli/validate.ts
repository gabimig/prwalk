import { readFileSync } from 'node:fs';
import { validateScript } from '../shared/script.js';

type Outcome =
  | { ok: true; summary: Record<string, unknown>; line: string }
  | { ok: false; errors: string[] };

/** `prwalk validate <file | ->`: checks a script and reports the result. Returns the exit code. */
export function validateCommand(source: string, options: { json?: boolean }): number {
  const outcome = check(source);
  if (options.json) {
    const body = outcome.ok
      ? { ok: true, ...outcome.summary }
      : { ok: false, errors: outcome.errors };
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } else if (outcome.ok) {
    process.stdout.write(`${outcome.line}\n`);
  } else {
    process.stderr.write(outcome.errors.map((error) => `${error}\n`).join(''));
  }
  return outcome.ok ? 0 : 1;
}

function check(source: string): Outcome {
  const read = readScriptInput(source);
  if (!read.ok) return read;
  const result = validateScript(read.input);
  if (!result.ok) return { ok: false, errors: result.errors };
  const { level, lang, steps } = result.script;
  return {
    ok: true,
    summary: { steps: steps.length, level, lang },
    line: `OK: ${steps.length} steps, level ${level}, lang ${lang}`,
  };
}

/** The JSON in a script file, or in stdin for `-`, not validated yet. */
export function readScriptInput(
  source: string,
): { ok: true; input: unknown } | { ok: false; errors: string[] } {
  const label = source === '-' ? 'stdin' : source;

  let raw: string;
  try {
    raw = readFileSync(source === '-' ? 0 : source, 'utf8');
  } catch (error) {
    return { ok: false, errors: [`cannot read "${label}": ${messageOf(error)}`] };
  }

  try {
    return { ok: true, input: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, errors: [`${label} is not valid JSON: ${messageOf(error)}`] };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
