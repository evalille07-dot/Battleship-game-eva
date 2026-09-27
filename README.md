# Neon Battleship

Single-player, retro-arcade Battleship in the browser against a medium ("hunt and target") AI.
Plain HTML, CSS and vanilla ES modules — no build step, no backend.

> Status: **Milestone 1 (scaffold + game logic)** complete. The AI, UI and e2e tests land in later milestones.

## Run the tests

Requires Node 22+ (uses glob patterns with the built-in `node:test` runner; no dependencies yet).

```bash
npm test          # all tests (currently unit tests only)
npm run test:unit # unit tests in tests/unit/
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/rng.js` | Seedable RNG (mulberry32) and `?seed=` parsing. All randomness goes through here. |
| `src/game.js` | Pure rules: boards, placement, firing, sinking, turns, win check, stats. No DOM. |
| `tests/unit/` | `node:test` unit tests for the logic. |
