export interface Entry {
  /** Stable identity across edits, used by the renderer and history. */
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  /** True once drawn in elimination mode; stays visible but out of the pool. */
  readonly eliminated: boolean;
}

export type Scene = 'column' | 'chamber' | 'grid';

export interface Settings {
  scene: Scene;
  count: number;
  useWeights: boolean;
  eliminate: boolean;
  sound: boolean;
}

export interface DrawRecord {
  readonly at: number;
  readonly winnerIds: readonly string[];
  readonly winnerLabels: readonly string[];
  readonly nonce: string;
  readonly digest: string;
  /** Ids eliminated by this draw, so undo can put exactly them back. */
  readonly eliminatedIds: readonly string[];
}

export interface AppState {
  entries: Entry[];
  settings: Settings;
  history: DrawRecord[];
}

export const LIMITS = {
  maxEntries: 5000,
  maxFileBytes: 2 * 1024 * 1024,
  maxLabel: 120,
  maxShareUrl: 8000,
} as const;
