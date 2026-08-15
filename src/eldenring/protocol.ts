/**
 * The sequence itself: which questions get asked, in which order, and what is
 * on the table for each one.
 *
 * Kept separate from `loadout.ts` so the pools stay pure data and this file
 * stays the one place to read the shape of a run.
 */

import {
  magicOptions,
  meleeOptions,
  progressionFor,
  rangedOptions,
  shieldOptions,
  statusOptions,
  type Option,
  type Progression,
  type ProtocolConfig,
} from './loadout.ts';

export interface Stage {
  readonly id: 'melee' | 'ranged' | 'shields' | 'magic' | 'status';
  /** Shown as the stage's heading while it runs. */
  readonly title: string;
  /** The line under it — what this stage is deciding and why. */
  readonly brief: string;
  readonly count: number;
  readonly options: readonly Option[];
}

export function stagesFor(config: ProtocolConfig): Stage[] {
  const melee = meleeOptions(config);
  const ranged = rangedOptions(config);

  const stages: Stage[] = [
    {
      id: 'melee',
      title: 'Main armament',
      brief: 'weapon classes for the run, weighted toward the ones I have never touched',
      // Asking for three out of two types would hang the draw.
      count: Math.max(1, Math.min(config.meleeCount, melee.length)),
      options: melee,
    },
    {
      id: 'ranged',
      title: 'Ranged sidearm',
      brief: 'one thing to pull aggro and finish runners',
      count: 1,
      options: ranged,
    },
    {
      id: 'shields',
      title: 'Shield loadout',
      brief:
        'three shields for the run, weighted toward the ones I have never touched; worn-out ones never come up',
      count: 3,
      options: shieldOptions(config),
    },
    {
      id: 'magic',
      title: 'Arcane discipline',
      brief: 'the stat spread the whole build has to pay for',
      count: 1,
      options: magicOptions(config),
    },
    {
      id: 'status',
      title: 'Status vector',
      brief: 'the affinity every weapon in the loadout gets built toward',
      count: 1,
      options: statusOptions(),
    },
  ];

  return stages.filter((stage) => stage.options.length > 0);
}

export interface StageResult {
  readonly stage: Stage;
  readonly winners: readonly Option[];
}

export interface Loadout {
  readonly results: readonly StageResult[];
  /** One contract per drawn weapon class, main-hand and ranged alike. */
  readonly progressions: readonly Progression[];
  readonly at: number;
}

/**
 * Assemble the finished run. Progressions are built for every weapon class
 * drawn — the bow is part of the playthrough too, and it has its own lockouts.
 */
export function assemble(results: readonly StageResult[], config: ProtocolConfig): Loadout {
  const weaponStages = results.filter((r) => r.stage.id === 'melee' || r.stage.id === 'ranged');
  const progressions = weaponStages.flatMap((r) =>
    r.winners.map((winner) => progressionFor(winner.label, config)),
  );

  return { results, progressions, at: Date.now() };
}

/** The one-line summary of a finished run, for history and announcements. */
export function summarize(loadout: Loadout): string {
  return loadout.results
    .map((r) => `${r.stage.title}: ${r.winners.map((w) => w.label).join(', ')}`)
    .join(' · ');
}
