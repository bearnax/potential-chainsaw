/**
 * The build protocol.
 *
 * Everything a run of the sequencer needs, expressed as pure functions over the
 * generated armoury. The rule the whole module is organised around: the only
 * opinion in the dataset is `familiarity` (0 = used big time, 5 = never really
 * touched it), and every weight, lockout and tier is derived from it here
 * rather than hard-coded anywhere.
 *
 * That means the sheet stays the single place to edit. Re-run
 * `scripts/build-weapons.mjs` after changing it and the odds move on their own.
 */

import { SHIELDS } from './shields.ts';
import { WEAPONS, type Weapon } from './weapons.ts';

/* ------------------------------------------------------------------ */
/* Classifying the armoury                                             */
/* ------------------------------------------------------------------ */

/**
 * What slot a type actually occupies in a build.
 *
 * `melee` is the main-hand pick, `ranged` is the second stage's pool, and
 * `catalyst` and `utility` exist mostly so they can be excluded by name rather
 * than by a magic list of strings in the UI.
 */
export type WeaponKind = 'melee' | 'ranged' | 'catalyst' | 'utility';

const RANGED_TYPES = new Set(['Bow', 'Light Bow', 'Greatbow', 'Crossbow', 'Ballista']);
const CATALYST_TYPES = new Set(['Glintstone Staff', 'Sacred Seal']);
const UTILITY_TYPES = new Set(['Torch']);

export function kindOf(type: string): WeaponKind {
  if (RANGED_TYPES.has(type)) return 'ranged';
  if (CATALYST_TYPES.has(type)) return 'catalyst';
  if (UTILITY_TYPES.has(type)) return 'utility';
  return 'melee';
}

/** Kinds kept out of the main-hand stage unless the user says otherwise. */
export const DEFAULT_EXCLUDED_KINDS: readonly WeaponKind[] = ['ranged', 'catalyst', 'utility'];

export interface ProtocolConfig {
  /** Kinds barred from the main-hand stage. */
  excludedKinds: readonly WeaponKind[];
  /** Individual types barred by name, whatever their kind. */
  excludedTypes: readonly string[];
  /** Include Shadow of the Erdtree weapons. */
  dlc: boolean;
  /** How many main-hand types to draw. */
  meleeCount: number;
  /**
   * How hard to lean toward the unfamiliar, as an exponent on the mean
   * familiarity. 1 is proportional; 2 roughly squares the gap between a type
   * I have never touched and one I have worn out.
   */
  freshnessBias: number;
}

export const defaultConfig = (): ProtocolConfig => ({
  excludedKinds: [...DEFAULT_EXCLUDED_KINDS],
  excludedTypes: [],
  dlc: true,
  meleeCount: 3,
  freshnessBias: 1.6,
});

/** Weapons of a type that the current config actually allows on screen. */
export function membersOf(type: string, config: ProtocolConfig): Weapon[] {
  return WEAPONS.filter((w) => w.type === type && (config.dlc || !w.dlc));
}

/**
 * A drawable option, in the shape the Column already understands.
 *
 * `detail` is the one-line justification shown next to the band — the reason
 * this option is as likely as it is, so the odds never look arbitrary.
 */
export interface Option {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly detail: string;
}

/** Mean familiarity across a type's allowed members, 0-5. */
export function freshnessOf(type: string, config: ProtocolConfig): number {
  const members = membersOf(type, config);
  if (members.length === 0) return 0;
  return members.reduce((sum, w) => sum + w.familiarity, 0) / members.length;
}

/**
 * Turn mean familiarity into a draw weight.
 *
 * The floor matters: a type I have used to death should be a long shot, not an
 * impossibility. Excluding it is a decision for the config, not for the curve.
 */
function weightFrom(freshness: number, bias: number): number {
  const normalized = Math.max(0, Math.min(1, freshness / 5));
  return 0.08 + Math.pow(normalized, bias) * 4.92;
}

/** `noun` is already pluralised/counted by the caller, e.g. "3 weapons". */
function freshnessLabel(freshness: number, noun: string): string {
  if (freshness >= 4.5) return `${noun} · untouched`;
  if (freshness >= 3.5) return `${noun} · barely used`;
  if (freshness >= 2.5) return `${noun} · dabbled`;
  if (freshness >= 1.5) return `${noun} · well used`;
  return `${noun} · worn out`;
}

function describeFreshness(freshness: number, members: number): string {
  return freshnessLabel(freshness, `${members} weapon${members === 1 ? '' : 's'}`);
}

function typeOptions(types: readonly string[], config: ProtocolConfig): Option[] {
  return (
    types
      // Turning the DLC off empties a few types completely; an option you cannot
      // build has no business taking up a band.
      .filter((type) => membersOf(type, config).length > 0)
      .map((type) => {
        const members = membersOf(type, config);
        const freshness = freshnessOf(type, config);
        return {
          id: `type:${type}`,
          label: type,
          weight: weightFrom(freshness, config.freshnessBias),
          detail: describeFreshness(freshness, members.length),
        };
      })
  );
}

/** Every type eligible for the main-hand stage under this config. */
export function meleeOptions(config: ProtocolConfig): Option[] {
  const excludedKinds = new Set(config.excludedKinds);
  const excludedTypes = new Set(config.excludedTypes);

  const types = [...new Set(WEAPONS.map((w) => w.type))]
    .filter((type) => !excludedKinds.has(kindOf(type)) && !excludedTypes.has(type))
    .sort();

  return typeOptions(types, config);
}

/**
 * The ranged stage, which ignores the main-hand exclusions on purpose: barring
 * bows from the main hand is what *creates* this stage, so honouring the same
 * list here would leave it empty.
 */
export function rangedOptions(config: ProtocolConfig): Option[] {
  const excludedTypes = new Set(config.excludedTypes);
  const types = [...RANGED_TYPES].filter((type) => !excludedTypes.has(type)).sort();
  return typeOptions(types, config);
}

/* ------------------------------------------------------------------ */
/* Magic and status                                                    */
/* ------------------------------------------------------------------ */

/**
 * The magic stage weights itself from the catalyst rows in the sheet, which is
 * the closest thing to usage data I have for a school of magic: staves worn to
 * a nub mean I have played the sorcerer, and the option should know that.
 */
export function magicOptions(config: ProtocolConfig): Option[] {
  const int = freshnessOf('Glintstone Staff', config);
  const faith = freshnessOf('Sacred Seal', config);
  const bias = config.freshnessBias;

  return [
    {
      id: 'magic:int',
      label: 'Intelligence — sorceries',
      weight: weightFrom(int, bias),
      detail: `staves ${int.toFixed(1)}/5 unused`,
    },
    {
      id: 'magic:faith',
      label: 'Faith — incantations',
      weight: weightFrom(faith, bias),
      detail: `seals ${faith.toFixed(1)}/5 unused`,
    },
    {
      id: 'magic:both',
      label: 'Both — staff and seal',
      weight: weightFrom((int + faith) / 2, bias) * 0.75,
      detail: 'split stats, two catalysts, thin damage until late',
    },
    {
      // Arcane has no dedicated catalyst type in the sheet the way sorceries and
      // incantations do, so — same call as `statusOptions` — an honest flat
      // weight beats a derived one with nothing behind it.
      id: 'magic:arc',
      label: 'Arcane — arcane-scaling',
      weight: 1.4,
      detail: 'no catalyst familiarity data — flat odds',
    },
    {
      id: 'magic:int_arc',
      label: 'Intelligence + Arcane — hybrid',
      weight: weightFrom(int, bias) * 0.75,
      detail: `staves ${int.toFixed(1)}/5 unused · arcane flat`,
    },
    {
      id: 'magic:faith_arc',
      label: 'Faith + Arcane — hybrid',
      weight: weightFrom(faith, bias) * 0.75,
      detail: `seals ${faith.toFixed(1)}/5 unused · arcane flat`,
    },
    {
      id: 'magic:none',
      label: 'Neither — no catalyst',
      weight: 1.2,
      detail: 'pure physical, stats all in the weapon',
    },
  ];
}

/**
 * Status effects have no usage column in the sheet, so these are flat by
 * design. Better an honest uniform draw than invented weights that look
 * derived.
 */
export function statusOptions(): Option[] {
  const flat = (label: string, detail: string, id: string): Option => ({
    id: `status:${id}`,
    label,
    weight: 1,
    detail,
  });

  return [
    flat('Blood loss', 'fast procs, rewards fast weapons', 'bleed'),
    flat('Scarlet Rot', 'slow burn, ignores most healing', 'rot'),
    flat('Poison', 'cheap to apply, patient damage', 'poison'),
    flat('Frostbite', 'damage taken up, stamina regen down', 'frost'),
    flat('Sleep', 'a full opening, DLC-leaning', 'sleep'),
    flat('Madness', 'hits you too, only works on the living', 'madness'),
    flat('None', 'raw damage, no affinity spent on procs', 'none'),
  ];
}

/**
 * The shield stage draws individual shields directly rather than a type first
 * — three per run is a hand, not a class — so each shield is its own option,
 * weighted the same way a weapon type is, and a shield used "big time" is
 * dropped from the pool entirely rather than merely disfavoured. That is what
 * "locked out" means here: it cannot be drawn this run, full stop.
 */
export function shieldOptions(config: ProtocolConfig): Option[] {
  return SHIELDS.filter(
    (s) => (config.dlc || !s.dlc) && standingFor(s.familiarity) !== 'locked',
  ).map((s) => ({
    id: `shield:${s.name}`,
    label: s.name,
    weight: weightFrom(s.familiarity, config.freshnessBias),
    detail: freshnessLabel(s.familiarity, s.type),
  }));
}

/* ------------------------------------------------------------------ */
/* The progression                                                     */
/* ------------------------------------------------------------------ */

export type Standing = 'open' | 'restricted' | 'locked';

export interface Ruling {
  readonly weapon: Weapon;
  readonly standing: Standing;
  readonly reason: string;
}

/**
 * The two thresholds are the whole lockout system: anything used "big time"
 * is off the table, and anything used "a good bit" is allowed only as
 * something to pick up on the way, never as the build. Shared by weapons and
 * shields alike so a lockout means the same thing everywhere in the app.
 */
export function standingFor(familiarity: number): Standing {
  if (familiarity <= 0) return 'locked';
  if (familiarity <= 1) return 'restricted';
  return 'open';
}

/** Where a single weapon stands in a fresh run. */
export function rulingFor(weapon: Weapon): Ruling {
  const standing = standingFor(weapon.familiarity);
  const reason =
    standing === 'locked'
      ? 'used big time — locked out'
      : standing === 'restricted'
        ? 'used a good bit — early only'
        : weapon.familiarity >= 5
          ? 'never really touched'
          : 'barely used';
  return { weapon, standing, reason };
}

interface Act {
  readonly name: string;
  readonly window: string;
  /** What the run is allowed to hold during this act. */
  readonly allowed: readonly Weapon[];
  readonly rule: string;
}

export interface Progression {
  readonly type: string;
  readonly acts: readonly Act[];
  readonly rulings: readonly Ruling[];
  /** Nothing left to build toward once the lockouts are applied. */
  readonly exhausted: boolean;
}

/**
 * Freshest first, name as the tiebreak so a given type always produces the
 * same ladder. The randomness in this app belongs to the type draw; making the
 * progression roll again would just be a second chance to get a worse answer.
 */
function ladder(members: readonly Weapon[]): Weapon[] {
  return [...members].sort((a, b) => b.familiarity - a.familiarity || a.name.localeCompare(b.name));
}

/**
 * Turn a drawn type into a three-act contract for a fresh playthrough.
 *
 * Acts are gated on both map progress (zone availability) and commitment:
 * take what drops early (Zone <= 3), narrow to a midgame shortlist (Zone <= 5),
 * and finish the run on the freshest weapon regardless of zone.
 */
export function progressionFor(type: string, config: ProtocolConfig): Progression {
  const members = membersOf(type, config);
  const rulings = ladder(members).map(rulingFor);

  const open = rulings.filter((r) => r.standing === 'open').map((r) => r.weapon);
  const restricted = rulings.filter((r) => r.standing === 'restricted').map((r) => r.weapon);

  const act1Pool = [...open, ...restricted].filter((w) => w.earliest_zone <= 3);
  
  let shortlist = open.filter((w) => w.earliest_zone <= 5).slice(0, 3);
  if (shortlist.length === 0) {
    shortlist = open.slice(0, Math.min(3, open.length));
  }

  const finale = open.slice(0, 1);

  const acts: Act[] = [
    {
      name: 'Act I',
      window: 'Limgrave to Stormveil',
      allowed: act1Pool.length > 0 ? act1Pool : [...open, ...restricted].slice(0, 2),
      rule: 'anything in the class available early, including well-used ones. Nothing committed yet.',
    },
    {
      name: 'Act II',
      window: 'Liurnia to the Capital',
      allowed: shortlist,
      rule: 'drop the well-used weapons entirely and carry one of the midgame shortlist. This is the build now.',
    },
    {
      name: 'Act III',
      window: 'Mountaintops, endgame and the DLC',
      allowed: finale,
      rule: 'finish the run on this one. No swapping back.',
    },
  ];

  return { type, acts, rulings, exhausted: open.length === 0 };
}
