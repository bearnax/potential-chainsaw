/**
 * Algorithmic decay.
 *
 * A string that arrives as noise and resolves into a legible result, character
 * by character, out of order. It decides nothing — every draw in this app is
 * settled before a pixel moves — it is the readout admitting that it is still
 * cleaning up a signal.
 *
 * The frame is a pure function of the target, a lock order and a progress
 * value, so the thing worth testing is testable and each renderer can drive as
 * many decays as it likes from a single animation loop.
 */

/** The noise alphabet. Punctuation-heavy, so noise never reads as a word. */
export const SCRAMBLE_CHARS = 'X%#@!&*()[]:;<>+=~^?/\\';

const scrambleChar = (): string =>
  SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]!;

/**
 * Fisher-Yates. Which characters settle first is shuffled per decay, so a name
 * resolves in scattered fragments rather than wiping left to right — the
 * difference between a signal clearing and a progress bar.
 */
export function shuffledIndices(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * The visible string partway through a decay.
 *
 * Spaces are never scrambled: word boundaries are what let you see the *shape*
 * of the answer before you can read it, which is most of the tension.
 */
export function decayFrame(target: string, order: readonly number[], progress: number): string {
  const clamped = Math.min(1, Math.max(0, progress));
  const lockedCount = Math.floor(target.length * clamped);
  const locked = new Set(order.slice(0, lockedCount));

  return Array.from(target)
    .map((ch, i) => (ch === ' ' || locked.has(i) ? ch : scrambleChar()))
    .join('');
}
