/**
 * The reveal: a wavefunction collapse rendered in type.
 *
 * At the moment the chamber implodes, every candidate is drawn at once in the
 * same place — superimposed, jittering, split into red/green/blue fringes, each
 * one as opaque as its odds. Then the superposition decoheres: the losers blur
 * out and drift away, and the winner is left alone and sharp.
 *
 * Only the ghosts live on the canvas. The winner's actual name is DOM text, so
 * it stays selectable, zoomable and readable by a screen reader.
 */

export interface Ghost {
  readonly label: string;
  /** Share of the total weight, used as the ghost's presence. */
  readonly odds: number;
  readonly rgb: readonly [number, number, number];
}

/** More than this and the pile-up is mud rather than interference. */
const MAX_GHOSTS = 28;

/**
 * Pick the ghosts worth drawing: the heaviest entries, since those are the ones
 * a viewer would expect to see contending.
 */
export function chooseGhosts(candidates: readonly Ghost[]): Ghost[] {
  if (candidates.length <= MAX_GHOSTS) return [...candidates];
  return [...candidates].sort((a, b) => b.odds - a.odds).slice(0, MAX_GHOSTS);
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * @param progress 0 at the instant of collapse, 1 when fully decohered.
 */
export function drawGhosts(
  ctx: CanvasRenderingContext2D,
  ghosts: readonly Ghost[],
  cx: number,
  cy: number,
  size: number,
  progress: number,
  time: number,
): void {
  if (ghosts.length === 0 || progress >= 1) return;

  // Fringes are widest at the moment of collapse and resolve as it settles.
  const spread = (1 - easeOut(progress)) * size * 0.42;
  const split = (1 - easeOut(progress)) * size * 0.075;
  // Bright on arrival, gone by the end - the winner's DOM text takes over.
  const envelope = Math.min(1, progress * 6) * Math.pow(1 - progress, 1.6);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px 'Inter Tight', Inter, system-ui, sans-serif`;

  ghosts.forEach((ghost, i) => {
    // A per-ghost phase keeps them from jittering in lockstep.
    const phase = i * 2.399;
    const drift = progress * progress * size * 1.1;
    const gx = cx + Math.cos(phase + time * 0.9) * spread + Math.cos(phase) * drift;
    const gy = cy + Math.sin(phase + time * 1.13) * spread * 0.55 + Math.sin(phase) * drift * 0.6;

    // Presence tracks the odds, but even a long shot stays faintly visible.
    const alpha = envelope * (0.16 + 0.84 * Math.pow(ghost.odds, 0.55));
    if (alpha <= 0.004) return;

    const [r, g, b] = ghost.rgb;
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = `rgb(${r} 0 0)`;
    ctx.fillText(ghost.label, gx - split, gy);
    ctx.fillStyle = `rgb(0 ${g} 0)`;
    ctx.fillText(ghost.label, gx, gy);
    ctx.fillStyle = `rgb(0 0 ${b})`;
    ctx.fillText(ghost.label, gx + split, gy);
  });

  ctx.restore();
}

/** Type size that keeps the longest ghost inside the stage. */
export function ghostSize(ghosts: readonly Ghost[], width: number): number {
  const longest = ghosts.reduce((max, g) => Math.max(max, g.label.length), 1);
  const ideal = Math.min(width * 0.085, 72);
  return Math.max(14, Math.min(ideal, (width * 0.66) / (longest * 0.58)));
}
