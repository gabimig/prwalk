import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { startServer } from '../server/server.js';
import { writeState } from '../server/state.js';
import { callDaemon, findDaemon, unexpectedReply } from './daemon-client.js';

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function daemonAt(port: number, token: string) {
  return { state: { pid: process.pid, port, token }, url: `http://127.0.0.1:${port}/` };
}

describe('daemon client', () => {
  it('ignores a state file whose daemon no longer answers', async () => {
    const home = tempDir();
    writeState(home, { pid: 999_999, port: await closedPort(), token: 'stale' });
    expect(await findDaemon(home)).toBeUndefined();
  });

  it('ignores a state file whose port is answered by another process', async () => {
    const server = await startServer({ port: 0, token: 'other' });
    try {
      const home = tempDir();
      writeState(home, { pid: process.pid + 1, port: server.port, token: 'other' });
      expect(await findDaemon(home)).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('turns a daemon that went away into a message', async () => {
    const port = await closedPort();
    await expect(callDaemon(daemonAt(port, 'token'), 'GET', '/api/session')).rejects.toThrow(
      `Cannot reach the daemon at http://127.0.0.1:${port}/: connect ECONNREFUSED 127.0.0.1:${port}. Check it with prwalk status.`,
    );
  });

  it('turns an error reply into a message with the daemon reason', async () => {
    const server = await startServer({ port: 0, token: 'right' });
    try {
      const reply = await callDaemon(daemonAt(server.port, 'wrong'), 'POST', '/api/stop');
      expect(unexpectedReply(reply).message).toBe(
        'The daemon answered 401: missing or wrong token',
      );
    } finally {
      await server.close();
    }
  });
});
