import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXTENSION_DIST = path.resolve(process.cwd(), '.output/chrome-mv3');

test('loads extension popup with expected UI', async () => {
  test.skip(
    !existsSync(EXTENSION_DIST),
    'Build output is missing. Run "npm run build" first.',
  );

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'playwright-wxt-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
    ],
  });

  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15_000 }));

    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(
      page.getByRole('heading', { name: 'Play Books Gaze Highlighter' }),
    ).toBeVisible();

    await expect(page.getByText('How To Use')).toBeVisible();
    await expect(page.getByText('Tips')).toBeVisible();
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
