/**
 * ai.js — The computer opponent: random fleet placement and a medium
 * "hunt and target" firing strategy.
 *
 * The AI only *decides* where to place and where to shoot; the rules that
 * apply those decisions live in src/game.js (placeNextShip, takeShot). All
 * randomness comes from an rng created by src/rng.js, so a seed makes the
 * AI's placement and every shot repeatable. No DOM access.
 *
 * Typical use (see src/ui.js):
 *   placeFleetRandomly(game.boards.ai, rng);
 *   const ai = createAi(rng);
 *   const { row, col } = chooseShot(ai);
 *   const result = takeShot(game, 'ai', row, col);
 *   recordShotResult(ai, result);
 *
 * Strategy summary:
 *   - Hunt:   no unresolved hits → fire at a random untried cell.
 *   - Target: unresolved hits exist → fire at untried cells next to them
 *             (up, down, left, right).
 *   - Line lock: two unresolved hits side by side form a line → fire only
 *             along that line, extending both ends, until the ship sinks.
 *   - Sink:   the sunk ship's cells are dropped from the unresolved hits.
 *             Anything left over belongs to a *different* (touching) ship,
 *             so the AI keeps targeting; otherwise it returns to hunting.
 */

import {
  BOARD_SIZE,
  HORIZONTAL,
  VERTICAL,
  FLEET,
  canPlaceShip,
  placeNextShip,
  inBounds,
} from './game.js';

/**
 * Neighbour offsets in the order the PRD asks for: up, down, left, right.
 * @type {ReadonlyArray<[number, number]>}
 */
const NEIGHBOUR_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Unit steps for the two line axes used by line lock.
 * @type {ReadonlyArray<[number, number]>}
 */
const LINE_AXES = [
  [0, 1], // horizontal
  [1, 0], // vertical
];

/**
 * @typedef {import('./game.js').Cell} Cell
 * @typedef {import('./game.js').Board} Board
 *
 * @typedef {Object} AiState
 * @property {ReturnType<import('./rng.js').createRng>} rng
 * @property {boolean[][]} tried - tried[row][col] is true once the AI has fired there.
 * @property {Cell[]} unresolvedHits - Hits on ships that are not yet sunk, oldest first.
 * @property {'hunt'|'target'|'line'} lastMode - How the most recent shot was chosen
 *   (for tests and debugging; does not affect behaviour).
 */

/**
 * Place the full fleet on a board at random, in fleet order, following the
 * same rules as the player (in bounds, no overlap).
 *
 * Instead of "try random spots until one fits" (which has no upper bound on
 * attempts), we list every legal position for the current ship and pick one.
 * That always terminates and every legal placement is equally likely.
 *
 * @param {Board} board - Mutated: must be empty; receives all five ships.
 * @param {ReturnType<import('./rng.js').createRng>} rng - Source of randomness.
 * @returns {Board} The same board, for convenience.
 * @throws {Error} If a ship has no legal position (cannot happen on an empty
 *   10×10 board with the standard fleet, but guards against misuse).
 */
export function placeFleetRandomly(board, rng) {
  for (const { name, size } of FLEET.slice(board.ships.length)) {
    const options = [];
    for (const orientation of [HORIZONTAL, VERTICAL]) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
          if (canPlaceShip(board, row, col, size, orientation)) options.push({ row, col, orientation });
        }
      }
    }
    if (options.length === 0) throw new Error(`No legal position for ${name}`);
    const { row, col, orientation } = rng.pick(options);
    placeNextShip(board, row, col, orientation);
  }
  return board;
}

/**
 * Create a fresh AI opponent with no shots fired and nothing to target.
 *
 * @param {ReturnType<import('./rng.js').createRng>} rng - Used for hunt shots.
 * @returns {AiState}
 */
export function createAi(rng) {
  return {
    rng,
    tried: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false)),
    unresolvedHits: [],
    lastMode: 'hunt',
  };
}

/**
 * True if the AI may still fire at this cell: on the grid and never tried.
 * Every candidate passes through here, which is what enforces the hard rule
 * "never fire twice at the same cell or outside the grid".
 *
 * @param {AiState} ai
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
function isOpen(ai, row, col) {
  return inBounds(row, col) && !ai.tried[row][col];
}

/**
 * @param {AiState} ai
 * @param {number} row
 * @param {number} col
 * @returns {boolean} True if (row, col) is one of the AI's unresolved hits.
 */
function isUnresolvedHit(ai, row, col) {
  return ai.unresolvedHits.some((h) => h.row === row && h.col === col);
}

/**
 * Line lock: look for two or more unresolved hits in a row and return the next
 * untried cell just beyond either end of that run.
 *
 * Hits are scanned newest first so the AI keeps working the line it most
 * recently extended. For each hit and each axis we walk outwards over
 * contiguous unresolved hits to find the run's two ends. A run of length 1
 * is not a line (that's plain target mode).
 *
 * If both ends of a run are blocked (a miss, an earlier shot, or the grid
 * edge) but the ship still hasn't sunk, the run must span two different ships
 * lying side by side (e.g. parallel touching ships hit across their width).
 * That line is a dead end, so we skip it and let target mode try the
 * perpendicular neighbours instead.
 *
 * @param {AiState} ai
 * @returns {Cell|null} The cell to fire at, or null if no extendable line exists.
 */
function findLineShot(ai) {
  for (let i = ai.unresolvedHits.length - 1; i >= 0; i--) {
    const hit = ai.unresolvedHits[i];
    for (const [dr, dc] of LINE_AXES) {
      let back = 0;
      while (isUnresolvedHit(ai, hit.row - dr * (back + 1), hit.col - dc * (back + 1))) back++;
      let fwd = 0;
      while (isUnresolvedHit(ai, hit.row + dr * (fwd + 1), hit.col + dc * (fwd + 1))) fwd++;
      if (back + fwd === 0) continue; // single hit on this axis: not a line

      const after = { row: hit.row + dr * (fwd + 1), col: hit.col + dc * (fwd + 1) };
      if (isOpen(ai, after.row, after.col)) return after;
      const before = { row: hit.row - dr * (back + 1), col: hit.col - dc * (back + 1) };
      if (isOpen(ai, before.row, before.col)) return before;
    }
  }
  return null;
}

/**
 * Target mode: the first untried neighbour (up, down, left, right) of the most
 * recent unresolved hit that still has one. This is the AI's "target queue":
 * rather than storing a queue that can go stale, we derive it from the
 * unresolved hits each turn, so cells of a sunk ship vanish from it
 * automatically once those hits are removed.
 *
 * @param {AiState} ai
 * @returns {Cell|null}
 */
function findTargetShot(ai) {
  for (let i = ai.unresolvedHits.length - 1; i >= 0; i--) {
    const hit = ai.unresolvedHits[i];
    for (const [dr, dc] of NEIGHBOUR_OFFSETS) {
      const cell = { row: hit.row + dr, col: hit.col + dc };
      if (isOpen(ai, cell.row, cell.col)) return cell;
    }
  }
  return null;
}

/**
 * Hunt mode: a uniformly random cell the AI has never fired at.
 *
 * @param {AiState} ai
 * @returns {Cell|null} Null only if every cell has been tried.
 */
function findHuntShot(ai) {
  const open = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!ai.tried[row][col]) open.push({ row, col });
    }
  }
  return open.length ? ai.rng.pick(open) : null;
}

/**
 * Decide where the AI fires next. Priority: line lock → target → hunt.
 *
 * Side effect: sets `ai.lastMode`. Does NOT mark the cell as tried; call
 * `recordShotResult` with the game's result for that.
 *
 * @param {AiState} ai
 * @returns {Cell} An in-bounds cell the AI has never fired at.
 * @throws {Error} If the AI has already fired at all 100 cells.
 */
export function chooseShot(ai) {
  let cell = findLineShot(ai);
  if (cell) {
    ai.lastMode = 'line';
    return cell;
  }
  cell = findTargetShot(ai);
  if (cell) {
    ai.lastMode = 'target';
    return cell;
  }
  cell = findHuntShot(ai);
  if (!cell) throw new Error('AI has no cells left to fire at');
  ai.lastMode = 'hunt';
  return cell;
}

/**
 * Update the AI's memory with the outcome of its shot.
 *
 * - miss:  cell marked tried.
 * - hit:   cell marked tried and added to the unresolved hits.
 * - sunk:  cell marked tried, then every cell of the sunk ship is removed from
 *          the unresolved hits. Hits that remain belong to another ship the
 *          AI clipped while chasing this one, so it keeps targeting them.
 * - Other outcomes ('already-fired', 'invalid', 'ignored') leave the AI
 *   untouched; they should never happen with cells from `chooseShot`.
 *
 * @param {AiState} ai - Mutated as described above.
 * @param {import('./game.js').ShotResult | { outcome: string, row: number, col: number }} result
 * @returns {void}
 */
export function recordShotResult(ai, result) {
  const { outcome, row, col } = result;
  if (outcome !== 'miss' && outcome !== 'hit' && outcome !== 'sunk') return;
  ai.tried[row][col] = true;
  if (outcome === 'miss') return;

  ai.unresolvedHits.push({ row, col });
  if (outcome === 'sunk' && result.sunkCells) {
    ai.unresolvedHits = ai.unresolvedHits.filter(
      (h) => !result.sunkCells.some((c) => c.row === h.row && c.col === h.col),
    );
  }
}
