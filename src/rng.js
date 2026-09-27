/**
 * rng.js — Seedable pseudo-random number generator.
 *
 * Every random decision in the game (AI ship placement, AI hunt shots) goes
 * through an instance created here, never through Math.random directly. That
 * way a `?seed=<number>` URL parameter (parsed by `parseSeed`) or a seed passed
 * in a unit test makes a whole game fully repeatable.
 *
 * Used by: src/ai.js (placement + targeting), src/ui.js (creates the instance),
 * and the unit tests. Has no DOM access.
 */

/**
 * Create a seeded random number generator (mulberry32 algorithm).
 *
 * mulberry32 is tiny, fast and has a full 2^32 period, which is plenty for a
 * board game; we don't need cryptographic quality, only reproducibility.
 *
 * @param {number} seed - Any number; it is coerced to an unsigned 32-bit int.
 * @returns {{
 *   seed: number,
 *   next: () => number,
 *   int: (maxExclusive: number) => number,
 *   pick: <T>(items: T[]) => T,
 *   shuffle: <T>(items: T[]) => T[]
 * }} A generator object. Its methods mutate the generator's internal state
 *   (each call advances the sequence) but never mutate their arguments.
 */
export function createRng(seed) {
  const initialSeed = seed >>> 0;
  let state = initialSeed;

  /**
   * Next float in [0, 1).
   * @returns {number}
   */
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Random integer in [0, maxExclusive).
   * @param {number} maxExclusive - Upper bound (exclusive), must be >= 1.
   * @returns {number}
   */
  function int(maxExclusive) {
    return Math.floor(next() * maxExclusive);
  }

  /**
   * Pick one random element from a non-empty array.
   * @template T
   * @param {T[]} items - Array to choose from.
   * @returns {T} The chosen element.
   */
  function pick(items) {
    return items[int(items.length)];
  }

  /**
   * Return a shuffled copy of an array (Fisher–Yates). The input is untouched.
   * @template T
   * @param {T[]} items - Array to shuffle.
   * @returns {T[]} A new, shuffled array.
   */
  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  return { seed: initialSeed, next, int, pick, shuffle };
}

/**
 * Read a numeric seed from a URL query string such as "?seed=42".
 *
 * @param {string} search - A query string, e.g. `window.location.search`.
 * @returns {number|null} The seed as an unsigned 32-bit integer, or null when
 *   the parameter is missing or not a finite number.
 */
export function parseSeed(search) {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value >>> 0 : null;
}

/**
 * Produce a fresh, unpredictable seed for normal (non-test) play.
 *
 * This is the only place allowed to touch a non-seeded entropy source; the
 * result is then fed to `createRng`, so the rest of the game stays
 * deterministic for a given seed.
 *
 * @returns {number} An unsigned 32-bit integer.
 */
export function randomSeed() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    return cryptoApi.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
