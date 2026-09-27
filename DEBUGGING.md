# Debugging & Verification Notes

Short record of how the finished game was published, what was verified and how, and what still depends on a manual step. Development bugs are logged in [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md).

## Links

| What | URL | Access |
| --- | --- | --- |
| Repository | https://github.com/evalille07-dot/Battleship-game-eva | Public (checked anonymously: HTTP 200) |
| Playable game (interview link) | https://evalille07-dot.github.io/Battleship-game-eva/ | Public, no login (verified by CI, see Status) |
| Claude artifact (preview copy) | https://claude.ai/artifact/F7fEsgf5sBGWHdLvbScxDp | **Private**, needs a claude.ai login. Anonymous request: HTTP 403. Not for interviewers. |

## 1. Why the first artifact publish failed

- **Symptom:** `files: "/home/user/battleship-game-eva/styles.css" is outside the working directory ("/home/user/cognition-m1-prep") or your scratchpad directory`.
- **Cause:** The session's publishing tool only reads files from the session's original working directory or its scratchpad. The game had been moved to a second repository cloned elsewhere, so its files were out of bounds. Nothing was wrong with `index.html` or the game.
- **Workaround used:** Copied `index.html`, `styles.css` and `src/*.js` into the scratchpad and published from there (identical copies: `diff -r` clean).
- **Side effects found on inspection:**
  - The artifact is a *snapshot*; it doesn't update when the repo changes.
  - The artifact service wraps the published file in its own HTML skeleton. Because `index.html` is already a full document, the served page contains a nested `<!doctype>/<html>`. Browsers tolerate this (the game's stylesheet loads after the injected one and wins), but it is not clean HTML.
  - It is private (HTTP 403 without login).
- **Decision:** Use GitHub Pages for the interview link: public, no login, served straight from the repo, and testable in CI.

## 2. Public hosting: GitHub Pages

`.github/workflows/pages.yml` runs on every push to `main`:

1. **test**: `npm test` (56 unit + e2e) on a local server.
2. **deploy**: publishes only `index.html`, `styles.css`, `src/` to Pages.
3. **verify-live**: fetches the live URL *anonymously* (must be HTTP 200 and contain the game), checks every asset returns 200, then runs the **full Playwright suite against the live site** with the real Google Font loaded.

**One-time manual step (repo owner, done):** Settings → Pages → Build and deployment → Source: **GitHub Actions**. Before this was set, run #1 failed at `configure-pages` with *"Get Pages site failed… verify that the repository has Pages enabled"* (expected, not a code bug); run #2, after enabling it, passed.

The development sandbox cannot reach `*.github.io` (egress policy: `CONNECT tunnel failed, response 403`), which is why live verification runs on GitHub's runners rather than locally.

## 3. What the tests cover

| Requirement | How it's tested | Where |
| --- | --- | --- |
| Complete game vs AI, start to end | Place 5 ships through the UI, fire until the end screen appears | e2e "full game…" |
| Ship placement | Hover preview (green/red), fleet order, auto-start of battle | e2e "placement…", unit `placement.test.js` |
| Rotation | `R` key and ROTATE button both toggle; vertical ship lands vertically | e2e "placement…" |
| Invalid placement | Off-grid and overlap rejected with a message, board unchanged; every edge in both orientations | e2e "placement…", unit `placement.test.js` |
| Duplicate shots | Clicking a fired cell changes nothing and does not use the turn | e2e "clicks during the AI turn…", unit `game.test.js` |
| AI turns | Player clicks ignored during the AI's 600ms turn; AI fires once then hands back; AI never repeats or leaves the grid (1,000 seeded games) | e2e, unit `ai*.test.js` |
| Loss detection | Seeded game 1 ends in **GAME OVER** only when all 17 player ship cells are hit | e2e "full game…" |
| Win detection | Same seed replayed, firing at the revealed fleet → **VICTORY** in exactly 17 shots | e2e "full game…" |
| Stats | Shots / hits / accuracy / turns checked against the boards | e2e "full game…", unit `game.test.js` |
| Restart | PLAY AGAIN: empty boards, zero shots, fresh status, controls reset | e2e "full game…" |
| No console errors | Every e2e test fails on any console error or uncaught exception | `tests/e2e/fixtures.js` |
| Works from a sub-folder | Suite run against `/battleship-game-eva/` locally, and the live Pages URL in CI | local rehearsal, `verify-live` |

## 4. Status

**Verified on the published site** ([Actions run #2](https://github.com/evalille07-dot/Battleship-game-eva/actions/runs/36356101173), commit `8018fc9`, all 3 jobs green):
- `test`: 56 unit + 6 e2e tests pass on a clean GitHub runner.
- `deploy`: game published to https://evalille07-dot.github.io/Battleship-game-eva/.
- `verify-live`: the URL and all 5 assets return HTTP 200 to an anonymous request, then **all 7 e2e tests pass against the live site** with the real Press Start 2P font loaded and no console errors: start screen, placement/rotation/invalid placement/undo, hidden enemy fleet, turn locking + duplicate shots, a full game lost to the AI (GAME OVER), PLAY AGAIN reset, a full game won (VICTORY), status messages, font loaded.

**Also verified locally:** same suite with the game served from a sub-folder; artifact code files byte-identical to the repo; repository public (anonymous HTTP 200).

**Not verified:**
- Mobile/touch: out of scope by request (desktop only); no automated mobile test.
- Browsers other than Chromium (tests run in headless Chromium only).
- The private Claude artifact at runtime (needs a login; not the interview link).

## 5. Bugs found

Four real bugs, each reproduced and fixed. Details, root causes and commits are in [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md):
1. Game-over unit test fired a repeated AI shot (test fixture).
2. Player's own hit/sunk ships stayed cyan (CSS specificity).
3. A single tap placed a ship on touch screens (focus handler).
4. E2E tests couldn't run against a sub-folder host like GitHub Pages (absolute `goto` paths).
