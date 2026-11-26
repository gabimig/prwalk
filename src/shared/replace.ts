import { checkScriptAgainstDiff } from './check-script.js';
import type { DiffIndex } from './diff.js';
import type { PlaybackState } from './playback.js';
import { type Script, type ValidationResult, validateScript } from './script.js';

/**
 * `prwalk replace`: the script with its steps from index `from` on replaced by `steps` (not
 * validated yet, in the format of a script's `steps`). The whole result is validated and checked
 * against the diff; on any error nothing changes and every error is returned.
 */
export function replaceSteps(
  script: Script,
  from: number,
  steps: unknown,
  index: DiffIndex,
): ValidationResult {
  const merged = Array.isArray(steps) ? [...script.steps.slice(0, from), ...steps] : steps;
  const result = validateScript({ ...script, steps: merged });
  if (!result.ok) return result;
  const errors = checkScriptAgainstDiff(result.script, index);
  return errors.length > 0 ? { ok: false, errors } : result;
}

/**
 * Where playback goes once the steps from `from` on have been replaced: nowhere if it is on an
 * earlier step; else paused at the start of step `from`, or finished on the last step when the
 * script got shorter than that.
 */
export function positionAfterReplace(
  position: PlaybackState,
  from: number,
  script: Script,
): PlaybackState {
  if (position.step < from) return position;
  if (from < script.steps.length) return { status: 'paused', step: from, sentence: 0 };
  const step = script.steps.length - 1;
  const sentences = script.steps[step]?.say.length ?? 1;
  return { status: 'finished', step, sentence: sentences - 1 };
}

/** The index of the step named by `ref`: its id, or its number counted from 1. */
export function resolveStep(script: Script, ref: string): number | undefined {
  const byId = script.steps.findIndex(({ id }) => id === ref);
  if (byId !== -1) return byId;
  if (!/^\d+$/.test(ref)) return undefined;
  const number = Number(ref);
  return number >= 1 && number <= script.steps.length ? number - 1 : undefined;
}

/** The steps as a person names them, for error messages: `1 "overview", 2 "config"`. */
export function listSteps(script: Script): string {
  return script.steps.map(({ id }, index) => `${index + 1} ${JSON.stringify(id)}`).join(', ');
}
