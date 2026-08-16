import { describe, expect, it } from 'vitest';

import {
  defaultConfig,
  freshnessOf,
  kindOf,
  magicOptions,
  meleeOptions,
  membersOf,
  progressionFor,
  rangedOptions,
  rulingFor,
  shieldOptions,
  standingFor,
  statusOptions,
  type ProtocolConfig,
} from '../src/eldenring/loadout.ts';
import { assemble, stagesFor, summarize } from '../src/eldenring/protocol.ts';
import { SHIELDS } from '../src/eldenring/shields.ts';
import { WEAPONS, WEAPON_TYPES } from '../src/eldenring/weapons.ts';

const config = (patch: Partial<ProtocolConfig> = {}): ProtocolConfig => ({
  ...defaultConfig(),
  ...patch,
});

describe('the armoury', () => {
  it('carries every row of the sheet', () => {
    expect(WEAPONS.length).toBe(402);
    expect(WEAPON_TYPES.length).toBe(40);
  });

  it('normalises the misspelled staff category away', () => {
    expect(WEAPON_TYPES).not.toContain('Glinstone Staff');
    // The two rows filed under the typo have to have landed somewhere.
    expect(membersOf('Glintstone Staff', config()).map((w) => w.name)).toContain('Maternal Staff');
  });

  it('scores familiarity from the sheet, not from the row order', () => {
    const rivers = WEAPONS.find((w) => w.name === 'Rivers of Blood');
    const backhand = WEAPONS.find((w) => w.name === 'Backhand Blade');
    expect(rivers?.familiarity).toBe(0);
    expect(backhand?.familiarity).toBe(5);
    expect(backhand?.dlc).toBe(true);
  });
});

describe('classification', () => {
  it('files the exclusions the config names by default', () => {
    expect(kindOf('Bow')).toBe('ranged');
    expect(kindOf('Ballista')).toBe('ranged');
    expect(kindOf('Glintstone Staff')).toBe('catalyst');
    expect(kindOf('Sacred Seal')).toBe('catalyst');
    expect(kindOf('Torch')).toBe('utility');
    expect(kindOf('Katana')).toBe('melee');
  });

  it('keeps bows, staves and torches out of the main hand', () => {
    const labels = meleeOptions(config()).map((o) => o.label);
    for (const barred of ['Bow', 'Greatbow', 'Crossbow', 'Ballista', 'Torch', 'Sacred Seal']) {
      expect(labels).not.toContain(barred);
    }
    expect(labels).toContain('Colossal Weapon');
  });

  it('lets the exclusions be reconfigured', () => {
    const labels = meleeOptions(config({ excludedKinds: [] })).map((o) => o.label);
    expect(labels).toContain('Torch');
    expect(labels).toContain('Bow');
  });

  it('bars individual classes by name', () => {
    const labels = meleeOptions(config({ excludedTypes: ['Katana'] })).map((o) => o.label);
    expect(labels).not.toContain('Katana');
    expect(labels).toContain('Great Katana');
  });

  it('offers the ranged classes regardless of the main-hand exclusions', () => {
    // Otherwise the default config — which bars bows from the main hand — would
    // leave the sidearm stage with nothing in it.
    const labels = rangedOptions(config()).map((o) => o.label);
    expect(labels).toEqual(['Ballista', 'Bow', 'Crossbow', 'Greatbow', 'Light Bow']);
  });
});

describe('weighting', () => {
  it('leans toward the classes I have not used', () => {
    const options = meleeOptions(config());
    const byLabel = new Map(options.map((o) => [o.label, o]));

    // Fist is untouched top to bottom; Twinblade is almost entirely worn out.
    const fist = byLabel.get('Fist')!;
    const twinblade = byLabel.get('Twinblade')!;
    expect(freshnessOf('Fist', config())).toBeGreaterThan(freshnessOf('Twinblade', config()));
    expect(fist.weight).toBeGreaterThan(twinblade.weight * 3);
  });

  it('never drops a class to an impossible weight', () => {
    for (const option of meleeOptions(config({ freshnessBias: 3 }))) {
      expect(option.weight).toBeGreaterThan(0);
    }
  });

  it('flattens toward equal weights as the bias goes to zero', () => {
    const flat = meleeOptions(config({ freshnessBias: 0 }));
    const weights = new Set(flat.map((o) => o.weight));
    expect(weights.size).toBe(1);
  });

  it('drops classes the DLC switch empties', () => {
    const withDlc = meleeOptions(config({ dlc: true })).map((o) => o.label);
    const without = meleeOptions(config({ dlc: false })).map((o) => o.label);
    expect(withDlc).toContain('Backhand Blade');
    expect(without).not.toContain('Backhand Blade');
    expect(without).toContain('Katana');
  });

  it('derives the magic weights from the catalyst rows', () => {
    const options = magicOptions(config());
    expect(options.map((o) => o.id)).toEqual([
      'magic:int',
      'magic:faith',
      'magic:both',
      'magic:arc',
      'magic:int_arc',
      'magic:faith_arc',
      'magic:none',
    ]);
    for (const option of options) expect(option.weight).toBeGreaterThan(0);
  });

  it('keeps the status draw flat, since the sheet has no usage for it', () => {
    const weights = new Set(statusOptions().map((o) => o.weight));
    expect(weights).toEqual(new Set([1]));
  });
});

describe('shields', () => {
  it('excludes locked shields from the pool entirely rather than merely disfavouring them', () => {
    const locked = SHIELDS.filter((s) => standingFor(s.familiarity) === 'locked');
    if (locked.length === 0) return; // sheet ships all at 3/5 until hand-tuned
    const ids = new Set(shieldOptions(config()).map((o) => o.id));
    for (const shield of locked) expect(ids.has(`shield:${shield.name}`)).toBe(false);
  });

  it('drops DLC shields when the switch is off', () => {
    const withDlc = shieldOptions(config({ dlc: true })).map((o) => o.label);
    const without = shieldOptions(config({ dlc: false })).map((o) => o.label);
    expect(withDlc).toContain('Shield of Night');
    expect(without).not.toContain('Shield of Night');
  });
});

describe('rulings', () => {
  it('locks out what has been used big time', () => {
    const rivers = WEAPONS.find((w) => w.name === 'Rivers of Blood')!;
    expect(rulingFor(rivers).standing).toBe('locked');
  });

  it('restricts what has been used a good bit', () => {
    const moonveil = WEAPONS.find((w) => w.name === 'Moonveil')!;
    expect(rulingFor(moonveil).standing).toBe('restricted');
  });

  it('opens everything else', () => {
    const dragonscale = WEAPONS.find((w) => w.name === 'Dragonscale Blade')!;
    expect(rulingFor(dragonscale).standing).toBe('open');
  });
});

describe('progression', () => {
  it('narrows across the three acts', () => {
    const prog = progressionFor('Katana', config());
    const [one, two, three] = prog.acts;

    expect(prog.acts).toHaveLength(3);
    expect(one!.allowed.length).toBeGreaterThan(two!.allowed.length);
    expect(two!.allowed.length).toBeGreaterThanOrEqual(three!.allowed.length);
    expect(three!.allowed).toHaveLength(1);
  });

  it('filters acts by earliest_zone gating', () => {
    const prog = progressionFor('Katana', config());
    const [one, two] = prog.acts;

    for (const weapon of one!.allowed) {
      expect(weapon.earliest_zone).toBeLessThanOrEqual(3);
    }
    for (const weapon of two!.allowed) {
      expect(weapon.earliest_zone).toBeLessThanOrEqual(5);
    }
  });

  it('never lets a locked weapon into any act', () => {
    for (const type of ['Katana', 'Twinblade', 'Greatsword', 'Hammer']) {
      const prog = progressionFor(type, config());
      const locked = new Set(
        prog.rulings.filter((r) => r.standing === 'locked').map((r) => r.weapon.name),
      );
      for (const act of prog.acts) {
        for (const weapon of act.allowed) expect(locked.has(weapon.name)).toBe(false);
      }
    }
  });

  it('allows the well-used ones early and drops them after', () => {
    const prog = progressionFor('Katana', config());
    const restricted = prog.rulings
      .filter((r) => r.standing === 'restricted')
      .map((r) => r.weapon.name);
    expect(restricted).toContain('Moonveil');

    const act1 = prog.acts[0]!.allowed.map((w) => w.name);
    const act2 = prog.acts[1]!.allowed.map((w) => w.name);
    expect(act1).toContain('Moonveil');
    expect(act2).not.toContain('Moonveil');
  });

  it('finishes on the freshest weapon in the class', () => {
    const prog = progressionFor('Katana', config());
    const finale = prog.acts[2]!.allowed[0]!;
    const best = Math.max(
      ...membersOf('Katana', config())
        .filter((w) => w.familiarity >= 2)
        .map((w) => w.familiarity),
    );
    expect(finale.familiarity).toBe(best);
  });

  it('is stable for a given class, so the dossier does not reshuffle', () => {
    const a = progressionFor('Halberd', config());
    const b = progressionFor('Halberd', config());
    expect(a.acts[2]!.allowed[0]!.name).toBe(b.acts[2]!.allowed[0]!.name);
  });

  it('flags a class with nothing left to build toward', () => {
    // Twinblade is nine weapons and eight of them are used big time; turning the
    // DLC off leaves only those.
    const prog = progressionFor('Twinblade', config({ dlc: false }));
    expect(prog.exhausted).toBe(true);
    expect(prog.acts[2]!.allowed).toHaveLength(0);
  });
});

describe('the sequence', () => {
  it('asks the five questions in order', () => {
    expect(stagesFor(config()).map((s) => s.id)).toEqual([
      'melee',
      'ranged',
      'shields',
      'magic',
      'status',
    ]);
  });

  it('draws the requested number of weapon classes', () => {
    expect(stagesFor(config({ meleeCount: 3 }))[0]!.count).toBe(3);
  });

  it('never asks for more classes than exist', () => {
    const narrow = config({
      meleeCount: 12,
      excludedTypes: WEAPON_TYPES.filter((t) => t !== 'Katana' && t !== 'Whip'),
    });
    expect(stagesFor(narrow)[0]!.count).toBe(2);
  });

  it('drops a stage with nothing in it rather than hanging on it', () => {
    const noRanged = config({ excludedTypes: [...WEAPON_TYPES] });
    expect(stagesFor(noRanged).map((s) => s.id)).toEqual(['shields', 'magic', 'status']);
  });

  it('always draws exactly three shields', () => {
    const shields = stagesFor(config()).find((s) => s.id === 'shields')!;
    expect(shields.count).toBe(3);
  });

  it('builds a progression for every weapon class it drew, bow included', () => {
    const stages = stagesFor(config());
    const melee = stages[0]!;
    const ranged = stages[1]!;

    const loadout = assemble(
      [
        { stage: melee, winners: [melee.options[0]!, melee.options[1]!] },
        { stage: ranged, winners: [ranged.options[0]!] },
      ],
      config(),
    );

    expect(loadout.progressions.map((p) => p.type)).toEqual([
      melee.options[0]!.label,
      melee.options[1]!.label,
      ranged.options[0]!.label,
    ]);
    expect(summarize(loadout)).toContain('Main armament');
  });
});
