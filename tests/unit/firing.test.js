/**
 * firing.test.js — Unit tests for fireAt and allShipsSunk in src/game.js:
 * hit / miss / sunk / already-fired / invalid outcomes and win detection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireAt, allShipsSunk, remainingShipNames, createBoard } from '../../src/game.js';
import { boardWithStandardFleet, hitEveryShipCell } from './helpers.js';

test('miss on open water is recorded', () => {
  const board = boardWithStandardFleet();
  const r = fireAt(board, 1, 0); // B1 is empty
  assert.equal(r.outcome, 'miss');
  assert.equal(r.shipName, null);
  assert.equal(board.shots[1][0], 'miss');
});

test('hit reports the ship name without sinking it', () => {
  const board = boardWithStandardFleet();
  const r = fireAt(board, 0, 0); // Carrier A1
  assert.equal(r.outcome, 'hit');
  assert.equal(r.shipName, 'Carrier');
  assert.equal(board.shots[0][0], 'hit');
});

test('final cell of a ship reports sunk', () => {
  const board = boardWithStandardFleet();
  assert.equal(fireAt(board, 8, 0).outcome, 'hit'); // Destroyer I1
  const r = fireAt(board, 8, 1); // Destroyer I2
  assert.equal(r.outcome, 'sunk');
  assert.equal(r.shipName, 'Destroyer');
  assert.ok(!remainingShipNames(board).includes('Destroyer'));
  assert.deepEqual(r.sunkCells, [{ row: 8, col: 0 }, { row: 8, col: 1 }]);
});

test('sunkCells is a copy: changing it cannot move the ship', () => {
  const board = boardWithStandardFleet();
  fireAt(board, 8, 0);
  const r = fireAt(board, 8, 1);
  r.sunkCells[0].row = 5;
  assert.equal(board.ships[4].cells[0].row, 8);
});

test('firing at the same cell again reports already-fired and changes nothing', () => {
  const board = boardWithStandardFleet();
  fireAt(board, 0, 0);
  fireAt(board, 1, 1);
  const carrierHits = board.ships[0].hits;
  assert.equal(fireAt(board, 0, 0).outcome, 'already-fired');
  assert.equal(fireAt(board, 1, 1).outcome, 'already-fired');
  assert.equal(board.ships[0].hits, carrierHits);
  assert.equal(board.shots[1][1], 'miss');
});

test('out-of-bounds shots are invalid', () => {
  const board = boardWithStandardFleet();
  for (const [r, c] of [[-1, 0], [0, -1], [10, 0], [0, 10], [1.5, 2]]) {
    assert.equal(fireAt(board, r, c).outcome, 'invalid');
  }
});

test('win: not over until the very last ship cell is hit', () => {
  const board = boardWithStandardFleet();
  const cells = board.ships.flatMap((s) => s.cells);
  assert.equal(cells.length, 17);
  // Misses never win.
  for (let col = 0; col < 10; col++) fireAt(board, 9, col);
  assert.ok(!allShipsSunk(board));
  // Every ship cell but one.
  for (const { row, col } of cells.slice(0, -1)) {
    fireAt(board, row, col);
    assert.ok(!allShipsSunk(board));
  }
  const last = cells.at(-1);
  assert.equal(fireAt(board, last.row, last.col).outcome, 'sunk');
  assert.ok(allShipsSunk(board));
  assert.deepEqual(remainingShipNames(board), []);
});

test('each ship reports sunk exactly once when all cells are hit', () => {
  const board = boardWithStandardFleet();
  const results = hitEveryShipCell(board, fireAt);
  assert.deepEqual(
    results.filter((r) => r.outcome === 'sunk').map((r) => r.shipName),
    ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'],
  );
});

test('an empty board is never considered defeated', () => {
  assert.ok(!allShipsSunk(createBoard()));
});
