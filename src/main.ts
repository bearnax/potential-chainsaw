import './styles/tokens.css';
import './styles/layout.css';
import './styles/panel.css';
import './styles/column.css';

import { commitTo, type Commitment } from './draw/commit.ts';
import { normalizeWeight, oddsOf, pickWeightedPoints, randomNonce } from './draw/rng.ts';
import { Chamber } from './render/chamber.ts';
import { Column } from './render/column.ts';
import { Sound } from './render/audio.ts';
import type { PoolItem, Visualizer } from './render/visualizer.ts';
import { loadLocal, readShareUrl, saveLocal } from './state/persist.ts';
import { activeEntries, effectiveWeights, Store } from './state/store.ts';
import { must, prefersReducedMotion } from './ui/dom.ts';
import { mountPanel } from './ui/panel.ts';
import { mountResults } from './ui/results.ts';
import type { AppState, Entry, Scene } from './types.ts';

const app = must('app-root');
const stageEl = must('stage');
const canvas = must<HTMLCanvasElement>('stage-canvas');
const columnHost = must('column');
const drawBtn = must<HTMLButtonElement>('draw');
const poolBlock = must('pool-block');

const store = new Store();
const sound = new Sound();
const results = mountResults();

/**
 * The two scenes disagree about how much attention a draw deserves, so the app
 * holds one behind the Visualizer interface and never asks which it is.
 */
function makeScene(scene: Scene): Visualizer {
  const events = { onPhase: (phase: Parameters<Sound['onPhase']>[0]) => sound.onPhase(phase) };

  stageEl.classList.toggle('scene-column', scene === 'column');
  stageEl.classList.toggle('scene-chamber', scene === 'chamber');
  // In Column mode the strip *is* the pool list, so the panel's copy of it
  // would be the same information twice.
  poolBlock.hidden = scene === 'column';

  if (scene === 'chamber') return new Chamber(canvas, events);
  return new Column(columnHost, events, {
    onRemove: (id) => {
      store.removeEntry(id);
      panel.syncFromStore();
    },
  });
}

let currentScene: Scene = store.get().settings.scene;
let stage: Visualizer = makeScene(currentScene);

let drawing = false;
/** Signature of the last pool handed to the scene, to avoid rebuilds. */
let poolSignature = '';
/** Rebuilding mid-vent would cut the drain animation short. */
let ventTimer: number | undefined;
/** Kept so a pool rebuild doesn't wipe the last draw's published nonce. */
let lastCommitment: Commitment | null = null;

/** Index into the full entry list, which is what drives an entry's hue. */
function paletteIndex(state: AppState, entry: Entry): number {
  return state.entries.indexOf(entry);
}

/** Odds across the whole list, with eliminated entries reading as zero. */
function fullOdds(state: AppState): number[] {
  const active = activeEntries(state);
  const activeOdds = oddsOf(effectiveWeights(state, active));
  const byId = new Map(active.map((entry, i) => [entry.id, activeOdds[i] ?? 0]));
  return state.entries.map((entry) => byId.get(entry.id) ?? 0);
}

function syncScene(): void {
  if (ventTimer !== undefined) return;

  const state = store.get();
  const active = activeEntries(state);
  const weights = active.map((entry) =>
    state.settings.useWeights ? normalizeWeight(entry.weight) : 1,
  );

  const signature = `${state.settings.useWeights}|${active
    .map((entry, i) => `${entry.id}:${weights[i]}`)
    .join(',')}`;
  if (signature === poolSignature) return;
  poolSignature = signature;

  const items: PoolItem[] = active.map((entry) => ({
    id: entry.id,
    label: entry.label,
    hueIndex: paletteIndex(state, entry),
  }));

  stage.setPool(items, weights);
  results.showOdds(state.entries, fullOdds(state), lastCommitment);
}

function syncControls(options: { clearVerdict?: boolean } = {}): void {
  const state = store.get();
  const active = activeEntries(state).length;
  drawBtn.disabled = drawing || active === 0;
  sound.enabled = state.settings.sound;
  results.setStatus(
    state.entries.length,
    active,
    state.settings.scene === 'column' ? 'on the strip' : 'in the chamber',
  );
  if (options.clearVerdict && !drawing) results.showIdle();
}

/** Tear the old scene down and hand the new one the same pool. */
function swapScene(): void {
  const scene = store.get().settings.scene;
  if (scene === currentScene) return;

  stage.destroy();
  currentScene = scene;
  stage = makeScene(scene);

  if (prefersReducedMotion()) stage.setStaticMode(true);
  else stage.start();

  poolSignature = '';
  syncScene();
  syncControls({ clearVerdict: true });
}

const panel = mountPanel(store, {
  // Editing the list invalidates whatever winner is on screen.
  onEntriesChanged: () => {
    syncScene();
    syncControls({ clearVerdict: true });
  },
  onSceneChanged: swapScene,
});

store.subscribe((state) => {
  saveLocal(state);
  syncScene();
  if (!drawing) syncControls();
});

/* ------------------------------------------------------------------ */
/* The draw                                                            */
/* ------------------------------------------------------------------ */

async function runDraw(): Promise<void> {
  if (drawing) return;

  const state = store.get();
  const active = activeEntries(state);
  if (active.length === 0) return;

  const count = Math.min(Math.max(1, state.settings.count), active.length);
  const picks = pickWeightedPoints(effectiveWeights(state, active), count);
  const winnerIndices = picks.map((pick) => pick.index);
  const winners = winnerIndices.map((i) => active[i]!).filter(Boolean);
  if (winners.length === 0) return;

  drawing = true;
  drawBtn.disabled = true;
  app.classList.add('is-drawing');
  results.hideVerdict();

  // Commit before a single particle moves: the hash on screen during the spin
  // is the proof that the outcome was already fixed.
  const nonce = randomNonce();
  let commitment: Commitment | null = null;
  try {
    commitment = await commitTo(
      nonce,
      winners.map((w) => w.id),
    );
    lastCommitment = commitment;
    results.showCommitment(commitment);
  } catch {
    // crypto.subtle needs a secure context; the draw itself is unaffected.
    results.showCommitment(null);
  }

  await stage.run(picks);

  const latest = store.get();
  results.showWinners(winners, (entry) => paletteIndex(latest, entry));

  const eliminatedIds = latest.settings.eliminate ? winners.map((w) => w.id) : [];
  if (eliminatedIds.length > 0) {
    // Drain the winners out of the chamber first, then rebuild the field so the
    // remaining odds visibly redistribute rather than snapping.
    stage.vent(winnerIndices);
    ventTimer = setTimeout(() => {
      ventTimer = undefined;
      stage.reset();
      syncScene();
    }, 900) as unknown as number;
  }

  store.recordDraw({
    at: Date.now(),
    winnerIds: winners.map((w) => w.id),
    winnerLabels: winners.map((w) => w.label),
    nonce,
    digest: commitment?.digest ?? '',
    eliminatedIds,
  });

  const after = store.get();
  results.showOdds(after.entries, fullOdds(after), commitment);

  drawing = false;
  app.classList.remove('is-drawing');
  syncControls();

  // Let the scene settle in whatever way it means by that: the chamber refills
  // its field, the column simply puts the dart away and keeps the result on
  // screen. In elimination mode the vent timer owns this, since the odds change.
  if (ventTimer === undefined) stage.reset();
}

drawBtn.addEventListener('click', () => void runDraw());

document.addEventListener('keydown', (event) => {
  if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return;

  // Space is a shortcut for the stage, not for whatever has focus: leave text
  // fields, checkboxes and buttons to behave the way they should.
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable) return;
  if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY|OPTION)$/.test(target.tagName)) return;

  event.preventDefault();
  void runDraw();
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  if (prefersReducedMotion()) stage.setStaticMode(true);
  else stage.start();

  // A shared link wins over whatever was left in this browser's autosave.
  const shared = await readShareUrl();
  if (shared && shared.entries.length > 0) {
    store.setEntries(shared.entries);
    store.patchSettings(shared.settings);
    history.replaceState(null, '', location.pathname + location.search);
    panel.notice('loaded from a shared link');
  } else {
    const saved = loadLocal();
    if (saved) {
      store.setEntries(saved.entries);
      store.patchSettings(saved.settings);
    }
  }

  // A restored or shared setting may name the other scene than the one built
  // at start-up.
  swapScene();

  panel.adopt(store.get());
  syncScene();
  syncControls({ clearVerdict: true });
}

void boot();
