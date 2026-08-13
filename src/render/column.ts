/**
 * The Column.
 *
 * Weighted random selection, drawn exactly as it is computed: lay every entry's
 * weight end to end into one continuous strip, throw a dart, see whose stretch
 * it landed in. That is not an illustration of the algorithm — it is the
 * algorithm, and `draw/rng.ts` hands us the dart it actually threw.
 *
 * Which makes the animation cheap in every sense. There is no separate stage
 * standing in for the list with particles, because the list already shows the
 * distribution: an entry with 60% of the weight is 60% of the strip. Nothing
 * needs to be re-explained, so nothing needs to be spectacular, so nothing needs
 * to move at all until you press Draw.
 *
 * Everything here is DOM. Bands are real elements with real text, which a screen
 * reader can read and a browser can zoom, and an idle column costs nothing.
 */

import type { WeightedPick } from '../draw/rng.ts';
import { hueFor, type Hue } from './palette.ts';
import type { Phase, PoolItem, Visualizer, VisualizerEvents } from './visualizer.ts';

/** Under this many pixels a band cannot hold a legible label. */
const LABEL_MIN_HEIGHT = 17;
const FIRST_SWEEP_MS = 1500;
const NEXT_SWEEP_MS = 620;
const SETTLE_MS = 420;
/** Whole passes down the strip before the dart lands. */
const SWEEP_LOOPS = 3;

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

export interface ColumnHandlers {
  /** Remove an entry from the pool entirely. */
  onRemove?: (id: string) => void;
}

export class Column implements Visualizer {
  private readonly host: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly events: VisualizerEvents;
  private readonly handlers: ColumnHandlers;

  private items: PoolItem[] = [];
  private weights: number[] = [];
  private hues: Hue[] = [];
  private bands: HTMLElement[] = [];

  private raf = 0;
  private staticMode = false;
  private drawing = false;
  private readonly observer: ResizeObserver;

  constructor(host: HTMLElement, events: VisualizerEvents = {}, handlers: ColumnHandlers = {}) {
    this.host = host;
    this.events = events;
    this.handlers = handlers;

    this.strip = document.createElement('div');
    this.strip.className = 'strip';

    this.marker = document.createElement('div');
    this.marker.className = 'marker';
    this.marker.setAttribute('aria-hidden', 'true');

    this.host.replaceChildren(this.strip, this.marker);

    // Which bands can hold a label depends on how tall the strip is, so it has
    // to be re-decided whenever the window changes.
    this.observer = new ResizeObserver(() => this.fitLabels());
    this.observer.observe(this.host);
  }

  setStaticMode(on: boolean): void {
    this.staticMode = on;
  }

  start(): void {
    // Nothing to start. The column is still until it is asked to move, which is
    // the entire point of it.
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy(): void {
    this.stop();
    this.observer.disconnect();
    this.host.replaceChildren();
  }

  /* ---------------- the strip ---------------- */

  setPool(items: readonly PoolItem[], weights: readonly number[]): void {
    this.items = [...items];
    this.weights = [...weights];
    this.hues = items.map((item) => hueFor(item.label, item.hueIndex));

    const total = weights.reduce((sum, w) => sum + w, 0);

    this.bands = items.map((item, i) => {
      const share = total > 0 ? weights[i]! / total : 1 / Math.max(1, items.length);

      const band = document.createElement('li');
      band.className = 'band';
      band.style.setProperty('--share', String(share));
      band.style.setProperty('--hue', this.hues[i]!.css);
      band.dataset['id'] = item.id;

      const rule = document.createElement('span');
      rule.className = 'band__rule';

      const name = document.createElement('span');
      name.className = 'band__name';
      name.textContent = item.label;
      // In a long list most bands are too short for a label. The name is still
      // reachable by pointer, and a winning band grows enough to show its own.
      band.title = `${item.label} — ${formatShare(share)}`;

      const pct = document.createElement('span');
      pct.className = 'band__pct';
      pct.textContent = formatShare(share);

      const drop = document.createElement('button');
      drop.className = 'band__drop';
      drop.type = 'button';
      drop.textContent = '×';
      drop.setAttribute('aria-label', `Remove ${item.label}`);
      drop.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onRemove?.(item.id);
      });

      band.append(rule, name, pct, drop);
      return band;
    });

    this.strip.replaceChildren(...this.bands);
    this.strip.setAttribute(
      'aria-label',
      `${items.length} ${items.length === 1 ? 'entry' : 'entries'}, sized by their odds`,
    );

    // A band too short to hold type hides its label rather than clipping it.
    requestAnimationFrame(() => this.fitLabels());
  }

  private fitLabels(): void {
    for (const band of this.bands) {
      band.classList.toggle('is-tight', band.offsetHeight < LABEL_MIN_HEIGHT);
    }
  }

  /* ---------------- the draw ---------------- */

  async run(picks: readonly WeightedPick[]): Promise<void> {
    if (picks.length === 0) return;

    this.drawing = true;
    this.host.classList.add('is-drawing');
    this.marker.classList.remove('is-stuck');
    for (const band of this.bands) band.classList.remove('is-won', 'is-dimmed', 'is-spent');

    this.setPhase('charge');

    // Bands drawn earlier in this sequence leave the strip, exactly as their
    // weight leaves the total — so each dart is thrown at the pool that
    // actually produced it.
    const spent = new Set<number>();

    for (let round = 0; round < picks.length; round++) {
      const pick = picks[round]!;
      const y = this.positionOf(pick, spent);

      if (round === 0) this.setPhase('collapse');
      await this.sweepTo(y, round === 0 ? FIRST_SWEEP_MS : NEXT_SWEEP_MS);

      const band = this.bands[pick.index];
      if (band) {
        band.classList.add('is-won');
        spent.add(pick.index);
        if (round < picks.length - 1) {
          // Collapse it so the next dart is thrown at the remaining strip.
          await this.settle(band);
          band.classList.add('is-spent');
        }
      }

      if (round === 0) {
        this.setPhase('bloom');
        this.events.onReveal?.();
      }
      this.marker.classList.add('is-stuck');
    }

    for (const [i, band] of this.bands.entries()) {
      if (!spent.has(i)) band.classList.add('is-dimmed');
    }

    // The dart stays where it stuck. It is the evidence, and clearing it the
    // moment it lands would throw away the only proof on screen that the
    // result came from a position in the strip rather than from nowhere.
    this.setPhase('reveal');
    this.drawing = false;
    this.host.classList.remove('is-drawing');
  }

  /**
   * Turn a dart into a pixel offset.
   *
   * The dart is a position in weight; the strip is a position in pixels, and
   * the two are not quite proportional because slivers are floored to a minimum
   * height. So the band is located by weight and the offset *within* it by
   * geometry, which lands the marker in the right stripe either way.
   */
  private positionOf(pick: WeightedPick, spent: ReadonlySet<number>): number {
    const band = this.bands[pick.index];
    if (!band) return 0;

    let before = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (i === pick.index) break;
      if (spent.has(i)) continue;
      before += this.weights[i] ?? 0;
    }

    const weight = this.weights[pick.index] ?? 1;
    const within = weight > 0 ? (pick.point - before) / weight : 0.5;
    const fraction = Math.min(1, Math.max(0, within));

    return band.offsetTop + band.offsetHeight * fraction;
  }

  /** Wait for a collapsing band's height transition, without trusting it. */
  private settle(band: HTMLElement): Promise<void> {
    if (this.staticMode) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        band.removeEventListener('transitionend', finish);
        resolve();
      };
      band.addEventListener('transitionend', finish);
      setTimeout(finish, SETTLE_MS);
    });
  }

  /**
   * The dart, thrown slowly enough to watch. The marker runs the strip a few
   * times and decelerates onto its resting place — the deceleration is the only
   * theatre here, and it is over in a second and a half.
   */
  private sweepTo(target: number, duration: number): Promise<void> {
    const height = this.strip.offsetHeight || 1;

    this.marker.classList.add('is-live');

    if (this.staticMode || duration <= 0) {
      this.marker.style.transform = `translateY(${target}px)`;
      return Promise.resolve();
    }

    const from = currentY(this.marker);
    // Always travel forward and downward, wrapping at the bottom, so the run
    // reads as one continuous pass rather than a jump to the answer.
    const distance = SWEEP_LOOPS * height + ((target - from + height) % height);
    const start = performance.now();

    return new Promise((resolve) => {
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const y = (from + distance * easeOutQuart(t)) % height;
        this.marker.style.transform = `translateY(${y}px)`;

        if (t < 1) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this.marker.style.transform = `translateY(${target}px)`;
          this.raf = 0;
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  vent(entryIndices: readonly number[]): void {
    for (const index of entryIndices) {
      this.bands[index]?.classList.add('is-spent');
    }
  }

  /**
   * Resting, for a column, means putting the dart away. The winning band keeps
   * its highlight — there is nothing to repopulate and no reason to throw the
   * result away the instant it lands. The next draw clears it, and so does any
   * edit to the list.
   */
  reset(): void {
    this.stop();
    if (!this.drawing) this.setPhase('idle');
  }

  private setPhase(phase: Phase): void {
    this.events.onPhase?.(phase);
  }
}

function currentY(el: HTMLElement): number {
  const match = /translateY\(([-\d.]+)px\)/.exec(el.style.transform);
  return match ? Number(match[1]) : 0;
}

function formatShare(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}
