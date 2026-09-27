/**
 * ai-simulation.test.js — Seeded Monte Carlo checks for src/ai.js.
 *
 * Plays 1,000 games of the AI against randomly placed fleets and checks the
 * hard rules on every single shot: never out of bounds, never repeated, and
 * the whole fleet sunk within 100 shots. A second block runs full games
 * through game.js's takeShot (AI vs AI) to prove the pieces fit together.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  createBoard,
  createGame,
  fireAt,
  allShipsSunk,
  inBounds,
  startBattle,
  takeShot,
  opponentOf,
} from '../../src/game.js';
import { createAi, chooseShot, recordShotResult, placeFleetRandomly } from '../../src/ai.js';
import { createRng } from '../../src/rng.js';
import { playOut } from './helpers.js';

const GAMES = 1000;

test(`AI over ${GAMES} seeded games: in bounds, no repeats, done within 100 shots`, () => {
  let worst = 0;
  for (let seed = 1; seed <= GAMES; seed++) {
    const board = placeFleetRandomly(createBoard(), createRng(seed));
    const ai = createAi(createRng(seed * 7919));
    // Cap at 101 so an AI that needed a 101st shot would be caught, not truncated.
    const log = playOut(ai, board, { chooseShot, recordShotResult, fireAt, allShipsSunk }, BOARD_SIZE * BOARD_SIZE + 1);
    const seen = new Set();
    for (const { row, col, outcome } of log) {
      assert.ok(inBounds(row, col), `seed ${seed}: out of bounds ${row},${col}`);
      assert.ok(!seen.has(`${row},${col}`), `seed ${seed}: repeated ${row},${col}`);
      assert.notEqual(outcome, 'already-fired');
      seen.add(`${row},${col}`);
    }
    assert.ok(allShipsSunk(board), `seed ${seed}: fleet not sunk`);
    assert.ok(log.length <= 100, `seed ${seed}: took ${log.length} shots`);
    worst = Math.max(worst, log.length);

    // Target mode: every hunt-mode hit is followed by a shot next to it.
    log.forEach((shot, i) => {
      if (shot.mode === 'hunt' && shot.outcome === 'hit' && log[i + 1]) {
        const next = log[i + 1];
        assert.equal(Math.abs(next.row - shot.row) + Math.abs(next.col - shot.col), 1, `seed ${seed} shot ${i}`);
      }
    });
  }
  assert.ok(worst <= 100);
});

test('same seed gives the same AI shot sequence', () => {
  const run = () => {
    const board = placeFleetRandomly(createBoard(), createRng(42));
    const ai = createAi(createRng(4242));
    return playOut(ai, board, { chooseShot, recordShotResult, fireAt, allShipsSunk }).map((s) => [s.row, s.col]);
  };
  assert.deepEqual(run(), run());
});

test('200 full AI-vs-AI games through takeShot end cleanly with consistent stats', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = createRng(seed);
    const game = createGame();
    placeFleetRandomly(game.boards.player, rng);
    placeFleetRandomly(game.boards.ai, rng);
    assert.ok(startBattle(game));
    const brains = { player: createAi(rng), ai: createAi(rng) };
    let guard = 0;
    while (game.phase === 'battle' && guard++ < 250) {
      const side = game.turn;
      const { row, col } = chooseShot(brains[side]);
      const result = takeShot(game, side, row, col);
      assert.ok(['miss', 'hit', 'sunk'].includes(result.outcome), `seed ${seed}: ${result.outcome}`);
      recordShotResult(brains[side], result);
    }
    assert.equal(game.phase, 'over', `seed ${seed}`);
    const { winner } = game;
    assert.ok(allShipsSunk(game.boards[opponentOf(winner)]));
    assert.ok(!allShipsSunk(game.boards[winner]));
    assert.equal(game.stats[winner].hits, 17);
    // Player fires first and turns alternate, so the loser has the same number
    // of turns (AI won) or one fewer (player won).
    const diff = game.stats.player.turns - game.stats.ai.turns;
    assert.equal(diff, winner === 'player' ? 1 : 0, `seed ${seed}`);
  }
});
