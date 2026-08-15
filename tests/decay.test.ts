import { describe, expect, it } from 'vitest';

import { decayFrame, SCRAMBLE_CHARS, shuffledIndices } from '../src/render/decay.ts';

const TARGET = 'COLOSSAL WEAPON';
const order = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('shuffledIndices', () => {
  it('is a permutation of every position', () => {
    const shuffled = shuffledIndices(24);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(order(24));
  });

  it('handles the degenerate lengths without throwing', () => {
    expect(shuffledIndices(0)).toEqual([]);
    expect(shuffledIndices(1)).toEqual([0]);
  });
});

describe('decayFrame', () => {
  it('resolves exactly to the target when finished', () => {
    expect(decayFrame(TARGET, order(TARGET.length), 1)).toBe(TARGET);
  });

  it('clamps past the ends rather than dropping characters', () => {
    expect(decayFrame(TARGET, order(TARGET.length), 4)).toBe(TARGET);
    expect(decayFrame(TARGET, order(TARGET.length), -2)).toHaveLength(TARGET.length);
  });

  it('never changes the length, however scrambled', () => {
    for (const p of [0, 0.13, 0.5, 0.87, 1]) {
      expect(decayFrame(TARGET, order(TARGET.length), p)).toHaveLength(TARGET.length);
    }
  });

  it('keeps word boundaries legible the whole way through', () => {
    // The shape of the answer should be readable before the answer is.
    const spaceAt = TARGET.indexOf(' ');
    for (const p of [0, 0.25, 0.6]) {
      expect(decayFrame(TARGET, order(TARGET.length), p)[spaceAt]).toBe(' ');
    }
  });

  it('locks characters in the order it was given', () => {
    const frame = decayFrame(TARGET, order(TARGET.length), 0.5);
    const locked = Math.floor(TARGET.length * 0.5);
    expect(frame.slice(0, locked)).toBe(TARGET.slice(0, locked));
  });

  it('locks more characters as progress advances', () => {
    const lockedCount = (p: number) => {
      const frame = decayFrame(TARGET, order(TARGET.length), p);
      return [...frame].filter((ch, i) => ch === TARGET[i]).length;
    };
    expect(lockedCount(0.25)).toBeLessThanOrEqual(lockedCount(0.75));
    expect(lockedCount(1)).toBe(TARGET.length);
  });

  it('draws unlocked characters only from the noise alphabet', () => {
    // A single scrambled slot, so anything that is not the real character has
    // to have come from the alphabet.
    const frame = decayFrame('AB', [0], 0.5);
    expect(frame[0]).toBe('A');
    expect(SCRAMBLE_CHARS).toContain(frame[1]!);
  });

  it('handles an empty target', () => {
    expect(decayFrame('', [], 0.4)).toBe('');
  });
});
