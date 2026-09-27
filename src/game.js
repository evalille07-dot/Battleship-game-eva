/**
 * game.js — Pure Battleship rules: boards, ship placement, firing, sinking,
 * win detection, turn order and end-of-game stats.
 *
 * This module owns all game *state* and the rules that change it. It never
 * touches the DOM and never uses randomness, so it can be unit tested in Node
 * (tests/unit/) without a browser.
 *
 * How it fits together:
 *   - src/ai.js decides *where* the AI places ships and fires, then calls the
 *     functions here to actually do it.
 *   - src/ui.js renders the state objects created here and forwards clicks.
 *
 * Coordinates: `row` 0–9 maps to letters A–J, `col` 0–9 maps to 1–10.
 */

/** Width and height of each board. */
export const BOARD_SIZE = 10;

/** Row labels, index = row number. */
export const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** The fleet, in the order the player must place it. */
export const FLEET = Object.freeze([
  Object.freeze({ name: 'Carrier', size: 5 }),
  Object.freeze({ name: 'Battleship', size: 4 }),
  Object.freeze({ name: 'Cruiser', size: 3 }),
  Object.freeze({ name: 'Submarine', size: 3 }),
  Object.freeze({ name: 'Destroyer', size: 2 }),
]);

/** Ship orientations. */
export const HORIZONTAL = 'horizontal';
export const VERTICAL = 'vertical';

/**
 * @typedef {{ row: number, col: number }} Cell
 *
 * @typedef {Object} Ship
 * @property {string} name
 * @property {number} size
 * @property {'horizontal'|'vertical'} orientation
 * @property {Cell[]} cells - Every cell the ship covers, bow first.
 * @property {number} hits - How many of its cells have been hit.
 *
 * @typedef {Object} Board
 * @property {Ship[]} ships - Placed ships, in placement order.
 * @property {(null|'hit'|'miss')[][]} shots - shots[row][col] result, null if never fired at.
 *
 * @typedef {'miss'|'hit'|'sunk'|'already-fired'|'invalid'} ShotOutcome
 *
 * @typedef {Object} ShotResult
 * @property {ShotOutcome} outcome
 * @property {number} row
 * @property {number} col
 * @property {string|null} shipName - Name of the ship hit/sunk, else null.
 *
 * @typedef {{ shots: number, hits: number, turns: number }} Stats
 *
 * @typedef {'player'|'ai'} Side
 *
 * @typedef {Object} Game
 * @property {'placement'|'battle'|'over'} phase
 * @property {Side} turn - Whose turn it is during the battle phase.
 * @property {{ player: Board, ai: Board }} boards - Each side's *own* board (where its ships are).
 * @property {{ player: Stats, ai: Stats }} stats
 * @property {Side|null} winner
 */

/**
 * Check whether a coordinate lies on the board.
 *
 * @param {number} row
 * @param {number} col
 * @returns {boolean} True if both are integers within 0..BOARD_SIZE-1.
 */
export function inBounds(row, col) {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    col >= 0 &&
    col < BOARD_SIZE
  );
}

/**
 * Human-readable coordinate label, e.g. (1, 6) → "B7".
 *
 * @param {number} row
 * @param {number} col
 * @returns {string}
 */
export function coordLabel(row, col) {
  return `${ROW_LABELS[row]}${col + 1}`;
}

/**
 * Create an empty board with no ships and no shots.
 *
 * @returns {Board} A new board object.
 */
export function createBoard() {
  return {
    ships: [],
    shots: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
  };
}

/**
 * List the cells a ship would cover. Does not check bounds.
 *
 * @param {number} row - Row of the bow (top/left end).
 * @param {number} col - Column of the bow.
 * @param {number} size - Ship length.
 * @param {'horizontal'|'vertical'} orientation - Horizontal grows rightwards, vertical grows downwards.
 * @returns {Cell[]}
 */
export function getShipCells(row, col, size, orientation) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(orientation === HORIZONTAL ? { row, col: col + i } : { row: row + i, col });
  }
  return cells;
}

/**
 * Find the ship occupying a cell.
 *
 * @param {Board} board
 * @param {number} row
 * @param {number} col
 * @returns {Ship|null} The ship at that cell, or null for open water.
 */
export function shipAt(board, row, col) {
  for (const ship of board.ships) {
    if (ship.cells.some((c) => c.row === row && c.col === col)) return ship;
  }
  return null;
}

/**
 * Check whether a ship can legally be placed: fully on the grid and not
 * overlapping any ship already on the board. (Touching is allowed.)
 *
 * @param {Board} board
 * @param {number} row
 * @param {number} col
 * @param {number} size
 * @param {'horizontal'|'vertical'} orientation
 * @returns {boolean}
 */
export function canPlaceShip(board, row, col, size, orientation) {
  if (orientation !== HORIZONTAL && orientation !== VERTICAL) return false;
  if (!Number.isInteger(size) || size < 1) return false;
  return getShipCells(row, col, size, orientation).every(
    (c) => inBounds(c.row, c.col) && shipAt(board, c.row, c.col) === null,
  );
}

/**
 * The next fleet ship still waiting to be placed on this board.
 *
 * @param {Board} board
 * @returns {{ name: string, size: number }|null} Null when the fleet is complete.
 */
export function nextShipToPlace(board) {
  return FLEET[board.ships.length] ?? null;
}

/**
 * True once all five fleet ships are on the board.
 *
 * @param {Board} board
 * @returns {boolean}
 */
export function isFleetComplete(board) {
  return board.ships.length === FLEET.length;
}

/**
 * Place the next ship of the fleet (in FLEET order) on the board.
 *
 * Placement order is enforced here rather than in the UI so that the player
 * and the AI are guaranteed to follow exactly the same rules.
 *
 * @param {Board} board - Mutated: the new ship is appended to `board.ships`.
 * @param {number} row
 * @param {number} col
 * @param {'horizontal'|'vertical'} orientation
 * @returns {Ship|null} The placed ship, or null if the placement was invalid
 *   or the fleet is already complete (board left unchanged).
 */
export function placeNextShip(board, row, col, orientation) {
  const def = nextShipToPlace(board);
  if (!def || !canPlaceShip(board, row, col, def.size, orientation)) return null;
  const ship = {
    name: def.name,
    size: def.size,
    orientation,
    cells: getShipCells(row, col, def.size, orientation),
    hits: 0,
  };
  board.ships.push(ship);
  return ship;
}

/**
 * Remove the most recently placed ship (the UNDO button).
 *
 * Only valid before any shots have been fired; the UI only offers it during
 * the placement phase.
 *
 * @param {Board} board - Mutated: the last ship is popped from `board.ships`.
 * @returns {Ship|null} The removed ship, or null if the board had none.
 */
export function removeLastShip(board) {
  return board.ships.pop() ?? null;
}

/**
 * @param {Ship} ship
 * @returns {boolean} True once every cell of the ship has been hit.
 */
export function isShipSunk(ship) {
  return ship.hits >= ship.size;
}

/**
 * Fire a shot at a board and report what happened.
 *
 * @param {Board} board - Mutated on a valid new shot: records the result in
 *   `board.shots` and increments the hit ship's `hits`. Unchanged for
 *   'already-fired' and 'invalid'.
 * @param {number} row
 * @param {number} col
 * @returns {ShotResult}
 */
export function fireAt(board, row, col) {
  if (!inBounds(row, col)) return { outcome: 'invalid', row, col, shipName: null };
  if (board.shots[row][col] !== null) {
    return { outcome: 'already-fired', row, col, shipName: null };
  }
  const ship = shipAt(board, row, col);
  if (!ship) {
    board.shots[row][col] = 'miss';
    return { outcome: 'miss', row, col, shipName: null };
  }
  board.shots[row][col] = 'hit';
  ship.hits += 1;
  return { outcome: isShipSunk(ship) ? 'sunk' : 'hit', row, col, shipName: ship.name };
}

/**
 * Win check: a board is defeated only when every cell of every ship is hit.
 * An empty board (no ships placed) is never considered defeated.
 *
 * @param {Board} board
 * @returns {boolean}
 */
export function allShipsSunk(board) {
  return board.ships.length > 0 && board.ships.every(isShipSunk);
}

/**
 * Names of ships on this board that are still afloat, in fleet order.
 * Used by the UI to list enemy survivors without revealing positions.
 *
 * @param {Board} board
 * @returns {string[]}
 */
export function remainingShipNames(board) {
  return board.ships.filter((s) => !isShipSunk(s)).map((s) => s.name);
}

/**
 * @returns {Stats} Zeroed counters for one side.
 */
export function createStats() {
  return { shots: 0, hits: 0, turns: 0 };
}

/**
 * Accuracy as a percentage rounded to one decimal place.
 *
 * @param {Stats} stats
 * @returns {number} e.g. 33.3 for 1 hit in 3 shots; 0 when no shots were fired
 *   (avoids a NaN from dividing by zero).
 */
export function accuracy(stats) {
  if (stats.shots === 0) return 0;
  return Math.round((stats.hits / stats.shots) * 1000) / 10;
}

/**
 * Create a new game in the placement phase with empty boards and zeroed stats.
 *
 * PLAY AGAIN calls this to get a brand-new object, so nothing can leak from
 * the previous game.
 *
 * @returns {Game}
 */
export function createGame() {
  return {
    phase: 'placement',
    turn: 'player',
    boards: { player: createBoard(), ai: createBoard() },
    stats: { player: createStats(), ai: createStats() },
    winner: null,
  };
}

/**
 * Move from placement to battle once both fleets are fully placed.
 * The player always fires first.
 *
 * @param {Game} game - Mutated: phase becomes 'battle' and turn 'player'.
 * @returns {boolean} True if the battle started; false if a fleet is incomplete
 *   or the game is not in the placement phase (game left unchanged).
 */
export function startBattle(game) {
  if (game.phase !== 'placement') return false;
  if (!isFleetComplete(game.boards.player) || !isFleetComplete(game.boards.ai)) return false;
  game.phase = 'battle';
  game.turn = 'player';
  return true;
}

/**
 * The opponent of a side.
 *
 * @param {Side} side
 * @returns {Side}
 */
export function opponentOf(side) {
  return side === 'player' ? 'ai' : 'player';
}

/**
 * Take one shot for `shooter` at the opponent's board, enforcing turn order.
 *
 * Turn locking lives here, not only in the UI: even if a stray click or a
 * late timer calls this out of turn, the rules still hold. Specifically:
 *   - Out-of-phase or out-of-turn shots return outcome 'ignored' and change nothing.
 *   - 'already-fired' / 'invalid' shots change nothing and do NOT use up the turn.
 *   - Any real shot (miss/hit/sunk) counts as one turn; turns strictly
 *     alternate, so a hit does not grant an extra shot.
 *   - The game ends immediately when the last enemy ship cell is hit.
 *
 * @param {Game} game - Mutated on a real shot: board shots, stats, turn, and
 *   possibly phase/winner.
 * @param {Side} shooter
 * @param {number} row
 * @param {number} col
 * @returns {ShotResult | { outcome: 'ignored', row: number, col: number, shipName: null }}
 */
export function takeShot(game, shooter, row, col) {
  if (game.phase !== 'battle' || game.turn !== shooter) {
    return { outcome: 'ignored', row, col, shipName: null };
  }
  const target = game.boards[opponentOf(shooter)];
  const result = fireAt(target, row, col);
  if (result.outcome === 'already-fired' || result.outcome === 'invalid') return result;

  const stats = game.stats[shooter];
  stats.shots += 1;
  stats.turns += 1;
  if (result.outcome !== 'miss') stats.hits += 1;

  if (allShipsSunk(target)) {
    game.phase = 'over';
    game.winner = shooter;
  } else {
    game.turn = opponentOf(shooter);
  }
  return result;
}
