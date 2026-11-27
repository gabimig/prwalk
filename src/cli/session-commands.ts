import { setTimeout as sleep } from 'node:timers/promises';
import { prwalkHome } from '../server/state.js';
import { installedVersion, savedUpdate } from '../server/updates.js';
import {
  type DiffFile,
  type DiffIndex,
  type DiffLinesHunk,
  fileDiffLines,
} from '../shared/diff.js';
import type { AsideReport, PlaybackEvent } from '../shared/events.js';
import type { PlaybackState } from '../shared/playback.js';
import type { EventsReply, FocusReply, ScriptReply, VoiceReply } from '../shared/protocol.js';
import type { Script } from '../shared/script.js';
import type { SessionMeta, SessionReply, SessionView } from '../shared/session.js';
import {
  callDaemon,
  type Daemon,
  ensureDaemon,
  findDaemon,
  unexpectedReply,
} from './daemon-client.js';
import { UserError } from './errors.js';
import { githubSource } from './sources/github.js';
import { localSource } from './sources/local.js';
import { patchSource } from './sources/patch.js';
import { readScriptInput } from './validate.js';

export type JsonOption = { json?: boolean };

const DEFAULT_PORT = 4517;
export const NO_SESSION = 'No walkthrough is open. Run prwalk open first.';
const SCRIPT_LOADED =
  'A script is loaded, so prwalk focus is off. To show code while answering, use prwalk say "<answer>" --file <path> --lines <a-b>; to drop the script, prwalk play --clear.';

/** `--port`, else `PRWALK_PORT`, else 4517. */
export function resolvePort(option: string | undefined): number {
  const raw = option ?? process.env.PRWALK_PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port > 65535) {
    throw new UserError(`The port must be a number from 0 to 65535, got "${raw}".`);
  }
  return port;
}

/** `prwalk open [pr] [--base <ref>] [--patch <file> [--title <text>]] [--port <n>]` */
export async function openCommand(
  pr: string | undefined,
  options: JsonOption & { base?: string; patch?: string; title?: string; port?: string },
): Promise<void> {
  const port = resolvePort(options.port);
  if (options.patch !== undefined && (pr !== undefined || options.base !== undefined)) {
    throw new UserError('Give a PR, --patch <file> or neither (local changes), not both.');
  }
  if (options.title !== undefined && options.patch === undefined) {
    throw new UserError('--title only applies with --patch <file>.');
  }
  const source =
    options.patch !== undefined
      ? await patchSource(options.patch, options.title)
      : pr === undefined
        ? await localSource(options.base === undefined ? {} : { base: options.base })
        : await githubSource(pr);
  const daemon = await ensureDaemon(prwalkHome(), port);
  if (options.port !== undefined && port !== 0 && daemon.state.port !== port) {
    process.stderr.write(
      `A daemon is already running on port ${daemon.state.port}: reusing it instead of starting one on port ${port}.\n`,
    );
  }
  const reply = await callDaemon(daemon, 'PUT', '/api/session', source);
  if (reply.status !== 200) throw unexpectedReply(reply);
  const { meta, index } = reply.body as SessionView;
  const totals = countChanges(index);
  // From the last check saved: the daemon asks again in the background.
  const update = savedUpdate(prwalkHome(), installedVersion());
  const lines = [
    `Opened ${describeSource(meta)}: ${plural(totals.files, 'file')}, +${totals.additions} -${totals.deletions}`,
    `Viewer: ${daemon.url}`,
  ];
  if (update !== undefined) {
    lines.push(
      `prwalk ${update.latest} is available (installed: ${update.current}); see "Updates" in prwalk skill.`,
    );
  }
  print(
    options,
    { ok: true, meta, ...totals, url: daemon.url, ...(update !== undefined && { update }) },
    lines.join('\n'),
  );
}

/** `prwalk status` */
export async function statusCommand(options: JsonOption): Promise<void> {
  const daemon = await findDaemon(prwalkHome());
  if (daemon === undefined) {
    print(options, { running: false }, 'No daemon running.');
    return;
  }
  const status = await readStatus(daemon);
  print(options, status.json, status.text);
}

/**
 * What `prwalk status` prints for a running daemon. Reading it hands out the events the agent
 * has not seen yet, so the next status (or wait) only shows newer ones.
 */
export async function readStatus(daemon: Daemon): Promise<{ json: object; text: string }> {
  const session = await readSession(daemon);
  const running = `Daemon running at ${daemon.url} (pid ${daemon.state.pid})`;
  const base = { running: true, pid: daemon.state.pid, url: daemon.url };
  if (session === undefined) {
    return {
      json: { ...base, session: null },
      text: `${running}\nSession: none. Run prwalk open.`,
    };
  }
  const files = session.index.files.length;
  const playback = await describePlayback(daemon, session.playback);
  const lines = [
    running,
    `Session: ${describeSource(session.meta)}, ${plural(files, 'file')}`,
    `Viewers: ${session.viewers}`,
    `Playback: ${playback === null ? 'no script loaded' : formatPlayback(playback)}`,
  ];
  const reply = await callDaemon(daemon, 'POST', '/api/events', {});
  if (reply.status !== 200) throw unexpectedReply(reply);
  const { events } = reply.body as EventsReply;
  const voice = await readVoice(daemon);
  const failing = voiceFailureLine(voice);
  if (failing !== undefined) lines.push(failing);
  const aside = session.aside ?? null;
  if (playback !== null) {
    lines.push(`Sentence: ${JSON.stringify(playback.text)}`, `Aside: ${formatAside(aside)}`);
  }
  if (playback !== null || events.length > 0) {
    lines.push(
      events.length === 0
        ? 'Events: none'
        : ['Events:', ...events.map((event) => `  ${formatEvent(event)}`)].join('\n'),
    );
  }
  const { text: sentence, ...summary } = playback ?? { text: null };
  return {
    json: {
      ...base,
      session: { meta: session.meta, files },
      viewers: session.viewers,
      playback: playback === null ? null : summary,
      sentence,
      aside,
      events,
      ...(voice.failure !== null && { voice }),
    },
    text: lines.join('\n'),
  };
}

/** Where the playback is, counted from 1 for people and agents alike; `text` is the sentence's. */
type PlaybackSummary = {
  status: PlaybackState['status'];
  step: number;
  steps: number;
  id: string;
  sentence: number;
  sentences: number;
  text: string;
};

export async function describePlayback(
  daemon: Daemon,
  position: PlaybackState | undefined,
): Promise<PlaybackSummary | null> {
  if (position === undefined) return null;
  const reply = await callDaemon(daemon, 'GET', '/api/script');
  // The script was unloaded between the two calls.
  if (reply.status === 404) return null;
  if (reply.status !== 200) throw unexpectedReply(reply);
  const { steps } = reply.body as Script;
  const step = steps[position.step];
  const said = step?.say[position.sentence];
  if (step === undefined || said === undefined) return null;
  return {
    status: position.status,
    step: position.step + 1,
    steps: steps.length,
    id: step.id,
    sentence: position.sentence + 1,
    sentences: step.say.length,
    text: typeof said === 'string' ? said : said.text,
  };
}

export function formatPlayback(playback: PlaybackSummary): string {
  const status = playback.status === 'idle' ? 'not started' : playback.status;
  return `${status}, step ${playback.step} of ${playback.steps} ${JSON.stringify(playback.id)}, sentence ${playback.sentence} of ${playback.sentences}`;
}

function formatAside(aside: AsideReport | null): string {
  if (aside === null) return 'none';
  return `${aside.status}, ${plural(aside.answers, 'answer')} to say`;
}

/** `user paused at step 3 "limiter-failures", sentence 2`, steps and sentences counted from 1. */
function formatEvent(event: PlaybackEvent): string {
  const at = `step ${event.step + 1} ${JSON.stringify(event.id)}, sentence ${event.sentence + 1}`;
  if (event.kind === 'jumped' && event.from !== undefined) {
    return `${event.cause} jumped from step ${event.from + 1} ${JSON.stringify(event.fromId ?? '')} to ${at}`;
  }
  return `${event.cause} ${event.kind} at ${at}`;
}

/** `prwalk play <file | ->` or `prwalk play --clear` */
export async function playCommand(
  file: string | undefined,
  options: JsonOption & { clear?: boolean },
): Promise<void> {
  if (options.clear ? file !== undefined : file === undefined) {
    throw new UserError(
      'Give a script file (or - for stdin), like prwalk play walkthrough.json, or --clear.',
    );
  }
  let script: unknown;
  if (file !== undefined) {
    const read = readScriptInput(file);
    if (!read.ok) throw UserError.list(read.errors);
    script = read.input;
  }

  const daemon = await findDaemon(prwalkHome());
  if (daemon === undefined) throw new UserError(NO_SESSION);
  if (script === undefined) {
    const reply = await callDaemon(daemon, 'DELETE', '/api/script');
    if (reply.status !== 200) throw unexpectedReply(reply);
    print(options, { ok: true }, 'Script unloaded.');
    return;
  }

  const reply = await callDaemon(daemon, 'PUT', '/api/script', script);
  if (reply.status === 409) throw new UserError(NO_SESSION);
  if (reply.status === 422) throw UserError.list((reply.body as { errors: string[] }).errors);
  if (reply.status !== 200) throw unexpectedReply(reply);
  const { steps, viewers } = reply.body as ScriptReply;
  print(
    options,
    { ok: true, steps, viewers },
    `Loaded ${plural(steps, 'step')} (${plural(viewers, 'viewer')}). The viewer starts when the user presses Start.`,
  );
  if (viewers === 0) {
    process.stderr.write(`No viewer is open: open ${daemon.url} in a browser to see it.\n`);
  }
}

/** `prwalk focus <file> --lines <a-b> [--side old]` or `prwalk focus --clear` */
export async function focusCommand(
  file: string | undefined,
  options: JsonOption & { lines?: string; side?: string; clear?: boolean },
): Promise<void> {
  const usage = 'Give a file and --lines, like prwalk focus src/app.ts --lines 12-18, or --clear.';
  if (options.clear ? file !== undefined : file === undefined || options.lines === undefined) {
    throw new UserError(usage);
  }
  if (options.side !== undefined && options.side !== 'new' && options.side !== 'old') {
    throw new UserError(`--side must be new or old, got "${options.side}".`);
  }
  const focus =
    file === undefined
      ? null
      : {
          file,
          lines: parseLines(options.lines ?? ''),
          ...(options.side && { side: options.side }),
        };

  const daemon = await findDaemon(prwalkHome());
  if (daemon === undefined) throw new UserError(NO_SESSION);
  const reply = await callDaemon(daemon, 'POST', '/api/focus', { focus });
  if (reply.status === 404) throw new UserError(NO_SESSION);
  if (reply.status === 409) throw new UserError(SCRIPT_LOADED);
  if (reply.status === 422) throw new UserError(String((reply.body as { error: unknown }).error));
  if (reply.status !== 200) throw unexpectedReply(reply);

  const result = reply.body as FocusReply;
  const viewers = plural(result.viewers, 'viewer');
  const shown = result.focus;
  const line =
    shown === null
      ? `Focus cleared (${viewers})`
      : `Focused ${shown.file} ${shown.lines[0]}-${shown.lines[1]}${shown.side === 'old' ? ' (old side)' : ''} (${viewers})`;
  print(options, { ok: true, ...result }, line);
  if (result.viewers === 0) {
    process.stderr.write(`No viewer is open: open ${daemon.url} in a browser to see it.\n`);
  }
}

/** `12-18` or `12` (one line). */
export function parseLines(raw: string): [number, number] {
  const match = /^(\d+)(?:-(\d+))?$/.exec(raw);
  const start = Number(match?.[1]);
  const end = Number(match?.[2] ?? match?.[1]);
  if (match === null || start < 1 || end < start) {
    throw new UserError(
      `--lines must be a range like 12-18 or one line like 12, starting at 1, got "${raw}".`,
    );
  }
  return [start, end];
}

/** `prwalk stop` */
export async function stopCommand(options: JsonOption): Promise<void> {
  const daemon = await findDaemon(prwalkHome());
  if (daemon === undefined) {
    print(options, { stopped: false }, 'No daemon running.');
    return;
  }
  const reply = await callDaemon(daemon, 'POST', '/api/stop');
  if (reply.status !== 200) throw unexpectedReply(reply);
  await waitForExit(daemon.state.pid);
  print(options, { stopped: true }, 'Daemon stopped.');
}

/** `prwalk diff [--file <path>]` */
export async function diffCommand(options: JsonOption & { file?: string }): Promise<void> {
  const daemon = await findDaemon(prwalkHome());
  const session = daemon === undefined ? undefined : await readSession(daemon);
  if (daemon === undefined || session === undefined) throw new UserError(NO_SESSION);

  if (options.file === undefined) {
    print(options, session.index, session.index.files.map(formatFile).join('\n'));
    return;
  }

  const file = session.index.files.find((candidate) => candidate.path === options.file);
  const reply = await callDaemon(daemon, 'GET', '/api/diff');
  if (reply.status !== 200) throw unexpectedReply(reply);
  const hunks = file && fileDiffLines(String(reply.body), file.path);
  if (file === undefined || hunks === undefined) {
    const paths = session.index.files.map((candidate) => `  ${candidate.path}`).join('\n');
    throw new UserError(`"${options.file}" is not in the diff. Files in the diff:\n${paths}`);
  }
  print(options, { ...file, hunks }, formatFileLines(file, hunks));
}

/** The line `prwalk status` adds when the voice is failing, or undefined. */
export function voiceFailureLine(reply: VoiceReply): string | undefined {
  if (reply.failure === null) return undefined;
  if (reply.provider.kind === 'browser') return `Voice: browser. ${reply.failure}`;
  return `Voice: ${reply.provider.name} is failing: ${reply.failure}`;
}

async function readVoice(daemon: Daemon): Promise<VoiceReply> {
  const reply = await callDaemon(daemon, 'GET', '/api/voice');
  if (reply.status !== 200) throw unexpectedReply(reply);
  return reply.body as VoiceReply;
}

export async function readSession(daemon: Daemon): Promise<SessionReply | undefined> {
  const reply = await callDaemon(daemon, 'GET', '/api/session');
  if (reply.status === 404) return undefined;
  if (reply.status !== 200) throw unexpectedReply(reply);
  return reply.body as SessionReply;
}

export async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(25);
  }
  throw new UserError(`The daemon (pid ${pid}) did not exit within 5 s.`);
}

function describeSource(meta: SessionMeta): string {
  if (meta.kind === 'github') return `PR #${meta.number} "${meta.title}"`;
  if (meta.kind === 'patch') return `patch ${JSON.stringify(meta.title)}`;
  return `local changes on ${meta.headRef} (base ${meta.baseRef})`;
}

function countChanges(index: DiffIndex) {
  let additions = 0;
  let deletions = 0;
  for (const file of index.files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { files: index.files.length, additions, deletions };
}

function formatFile(file: DiffFile): string {
  const from = file.oldPath === undefined ? '' : ` (from ${file.oldPath})`;
  const binary = file.binary ? ' (binary)' : '';
  const hunks = file.hunks.map(
    (hunk) =>
      `\n  new ${range(hunk.newStart, hunk.newLines)}, old ${range(hunk.oldStart, hunk.oldLines)}`,
  );
  return `${file.status} ${file.path}${from}${binary} +${file.additions} -${file.deletions}${hunks.join('')}`;
}

function range(start: number, lines: number): string {
  return lines === 0 ? 'none' : `${start}-${start + lines - 1}`;
}

/** Each line with its old and new numbers in front, so ranges can be read off directly. */
function formatFileLines(file: DiffFile, hunks: DiffLinesHunk[]): string {
  const out = [`${file.path} (${file.status}, +${file.additions} -${file.deletions})`];
  if (file.binary) out.push('Binary file: no lines to show.');
  else if (hunks.length === 0) out.push('No line changes.');
  let widest = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      widest = Math.max(widest, 'old' in line ? line.old : 0, 'new' in line ? line.new : 0);
    }
  }
  const width = String(widest).length;
  const marker = { context: ' ', deletion: '-', addition: '+' } as const;
  for (const hunk of hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) {
      const oldNumber = 'old' in line ? String(line.old) : '';
      const newNumber = 'new' in line ? String(line.new) : '';
      const prefix = `${oldNumber.padStart(width)} ${newNumber.padStart(width)} ${marker[line.type]}`;
      out.push(line.text === '' ? prefix : `${prefix} ${line.text}`);
    }
  }
  return out.join('\n');
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function print(options: JsonOption, json: unknown, text: string): void {
  process.stdout.write(options.json ? `${JSON.stringify(json)}\n` : `${text}\n`);
}
