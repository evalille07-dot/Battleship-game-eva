# Bugs and Fixes

A log of real bugs found during development (not planned work).

## 1. Game-over unit test fired a repeated AI shot

- **Bug:** `tests/unit/game.test.js` › "game ends immediately when the last enemy ship cell is hit" failed: the game never reached `over`.
- **How found:** First `npm test` run in Milestone 1.
- **Root cause:** The test fed the AI "miss" shots along row J only. The player needs 17 shots to win, so the AI needs 16 misses, but row J has only 10 cells. The 11th AI shot repeated a cell, which `takeShot` correctly treats as `already-fired` (turn not used), so the turn never passed back to the player and the remaining player shots were `ignored`. The game logic was right; the test fixture was wrong.
- **Fix:** The test now draws AI misses from a list of 50 distinct empty cells (rows B, D, F, H, J) and asserts each one is a `miss`, so a fixture mistake like this fails loudly at the exact shot. Fixed in commit `29c4167`.
- **Prevention:** The per-shot `assert.equal(..., 'miss')` in that test; the separate test "already-fired and invalid shots do not use up the turn" pins the behaviour that exposed it.
