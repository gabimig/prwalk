import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureHome } from './state.js';

/**
 * Whether a newer prwalk has been released. The only request prwalk makes on its own: at most once
 * a day, `GET` the latest release on GitHub without following its redirect, which names the tag.
 * Nothing about the user goes with it. Any failure means "not known", and nothing is said.
 */

/** Redirects to `/releases/tag/vX.Y.Z`. Not api.github.com: it limits requests without a login. */
export const RELEASES_URL = 'https://github.com/gabimig/prwalk/releases/latest';
/** What the README installs from, and what `prwalk update` installs. */
export const PACKAGE_URL = 'https://github.com/gabimig/prwalk/releases/latest/download/prwalk.tgz';
export const INSTALL_COMMAND = `npm install -g ${PACKAGE_URL}`;

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 2000;

/** The version installed and a newer one released. */
export type UpdateInfo = { current: string; latest: string };

/** The version of this package, as `prwalk --version` prints it. */
export function installedVersion(): string {
  const manifest = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

function parse(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match === null ? undefined : match.slice(1).map(Number);
}

/** True only when both are `X.Y.Z` and `latest` is higher, number by number. */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (a === undefined || b === undefined) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** `X.Y.Z` from a `Location` ending in `/releases/tag/vX.Y.Z`; any other tag is ignored. */
export function versionFromLocation(location: string | null): string | undefined {
  const match = /\/releases\/tag\/v(\d+\.\d+\.\d+)$/.exec(location ?? '');
  return match?.[1];
}

/** Asks GitHub for the latest released version. Throws, saying why, if it cannot tell. */
export async function fetchLatestVersion(
  fetch: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  let reply: Response;
  try {
    reply = await fetch(RELEASES_URL, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'prwalk' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new Error(`cannot reach github.com: ${cause instanceof Error ? cause.message : cause}`);
  }
  const version = versionFromLocation(reply.headers.get('location'));
  if (version === undefined) {
    throw new Error(`github.com answered ${reply.status} without a release tag`);
  }
  return version;
}

const checkPath = (home: string) => join(home, 'update-check.json');

const disabled = (env: NodeJS.ProcessEnv) => env.PRWALK_UPDATE_CHECK === '0';

type Saved = { checkedAt: number; latest: string };

function readSaved(home: string): Saved | undefined {
  try {
    const saved = JSON.parse(readFileSync(checkPath(home), 'utf8')) as Partial<Saved>;
    if (typeof saved.checkedAt !== 'number' || typeof saved.latest !== 'string') return undefined;
    return { checkedAt: saved.checkedAt, latest: saved.latest };
  } catch {
    return undefined;
  }
}

function save(home: string, saved: Saved): void {
  ensureHome(home);
  const path = checkPath(home);
  writeFileSync(path, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const newer = (current: string, latest: string | undefined): UpdateInfo | undefined =>
  latest !== undefined && isNewer(latest, current) ? { current, latest } : undefined;

export type CheckOptions = {
  home: string;
  current: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/**
 * The newer version, if there is one. Answers from `<home>/update-check.json` while it is less
 * than a day old; otherwise asks GitHub and saves the answer. Never throws: anything that goes
 * wrong is undefined, like being up to date. `PRWALK_UPDATE_CHECK=0` turns it off.
 */
export async function checkForUpdate(options: CheckOptions): Promise<UpdateInfo | undefined> {
  const { home, current, env = process.env, now = Date.now() } = options;
  if (disabled(env)) return undefined;
  const saved = readSaved(home);
  if (saved !== undefined && now - saved.checkedAt >= 0 && now - saved.checkedAt < CHECK_EVERY_MS) {
    return newer(current, saved.latest);
  }
  try {
    const latest = await fetchLatestVersion(options.fetch, options.timeoutMs);
    try {
      save(home, { checkedAt: now, latest });
    } catch {}
    return newer(current, latest);
  } catch {
    return undefined;
  }
}

/** The newer version as last saved, whatever its age, without asking: for `prwalk open`. */
export function savedUpdate(
  home: string,
  current: string,
  env: NodeJS.ProcessEnv = process.env,
): UpdateInfo | undefined {
  if (disabled(env)) return undefined;
  return newer(current, readSaved(home)?.latest);
}
