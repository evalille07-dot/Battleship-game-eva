/**
 * rng.test.js — Unit tests for src/rng.js: the seeded generator must be
 * deterministic per seed, stay in range, and parse the ?seed= URL parameter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, parseSeed, randomSeed } from '../../src/rng.js';

test('same seed produces the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds produce different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('next() is in [0,1) and int(n) is an integer in [0,n)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 10000; i++) {
    const f = rng.next();
    assert.ok(f >= 0 && f < 1);
    const n = rng.int(10);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 10);
  }
});

test('int(10) eventually covers every value', () => {
  const rng = createRng(99);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(rng.int(10));
  assert.equal(seen.size, 10);
});

test('shuffle returns a permutation without mutating the input', () => {
  const rng = createRng(3);
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = rng.shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort((x, y) => x - y), input);
});

test('pick returns an element of the array', () => {
  const rng = createRng(5);
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 50; i++) assert.ok(items.includes(rng.pick(items)));
});

test('parseSeed reads ?seed=<number> and rejects junk', () => {
  assert.equal(parseSeed('?seed=123'), 123);
  assert.equal(parseSeed('?foo=1&seed=0'), 0);
  assert.equal(parseSeed(''), null);
  assert.equal(parseSeed('?seed='), null);
  assert.equal(parseSeed('?seed=abc'), null);
});

test('randomSeed returns an unsigned 32-bit integer', () => {
  const s = randomSeed();
  assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
});
