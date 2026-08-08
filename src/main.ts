import './styles/tokens.css';
import './styles/layout.css';
import './styles/panel.css';

import { commitTo, type Commitment } from './draw/commit.ts';
import { normalizeWeight, oddsOf, pickWeighted, randomNonce } from './draw/rng.ts';
import { Chamber, type PoolItem } from './render/chamber.ts';
import { Sound } from './render/audio.ts';
import { loadLocal, readShareUrl, saveLocal } from './state/persist.ts';
import { activeEntries, effectiveWeights, Store } from './state/store.ts';
import { must, prefersReducedMotion } from './ui/dom.ts';
import { mountPanel } from './ui/panel.ts';
import { mountResults } from './ui/results.ts';
import type { AppState, Entry } from './types.ts';

const app = must('app-root');
const canvas = must<HTMLCanvasElement>('chamber');
const drawBtn = must<HTMLButtonElement>('draw');

const store = new Store();
const sound = new Sound();
const results = mountResults();

const chamber = new Chamber(canvas, {
  onPhase: (phase) => sound.onPhase(phase),
});

let drawing = false;
/** Signature of the last pool handed to the chamber, to avoid rebuilds. */
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

function syncChamber(): void {
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

  chamber.setPool(items, weights);
  results.showOdds(state.entries, fullOdds(state), lastCommitment);
}

function syncControls(options: { clearVerdict?: boolean } = {}): void {
  const state = store.get();
  const active = activeEntries(state).length;
  drawBtn.disabled = drawing || active === 0;
  sound.enabled = state.settings.sound;
  results.setStatus(state.entries.length, active);
  if (options.clearVerdict && !drawing) results.showIdle();
}

const panel = mountPanel(store, {
  // Editing the list invalidates whatever winner is on screen.
  onEntriesChanged: () => {
    syncChamber();
    syncControls({ clearVerdict: true });
  },
});

store.subscribe((state) => {
  saveLocal(state);
  syncChamber();
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
  const picks = pickWeighted(effectiveWeights(state, active), count);
  const winners = picks.map((i) => active[i]!).filter(Boolean);
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

  await chamber.run(picks);

  const latest = store.get();
  results.showWinners(winners, (entry) => paletteIndex(latest, entry));

  const eliminatedIds = latest.settings.eliminate ? winners.map((w) => w.id) : [];
  if (eliminatedIds.length > 0) {
    // Drain the winners out of the chamber first, then rebuild the field so the
    // remaining odds visibly redistribute rather than snapping.
    chamber.vent(picks);
    ventTimer = setTimeout(() => {
      ventTimer = undefined;
      chamber.reset();
      syncChamber();
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

  // The collapse consumed every particle. Refill the chamber behind the
  // winner's name so it is visibly ready for another draw. In elimination mode
  // the vent timer owns the rebuild, since the odds change too.
  if (ventTimer === undefined) {
    chamber.reset();
    poolSignature = '';
    syncChamber();
  }
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
  if (prefersReducedMotion()) chamber.setStaticMode(true);
  else chamber.start();

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

  panel.adopt(store.get());
  syncChamber();
  syncControls({ clearVerdict: true });
}

void boot();
