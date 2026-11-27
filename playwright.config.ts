import { defineConfig, devices } from '@playwright/test';

// Browser tests of the viewer against the real daemon. `pnpm test:e2e` builds first.
// No daemon asks GitHub for the latest version; the test about it turns it back on.
process.env.PRWALK_UPDATE_CHECK = '0';

export default defineConfig({
  testDir: 'test/e2e',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
