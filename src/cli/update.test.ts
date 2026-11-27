import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/git-repo.js';
import { INSTALL_COMMAND } from '../server/updates.js';
import { runUpdate, type UpdateTools } from './update-command.js';

/** A prwalk installed the way `npm install -g` lays it out: `<prefix>/lib/node_modules/prwalk`. */
function globalInstall() {
  const prefix = tempDir();
  const root = join(prefix, 'lib', 'node_modules', 'prwalk');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(prefix, 'bin'));
  writeFileSync(join(prefix, 'bin', 'prwalk'), '');
  return { prefix, root, bin: join(prefix, 'bin', 'prwalk') };
}

/** Tools that record what they are asked to do; `latest` is the release GitHub names. */
function fakeTools(latest: string, overrides: Partial<UpdateTools> = {}) {
  const calls: string[] = [];
  const tools: UpdateTools = {
    latest: async () => latest,
    stopDaemon: async () => {
      calls.push('stop');
      return { session: true };
    },
    install: async (prefix) => {
      calls.push(`install ${prefix}`);
    },
    versionOf: async (bin) => {
      calls.push(`version ${bin}`);
      return latest;
    },
    progress: (line) => calls.push(`progress ${line}`),
    ...overrides,
  };
  return { tools, calls };
}

describe('prwalk update', () => {
  it('does nothing when the installed version is the latest', async () => {
    const { root } = globalInstall();
    const { tools, calls } = fakeTools('0.1.2');

    const result = await runUpdate({ current: '0.1.2', packageRoot: root, tools });

    expect(result).toEqual({ updated: false, current: '0.1.2', latest: '0.1.2' });
    expect(calls).toEqual([]);
  });

  it('with --check, only says a newer version is available', async () => {
    const { root } = globalInstall();
    const { tools, calls } = fakeTools('0.2.0', {
      latest: async (check) => (check ? '0.2.0' : 'not from the saved result'),
    });

    const result = await runUpdate({ current: '0.1.2', packageRoot: root, check: true, tools });

    expect(result).toEqual({ available: true, current: '0.1.2', latest: '0.2.0' });
    expect(calls).toEqual([]);
  });

  it('stops the daemon, installs into the same npm prefix and checks the version installed', async () => {
    const { prefix, root, bin } = globalInstall();
    const { tools, calls } = fakeTools('0.2.0', {
      latest: async (check) => (check ? 'from the saved result' : '0.2.0'),
    });

    const result = await runUpdate({ current: '0.1.2', packageRoot: root, tools });

    expect(result).toEqual({ updated: true, from: '0.1.2', to: '0.2.0', reopen: true });
    expect(calls.filter((call) => !call.startsWith('progress'))).toEqual([
      'stop',
      `install ${prefix}`,
      `version ${bin}`,
    ]);
    expect(calls.filter((call) => call.startsWith('progress')).length).toBeGreaterThan(0);
  });

  it('when npm fails, says so with the command to run by hand, after stopping the daemon', async () => {
    const { root } = globalInstall();
    const { tools, calls } = fakeTools('0.2.0', {
      install: async () => {
        throw new Error('npm failed with exit code 243: EACCES: permission denied');
      },
    });

    await expect(runUpdate({ current: '0.1.2', packageRoot: root, tools })).rejects.toThrow(
      `npm could not install prwalk 0.2.0: npm failed with exit code 243: EACCES: permission denied. Install it by hand with: ${INSTALL_COMMAND}`,
    );
    expect(calls.filter((call) => !call.startsWith('progress'))).toEqual(['stop']);
  });

  it('fails when the binary npm left does not run or does not report the newer version', async () => {
    const { root, bin } = globalInstall();
    const { tools } = fakeTools('0.2.0', { versionOf: async () => '0.1.2' });

    await expect(runUpdate({ current: '0.1.2', packageRoot: root, tools })).rejects.toThrow(
      `npm finished, but the prwalk installed reports 0.1.2 instead of 0.2.0. Install it by hand with: ${INSTALL_COMMAND}`,
    );
    const broken = fakeTools('0.2.0', {
      versionOf: async () => {
        throw new Error('spawn EACCES');
      },
    });
    await expect(
      runUpdate({ current: '0.1.2', packageRoot: root, tools: broken.tools }),
    ).rejects.toThrow(
      `npm finished, but ${bin} does not run: spawn EACCES. Install it by hand with: ${INSTALL_COMMAND}`,
    );
  });

  it('touches nothing when it cannot tell the latest version', async () => {
    const { root } = globalInstall();
    const { tools, calls } = fakeTools('0.2.0', {
      latest: async () => {
        throw new Error('cannot reach github.com: getaddrinfo ENOTFOUND github.com');
      },
    });

    await expect(runUpdate({ current: '0.1.2', packageRoot: root, tools })).rejects.toThrow(
      'Cannot find out the latest version of prwalk: cannot reach github.com: getaddrinfo ENOTFOUND github.com. Check the connection, or update by hand with: ',
    );
    expect(calls).toEqual([]);
  });

  it('installs nothing when prwalk is not a global npm package', async () => {
    const checkout = tempDir();
    const { tools, calls } = fakeTools('0.2.0');

    await expect(runUpdate({ current: '0.1.2', packageRoot: checkout, tools })).rejects.toThrow(
      `prwalk 0.2.0 is available, but this prwalk runs from ${checkout}, not from a global npm install, so it does not update itself. Update it with: ${INSTALL_COMMAND}`,
    );
    expect(calls).toEqual([]);
  });
});
