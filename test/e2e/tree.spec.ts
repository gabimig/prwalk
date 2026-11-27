import { expect, type Page, test } from '@playwright/test';
import { openAndStart, startDaemon, stopDaemon } from './daemon.js';

test.afterEach(stopDaemon);

const tree = (page: Page) => page.getByRole('tree');
const row = (page: Page, path: string) => page.getByRole('treeitem', { name: path, exact: true });
const who = (page: Page) => page.locator('.who');

test('the tree shows the files of the diff and marks the file of the current step', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);

  await expect(tree(page).locator('.row .name')).toHaveText([
    'src',
    'auth',
    'loginController.ts',
    'rateLimiter.ts',
    'config',
    'auth.ts',
    'test/auth',
    'rateLimiter.test.ts',
  ]);
  await expect(row(page, 'src').locator('.count').first()).toHaveText('3');
  await expect(row(page, 'src/auth/rateLimiter.ts').locator('.counts')).toHaveText(/\+\d+/);

  await page.getByRole('button', { name: '4. loginController · bloqueo' }).click();
  await expect(tree(page).locator('[aria-current="true"]')).toHaveAccessibleName(
    'src/auth/loginController.ts',
  );
  await page.getByRole('button', { name: '6. Configuración' }).click();
  await expect(tree(page).locator('[aria-current="true"]')).toHaveAccessibleName(
    'src/config/auth.ts',
  );
});

test('a card sentence with a path lights that folder and the item that names it', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);

  // The first sentence has no path: every zone of the card is lit, no item stands out.
  await expect(who(page)).toHaveText('Paso 1 de 8 · frase 1 de 3');
  for (const path of ['src/auth', 'src/config/auth.ts', 'test/auth']) {
    await expect(row(page, path)).toHaveAttribute('data-lit', 'true');
  }
  await expect(page.locator('.card li.lit')).toHaveCount(0);

  await expect(who(page)).toHaveText('Paso 1 de 8 · frase 2 de 3', { timeout: 10_000 });
  await expect(row(page, 'src/auth')).toHaveAttribute('data-lit', 'true');
  await expect(row(page, 'src/auth/rateLimiter.ts')).toHaveAttribute('data-lit', 'true');
  await expect(row(page, 'test/auth')).not.toHaveAttribute('data-lit');
  await expect(page.locator('.card li.lit')).toHaveText(/^src\/auth/);
});

test('clicking a file in the tree shows it and pauses; playing again goes back to the step', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);

  await row(page, 'src/config/auth.ts').click();

  await expect(page.locator('.file-head')).toContainText('src/config/auth.ts');
  await expect(who(page)).toHaveText(/^En pausa · paso 1/);
  await expect(row(page, 'src/config/auth.ts')).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('Space');
  await expect(page.locator('.card h2')).toHaveText('Qué hace esta PR');
});

test('the button hides and shows the tree, which starts closed below 720 px', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(
    'Add login rate limit',
  );
  // The summary points at folders, so the tree opens on its own during that step only.
  await expect(tree(page)).toBeVisible();

  await page.getByRole('button', { name: '2. rateLimiter · estructura' }).click();
  await expect(tree(page)).toBeHidden();

  await page.getByRole('button', { name: 'Enseñar los ficheros' }).click();
  await expect(tree(page)).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar los ficheros' }).click();
  await expect(tree(page)).toBeHidden();
});

test('with browser storage blocked the tree still starts by width and the button still works', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new Error('SecurityError: storage is blocked');
    };
    Object.defineProperty(window, 'localStorage', { get: blocked });
  });
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);
  await page.getByRole('button', { name: '2. rateLimiter · estructura' }).click();
  await expect(tree(page)).toBeVisible();

  // The summary points at folders too: one click hides the tree all the same.
  await page.getByRole('button', { name: '1. Resumen' }).click();
  await page.getByRole('button', { name: 'Ocultar los ficheros' }).click();
  await expect(tree(page)).toBeHidden();
  await page.getByRole('button', { name: '2. rateLimiter · estructura' }).click();
  await expect(tree(page)).toBeHidden();
});

test('without a script a file clicked in the tree is shown over the focus of the agent', async ({
  page,
}) => {
  const daemon = await startDaemon();
  daemon.prwalk('play', '--clear');
  await page.goto(`${daemon.url}?voice=silent`);
  daemon.prwalk('focus', 'src/auth/rateLimiter.ts', '--lines', '1-3');
  await expect(page.locator('.file-head')).toContainText('src/auth/rateLimiter.ts');

  await row(page, 'src/config/auth.ts').click();

  await expect(page.locator('.file-head')).toContainText('src/config/auth.ts');
  await expect(row(page, 'src/config/auth.ts')).toHaveAttribute('aria-current', 'true');
});
