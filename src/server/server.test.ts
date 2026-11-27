import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import example from '../../test/fixtures/example-script.json' with { type: 'json' };
import { tempDir } from '../../test/git-repo.js';
import { buildDiffIndex } from '../shared/diff.js';
import type { ServerMessage } from '../shared/protocol.js';
import type { SessionInput } from '../shared/session.js';
import { type RunningServer, type ServerOptions, startServer } from './server.js';

const patch = readFileSync(new URL('../../test/fixtures/sample.diff', import.meta.url), 'utf8');
const TOKEN = 'test-token';

const input: SessionInput = {
  meta: { kind: 'local', title: 'feature', headRef: 'feature', baseRef: 'main' },
  patch,
};

let server: RunningServer | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.close();
  server = undefined;
});

async function start(
  options: Partial<Omit<ServerOptions, 'port' | 'token'>> = {},
): Promise<RunningServer> {
  server = await startServer({ port: 0, token: TOKEN, ...options });
  return server;
}

type Reply = { status: number; type: string | undefined; body: string };

function call(
  { port }: RunningServer,
  method: string,
  path: string,
  { body, token, host }: { body?: string; token?: string; host?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: host ?? `127.0.0.1:${port}` };
    if (token !== undefined) headers['x-prwalk-token'] = token;
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: text }),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}

function putSession(running: RunningServer, session: SessionInput): Promise<Reply> {
  return call(running, 'PUT', '/api/session', { body: JSON.stringify(session), token: TOKEN });
}

function postFocus(running: RunningServer, focus: unknown): Promise<Reply> {
  return call(running, 'POST', '/api/focus', { body: JSON.stringify({ focus }), token: TOKEN });
}

/** A viewer connected to `/ws`, with the messages it has received so far. */
type Viewer = { socket: WebSocket; next(): Promise<ServerMessage> };

function connect(
  { port }: RunningServer,
  { origin, path = '/ws' }: { origin?: string; path?: string } = {},
): Promise<Viewer> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    origin: origin ?? `http://127.0.0.1:${port}`,
  });
  sockets.push(socket);
  const received: ServerMessage[] = [];
  const waiting: ((message: ServerMessage) => void)[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as ServerMessage;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else received.push(message);
  });
  const next = () => {
    const message = received.shift();
    return message
      ? Promise.resolve(message)
      : new Promise<ServerMessage>((resolve) => waiting.push(resolve));
  };
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve({ socket, next }));
    socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    socket.once('error', reject);
  });
}

const focus = { file: 'src/limit.ts', side: 'new', lines: [13, 15] };

describe('daemon server', () => {
  it('rejects a request whose Host is not the loopback address', async () => {
    const running = await start();
    const reply = await call(running, 'GET', '/api/health', {
      host: `evil.example:${running.port}`,
    });
    expect(reply.status).toBe(403);
  });

  it('rejects a change without the token', async () => {
    const running = await start();
    const reply = await call(running, 'PUT', '/api/session', { body: JSON.stringify(input) });
    expect(reply.status).toBe(401);
  });

  it('stores a session, serves its index and its diff, and replaces it on the next open', async () => {
    const running = await start();
    const next: SessionInput = {
      meta: { kind: 'local', title: 'other', headRef: 'other', baseRef: 'main' },
      patch: 'diff --git a/c.txt b/c.txt\n--- a/c.txt\n+++ b/c.txt\n@@ -1 +1 @@\n-old\n+new\n',
    };

    for (const session of [input, next]) {
      expect(await putSession(running, session)).toMatchObject({ status: 200 });
      const view = await call(running, 'GET', '/api/session');
      expect(JSON.parse(view.body)).toEqual({
        meta: session.meta,
        index: buildDiffIndex(session.patch),
        viewers: 0,
      });
      expect(await call(running, 'GET', '/api/diff')).toEqual({
        status: 200,
        type: 'text/plain; charset=utf-8',
        body: session.patch,
      });
    }
  });

  it('answers 404 when there is no session', async () => {
    const running = await start();
    expect((await call(running, 'GET', '/api/session')).status).toBe(404);
  });

  it('rejects a session that is not valid JSON with the shape it expects', async () => {
    const running = await start();
    const reply = await call(running, 'PUT', '/api/session', { body: '{"meta": {}', token: TOKEN });
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toMatch(/^invalid session: /);
  });

  it('rejects a body over the size limit', async () => {
    const running = await start({ maxBodyBytes: 100 });
    expect((await putSession(running, input)).status).toBe(413);
  });

  it('fails clearly when the port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as { port: number };
    try {
      await expect(startServer({ port, token: TOKEN })).rejects.toThrow(
        `port ${port} is already in use. Choose another one with --port or PRWALK_PORT.`,
      );
    } finally {
      blocker.close();
    }
  });
});

describe('viewer connection', () => {
  it('refuses a WebSocket opened by a page from another origin', async () => {
    const running = await start();
    await expect(connect(running, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
    await expect(connect(running, { path: '/other' })).rejects.toThrow('HTTP 404');
  });

  it('drops a viewer that sends an oversized message and keeps serving', async () => {
    const running = await start();
    const { socket } = await connect(running);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send('x'.repeat(100 * 1024));
    expect(await closed).toBe(1009);
    expect((await call(running, 'GET', '/api/health')).status).toBe(200);
  });

  it('rejects a focus body that is not the shape it expects', async () => {
    const running = await start();
    await putSession(running, input);
    const reply = await call(running, 'POST', '/api/focus', {
      body: '{"focus": {"file": "src/limit.ts"}}',
      token: TOKEN,
    });
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toMatch(/^invalid focus: /);
  });

  it('sends a valid focus to every viewer and says how many there are', async () => {
    const running = await start();
    await putSession(running, input);
    const viewers = [await connect(running), await connect(running)];
    for (const viewer of viewers)
      expect(await viewer.next()).toEqual({ type: 'focus', focus: null });

    expect(await postFocus(running, focus)).toMatchObject({ status: 200 });
    for (const viewer of viewers) expect(await viewer.next()).toEqual({ type: 'focus', focus });
    expect(JSON.parse((await call(running, 'GET', '/api/session')).body).viewers).toBe(2);
  });

  it('answers 422 to a focus outside the diff and sends it to nobody', async () => {
    const running = await start();
    await putSession(running, input);
    const viewer = await connect(running);
    await viewer.next();

    const reply = await postFocus(running, { ...focus, lines: [7, 9] });
    expect(reply.status).toBe(422);
    expect(JSON.parse(reply.body).error).toMatch(/^Lines 7-9 of src\/limit\.ts are not inside/);
    await postFocus(running, null);
    expect(await viewer.next()).toEqual({ type: 'focus', focus: null });
  });

  it('gives a viewer that connects the focus already set', async () => {
    const running = await start();
    await putSession(running, input);
    await postFocus(running, focus);
    expect(await (await connect(running)).next()).toEqual({ type: 'focus', focus });
  });

  it('clears the focus when a new session opens', async () => {
    const running = await start();
    await putSession(running, input);
    await postFocus(running, focus);
    const viewer = await connect(running);
    await viewer.next();

    await putSession(running, input);
    expect(await viewer.next()).toEqual({ type: 'session' });
    expect(await (await connect(running)).next()).toEqual({ type: 'focus', focus: null });
  });
});

describe('newer version', () => {
  it('checks at start and on every open, tells the viewers, and gives one that connects the last answer', async () => {
    const answers = [undefined, { current: '0.1.2', latest: '0.2.0' }];
    let checks = 0;
    const running = await start({ checkUpdate: async () => answers[checks++] });
    const viewer = await connect(running);
    expect(await viewer.next()).toEqual({ type: 'focus', focus: null });

    await putSession(running, input);
    expect(await viewer.next()).toEqual({ type: 'session' });
    const update = { type: 'update', update: { current: '0.1.2', latest: '0.2.0' } };
    expect(await viewer.next()).toEqual(update);
    expect(checks).toBe(2);

    const later = await connect(running);
    expect([await later.next(), await later.next()]).toEqual([
      { type: 'focus', focus: null },
      update,
    ]);
  });
});

describe('idle shutdown', () => {
  /** A server that shuts down after `idleMs` alone; `idled()` says whether it has. */
  async function idleServer(idleMs: number) {
    let idled = false;
    const running = await start({
      idleMs,
      onIdle: () => {
        idled = true;
      },
    });
    return { running, idled: () => idled };
  }

  it('shuts down once it has had no viewer and no request for the idle time', async () => {
    const { running, idled } = await idleServer(100);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await call(running, 'GET', '/api/health');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(idled()).toBe(false);

    await expect.poll(idled).toBe(true);
    await expect(call(running, 'GET', '/api/health')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('does not shut down while a viewer is connected', async () => {
    const { running, idled } = await idleServer(50);
    const viewer = await connect(running);
    await call(running, 'GET', '/api/health');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(idled()).toBe(false);

    viewer.socket.close();
    await expect.poll(idled).toBe(true);
  });
});

describe('viewer files', () => {
  it('serves the built viewer and nothing outside its folder', async () => {
    const dir = tempDir();
    const webRoot = join(dir, 'web');
    mkdirSync(webRoot);
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>viewer</title>');
    writeFileSync(join(dir, 'secret.js'), 'secret');
    const running = await start({ webRoot });

    expect(await call(running, 'GET', '/')).toMatchObject({
      status: 200,
      type: 'text/html; charset=utf-8',
      body: '<!doctype html><title>viewer</title>',
    });
    const outside = await call(running, 'GET', '/..%2fsecret.js');
    expect(outside.status).toBe(404);
    expect(outside.body).not.toContain('secret');
    expect((await call(running, 'GET', '/%E0%A4%A')).status).toBe(404);
  });

  it('serves the viewer with a policy that only lets it run and connect to its own origin', async () => {
    const running = await start();
    const reply = await fetch(`http://127.0.0.1:${running.port}/`);
    const policy = reply.headers.get('content-security-policy') ?? '';
    const directives = Object.fromEntries(
      policy.split(';').map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toMatchObject({
      'default-src': "'none'",
      'script-src': "'self'",
      'connect-src': `'self' ws://127.0.0.1:${running.port} ws://localhost:${running.port}`,
    });
  });

  it('explains how to build the viewer when it is missing', async () => {
    const running = await start({ webRoot: join(tempDir(), 'missing') });
    const reply = await call(running, 'GET', '/');
    expect(reply.status).toBe(503);
    expect(reply.body).toContain('pnpm build');
  });
});

describe('script playback', () => {
  const examplePatch = readFileSync(
    new URL('../../test/fixtures/example.diff', import.meta.url),
    'utf8',
  );
  const exampleSession: SessionInput = {
    meta: { kind: 'patch', title: 'Add login rate limit', headRef: '', baseRef: '' },
    patch: examplePatch,
  };
  const start0 = { status: 'idle', step: 0, sentence: 0 };

  function putScript(running: RunningServer, script: unknown): Promise<Reply> {
    return call(running, 'PUT', '/api/script', { body: JSON.stringify(script), token: TOKEN });
  }

  async function playbackOf(running: RunningServer): Promise<unknown> {
    return JSON.parse((await call(running, 'GET', '/api/session')).body).playback;
  }

  /** Resolves once the server has read everything `socket` sent before it. */
  function flushed(socket: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      socket.once('pong', () => resolve());
      socket.ping();
    });
  }

  async function withScript(): Promise<RunningServer> {
    const running = await start();
    await putSession(running, exampleSession);
    expect((await putScript(running, example)).status).toBe(200);
    return running;
  }

  it('answers 409 without a session, 400 to bad JSON and 422 with every error the diff causes', async () => {
    const running = await start();
    expect((await putScript(running, example)).status).toBe(409);
    await putSession(running, exampleSession);
    const notJson = await call(running, 'PUT', '/api/script', { body: '{', token: TOKEN });
    expect(notJson.status).toBe(400);

    const broken = structuredClone(example);
    broken.steps[1] = { ...broken.steps[1], focus: { file: 'nope.ts', lines: [1, 1] } } as never;
    broken.steps[5] = { ...broken.steps[5], focus: { file: 'nope.ts', lines: [1, 1] } } as never;
    const reply = await putScript(running, broken);
    expect(reply.status).toBe(422);
    expect(JSON.parse(reply.body).errors).toEqual([
      expect.stringMatching(/^steps\[1\] \(id "limiter-structure"\) focus: "nope\.ts" is not/),
      expect.stringMatching(/^steps\[5\] \(id "config"\) focus: "nope\.ts" is not/),
    ]);
    expect((await call(running, 'GET', '/api/script')).status).toBe(404);
  });

  it('stores a valid script from position zero, sends it to the viewer, and unloads it', async () => {
    const running = await start();
    await putSession(running, exampleSession);
    await postFocus(running, { file: 'src/config/auth.ts', lines: [6, 7] });
    const viewer = await connect(running);
    await viewer.next();

    const reply = await putScript(running, example);
    expect(JSON.parse(reply.body)).toEqual({ steps: 8, viewers: 1 });
    expect(await viewer.next()).toEqual({ type: 'script', script: example, position: start0 });
    expect(JSON.parse((await call(running, 'GET', '/api/script')).body)).toEqual(example);
    expect(await playbackOf(running)).toEqual(start0);
    const latest = await connect(running);
    expect(await latest.next()).toEqual({ type: 'focus', focus: null });
    await latest.next();

    await call(running, 'DELETE', '/api/script', { token: TOKEN });
    expect((await call(running, 'GET', '/api/script')).status).toBe(404);
    expect(await latest.next()).toEqual({ type: 'script', script: null, position: null });
    expect(await playbackOf(running)).toBeUndefined();
  });

  it('keeps the position the viewer reports and pauses it when the active viewer changes', async () => {
    const running = await withScript();
    const viewer = await connect(running);
    await viewer.next();
    await viewer.next();

    const playing = { status: 'playing', step: 3, sentence: 1 };
    viewer.socket.send(JSON.stringify({ type: 'position', ...playing }));
    await expect.poll(() => playbackOf(running)).toEqual(playing);

    const paused = { ...playing, status: 'paused' };
    const next = await connect(running);
    expect(await next.next()).toEqual({ type: 'focus', focus: null });
    expect(await next.next()).toEqual({ type: 'script', script: example, position: paused });
    expect(await playbackOf(running)).toEqual(paused);

    next.socket.send(JSON.stringify({ type: 'position', ...playing }));
    await expect.poll(() => playbackOf(running)).toEqual(playing);
    next.socket.close();
    await expect.poll(() => playbackOf(running)).toEqual(paused);
  });

  it('ignores a malformed or out-of-range position message and keeps the connection', async () => {
    const running = await withScript();
    const viewer = await connect(running);
    for (const bad of [
      'not json',
      '{"x":1}',
      '{"type":"position","status":"paused","step":-1,"sentence":0}',
      '{"type":"position","status":"paused","step":99,"sentence":0}',
      '{"type":"position","status":"paused","step":0,"sentence":3}',
    ]) {
      viewer.socket.send(bad);
    }
    await flushed(viewer.socket);
    expect(await playbackOf(running)).toEqual(start0);

    viewer.socket.send(
      JSON.stringify({ type: 'position', status: 'paused', step: 2, sentence: 0 }),
    );
    await expect
      .poll(() => playbackOf(running))
      .toEqual({ status: 'paused', step: 2, sentence: 0 });
    expect(viewer.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('supersedes the previous viewer when another one connects and ignores its position', async () => {
    const running = await withScript();
    const first = await connect(running);
    await first.next();
    await first.next();

    await connect(running);
    expect(await first.next()).toEqual({ type: 'superseded' });
    first.socket.send(
      JSON.stringify({ type: 'position', status: 'playing', step: 5, sentence: 0 }),
    );
    await flushed(first.socket);
    expect(await playbackOf(running)).toEqual(start0);
  });

  it('hands over to the viewer still open when the active one closes before a script loads', async () => {
    const running = await start();
    await putSession(running, exampleSession);
    const first = await connect(running);
    await first.next();
    const second = await connect(running);
    await second.next();
    const closed = new Promise((resolve) => second.socket.once('close', resolve));
    second.socket.close();
    await closed;
    await expect
      .poll(async () => JSON.parse((await call(running, 'GET', '/api/session')).body).viewers)
      .toBe(1);

    await putScript(running, example);
    expect(await first.next()).toEqual({ type: 'script', script: example, position: start0 });
  });

  it('refuses a focus while a script is loaded', async () => {
    const running = await withScript();
    const reply = await postFocus(running, { file: 'src/config/auth.ts', lines: [6, 7] });
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body).error).toBe(
      'A script is playing. Run prwalk play --clear to unload it before using prwalk focus.',
    );
  });

  it('unloads the script when a new session opens', async () => {
    const running = await withScript();
    await putSession(running, exampleSession);
    expect((await call(running, 'GET', '/api/script')).status).toBe(404);
  });

  describe('live interaction', () => {
    const post = (running: RunningServer, path: string, body: unknown) =>
      call(running, 'POST', path, { body: JSON.stringify(body), token: TOKEN });
    const report = (viewer: Viewer, position: Record<string, unknown>) =>
      viewer.socket.send(JSON.stringify({ type: 'position', aside: null, ...position }));
    const wait = async (running: RunningServer, timeoutMs: number) =>
      JSON.parse((await call(running, 'GET', `/api/wait?timeout=${timeoutMs}`)).body);
    const takeEvents = async (running: RunningServer) =>
      JSON.parse((await post(running, '/api/events', {})).body).events;
    /** What `promise` gives if it settles within `ms`, else 'pending'. */
    const within = <T>(promise: Promise<T>, ms: number) =>
      Promise.race([
        promise,
        new Promise<'pending'>((resolve) => setTimeout(resolve, ms, 'pending')),
      ]);

    /** The example script loaded and an active viewer that has read its first two messages. */
    async function withViewer(options: { answerTimeoutMs?: number } = {}) {
      const running = await start(options);
      await putSession(running, exampleSession);
      await putScript(running, example);
      const viewer = await connect(running);
      await viewer.next();
      await viewer.next();
      return { running, viewer };
    }

    it('wait returns when the user does something, not when a sentence ends', async () => {
      const { running, viewer } = await withViewer();
      const waiting = wait(running, 5000);

      report(viewer, { status: 'playing', step: 0, sentence: 1, cause: 'auto' });
      await flushed(viewer.socket);
      expect(await within(waiting, 100)).toBe('pending');

      report(viewer, { status: 'paused', step: 0, sentence: 1, cause: 'user' });
      expect(await waiting).toEqual({ woke: true });
    });

    it('wait returns at once when an event it waits for has not been seen yet', async () => {
      const { running, viewer } = await withViewer();
      report(viewer, { status: 'playing', step: 2, sentence: 0, cause: 'user' });
      await flushed(viewer.socket);
      expect(await within(wait(running, 5000), 100)).toEqual({ woke: true });
    });

    it('hands out the unseen events once, and wait then gives up after its timeout', async () => {
      const { running, viewer } = await withViewer();
      report(viewer, { status: 'playing', step: 2, sentence: 0, cause: 'user' });
      report(viewer, { status: 'paused', step: 2, sentence: 0, cause: 'agent' });
      await flushed(viewer.socket);

      expect(await takeEvents(running)).toEqual([
        {
          seq: 1,
          kind: 'jumped',
          cause: 'user',
          step: 2,
          id: 'limiter-failures',
          sentence: 0,
          from: 0,
          fromId: 'overview',
        },
        { seq: 2, kind: 'paused', cause: 'agent', step: 2, id: 'limiter-failures', sentence: 0 },
      ]);
      expect(await takeEvents(running)).toEqual([]);
      expect(await wait(running, 50)).toEqual({ woke: false });
    });

    it('empties the event log when another script is loaded', async () => {
      const { running, viewer } = await withViewer();
      report(viewer, { status: 'playing', step: 2, sentence: 0, cause: 'user' });
      await flushed(viewer.socket);
      await putScript(running, example);
      expect(await takeEvents(running)).toEqual([]);
      expect(await wait(running, 0)).toEqual({ woke: false });
    });

    it('sends an order to the active viewer only and answers with its next position', async () => {
      const { running, viewer: first } = await withViewer();
      const active = await connect(running);
      await active.next();
      await active.next();
      expect(await first.next()).toEqual({ type: 'superseded' });

      const replied = post(running, '/api/command', { type: 'goto', step: 'config' });
      expect(await active.next()).toEqual({ type: 'command', command: { type: 'goto', step: 5 } });
      report(active, { status: 'playing', step: 5, sentence: 0, cause: 'agent' });

      expect(JSON.parse((await replied).body)).toEqual({
        answered: true,
        position: { status: 'playing', step: 5, sentence: 0 },
      });
      expect(await within(first.next(), 50)).toBe('pending');
    });

    it('says the order was sent when the viewer does not answer in time', async () => {
      const { running, viewer } = await withViewer({ answerTimeoutMs: 50 });
      const reply = await post(running, '/api/command', { type: 'pause' });
      expect(await viewer.next()).toEqual({ type: 'command', command: { type: 'pause' } });
      expect(JSON.parse(reply.body)).toEqual({ answered: false, position: start0 });
    });

    it('refuses an order with no script, no viewer, or a step that does not exist', async () => {
      const running = await start();
      await putSession(running, exampleSession);
      const noScript = await post(running, '/api/command', { type: 'pause' });
      expect(noScript.status).toBe(409);
      expect(JSON.parse(noScript.body).error).toBe(
        'No script is loaded. Load one with prwalk play <file>.',
      );

      await putScript(running, example);
      const noViewer = await post(running, '/api/command', { type: 'pause' });
      expect(noViewer.status).toBe(409);
      expect(JSON.parse(noViewer.body).error).toBe(
        `No viewer is open. Open http://127.0.0.1:${running.port}/ in a browser.`,
      );

      await connect(running);
      const badStep = await post(running, '/api/command', { type: 'goto', step: 'nope' });
      expect(badStep.status).toBe(422);
      expect(JSON.parse(badStep.body).error).toBe(
        'There is no step "nope". Give a step id or number: 1 "overview", 2 "limiter-structure", 3 "limiter-failures", 4 "controller-block", 5 "controller-failure-success", 6 "config", 7 "tests", 8 "end".',
      );
    });

    it('answers 422 to an answer whose focus is outside the diff and sends it to nobody', async () => {
      const { running, viewer } = await withViewer();
      const focus = { file: 'src/config/auth.ts', lines: [6, 7] };
      const bad = await post(running, '/api/say', {
        text: 'Sí.',
        focus: { ...focus, lines: [90, 91] },
      });
      expect(bad.status).toBe(422);
      expect(JSON.parse(bad.body).error).toMatch(/^Lines 90-91 of src\/config\/auth\.ts/);

      expect(
        (await post(running, '/api/say', { text: 'Sí.', question: '¿Y?', focus })).status,
      ).toBe(200);
      expect(await viewer.next()).toEqual({
        type: 'say',
        answer: { text: 'Sí.', question: '¿Y?', focus: { ...focus, side: 'new' }, resume: false },
      });
    });

    it('replaces the steps from one on, sends the new script and moves playback', async () => {
      const { running, viewer } = await withViewer();
      report(viewer, { status: 'playing', step: 6, sentence: 1, cause: 'user' });
      await flushed(viewer.socket);
      const steps = [
        { id: 'more', title: 'Más', card: { heading: 'Más', items: [] }, say: ['Uno más.'] },
      ];

      const invalid = await post(running, '/api/replace', { from: '7', steps: [{ id: 'x' }] });
      expect(invalid.status).toBe(422);
      const reply = await post(running, '/api/replace', { from: '7', steps });
      expect(JSON.parse(reply.body)).toEqual({ steps: 7, viewers: 1 });

      const script = { ...example, steps: [...example.steps.slice(0, 6), ...steps] };
      expect(await viewer.next()).toEqual({ type: 'replace', script, from: 6 });
      expect(JSON.parse((await call(running, 'GET', '/api/script')).body)).toEqual(script);
      expect(await playbackOf(running)).toEqual({ status: 'paused', step: 6, sentence: 0 });
    });
  });
});

describe('voice adapters', () => {
  const adapter = fileURLToPath(
    new URL('../../test/fixtures/voices/test-voice.mjs', import.meta.url),
  );
  const configured = { provider: adapter, options: { failOn: 'FALLA' } };

  /** Asks the daemon for the audio of `text`; the token is sent unless `token` is null. */
  async function tts(
    running: RunningServer,
    body: unknown,
    { token = TOKEN }: { token?: string | null } = {},
  ) {
    const reply = await fetch(`http://127.0.0.1:${running.port}/api/tts`, {
      method: 'POST',
      headers: token === null ? {} : { 'x-prwalk-token': token },
      body: JSON.stringify(body),
    });
    const type = reply.headers.get('content-type') ?? '';
    return {
      status: reply.status,
      type,
      audio: new Uint8Array(await reply.arrayBuffer()),
    };
  }
  const errorOf = (audio: Uint8Array) => JSON.parse(new TextDecoder().decode(audio)).error;
  const voiceOf = async (running: RunningServer) =>
    JSON.parse((await call(running, 'GET', '/api/voice')).body);

  it("answers with the audio the adapter makes, only with the token or the viewer's", async () => {
    const running = await start({ voice: () => configured });
    const reply = await tts(running, { text: 'Hola.', lang: 'es' });
    expect(reply.status).toBe(200);
    expect(reply.type).toBe('audio/wav');
    expect(new TextDecoder().decode(reply.audio.slice(0, 4))).toBe('RIFF');
    expect((await tts(running, { text: 'Hola.', lang: 'es' }, { token: null })).status).toBe(401);

    // The viewer gets a token of its own with the voice, good for audio and nothing else.
    const viewer = await connect(running);
    await viewer.next();
    const message = await viewer.next();
    const token =
      message.type === 'voice' && message.voice.kind === 'remote' ? message.voice.token : '';
    expect((await tts(running, { text: 'Hola.', lang: 'es' }, { token })).status).toBe(200);
    expect((await call(running, 'POST', '/api/stop', { token })).status).toBe(401);
  });

  it('synthesizes a sentence once and answers again from memory', async () => {
    const running = await start({ voice: () => configured });
    const first = await tts(running, { text: 'Una.', lang: 'es' });
    const again = await tts(running, { text: 'Una.', lang: 'es' });
    const other = await tts(running, { text: 'Otra.', lang: 'es' });
    expect(again.audio).toEqual(first.audio);
    expect(other.audio).not.toEqual(first.audio);
  });

  it('answers before the adapter has loaded, however long that takes', async () => {
    const slow = join(tempDir(), 'slow.mjs');
    writeFileSync(slow, 'await new Promise(() => {});\nexport default { synthesize() {} };\n');
    const running = await start({ voice: () => ({ provider: slow, options: {} }) });
    expect((await putSession(running, input)).status).toBe(200);
  });

  it('refuses a sentence longer than 2000 characters', async () => {
    const running = await start({ voice: () => configured });
    const reply = await tts(running, { text: 'a'.repeat(2001), lang: 'es' });
    expect(reply.status).toBe(400);
  });

  it('answers 409 without an adapter, also when the configured one cannot be loaded', async () => {
    const none = await start();
    expect((await tts(none, { text: 'Hola.', lang: 'es' })).status).toBe(409);
    await none.close();

    const missing = join(tempDir(), 'missing.mjs');
    const running = await start({ voice: () => ({ provider: missing, options: {} }) });
    const reply = await tts(running, { text: 'Hola.', lang: 'es' });
    expect(reply.status).toBe(409);
    expect(await voiceOf(running)).toMatchObject({
      provider: { kind: 'browser' },
      failure: expect.stringContaining(`Cannot load the voice adapter ${missing}`),
    });
  });

  it('answers 502 when the adapter fails, logs it and remembers it until a sentence works', async () => {
    const logged: string[] = [];
    const running = await start({ voice: () => configured, log: (line) => logged.push(line) });
    const reply = await tts(running, { text: 'Esto FALLA.', lang: 'es' });
    expect(reply.status).toBe(502);
    expect(errorOf(reply.audio)).toBe('The voice adapter failed: refused "Esto FALLA."');
    expect(logged).toEqual([expect.stringContaining('refused "Esto FALLA."')]);
    expect((await voiceOf(running)).failure).toBe('refused "Esto FALLA."');

    await tts(running, { text: 'Esto va.', lang: 'es' });
    expect((await voiceOf(running)).failure).toBeNull();
  });

  it('takes the adapter from the configuration only, whatever a request says, and tells the viewer', async () => {
    let config: { provider: string; options: Record<string, string> } | undefined = configured;
    const running = await start({ voice: () => config });
    await putSession(running, input);
    const viewer = await connect(running);
    expect(await viewer.next()).toEqual({ type: 'focus', focus: null });
    const remote = { kind: 'remote', name: 'test-voice', token: expect.any(String) };
    expect(await viewer.next()).toEqual({ type: 'voice', voice: remote });

    const reload = await call(running, 'POST', '/api/voice', {
      body: JSON.stringify({ provider: join(tempDir(), 'evil.mjs') }),
      token: TOKEN,
    });
    expect(reload.status).toBe(200);
    expect(await voiceOf(running)).toEqual({
      provider: { kind: 'adapter', name: 'test-voice', path: adapter },
      failure: null,
    });
    expect(await viewer.next()).toEqual({ type: 'voice', voice: remote });

    config = { provider: 'browser', options: {} };
    await call(running, 'POST', '/api/voice', { token: TOKEN });
    expect(await viewer.next()).toEqual({ type: 'voice', voice: { kind: 'browser' } });
    expect((await tts(running, { text: 'Hola.', lang: 'es' })).status).toBe(409);
  });
});
