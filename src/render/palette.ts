/**
 * One hue per entry, stable across reloads and shared links.
 *
 * Hues are placed on a golden-angle spiral rather than picked at random, so
 * adjacent entries never land on near-identical colours, and every hue is
 * chosen for legibility as emissive particles against a near-black ground.
 */

const GOLDEN_ANGLE = 137.508;

/** FNV-1a: tiny, well-spread, and identical in every browser. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Hue {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  /** Premultiplied 0-255 channels, for additive canvas drawing. */
  readonly rgb: readonly [number, number, number];
  readonly css: string;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Index drives the spiral so a pasted list fans across the wheel; the label
 * hash only nudges within a slot, which keeps colours stable when a list is
 * reordered but still distinct when two entries land on the same index.
 */
export function hueFor(label: string, index: number): Hue {
  const jitter = (hash32(label) % 1000) / 1000;
  const h = (index * GOLDEN_ANGLE + jitter * 14) % 360;

  // Yellows and yellow-greens read dim on black at the same lightness as blues,
  // so lift them slightly rather than letting one entry vanish.
  const nearYellow = Math.cos(((h - 60) * Math.PI) / 180);
  const l = 0.62 + 0.06 * Math.max(0, nearYellow);
  const s = 0.78 - 0.06 * Math.max(0, nearYellow);

  const rgb = hslToRgb(h, s, l);
  return {
    h,
    s,
    l,
    rgb,
    css: `hsl(${h.toFixed(1)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`,
  };
}

/** Hues for a whole list, positionally spread. */
export function paletteFor(labels: readonly string[]): Hue[] {
  return labels.map((label, i) => hueFor(label, i));
}
