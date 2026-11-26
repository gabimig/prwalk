import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/** How the CLI finds and talks to the running daemon: `<home>/daemon.json`. */
export type DaemonState = { pid: number; port: number; token: string };

/** `PRWALK_HOME`, or `~/.prwalk`. Holds the state file and the daemon log. */
export function prwalkHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRWALK_HOME || join(homedir(), '.prwalk');
}

export function ensureHome(home: string): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
}

export function logPath(home: string): string {
  return join(home, 'daemon.log');
}

function statePath(home: string): string {
  return join(home, 'daemon.json');
}

/** The state file, or undefined when it is missing or unreadable. */
export function readState(home: string): DaemonState | undefined {
  try {
    const state = JSON.parse(readFileSync(statePath(home), 'utf8')) as Partial<DaemonState>;
    const { pid, port, token } = state;
    if (typeof pid !== 'number' || typeof port !== 'number' || typeof token !== 'string') {
      return undefined;
    }
    return { pid, port, token };
  } catch {
    return undefined;
  }
}

/** Writes the state file readable by its owner only: the token in it allows changes. */
export function writeState(home: string, state: DaemonState): void {
  ensureHome(home);
  const path = statePath(home);
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Removes the state file if it still belongs to `pid` (a newer daemon may have replaced it). */
export function removeState(home: string, pid: number): void {
  if (readState(home)?.pid === pid) rmSync(statePath(home), { force: true });
}

/**
 * The voice the user chose: `"browser"`, or the absolute path of an adapter module the daemon
 * loads, with the options it is given.
 */
export type VoiceConfig = { provider: string; options: Record<string, string> };

/** `<home>/config.json`. No `voice` means the user has not chosen one yet. */
export type Config = { voice?: VoiceConfig };

const configSchema = z.looseObject({
  voice: z
    .strictObject({
      provider: z.string().min(1),
      options: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
});

export function configPath(home: string): string {
  return join(home, 'config.json');
}

/** The configuration; empty when the file is missing. Throws, saying how to fix it, if invalid. */
export function readConfig(home: string): Config {
  const path = configPath(home);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  try {
    const { voice } = configSchema.parse(JSON.parse(text));
    return voice === undefined ? {} : { voice };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid (${reason}). Fix it, or delete it to start over.`);
  }
}

/** Saves the voice, keeping anything else in the file, readable by its owner only. */
export function writeVoiceConfig(home: string, voice: VoiceConfig): void {
  ensureHome(home);
  const path = configPath(home);
  let rest: Record<string, unknown> = {};
  try {
    rest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {}
  writeFileSync(path, `${JSON.stringify({ ...rest, voice }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
