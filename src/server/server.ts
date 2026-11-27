import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';
import { checkScriptAgainstDiff } from '../shared/check-script.js';
import { buildDiffIndex, checkFocus } from '../shared/diff.js';
import {
  type AsideReport,
  deriveEvents,
  type PlaybackEvent,
  wakesAgent,
} from '../shared/events.js';
import { initialPlayback, type PlaybackState } from '../shared/playback.js';
import {
  type CommandReply,
  commandRequestSchema,
  type EventsReply,
  type FocusReply,
  focusRequestSchema,
  type ReplaceReply,
  replaceRequestSchema,
  type SayReply,
  type ScriptReply,
  type ServerMessage,
  sayRequestSchema,
  type TransportCommand,
  ttsRequestSchema,
  type ViewerFocus,
  type ViewerUpdate,
  type ViewerVoice,
  type VoiceReply,
  viewerMessageSchema,
  type WaitReply,
} from '../shared/protocol.js';
import { listSteps, positionAfterReplace, replaceSteps, resolveStep } from '../shared/replace.js';
import { type Script, validateScript } from '../shared/script.js';
import { type SessionReply, type SessionView, sessionInputSchema } from '../shared/session.js';
import { loadAdapter, Synthesizer } from './adapter.js';
import type { VoiceConfig } from './state.js';

export const TOKEN_HEADER = 'x-prwalk-token';
const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;
/** The viewer only sends small position reports; anything larger is a misbehaving client. */
const MAX_VIEWER_MESSAGE_BYTES = 64 * 1024;
const SCRIPT_PLAYING =
  'A script is playing. Run prwalk play --clear to unload it before using prwalk focus.';
const NO_SCRIPT = 'No script is loaded. Load one with prwalk play <file>.';
/** How many events the daemon keeps; older ones are dropped, seen or not. */
const MAX_EVENTS = 200;
/** The longest `GET /api/wait` may hold a request; the CLI asks for less and asks again. */
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_ANSWER_TIMEOUT_MS = 2000;
/** The compiled viewer, from both src/server (tests) and dist/server (the binary). */
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../../dist/web', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export type ServerOptions = {
  /** 0 picks a free port; the chosen one is on the result. */
  port: number;
  /** Required on every request that changes something, in the `x-prwalk-token` header. */
  token: string;
  maxBodyBytes?: number;
  /** Called after `POST /api/stop` has been answered and the server has closed. */
  onStop?: () => void;
  /** Folder with the compiled viewer (default: dist/web). */
  webRoot?: string;
  /** How long an order waits for the viewer to report its position (default: 2 s). */
  answerTimeoutMs?: number;
  /**
   * Shut down after this long with no viewer connected and no request received (default: never).
   */
  idleMs?: number;
  /** Called once the server has closed for being idle. */
  onIdle?: () => void;
  /**
   * The voice in config.json, read again on `POST /api/voice` (default: none, the browser's).
   * The only way to choose an adapter: no request can name one.
   */
  voice?: () => VoiceConfig | undefined;
  /** Writes a line to the daemon's log (default: nowhere). */
  log?: (line: string) => void;
  /**
   * Whether a newer prwalk has been released, undefined when not or not known. Run when the
   * server starts and on every new session, without anything waiting for it (default: never).
   */
  checkUpdate?: () => Promise<ViewerUpdate | undefined>;
};

export type RunningServer = { port: number; close(): Promise<void> };

type Session = SessionView & { patch: string };

/** The loaded script and the last position (and answer) the active viewer reported for it. */
type Playback = { script: Script; position: PlaybackState; aside: AsideReport | null };

/**
 * The daemon's HTTP API and the viewer's WebSocket. Listens on 127.0.0.1 only, holds one session
 * (and at most one script) at a time, and only stores and serves: it never runs gh or git.
 *
 * The last viewer to connect is the active one (when it closes, the most recent one still open
 * takes over): only its position counts, and while a script is loaded the others are told they
 * have been superseded.
 *
 * From the active viewer's reports it keeps a log of events (see deriveEvents) and remembers
 * which ones the agent has been handed, for `prwalk status` and `prwalk wait`.
 */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const webRoot = resolve(options.webRoot ?? DEFAULT_WEB_ROOT);
  let session: Session | undefined;
  let focus: ViewerFocus | null = null;
  let playback: Playback | undefined;
  let active: WebSocket | undefined;
  let port = options.port;
  let events: PlaybackEvent[] = [];
  let lastSeq = 0;
  let seenSeq = 0;
  /** `GET /api/wait` requests on hold, woken on every new event. */
  const waiters = new Set<(closing?: boolean) => void>();
  /** Orders waiting for the next position report. */
  const answerWaiters = new Set<(position: PlaybackState) => void>();
  const answerTimeoutMs = options.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS;
  const unseen = () => events.filter((event) => event.seq > seenSeq);
  const shouldWake = () => unseen().some(wakesAgent);
  const activeViewer = () => (active?.readyState === active?.OPEN ? active : undefined);
  const noViewer = () => `No viewer is open. Open http://127.0.0.1:${port}/ in a browser.`;

  /** The adapter in use, if any, where it was loaded from, and its last failure. */
  let voice: { synthesizer?: Synthesizer; path?: string; failure: string | null } = {
    failure: null,
  };
  const log = options.log ?? (() => {});
  /** Lets the viewer ask for audio, and nothing else; it only ever goes to the viewer's page. */
  const viewerToken = randomBytes(32).toString('hex');
  const viewerVoice = (): ViewerVoice =>
    voice.synthesizer === undefined
      ? { kind: 'browser' }
      : { kind: 'remote', name: voice.synthesizer.adapter.name, token: viewerToken };
  const voiceReply = (): VoiceReply => ({
    provider:
      voice.synthesizer === undefined
        ? { kind: 'browser' }
        : { kind: 'adapter', name: voice.synthesizer.adapter.name, path: voice.path ?? '' },
    failure: voice.failure,
  });
  /** Reads the configured voice and loads its adapter; one that fails to load leaves the browser's. */
  const readVoice = async () => {
    try {
      const config = options.voice?.();
      if (config === undefined || config.provider === 'browser') {
        voice = { failure: null };
        return;
      }
      const adapter = await loadAdapter(config.provider);
      const synthesizer = new Synthesizer(adapter, config.options);
      voice = { synthesizer, path: config.provider, failure: null };
    } catch (error) {
      voice = { failure: messageOf(error) };
      log(`voice: ${messageOf(error)}`);
    }
  };
  /**
   * The voice being loaded, one load after another. Requests about the voice wait for it; the
   * rest of the daemon does not, since an adapter may take long to load (or never finish).
   */
  let voiceLoaded: Promise<void> = Promise.resolve();
  const loadVoice = () => {
    voiceLoaded = voiceLoaded.then(readVoice);
    return voiceLoaded;
  };

  /** The newer version found by the last check, told to every viewer. */
  let update: ViewerUpdate | undefined;
  /** The check under way: an open while it runs does not start another one. */
  let checking: Promise<void> | undefined;
  const checkUpdate = () => {
    if (checking !== undefined) return;
    checking = options
      .checkUpdate?.()
      .then((found) => {
        if (found === undefined || found.latest === update?.latest) return;
        update = found;
        broadcast({ type: 'update', update });
      })
      .catch((error: unknown) => log(`update check: ${messageOf(error)}`))
      .finally(() => {
        checking = undefined;
      });
  };

  const viewers = new WebSocketServer({ noServer: true, maxPayload: MAX_VIEWER_MESSAGE_BYTES });
  const viewerCount = () =>
    [...viewers.clients].filter((viewer) => viewer.readyState === viewer.OPEN).length;
  const broadcast = (message: ServerMessage) => {
    const data = JSON.stringify(message);
    for (const viewer of viewers.clients) if (viewer.readyState === viewer.OPEN) viewer.send(data);
  };
  const sendTo = (viewer: WebSocket, message: ServerMessage) => {
    if (viewer.readyState === viewer.OPEN) viewer.send(JSON.stringify(message));
  };
  const scriptMessage = (): ServerMessage => ({
    type: 'script',
    script: playback?.script ?? null,
    position: playback?.position ?? null,
  });
  /** The active viewer changes: no one plays until the new one does, so a playing walkthrough pauses. */
  const pausePlayback = () => {
    if (playback === undefined) return;
    playback.aside = null;
    if (playback.position.status === 'playing') {
      playback.position = { ...playback.position, status: 'paused' };
    }
  };
  /** The script goes to the active viewer; with one loaded, every other viewer stands down. */
  const sendScript = () => {
    for (const viewer of viewers.clients) {
      if (viewer === active) sendTo(viewer, scriptMessage());
      else if (playback !== undefined) sendTo(viewer, { type: 'superseded' });
    }
  };

  /** Restarts the idle countdown; it only runs while no viewer is connected. */
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const stillUsed = () => {
    clearTimeout(idleTimer);
    if (!options.idleMs || viewerCount() > 0) return;
    idleTimer = setTimeout(() => {
      close().then(() => options.onIdle?.());
    }, options.idleMs);
  };

  const close = () =>
    new Promise<void>((resolve) => {
      clearTimeout(idleTimer);
      for (const wake of waiters) wake(true);
      for (const viewer of viewers.clients) viewer.terminate();
      server.close(() => resolve());
      server.closeAllConnections();
    });

  // Same-host check as for HTTP, plus Origin: browsers let any page open a WebSocket to
  // 127.0.0.1 (there is no CORS for them), so only the daemon's own page may listen.
  const ownHost = (host: string | undefined) =>
    host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const ownOrigin = (origin: string | undefined) =>
    origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const refusal =
      !ownHost(req.headers.host) || !ownOrigin(req.headers.origin)
        ? '403 Forbidden'
        : path !== '/ws'
          ? '404 Not Found'
          : undefined;
    if (refusal !== undefined) {
      socket.end(`HTTP/1.1 ${refusal}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    viewers.handleUpgrade(req, socket, head, (viewer) => {
      viewer.on('error', () => viewer.terminate());
      viewer.on('close', () => {
        stillUsed();
        // The most recent viewer still open takes over, so a tab left alone is never superseded.
        if (active !== viewer) return;
        pausePlayback();
        active = [...viewers.clients].findLast(
          (other) => other !== viewer && other.readyState === other.OPEN,
        );
      });
      viewer.on('message', (data) => onViewerMessage(viewer, String(data)));
      clearTimeout(idleTimer);
      active = viewer;
      pausePlayback();
      sendTo(viewer, { type: 'focus', focus });
      if (playback !== undefined) sendScript();
      if (voice.synthesizer !== undefined) sendTo(viewer, { type: 'voice', voice: viewerVoice() });
      if (update !== undefined) sendTo(viewer, { type: 'update', update });
    });
  });

  /** A position report from the active viewer; anything else, or anything malformed, is ignored. */
  function onViewerMessage(viewer: WebSocket, data: string): void {
    if (viewer !== active || playback === undefined) return;
    let message: ReturnType<typeof viewerMessageSchema.parse>;
    try {
      message = viewerMessageSchema.parse(JSON.parse(data));
    } catch {
      return;
    }
    const { script } = playback;
    const step = script.steps[message.step];
    if (step === undefined || message.sentence >= step.say.length) return;
    const position = { status: message.status, step: message.step, sentence: message.sentence };
    const aside = message.aside ?? null;
    const derived = deriveEvents(
      { ...playback.position, aside: playback.aside },
      { ...position, aside },
      message.cause ?? 'auto',
    );
    playback.position = position;
    playback.aside = aside;
    for (const event of derived) {
      const id = script.steps[event.step]?.id ?? '';
      const fromId = event.from === undefined ? undefined : script.steps[event.from]?.id;
      events.push({ ...event, seq: ++lastSeq, id, ...(fromId !== undefined && { fromId }) });
    }
    events = events.slice(-MAX_EVENTS);
    for (const answer of answerWaiters) answer(position);
    if (derived.length > 0) for (const wake of waiters) wake();
  }

  /** Sends an order to the active viewer and waits for the position it reports next. */
  function sendCommand(viewer: WebSocket, command: TransportCommand): Promise<CommandReply> {
    return new Promise((resolve) => {
      const finish = (answered: boolean, position: PlaybackState) => {
        clearTimeout(timer);
        answerWaiters.delete(onAnswer);
        resolve({ answered, position });
      };
      const onAnswer = (position: PlaybackState) => finish(true, position);
      const timer = setTimeout(
        () => finish(false, playback?.position ?? initialPlayback),
        answerTimeoutMs,
      );
      answerWaiters.add(onAnswer);
      sendTo(viewer, { type: 'command', command });
    });
  }

  /** Holds a `GET /api/wait` until an event worth waking the agent for, or the timeout. */
  function holdWait(res: ServerResponse, timeoutMs: number): void {
    const forget = () => {
      clearTimeout(timer);
      waiters.delete(onEvent);
    };
    const reply = (woke: boolean) => {
      forget();
      if (!res.writableEnded) sendJson(res, 200, { woke } satisfies WaitReply);
    };
    const onEvent = (closing = false) => {
      if (closing || shouldWake()) reply(shouldWake());
    };
    const timer = setTimeout(() => reply(false), timeoutMs);
    waiters.add(onEvent);
    // The CLI went away (killed, or its own timeout): forget the request.
    res.on('close', forget);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    stillUsed();
    // Any web page open in the browser can send requests to 127.0.0.1. Checking Host defeats
    // DNS rebinding; the token (a custom header, and no CORS headers ever) defeats the rest.
    if (!ownHost(req.headers.host)) {
      return sendJson(res, 403, { error: 'forbidden host' });
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const route = `${req.method} ${path}`;
    const changes = req.method !== 'GET' && req.method !== 'HEAD';
    const token = req.headers[TOKEN_HEADER];
    const allowed = token === options.token || (route === 'POST /api/tts' && token === viewerToken);
    if (changes && !allowed) {
      return sendJson(res, 401, { error: 'missing or wrong token' });
    }

    switch (route) {
      case 'GET /api/health':
        return sendJson(res, 200, { ok: true, pid: process.pid });
      case 'GET /api/session':
        if (session === undefined) return sendJson(res, 404, { error: 'no session' });
        return sendJson(res, 200, {
          meta: session.meta,
          index: session.index,
          viewers: viewerCount(),
          ...(playback !== undefined && { playback: playback.position, aside: playback.aside }),
        } satisfies SessionReply);
      case 'GET /api/diff':
        if (session === undefined) return sendJson(res, 404, { error: 'no session' });
        return send(res, 200, 'text/plain; charset=utf-8', session.patch);
      case 'PUT /api/session': {
        const body = await readBody(req, maxBodyBytes);
        if (body === undefined) return sendJson(res, 413, { error: 'session is too large' });
        let next: Session;
        try {
          const input = sessionInputSchema.parse(JSON.parse(body));
          next = { meta: input.meta, patch: input.patch, index: buildDiffIndex(input.patch) };
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { error: `invalid session: ${reason}` });
        }
        session = next;
        focus = null;
        playback = undefined;
        events = [];
        seenSeq = lastSeq;
        broadcast({ type: 'session' });
        checkUpdate();
        return sendJson(res, 200, { meta: session.meta, index: session.index });
      }
      case 'GET /api/script':
        if (playback === undefined) return sendJson(res, 404, { error: 'no script' });
        return sendJson(res, 200, playback.script);
      case 'PUT /api/script': {
        if (session === undefined) return sendJson(res, 409, { error: 'no session' });
        const body = await readBody(req, maxBodyBytes);
        if (body === undefined) return sendJson(res, 413, { error: 'script is too large' });
        let input: unknown;
        try {
          input = JSON.parse(body);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { error: `invalid script: ${reason}` });
        }
        const result = validateScript(input);
        const errors = result.ok
          ? checkScriptAgainstDiff(result.script, session.index)
          : result.errors;
        if (!result.ok || errors.length > 0) return sendJson(res, 422, { errors });
        playback = { script: result.script, position: initialPlayback, aside: null };
        focus = null;
        // The events were about the script before: a new one starts a new log, like a session.
        events = [];
        seenSeq = lastSeq;
        sendScript();
        return sendJson(res, 200, {
          steps: result.script.steps.length,
          viewers: viewerCount(),
        } satisfies ScriptReply);
      }
      case 'DELETE /api/script':
        if (playback !== undefined) {
          playback = undefined;
          if (active !== undefined) sendTo(active, scriptMessage());
        }
        return sendJson(res, 200, { ok: true });
      case 'POST /api/focus': {
        if (session === undefined) return sendJson(res, 404, { error: 'no session' });
        if (playback !== undefined) return sendJson(res, 409, { error: SCRIPT_PLAYING });
        const body = await readBody(req, MAX_VIEWER_MESSAGE_BYTES);
        if (body === undefined) return sendJson(res, 413, { error: 'focus is too large' });
        let requested: ReturnType<typeof focusRequestSchema.parse>['focus'];
        try {
          requested = focusRequestSchema.parse(JSON.parse(body === '' ? '{}' : body)).focus;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return sendJson(res, 400, { error: `invalid focus: ${reason}` });
        }
        if (requested != null) {
          const problem = checkFocus(session.index, requested);
          if (problem !== undefined) return sendJson(res, 422, { error: problem });
        }
        focus =
          requested == null
            ? null
            : { file: requested.file, side: requested.side ?? 'new', lines: requested.lines };
        broadcast({ type: 'focus', focus });
        return sendJson(res, 200, { focus, viewers: viewerCount() } satisfies FocusReply);
      }
      case 'POST /api/events': {
        const reply: EventsReply = { events: unseen() };
        seenSeq = lastSeq;
        return sendJson(res, 200, reply);
      }
      case 'GET /api/wait': {
        const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('timeout');
        const timeoutMs = Number(raw);
        if (raw === null || !Number.isInteger(timeoutMs) || timeoutMs < 0) {
          return sendJson(res, 400, { error: 'timeout must be a whole number of milliseconds' });
        }
        if (shouldWake()) return sendJson(res, 200, { woke: true } satisfies WaitReply);
        return holdWait(res, Math.min(timeoutMs, MAX_WAIT_MS));
      }
      case 'POST /api/command': {
        const body = await readBody(req, MAX_VIEWER_MESSAGE_BYTES);
        if (body === undefined) return sendJson(res, 413, { error: 'order is too large' });
        let request: ReturnType<typeof commandRequestSchema.parse>;
        try {
          request = commandRequestSchema.parse(JSON.parse(body));
        } catch (error) {
          return sendJson(res, 400, { error: `invalid order: ${messageOf(error)}` });
        }
        if (playback === undefined) return sendJson(res, 409, { error: NO_SCRIPT });
        const viewer = activeViewer();
        if (viewer === undefined) return sendJson(res, 409, { error: noViewer() });
        let command: TransportCommand;
        if (request.type === 'goto') {
          const ref = request.step ?? '';
          const step = resolveStep(playback.script, ref);
          if (step === undefined) {
            return sendJson(res, 422, {
              error: `There is no step ${JSON.stringify(ref)}. Give a step id or number: ${listSteps(playback.script)}.`,
            });
          }
          command = { type: 'goto', step };
        } else {
          command = { type: request.type };
        }
        return sendJson(res, 200, await sendCommand(viewer, command));
      }
      case 'POST /api/say': {
        if (session === undefined) return sendJson(res, 404, { error: 'no session' });
        const body = await readBody(req, maxBodyBytes);
        if (body === undefined) return sendJson(res, 413, { error: 'answer is too large' });
        let request: ReturnType<typeof sayRequestSchema.parse>;
        try {
          request = sayRequestSchema.parse(JSON.parse(body));
        } catch (error) {
          return sendJson(res, 400, { error: `invalid answer: ${messageOf(error)}` });
        }
        if (request.focus !== undefined) {
          const problem = checkFocus(session.index, request.focus);
          if (problem !== undefined) return sendJson(res, 422, { error: problem });
        }
        const viewer = activeViewer();
        if (viewer === undefined) return sendJson(res, 409, { error: noViewer() });
        const { text, question, focus: requested, resume } = request;
        sendTo(viewer, {
          type: 'say',
          answer: {
            text,
            ...(question !== undefined && { question }),
            ...(requested !== undefined && {
              focus: {
                file: requested.file,
                side: requested.side ?? 'new',
                lines: requested.lines,
              },
            }),
            resume: resume ?? false,
          },
        });
        return sendJson(res, 200, {
          ok: true,
          position: playback?.position ?? null,
        } satisfies SayReply);
      }
      case 'POST /api/replace': {
        if (session === undefined || playback === undefined) {
          return sendJson(res, 409, { error: NO_SCRIPT });
        }
        const body = await readBody(req, maxBodyBytes);
        if (body === undefined) return sendJson(res, 413, { error: 'steps are too large' });
        let request: ReturnType<typeof replaceRequestSchema.parse>;
        try {
          request = replaceRequestSchema.parse(JSON.parse(body));
        } catch (error) {
          return sendJson(res, 400, { error: `invalid replacement: ${messageOf(error)}` });
        }
        const from = resolveStep(playback.script, request.from);
        if (from === undefined) {
          return sendJson(res, 422, {
            errors: [
              `There is no step ${JSON.stringify(request.from)} to replace from. Give a step id or number: ${listSteps(playback.script)}.`,
            ],
          });
        }
        const result = replaceSteps(playback.script, from, request.steps, session.index);
        if (!result.ok) return sendJson(res, 422, { errors: result.errors });
        playback.script = result.script;
        playback.position = positionAfterReplace(playback.position, from, result.script);
        const viewer = activeViewer();
        if (viewer !== undefined) sendTo(viewer, { type: 'replace', script: result.script, from });
        return sendJson(res, 200, {
          steps: result.script.steps.length,
          viewers: viewerCount(),
        } satisfies ReplaceReply);
      }
      case 'GET /api/voice':
        await voiceLoaded;
        return sendJson(res, 200, voiceReply());
      case 'POST /api/voice':
        // Whatever the body says: the adapter only comes from the configuration.
        await readBody(req, MAX_VIEWER_MESSAGE_BYTES);
        await loadVoice();
        broadcast({ type: 'voice', voice: viewerVoice() });
        return sendJson(res, 200, voiceReply());
      case 'POST /api/tts': {
        const body = await readBody(req, MAX_VIEWER_MESSAGE_BYTES);
        if (body === undefined) return sendJson(res, 413, { error: 'sentence is too large' });
        let request: ReturnType<typeof ttsRequestSchema.parse>;
        try {
          request = ttsRequestSchema.parse(JSON.parse(body));
        } catch (error) {
          return sendJson(res, 400, { error: `invalid sentence: ${messageOf(error)}` });
        }
        await voiceLoaded;
        const { synthesizer } = voice;
        if (synthesizer === undefined) {
          return sendJson(res, 409, {
            error: 'No voice adapter is configured: the viewer speaks with the browser voice.',
          });
        }
        try {
          const { audio, mimeType } = await synthesizer.synthesize(request.text, request.lang);
          if (voice.synthesizer === synthesizer) voice.failure = null;
          res.writeHead(200, {
            'content-type': mimeType,
            'content-length': audio.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          res.end(audio);
          return;
        } catch (error) {
          const reason = messageOf(error);
          if (voice.synthesizer === synthesizer) voice.failure = reason;
          log(`voice ${synthesizer.adapter.name}: ${reason}`);
          return sendJson(res, 502, { error: `The voice adapter failed: ${reason}` });
        }
      }
      case 'POST /api/stop':
        res.on('finish', () => {
          close().then(() => options.onStop?.());
        });
        return sendJson(res, 200, { ok: true });
      default:
        if (req.method === 'GET' && !path.startsWith('/api/')) return serveViewer(res, path);
        return sendJson(res, 404, { error: `no route for ${route}` });
    }
  }

  /** A file of the compiled viewer; `/` is its index.html. Nothing outside webRoot. */
  async function serveViewer(res: ServerResponse, path: string): Promise<void> {
    if (!existsSync(resolve(webRoot, 'index.html'))) {
      return send(
        res,
        503,
        'text/plain; charset=utf-8',
        `The viewer is not built: ${webRoot} has no index.html. Run pnpm build in the prwalk folder.`,
      );
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(path === '/' ? '/index.html' : path);
    } catch {
      return sendJson(res, 404, { error: 'not found' });
    }
    const file = resolve(webRoot, `.${decoded}`);
    const type = CONTENT_TYPES[extname(file)];
    const isFile = await stat(file).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!file.startsWith(`${webRoot}${sep}`) || type === undefined || !isFile) {
      return sendJson(res, 404, { error: 'not found' });
    }
    res.writeHead(200, {
      'content-type': type,
      'x-content-type-options': 'nosniff',
      'content-security-policy': viewerPolicy(port),
    });
    res.end(await readFile(file));
  }

  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `port ${options.port} is already in use. Choose another one with --port or PRWALK_PORT.`,
            )
          : error,
      );
    });
    server.listen(options.port, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      stillUsed();
      checkUpdate();
      resolve({ port, close });
    });
    // The viewers learn the adapter's voice once it has loaded.
    loadVoice().then(() => {
      if (voice.synthesizer !== undefined) broadcast({ type: 'voice', voice: viewerVoice() });
    });
  });
}

/** The body as text, or undefined if it is larger than `limit` (the rest is drained). */
function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? undefined : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * What the viewer's pages may load and contact: scripts, connections and audio only from its own
 * origin, the WebSocket included (named in full, since not every browser counts ws: as 'self').
 * No eval: the syntax highlighter uses its JavaScript regex engine, not WebAssembly.
 */
function viewerPolicy(port: number): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    // @pierre/diffs writes <style> elements and style attributes into its shadow DOM.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
    // The audio of a voice adapter, fetched from the daemon and played from a blob.
    "media-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(body);
}
