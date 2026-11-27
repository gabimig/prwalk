import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prwalkHome } from '../server/state.js';
import {
  INSTALL_COMMAND,
  installedVersion,
  isNewer,
  latestVersion,
  PACKAGE_URL,
} from '../server/updates.js';
import { callDaemon, findDaemon, unexpectedReply } from './daemon-client.js';
import { UserError } from './errors.js';
import { type JsonOption, print, readSession, waitForExit } from './session-commands.js';
import { run } from './voice-download.js';

/** What `prwalk update` does outside itself, replaced in the tests. */
export type UpdateTools = {
  /**
   * The latest released version: asked now, or with `check` from a result less than a day old.
   * Throws saying why it cannot tell.
   */
  latest: (check: boolean) => Promise<string>;
  /** Stops the running daemon, saying whether it held a session; undefined if none was running. */
  stopDaemon: () => Promise<{ session: boolean } | undefined>;
  /** `npm install -g` of the latest release into this npm prefix. */
  install: (prefix: string) => Promise<void>;
  /** What this prwalk binary says with --version. */
  versionOf: (bin: string) => Promise<string>;
  /** Says how it goes, on stderr. */
  progress: (line: string) => void;
};

export type UpdateResult =
  | { updated: false; current: string; latest: string }
  | { available: true; current: string; latest: string }
  | { updated: true; from: string; to: string; reopen: boolean };

/**
 * Where npm installed this prwalk globally: `<prefix>/lib/node_modules/prwalk` with its binary in
 * `<prefix>/bin/prwalk`, or on Windows `<prefix>/node_modules/prwalk` with `<prefix>/prwalk.cmd`.
 * Undefined for anything else, like a checkout of the repository or a project's dependency.
 */
export function globalInstall(
  packageRoot: string,
  platform: NodeJS.Platform = process.platform,
): { prefix: string; bin: string } | undefined {
  const modules = dirname(packageRoot);
  if (basename(packageRoot) !== 'prwalk' || basename(modules) !== 'node_modules') return undefined;
  const windows = platform === 'win32';
  if (!windows && basename(dirname(modules)) !== 'lib') return undefined;
  const prefix = windows ? dirname(modules) : dirname(dirname(modules));
  const bin = windows ? join(prefix, 'prwalk.cmd') : join(prefix, 'bin', 'prwalk');
  return existsSync(bin) ? { prefix, bin } : undefined;
}

/**
 * Updates prwalk to the latest release, if it is newer: stops the daemon (it runs the old code),
 * installs with npm into the prefix this prwalk was installed in, and checks the version that
 * binary reports. With `check`, only says whether there is a newer one.
 */
export async function runUpdate({
  current,
  packageRoot,
  check = false,
  tools,
}: {
  current: string;
  packageRoot: string;
  check?: boolean;
  tools: UpdateTools;
}): Promise<UpdateResult> {
  let latest: string;
  try {
    latest = await tools.latest(check);
  } catch (error) {
    throw new UserError(
      `Cannot find out the latest version of prwalk: ${messageOf(error)}. Check the connection, or update by hand with: ${INSTALL_COMMAND}`,
    );
  }
  if (!isNewer(latest, current)) return { updated: false, current, latest };
  if (check) return { available: true, current, latest };

  const target = globalInstall(packageRoot);
  if (target === undefined) {
    throw new UserError(
      `prwalk ${latest} is available, but this prwalk runs from ${packageRoot}, not from a global npm install, so it does not update itself. Update it with: ${INSTALL_COMMAND}`,
    );
  }
  const byHand = `Install it by hand with: ${INSTALL_COMMAND}`;

  tools.progress('Stopping the prwalk daemon, if it is running…');
  const stopped = await tools.stopDaemon();
  tools.progress(`Installing prwalk ${latest} with npm into ${target.prefix}…`);
  try {
    await tools.install(target.prefix);
  } catch (error) {
    throw new UserError(`npm could not install prwalk ${latest}: ${messageOf(error)}. ${byHand}`);
  }
  tools.progress(`Checking ${target.bin} --version…`);
  let to: string;
  try {
    to = await tools.versionOf(target.bin);
  } catch (error) {
    throw new UserError(
      `npm finished, but ${target.bin} does not run: ${messageOf(error)}. ${byHand}`,
    );
  }
  if (!isNewer(to, current)) {
    throw new UserError(
      `npm finished, but the prwalk installed reports ${to} instead of ${latest}. ${byHand}`,
    );
  }
  return { updated: true, from: current, to, reopen: stopped?.session ?? false };
}

const realTools: UpdateTools = {
  latest: (check) => latestVersion({ home: prwalkHome(), fresh: !check }),
  async stopDaemon() {
    const daemon = await findDaemon(prwalkHome());
    if (daemon === undefined) return undefined;
    const session = (await readSession(daemon)) !== undefined;
    const reply = await callDaemon(daemon, 'POST', '/api/stop');
    if (reply.status !== 200) throw unexpectedReply(reply);
    await waitForExit(daemon.state.pid);
    return { session };
  },
  install: (prefix) =>
    run(
      'npm',
      [
        'install',
        '--global',
        '--prefix',
        prefix,
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        PACKAGE_URL,
      ],
      tmpdir(),
    ),
  async versionOf(bin) {
    const { stdout } = await promisify(execFile)(bin, ['--version'], {
      shell: process.platform === 'win32',
    });
    return stdout.trim();
  },
  progress: (line) => process.stderr.write(`${line}\n`),
};

/** `prwalk update [--check]` */
export async function updateCommand(options: JsonOption & { check?: boolean }): Promise<void> {
  const result = await runUpdate({
    current: installedVersion(),
    packageRoot: fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, ''),
    check: options.check ?? false,
    tools: realTools,
  });
  if ('available' in result) {
    print(
      options,
      { ok: true, ...result },
      `prwalk ${result.latest} is available (installed: ${result.current}). Run prwalk update to install it.`,
    );
  } else if (!result.updated) {
    print(
      options,
      { ok: true, available: false, ...result },
      `prwalk ${result.current} is up to date (latest release: ${result.latest}).`,
    );
  } else {
    const reopen = result.reopen
      ? '\nThe daemon was stopped, and the walkthrough with it: open it again with prwalk open and load the script again with prwalk play.'
      : '';
    print(
      options,
      { ok: true, ...result },
      `Updated prwalk ${result.from} -> ${result.to}${reopen}`,
    );
  }
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');
}
