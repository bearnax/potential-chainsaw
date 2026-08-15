/**
 * The shield rack, generated from the spreadsheet by `scripts/build-shields.mjs`.
 *
 * Do not edit by hand: edit `scripts/shields-source.csv` and re-run the script.
 *
 * `familiarity` is 0-5 where 0 means "used big time" and 5 means "never really
 * touched it". Every shield here shipped at 3/5 as a neutral starting point —
 * edit the sheet with real values and rebuild to make the weighting and
 * lockout mean something.
 */

export interface Shield {
  readonly name: string;
  readonly type: string;
  readonly dlc: boolean;
  readonly familiarity: number;
}

export const SHIELDS: readonly Shield[] = [
  { name: 'Blue Elephant Shield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Dragon Towershield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Dragonclaw Shield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Erdtree Greatshield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Fingerprint Negation Shield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Golden Greatshield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Haligtree Crest Greatshield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Icon Shield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Jellyfish Shield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Manor Towershield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'One-Eyed Shield', type: 'Greatshield', dlc: false, familiarity: 3 },
  { name: 'Verdigris Greatshield', type: 'Greatshield', dlc: true, familiarity: 3 },
  { name: 'Blue Crest Heater Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Brass Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: "Carian Knight's Shield", type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Dragon Crest Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Dueling Shield', type: 'Medium Shield', dlc: true, familiarity: 3 },
  { name: 'Fingerprint Stone Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Golden Beast Crest Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Golden Lion Shield', type: 'Medium Shield', dlc: true, familiarity: 3 },
  { name: 'Great Turtle Shell', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Kite Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Messmer Soldier Shield', type: 'Medium Shield', dlc: true, familiarity: 3 },
  { name: 'Red Thorn Roundshield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Round Shield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Silver Mirrorshield', type: 'Medium Shield', dlc: false, familiarity: 3 },
  { name: 'Blue-White Wooden Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Buckler', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Coil Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Gilded Iron Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Ice Crest Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Iron Roundshield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Leather Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: "Man-Serpent's Shield", type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Rickety Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Rift Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Riveted Wooden Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
  { name: 'Shield of Night', type: 'Small Shield', dlc: true, familiarity: 3 },
  { name: 'Twinbird Kite Shield', type: 'Small Shield', dlc: false, familiarity: 3 },
];

/** Every distinct shield type in the sheet, alphabetically. */
export const SHIELD_TYPES: readonly string[] = ['Greatshield', 'Medium Shield', 'Small Shield'];
