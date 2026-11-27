import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import {
  checkForUpdate,
  isNewer,
  latestVersion,
  RELEASES_URL,
  versionFromLocation,
} from './updates.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-27T12:00:00Z');

/** A fetch that answers GitHub's redirect to `tag`, and counts the requests it got. */
function redirectTo(tag: string) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(null, {
      status: 302,
      headers: { location: `https://github.com/gabimig/prwalk/releases/tag/${tag}` },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const env = {} as NodeJS.ProcessEnv;

describe('versions', () => {
  it('counts only a higher X.Y.Z, compared number by number, as newer', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.2', '0.1.2')).toBe(false);
    expect(isNewer('0.1.1', '0.1.2')).toBe(false);
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(false);
    expect(isNewer('latest', '0.1.0')).toBe(false);
  });

  it('reads the version from the tag the latest release redirects to', () => {
    const at = (tag: string) => `https://github.com/gabimig/prwalk/releases/tag/${tag}`;
    expect(versionFromLocation(at('v0.2.0'))).toBe('0.2.0');
    expect(versionFromLocation(at('v0.2.0-rc.1'))).toBeUndefined();
    expect(versionFromLocation(at('0.2.0'))).toBeUndefined();
    expect(versionFromLocation('https://github.com/gabimig/prwalk/releases')).toBeUndefined();
    expect(versionFromLocation(null)).toBeUndefined();
  });
});

describe('checkForUpdate', () => {
  it('answers from update-check.json while it is less than a day old, unless asked for a fresh answer', async () => {
    const home = tempDir();
    const file = join(home, 'update-check.json');
    writeFileSync(file, JSON.stringify({ checkedAt: NOW - DAY + 60_000, latest: '0.2.0' }));
    const { fetch, requests } = redirectTo('v9.0.0');

    const update = await checkForUpdate({ home, current: '0.1.2', env, now: NOW, fetch });

    expect(update).toEqual({ current: '0.1.2', latest: '0.2.0' });
    expect(requests).toEqual([]);
    expect(await latestVersion({ home, now: NOW, fetch, fresh: true })).toBe('9.0.0');
    expect(requests).toHaveLength(1);
  });

  it('asks GitHub once the result is a day old, with nothing about the user, and saves it', async () => {
    const home = tempDir();
    const file = join(home, 'update-check.json');
    writeFileSync(file, JSON.stringify({ checkedAt: NOW - DAY - 1, latest: '0.2.0' }));
    const { fetch, requests } = redirectTo('v0.3.0');

    const update = await checkForUpdate({ home, current: '0.1.2', env, now: NOW, fetch });

    expect(update).toEqual({ current: '0.1.2', latest: '0.3.0' });
    expect(requests).toEqual([
      {
        url: RELEASES_URL,
        init: expect.objectContaining({
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': 'prwalk' },
        }),
      },
    ]);
    expect(requests[0]?.init?.body).toBeUndefined();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ checkedAt: NOW, latest: '0.3.0' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('says nothing, without throwing, when the file is corrupt and GitHub does not answer in time', async () => {
    const home = tempDir();
    writeFileSync(join(home, 'update-check.json'), '{"checkedAt":');
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof globalThis.fetch;

    const update = await checkForUpdate({
      home,
      current: '0.1.2',
      env,
      now: NOW,
      fetch: hanging,
      timeoutMs: 20,
    });

    expect(update).toBeUndefined();
    // The failure counts as the day's check: no more requests until it is a day old.
    const { fetch, requests } = redirectTo('v0.3.0');
    const later = { home, current: '0.1.2', env, fetch };
    expect(await checkForUpdate({ ...later, now: NOW + DAY - 1 })).toBeUndefined();
    expect(requests).toEqual([]);
    expect(await checkForUpdate({ ...later, now: NOW + DAY })).toEqual({
      current: '0.1.2',
      latest: '0.3.0',
    });
  });

  it('neither asks nor reads the file with PRWALK_UPDATE_CHECK=0', async () => {
    const home = tempDir();
    writeFileSync(
      join(home, 'update-check.json'),
      JSON.stringify({ checkedAt: NOW, latest: '0.2.0' }),
    );
    const { fetch, requests } = redirectTo('v0.3.0');

    const update = await checkForUpdate({
      home,
      current: '0.1.2',
      env: { PRWALK_UPDATE_CHECK: '0' },
      now: NOW,
      fetch,
    });

    expect(update).toBeUndefined();
    expect(requests).toEqual([]);
  });
});
