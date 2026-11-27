import { expect, test } from '@playwright/test';
import { openAndStart, startDaemon, stopDaemon } from './daemon.js';

test.afterEach(stopDaemon);

test('shows a newer version in the header until it is hidden for that version', async ({
  page,
}) => {
  const daemon = await startDaemon(undefined, { latest: '99.0.0' });
  await openAndStart(page, daemon, 50);

  const badge = page.getByRole('banner').getByText('Versión 99.0.0 disponible');
  await expect(badge).toBeVisible();
  await badge.hover();
  await expect(page.getByText('Dile a tu agente que actualice PRWalk')).toBeVisible();

  await page.getByRole('button', { name: 'Ocultar el aviso de la versión 99.0.0' }).click();
  await expect(badge).toBeHidden();
  await page.reload();
  // The daemon sends the script, then the newer version, to a viewer that connects.
  await expect(page.getByRole('banner').getByText(/^Nivel:/)).toBeVisible();
  await expect(page.getByText('Versión 99.0.0 disponible')).toBeHidden();
});
