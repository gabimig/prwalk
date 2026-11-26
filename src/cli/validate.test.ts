import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import example from '../../test/fixtures/example-script.json' with { type: 'json' };

// These tests run the compiled binary; test/global-setup.ts builds it first.
const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const exampleFile = fileURLToPath(
  new URL('../../test/fixtures/example-script.json', import.meta.url),
);

function prwalk(args: string[], stdin?: string) {
  const run = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input: stdin });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

function brokenScriptFile(): string {
  const broken = structuredClone(example);
  broken.steps[1] = { ...broken.steps[1], card: { heading: 'Both', items: [] } } as never;
  const file = join(mkdtempSync(join(tmpdir(), 'prwalk-')), 'broken.json');
  writeFileSync(file, JSON.stringify(broken));
  return file;
}

const brokenStepError =
  'steps[1] (id "limiter-structure"): must have exactly one of "focus" or "card", found both';

describe('prwalk validate', () => {
  it('accepts a valid script with a one-line summary and exit code 0', () => {
    expect(prwalk(['validate', exampleFile])).toEqual({
      code: 0,
      stdout: 'OK: 8 steps, level key-files, lang es\n',
      stderr: '',
    });
  });

  it('rejects an invalid script with its errors on stderr and exit code 1', () => {
    expect(prwalk(['validate', brokenScriptFile()])).toEqual({
      code: 1,
      stdout: '',
      stderr: `${brokenStepError}\n`,
    });
  });

  it('prints the errors as JSON on stdout with --json', () => {
    const run = prwalk(['validate', '--json', brokenScriptFile()]);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toEqual({ ok: false, errors: [brokenStepError] });
  });

  it('reports a file it cannot read without a stack trace', () => {
    const run = prwalk(['validate', 'missing.json']);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/^cannot read "missing\.json": ENOENT[^\n]*\n$/);
  });

  it('reports malformed JSON read from stdin without a stack trace', () => {
    const run = prwalk(['validate', '-'], '{ "version": 1,');
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/^stdin is not valid JSON: [^\n]*\n$/);
  });
});
