/**
 * The contract every draw visualisation implements.
 *
 * There are two, and they take opposite positions on how much of your attention
 * a randomizer is entitled to.
 *
 * The Column is the quiet one and the default: the list *is* the picture. Every
 * entry is a band whose height is its exact share of the weight, the bands fill
 * one continuous strip, and drawing throws a single dart at it. Nothing moves
 * unless you press Draw.
 *
 * The Chamber is the loud one, kept for when a draw is an occasion rather than
 * a chore: particles standing in for entries, imploding to a singularity.
 */

import type { WeightedPick } from '../draw/rng.ts';

export interface PoolItem {
  readonly id: string;
  readonly label: string;
  /** Position in the full list, so a hue survives elimination and reordering. */
  readonly hueIndex: number;
  /**
   * Optional one-line justification for this entry's share, shown inside the
   * band. The protocol uses it to explain why a weapon class is as likely as
   * it is; a pasted list has nothing to say and leaves it out.
   */
  readonly detail?: string;
}

export type Phase = 'idle' | 'charge' | 'collapse' | 'bloom' | 'reveal';

export interface VisualizerEvents {
  onPhase?: (phase: Phase) => void;
  /** Fires once per draw, at the moment the winner should be shown. */
  onReveal?: () => void;
}

export interface Visualizer {
  /** Rebuild the population for a new pool and its weights. */
  setPool(items: readonly PoolItem[], weights: readonly number[]): void;
  /**
   * Play an already-decided draw. Each pick carries the dart that chose it, so
   * a scene can show the real arithmetic rather than miming it.
   * Resolves when the scene has settled.
   */
  run(picks: readonly WeightedPick[]): Promise<void>;
  /**
   * Optional pass over the pool before the draw, for scenes that can show the
   * whole field at a readable pace. The Chamber has no equivalent — its idle
   * state is already the field — so it leaves this out.
   */
  scan?(): Promise<void>;
  /** Send eliminated entries out of the scene. */
  vent(entryIndices: readonly number[]): void;
  /** Return to the resting state, ready for the next draw. */
  reset(): void;
  start(): void;
  stop(): void;
  /** Skip all motion and settle immediately (reduced motion). */
  setStaticMode(on: boolean): void;
  /** Release listeners and observers when swapped out for the other one. */
  destroy(): void;
}

/**
 * Largest-remainder apportionment, with a floor of one unit per entry.
 *
 * Plain rounding would erase every long shot in a big list — an entry with
 * 0.4% of the weight would round to zero and disappear from a picture that is
 * supposed to show it can still win.
 */
export function allocate(weights: readonly number[], budget: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (budget <= n) return new Array<number>(n).fill(1);

  const spare = budget - n;
  const total = weights.reduce((sum, w) => sum + w, 0) || n;
  const exact = weights.map((w) => (w / total) * spare);
  const counts = exact.map(Math.floor);

  let assigned = counts.reduce((sum, c) => sum + c, 0);
  const byRemainder = exact
    .map((value, i) => ({ i, rem: value - Math.floor(value) }))
    .sort((a, b) => b.rem - a.rem);

  let cursor = 0;
  while (assigned < spare) {
    counts[byRemainder[cursor % n]!.i]! += 1;
    assigned += 1;
    cursor += 1;
  }

  return counts.map((c) => c + 1);
}

/** Fixed simulation step. Force constants assume 1/60s. */
export const STEP = 1 / 60;
