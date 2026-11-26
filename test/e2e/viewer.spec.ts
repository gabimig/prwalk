import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { tempDir } from '../git-repo.js';

const bin = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const sample = readFileSync(new URL('../fixtures/sample.diff', import.meta.url), 'utf8');

/** A new file long enough that a focus near its end has to scroll. */
const LONG_LINES = 300;
const longFile = [
  'diff --git a/src/long.ts b/src/long.ts',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/src/long.ts',
  `@@ -0,0 +1,${LONG_LINES} @@`,
  ...Array.from({ length: LONG_LINES }, (_, i) => `+export const line${i + 1} = ${i + 1};`),
  '',
].join('\n');

/** A rename with long paths on both sides, for the narrow panel. */
const OLD_PATH = 'src/features/authentication/legacy/session-token-refresh-handler.ts';
const NEW_PATH = 'src/features/authentication/session/refresh-session-token-on-expiry.ts';
const longRename = [
  `diff --git a/${OLD_PATH} b/${NEW_PATH}`,
  'similarity index 90%',
  `rename from ${OLD_PATH}`,
  `rename to ${NEW_PATH}`,
  'index 1111111..2222222 100644',
  `--- a/${OLD_PATH}`,
  `+++ b/${NEW_PATH}`,
  '@@ -120,3 +120,3 @@',
  ' const before = 1;',
  '-const retries = 3;',
  '+const retries = 5;',
  ' const after = 2;',
  '',
].join('\n');

const TITLE = 'Limit <b>logins</b> & "retries"';

type Daemon = { url: string; focus(focus: unknown): Promise<void> };

let child: ChildProcess | undefined;

test.afterEach(() => {
  child?.kill();
  child = undefined;
});

/** The real daemon on a free port, holding the sample diff plus src/long.ts and a long rename. */
async function startDaemon(): Promise<Daemon> {
  const home = tempDir();
  child = spawn(process.execPath, [bin, 'daemon', '--port', '0'], {
    env: { ...process.env, PRWALK_HOME: home },
    stdio: 'ignore',
  });
  let state: { port: number; token: string } | undefined;
  for (let tries = 0; state === undefined && tries < 200; tries++) {
    try {
      state = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
    } catch {
      await sleep(25);
    }
  }
  if (state === undefined) throw new Error('the daemon did not start');
  const { port, token } = state;
  const url = `http://127.0.0.1:${port}/`;
  const send = async (method: string, path: string, body: unknown) => {
    const reply = await fetch(new URL(path, url), {
      method,
      headers: { 'x-prwalk-token': token },
      body: JSON.stringify(body),
    });
    if (!reply.ok) throw new Error(`${method} ${path}: ${reply.status} ${await reply.text()}`);
  };
  await send('PUT', '/api/session', {
    meta: { kind: 'github', title: TITLE, number: 482, headRef: 'feat/limit', baseRef: 'main' },
    patch: sample + longFile + longRename,
  });
  return { url, focus: (focus) => send('POST', '/api/focus', { focus }) };
}

const selectedLines = (page: Page) => page.locator('[data-line][data-selected-line]');

/** The tests type-check without the DOM library, so they name what they touch. */
type Scroller = { scrollTop: number; scrollWidth: number; clientWidth: number };

/** Waits for the smooth scroll of the code to stop, so a manual scroll is not overridden. */
const codeSettled = (page: Page) =>
  expect
    .poll(() =>
      page.locator('.code').evaluate(async (element) => {
        const code = element as unknown as Scroller;
        const before = code.scrollTop;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return code.scrollTop === before;
      }),
    )
    .toBe(true);

test('a focus highlights its lines, scrolls them into view and shows the file header', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await page.goto(daemon.url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${TITLE}#482`);

  await daemon.focus({ file: 'src/long.ts', lines: [250, 252] });

  await expect(page.locator('.file-head')).toContainText('newsrc/long.ts');
  await expect(selectedLines(page)).toHaveText([
    'export const line250 = 250;',
    'export const line251 = 251;',
    'export const line252 = 252;',
  ]);
  for (const line of await selectedLines(page).all()) await expect(line).toBeInViewport();
  await expect(page.locator('[data-line="100"]')).not.toBeInViewport();

  // The same focus again brings the range back after the reader scrolled away from it.
  await codeSettled(page);
  await page.locator('.code').evaluate((code) => {
    (code as unknown as Scroller).scrollTop = 0;
  });
  await expect(selectedLines(page).first()).not.toBeInViewport();
  await daemon.focus({ file: 'src/long.ts', lines: [250, 252] });
  await expect(selectedLines(page).first()).toBeInViewport();
});

test('a focus on another file switches the view to it', async ({ page }) => {
  const daemon = await startDaemon();
  await page.goto(daemon.url);
  await daemon.focus({ file: 'src/long.ts', lines: [250, 252] });
  await expect(selectedLines(page)).toHaveCount(3);

  await daemon.focus({ file: 'src/added.ts', lines: [1, 2] });

  await expect(page.locator('.file-head')).toContainText('newsrc/added.ts');
  await expect(selectedLines(page)).toHaveText(['new file', '<b>&"x"</b>']);
});

test('reloading the page keeps the focus', async ({ page }) => {
  const daemon = await startDaemon();
  await page.goto(daemon.url);
  await daemon.focus({ file: 'src/limit.ts', side: 'old', lines: [15, 15] });
  await expect(selectedLines(page)).toHaveText(['export const k = 11;']);

  await page.reload();

  await expect(page.locator('.file-head')).toContainText('modifiedsrc/limit.ts');
  await expect(selectedLines(page)).toHaveText(['export const k = 11;']);
});

test('at 380 px the header of a long rename fits without scrolling the page sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 380, height: 700 });
  const daemon = await startDaemon();
  await page.goto(daemon.url);
  await daemon.focus({ file: NEW_PATH, side: 'old', lines: [121, 121] });
  await expect(selectedLines(page)).toHaveText(['const retries = 3;']);

  const main = page.locator('main');
  const overflow = await main.evaluate((element) => {
    const el = element as unknown as Scroller;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBe(0);
  await expect(page.locator('.file-head .lines')).toBeInViewport({ ratio: 1 });
  expect((await page.locator('.file-head .path').boundingBox())?.width).toBeGreaterThan(100);
});
