import { expect, type Page, test } from '@playwright/test';
import { openAndStart, startDaemon, stopDaemon } from './daemon.js';

test.afterEach(stopDaemon);

const who = (page: Page) => page.locator('.who');
const currentStep = (page: Page) => page.locator('.step[aria-current="step"]');

test('an answer shows its focus and its question, then the page waits paused on the step', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 2);
  await page.getByRole('button', { name: '4. loginController · bloqueo' }).click();
  await page.keyboard.press('Space');
  await expect(who(page)).toHaveText('En pausa · paso 4, frase 1');

  await daemon.send('POST', '/api/say', {
    text: 'Se bloquea. Durante quince minutos.',
    question: '¿Qué pasa al llegar al máximo?',
    focus: { file: 'src/config/auth.ts', lines: [6, 7] },
  });

  await expect(page.locator('.file-head .aside-tag')).toHaveText('Respuesta');
  await expect(page.locator('.file-head')).toContainText('src/config/auth.ts');
  await expect(page.locator('[data-line][data-selected-line]')).toHaveCount(2);
  await expect(who(page)).toHaveText('Respuesta · el recorrido espera en el paso 4');
  await expect(currentStep(page)).toHaveText('4. loginController · bloqueo');
  const answer = page.locator('.log .answer');
  await expect(answer.locator('.question')).toHaveText('¿Qué pasa al llegar al máximo?');
  await expect(answer.locator('.reply')).toHaveText('Se bloquea. Durante quince minutos.');

  await expect(who(page)).toHaveText('En pausa · paso 4, frase 1', { timeout: 10_000 });
  await expect(page.locator('.log .now')).toHaveText('Ahora el controlador.');
  await expect(page.locator('.file-head .aside-tag')).toHaveCount(0);
  await expect(page.locator('.file-head')).toContainText('src/auth/loginController.ts');
});

test('replacing the rest of the script changes the step strip and keeps the history', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 2);
  await page.getByRole('button', { name: '7. Tests' }).click();
  const said = 'Por último, los tests. Hay un fichero nuevo con cuatro casos.';
  await expect(page.locator('.log p').last()).toHaveText(said);

  await daemon.send('POST', '/api/replace', {
    from: '7',
    steps: [
      {
        id: 'store-down',
        title: 'Almacén caído',
        card: { heading: 'Si el almacén se cae', items: [] },
        say: ['El error sube hasta el controlador.'],
      },
    ],
  });

  await expect(page.locator('.step')).toHaveCount(7);
  await expect(currentStep(page)).toHaveText('7. Almacén caído');
  await expect(who(page)).toHaveText('En pausa · paso 7, frase 1');
  await expect(page.locator('.log h3').last()).toHaveText('Paso 7 · Tests');
  await expect(page.locator('.log p').last()).toHaveText(said);

  await page.keyboard.press('Space');
  await expect(page.locator('.log h3').last()).toHaveText('Paso 7 · Almacén caído');
  await expect(page.locator('.log p').last()).toHaveText('El error sube hasta el controlador.');
});

test('without a script, an answer waits for a click before it is said', async ({ page }) => {
  const daemon = await startDaemon();
  await daemon.send('DELETE', '/api/script', null);
  await page.goto(`${daemon.url}?voice=silent&speed=2`);
  await expect(page.locator('.files')).toBeVisible();

  await daemon.send('POST', '/api/say', { text: 'Es un límite por correo.' });

  const bar = page.locator('.aside-bar');
  await expect(bar).toContainText('Es un límite por correo.');
  await bar.getByRole('button').click();
  await expect(bar.getByRole('button')).toHaveCount(0);
  await expect(bar).toHaveCount(0, { timeout: 10_000 });
});

test('pausing in the page is an event prwalk status reports', async ({ page }) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);

  await page.keyboard.press('Space');

  await expect(who(page)).toHaveText('En pausa · paso 1, frase 1');
  await expect
    .poll(() => daemon.prwalk('status'))
    .toContain('\n  user paused at step 1 "overview", sentence 1\n');
});
