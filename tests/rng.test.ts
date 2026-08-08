import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHT,
  normalizeWeight,
  oddsOf,
  pickWeighted,
  randomBelow,
  randomFloat,
} from '../src/draw/rng.ts';

const w = (weight: number) => ({ weight });

describe('randomBelow', () => {
  it('rejects non-positive and non-integer bounds', () => {
    expect(() => randomBelow(0)).toThrow(RangeError);
    expect(() => randomBelow(-3)).toThrow(RangeError);
    expect(() => randomBelow(2.5)).toThrow(RangeError);
  });

  it('always returns 0 for a bound of 1', () => {
    for (let i = 0; i < 50; i++) expect(randomBelow(1)).toBe(0);
  });

  it('stays inside the range', () => {
    for (let i = 0; i < 5000; i++) {
      const value = randomBelow(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it('spreads roughly evenly across buckets', () => {
    const buckets = new Array<number>(10).fill(0);
    const draws = 100_000;
    for (let i = 0; i < draws; i++) buckets[randomBelow(10)]! += 1;

    const expected = draws / 10;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.06);
    }
  });
});

describe('randomFloat', () => {
  it('stays within [0, 1)', () => {
    for (let i = 0; i < 20_000; i++) {
      const value = randomFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('has a mean near 0.5', () => {
    let sum = 0;
    const draws = 100_000;
    for (let i = 0; i < draws; i++) sum += randomFloat();
    expect(Math.abs(sum / draws - 0.5)).toBeLessThan(0.01);
  });

  it('produces finer granularity than a single 32-bit draw', () => {
    // 53-bit output should essentially never repeat across a small sample.
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) seen.add(randomFloat());
    expect(seen.size).toBe(10_000);
  });
});

describe('normalizeWeight', () => {
  it('passes through usable positive numbers', () => {
    expect(normalizeWeight(3)).toBe(3);
    expect(normalizeWeight(0.25)).toBe(0.25);
    expect(normalizeWeight('4')).toBe(4);
  });

  it('falls back to the default for unusable input', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, 'n/a', null, undefined, {}]) {
      expect(normalizeWeight(bad)).toBe(DEFAULT_WEIGHT);
    }
  });

  it('caps absurd weights so prefix sums stay precise', () => {
    expect(normalizeWeight(1e30)).toBe(1e9);
  });
});

describe('pickWeighted', () => {
  it('returns nothing for an empty pool or a non-positive count', () => {
    expect(pickWeighted([], 3)).toEqual([]);
    expect(pickWeighted([w(1), w(1)], 0)).toEqual([]);
    expect(pickWeighted([w(1), w(1)], -2)).toEqual([]);
  });

  it('never returns duplicates', () => {
    const pool = Array.from({ length: 20 }, (_, i) => w(i + 1));
    for (let i = 0; i < 500; i++) {
      const picked = pickWeighted(pool, 8);
      expect(picked).toHaveLength(8);
      expect(new Set(picked).size).toBe(8);
    }
  });

  it('clamps the count to the pool size', () => {
    const pool = [w(1), w(1), w(1)];
    expect(pickWeighted(pool, 99)).toHaveLength(3);
  });

  it('returns a full permutation when count equals the pool size', () => {
    const pool = Array.from({ length: 12 }, (_, i) => w(i + 1));
    const picked = pickWeighted(pool, 12);
    expect([...picked].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
  });

  it('honours weights: a 3x entry wins about 3x as often', () => {
    const pool = [w(1), w(3)];
    const counts = [0, 0];
    const draws = 60_000;
    for (let i = 0; i < draws; i++) counts[pickWeighted(pool, 1)[0]!]! += 1;

    const heavyShare = counts[1]! / draws;
    expect(heavyShare).toBeGreaterThan(0.73);
    expect(heavyShare).toBeLessThan(0.77);
  });

  it('matches expected proportions across a lopsided pool', () => {
    const pool = [w(1), w(1), w(1), w(1), w(6)];
    const counts = new Array<number>(pool.length).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) counts[pickWeighted(pool, 1)[0]!]! += 1;

    const expected = oddsOf(pool);
    counts.forEach((count, i) => {
      expect(Math.abs(count / draws - expected[i]!)).toBeLessThan(0.012);
    });
  });

  it('degrades to an even pick when every weight is unusable', () => {
    const pool = [w(0), w(-1), w(NaN)];
    const counts = new Array<number>(3).fill(0);
    for (let i = 0; i < 9000; i++) counts[pickWeighted(pool, 1)[0]!]! += 1;
    for (const count of counts) expect(Math.abs(count - 3000) / 3000).toBeLessThan(0.1);
  });

  it('draws heavy entries earlier in a multi-winner draw', () => {
    // With one dominant entry, it should usually take the first slot.
    const pool = [w(1), w(1), w(50)];
    let firstPlace = 0;
    const draws = 5000;
    for (let i = 0; i < draws; i++) {
      if (pickWeighted(pool, 3)[0] === 2) firstPlace += 1;
    }
    expect(firstPlace / draws).toBeGreaterThan(0.9);
  });
});

describe('oddsOf', () => {
  it('sums to 1', () => {
    const odds = oddsOf([w(1), w(3), w(0.5)]);
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('splits evenly when weights are unusable', () => {
    expect(oddsOf([w(0), w(0)])).toEqual([0.5, 0.5]);
  });

  it('returns nothing for an empty pool', () => {
    expect(oddsOf([])).toEqual([]);
  });
});
