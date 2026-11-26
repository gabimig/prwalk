import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { TOKEN_HEADER } from '../server/server.js';
import { type DaemonState, ensureHome, logPath, readState } from '../server/state.js';
import { UserError } from './errors.js';

export type Daemon = { state: DaemonState; url: string };

const CLI_ENTRY = fileURLToPath(new URL('./index.js', import.meta.url));
const START_TIMEOUT_MS = 10_000;

/** The running daemon described by the state file, or undefined if it does not answer. */
export async function findDaemon(home: string): Promise<Daemon | undefined> {
  const state = readState(home);
  if (state === undefined) return undefined;
  const url = `http://127.0.0.1:${state.port}/`;
  try {
    const response = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1000) });
    const health = (await response.json()) as { pid?: unknown };
    // A different pid means another program now owns the port: treat the file as stale.
    return health.pid === state.pid ? { state, url } : undefined;
  } catch {
    return undefined;
  }
}

/** The running daemon, or a new one started in the background on `port`. */
export async function ensureDaemon(home: string, port: number): Promise<Daemon> {
  return (await findDaemon(home)) ?? (await startDaemon(home, port));
}

async function startDaemon(home: string, port: number): Promise<Daemon> {
  ensureHome(home);
  const log = openSync(logPath(home), 'a');
  const child = spawn(process.execPath, [CLI_ENTRY, 'daemon', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const daemon = await findDaemon(home);
    if (daemon !== undefined && daemon.state.pid === child.pid) {
      child.unref();
      return daemon;
    }
    if (exited) throw new UserError(`The daemon could not start: ${lastLogLine(home)}`);
    await sleep(50);
  }
  child.kill();
  throw new UserError(
    `The daemon did not answer within ${START_TIMEOUT_MS / 1000} s. See ${logPath(home)}.`,
  );
}

function lastLogLine(home: string): string {
  const lines = readFileSync(logPath(home), 'utf8').trim().split('\n');
  return lines.at(-1) ?? `see ${logPath(home)}`;
}

export type Reply = { status: number; body: unknown };

/** One API call to the daemon, with the token. Network failures become a UserError. */
export async function callDaemon(
  daemon: Daemon,
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
  const headers: Record<string, string> = { [TOKEN_HEADER]: daemon.state.token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(new URL(path, daemon.url), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // fetch only says "fetch failed"; the reason (ECONNREFUSED...) is in its cause.
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new UserError(
      `Cannot reach the daemon at ${daemon.url}: ${reason instanceof Error ? reason.message : String(reason)}. Check it with prwalk status.`,
    );
  }
  const text = await response.text();
  const type = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: type.startsWith('application/json') ? JSON.parse(text) : text,
  };
}

/** A UserError for a reply the command did not expect. */
export function unexpectedReply(reply: Reply): UserError {
  const detail =
    typeof reply.body === 'object' && reply.body !== null && 'error' in reply.body
      ? String(reply.body.error)
      : String(reply.body);
  return new UserError(`The daemon answered ${reply.status}: ${detail}`);
}
