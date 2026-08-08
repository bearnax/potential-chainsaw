/**
 * A ~40 line pub/sub store. The app has one state tree and a handful of
 * subscribers (panel, stage, chamber); anything larger would be ceremony.
 */

import type { AppState, DrawRecord, Entry, Settings } from '../types.ts';

type Listener = (state: AppState) => void;

export const defaultSettings = (): Settings => ({
  count: 1,
  useWeights: true,
  eliminate: false,
  sound: false,
});

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial?: Partial<AppState>) {
    this.state = {
      entries: initial?.entries ?? [],
      settings: { ...defaultSettings(), ...initial?.settings },
      history: initial?.history ?? [],
    };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: AppState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  setEntries(entries: Entry[]): void {
    this.commit({ ...this.state, entries, history: [] });
  }

  patchSettings(patch: Partial<Settings>): void {
    this.commit({ ...this.state, settings: { ...this.state.settings, ...patch } });
  }

  removeEntry(id: string): void {
    const entries = this.state.entries.filter((e) => e.id !== id);
    this.commit({ ...this.state, entries });
  }

  /** Mark the given ids eliminated and push the draw onto the history. */
  recordDraw(record: DrawRecord): void {
    const out = new Set(record.eliminatedIds);
    const entries = out.size
      ? this.state.entries.map((e) => (out.has(e.id) ? { ...e, eliminated: true } : e))
      : this.state.entries;
    this.commit({ ...this.state, entries, history: [record, ...this.state.history] });
  }

  /** Undo the most recent draw, restoring exactly the entries it removed. */
  undo(): DrawRecord | null {
    const [last, ...rest] = this.state.history;
    if (!last) return null;

    const back = new Set(last.eliminatedIds);
    const entries = back.size
      ? this.state.entries.map((e) => (back.has(e.id) ? { ...e, eliminated: false } : e))
      : this.state.entries;
    this.commit({ ...this.state, entries, history: rest });
    return last;
  }

  /** Put every eliminated entry back in play without touching the history. */
  restoreAll(): void {
    const entries = this.state.entries.map((e) => (e.eliminated ? { ...e, eliminated: false } : e));
    this.commit({ ...this.state, entries });
  }

  clear(): void {
    this.commit({ ...this.state, entries: [], history: [] });
  }
}

/** Entries still eligible to be drawn. */
export function activeEntries(state: AppState): Entry[] {
  return state.entries.filter((e) => !e.eliminated);
}

/** Weights as the current settings see them — flat when weighting is off. */
export function effectiveWeights(state: AppState, entries: readonly Entry[]): Entry[] {
  return state.settings.useWeights ? [...entries] : entries.map((e) => ({ ...e, weight: 1 }));
}
