/**
 * The Entropy Chamber.
 *
 * Every entry owns a share of the chamber's particles proportional to its
 * weight, in its own hue — so the colour mix on screen *is* the probability
 * distribution. Nobody has to read a percentage to see that one name is twice
 * as likely as another; it simply occupies twice as much of the light.
 *
 * The draw itself: the field spins up, implodes to a singularity that consumes
 * every particle, and blooms back out as the winner. The outcome was decided
 * before any of this started (see draw/rng.ts) — this is choreography, and the
 * commit-reveal in the panel is there to prove it.
 *
 * Simulation state lives in parallel typed arrays. Particles are allocated
 * contiguously per entry, which means a frame can set one fill colour and draw
 * a whole entry's worth of particles without touching canvas state again.
 */

import { chooseGhosts, drawGhosts, ghostSize, type Ghost } from './collapse.ts';
import { hueFor, type Hue } from './palette.ts';

export interface PoolItem {
  readonly id: string;
  readonly label: string;
  /** Position in the full list, so a hue survives elimination and reordering. */
  readonly hueIndex: number;
}

export type Phase = 'idle' | 'charge' | 'collapse' | 'bloom' | 'reveal';

export interface ChamberEvents {
  onPhase?: (phase: Phase) => void;
  /** Fires once per draw, at the moment the winner should be shown. */
  onReveal?: () => void;
}

const STEP = 1 / 60;
const BG = [8, 9, 12] as const;

const CHARGE_MS = 1150;
const COLLAPSE_MS = 780;
const BLOOM_MS = 1500;
const VENT_MS = 850;

const MAX_SPARKS = 1600;
const SPARKS_PER_WINNER = 320;

/** Particle lifecycle. Venting is elimination leaving the chamber. */
const ALIVE = 0;
const DEAD = 1;
const VENTING = 2;

/**
 * How many particles to simulate. Enough that a 5% slice still reads as a
 * visible population, few enough that a laptop fan stays quiet.
 */
function budgetFor(width: number, height: number): number {
  const base = Math.round((width * height) / 300);
  const capped = Math.min(7200, Math.max(2000, base));
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores <= 4 ? Math.min(capped, 4200) : capped;
}

/**
 * Largest-remainder apportionment, with a floor of one particle per entry.
 *
 * Plain rounding would erase every long shot in a big list — an entry with
 * 0.4% of the weight would round to zero particles and disappear from a
 * picture that is supposed to show it can still win.
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

export class Chamber {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly events: ChamberEvents;

  private width = 0;
  private height = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  // Particle state
  private count = 0;
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private seed = new Float32Array(0);
  private size = new Float32Array(0);
  private state = new Uint8Array(0);
  /** Start offset of each entry's contiguous run, length entries+1. */
  private offsets = new Int32Array(1);

  private items: PoolItem[] = [];
  private hues: Hue[] = [];
  private odds: number[] = [];
  /** Weighted mean of the pool's hues — the chamber's ambient light. */
  private ambient: [number, number, number] = [40, 60, 80];

  // Sparks: the winners' cloud, spawned at the singularity.
  private sCount = 0;
  private sx = new Float32Array(MAX_SPARKS);
  private sy = new Float32Array(MAX_SPARKS);
  private svx = new Float32Array(MAX_SPARKS);
  private svy = new Float32Array(MAX_SPARKS);
  private sWinner = new Uint8Array(MAX_SPARKS);
  private winnerHues: Hue[] = [];

  private phase: Phase = 'idle';
  private phaseT = 0;
  private ventT = 0;
  private shock = -1;
  private ghosts: Ghost[] = [];
  private revealed = false;
  private clock = 0;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private staticMode = false;
  private resolveDraw: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, events: ChamberEvents = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    this.events = events;

    this.resize();
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);

    document.addEventListener('visibilitychange', () => {
      // No point simulating a chamber nobody is looking at.
      if (document.hidden) this.stop();
      else if (!this.staticMode) this.start();
    });
  }

  /** Freeze the animation and render a still composition instead. */
  setStaticMode(on: boolean): void {
    this.staticMode = on;
    if (on) {
      this.stop();
      this.renderOnce();
    } else {
      this.start();
    }
  }

  private resize(): void {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height) return;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const previous = { w: this.width, h: this.height };
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height * 0.48;
    this.radius = Math.min(width, height) * 0.38;

    // Scale existing particles into the new frame so a resize doesn't dump
    // everything into the top-left corner.
    if (previous.w > 0 && previous.h > 0) {
      const kx = width / previous.w;
      const ky = height / previous.h;
      for (let i = 0; i < this.count; i++) {
        this.x[i]! *= kx;
        this.y[i]! *= ky;
      }
    }

    if (this.staticMode) this.renderOnce();
  }

  /**
   * Rebuild the population for a new pool.
   *
   * Particles belonging to an entry that survives are re-seeded from that
   * entry's previous positions, so adding one name to a list of twenty doesn't
   * teleport the other nineteen.
   */
  setPool(items: readonly PoolItem[], weights: readonly number[]): void {
    const previous = this.snapshotByEntry();

    this.items = [...items];
    this.hues = items.map((item) => hueFor(item.label, item.hueIndex));

    const total = weights.reduce((sum, w) => sum + w, 0);
    this.odds = total > 0 ? weights.map((w) => w / total) : weights.map(() => 0);
    this.ambient = this.hues.reduce<[number, number, number]>(
      (mix, hue, i) => {
        const share = this.odds[i] ?? 0;
        return [
          mix[0] + hue.rgb[0] * share,
          mix[1] + hue.rgb[1] * share,
          mix[2] + hue.rgb[2] * share,
        ];
      },
      [0, 0, 0],
    );

    if (items.length === 0) {
      this.count = 0;
      this.offsets = new Int32Array(1);
      if (this.staticMode) this.renderOnce();
      return;
    }

    const counts = allocate(weights, budgetFor(this.width, this.height));
    const capacity = counts.reduce((sum, c) => sum + c, 0);

    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.state = new Uint8Array(capacity);
    this.offsets = new Int32Array(items.length + 1);

    let cursor = 0;
    for (let e = 0; e < items.length; e++) {
      this.offsets[e] = cursor;
      const source = previous.get(items[e]!.id);

      for (let k = 0; k < counts[e]!; k++) {
        const from = source && source.length > 0 ? source[k % source.length]! : null;
        if (from) {
          this.x[cursor] = from.x;
          this.y[cursor] = from.y;
          this.vx[cursor] = from.vx;
          this.vy[cursor] = from.vy;
        } else {
          // Uniform over the disc: sqrt keeps the middle from clumping.
          const angle = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * this.radius;
          this.x[cursor] = this.cx + Math.cos(angle) * r;
          this.y[cursor] = this.cy + Math.sin(angle) * r;
          this.vx[cursor] = 0;
          this.vy[cursor] = 0;
        }
        this.seed[cursor] = Math.random() * Math.PI * 2;
        this.size[cursor] = 1.0 + Math.random() * 1.5;
        this.state[cursor] = ALIVE;
        cursor += 1;
      }
    }
    this.offsets[items.length] = cursor;
    this.count = cursor;

    this.canvas.setAttribute(
      'aria-label',
      `Particle chamber holding ${items.length} ${items.length === 1 ? 'entry' : 'entries'}`,
    );

    if (this.staticMode) this.renderOnce();
  }

  private snapshotByEntry(): Map<string, { x: number; y: number; vx: number; vy: number }[]> {
    const map = new Map<string, { x: number; y: number; vx: number; vy: number }[]>();
    for (let e = 0; e < this.items.length; e++) {
      const start = this.offsets[e] ?? 0;
      const end = this.offsets[e + 1] ?? start;
      const points: { x: number; y: number; vx: number; vy: number }[] = [];
      for (let i = start; i < end; i++) {
        if (this.state[i] !== ALIVE) continue;
        points.push({ x: this.x[i]!, y: this.y[i]!, vx: this.vx[i]!, vy: this.vy[i]! });
      }
      if (points.length) map.set(this.items[e]!.id, points);
    }
    return map;
  }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    if (this.running || this.staticMode) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    // Clamp so a backgrounded tab doesn't come back and integrate a huge dt.
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;

    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.step(STEP);
      this.acc -= STEP;
      steps += 1;
    }
    if (steps === 5) this.acc = 0;

    this.render();
  };

  /* ---------------- the draw ---------------- */

  /**
   * Run the full sequence for an already-decided result.
   * Resolves once the animation has finished and the chamber is settled.
   */
  run(winnerIndices: readonly number[]): Promise<void> {
    this.winnerHues = winnerIndices.map((i) => this.hues[i]).filter((h): h is Hue => !!h);
    this.ghosts = chooseGhosts(
      this.items.map((item, i) => ({
        label: item.label,
        odds: this.odds[i] ?? 0,
        rgb: (this.hues[i] ?? hueFor(item.label, item.hueIndex)).rgb,
      })),
    );
    this.revealed = false;
    this.sCount = 0;
    this.shock = -1;

    if (this.staticMode) {
      // Reduced motion: no spin, no implosion. The composition holds still and
      // the winner is simply stated.
      this.setPhase('reveal');
      this.spawnSparks(winnerIndices.length);
      this.renderOnce();
      this.events.onReveal?.();
      this.revealed = true;
      return Promise.resolve();
    }

    this.setPhase('charge');
    this.start();
    return new Promise((resolve) => {
      this.resolveDraw = resolve;
    });
  }

  /** Send an eliminated entry's particles out of the chamber. */
  vent(entryIndices: readonly number[]): void {
    for (const e of entryIndices) {
      const start = this.offsets[e] ?? 0;
      const end = this.offsets[e + 1] ?? start;
      for (let i = start; i < end; i++) {
        if (this.state[i] === ALIVE) this.state[i] = VENTING;
      }
    }
    this.ventT = VENT_MS;
  }

  /**
   * Return to the resting field, ready for the next draw. The winner's sparks
   * are left in place — they linger behind the name until the next draw
   * clears them.
   */
  reset(): void {
    this.setPhase('idle');
    this.shock = -1;
    this.ghosts = [];
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseT = 0;
    this.events.onPhase?.(phase);
  }

  /* ---------------- simulation ---------------- */

  private step(dt: number): void {
    this.clock += dt;
    this.phaseT += dt * 1000;
    if (this.ventT > 0) this.ventT = Math.max(0, this.ventT - dt * 1000);

    switch (this.phase) {
      case 'charge':
        if (this.phaseT >= CHARGE_MS) this.setPhase('collapse');
        break;
      case 'collapse':
        if (this.phaseT >= COLLAPSE_MS) {
          this.killAll();
          this.spawnSparks(this.winnerHues.length);
          this.shock = 0;
          this.setPhase('bloom');
        }
        break;
      case 'bloom':
        if (!this.revealed && this.phaseT >= BLOOM_MS * 0.46) {
          this.revealed = true;
          this.events.onReveal?.();
        }
        if (this.phaseT >= BLOOM_MS) {
          this.setPhase('reveal');
          this.resolveDraw?.();
          this.resolveDraw = null;
        }
        break;
      default:
        break;
    }

    this.integrate(dt);
    this.integrateSparks(dt);

    if (this.shock >= 0) {
      this.shock += dt;
      if (this.shock > 0.85) this.shock = -1;
    }
  }

  /** Phase-dependent force coefficients, all fed through one integrator. */
  private forces(): { spin: number; pull: number; flow: number; drag: number } {
    switch (this.phase) {
      case 'charge': {
        const t = Math.min(1, this.phaseT / CHARGE_MS);
        const eased = t * t;
        return { spin: 0.06 + eased * 1.5, pull: eased * 0.5, flow: 1 - eased * 0.8, drag: 0.988 };
      }
      case 'collapse': {
        const t = Math.min(1, this.phaseT / COLLAPSE_MS);
        return { spin: 1.56 + t * 0.9, pull: 0.5 + t * t * 5.5, flow: 0.2 - t * 0.2, drag: 0.975 };
      }
      default:
        return { spin: 0.055, pull: 0, flow: 1, drag: 0.985 };
    }
  }

  private integrate(dt: number): void {
    if (this.count === 0) return;

    const { spin, pull, flow, drag } = this.forces();
    const k = dt * 60; // force constants are tuned per 1/60s step
    const collapsing = this.phase === 'collapse';
    const t = this.clock;
    const drain = this.height + 40;

    for (let i = 0; i < this.count; i++) {
      const s = this.state[i]!;
      if (s === DEAD) continue;

      let px = this.x[i]!;
      let py = this.y[i]!;
      let pvx = this.vx[i]!;
      let pvy = this.vy[i]!;

      if (s === VENTING) {
        // Eliminated entries fall out of the chamber through the floor.
        pvy += 0.55 * k;
        pvx += Math.sin(t * 2 + this.seed[i]!) * 0.05 * k;
        pvx *= 0.99;
        px += pvx * k;
        py += pvy * k;
        if (py > drain) {
          this.state[i] = DEAD;
          continue;
        }
        this.x[i] = px;
        this.y[i] = py;
        this.vx[i] = pvx;
        this.vy[i] = pvy;
        continue;
      }

      const dx = px - this.cx;
      const dy = py - this.cy;
      const r = Math.sqrt(dx * dx + dy * dy) || 0.001;

      // The singularity consumes whatever reaches it.
      if (collapsing && r < 7) {
        this.state[i] = DEAD;
        continue;
      }

      const nx = dx / r;
      const ny = dy / r;
      const phase = this.seed[i]!;

      // Two cheap trig octaves stand in for a curl-noise field: enough
      // structure to look alive, none of the cost of real noise.
      if (flow > 0.01) {
        const fx = Math.cos(py * 0.0052 + t * 0.36 + phase);
        const fy = Math.sin(px * 0.0049 - t * 0.31 + phase * 1.37);
        pvx += fx * 0.05 * flow * k;
        pvy += fy * 0.05 * flow * k;
      }

      // Tangential swirl.
      pvx += -ny * spin * k;
      pvy += nx * spin * k;

      // Inward pull during charge and collapse.
      if (pull > 0) {
        pvx -= nx * pull * k;
        pvy -= ny * pull * k;
      }

      // Soft wall: the chamber holds its shape without a hard bounce.
      if (r > this.radius) {
        const excess = (r - this.radius) / this.radius;
        pvx -= nx * excess * 1.4 * k;
        pvy -= ny * excess * 1.4 * k;
      }

      const damping = Math.pow(drag, k);
      pvx *= damping;
      pvy *= damping;

      this.x[i] = px + pvx * k;
      this.y[i] = py + pvy * k;
      this.vx[i] = pvx;
      this.vy[i] = pvy;
    }
  }

  private killAll(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === ALIVE) this.state[i] = DEAD;
    }
  }

  private spawnSparks(winners: number): void {
    const perWinner = Math.min(SPARKS_PER_WINNER, Math.floor(MAX_SPARKS / Math.max(1, winners)));
    this.sCount = 0;

    for (let w = 0; w < winners; w++) {
      for (let i = 0; i < perWinner && this.sCount < MAX_SPARKS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = this.staticMode ? 0 : 2.5 + Math.random() * 9;
        const n = this.sCount;
        this.sx[n] = this.cx + (this.staticMode ? Math.cos(angle) * Math.random() * 90 : 0);
        this.sy[n] = this.cy + (this.staticMode ? Math.sin(angle) * Math.random() * 90 : 0);
        this.svx[n] = Math.cos(angle) * speed;
        this.svy[n] = Math.sin(angle) * speed * 0.75;
        this.sWinner[n] = w;
        this.sCount += 1;
      }
    }
  }

  private integrateSparks(dt: number): void {
    if (this.sCount === 0 || this.staticMode) return;
    const k = dt * 60;
    const damping = Math.pow(0.94, k);

    for (let i = 0; i < this.sCount; i++) {
      this.svx[i]! *= damping;
      this.svy[i]! *= damping;

      // Once they have spread, drift them into a slow orbit behind the name.
      const dx = this.sx[i]! - this.cx;
      const dy = this.sy[i]! - this.cy;
      const r = Math.sqrt(dx * dx + dy * dy) || 0.001;
      this.svx[i]! += (-dy / r) * 0.06 * k - (dx / r) * (r > this.radius * 0.8 ? 0.12 : 0) * k;
      this.svy[i]! += (dx / r) * 0.06 * k - (dy / r) * (r > this.radius * 0.8 ? 0.12 : 0) * k;

      this.sx[i]! += this.svx[i]! * k;
      this.sy[i]! += this.svy[i]! * k;
    }
  }

  /* ---------------- rendering ---------------- */

  /** Draw a single frame outside the loop (static mode, resize, pool change). */
  renderOnce(): void {
    this.ctx.fillStyle = `rgb(${BG[0]} ${BG[1]} ${BG[2]})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.paint(1);
  }

  private render(): void {
    // Trails: fade toward the ground colour rather than clearing, so fast
    // particles leave streaks. Longer trails while the chamber is spinning.
    const fade = this.phase === 'charge' || this.phase === 'collapse' ? 0.11 : 0.2;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = `rgba(${BG[0]} ${BG[1]} ${BG[2]} / ${fade})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.paint(0.75);
  }

  private paint(alphaScale: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';

    // The chamber's own light is the weight-averaged colour of everything in
    // it, so a pool dominated by one entry glows in that entry's hue.
    if (this.count > 0) {
      const [ar, ag, ab] = this.ambient;
      const glow = ctx.createRadialGradient(
        this.cx,
        this.cy,
        0,
        this.cx,
        this.cy,
        this.radius * 1.5,
      );
      glow.addColorStop(0, `rgb(${ar | 0} ${ag | 0} ${ab | 0} / 0.1)`);
      glow.addColorStop(0.55, `rgb(${ar | 0} ${ag | 0} ${ab | 0} / 0.035)`);
      glow.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.globalAlpha = alphaScale;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Pool particles, one fill colour per entry thanks to contiguous runs.
    for (let e = 0; e < this.items.length; e++) {
      const start = this.offsets[e] ?? 0;
      const end = this.offsets[e + 1] ?? start;
      if (end <= start) continue;

      const hue = this.hues[e]!;
      const [r, g, b] = hue.rgb;
      let drew = false;

      for (let i = start; i < end; i++) {
        const s = this.state[i]!;
        if (s === DEAD) continue;
        if (!drew) {
          ctx.fillStyle = `rgb(${r} ${g} ${b})`;
          ctx.globalAlpha = 0.9 * alphaScale;
          drew = true;
        }
        if (s === VENTING) {
          ctx.globalAlpha = 0.9 * alphaScale * (this.ventT / VENT_MS);
        }
        const size = this.size[i]!;
        ctx.fillRect(this.x[i]! - size / 2, this.y[i]! - size / 2, size, size);
      }
    }

    // Shockwave, in the winner's colour. Kept faint because the trail buffer
    // holds each frame's ring for a moment and they would otherwise stack into
    // a bullseye.
    if (this.shock >= 0) {
      const t = this.shock / 0.85;
      const [wr, wg, wb] = this.winnerHues[0]?.rgb ?? this.ambient;
      ctx.globalAlpha = Math.pow(1 - t, 2) * 0.32;
      ctx.strokeStyle = `rgb(${wr | 0} ${wg | 0} ${wb | 0})`;
      ctx.lineWidth = Math.max(1, 10 * (1 - t));
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, t * this.radius * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Winner sparks
    if (this.sCount > 0) {
      const settle = this.phase === 'bloom' ? Math.min(1, this.phaseT / (BLOOM_MS * 0.5)) : 1;
      for (let i = 0; i < this.sCount; i++) {
        const hue = this.winnerHues[this.sWinner[i]!] ?? this.winnerHues[0];
        if (!hue) break;
        const [r, g, b] = hue.rgb;
        ctx.fillStyle = `rgb(${r} ${g} ${b})`;
        ctx.globalAlpha = (0.85 - settle * 0.35) * alphaScale;
        ctx.fillRect(this.sx[i]! - 1, this.sy[i]! - 1, 2.1, 2.1);
      }
    }

    // Superposed candidate names, decohering
    if (this.phase === 'bloom' && this.ghosts.length > 0) {
      const progress = Math.min(1, this.phaseT / (BLOOM_MS * 0.82));
      const size = ghostSize(this.ghosts, this.width);
      drawGhosts(ctx, this.ghosts, this.cx, this.cy, size, progress, this.clock);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
