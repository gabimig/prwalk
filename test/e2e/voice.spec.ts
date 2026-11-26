import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { startDaemon, stopDaemon } from './daemon.js';

test.afterEach(stopDaemon);

const adapter = fileURLToPath(new URL('../fixtures/voices/test-voice.mjs', import.meta.url));

test('with a voice adapter the page plays the audio the daemon makes, and carries on when a sentence fails', async ({
  page,
}) => {
  // The second sentence fails: it is said by the page's own voice instead.
  const daemon = await startDaemon({
    voice: { provider: adapter, options: { failOn: 'cuatro ficheros' } },
  });
  const audio = page.waitForResponse(
    (reply) => reply.url().endsWith('/api/tts') && reply.status() === 200,
  );
  // Counts the sounds the page played to the end.
  await page.addInitScript(() => {
    type Media = { play(this: EventTarget): Promise<void> };
    const scope = globalThis as unknown as {
      audioEnded: number;
      HTMLMediaElement: { prototype: Media };
    };
    scope.audioEnded = 0;
    const media = scope.HTMLMediaElement.prototype;
    const play = media.play;
    media.play = function () {
      this.addEventListener('ended', () => scope.audioEnded++);
      return play.call(this);
    };
  });
  await page.goto(`${daemon.url}?speed=4`);
  await page.getByRole('button', { name: 'Empezar' }).click();

  expect((await audio).headers()['content-type']).toBe('audio/wav');
  const voice = page.locator('.pr-meta .picker > span');
  await expect(voice).toContainText('test-voice falla');
  await expect(page.locator('.who')).toHaveText('Paso 1 de 8 · frase 3 de 3', { timeout: 20_000 });
  // The first and third sentences were heard with the adapter's audio, which names it again.
  await expect(voice).toHaveText('Voz: test-voice');
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { audioEnded: number }).audioEnded))
    .toBeGreaterThanOrEqual(2);
});
