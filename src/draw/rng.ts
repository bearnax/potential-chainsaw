/**
 * Randomness core.
 *
 * Everything here is deliberately boring and testable: the winner is decided by
 * these functions before a single particle moves. The chamber animation is
 * choreography played over a result that already exists.
 */

const MAX_U32 = 0x1_0000_0000;

/** One uniform 32-bit integer from the platform CSPRNG. */
export function randomUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

/**
 * Uniform integer in [0, bound) with no modulo bias.
 *
 * Naive `randomUint32() % bound` over-represents the low values whenever bound
 * does not divide 2^32. We reject the ragged tail above the largest multiple of
 * `bound` that fits, which leaves a perfectly even distribution.
 */
export function randomBelow(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`randomBelow needs a positive integer bound, got ${bound}`);
  }
  if (bound === 1) return 0;

  const limit = MAX_U32 - (MAX_U32 % bound);
  let value = randomUint32();
  while (value >= limit) value = randomUint32();
  return value % bound;
}

/**
 * Uniform float in [0, 1) with full 53-bit mantissa resolution.
 *
 * Built from two draws so that large weight totals stay evenly sampled; a single
 * u32 would quantise the unit interval into only ~4.3 billion steps.
 */
export function randomFloat(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 26 high bits + 27 low bits = 53 bits, the exact precision of a double.
  const hi = buf[0]! >>> 6;
  const lo = buf[1]! >>> 5;
  return (hi * 0x800_0000 + lo) / 0x20_0000_0000_0000;
}

/** A hex nonce used to commit to a result before revealing it. */
export function randomNonce(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The default weight applied whenever a supplied one is unusable. */
export const DEFAULT_WEIGHT = 1;

/**
 * Coerce anything into a usable positive, finite weight.
 *
 * Zero, negatives, NaN and Infinity all collapse to 1 rather than throwing: a
 * randomizer that refuses to draw because one row of a spreadsheet said "n/a"
 * is worse than one that tells you it treated that row as weight 1.
 */
export function normalizeWeight(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WEIGHT;
  // Cap so a pathological weight can't swamp float precision in the prefix sum.
  return Math.min(n, 1e9);
}

export interface Weighted {
  readonly weight: number;
}

/**
 * Pick `count` distinct items, respecting weights, without replacement.
 *
 * Each round sums the weights still in play, draws a uniform point in that
 * range and walks the prefix sum to find where it landed. O(count x n), which
 * is nothing at our 5,000-entry ceiling and keeps the logic obvious enough to
 * audit by eye — worth more here than an alias-table's O(1).
 *
 * Returns indices into the original array, in the order they were drawn.
 */
export function pickWeighted<T extends Weighted>(items: readonly T[], count: number): number[] {
  if (count <= 0 || items.length === 0) return [];

  const wanted = Math.min(Math.floor(count), items.length);
  const remaining = items.map((_, i) => i);
  const weights = items.map((item) => normalizeWeight(item.weight));
  const winners: number[] = [];

  for (let round = 0; round < wanted; round++) {
    let total = 0;
    for (const index of remaining) total += weights[index]!;

    // Float drift or an all-degenerate pool: fall back to an even pick so we
    // always return the requested number of winners.
    if (!(total > 0)) {
      const at = randomBelow(remaining.length);
      winners.push(remaining[at]!);
      remaining.splice(at, 1);
      continue;
    }

    const target = randomFloat() * total;
    let cursor = 0;
    let chosen = remaining.length - 1; // guards against the sum overshooting

    for (let i = 0; i < remaining.length; i++) {
      cursor += weights[remaining[i]!]!;
      if (target < cursor) {
        chosen = i;
        break;
      }
    }

    winners.push(remaining[chosen]!);
    remaining.splice(chosen, 1);
  }

  return winners;
}

/** Each item's share of the total weight, as a fraction in [0, 1]. */
export function oddsOf<T extends Weighted>(items: readonly T[]): number[] {
  const weights = items.map((item) => normalizeWeight(item.weight));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return weights.map(() => (items.length ? 1 / items.length : 0));
  return weights.map((w) => w / total);
}
