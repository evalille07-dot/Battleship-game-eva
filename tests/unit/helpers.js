/**
 * helpers.js — Shared fixtures for the unit tests in tests/unit/.
 *
 * Provides a fixed, hand-picked fleet layout so tests can reason about exact
 * ship positions without any randomness. Not a test file itself (no
 * `.test.js` suffix), so `node --test` does not run it directly.
 */

import { createBoard, placeNextShip, HORIZONTAL } from '../../src/game.js';

/**
 * Build a board with the full fleet laid out horizontally on rows A, C, E, G, I,
 * each starting at column 1:
 *   Carrier A1–A5, Battleship C1–C4, Cruiser E1–E3, Submarine G1–G3, Destroyer I1–I2.
 *
 * @returns {import('../../src/game.js').Board} A new board with 5 ships and no shots.
 * @throws {Error} If any placement is rejected (would indicate a game.js bug).
 */
export function boardWithStandardFleet() {
  const board = createBoard();
  for (const row of [0, 2, 4, 6, 8]) {
    if (!placeNextShip(board, row, 0, HORIZONTAL)) {
      throw new Error(`fixture placement failed on row ${row}`);
    }
  }
  return board;
}

/**
 * Fire at every cell of every ship on a board, in order.
 *
 * @param {import('../../src/game.js').Board} board - Mutated by the shots.
 * @param {(board: object, row: number, col: number) => object} fire - The
 *   firing function to use (e.g. `fireAt`).
 * @returns {object[]} The shot results, in firing order.
 */
export function hitEveryShipCell(board, fire) {
  const results = [];
  for (const ship of board.ships) {
    for (const { row, col } of ship.cells) results.push(fire(board, row, col));
  }
  return results;
}
