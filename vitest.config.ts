import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // No test asks GitHub for the latest version; the ones about it turn it back on.
    env: { PRWALK_UPDATE_CHECK: '0' },
  },
});
