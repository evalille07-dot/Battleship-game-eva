# Neon Battleship

Single-player, retro-arcade Battleship in the browser against a medium ("hunt and target") AI.
Plain HTML, CSS and vanilla ES modules: no framework, no build step, no backend.

## Play online

**https://evalille07-dot.github.io/Battleship-game-eva/**: public, no login. Published by GitHub Actions on every push to `main` (see [DEBUGGING.md](DEBUGGING.md) for the one-time Pages setup and how the live site is tested).

## Play locally

Any static file server works. From the project folder:

```bash
npx serve .                 # then open the URL it prints (usually http://localhost:3000)
# or
python3 -m http.server      # then open http://localhost:8000
```

Opening `index.html` straight from disk (`file://`) won't work, because browsers block ES modules there.

**How to play:** press START, place your 5 ships on YOUR FLEET (hover to preview: green is valid, red is not; click to place; **R** or ROTATE turns the ship; UNDO removes the last one). The battle starts automatically once all 5 are placed. Click cells in ENEMY WATERS to fire. You and the AI alternate one shot at a time. Sink all 5 enemy ships to win.

**Repeatable games:** add `?seed=<number>` to the URL (e.g. `http://localhost:3000/?seed=42`) and the AI's fleet and shots will be identical every time, as long as your moves are the same. PLAY AGAIN keeps the same seed.

## Test

Requires **Node 22+**.

```bash
npm install                        # Playwright + serve (dev dependencies only)
npx playwright install chromium    # one-time browser download for the e2e tests
npm test                           # unit tests, then e2e tests
```

Or run one suite:

```bash
npm run test:unit   # node --test: rules, AI, 1,000-game seeded simulation (no browser)
npm run test:e2e    # Playwright, headless Chromium, desktop viewport
```

To run the same e2e suite against a hosted copy (e.g. the live site) instead of a local server:

```bash
E2E_BASE_URL=https://evalille07-dot.github.io/Battleship-game-eva/ E2E_REAL_FONTS=1 npm run test:e2e
```

By default the e2e tests start their own server on port 4173. They stub the Google Fonts request (so they don't need the internet) and fail on any browser console error.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page markup: start screen, game screen, end-of-game overlay. |
| `styles.css` | All styling: neon theme, CRT scanlines, hit/miss/sunk effects, responsive layout, reduced motion. |
| `src/game.js` | Pure rules: boards, placement, firing, sinking, turn order, win check, stats. No DOM. |
| `src/ai.js` | AI opponent: random fleet placement and hunt / target / line-lock firing. No DOM. |
| `src/rng.js` | Seedable RNG (mulberry32) and `?seed=` parsing. All randomness goes through here. |
| `src/ui.js` | DOM rendering and event handling only; delegates every rule to `game.js` / `ai.js`. |
| `tests/unit/` | `node:test` unit tests for the rules and the AI. |
| `tests/e2e/` | Playwright browser tests. |
| `playwright.config.js` | e2e configuration (static server + headless Chromium). |
| `.github/workflows/pages.yml` | CI: run all tests, deploy to GitHub Pages, then re-run the e2e suite against the live URL. |
| `BUGS_AND_FIXES.md` | Log of real bugs found during development. |
| `DEBUGGING.md` | Publishing investigation, verification matrix, and what is/isn't verified yet. |

## How the AI plays

- **Hunt:** with no damaged ship to chase, it fires at a random cell it hasn't tried.
- **Target:** after a hit, it tries the neighbouring cells: up, down, left, right.
- **Line lock:** once two hits line up, it fires only along that line, extending both ends until the ship sinks.
- **After a sink:** it forgets only the sunk ship's hits. Leftover hits belong to a touching ship, so it keeps chasing those; otherwise it goes back to hunting.
- It never fires at the same cell twice or off the grid. It waits ~600ms before each shot so you can follow it.

## Scope notes

- Desktop is the supported and tested target. The layout does stack below 768px with 32px cells and supports tap-to-preview, but there are no mobile e2e tests.
- Deliberately not built (per the PRD): login, multiplayer, payments, leaderboards, saved games, sound, random placement for the player, difficulty settings, analytics, any backend.
