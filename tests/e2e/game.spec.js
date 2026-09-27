/**
 * game.spec.js — End-to-end tests (desktop, headless Chromium) for Neon Battleship.
 *
 * Drives the real page the way a player would: start screen → placement
 * through the UI → battle → end overlay → PLAY AGAIN. Uses `?seed=` so the
 * AI's fleet and shots are the same on every run. Console errors fail any
 * test automatically (see fixtures.js).
 */

import {
  test,
  expect,
  cell,
  startGame,
  placeDefaultFleet,
  fireAndWait,
  snapshot,
  AI_TURN_MS,
} from './fixtures.js';

const SEED = 20260927;

/**
 * Read the enemy ship cells from the end overlay's reveal grid.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{row:number,col:number}[]>}
 */
async function revealedEnemyCells(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#reveal-grid .cell.sunk, #reveal-grid .cell.revealed')].map((c) => ({
      row: Number(c.dataset.row),
      col: Number(c.dataset.col),
    })),
  );
}

/**
 * Count cells on a grid whose accessible label matches a pattern.
 * Labels are what screen readers announce, so this also checks they're accurate.
 * @param {import('@playwright/test').Page} page
 * @param {'player'|'enemy'} grid
 * @param {RegExp} pattern
 * @returns {Promise<number>}
 */
async function countLabels(page, grid, pattern) {
  const labels = await page.locator(`#${grid}-grid .cell`).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  return labels.filter((l) => pattern.test(l)).length;
}

/**
 * Read the end overlay's stats table.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{player: object, ai: object}>} Shots, hits, accuracy and turns as displayed text.
 */
async function readStats(page) {
  /** @param {string} key @returns {Promise<string|null>} One stats cell's text. */
  const get = (key) => page.locator(`[data-stat="${key}"]`).textContent();
  /** @param {'player'|'ai'} s @returns {Promise<object>} That side's column. */
  const side = async (s) => ({
    shots: await get(`${s}-shots`),
    hits: await get(`${s}-hits`),
    accuracy: await get(`${s}-accuracy`),
    turns: await get(`${s}-turns`),
  });
  return { player: await side('player'), ai: await side('ai') };
}

/**
 * Expected accuracy text, mirroring the PRD's rule (1 decimal, 0% with no shots).
 * @param {number} hits
 * @param {number} shots
 * @returns {string} e.g. "33.3%".
 */
function accuracyText(hits, shots) {
  return `${shots === 0 ? '0.0' : (Math.round((hits / shots) * 1000) / 10).toFixed(1)}%`;
}

test('start screen shows the title, How to Play and START', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /NEON\s*BATTLESHIP/ })).toBeVisible();
  const steps = page.locator('.how-to li');
  await expect(steps).toHaveText([
    'Place your 5 ships on your grid.',
    'Take turns firing at the enemy grid.',
    'Sink all 5 enemy ships to win.',
    'Press R or tap ROTATE to turn a ship.',
  ]);
  await expect(page.getByRole('button', { name: 'START' })).toBeVisible();
  await expect(page.locator('#game-screen')).toBeHidden();
});

test('placement: preview colours, invalid spot, R key, ROTATE and UNDO', async ({ page }) => {
  await startGame(page, SEED);

  // Hover preview: valid is green, running off the grid is red.
  await cell(page, 'player', 0, 0).hover();
  await expect(page.locator('#player-grid .preview-valid')).toHaveCount(5);
  await cell(page, 'player', 0, 8).hover();
  await expect(page.locator('#player-grid .preview-invalid')).toHaveCount(2); // only on-grid cells drawn

  // Clicking an invalid spot places nothing and explains why.
  await cell(page, 'player', 0, 8).click();
  await expect(page.locator('#status')).toHaveText("Can't place your Carrier there. Try another spot.");
  await expect(page.locator('#player-grid .ship')).toHaveCount(0);

  await cell(page, 'player', 0, 0).click(); // Carrier A1–A5
  await expect(page.locator('#status')).toHaveText('Place your Battleship (4)');

  // Overlap is rejected.
  await cell(page, 'player', 0, 3).click();
  await expect(page.locator('#player-grid .ship')).toHaveCount(5);

  // R key rotates to vertical.
  await page.keyboard.press('r');
  await expect(page.getByRole('button', { name: 'ROTATE (VERT)' })).toBeVisible();
  await cell(page, 'player', 2, 0).click(); // Battleship C1–F1
  await expect(cell(page, 'player', 5, 0)).toHaveClass(/\bship\b/);

  // UNDO removes only the last ship.
  await page.getByRole('button', { name: 'UNDO' }).click();
  await expect(page.locator('#status')).toHaveText('Place your Battleship (4)');
  await expect(page.locator('#player-grid .ship')).toHaveCount(5);
  await expect(cell(page, 'player', 0, 0)).toHaveClass(/\bship\b/);

  // ROTATE button toggles back to horizontal.
  await page.getByRole('button', { name: 'ROTATE (VERT)' }).click();
  await expect(page.getByRole('button', { name: 'ROTATE (HORIZ)' })).toBeVisible();
  for (const row of [2, 4, 6, 8]) await cell(page, 'player', row, 0).click();

  // Battle starts automatically; placement controls go away.
  await expect(page.locator('#status')).toHaveText('Your turn: fire!');
  await expect(page.locator('#placement-controls')).toBeHidden();
  await expect(page.locator('#player-grid .ship')).toHaveCount(17);
});

test('enemy ships are listed by name, never shown on the grid', async ({ page }) => {
  await startGame(page, SEED);
  await placeDefaultFleet(page);
  await expect(page.locator('#enemy-fleet li')).toHaveText([
    'Carrier (5)',
    'Battleship (4)',
    'Cruiser (3)',
    'Submarine (3)',
    'Destroyer (2)',
  ]);
  await expect(page.locator('#enemy-grid .ship, #enemy-grid .revealed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enemy grid B7, not fired' })).toBeVisible();
});

test('clicks during the AI turn and on already-fired cells change nothing', async ({ page }) => {
  await startGame(page, SEED);
  await placeDefaultFleet(page);

  await cell(page, 'enemy', 0, 0).click();
  await expect(page.locator('#status')).toContainText('Enemy is firing...');
  await expect(page.locator('#game-screen')).toHaveAttribute('data-turn', 'ai');

  // AI's turn: the clock is frozen, so these land inside the 600ms window.
  const duringAi = await snapshot(page);
  await cell(page, 'enemy', 5, 5).click();
  await cell(page, 'enemy', 0, 0).click();
  expect(await snapshot(page)).toEqual(duringAi);
  await expect(cell(page, 'enemy', 5, 5)).toHaveAttribute('aria-label', 'Enemy grid F6, not fired');

  await page.clock.runFor(AI_TURN_MS);
  await expect(page.locator('#status')).toContainText('Your turn: fire!');

  // Player's turn, but the cell was already fired at: no turn used, no error.
  const beforeRepeat = await snapshot(page);
  await cell(page, 'enemy', 0, 0).click();
  expect(await snapshot(page)).toEqual(beforeRepeat);
  await expect(page.locator('#game-screen')).toHaveAttribute('data-turn', 'player');
  await page.clock.runFor(AI_TURN_MS * 3);
  expect(await snapshot(page)).toEqual(beforeRepeat); // the AI did not get a free turn
});

test('full game: play to the end, check stats, PLAY AGAIN resets, then win', async ({ page }) => {
  test.setTimeout(120_000);
  await startGame(page, SEED);
  await placeDefaultFleet(page);

  // Game 1: sweep the enemy grid in reading order until someone wins.
  let over = false;
  for (let i = 0; i < 100 && !over; i++) over = await fireAndWait(page, Math.floor(i / 10), i % 10);
  await expect(page.locator('#end-overlay')).toBeVisible();

  const enemySunkCells = await countLabels(page, 'enemy', /, sunk /);
  const playerWon = enemySunkCells === 17;
  await expect(page.locator('#end-title')).toHaveText(playerWon ? 'VICTORY' : 'GAME OVER');
  if (!playerWon) expect(await countLabels(page, 'player', /, sunk$/)).toBe(17);

  // Stats match what is on the boards.
  const pShots = await countLabels(page, 'enemy', /, (hit|miss|sunk .+)$/);
  const pHits = await countLabels(page, 'enemy', /, (hit|sunk .+)$/);
  const aShots = await countLabels(page, 'player', /, (miss|.+, hit|.+, sunk)$/);
  const aHits = await countLabels(page, 'player', /, (.+, hit|.+, sunk)$/);
  expect(await readStats(page)).toEqual({
    player: { shots: String(pShots), hits: String(pHits), accuracy: accuracyText(pHits, pShots), turns: String(pShots) },
    ai: { shots: String(aShots), hits: String(aHits), accuracy: accuracyText(aHits, aShots), turns: String(aShots) },
  });

  // The player's own damaged ships must render red, not stay ship-cyan
  // (regression: a more specific .ship rule used to override .hit/.sunk).
  const sunkBg = await page.locator('#player-grid .cell.sunk').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(sunkBg).toBe('rgb(255, 59, 92)');

  // Every enemy ship is revealed at the end, including ones never found.
  const enemyCells = await revealedEnemyCells(page);
  expect(enemyCells).toHaveLength(17);

  // PLAY AGAIN: a clean slate.
  await page.getByRole('button', { name: 'PLAY AGAIN' }).click();
  await expect(page.locator('#end-overlay')).toBeHidden();
  await expect(page.locator('#status')).toHaveText('Place your Carrier (5)');
  await expect(page.locator('#placement-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'UNDO' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ROTATE (HORIZ)' })).toBeVisible();
  expect(await countLabels(page, 'player', /, empty$/)).toBe(100);
  expect(await countLabels(page, 'enemy', /, not fired$/)).toBe(100);
  await expect(page.locator('#game-screen .hit, #game-screen .miss, #game-screen .sunk, #game-screen .ship')).toHaveCount(0);
  await expect(page.locator('#enemy-fleet li.is-sunk, #player-fleet li.is-sunk')).toHaveCount(0);

  // Game 2: same seed → same enemy fleet, so aim straight at it for a guaranteed VICTORY.
  await placeDefaultFleet(page);
  for (const { row, col } of enemyCells) {
    if (await fireAndWait(page, row, col)) break;
  }
  await expect(page.locator('#end-title')).toHaveText('VICTORY');
  await expect(page.locator('#end-overlay')).toHaveAttribute('data-result', 'victory');
  expect(await readStats(page)).toEqual({
    player: { shots: '17', hits: '17', accuracy: '100.0%', turns: '17' },
    ai: expect.objectContaining({ shots: '16', turns: '16' }),
  });
  await expect(page.locator('#enemy-fleet li.is-sunk')).toHaveCount(5);
});

test('status line keeps the player informed through a turn', async ({ page }) => {
  await startGame(page, SEED);
  await placeDefaultFleet(page);
  await cell(page, 'enemy', 9, 9).click();
  await expect(page.locator('#status')).toHaveText(/^(Miss at J10\.|Hit at J10!|You sunk their \w+!) Enemy is firing\.\.\.$/);
  await page.clock.runFor(AI_TURN_MS);
  await expect(page.locator('#status')).toHaveText(
    /^(Enemy missed at [A-J]\d+\.|Enemy hit your \w+ at [A-J]\d+!|Enemy sunk your \w+!) Your turn: fire!$/,
  );
});
