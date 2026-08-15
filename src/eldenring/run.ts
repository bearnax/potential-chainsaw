/**
 * Driving a protocol run.
 *
 * The sequencer owns the pacing and nothing else: it hands each stage's pool to
 * the scene, replays the point the RNG already drew, waits long enough for a
 * human to read the result, and moves on. No stage knows about any other.
 *
 * All four stages play out in the same field. That is the point — the options
 * are where the computation happens, so a run is one continuous readout rather
 * than four separate screens.
 */

import { pickWeightedPoints } from '../draw/rng.ts';
import type { Visualizer } from '../render/visualizer.ts';
import type { Option, ProtocolConfig } from './loadout.ts';
import { assemble, stagesFor, type Loadout, type Stage, type StageResult } from './protocol.ts';

/** Beat between a result landing and the next stage's pool replacing it. */
const BETWEEN_STAGES_MS = 1600;
/** Beat after a pool appears, before the scan starts. */
const SETTLE_IN_MS = 500;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RunHooks {
  /** A stage is about to run: put its heading up. */
  onStageStart(stage: Stage, index: number, total: number): void;
  /** A stage resolved. Fires before the pause, so the result can be read. */
  onStageDone(result: StageResult, index: number, total: number): void;
  /** Cancel check, polled between stages so a config edit can abort a run. */
  cancelled?(): boolean;
}

export async function runProtocol(
  config: ProtocolConfig,
  stage: Visualizer,
  hooks: RunHooks,
  fast = false,
): Promise<Loadout | null> {
  const stages = stagesFor(config);
  if (stages.length === 0) return null;

  const beat = (ms: number) => (fast ? Promise.resolve() : wait(ms));
  const results: StageResult[] = [];

  for (const [index, current] of stages.entries()) {
    if (hooks.cancelled?.()) return null;

    hooks.onStageStart(current, index, stages.length);

    stage.setPool(
      current.options.map((option, i) => ({
        id: option.id,
        label: option.label,
        hueIndex: i,
        detail: option.detail,
      })),
      current.options.map((option) => option.weight),
    );

    await beat(SETTLE_IN_MS);
    await stage.scan?.();

    // The point is drawn here, against this stage's pool and no other. Nothing
    // downstream can move it.
    const picks = pickWeightedPoints(current.options, current.count);
    await stage.run(picks);

    const winners = picks
      .map((pick) => current.options[pick.index])
      .filter((option): option is Option => option !== undefined);

    const result: StageResult = { stage: current, winners };
    results.push(result);
    hooks.onStageDone(result, index, stages.length);

    if (index < stages.length - 1) await beat(BETWEEN_STAGES_MS);
  }

  return assemble(results, config);
}
