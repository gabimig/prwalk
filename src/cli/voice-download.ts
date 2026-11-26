import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { InstallTools } from './voice-catalog.js';

/** The real installer: npm for the engine, fetch and tar for the model. */
export const realTools: InstallTools = {
  installDependencies: (dir) =>
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir),
  download: downloadArchive,
};

/**
 * Runs `command` in `cwd` and resolves when it exits with 0. Otherwise rejects saying whether it
 * was missing or how it exited, with the last lines it wrote to stderr.
 */
export function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // npm is a .cmd script on Windows, which only starts through a shell.
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(`${command} was not found. Install it, or put it on the PATH.`)
          : error,
      );
    });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const tail = stderr.trim().split('\n').slice(-5).join('\n');
      reject(new Error(`${command} failed with exit code ${code}: ${tail}`));
    });
  });
}

/**
 * Downloads the .tar.bz2 at `url` next to `into` and unpacks it into `into` (created), then
 * deletes the archive, whether it unpacked or not.
 */
export async function downloadArchive(url: string, into: string): Promise<void> {
  let reply: Response;
  try {
    reply = await fetch(url);
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    throw new Error(`Cannot reach ${url}: ${messageOf(cause ?? error)}`);
  }
  if (!reply.ok || reply.body === null) throw new Error(`${url} answered ${reply.status}.`);
  const archive = `${into}.tar.bz2`;
  try {
    await pipeline(
      Readable.fromWeb(reply.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(archive),
    );
    await mkdir(into, { recursive: true });
    await run('tar', ['-xjf', archive, '-C', into], into);
  } finally {
    await rm(archive, { force: true });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
