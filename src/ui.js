/**
 * ui.js — DOM rendering and event handling for Neon Battleship.
 *
 * This is the only module that touches the page. It owns *presentation*
 * state (current orientation, hover preview, the pending AI timer) and
 * delegates every rule to the pure modules:
 *   - src/game.js  decides whether a placement or shot is legal and what it did.
 *   - src/ai.js    places the enemy fleet and picks the AI's shots.
 *   - src/rng.js   provides the seeded randomness (`?seed=<n>` in the URL).
 *
 * Flow: start screen → placement (5 ships) → battle (alternating shots, AI
 * waits ~600ms) → end overlay → PLAY AGAIN builds a brand-new game.
 *
 * The grids are built once as 100 <button>s each; `render()` then only
 * updates classes and labels, so rendering stays cheap and focus is never
 * lost to re-created elements.
 */

import {
  BOARD_SIZE,
  ROW_LABELS,
  HORIZONTAL,
  VERTICAL,
  FLEET,
  coordLabel,
  createGame,
  getShipCells,
  canPlaceShip,
  nextShipToPlace,
  placeNextShip,
  removeLastShip,
  isFleetComplete,
  startBattle,
  takeShot,
  shipAt,
  isShipSunk,
  accuracy,
} from './game.js';
import { createAi, chooseShot, recordShotResult, placeFleetRandomly } from './ai.js';
import { createRng, parseSeed, randomSeed } from './rng.js';

/** How long the AI "thinks" before firing, so its turn is easy to follow. */
const AI_DELAY_MS = 600;

/** Seed from the URL, if any. Read once: PLAY AGAIN reuses it so seeded runs stay repeatable. */
const URL_SEED = parseSeed(window.location.search);

const $ = (id) => document.getElementById(id);

const dom = {
  startScreen: $('start-screen'),
  gameScreen: $('game-screen'),
  startBtn: $('start-btn'),
  status: $('status'),
  placementControls: $('placement-controls'),
  rotateBtn: $('rotate-btn'),
  undoBtn: $('undo-btn'),
  playerGrid: $('player-grid'),
  enemyGrid: $('enemy-grid'),
  playerFleet: $('player-fleet'),
  enemyFleet: $('enemy-fleet'),
  overlay: $('end-overlay'),
  endTitle: $('end-title'),
  endSubtitle: $('end-subtitle'),
  revealGrid: $('reveal-grid'),
  playAgainBtn: $('play-again-btn'),
};

/**
 * All mutable UI state. Replaced wholesale by `newGame()` so nothing from a
 * previous game can survive a reset.
 *
 * @type {{
 *   game: import('./game.js').Game,
 *   ai: import('./ai.js').AiState,
 *   seed: number,
 *   orientation: 'horizontal'|'vertical',
 *   preview: { row: number, col: number } | null,
 *   lastPointerType: string,
 *   flash: { board: 'player'|'enemy', row: number, col: number } | null,
 *   aiTimer: number | null,
 *   message: string,
 * }}
 */
let state;

/** Per-grid 2D arrays of the cell buttons, indexed [row][col]. */
const cells = { player: [], enemy: [], reveal: [] };

/* ------------------------------------------------------------------ */
/* Setup                                                                */
/* ------------------------------------------------------------------ */

/**
 * Build one grid: a corner, column headers 1–10, then for each row a label
 * A–J followed by ten cells.
 *
 * @param {HTMLElement} container - Grid element to fill (emptied first).
 * @param {'player'|'enemy'|'reveal'} key - Which `cells` array to populate.
 * @param {boolean} interactive - Buttons for playable grids; plain divs for
 *   the read-only reveal grid in the end overlay.
 * @returns {void} Side effect: replaces the container's children and `cells[key]`.
 */
function buildGrid(container, key, interactive) {
  container.replaceChildren();
  cells[key] = [];
  const corner = document.createElement('span');
  corner.className = 'grid__label';
  corner.setAttribute('aria-hidden', 'true');
  container.append(corner);
  for (let col = 0; col < BOARD_SIZE; col++) {
    const label = document.createElement('span');
    label.className = 'grid__label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = String(col + 1);
    container.append(label);
  }
  for (let row = 0; row < BOARD_SIZE; row++) {
    const label = document.createElement('span');
    label.className = 'grid__label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = ROW_LABELS[row];
    container.append(label);
    cells[key].push([]);
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement(interactive ? 'button' : 'div');
      if (interactive) cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      container.append(cell);
      cells[key][row].push(cell);
    }
  }
}

/**
 * Read the row/col of the grid cell an event came from.
 *
 * @param {Event} event
 * @returns {{ row: number, col: number } | null} Null if the event target
 *   isn't inside a cell (e.g. a row label).
 */
function cellFromEvent(event) {
  const cell = event.target instanceof Element ? event.target.closest('.cell') : null;
  if (!cell) return null;
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

/**
 * Wire up every event listener. Called once at load; listeners read the
 * current `state`, so they keep working across PLAY AGAIN resets.
 *
 * @returns {void}
 */
function bindEvents() {
  dom.startBtn.addEventListener('click', () => {
    dom.startScreen.hidden = true;
    dom.gameScreen.hidden = false;
    newGame();
  });
  dom.playAgainBtn.addEventListener('click', () => {
    dom.overlay.hidden = true;
    newGame();
  });
  dom.rotateBtn.addEventListener('click', rotate);
  dom.undoBtn.addEventListener('click', undo);

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'r' || event.key === 'R') rotate();
  });

  // Placement preview. Mouse/pen show it on hover; keyboard shows it on focus.
  // Touch has no hover, so a first tap previews and a second tap places (see click).
  dom.playerGrid.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const at = cellFromEvent(event);
    if (at) setPreview(at);
  });
  dom.playerGrid.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') setPreview(null);
  });
  dom.playerGrid.addEventListener('focusin', (event) => {
    // Only keyboard focus should preview. A tap also focuses the button
    // (pointerdown → focus → click); previewing here would make the click
    // see "already previewed" and place the ship on the very first tap.
    if (state?.lastPointerType) return;
    const at = cellFromEvent(event);
    if (at) setPreview(at);
  });

  // Remember what kind of pointer produced the upcoming click. Keyboard
  // activation fires `click` with no pointerdown, so reset after each click.
  for (const grid of [dom.playerGrid, dom.enemyGrid]) {
    grid.addEventListener('pointerdown', (event) => {
      state.lastPointerType = event.pointerType;
    });
    grid.addEventListener('keydown', moveFocusWithArrows);
  }

  dom.playerGrid.addEventListener('click', (event) => {
    const at = cellFromEvent(event);
    const pointerType = state.lastPointerType;
    state.lastPointerType = '';
    if (at) handlePlacementClick(at, pointerType);
  });
  dom.enemyGrid.addEventListener('click', (event) => {
    state.lastPointerType = '';
    const at = cellFromEvent(event);
    if (at) handlePlayerFire(at.row, at.col);
  });
}

/* ------------------------------------------------------------------ */
/* Game lifecycle                                                       */
/* ------------------------------------------------------------------ */

/**
 * Start a completely fresh game: new rules state, new AI, new enemy fleet.
 *
 * Any AI shot still scheduled from the previous game is cancelled first;
 * otherwise a late timer could fire into the new game.
 *
 * @returns {void} Side effects: replaces `state`, re-renders the page.
 */
function newGame() {
  if (state && state.aiTimer !== null) clearTimeout(state.aiTimer);
  const seed = URL_SEED ?? randomSeed();
  const rng = createRng(seed);
  const game = createGame();
  placeFleetRandomly(game.boards.ai, rng);
  state = {
    game,
    ai: createAi(rng),
    seed,
    orientation: HORIZONTAL,
    preview: null,
    lastPointerType: '',
    flash: null,
    aiTimer: null,
    message: '',
  };
  document.body.dataset.seed = String(seed);
  state.message = placementPrompt();
  render();
}

/**
 * @returns {string} Status text asking for the next ship, e.g. "Place your Carrier (5)".
 */
function placementPrompt() {
  const next = nextShipToPlace(state.game.boards.player);
  return next ? `Place your ${next.name} (${next.size})` : '';
}

/**
 * Toggle ship orientation (ROTATE button or R key). Only meaningful during placement.
 *
 * @returns {void} Side effects: flips `state.orientation`, re-renders.
 */
function rotate() {
  if (state?.game.phase !== 'placement') return;
  state.orientation = state.orientation === HORIZONTAL ? VERTICAL : HORIZONTAL;
  render();
}

/**
 * Remove the most recently placed ship (UNDO button).
 *
 * @returns {void} Side effects: mutates the player board, updates the status, re-renders.
 */
function undo() {
  if (state?.game.phase !== 'placement') return;
  if (removeLastShip(state.game.boards.player)) {
    state.message = placementPrompt();
    render();
  }
}

/**
 * Show (or clear) the placement preview anchored at a cell.
 *
 * @param {{ row: number, col: number } | null} at
 * @returns {void} Side effects: updates `state.preview`, re-renders.
 */
function setPreview(at) {
  if (!state || state.game.phase !== 'placement') return;
  const same = at && state.preview && at.row === state.preview.row && at.col === state.preview.col;
  if (same || (!at && !state.preview)) return;
  state.preview = at;
  render();
}

/**
 * Handle a click/tap on the player's grid during placement.
 *
 * Touch taps need two steps: the first tap on a cell only previews the ship
 * there (there is no hover on touch screens); tapping the same cell again
 * places it. Mouse and keyboard place immediately because the preview was
 * already visible via hover/focus.
 *
 * @param {{ row: number, col: number }} at
 * @param {string} pointerType - 'mouse' | 'pen' | 'touch' | '' (keyboard).
 * @returns {void} Side effects: may place a ship, start the battle, re-render.
 */
function handlePlacementClick(at, pointerType) {
  const { game } = state;
  if (game.phase !== 'placement') return;
  const previewedHere = state.preview && state.preview.row === at.row && state.preview.col === at.col;
  if (pointerType === 'touch' && !previewedHere) {
    state.preview = at;
    render();
    return;
  }

  const def = nextShipToPlace(game.boards.player);
  const placed = placeNextShip(game.boards.player, at.row, at.col, state.orientation);
  if (!placed) {
    state.preview = at;
    state.message = `Can't place your ${def.name} there. Try another spot.`;
    render();
    return;
  }

  // On touch there is no hover to move the preview along, so clear it rather
  // than leave the next ship's (probably red) preview sitting on top of this one.
  if (pointerType === 'touch') state.preview = null;
  if (isFleetComplete(game.boards.player)) {
    state.preview = null;
    startBattle(game);
    state.message = 'Your turn: fire!';
  } else {
    state.message = placementPrompt();
  }
  render();
}

/**
 * Handle a click/tap on the enemy grid.
 *
 * Turn locking: clicks outside the battle phase or during the AI's turn are
 * ignored silently, as are clicks on cells already fired at (game.js reports
 * 'ignored' / 'already-fired' and changes nothing). The `aiTimer` check is a
 * second guard for the ~600ms window where it is the AI's turn but it hasn't
 * fired yet.
 *
 * @param {number} row
 * @param {number} col
 * @returns {void} Side effects: fires a shot, updates status, may schedule
 *   the AI's turn or end the game.
 */
function handlePlayerFire(row, col) {
  const { game } = state;
  if (game.phase !== 'battle' || game.turn !== 'player' || state.aiTimer !== null) return;
  const result = takeShot(game, 'player', row, col);
  if (result.outcome === 'ignored' || result.outcome === 'already-fired' || result.outcome === 'invalid') return;

  state.flash = result.outcome === 'miss' ? null : { board: 'enemy', row, col };
  const said = {
    miss: `Miss at ${coordLabel(row, col)}.`,
    hit: `Hit at ${coordLabel(row, col)}!`,
    sunk: `You sunk their ${result.shipName}!`,
  }[result.outcome];

  if (game.phase === 'over') {
    endGame();
    return;
  }
  state.message = `${said} Enemy is firing...`;
  state.aiTimer = window.setTimeout(runAiTurn, AI_DELAY_MS);
  render();
}

/**
 * The AI's turn: pick a shot, fire it, tell the AI what happened, then hand
 * the turn back to the player (or end the game).
 *
 * @returns {void} Side effects: mutates game + AI state, clears `aiTimer`, re-renders.
 */
function runAiTurn() {
  state.aiTimer = null;
  const { game, ai } = state;
  if (game.phase !== 'battle' || game.turn !== 'ai') return;
  const { row, col } = chooseShot(ai);
  const result = takeShot(game, 'ai', row, col);
  recordShotResult(ai, result);

  state.flash = result.outcome === 'miss' ? null : { board: 'player', row, col };
  if (game.phase === 'over') {
    endGame();
    return;
  }
  const said = {
    miss: `Enemy missed at ${coordLabel(row, col)}.`,
    hit: `Enemy hit your ${result.shipName} at ${coordLabel(row, col)}!`,
    sunk: `Enemy sunk your ${result.shipName}!`,
  }[result.outcome];
  state.message = `${said} Your turn: fire!`;
  render();
}

/**
 * Show the end-of-game overlay: result, stats for both sides, and the enemy
 * fleet revealed (including ships the player never found).
 *
 * @returns {void} Side effects: fills and shows the overlay, focuses PLAY AGAIN.
 */
function endGame() {
  const { game } = state;
  const won = game.winner === 'player';
  state.message = won ? 'VICTORY! You sank the enemy fleet.' : 'GAME OVER. Your fleet was sunk.';
  render();

  dom.overlay.dataset.result = won ? 'victory' : 'defeat';
  dom.endTitle.textContent = won ? 'VICTORY' : 'GAME OVER';
  dom.endSubtitle.textContent = won ? 'You sank all 5 enemy ships!' : 'The enemy sank all 5 of your ships.';
  for (const side of ['player', 'ai']) {
    const stats = game.stats[side];
    setStat(`${side}-shots`, String(stats.shots));
    setStat(`${side}-hits`, String(stats.hits));
    setStat(`${side}-accuracy`, `${accuracy(stats).toFixed(1)}%`);
    setStat(`${side}-turns`, String(stats.turns));
  }
  renderRevealGrid();
  dom.overlay.hidden = false;
  dom.playAgainBtn.focus();
}

/**
 * @param {string} key - The cell's `data-stat` value.
 * @param {string} text
 * @returns {void} Side effect: sets that stats cell's text.
 */
function setStat(key, text) {
  dom.overlay.querySelector(`[data-stat="${key}"]`).textContent = text;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Bring the whole game screen in line with `state`.
 *
 * @returns {void} Side effects: DOM updates only.
 */
function render() {
  const { game } = state;
  const placing = game.phase === 'placement';
  const playerTurn = game.phase === 'battle' && game.turn === 'player' && state.aiTimer === null;

  dom.status.textContent = state.message;
  dom.placementControls.hidden = !placing;
  dom.rotateBtn.textContent = state.orientation === HORIZONTAL ? 'ROTATE (HORIZ)' : 'ROTATE (VERT)';
  dom.undoBtn.disabled = game.boards.player.ships.length === 0;

  dom.playerGrid.classList.toggle('grid--active', placing);
  dom.enemyGrid.classList.toggle('grid--active', playerTurn);
  dom.enemyGrid.classList.toggle('grid--locked', !playerTurn);
  dom.gameScreen.dataset.phase = game.phase;
  dom.gameScreen.dataset.turn = game.phase === 'battle' ? (state.aiTimer === null ? game.turn : 'ai') : '';

  renderPlayerGrid();
  renderEnemyGrid();
  renderFleetList(dom.playerFleet, game.boards.player, placing);
  renderFleetList(dom.enemyFleet, game.boards.ai, false);
}

/**
 * Cells covered by the current placement preview, and whether it's legal.
 *
 * @returns {{ keys: Set<string>, valid: boolean }} Keys are "row,col" for
 *   in-bounds preview cells (off-grid parts simply aren't drawn).
 */
function previewCells() {
  const next = nextShipToPlace(state.game.boards.player);
  if (state.game.phase !== 'placement' || !state.preview || !next) return { keys: new Set(), valid: false };
  const { row, col } = state.preview;
  const valid = canPlaceShip(state.game.boards.player, row, col, next.size, state.orientation);
  const keys = new Set(
    getShipCells(row, col, next.size, state.orientation)
      .filter((c) => c.row >= 0 && c.row < BOARD_SIZE && c.col >= 0 && c.col < BOARD_SIZE)
      .map((c) => `${c.row},${c.col}`),
  );
  return { keys, valid };
}

/**
 * Update every cell of the player's grid: ships, shots, sunk ships, preview.
 *
 * @returns {void}
 */
function renderPlayerGrid() {
  const board = state.game.boards.player;
  const preview = previewCells();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = cells.player[row][col];
      const ship = shipAt(board, row, col);
      const shot = board.shots[row][col];
      const sunk = ship !== null && isShipSunk(ship);
      const inPreview = preview.keys.has(`${row},${col}`);
      cell.classList.toggle('ship', ship !== null);
      cell.classList.toggle('hit', shot === 'hit' && !sunk);
      cell.classList.toggle('miss', shot === 'miss');
      cell.classList.toggle('sunk', sunk);
      cell.classList.toggle('preview-valid', inPreview && preview.valid);
      cell.classList.toggle('preview-invalid', inPreview && !preview.valid);
      cell.classList.toggle('flash', isFlashing('player', row, col));

      let desc = ship ? ship.name : 'empty';
      if (sunk) desc = `${ship.name}, sunk`;
      else if (shot === 'hit') desc = `${ship.name}, hit`;
      else if (shot === 'miss') desc = 'miss';
      cell.setAttribute('aria-label', `Your grid ${coordLabel(row, col)}, ${desc}`);
    }
  }
}

/**
 * Update every cell of the enemy grid. Ship positions are never shown here
 * except for sunk ships (fully highlighted); unsunk ships are revealed only
 * in the end-of-game overlay.
 *
 * @returns {void}
 */
function renderEnemyGrid() {
  const board = state.game.boards.ai;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = cells.enemy[row][col];
      const shot = board.shots[row][col];
      const ship = shot === 'hit' ? shipAt(board, row, col) : null;
      const sunk = ship !== null && isShipSunk(ship);
      cell.classList.toggle('hit', shot === 'hit' && !sunk);
      cell.classList.toggle('miss', shot === 'miss');
      cell.classList.toggle('sunk', sunk);
      cell.classList.toggle('fired', shot !== null);
      cell.classList.toggle('flash', isFlashing('enemy', row, col));

      let desc = 'not fired';
      if (sunk) desc = `sunk ${ship.name}`;
      else if (shot) desc = shot;
      cell.setAttribute('aria-label', `Enemy grid ${coordLabel(row, col)}, ${desc}`);
    }
  }
}

/**
 * Fill the read-only enemy grid in the end overlay: every enemy ship is
 * shown, with sunk ones distinguished from ones the player never found.
 *
 * @returns {void}
 */
function renderRevealGrid() {
  const board = state.game.boards.ai;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = cells.reveal[row][col];
      const ship = shipAt(board, row, col);
      const shot = board.shots[row][col];
      cell.className = 'cell';
      if (ship) cell.classList.add(isShipSunk(ship) ? 'sunk' : 'revealed');
      if (ship && !isShipSunk(ship) && shot === 'hit') cell.classList.add('hit');
      if (shot === 'miss') cell.classList.add('miss');
    }
  }
}

/**
 * @param {'player'|'enemy'} board
 * @param {number} row
 * @param {number} col
 * @returns {boolean} True if this cell is the most recent hit (gets the flash effect).
 */
function isFlashing(board, row, col) {
  const f = state.flash;
  return f !== null && f.board === board && f.row === row && f.col === col;
}

/**
 * Render a fleet status list: afloat vs sunk, and during placement which
 * ship is being placed next. Shows names only, never positions.
 *
 * @param {HTMLUListElement} list - Mutated: children replaced.
 * @param {import('./game.js').Board} board
 * @param {boolean} placing - True during the player's placement phase.
 * @returns {void}
 */
function renderFleetList(list, board, placing) {
  const next = placing ? nextShipToPlace(board) : null;
  const items = FLEET.map(({ name, size }) => {
    const li = document.createElement('li');
    const ship = board.ships.find((s) => s.name === name);
    const sunk = ship ? isShipSunk(ship) : false;
    li.textContent = `${name} (${size})`;
    li.className = 'fleet-list__item';
    if (sunk) {
      li.classList.add('is-sunk');
      li.append(Object.assign(document.createElement('span'), { className: 'visually-hidden', textContent: ', sunk' }));
    } else if (next && next.name === name) {
      li.classList.add('is-next');
    } else if (placing && !ship) {
      li.classList.add('is-pending');
    }
    return li;
  });
  list.replaceChildren(...items);
}

/**
 * Arrow-key navigation inside a grid (nice-to-have keyboard support).
 *
 * @param {KeyboardEvent} event
 * @returns {void} Side effect: moves focus to the neighbouring cell.
 */
function moveFocusWithArrows(event) {
  const steps = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const step = steps[event.key];
  const at = cellFromEvent(event);
  if (!step || !at) return;
  event.preventDefault();
  const row = Math.min(BOARD_SIZE - 1, Math.max(0, at.row + step[0]));
  const col = Math.min(BOARD_SIZE - 1, Math.max(0, at.col + step[1]));
  const key = event.currentTarget === dom.playerGrid ? 'player' : 'enemy';
  cells[key][row][col].focus();
}

buildGrid(dom.playerGrid, 'player', true);
buildGrid(dom.enemyGrid, 'enemy', true);
buildGrid(dom.revealGrid, 'reveal', false);
bindEvents();
