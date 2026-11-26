import { readFileSync } from 'node:fs';
import { prwalkHome } from '../server/state.js';
import type { PlaybackState } from '../shared/playback.js';
import type { CommandReply, ReplaceReply, SayReply, WaitReply } from '../shared/protocol.js';
import { callDaemon, type Daemon, findDaemon, unexpectedReply } from './daemon-client.js';
import { UserError } from './errors.js';
import {
  describePlayback,
  formatPlayback,
  type JsonOption,
  NO_SESSION,
  parseLines,
  plural,
  print,
  readSession,
  readStatus,
} from './session-commands.js';
import { readScriptInput } from './validate.js';

/** The daemon only holds a wait this long; the CLI asks again until its own timeout. */
const WAIT_SLICE_MS = 60_000;
const WAITING_FOR_START =
  'The viewer is waiting for the user to press Start: nothing is said until then.';

/** Whether a script is loaded but the user has not pressed Start in the viewer yet. */
function waitingForStart(position: PlaybackState | null): boolean {
  return position?.status === 'idle';
}

/** `text`, plus a line saying nothing plays yet when the viewer waits for Start. */
function withStartNotice(text: string, waiting: boolean): string {
  return waiting ? `${text}\n${WAITING_FOR_START}` : text;
}

async function requireDaemon(): Promise<Daemon> {
  const daemon = await findDaemon(prwalkHome());
  if (daemon === undefined) throw new UserError(NO_SESSION);
  return daemon;
}

/** The daemon's refusal as a UserError: its message, or each of its errors. */
function refusal(body: unknown): UserError {
  const { error, errors } = body as { error?: unknown; errors?: string[] };
  return errors === undefined ? new UserError(String(error)) : UserError.list(errors);
}

/** `prwalk pause`, `prwalk resume` and `prwalk goto <step>`. */
export async function transportCommand(
  order: { type: 'pause' | 'resume' } | { type: 'goto'; step: string },
  options: JsonOption,
): Promise<void> {
  const daemon = await requireDaemon();
  const reply = await callDaemon(daemon, 'POST', '/api/command', order);
  if (reply.status === 409 || reply.status === 422) throw refusal(reply.body);
  if (reply.status !== 200) throw unexpectedReply(reply);
  const { answered, position } = reply.body as CommandReply;
  const playback = await describePlayback(daemon, position);
  const where = playback === null ? 'no script loaded' : formatPlayback(playback);
  const name = order.type === 'goto' ? `goto ${order.step}` : order.type;
  const waiting = playback !== null && waitingForStart(position);
  print(
    options,
    { ok: true, answered, playback, waitingForStart: waiting },
    withStartNotice(
      answered
        ? `Playback: ${where}`
        : `Sent ${name}, but the viewer has not answered within 2 s. Last known playback: ${where}`,
      waiting,
    ),
  );
}

/** `prwalk say <text | -> [--question <text>] [--file <path> --lines <a-b> [--side old]] [--resume]` */
export async function sayCommand(
  source: string,
  options: JsonOption & {
    question?: string;
    file?: string;
    lines?: string;
    side?: string;
    resume?: boolean;
  },
): Promise<void> {
  const text = source === '-' ? readStdin() : source;
  if (text.trim() === '')
    throw new UserError('Give the answer to say, or - to read it from stdin.');
  if ((options.file === undefined) !== (options.lines === undefined)) {
    throw new UserError('--file and --lines go together, like --file src/app.ts --lines 12-18.');
  }
  if (options.side !== undefined && options.side !== 'new' && options.side !== 'old') {
    throw new UserError(`--side must be new or old, got "${options.side}".`);
  }
  const focus =
    options.file === undefined
      ? undefined
      : {
          file: options.file,
          lines: parseLines(options.lines ?? ''),
          ...(options.side && { side: options.side }),
        };
  const daemon = await requireDaemon();
  const reply = await callDaemon(daemon, 'POST', '/api/say', {
    text,
    ...(options.question !== undefined && { question: options.question }),
    ...(focus !== undefined && { focus }),
    ...(options.resume && { resume: true }),
  });
  if (reply.status === 404) throw new UserError(NO_SESSION);
  if (reply.status === 409 || reply.status === 422) throw refusal(reply.body);
  if (reply.status !== 200) throw unexpectedReply(reply);
  const waiting = waitingForStart((reply.body as SayReply).position);
  print(
    options,
    { ok: true, waitingForStart: waiting },
    withStartNotice(
      'Answer sent to the viewer. Run prwalk wait to know when it has been said.',
      waiting,
    ),
  );
}

/** `prwalk replace --from <step> <file | ->` */
export async function replaceCommand(
  file: string,
  options: JsonOption & { from: string },
): Promise<void> {
  const read = readScriptInput(file);
  if (!read.ok) throw UserError.list(read.errors);
  const daemon = await requireDaemon();
  const reply = await callDaemon(daemon, 'POST', '/api/replace', {
    from: options.from,
    steps: read.input,
  });
  if (reply.status === 409 || reply.status === 422) throw refusal(reply.body);
  if (reply.status !== 200) throw unexpectedReply(reply);
  const { steps, viewers } = reply.body as ReplaceReply;
  print(
    options,
    { ok: true, steps, viewers },
    `Replaced the steps from ${options.from} on: the script has ${plural(steps, 'step')} now (${plural(viewers, 'viewer')}).`,
  );
}

/** `prwalk wait [--timeout <seconds>]` */
export async function waitCommand(options: JsonOption & { timeout?: string }): Promise<void> {
  const raw = options.timeout ?? '300';
  const seconds = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(seconds) || seconds < 0) {
    throw new UserError(`--timeout must be a number of seconds, 0 or more, got "${raw}".`);
  }
  const daemon = await requireDaemon();
  const session = await readSession(daemon);
  if (session === undefined) throw new UserError(NO_SESSION);
  if (session.playback === undefined) {
    throw new UserError(
      'No script is loaded, so there is nothing to wait for. Run prwalk play first.',
    );
  }

  const deadline = Date.now() + seconds * 1000;
  let woke = false;
  do {
    const slice = Math.max(0, Math.min(WAIT_SLICE_MS, deadline - Date.now()));
    const reply = await callDaemon(daemon, 'GET', `/api/wait?timeout=${Math.round(slice)}`);
    if (reply.status !== 200) throw unexpectedReply(reply);
    woke = (reply.body as WaitReply).woke;
  } while (!woke && Date.now() < deadline);

  const status = await readStatus(daemon);
  const nothing = `Nothing happened within ${raw} s.`;
  print(options, { ...status.json, woke }, woke ? status.text : `${nothing}\n${status.text}`);
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    throw new UserError(
      `cannot read stdin: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
