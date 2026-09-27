/**
 * placement.test.js — Unit tests for ship placement rules in src/game.js:
 * bounds at every edge in both orientations, overlap rejection, fleet order,
 * and undo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  FLEET,
  HORIZONTAL,
  VERTICAL,
  createBoard,
  canPlaceShip,
  placeNextShip,
  removeLastShip,
  nextShipToPlace,
  isFleetComplete,
  getShipCells,
} from '../../src/game.js';

const LAST = BOARD_SIZE - 1;

test('getShipCells grows right for horizontal and down for vertical', () => {
  assert.deepEqual(getShipCells(2, 3, 3, HORIZONTAL), [
    { row: 2, col: 3 },
    { row: 2, col: 4 },
    { row: 2, col: 5 },
  ]);
  assert.deepEqual(getShipCells(2, 3, 3, VERTICAL), [
    { row: 2, col: 3 },
    { row: 3, col: 3 },
    { row: 4, col: 3 },
  ]);
});

for (const { name, size } of FLEET) {
  test(`${name} (${size}): horizontal placement at every edge`, () => {
    const board = createBoard();
    const maxStartCol = BOARD_SIZE - size;
    for (let row = 0; row < BOARD_SIZE; row++) {
      // Flush against the left and right edges: valid.
      assert.ok(canPlaceShip(board, row, 0, size, HORIZONTAL), `row ${row} left edge`);
      assert.ok(canPlaceShip(board, row, maxStartCol, size, HORIZONTAL), `row ${row} right edge`);
      // One past the right edge, and starting off the left edge: invalid.
      assert.ok(!canPlaceShip(board, row, maxStartCol + 1, size, HORIZONTAL), `row ${row} overflow right`);
      assert.ok(!canPlaceShip(board, row, -1, size, HORIZONTAL), `row ${row} off left`);
    }
    // Top and bottom rows are fine horizontally; rows beyond them are not.
    assert.ok(canPlaceShip(board, 0, 0, size, HORIZONTAL));
    assert.ok(canPlaceShip(board, LAST, 0, size, HORIZONTAL));
    assert.ok(!canPlaceShip(board, -1, 0, size, HORIZONTAL));
    assert.ok(!canPlaceShip(board, BOARD_SIZE, 0, size, HORIZONTAL));
  });

  test(`${name} (${size}): vertical placement at every edge`, () => {
    const board = createBoard();
    const maxStartRow = BOARD_SIZE - size;
    for (let col = 0; col < BOARD_SIZE; col++) {
      assert.ok(canPlaceShip(board, 0, col, size, VERTICAL), `col ${col} top edge`);
      assert.ok(canPlaceShip(board, maxStartRow, col, size, VERTICAL), `col ${col} bottom edge`);
      assert.ok(!canPlaceShip(board, maxStartRow + 1, col, size, VERTICAL), `col ${col} overflow bottom`);
      assert.ok(!canPlaceShip(board, -1, col, size, VERTICAL), `col ${col} off top`);
    }
    assert.ok(canPlaceShip(board, 0, 0, size, VERTICAL));
    assert.ok(canPlaceShip(board, 0, LAST, size, VERTICAL));
    assert.ok(!canPlaceShip(board, 0, -1, size, VERTICAL));
    assert.ok(!canPlaceShip(board, 0, BOARD_SIZE, size, VERTICAL));
  });
}

test('non-integer coordinates and bad orientation are rejected', () => {
  const board = createBoard();
  assert.ok(!canPlaceShip(board, 0.5, 0, 2, HORIZONTAL));
  assert.ok(!canPlaceShip(board, 0, 0, 2, 'diagonal'));
});

test('overlapping placement is rejected; touching is allowed', () => {
  const board = createBoard();
  assert.ok(placeNextShip(board, 4, 2, HORIZONTAL)); // Carrier E3–E7
  // Crossing through the Carrier vertically.
  assert.ok(!canPlaceShip(board, 2, 4, 4, VERTICAL));
  assert.equal(placeNextShip(board, 2, 4, VERTICAL), null);
  // Sharing the Carrier's last cell horizontally.
  assert.ok(!canPlaceShip(board, 4, 6, 4, HORIZONTAL));
  // Directly adjacent (row F) is allowed.
  assert.ok(canPlaceShip(board, 5, 2, 4, HORIZONTAL));
  // Rejected placement left the board unchanged.
  assert.equal(board.ships.length, 1);
});

test('ships are placed in fleet order and the fleet completes after 5', () => {
  const board = createBoard();
  for (let i = 0; i < FLEET.length; i++) {
    assert.deepEqual(nextShipToPlace(board), FLEET[i]);
    assert.ok(!isFleetComplete(board));
    const ship = placeNextShip(board, i * 2, 0, HORIZONTAL);
    assert.equal(ship.name, FLEET[i].name);
    assert.equal(ship.cells.length, FLEET[i].size);
  }
  assert.ok(isFleetComplete(board));
  assert.equal(nextShipToPlace(board), null);
  // No sixth ship.
  assert.equal(placeNextShip(board, 9, 5, HORIZONTAL), null);
});

test('removeLastShip undoes the most recent placement only', () => {
  const board = createBoard();
  placeNextShip(board, 0, 0, HORIZONTAL);
  placeNextShip(board, 2, 0, HORIZONTAL);
  const removed = removeLastShip(board);
  assert.equal(removed.name, 'Battleship');
  assert.equal(board.ships.length, 1);
  assert.equal(nextShipToPlace(board).name, 'Battleship');
  // The freed cells can be reused.
  assert.ok(canPlaceShip(board, 2, 0, 4, HORIZONTAL));
  removeLastShip(board);
  assert.equal(removeLastShip(board), null);
});
