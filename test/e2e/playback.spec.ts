import { setTimeout as sleep } from 'node:timers/promises';
import { expect, type Page, test } from '@playwright/test';
import example from '../fixtures/example-script.json' with { type: 'json' };
import { openAndStart, startDaemon, stopDaemon } from './daemon.js';

const sentences = example.steps.flatMap((step) =>
  step.say.map((sentence) => (typeof sentence === 'string' ? sentence : sentence.text)),
);

test.afterEach(stopDaemon);

const who = (page: Page) => page.locator('.who');
const currentStep = (page: Page) => page.locator('.step[aria-current="step"]');

test('plays the whole example, keeps every sentence in the history and reports the end', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 40);

  await expect(who(page)).toHaveText('Recorrido terminado', { timeout: 20_000 });
  await expect(page.locator('.log p')).toHaveText(sentences);
  await expect(currentStep(page)).toHaveText('8. Fin');
  await expect
    .poll(daemon.playback)
    .toEqual({ status: 'finished', step: example.steps.length - 1, sentence: 0 });
});

test('Space pauses and playback does not move on while paused', async ({ page }) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 4);

  await page.keyboard.press('Space');

  await expect(who(page)).toHaveText('En pausa · paso 1, frase 1');
  await sleep(1500);
  await expect(who(page)).toHaveText('En pausa · paso 1, frase 1');
  await expect(page.locator('.log p')).toHaveCount(1);
});

test('clicking a step jumps to it and shows its range highlighted with its note', async ({
  page,
}) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);

  await page.getByRole('button', { name: '4. loginController · bloqueo' }).click();

  await expect(currentStep(page)).toHaveText('4. loginController · bloqueo');
  await expect(page.locator('.file-head')).toContainText('src/auth/loginController.ts');
  await expect(page.locator('.file-head .note')).toHaveText('Dónde se aplica');
  await expect(page.locator('[data-line][data-selected-line]')).toHaveText([
    '  if (await limiter.isBlocked(email)) {',
    "    return res.status(429).json({ error: 'too_many_attempts' });",
    '  }',
  ]);

  // Restarting the step brings its range back into view after the person scrolled away.
  await page.setViewportSize({ width: 1280, height: 360 });
  const selected = page.locator('[data-line][data-selected-line]').first();
  await page.locator('.code').hover();
  await page.mouse.wheel(0, 2000);
  await expect(selected).not.toBeInViewport();
  await page.keyboard.press('KeyR');
  await expect(selected).toBeInViewport();
});

test('reloading the page while it plays keeps the step, paused', async ({ page }) => {
  const daemon = await startDaemon();
  await openAndStart(page, daemon, 1);
  await page.getByRole('button', { name: '3. rateLimiter · contar fallos' }).click();
  await expect.poll(daemon.playback).toEqual({ status: 'playing', step: 2, sentence: 0 });

  await page.reload();

  await expect(currentStep(page)).toHaveText('3. rateLimiter · contar fallos');
  await expect(who(page)).toHaveText('En pausa · paso 3, frase 1');
  expect(await daemon.playback()).toEqual({ status: 'paused', step: 2, sentence: 0 });
  await expect(page.getByRole('button', { name: 'Empezar' })).toHaveCount(0);
});
