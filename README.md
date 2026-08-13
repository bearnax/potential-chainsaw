# The Column

A weighted randomizer that makes probability visible.

Paste a list, drop a CSV, or open a shared link. Every entry becomes a band as
tall as its share of the weight, and together they fill one continuous strip —
so the list _is_ the distribution. Hit **Draw** and a single dart runs the strip
and sticks where it lands.

That dart is not a mime of the algorithm; it is the algorithm. Weighted selection
works by laying every entry's weight end to end and picking one point in the
total, and `pickWeightedPoints` hands the scene the exact point it picked. The
marker's resting position is that number.

Because the strip already shows the odds, the animation has nothing to
re-explain — so it is small, it is over in about a second and a half, and
**nothing on the page moves until you press Draw.**

**Live:** https://bearnax.github.io/potential-chainsaw/

### Two scenes

- **The Column** (default) — the quiet one, described above.
- **Entropy Chamber** — the loud one, kept for when a draw is an occasion rather
  than a chore: particles standing in for entries, spun up and imploded to a
  singularity that blooms back out as the winner. Switchable in the panel and
  remembered between visits.

## What it does

- **Paste or type** — one entry per line. `Ada, 3` is three times as likely as `Ada`.
- **CSV / TSV** — drag and drop anywhere, with column pickers and header detection.
  Handles quoted fields, embedded commas and newlines, escaped quotes, and CRLF.
- **Share a link** — the list is compressed into the URL hash. Autosaves locally too.
- **Draw N winners at once**, without replacement.
- **Weights**, shown as height on the strip rather than only stated as a number.
  Bands reflow as you type, so you watch the odds change while you edit.
- **Elimination mode** — a winner's band collapses and the rest expand into the
  space, which is exactly what happens to the arithmetic.
- **History** with undo, and a restore for everything eliminated.
- Keyboard: <kbd>Space</kbd> draws.

## Is it actually random?

Yes, and you don't have to take that on faith.

The winner is chosen by `crypto.getRandomValues` **before the animation starts**.
`randomBelow` uses rejection sampling so there's no modulo bias, and weighted
selection walks a prefix sum over the remaining weights (`src/draw/rng.ts`).

Because the outcome is decided up front, the chamber is choreography — which
invites a fair question: was the result fixed, or fudged as it played? So the app
commits to it. At the moment you press Draw it publishes
`SHA-256(nonce | winner ids)` in the **Verify** panel, and reveals the nonce after
the winner appears. Recompute the digest and you've proven the result could not
have been changed while you were watching the particles.

The same panel lists every entry's exact percentage.

In the Column the point is visible as well as committed: the marker stops at the
position in the strip that the random number named, so a dart landing more often
in a tall band needs no explanation at all.

## Accessibility

- `prefers-reduced-motion: reduce` skips the animation entirely and states the
  winner immediately.
- The winner is real DOM text in an `aria-live` region — selectable, zoomable, and
  announced. Only the ghost type during the collapse lives on the canvas.
- Full keyboard operation, visible focus rings, real form controls.
- Sound is off by default and synthesized at runtime (no audio files).

## Development

```bash
npm install
npm run dev      # http://localhost:5173/potential-chainsaw/
npm run check    # tsc --noEmit && vitest run
npm run build    # -> dist/
npm run preview  # serve the built site under the Pages base path
```

No runtime dependencies. Vite and TypeScript are build-time only; the shipped site
is a single HTML file, one JS bundle and one stylesheet.

### Layout

```
src/
  draw/      rng.ts, commit.ts     randomness and the commit-reveal
  data/      parse.ts              paste parser + RFC 4180 CSV reader
  state/     store.ts, persist.ts  app state, localStorage, share links
  render/    visualizer.ts         the Visualizer contract, shared by both scenes
             column.ts             the strip and the dart (DOM, no canvas)
             chamber.ts            the particle simulation
             collapse.ts           the superposed-name reveal
             palette.ts            one stable hue per entry
             audio.ts              WebAudio synthesis
  ui/        panel.ts, results.ts  controls and the stage's text layer
tests/                             vitest, run headlessly in CI
```

The Column is DOM end to end. Bands are real elements with real text, so a screen
reader can read them and a browser can zoom them, and an idle strip schedules no
frames at all. Band height is one `flex: var(--share)` declaration. The dart is
located by weight for _which_ band and by geometry for _where inside it_, so it
lands correctly even where a sliver has been floored to a minimum height.

The Chamber keeps its state in parallel typed arrays, with particles allocated
contiguously per entry so a frame can set one fill colour and draw a whole entry's
population without touching canvas state again. Counts are apportioned by
largest remainder with a floor of one particle each, so a long shot never rounds
away to nothing.

### Known limitation

Past roughly 40 entries no band is tall enough for a label, and the strip becomes
a ramp of colour rather than a readable list. The distribution is still true and
the winning band grows enough to show its name, but if you routinely draw from
hundreds of entries, the Chamber or the panel's own list will serve you better.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Typecheck and tests gate the build, so a broken
commit never ships.

**One-time setup:** repo Settings → Pages → Source = **GitHub Actions**.

To host somewhere other than `/potential-chainsaw/`, set `BASE_PATH` at build time:

```bash
BASE_PATH=/ npm run build
```
