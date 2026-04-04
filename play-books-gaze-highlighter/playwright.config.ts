import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  timeout: 60_000,
  reporter: 'list',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
});
