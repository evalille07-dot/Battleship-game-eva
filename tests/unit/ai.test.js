/**
 * ai.test.js — Unit tests for src/ai.js on hand-built layouts: random fleet
 * placement, target mode after a first hit, line lock, and the
 * touching-ships edge case. The large seeded simulation lives in
 * ai-simulation.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  FLEET,
  HORIZONTAL,
  VERTICAL,
  createBoard,
  fireAt,
  allShipsSunk,
  inBounds,
} from '../../src/game.js';
import { createAi, chooseShot, recordShotResult, placeFleetRandomly } from '../../src/ai.js';
import { createRng } from '../../src/rng.js';
import { boardWithShips, playOut } from './helpers.js';

const fns = { chooseShot, recordShotResult, fireAt, allShipsSunk };

/**
 * Give a fresh AI a specific opening shot (as if its hunt shot landed there),
 * so tests control where targeting starts.
 * @param {object} board - Target board; mutated by the shot.
 * @param {number} row
 * @param {number} col
 * @param {number} [seed=1] - Seed for the AI's rng.
 * @returns {object} The AI state, already told the result of that shot.
 */
function aiWithFirstShotAt(board, row, col, seed = 1) {
  const ai = createAi(createRng(seed));
  recordShotResult(ai, fireAt(board, row, col));
  return ai;
}

/**
 * @param {{row:number,col:number}} a
 * @param {{row:number,col:number}} b
 * @returns {boolean} True if the two cells share an edge.
 */
function adjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

test('placeFleetRandomly places the full fleet legally', () => {
  for (let seed = 0; seed < 200; seed++) {
    const board = placeFleetRandomly(createBoard(), createRng(seed));
    assert.deepEqual(board.ships.map((s) => s.name), FLEET.map((f) => f.name));
    const seen = new Set();
    for (const ship of board.ships) {
      for (const { row, col } of ship.cells) {
        assert.ok(inBounds(row, col));
        const key = `${row},${col}`;
        assert.ok(!seen.has(key), `overlap at ${key} (seed ${seed})`);
        seen.add(key);
      }
    }
    assert.equal(seen.size, 17);
  }
});

test('placeFleetRandomly is repeatable per seed and varies across seeds', () => {
  /** @param {number} seed @returns {string} The fleet placed with that seed, serialised. */
  const layout = (seed) => JSON.stringify(placeFleetRandomly(createBoard(), createRng(seed)).ships);
  assert.equal(layout(123), layout(123));
  assert.notEqual(layout(123), layout(124));
  const orientations = new Set();
  for (let seed = 0; seed < 50; seed++) {
    placeFleetRandomly(createBoard(), createRng(seed)).ships.forEach((s) => orientations.add(s.orientation));
  }
  assert.deepEqual([...orientations].sort(), [HORIZONTAL, VERTICAL]);
});

test('hunt mode fires in bounds at untried cells', () => {
  const ai = createAi(createRng(9));
  const board = createBoard(); // empty sea: every shot is a miss, so AI stays in hunt
  const seen = new Set();
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const { row, col } = chooseShot(ai);
    assert.equal(ai.lastMode, 'hunt');
    assert.ok(inBounds(row, col));
    assert.ok(!seen.has(`${row},${col}`));
    seen.add(`${row},${col}`);
    recordShotResult(ai, fireAt(board, row, col));
  }
  assert.throws(() => chooseShot(ai), /no cells left/);
});

test('after the first hit, the next shot is adjacent to it (every cell of every ship shape)', () => {
  for (const size of [2, 3, 4, 5]) {
    for (const orientation of [HORIZONTAL, VERTICAL]) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const spec = { name: 'Ship', row: r, col: c, size, orientation };
          let board;
          try { board = boardWithShips([spec]); } catch { continue; }
          for (const first of board.ships[0].cells) {
            const b = boardWithShips([spec]);
            const ai = aiWithFirstShotAt(b, first.row, first.col);
            const next = chooseShot(ai);
            assert.ok(adjacent(next, first), `size ${size} ${orientation} @${r},${c} first ${first.row},${first.col}`);
          }
        }
      }
    }
  }
});

test('first-hit neighbours are tried in order up, down, left, right', () => {
  const board = boardWithShips([{ name: 'Destroyer', row: 5, col: 5, size: 2, orientation: HORIZONTAL }]);
  const ai = aiWithFirstShotAt(board, 5, 5); // F6; ship continues right to F7
  const order = [];
  for (let i = 0; i < 4; i++) {
    const s = chooseShot(ai);
    order.push([s.row, s.col]);
    const res = fireAt(board, s.row, s.col);
    recordShotResult(ai, res);
    if (res.outcome === 'sunk') break;
  }
  assert.deepEqual(order, [[4, 5], [6, 5], [5, 4], [5, 6]]);
});

test('once two hits line up, the AI stays on that line until the ship sinks', () => {
  for (const size of [3, 4, 5]) {
    for (const orientation of [HORIZONTAL, VERTICAL]) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const spec = { name: 'Ship', row: r, col: c, size, orientation };
          try { boardWithShips([spec]); } catch { continue; }
          for (let i = 0; i < size; i++) {
            const board = boardWithShips([spec]);
            const first = board.ships[0].cells[i];
            const ai = aiWithFirstShotAt(board, first.row, first.col);
            const log = playOut(ai, board, fns);
            const where = `size ${size} ${orientation} @${r},${c} first #${i}`;
            assert.ok(allShipsSunk(board), where);
            const secondHit = log.findIndex((s) => s.outcome !== 'miss');
            for (const shot of log.slice(secondHit + 1)) {
              assert.equal(shot.mode, 'line', where);
              if (orientation === HORIZONTAL) assert.equal(shot.row, first.row, where);
              else assert.equal(shot.col, first.col, where);
            }
            // Target phase can cost at most 3 misses, line phase at most 1 (the far end).
            assert.ok(log.filter((s) => s.outcome === 'miss').length <= 4, where);
          }
        }
      }
    }
  }
});

/** Layouts where ships touch, each named for the failure it guards against. */
const TOUCHING_LAYOUTS = {
  'parallel, side by side': [
    { name: 'Carrier', row: 0, col: 0, size: 5, orientation: HORIZONTAL },
    { name: 'Battleship', row: 1, col: 0, size: 4, orientation: HORIZONTAL },
  ],
  'parallel, middle of the board': [
    { name: 'Cruiser', row: 4, col: 3, size: 3, orientation: VERTICAL },
    { name: 'Submarine', row: 4, col: 4, size: 3, orientation: VERTICAL },
  ],
  'end to end on one line': [
    { name: 'Cruiser', row: 2, col: 0, size: 3, orientation: HORIZONTAL },
    { name: 'Submarine', row: 2, col: 3, size: 3, orientation: HORIZONTAL },
  ],
  'T-shape': [
    { name: 'Carrier', row: 4, col: 2, size: 5, orientation: HORIZONTAL },
    { name: 'Destroyer', row: 5, col: 4, size: 2, orientation: VERTICAL },
  ],
  'L-shape': [
    { name: 'Battleship', row: 6, col: 6, size: 4, orientation: VERTICAL },
    { name: 'Cruiser', row: 9, col: 7, size: 3, orientation: HORIZONTAL },
  ],
};

for (const [label, specs] of Object.entries(TOUCHING_LAYOUTS)) {
  test(`touching ships (${label}): AI sinks both and only hunts with no hits pending`, () => {
    const allCells = boardWithShips(specs).ships.flatMap((s) => s.cells);
    for (const first of allCells) {
      const board = boardWithShips(specs);
      const ai = aiWithFirstShotAt(board, first.row, first.col);
      const log = playOut(ai, board, fns);
      const where = `${label}, first hit ${first.row},${first.col}`;
      assert.ok(allShipsSunk(board), where);
      for (const shot of log) {
        // The key edge case: after sinking one ship, leftover hits on the
        // other must keep the AI in target/line mode, never back to hunt.
        if (shot.pending > 0) assert.notEqual(shot.mode, 'hunt', where);
        else assert.equal(shot.mode, 'hunt', where);
      }
    }
  });
}

test('after a sink with no other hits pending, the AI returns to hunt mode', () => {
  const board = boardWithShips([
    { name: 'Destroyer', row: 0, col: 0, size: 2, orientation: HORIZONTAL },
    { name: 'Cruiser', row: 9, col: 7, size: 3, orientation: HORIZONTAL },
  ]);
  const ai = aiWithFirstShotAt(board, 0, 0);
  // Up is off-grid, so: down (B1) miss, left off-grid, right (A2) sinks.
  for (const expected of [[1, 0], [0, 1]]) {
    const s = chooseShot(ai);
    assert.deepEqual([s.row, s.col], expected);
    recordShotResult(ai, fireAt(board, s.row, s.col));
  }
  assert.deepEqual(ai.unresolvedHits, []);
  chooseShot(ai);
  assert.equal(ai.lastMode, 'hunt');
});

test('non-shot outcomes leave the AI untouched', () => {
  const ai = createAi(createRng(1));
  const before = JSON.stringify({ tried: ai.tried, hits: ai.unresolvedHits });
  for (const outcome of ['already-fired', 'invalid', 'ignored']) {
    recordShotResult(ai, { outcome, row: 0, col: 0, shipName: null });
  }
  assert.equal(JSON.stringify({ tried: ai.tried, hits: ai.unresolvedHits }), before);
});
