import { z } from 'zod';

/**
 * The walkthrough script an agent hands to prwalk: what to show and what to say, step by step.
 * This module checks structure only; whether files and lines exist in the diff is checked elsewhere.
 */

const text = z.string().refine((value) => value.trim() !== '', {
  error: (issue) => `must be a non-empty string, got ${JSON.stringify(issue.input)}`,
});

const lineNumber = z.int().min(1, { error: 'line numbers start at 1' });

const lineRange = z.tuple([lineNumber, lineNumber]).refine(([start, end]) => start <= end, {
  error: (issue) => {
    const [start, end] = issue.input as [number, number];
    return `start must be <= end, got [${start}, ${end}]`;
  },
});

const side = z.enum(['new', 'old']);

export const focusSchema = z.strictObject({
  file: text,
  side: side.optional(),
  lines: lineRange,
});

/** A file or folder of the repository, like "src/auth": what a card points at in the file tree. */
const repoPath = z.string().refine(isRepoPath, {
  error: (issue) =>
    `must be a path from the root of the repository, like "src/auth" or "src/auth/login.ts", with no leading or trailing "/", got ${JSON.stringify(issue.input)}`,
});

const cardSchema = z.strictObject({
  heading: text,
  lead: text.optional(),
  items: z.array(z.strictObject({ title: text, text: text.optional(), path: repoPath.optional() })),
});

const sentenceSchema = z.union(
  [
    text,
    z.strictObject({
      text,
      lines: lineRange.optional(),
      side: side.optional(),
      path: repoPath.optional(),
    }),
  ],
  { error: 'must be a string or an object like { "text": "...", "lines": [start, end] }' },
);

const stepSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      error: 'must use only lowercase letters, digits and single hyphens, like "controller-block"',
    }),
    title: text,
    /** A short label shown next to the file name, like "Where it is enforced". */
    note: text.optional(),
    focus: focusSchema.optional(),
    card: cardSchema.optional(),
    say: z.array(sentenceSchema).min(1, { error: 'must have at least one sentence' }),
  })
  .superRefine((step, ctx) => {
    if ((step.focus === undefined) === (step.card === undefined)) {
      const found = step.focus === undefined ? 'neither' : 'both';
      ctx.addIssue({
        code: 'custom',
        message: `must have exactly one of "focus" or "card", found ${found}`,
      });
      return;
    }
    if (step.card === undefined) {
      step.say.forEach((sentence, index) => {
        if (typeof sentence !== 'string' && sentence.path !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['say', index, 'path'],
            message:
              'only allowed in steps with "card": the file of a step with "focus" is highlighted in the tree on its own',
          });
        }
      });
      return;
    }
    if (step.note !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'only allowed in steps with "focus", this step has "card"',
      });
    }
    step.say.forEach((sentence, index) => {
      if (typeof sentence !== 'string' && sentence.lines !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['say', index, 'lines'],
          message: 'only allowed in steps with "focus", this step has "card"',
        });
      }
    });
  });

const scriptSchema = z
  .strictObject({
    version: z.literal(1),
    lang: z.string().refine(isLanguageTag, {
      error: (issue) =>
        `must be a BCP-47 language tag like "es" or "en-GB", got ${JSON.stringify(issue.input)}`,
    }),
    level: z.enum(['overview', 'key-files', 'full']),
    steps: z.array(stepSchema).min(1, { error: 'must have at least one step' }),
  })
  .superRefine((script, ctx) => {
    const firstUse = new Map<string, number>();
    script.steps.forEach((step, index) => {
      const previous = firstUse.get(step.id);
      if (previous === undefined) {
        firstUse.set(step.id, index);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['steps', index, 'id'],
        message: `must be unique, already used by steps[${previous}]`,
      });
    });
  });

export type Script = z.infer<typeof scriptSchema>;
export type Step = Script['steps'][number];
export type Focus = NonNullable<Step['focus']>;
export type Card = NonNullable<Step['card']>;
export type Sentence = Step['say'][number];

export type ValidationResult = { ok: true; script: Script } | { ok: false; errors: string[] };

export function validateScript(input: unknown): ValidationResult {
  const result = scriptSchema.safeParse(input, { reportInput: true });
  if (result.success) return { ok: true, script: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${describePath(issue.path, input)}: ${issue.message}`,
    ),
  };
}

function isRepoPath(value: string): boolean {
  return (
    !value.includes('\\') &&
    value.split('/').every((segment) => segment.trim() !== '' && segment !== '.' && segment !== '..')
  );
}

function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** Turns ["steps", 3, "focus", "lines"] into `steps[3] (id "controller-block") focus.lines`. */
export function describePath(path: PropertyKey[], input: unknown): string {
  if (path.length === 0) return 'script';
  const [head, index, ...rest] = path;
  if (head === 'steps' && typeof index === 'number') {
    const id = stepIdOf(input, index);
    const step =
      id === undefined ? `steps[${index}]` : `steps[${index}] (id ${JSON.stringify(id)})`;
    return rest.length === 0 ? step : `${step} ${joinPath(rest)}`;
  }
  return joinPath(path);
}

function joinPath(path: PropertyKey[]): string {
  return path
    .map((key, i) => (typeof key === 'number' ? `[${key}]` : `${i === 0 ? '' : '.'}${String(key)}`))
    .join('');
}

function stepIdOf(input: unknown, index: number): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const steps = (input as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return undefined;
  const id = (steps[index] as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' ? id : undefined;
}
