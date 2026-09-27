/**
 * game.test.js — Unit tests for the game-level rules in src/game.js:
 * starting the battle, strict turn alternation, turn locking, ending the
 * game, stats/accuracy math, and a clean reset via createGame.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HORIZONTAL,
  createGame,
  createStats,
  accuracy,
  placeNextShip,
  startBattle,
  takeShot,
} from '../../src/game.js';

/**
 * Build a game with both fleets placed on rows A, C, E, G, I and the battle started.
 * Takes no parameters; asserts that the battle actually started.
 * @returns {import('../../src/game.js').Game}
 */
function battleReadyGame() {
  const game = createGame();
  for (const side of ['player', 'ai']) {
    for (const row of [0, 2, 4, 6, 8]) placeNextShip(game.boards[side], row, 0, HORIZONTAL);
  }
  assert.ok(startBattle(game));
  return game;
}

test('battle cannot start until both fleets are complete', () => {
  const game = createGame();
  assert.equal(startBattle(game), false);
  for (const row of [0, 2, 4, 6, 8]) placeNextShip(game.boards.player, row, 0, HORIZONTAL);
  assert.equal(startBattle(game), false);
  for (const row of [0, 2, 4, 6, 8]) placeNextShip(game.boards.ai, row, 0, HORIZONTAL);
  assert.equal(startBattle(game), true);
  assert.equal(game.phase, 'battle');
  assert.equal(game.turn, 'player');
  assert.equal(startBattle(game), false, 'cannot start twice');
});

test('no shots are allowed during placement', () => {
  const game = createGame();
  assert.equal(takeShot(game, 'player', 0, 0).outcome, 'ignored');
});

test('player fires first and turns strictly alternate, even after a hit', () => {
  const game = battleReadyGame();
  assert.equal(takeShot(game, 'ai', 5, 5).outcome, 'ignored', 'AI cannot fire first');
  assert.equal(takeShot(game, 'player', 0, 0).outcome, 'hit');
  assert.equal(game.turn, 'ai', 'a hit does not grant an extra turn');
  assert.equal(takeShot(game, 'player', 0, 1).outcome, 'ignored', 'player locked out on AI turn');
  assert.equal(game.boards.ai.shots[0][1], null);
  assert.equal(takeShot(game, 'ai', 1, 0).outcome, 'miss');
  assert.equal(game.turn, 'player');
});

test('already-fired and invalid shots do not use up the turn or count in stats', () => {
  const game = battleReadyGame();
  takeShot(game, 'player', 1, 1);
  takeShot(game, 'ai', 1, 1);
  const before = structuredClone(game.stats);
  assert.equal(takeShot(game, 'player', 1, 1).outcome, 'already-fired');
  assert.equal(takeShot(game, 'player', 99, 0).outcome, 'invalid');
  assert.equal(game.turn, 'player');
  assert.deepEqual(game.stats, before);
});

test('game ends immediately when the last enemy ship cell is hit', () => {
  const game = battleReadyGame();
  const targets = game.boards.ai.ships.flatMap((s) => s.cells);
  // Distinct open-water cells on the player's board (odd rows are empty).
  const aiMisses = [1, 3, 5, 7, 9].flatMap((row) => [...Array(10).keys()].map((col) => ({ row, col })));
  targets.forEach(({ row, col }, i) => {
    takeShot(game, 'player', row, col);
    if (i < targets.length - 1) {
      assert.equal(game.phase, 'battle');
      assert.equal(takeShot(game, 'ai', aiMisses[i].row, aiMisses[i].col).outcome, 'miss');
    }
  });
  assert.equal(game.phase, 'over');
  assert.equal(game.winner, 'player');
  assert.equal(takeShot(game, 'ai', 3, 3).outcome, 'ignored', 'no shots after game over');
  assert.equal(takeShot(game, 'player', 3, 3).outcome, 'ignored');
});

test('stats track shots, hits and turns for each side', () => {
  const game = battleReadyGame();
  takeShot(game, 'player', 0, 0); // hit
  takeShot(game, 'ai', 1, 0); // miss
  takeShot(game, 'player', 1, 0); // miss
  takeShot(game, 'ai', 0, 0); // hit
  takeShot(game, 'player', 0, 1); // hit
  assert.deepEqual(game.stats.player, { shots: 3, hits: 2, turns: 3 });
  assert.deepEqual(game.stats.ai, { shots: 2, hits: 1, turns: 2 });
  assert.equal(accuracy(game.stats.player), 66.7);
  assert.equal(accuracy(game.stats.ai), 50);
});

test('accuracy rounds to one decimal and is 0 with no shots', () => {
  assert.equal(accuracy(createStats()), 0);
  assert.equal(accuracy({ shots: 3, hits: 1, turns: 3 }), 33.3);
  assert.equal(accuracy({ shots: 6, hits: 1, turns: 6 }), 16.7);
  assert.equal(accuracy({ shots: 17, hits: 17, turns: 17 }), 100);
  assert.equal(accuracy({ shots: 8, hits: 0, turns: 8 }), 0);
});

test('createGame always returns fresh, independent state', () => {
  const a = battleReadyGame();
  takeShot(a, 'player', 0, 0);
  const b = createGame();
  assert.equal(b.phase, 'placement');
  assert.equal(b.winner, null);
  assert.equal(b.boards.player.ships.length, 0);
  assert.equal(b.boards.ai.shots[0][0], null);
  assert.deepEqual(b.stats, { player: createStats(), ai: createStats() });
});
