import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import example from '../../test/fixtures/example-script.json' with { type: 'json' };
import { git, repo, tempDir } from '../../test/git-repo.js';
import type { ServerMessage } from '../shared/protocol.js';

// These tests run the compiled binary; test/global-setup.ts builds it first.
const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
// Each test starts the binary several times, which is much slower on a CI runner than locally.
const processTests = { timeout: 30_000 };
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

const homes: string[] = [];
const sockets: WebSocket[] = [];
let blocker: Server | undefined;

// Never leave a daemon behind, even when a test fails half-way.
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const home of homes.splice(0)) {
    const stateFile = join(home, 'daemon.json');
    if (!existsSync(stateFile)) continue;
    const { pid } = JSON.parse(readFileSync(stateFile, 'utf8')) as { pid: number };
    try {
      process.kill(pid);
    } catch {}
  }
  blocker?.close();
  blocker = undefined;
});

function newHome(): string {
  const home = tempDir();
  homes.push(home);
  return home;
}

function prwalk(
  args: string[],
  { cwd, home, port = '0' }: { cwd?: string; home: string; port?: string },
) {
  const run = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PRWALK_HOME: home, PRWALK_PORT: port },
  });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

function featureRepo(): string {
  const dir = repo();
  git(dir, 'checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(dir, 'b.txt'), 'new\n');
  git(dir, 'add', 'b.txt');
  return dir;
}

describe('prwalk daemon lifecycle', processTests, () => {
  it('opens local changes, reports them, and stops cleanly', async () => {
    const cwd = featureRepo();
    const home = newHome();

    const open = prwalk(['open'], { cwd, home });
    expect(open.stderr).toBe('');
    const url = open.stdout.match(/Viewer: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
    expect(open.stdout).toBe(
      `Opened local changes on feature (base main): 2 files, +2 -0\nViewer: ${url}\n`,
    );
    expect(statSync(join(home, 'daemon.json')).mode & 0o777).toBe(0o600);

    const { pid } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number };
    expect(prwalk(['status'], { home })).toEqual({
      code: 0,
      stdout: `Daemon running at ${url} (pid ${pid})\nSession: local changes on feature (base main), 2 files\nViewers: 0\nPlayback: no script loaded\n`,
      stderr: '',
    });
    expect(JSON.parse(prwalk(['status', '--json'], { home }).stdout)).toMatchObject({
      running: true,
      url,
      session: { meta: { kind: 'local', title: 'feature' }, files: 2 },
    });

    expect(prwalk(['diff'], { home }).stdout).toBe(
      [
        'modified a.txt +1 -0',
        '  new 1-2, old 1-1',
        'added b.txt +1 -0',
        '  new 1-1, old none',
        '',
      ].join('\n'),
    );
    expect(prwalk(['diff', '--file', 'a.txt'], { home }).stdout).toBe(
      ['a.txt (modified, +1 -0)', '@@ -1,1 +1,2 @@', '1 1   one', '  2 + two', ''].join('\n'),
    );
    expect(JSON.parse(prwalk(['diff', '--file', 'a.txt', '--json'], { home }).stdout)).toEqual({
      path: 'a.txt',
      status: 'modified',
      binary: false,
      additions: 1,
      deletions: 0,
      hunks: [
        {
          header: '@@ -1,1 +1,2 @@',
          lines: [
            { type: 'context', old: 1, new: 1, text: 'one' },
            { type: 'addition', new: 2, text: 'two' },
          ],
        },
      ],
    });
    expect(prwalk(['diff', '--file', 'nope.txt'], { home })).toEqual({
      code: 1,
      stdout: '',
      stderr: '"nope.txt" is not in the diff. Files in the diff:\n  a.txt\n  b.txt\n',
    });

    expect(prwalk(['stop'], { home })).toEqual({
      code: 0,
      stdout: 'Daemon stopped.\n',
      stderr: '',
    });
    expect(existsSync(join(home, 'daemon.json'))).toBe(false);
    expect(prwalk(['status'], { home })).toEqual({
      code: 0,
      stdout: 'No daemon running.\n',
      stderr: '',
    });
  });

  it('asks for prwalk open when there is no session', () => {
    expect(prwalk(['diff'], { home: newHome() })).toEqual({
      code: 1,
      stdout: '',
      stderr: 'No walkthrough is open. Run prwalk open first.\n',
    });
  });

  it('prints errors as JSON on stdout with --json', () => {
    const run = prwalk(['diff', '--json'], { home: newHome() });
    expect(run).toEqual({ code: 1, stdout: expect.any(String), stderr: '' });
    expect(JSON.parse(run.stdout)).toEqual({
      ok: false,
      error: 'No walkthrough is open. Run prwalk open first.',
    });
  });

  it('warns that it reuses a running daemon when --port asks for another port', async () => {
    const cwd = featureRepo();
    const home = newHome();
    prwalk(['open'], { cwd, home });
    const { port } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as {
      port: number;
    };
    const other = String(port === 65535 ? port - 1 : port + 1);

    const reopen = prwalk(['open', '--port', other], { cwd, home });
    expect(reopen.code).toBe(0);
    expect(reopen.stderr).toBe(
      `A daemon is already running on port ${port}: reusing it instead of starting one on port ${other}.\n`,
    );
  });

  it('focuses a range for the viewers, and warns when no viewer is open', () => {
    const cwd = featureRepo();
    const home = newHome();
    const url = prwalk(['open'], { cwd, home }).stdout.match(/Viewer: (\S+)/)?.[1];

    expect(prwalk(['focus', 'a.txt', '--lines', '1', '--side', 'old'], { home })).toEqual({
      code: 0,
      stdout: 'Focused a.txt 1-1 (old side) (0 viewers)\n',
      stderr: `No viewer is open: open ${url} in a browser to see it.\n`,
    });
    expect(prwalk(['focus', 'a.txt', '--lines', '3-4'], { home })).toEqual({
      code: 1,
      stdout: '',
      stderr:
        'Lines 3-4 of a.txt are not inside one hunk of the new side. Ranges on the new side: 1-2.\n',
    });
    expect(prwalk(['focus', 'a.txt', '--lines', '2-1'], { home }).stderr).toBe(
      '--lines must be a range like 12-18 or one line like 12, starting at 1, got "2-1".\n',
    );
  });

  it('reports a daemon that cannot start because its port is taken', async () => {
    blocker = createServer();
    await new Promise<void>((resolve) => blocker?.listen(0, '127.0.0.1', resolve));
    const port = String((blocker.address() as { port: number }).port);

    const open = prwalk(['open'], { cwd: featureRepo(), home: newHome(), port });
    expect(open.code).toBe(1);
    expect(open.stderr).toBe(
      `The daemon could not start: port ${port} is already in use. Choose another one with --port or PRWALK_PORT.\n`,
    );
  });

  it('opens a patch file, plays a script on it and reports the playback', () => {
    const home = newHome();
    const script = fixture('example-script.json');
    expect(prwalk(['play', script], { home }).stderr).toBe(
      'No walkthrough is open. Run prwalk open first.\n',
    );

    expect(prwalk(['open', '482', '--patch', fixture('example.diff')], { home }).stderr).toBe(
      'Give a PR, --patch <file> or neither (local changes), not both.\n',
    );
    const open = prwalk(
      ['open', '--patch', fixture('example.diff'), '--title', 'Add login rate limit'],
      {
        home,
      },
    );
    const url = open.stdout.match(/Viewer: (\S+)/)?.[1];
    expect(open.stdout).toBe(
      `Opened patch "Add login rate limit": 4 files, +72 -4\nViewer: ${url}\n`,
    );

    expect(prwalk(['play', script], { home })).toEqual({
      code: 0,
      stdout: 'Loaded 8 steps (0 viewers). The viewer starts when the user presses Start.\n',
      stderr: `No viewer is open: open ${url} in a browser to see it.\n`,
    });
    expect(prwalk(['status'], { home }).stdout).toContain(
      'Playback: not started, step 1 of 8 "overview", sentence 1 of 3\n',
    );
    expect(JSON.parse(prwalk(['status', '--json'], { home }).stdout).playback).toEqual({
      status: 'idle',
      step: 1,
      steps: 8,
      id: 'overview',
      sentence: 1,
      sentences: 3,
    });

    const broken = structuredClone(example);
    broken.steps[2] = { ...broken.steps[2], title: '' } as never;
    broken.steps[3] = { ...broken.steps[3], focus: { file: 'nope.ts', lines: [0, 1] } } as never;
    const brokenFile = join(tempDir(), 'broken.json');
    writeFileSync(brokenFile, JSON.stringify(broken));
    const invalid = prwalk(['play', brokenFile], { home });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toBe(
      [
        'steps[2] (id "limiter-failures") title: must be a non-empty string, got ""',
        'steps[3] (id "controller-block") focus.lines[0]: line numbers start at 1',
        '',
      ].join('\n'),
    );

    expect(prwalk(['play', '--clear'], { home }).stdout).toBe('Script unloaded.\n');
    expect(prwalk(['status'], { home }).stdout).toContain('Playback: no script loaded\n');
  });
});

describe('prwalk live commands', processTests, () => {
  /** Like prwalk(), without blocking the event loop, so the fake viewer below can answer. */
  function prwalkAsync(args: string[], home: string) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [bin, ...args], {
        env: { ...process.env, PRWALK_HOME: home, PRWALK_PORT: '0' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  /**
   * A viewer on the WebSocket that applies orders to a position of its own and reports it back,
   * like the page does; `report` sends what the person in the page would cause.
   */
  async function fakeViewer(home: string) {
    const { port } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as {
      port: number;
    };
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://127.0.0.1:${port}`,
    });
    sockets.push(socket);
    const received: ServerMessage[] = [];
    let position = { status: 'idle', step: 0, sentence: 0 };
    let aside: { status: string; answers: number } | null = null;
    const report = (next: typeof position, cause: string) => {
      position = next;
      socket.send(JSON.stringify({ type: 'position', ...position, aside, cause }));
    };
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      received.push(message);
      if (message.type === 'say') {
        aside = { status: 'playing', answers: 1 };
        report({ ...position, status: 'paused' }, 'agent');
      } else if (message.type === 'command') {
        const { command } = message;
        aside = null;
        if (command.type === 'goto')
          report({ status: 'playing', step: command.step, sentence: 0 }, 'agent');
        else
          report({ ...position, status: command.type === 'pause' ? 'paused' : 'playing' }, 'agent');
      }
    });
    await new Promise((resolve) => socket.once('open', resolve));
    return { received, report };
  }

  it('drives the viewer: pause, status, say, goto, replace and wait', async () => {
    const home = newHome();
    prwalk(['open', '--patch', fixture('example.diff'), '--title', 'Example'], { home });
    prwalk(['play', fixture('example-script.json')], { home });
    const viewer = await fakeViewer(home);
    await expect.poll(() => viewer.received.length).toBe(2);

    viewer.report({ status: 'playing', step: 2, sentence: 0 }, 'user');
    expect(await prwalkAsync(['pause'], home)).toEqual({
      code: 0,
      stdout: 'Playback: paused, step 3 of 8 "limiter-failures", sentence 1 of 3\n',
      stderr: '',
    });
    const status = await prwalkAsync(['status'], home);
    expect(status.stdout).toContain(
      [
        'Playback: paused, step 3 of 8 "limiter-failures", sentence 1 of 3',
        'Sentence: "Aquí está la lógica central."',
        'Aside: none',
        'Events:',
        '  user jumped from step 1 "overview" to step 3 "limiter-failures", sentence 1',
        '  agent paused at step 3 "limiter-failures", sentence 1',
        '',
      ].join('\n'),
    );

    const say = await prwalkAsync(
      [
        'say',
        'Sí. Falla.',
        '--question',
        '¿Y si falla?',
        '--file',
        'src/config/auth.ts',
        '--lines',
        '6-7',
      ],
      home,
    );
    expect(say.stdout).toBe(
      'Answer sent to the viewer. Run prwalk wait to know when it has been said.\n',
    );
    expect(viewer.received.at(-1)).toEqual({
      type: 'say',
      answer: {
        text: 'Sí. Falla.',
        question: '¿Y si falla?',
        focus: { file: 'src/config/auth.ts', side: 'new', lines: [6, 7] },
        resume: false,
      },
    });
    expect((await prwalkAsync(['status'], home)).stdout).toContain(
      'Aside: playing, 1 answer to say\nEvents: none\n',
    );

    expect((await prwalkAsync(['goto', '1'], home)).stdout).toBe(
      'Playback: playing, step 1 of 8 "overview", sentence 1 of 3\n',
    );
    const badStep = await prwalkAsync(['goto', '99'], home);
    expect(badStep.code).toBe(1);
    expect(badStep.stderr).toMatch(
      /^There is no step "99"\. Give a step id or number: 1 "overview", /,
    );

    const steps = join(tempDir(), 'steps.json');
    const newSteps = example.steps.slice(6).map((step) => ({ ...step, id: `${step.id}-again` }));
    writeFileSync(steps, JSON.stringify(newSteps));
    expect((await prwalkAsync(['replace', '--from', '7', steps], home)).stdout).toBe(
      'Replaced the steps from 7 on: the script has 8 steps now (1 viewer).\n',
    );
    expect(viewer.received.at(-1)).toMatchObject({ type: 'replace', from: 6 });

    await prwalkAsync(['status'], home);
    const waiting = prwalkAsync(['wait', '--timeout', '10'], home);
    await new Promise((resolve) => setTimeout(resolve, 300));
    viewer.report({ status: 'paused', step: 0, sentence: 0 }, 'user');
    const waited = await waiting;
    expect(waited.code).toBe(0);
    expect(waited.stdout).toContain('Events:\n  user paused at step 1 "overview", sentence 1\n');
    expect((await prwalkAsync(['wait', '--timeout', '0'], home)).stdout).toMatch(
      /^Nothing happened within 0 s\.\nDaemon running/,
    );
  });

  it('accepts orders before the user presses Start, and says that nothing plays until then', async () => {
    const home = newHome();
    prwalk(['open', '--patch', fixture('example.diff')], { home });
    prwalk(['play', fixture('example-script.json')], { home });
    const { port } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as {
      port: number;
    };
    // Like the page before Start: a jump only moves where Start begins; the rest waits.
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://127.0.0.1:${port}`,
    });
    sockets.push(socket);
    let step = 0;
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === 'command' && message.command.type === 'goto')
        step = message.command.step;
      if (message.type !== 'command' && message.type !== 'say') return;
      socket.send(
        JSON.stringify({ type: 'position', status: 'idle', step, sentence: 0, cause: 'agent' }),
      );
    });
    await new Promise((resolve) => socket.once('open', resolve));

    const waiting =
      'The viewer is waiting for the user to press Start: nothing is said until then.';
    expect((await prwalkAsync(['goto', '3'], home)).stdout).toBe(
      `Playback: not started, step 3 of 8 "limiter-failures", sentence 1 of 3\n${waiting}\n`,
    );
    expect((await prwalkAsync(['say', 'Sí.'], home)).stdout).toBe(
      `Answer sent to the viewer. Run prwalk wait to know when it has been said.\n${waiting}\n`,
    );
  });

  it('prints every error of an invalid script as a list with --json', () => {
    const home = newHome();
    prwalk(['open', '--patch', fixture('example.diff')], { home });
    const broken = join(tempDir(), 'broken.json');
    writeFileSync(broken, JSON.stringify({ ...example, steps: [{ id: 'X' }, { id: 'y' }] }));
    const run = prwalk(['play', broken, '--json'], { home });
    expect(run.code).toBe(1);
    const body = JSON.parse(run.stdout);
    expect(body.errors).toHaveLength(body.error.split('\n').length);
    expect(body.errors.length).toBeGreaterThan(1);
  });
});
