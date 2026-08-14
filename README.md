# Tarnished

An Elden Ring run generator, built on a randomizer that makes probability visible.

Press **Run protocol** and four questions get answered in sequence, all in the
same strip: three weapon classes for the main hand, one ranged sidearm, a school
of magic, a status effect. Every option is a band as tall as its odds, and the
odds lean toward the classes I have never used. When the last stage lands, the
run assembles a **dossier**: for each weapon class drawn, a three-act contract
and the list of weapons it is not allowed to touch.

**Live:** https://bearnax.github.io/potential-chainsaw/

## The protocol

Four stages, drawn in order down one strip.

| Stage             | What it decides                                    | Where the weights come from          |
| ----------------- | -------------------------------------------------- | ------------------------------------ |
| Main armament     | N weapon classes (3 by default)                    | mean familiarity across the class    |
| Ranged sidearm    | one bow, crossbow, greatbow or ballista            | same, over the ranged classes        |
| Arcane discipline | intelligence, faith, both, or neither              | the staff and seal rows of the sheet |
| Status vector     | bleed, rot, poison, frost, sleep, madness, or none | flat — see below                     |

Bows, staves, seals and torches are barred from the main hand by default, which
is what creates the sidearm stage. Every one of those exclusions is a checkbox,
and individual classes can be barred by name.

### Where the odds come from

`scripts/weapons-source.csv` is the spreadsheet: 402 weapons, each with a class,
a DLC flag, and how much I have used it. That last column is the **only** opinion
in the data. `npm run data` compiles it to `src/eldenring/weapons.ts` as a 0–5
`familiarity` score, and everything downstream is derived from it at runtime:

- A class's weight is its members' mean familiarity, raised to the
  **lean toward the unused** exponent. At 0 every class is equally likely; the
  default of 1.6 makes a class I have never touched roughly ten times likelier
  than one I have worn out.
- No class ever drops to zero. A weight floor keeps a worn-out class a long shot
  rather than an impossibility — making it impossible is what the exclusions are
  for.
- Magic weights itself from the catalyst rows, which is the closest thing to
  usage data a school of magic has in this sheet.
- **Status effects are flat on purpose.** The sheet has no usage column for them,
  and invented weights that look derived would be worse than an honest uniform
  draw.

Edit the CSV, run `npm run data`, and the odds move on their own.

### The lockouts

A weapon class means little on its own when a third of it is something already
worn out, so every class drawn prints its own progression:

- **Used big time** → **locked out.** Not available in any act.
- **Used a good bit** → **early only.** Allowed in Act I, dropped after.
- Everything else is open, freshest first.

The acts gate commitment rather than map progress — there is no acquisition-location
data in the sheet and none is invented:

- **Act I** (Limgrave to Stormveil) — anything in the class that drops, well-used
  ones included. Nothing is committed yet.
- **Act II** (Liurnia to the Capital) — drop the well-used weapons and carry one
  of a three-weapon shortlist. This is the build now.
- **Act III** (Mountaintops, endgame, DLC) — finish on one weapon, the freshest in
  the class. No swapping back.

The progression is deterministic for a given class: the randomness belongs to the
class draw, and rolling again for the ladder would just be a second chance at a
worse answer. A class with nothing left to build toward says so rather than
quietly serving up a repeat.

## List mode

The general-purpose randomizer this was built from is still here, one toggle
away. Paste a list, drop a CSV, or open a shared link. Every entry becomes a band
as tall as its share of the weight, and together they fill one continuous strip —
so the list _is_ the distribution. Hit **Draw** and a single dart runs the strip
and sticks where it lands.

That dart is not a mime of the algorithm; it is the algorithm. Weighted selection
works by laying every entry's weight end to end and picking one point in the
total, and `pickWeightedPoints` hands the scene the exact point it picked. The
marker's resting position is that number.

### Two scenes

- **The Column** (default, and the only one the protocol uses) — the quiet one.
- **Entropy Chamber** — the loud one, kept for when a draw is an occasion rather
  than a chore: particles standing in for entries, spun up and imploded to a
  singularity that blooms back out as the winner.

## How it feels

The pacing is deliberate and the numbers are roughly three times what they
started as. A stage lays out its pool, a light runs down the whole field once so
you can read it, then the dart takes four seconds to decide. The draw itself was
instant and always was — the strip exists so you can watch the machine work, and
a readout that resolves before you have finished reading it is just a slot
machine with better manners.

The dressing is the ship displays from the Alien films: one phosphor green rather
than a spectrum, monospace set wide, a scanline over the stage, and a cursor that
blinks while a stage is unresolved and stops when it is. It only applies in
protocol mode; list mode keeps its cool grey instrument look.

Claimed bands stay on the strip. In a list draw a winner collapses to nothing,
because its weight has genuinely left the total — but a stage drawing three
classes in a row would lose the first two before you had read them, so in the
protocol a claimed band keeps a row's worth of height and marks itself taken.

## What it does

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
npm run data     # recompile the spreadsheet into src/eldenring/weapons.ts
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
  eldenring/ weapons.ts            the armoury, generated from the spreadsheet
             loadout.ts            classification, weighting, rulings, progression
             protocol.ts           the four stages and how a run assembles
             run.ts                the sequencer that paces a run
  ui/        panel.ts, results.ts  controls and the stage's text layer
             protocol-panel.ts     protocol config, built from the armoury
             dossier.ts            the finished run sheet
scripts/     build-weapons.mjs     CSV -> weapons.ts
             weapons-source.csv    the spreadsheet, the source of truth
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

### Known limitations

The commit-reveal proof described above covers a list draw only. A protocol run
is four separate draws and would need four commitments, so the Verify panel is
hidden in protocol mode rather than shown with nothing behind it.

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
