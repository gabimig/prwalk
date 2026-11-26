import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { downloadArchive, run } from './voice-download.js';

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** A local server that answers every request with `status` and `body`. */
async function serve(status: number, body: Buffer): Promise<string> {
  const server = createServer((_, response) => response.writeHead(status).end(body));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/model.tar.bz2`;
}

/** A .tar.bz2 with `model/voice.txt` in it. */
function archive(): Buffer {
  const dir = tempDir();
  mkdirSync(join(dir, 'model'));
  writeFileSync(join(dir, 'model', 'voice.txt'), 'weights');
  execFileSync('tar', ['-cjf', 'model.tar.bz2', 'model'], { cwd: dir });
  return readFileSync(join(dir, 'model.tar.bz2'));
}

describe('running a program', () => {
  it('says when the program is not there', async () => {
    await expect(run('prwalk-no-such-program', [], tempDir())).rejects.toThrow(
      'prwalk-no-such-program was not found. Install it, or put it on the PATH.',
    );
  });

  it('says how it exited and the end of what it wrote', async () => {
    await expect(
      run(process.execPath, ['-e', 'console.error("first\\nlast"); process.exit(3)'], tempDir()),
    ).rejects.toThrow(`${process.execPath} failed with exit code 3: first\nlast`);
  });
});

describe('downloading a model', () => {
  it('downloads and unpacks the archive, leaving nothing else behind', async () => {
    const into = join(tempDir(), 'model.partial');
    await downloadArchive(await serve(200, archive()), into);
    expect(readFileSync(join(into, 'model', 'voice.txt'), 'utf8')).toBe('weights');
    expect(readdirSync(join(into, '..'))).toEqual(['model.partial']);
  });

  it('says what the server answered', async () => {
    const url = await serve(404, Buffer.from('not here'));
    await expect(downloadArchive(url, join(tempDir(), 'model'))).rejects.toThrow(
      `${url} answered 404.`,
    );
  });

  it('says when the server cannot be reached', async () => {
    const url = await serve(200, Buffer.alloc(0));
    servers[0]?.close();
    servers.splice(0);
    await expect(downloadArchive(url, join(tempDir(), 'model'))).rejects.toThrow(
      new RegExp(`^Cannot reach ${url.replaceAll('.', '\\.')}: `),
    );
  });

  it('removes the download when the archive does not unpack', async () => {
    const into = join(tempDir(), 'model.partial');
    await expect(downloadArchive(await serve(200, Buffer.from('not bz2')), into)).rejects.toThrow(
      /^tar failed with exit code \d+: /,
    );
    expect(existsSync(join(into, '..', 'model.partial.tar.bz2'))).toBe(false);
  });
});
