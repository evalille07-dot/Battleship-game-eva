/**
 * fixtures.js — Shared Playwright setup and page helpers for tests/e2e/.
 *
 * Every test that imports `test` from here gets:
 *   - The Google Fonts stylesheet stubbed with an empty response, so tests
 *     don't depend on the network (the game falls back to monospace).
 *     Set E2E_REAL_FONTS=1 to load the real font instead, e.g. when testing
 *     the published site, so its genuine network requests are checked too.
 *   - A controllable clock, so the AI's 600ms "thinking" delay can be skipped
 *     instead of waited out.
 *   - Automatic failure if the browser console logs any error or the page
 *     throws, at any point in the test.
 */

import { test as base, expect } from '@playwright/test';

export { expect };

/** True when tests should load the real Google Font instead of a stub. */
export const REAL_FONTS = process.env.E2E_REAL_FONTS === '1';

/** The AI's delay in src/ui.js, plus a margin. */
export const AI_TURN_MS = 700;

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    if (!REAL_FONTS) {
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      );
    }
    await page.clock.install();
    await use(page);
    expect(errors, 'browser console errors').toEqual([]);
  },
});

/**
 * Locator for one grid cell.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'player'|'enemy'|'reveal'} grid
 * @param {number} row - 0–9 (A–J).
 * @param {number} col - 0–9 (1–10).
 * @returns {import('@playwright/test').Locator}
 */
export function cell(page, grid, row, col) {
  return page.locator(`#${grid}-grid .cell[data-row="${row}"][data-col="${col}"]`);
}

/**
 * Open the game (optionally seeded) and press START.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [seed]
 * @returns {Promise<void>}
 */
export async function startGame(page, seed) {
  // Relative ('./'), not '/': the game may be hosted in a sub-folder such as
  // GitHub Pages' /<repo>/, and a leading '/' would jump to the site root.
  await page.goto(seed === undefined ? './' : `./?seed=${seed}`);
  await expect(page.getByRole('heading', { name: /NEON\s*BATTLESHIP/ })).toBeVisible();
  await page.getByRole('button', { name: 'START' }).click();
  await expect(page.locator('#status')).toHaveText('Place your Carrier (5)');
}

/**
 * Place the whole fleet on the default layout: every ship horizontal,
 * starting in column 1 of rows A, C, E, G, I.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function placeDefaultFleet(page) {
  for (const row of [0, 2, 4, 6, 8]) await cell(page, 'player', row, 0).click();
  await expect(page.locator('#status')).toHaveText('Your turn: fire!');
}

/**
 * Fire at an enemy cell and, if the game isn't over, fast-forward through
 * the AI's turn until it's the player's turn again.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} row
 * @param {number} col
 * @returns {Promise<boolean>} True if the game ended.
 */
export async function fireAndWait(page, row, col) {
  await cell(page, 'enemy', row, col).click();
  if (await page.locator('#end-overlay').isVisible()) return true;
  await page.clock.runFor(AI_TURN_MS);
  await expect(page.locator('#end-overlay:not([hidden]), #game-screen[data-turn="player"]')).toHaveCount(1);
  return page.locator('#end-overlay').isVisible();
}

/**
 * Snapshot of everything a click could change: status text plus the
 * accessible label of every cell on both grids.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ status: string, labels: string[] }>}
 */
export async function snapshot(page) {
  return page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    labels: [...document.querySelectorAll('#player-grid .cell, #enemy-grid .cell')].map((c) =>
      c.getAttribute('aria-label'),
    ),
  }));
}
