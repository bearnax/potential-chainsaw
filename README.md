# Entropy Chamber

A weighted randomizer that makes probability visible.

Paste a list, drop a CSV, or open a shared link. Every entry gets a share of the
chamber's particles proportional to its weight, in its own colour — so the mix on
screen _is_ the odds. Hit **Draw** and the field spins up, implodes to a
singularity, and blooms back out as the winner.

**Live:** https://bearnax.github.io/potential-chainsaw/

## What it does

- **Paste or type** — one entry per line. `Ada, 3` is three times as likely as `Ada`.
- **CSV / TSV** — drag and drop anywhere, with column pickers and header detection.
  Handles quoted fields, embedded commas and newlines, escaped quotes, and CRLF.
- **Share a link** — the list is compressed into the URL hash. Autosaves locally too.
- **Draw N winners at once**, without replacement.
- **Weights**, shown as colour share rather than stated as a number.
- **Elimination mode** — winners drain out of the chamber and you watch the
  remaining odds redistribute.
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
  render/    chamber.ts            the particle simulation
             collapse.ts           the superposed-name reveal
             palette.ts            one stable hue per entry
             audio.ts              WebAudio synthesis
  ui/        panel.ts, results.ts  controls and the stage's text layer
tests/                             vitest, run headlessly in CI
```

The simulation keeps its state in parallel typed arrays, with particles allocated
contiguously per entry so a frame can set one fill colour and draw a whole entry's
population without touching canvas state again. Counts are apportioned by
largest remainder with a floor of one particle each, so a long shot never rounds
away to nothing.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Typecheck and tests gate the build, so a broken
commit never ships.

**One-time setup:** repo Settings → Pages → Source = **GitHub Actions**.

To host somewhere other than `/potential-chainsaw/`, set `BASE_PATH` at build time:

```bash
BASE_PATH=/ npm run build
```
