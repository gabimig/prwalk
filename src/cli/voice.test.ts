import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';

// These tests run the compiled binary; test/global-setup.ts builds it first.
const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const adapter = join(root, 'test', 'fixtures', 'voices', 'test-voice.mjs');
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    if (existsSync(join(home, 'daemon.json'))) prwalk(['stop'], home);
  }
});

function prwalk(args: string[], home: string) {
  const run = spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PRWALK_HOME: home, PRWALK_PORT: '0' },
  });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe('prwalk voice', { timeout: 30_000 }, () => {
  it('shows, checks, saves and tries the voice, and tells a running daemon', async () => {
    const home = tempDir();
    homes.push(home);
    expect(prwalk(['voice'], home)).toEqual({
      code: 0,
      stdout:
        'Voice: browser (the default). The user has not chosen a voice yet: keep it with prwalk voice use browser, or plug in another one (prwalk voice guide).\n',
      stderr: '',
    });

    const broken = join(tempDir(), 'broken.mjs');
    writeFileSync(broken, 'export default { name: "broken" };\n');
    const refused = prwalk(['voice', 'use', broken], home);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toBe(
      `The voice adapter ${broken} does not follow the contract: its default export has no synthesize function\n`,
    );
    expect(existsSync(join(home, 'config.json'))).toBe(false);

    prwalk(['open', '--patch', 'test/fixtures/example.diff'], home);
    const relative = join('test', 'fixtures', 'voices', 'test-voice.mjs');
    expect(prwalk(['voice', 'use', relative, '--option', 'failOn=FALLA'], home)).toEqual({
      code: 0,
      stdout: `Voice: test-voice (${adapter}). The viewer switches to it from the next sentence.\n`,
      stderr: '',
    });
    expect(JSON.parse(prwalk(['voice', '--json'], home).stdout)).toEqual({
      chosen: true,
      provider: adapter,
      options: { failOn: 'FALLA' },
    });

    const out = join(tempDir(), 'test.wav');
    const tried = prwalk(['voice', 'test', 'Hola.', '--lang', 'es', '--out', out], home);
    expect(tried.stdout).toMatch(
      new RegExp(
        `^Synthesized \\d+ bytes of audio/wav in \\d+ ms with test-voice\\. Saved to ${out}\\.\\n$`,
      ),
    );
    expect(readFileSync(out).subarray(0, 4).toString()).toBe('RIFF');
    expect(prwalk(['voice', 'test', 'Esto FALLA.'], home)).toMatchObject({
      code: 1,
      stderr: 'The voice adapter failed: refused "Esto FALLA."\n',
    });
    expect(prwalk(['voice', 'test', '--out', join(out, 'nope.wav')], home)).toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^Cannot save the audio to .*nope\.wav: /),
    });

    // The daemon synthesizes with the new adapter and status reports its failures.
    const { port, token } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
    const failed = await fetch(`http://127.0.0.1:${port}/api/tts`, {
      method: 'POST',
      headers: { 'x-prwalk-token': token },
      body: JSON.stringify({ text: 'Esto FALLA.', lang: 'es' }),
    });
    expect(failed.status).toBe(502);
    expect(prwalk(['status'], home).stdout).toContain(
      '\nVoice: test-voice is failing: refused "Esto FALLA."\n',
    );

    expect(prwalk(['voice', 'use', 'browser'], home).stdout).toBe(
      'Voice: browser. The viewer switches to it from the next sentence.\n',
    );
    expect(prwalk(['voice', 'test'], home).stdout).toBe(
      'The browser voice can only be heard in the viewer.\n',
    );
    expect(prwalk(['voice', 'guide'], home).stdout).toBe(
      readFileSync(join(root, 'skill', 'VOICES.md'), 'utf8').replaceAll(
        '{{examples}}',
        join(root, 'examples', 'voices'),
      ),
    );

    writeFileSync(join(home, 'config.json'), '{"voice":');
    expect(prwalk(['voice'], home)).toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/config\.json is not valid .* Fix it, or delete it/),
    });
  });
});

describe('prwalk voice list', () => {
  it('lists the installable voices, which are installed and the voice in use', () => {
    const home = tempDir();
    mkdirSync(join(home, 'voices', 'kokoro'), { recursive: true });
    writeFileSync(join(home, 'voices', 'kokoro', 'installed.json'), '{}');
    const listed = prwalk(['voice', 'list'], home);
    expect(listed.stdout).toMatch(
      /^kokoro \(installed\): .+ Speaks es, en\. Downloads about \d+ MB\.\n {2}Licences: .*Apache-2\.0.*GPL-3\.0.*\nVoice in use: browser \(not chosen yet\)\. Install one with prwalk voice install <name>\.\n$/,
    );
    expect(JSON.parse(prwalk(['voice', 'list', '--json'], home).stdout)).toMatchObject({
      voices: [{ name: 'kokoro', installed: true, languages: ['es', 'en'] }],
      voice: { chosen: false, provider: 'browser' },
    });
  });
});
