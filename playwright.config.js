/**
 * playwright.config.js — Configuration for the end-to-end tests in tests/e2e/.
 *
 * By default it serves the repo root as static files (exactly how a player
 * runs the game) and drives it with headless Chromium. Set E2E_BASE_URL to
 * run the same tests against an already-hosted copy instead, e.g. the
 * published GitHub Pages site (no local server is started then):
 *
 *   E2E_BASE_URL=https://<user>.github.io/<repo>/ npm run test:e2e
 *
 * Unit tests don't use this; they run directly under `node --test`.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: REMOTE ? undefined : {
    command: `npx serve . -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
