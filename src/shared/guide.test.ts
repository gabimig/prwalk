import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateScript } from './script.js';

const guide = readFileSync(new URL('../../skill/GUIDE.md', import.meta.url), 'utf8');

describe('the agent guide', () => {
  it('shows an example script that is valid', () => {
    const example = /```json\n([\s\S]*?)\n```/.exec(guide)?.[1];
    expect(example).toBeDefined();
    expect(validateScript(JSON.parse(example ?? ''))).toMatchObject({ ok: true });
  });
});
