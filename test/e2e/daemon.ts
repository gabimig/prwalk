import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import example from '../fixtures/example-script.json' with { type: 'json' };
import { tempDir } from '../git-repo.js';

const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const patch = readFileSync(new URL('../fixtures/example.diff', import.meta.url), 'utf8');

export type Daemon = {
  url: string;
  playback(): Promise<unknown>;
  /** Sends a change to the daemon's API, with the token; throws unless it answers 2xx. */
  send(method: string, path: string, body: unknown): Promise<void>;
  /** Runs the prwalk binary against this daemon and returns what it printed. */
  prwalk(...args: string[]): string;
};

let child: ChildProcess | undefined;

/** Stops the daemon the test started, if any: call it after each test. */
export function stopDaemon(): void {
  child?.kill();
  child = undefined;
}

/**
 * The real daemon on a free port, with the example diff open and the example script loaded, and
 * `config` as its config.json, if given. With `latest`, the daemon checks for a newer version and
 * finds that one, saved as checked a moment ago (so it asks nobody).
 */
export async function startDaemon(
  config?: object,
  { latest }: { latest?: string } = {},
): Promise<Daemon> {
  const home = tempDir();
  if (config !== undefined) writeFileSync(join(home, 'config.json'), JSON.stringify(config));
  const env: NodeJS.ProcessEnv = { ...process.env, PRWALK_HOME: home };
  if (latest !== undefined) {
    writeFileSync(
      join(home, 'update-check.json'),
      JSON.stringify({ checkedAt: Date.now(), latest }),
    );
    env.PRWALK_UPDATE_CHECK = '1';
  }
  child = spawn(process.execPath, [bin, 'daemon', '--port', '0'], { env, stdio: 'ignore' });
  let state: { port: number; token: string } | undefined;
  for (let tries = 0; state === undefined && tries < 200; tries++) {
    try {
      state = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
    } catch {
      await sleep(25);
    }
  }
  if (state === undefined) throw new Error('the daemon did not start');
  const url = `http://127.0.0.1:${state.port}/`;
  const send = async (method: string, path: string, body: unknown) => {
    const reply = await fetch(new URL(path, url), {
      method,
      headers: { 'x-prwalk-token': state.token },
      body: JSON.stringify(body),
    });
    if (!reply.ok) throw new Error(`${method} ${path}: ${reply.status} ${await reply.text()}`);
  };
  await send('PUT', '/api/session', {
    meta: { kind: 'patch', title: 'Add login rate limit', headRef: '', baseRef: '' },
    patch,
  });
  await send('PUT', '/api/script', example);
  const playback = async () =>
    ((await (await fetch(new URL('/api/session', url))).json()) as { playback: unknown }).playback;
  const prwalk = (...args: string[]) =>
    execFileSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
  return { url, playback, send, prwalk };
}

/** Opens the viewer with the silent voice, `speed` times faster than speech, and presses Start. */
export async function openAndStart(page: Page, daemon: Daemon, speed: number): Promise<void> {
  await page.goto(`${daemon.url}?voice=silent&speed=${speed}`);
  await page.getByRole('button', { name: 'Empezar' }).click();
}
