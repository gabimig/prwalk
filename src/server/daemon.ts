import { randomBytes } from 'node:crypto';
import { startServer } from './server.js';
import { readConfig, removeState, writeState } from './state.js';

const DEFAULT_IDLE_MINUTES = 4 * 60;
/** The longest a timer can wait (about 24 days); longer ones would fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The daemon process: serves the API on 127.0.0.1 and publishes how to reach it in the state
 * file until it is stopped (`POST /api/stop`, SIGINT or SIGTERM) or has been idle too long.
 */
export async function runDaemon({ port, home }: { port: number; home: string }): Promise<void> {
  const idleMs = idleMsFrom(process.env);
  const token = randomBytes(32).toString('hex');
  const exit = () => {
    removeState(home, process.pid);
    process.exit(0);
  };
  const server = await startServer({
    port,
    token,
    onStop: exit,
    voice: () => readConfig(home).voice,
    log: (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`),
    ...(idleMs !== undefined && { idleMs, onIdle: exit }),
  });
  writeState(home, { pid: process.pid, port: server.port, token });
  process.on('SIGINT', exit);
  process.on('SIGTERM', exit);
  process.stdout.write(
    `prwalk daemon listening on http://127.0.0.1:${server.port}/ (pid ${process.pid})\n`,
  );
}

/**
 * How long the daemon may go with no viewer and no request before it shuts down:
 * `PRWALK_IDLE_MINUTES`, 4 hours by default. Undefined (never) for 0.
 */
export function idleMsFrom(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.PRWALK_IDLE_MINUTES ?? String(DEFAULT_IDLE_MINUTES);
  const minutes = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      `PRWALK_IDLE_MINUTES must be a number of minutes, 0 to never shut down, got "${raw}".`,
    );
  }
  return minutes === 0 ? undefined : Math.min(minutes * 60 * 1000, MAX_TIMER_MS);
}
