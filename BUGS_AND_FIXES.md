# Bugs and Fixes

A log of real bugs found during development (not planned work).

## 1. Game-over unit test fired a repeated AI shot

- **Bug:** `tests/unit/game.test.js` › "game ends immediately when the last enemy ship cell is hit" failed: the game never reached `over`.
- **How found:** First `npm test` run in Milestone 1.
- **Root cause:** The test fed the AI "miss" shots along row J only. The player needs 17 shots to win, so the AI needs 16 misses, but row J has only 10 cells. The 11th AI shot repeated a cell, which `takeShot` correctly treats as `already-fired` (turn not used), so the turn never passed back to the player and the remaining player shots were `ignored`. The game logic was right; the test fixture was wrong.
- **Fix:** The test now draws AI misses from a list of 50 distinct empty cells (rows B, D, F, H, J) and asserts each one is a `miss`, so a fixture mistake like this fails loudly at the exact shot. Fixed in commit `f4d9b55`.
- **Prevention:** The per-shot `assert.equal(..., 'miss')` in that test; the separate test "already-fired and invalid shots do not use up the turn" pins the behaviour that exposed it.

## 2. Player's own hit and sunk ships stayed cyan

- **Bug:** On the player's grid, cells of ships the AI had hit or sunk kept the cyan "your ship" colour instead of turning red, so it was hard to see what the enemy had damaged. The enemy grid was fine.
- **How found:** Manual playthrough: reviewing headless-Chromium screenshots of a seeded game in Milestone 3.
- **Root cause:** CSS specificity. The player's ships were styled with `.board-wrap--player .cell.ship` (three classes), which out-ranked `.cell.hit` and `.cell.sunk` (two classes), so the cyan background always won on the player's board.
- **Fix:** Changed the rule to plain `.cell.ship`, the same specificity as the hit/sunk rules, which come later in the file and so now take precedence. A comment on the rule explains why it must stay that way. Commit `7de151a`.
- **Prevention:** The e2e test "full game: play to the end, check stats, PLAY AGAIN resets, then win" asserts that a sunk cell on the player's grid has a computed background of `rgb(255, 59, 92)` (the neon red). Re-introducing the old selector makes it fail (checked).

## 3. A single tap placed a ship on touch screens

- **Bug:** On a touch screen the first tap on the player's grid placed the ship immediately, skipping the tap-to-preview step the PRD asks for (there's no hover on touch).
- **How found:** Manual check in headless Chromium at 390×844 with touch enabled, during Milestone 3.
- **Root cause:** Tapping a `<button>` fires `pointerdown → focus → click`. The keyboard-support handler previewed the ship on `focusin`, so by the time `click` ran the cell already counted as "previewed" and the second-tap check passed on the first tap.
- **Fix:** `focusin` now ignores focus caused by a pointer (it checks the pointer type recorded on `pointerdown`), so only keyboard focus previews. After a touch placement the preview is also cleared, so the next ship's red preview doesn't sit on top of the one just placed. Commit `7de151a`.
- **Prevention:** No automated test: mobile testing was dropped from scope at the user's request (desktop only), so the touch e2e test was not written. The fix is covered by the inline comment in `src/ui.js`; a touch test would be the first thing to add if mobile support comes back into scope.

## 4. E2E tests could not run against a site hosted in a sub-folder (e.g. GitHub Pages)

- **Bug:** Pointing the Playwright suite at the game served from a sub-path (`E2E_BASE_URL=http://localhost:4180/battleship-game-eva/`) made all 6 e2e tests fail with "element(s) not found" on the title heading. The game itself was fine; the tests never reached it.
- **How found:** Rehearsing the GitHub Pages layout locally before deploying: served the parent folder so the game lived at `/battleship-game-eva/`, exactly like a Pages project site at `/<repo>/`, and ran the suite against it. Reproduced 6/6 failures.
- **Root cause:** The tests navigated with `page.goto('/')` and `page.goto('/?seed=…')`. A leading `/` is resolved against the *origin*, not the base URL's path, so the browser loaded the server root (a directory listing) instead of the game.
- **Fix:** Navigate with relative URLs (`./`, `./?seed=…`), which resolve under the base URL's path. Game code needed no change; `index.html` already used relative asset paths. Commit `COMMIT_PLACEHOLDER`.
- **Prevention:** The same suite now runs both at the server root (`npm run test:e2e`) and against the live GitHub Pages URL in CI (`verify-live` job in `.github/workflows/pages.yml`), which is itself a sub-folder, so a regression fails CI. A comment in `tests/e2e/fixtures.js` explains why the paths must stay relative.
