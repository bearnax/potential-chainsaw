/**
 * The Grid.
 *
 * Every option is a box, laid out as a field rather than a stack. Where the
 * Column encodes an option's odds as the *height* of its band, the Grid gives
 * every option an equal box and encodes the odds as a meter inside it — the
 * trade is that you lose area-as-probability and gain a field where dozens of
 * things can visibly change at once.
 *
 * The draw is still the real arithmetic. Weighted selection walks the running
 * total until it passes the point the RNG picked, and that walk is exactly what
 * the sweep does here: a cursor advances through the boxes in order, each one
 * it clears is a box the point was *not* in, and it stops inside the box that
 * contains it. A fat option takes longer to cross because it occupies more of
 * the total — the pacing is the distribution.
 *
 * The winner then resolves out of noise (`decay.ts`), so the last thing that
 * happens is the readout becoming legible.
 */

import type { WeightedPick } from '../draw/rng.ts';
import { decayFrame, shuffledIndices } from './decay.ts';
import { hueFor, phosphorFor, type Hue } from './palette.ts';
import type { Phase, PoolItem, Visualizer, VisualizerEvents } from './visualizer.ts';

/** The field reading itself in before anything is chosen. */
const SCAN_MS = 2200;
/** How long one box takes to resolve during the opening scan. */
const SCAN_DECODE_MS = 900;
const FIRST_SWEEP_MS = 4200;
const NEXT_SWEEP_MS = 1800;
/** Whole passes across the field before the cursor settles. */
const FIRST_SWEEP_LAPS = 2;
const NEXT_SWEEP_LAPS = 1;
/** The winner's name resolving after the cursor lands on it. */
const REVEAL_MS = 1200;
/** How long a result is left alone before the field rearranges under it. */
const HOLD_MS = 900;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

export interface GridOptions {
  palette?: 'spectrum' | 'phosphor';
}

export interface GridHandlers {
  onRemove?: (id: string) => void;
}

/** One option's stretch of the running total, for the sweep to walk. */
interface Span {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export class Grid implements Visualizer {
  private readonly host: HTMLElement;
  private readonly board: HTMLElement;
  private readonly events: VisualizerEvents;
  private readonly handlers: GridHandlers;
  private readonly palette: NonNullable<GridOptions['palette']>;

  private items: PoolItem[] = [];
  private weights: number[] = [];
  private hues: Hue[] = [];
  private cells: HTMLElement[] = [];
  private nameEls: HTMLElement[] = [];

  private raf = 0;
  private staticMode = false;
  private drawing = false;

  constructor(
    host: HTMLElement,
    events: VisualizerEvents = {},
    handlers: GridHandlers = {},
    options: GridOptions = {},
  ) {
    this.host = host;
    this.events = events;
    this.handlers = handlers;
    this.palette = options.palette ?? 'spectrum';

    this.board = document.createElement('ul');
    this.board.className = 'board';
    this.host.replaceChildren(this.board);
  }

  setStaticMode(on: boolean): void {
    this.staticMode = on;
  }

  start(): void {
    // Nothing to start. An idle grid schedules no frames.
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy(): void {
    this.stop();
    this.host.replaceChildren();
  }

  /* ---------------- the field ---------------- */

  setPool(items: readonly PoolItem[], weights: readonly number[]): void {
    this.stop();
    this.items = [...items];
    this.weights = [...weights];
    this.hues = items.map((item, i) =>
      this.palette === 'phosphor' ? phosphorFor(i) : hueFor(item.label, item.hueIndex),
    );

    const total = weights.reduce((sum, w) => sum + w, 0);
    const peak = Math.max(...weights, 0) || 1;

    this.nameEls = [];
    this.cells = items.map((item, i) => {
      const weight = weights[i] ?? 0;
      const share = total > 0 ? weight / total : 1 / Math.max(1, items.length);

      const cell = document.createElement('li');
      cell.className = 'cell';
      cell.style.setProperty('--hue', this.hues[i]!.css);
      cell.style.setProperty('--rank', String(i));
      // The meter is relative to the *biggest* option, not to the total, so a
      // 32-way field still produces bars you can compare by eye.
      cell.style.setProperty('--fill', String(weight / peak));
      cell.dataset['id'] = item.id;
      cell.title = item.detail
        ? `${item.label} — ${formatShare(share)} · ${item.detail}`
        : `${item.label} — ${formatShare(share)}`;

      const name = document.createElement('span');
      name.className = 'cell__name';
      name.textContent = item.label;
      this.nameEls.push(name);

      const detail = document.createElement('span');
      detail.className = 'cell__detail';
      detail.textContent = item.detail ?? '';

      const foot = document.createElement('span');
      foot.className = 'cell__foot';

      const meter = document.createElement('span');
      meter.className = 'cell__meter';

      const pct = document.createElement('span');
      pct.className = 'cell__pct';
      pct.textContent = formatShare(share);

      foot.append(meter, pct);
      cell.append(name, detail, foot);

      if (this.handlers.onRemove) {
        const drop = document.createElement('button');
        drop.className = 'cell__drop';
        drop.type = 'button';
        drop.textContent = '×';
        drop.setAttribute('aria-label', `Remove ${item.label}`);
        drop.addEventListener('click', (event) => {
          event.stopPropagation();
          this.handlers.onRemove?.(item.id);
        });
        cell.append(drop);
      }

      return cell;
    });

    this.board.replaceChildren(...this.cells);
    this.board.setAttribute(
      'aria-label',
      `${items.length} ${items.length === 1 ? 'option' : 'options'} in the field`,
    );
  }

  /**
   * The opening pass: the whole field arrives as noise and resolves box by box
   * in a wave. It is the one moment you see every option at once, which is what
   * a field of boxes is for.
   */
  async scan(): Promise<void> {
    if (this.staticMode || this.cells.length === 0) return;

    const targets = this.items.map((item) => item.label);
    const orders = targets.map((label) => shuffledIndices(label.length));
    // Spread the starts across the pass so the wave reaches the last box just
    // before the pass ends, however many boxes there are.
    const stagger = Math.max(0, SCAN_MS - SCAN_DECODE_MS) / Math.max(1, this.cells.length - 1);

    for (const cell of this.cells) cell.classList.add('is-noise');

    await this.animate(SCAN_MS, (elapsed) => {
      for (const [i, el] of this.nameEls.entries()) {
        const progress = (elapsed - i * stagger) / SCAN_DECODE_MS;
        el.textContent = decayFrame(targets[i]!, orders[i]!, progress);
        if (progress >= 1) this.cells[i]?.classList.remove('is-noise');
      }
    });

    for (const [i, el] of this.nameEls.entries()) {
      el.textContent = targets[i]!;
      this.cells[i]?.classList.remove('is-noise');
    }
  }

  /* ---------------- the draw ---------------- */

  async run(picks: readonly WeightedPick[]): Promise<void> {
    if (picks.length === 0) return;

    this.drawing = true;
    this.host.classList.add('is-drawing');
    for (const cell of this.cells) {
      cell.classList.remove('is-won', 'is-dimmed', 'is-passed', 'is-active', 'is-claimed');
    }

    this.setPhase('charge');

    const claimed = new Set<number>();

    for (let round = 0; round < picks.length; round++) {
      const pick = picks[round]!;

      // Last round's rejections are back in play: only claimed boxes stay out.
      for (const [i, cell] of this.cells.entries()) {
        if (!claimed.has(i)) cell.classList.remove('is-passed', 'is-dimmed', 'is-active');
      }

      if (round === 0) this.setPhase('collapse');

      const spans = this.spansFor(claimed);
      await this.sweep(
        spans,
        pick,
        round === 0 ? FIRST_SWEEP_MS : NEXT_SWEEP_MS,
        round === 0 ? FIRST_SWEEP_LAPS : NEXT_SWEEP_LAPS,
      );

      const cell = this.cells[pick.index];
      const nameEl = this.nameEls[pick.index];
      const label = this.items[pick.index]?.label;

      for (const c of this.cells) c.classList.remove('is-active');

      if (cell) {
        cell.classList.add('is-won');
        claimed.add(pick.index);
      }

      // Everything the walk never reached recedes — it was never examined.
      for (const [i, c] of this.cells.entries()) {
        if (!claimed.has(i) && !c.classList.contains('is-passed')) c.classList.add('is-dimmed');
      }

      if (nameEl && label) await this.decode(nameEl, label, REVEAL_MS);

      if (round === 0) {
        this.setPhase('bloom');
        this.events.onReveal?.();
      }

      if (round < picks.length - 1) {
        if (!this.staticMode) await wait(HOLD_MS);
        cell?.classList.add('is-claimed');
      }
    }

    this.setPhase('reveal');
    this.drawing = false;
    this.host.classList.remove('is-drawing');
  }

  /**
   * Each live option's stretch of the running total, in array order — the exact
   * intervals `pickWeightedPoints` walked to choose this round's winner.
   */
  private spansFor(claimed: ReadonlySet<number>): Span[] {
    const spans: Span[] = [];
    let cursor = 0;

    for (let i = 0; i < this.items.length; i++) {
      if (claimed.has(i)) continue;
      const weight = this.weights[i] ?? 0;
      spans.push({ index: i, start: cursor, end: cursor + weight });
      cursor += weight;
    }

    return spans;
  }

  /**
   * Advance a cursor through the running total to the point the RNG picked.
   *
   * Boxes clear as the cursor passes their stretch, so what you watch is the
   * prefix sum being walked, not a marker looking for somewhere to stop.
   *
   * The cursor laps the field before it settles. A point that falls in the
   * second box of thirty-two is a walk about four pixels long, which would
   * resolve instantly and then leave the field sitting still for the rest of
   * the stage — so the wave crosses everything a couple of times and
   * decelerates onto the answer. Every lap walks the same real intervals; only
   * the last one stops partway.
   */
  private sweep(
    spans: readonly Span[],
    pick: WeightedPick,
    duration: number,
    laps: number,
  ): Promise<void> {
    const total = spans[spans.length - 1]?.end ?? 0;

    const settle = () => {
      for (const span of spans) {
        const cell = this.cells[span.index];
        if (!cell) continue;
        cell.classList.remove('is-active');
        cell.classList.toggle('is-passed', span.index !== pick.index && span.end <= pick.point);
      }
    };

    if (this.staticMode || duration <= 0 || spans.length === 0 || total <= 0) {
      settle();
      return Promise.resolve();
    }

    const distance = laps * total + pick.point;

    return this.animate(duration, (elapsed) => {
      const travelled = distance * easeOutQuart(Math.min(1, elapsed / duration));
      const cursor = travelled % total;

      // Assigned fresh each frame rather than accumulated, so a box the wave
      // already cleared goes dark again when the next lap comes round.
      for (const span of spans) {
        const cell = this.cells[span.index];
        if (!cell) continue;
        cell.classList.toggle('is-passed', span.end <= cursor);
        cell.classList.toggle('is-active', span.start <= cursor && cursor < span.end);
      }
    }).then(settle);
  }

  /** One box's name resolving out of noise. */
  private decode(el: HTMLElement, target: string, duration: number): Promise<void> {
    if (this.staticMode || duration <= 0) {
      el.textContent = target;
      return Promise.resolve();
    }

    const order = shuffledIndices(target.length);
    el.classList.add('is-decoding');

    return this.animate(duration, (elapsed) => {
      el.textContent = decayFrame(target, order, elapsed / duration);
    }).then(() => {
      el.textContent = target;
      el.classList.remove('is-decoding');
    });
  }

  /** One rAF loop, so a whole field of decays costs a single callback. */
  private animate(duration: number, onFrame: (elapsed: number) => void): Promise<void> {
    const start = performance.now();

    return new Promise((resolve) => {
      const tick = (now: number) => {
        const elapsed = now - start;
        onFrame(Math.min(elapsed, duration));

        if (elapsed < duration) {
          this.raf = requestAnimationFrame(tick);
        } else {
          this.raf = 0;
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  vent(entryIndices: readonly number[]): void {
    for (const index of entryIndices) this.cells[index]?.classList.add('is-claimed');
  }

  reset(): void {
    this.stop();
    if (!this.drawing) this.setPhase('idle');
  }

  private setPhase(phase: Phase): void {
    this.events.onPhase?.(phase);
  }
}

function formatShare(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}
