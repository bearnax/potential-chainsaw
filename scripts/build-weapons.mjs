/**
 * Turn the hand-kept spreadsheet into a bundled TypeScript module.
 *
 * The sheet is the source of truth for two things the app cannot derive on its
 * own: which weapons exist in which category, and how much I have already used
 * each one. Everything downstream — type weighting, lockouts, the progression —
 * is computed from those two columns at runtime, so this script deliberately
 * does no interpretation beyond normalising spellings.
 *
 *   node scripts/build-weapons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'weapons-source.csv');
const OUT = join(here, '..', 'src', 'eldenring', 'weapons.ts');

/** Minimal RFC4180 reader: quoted fields with embedded commas, nothing else. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Typos in the sheet that would otherwise split a category in two. */
const TYPE_FIXES = new Map([['Glinstone Staff', 'Glintstone Staff']]);

/**
 * The sheet's "Used" column, as a 0-5 familiarity score.
 */
const USED_SCORES = new Map([
  ['big time', 0],
  ['a good bit', 1],
  ['some', 2],
  ['a little bit', 3],
  ['not really, no', 5],
  ['', 5],
]);

async function loadCsv() {
  const url = process.env.WEAPONS_CSV_URL;
  if (url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`Fetched weapons data from ${url}`);
      return await res.text();
    } catch (err) {
      console.warn(`Failed to fetch WEAPONS_CSV_URL: ${err.message}. Falling back to local.`);
    }
  }
  return readFileSync(SOURCE, 'utf8');
}

const csvText = await loadCsv();
const rows = parseCsv(csvText);
const header = rows.shift().map((h) => h.trim());
const col = (name) => header.indexOf(name);
const iName = col('Name');
const iWeight = col('Weight');
const iType = col('Weapon Type');
const iDlc = col('DLC?');
const iUsed = col('Used');
const iZone = col('earliest_zone');

const weapons = [];
const unknownUsed = new Set();

for (const row of rows) {
  const name = (row[iName] ?? '').trim();
  if (!name) continue;

  const type = (row[iType] ?? '').trim();
  const usedText = (row[iUsed] ?? '').trim().toLowerCase();

  let familiarity = USED_SCORES.get(usedText);
  if (familiarity === undefined) {
    unknownUsed.add(usedText);
    familiarity = 5;
  }

  // The numeric column wins when it is present and sane; it is the value I
  // actually tuned by hand.
  const raw = Number((row[iWeight] ?? '').trim());
  const weight = Number.isFinite(raw) && raw >= 0 && raw <= 5 ? raw : familiarity;

  const zoneRaw = iZone !== -1 ? Number((row[iZone] ?? '').trim()) : 1;
  const zone = Number.isFinite(zoneRaw) && zoneRaw >= 1 && zoneRaw <= 9 ? zoneRaw : 1;

  weapons.push({
    name,
    type: TYPE_FIXES.get(type) ?? type,
    dlc: (row[iDlc] ?? '').includes('✅'),
    familiarity: weight,
    earliest_zone: zone,
  });
}

weapons.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

const types = [...new Set(weapons.map((w) => w.type))].sort();

/** Single-quoted TS string literal, escaped for the apostrophes in the names. */
const str = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const weaponLines = weapons
  .map(
    (w) =>
      `  { name: ${str(w.name)}, type: ${str(w.type)}, dlc: ${w.dlc}, familiarity: ${w.familiarity}, earliest_zone: ${w.earliest_zone} },`,
  )
  .join('\n');

const typeLines = types.map((t) => `  ${str(t)},`).join('\n');

const body = `/**
 * The armoury, generated from the spreadsheet by \`scripts/build-weapons.mjs\`.
 *
 * Do not edit by hand: edit \`scripts/weapons-source.csv\` and re-run the script.
 *
 * \`familiarity\` is 0-5 where 0 means "used big time" and 5 means "never really
 * touched it". It is the only opinion in this file; every weighting decision is
 * made from it at runtime.
 */

export interface Weapon {
  readonly name: string;
  readonly type: string;
  readonly dlc: boolean;
  readonly familiarity: number;
  readonly earliest_zone: number;
}

export const WEAPONS: readonly Weapon[] = [
${weaponLines}
];

/** Every distinct weapon type in the sheet, alphabetically. */
export const WEAPON_TYPES: readonly string[] = [
${typeLines}
];
`;

writeFileSync(OUT, body);

console.log(`wrote ${weapons.length} weapons across ${types.length} types -> ${OUT}`);
if (unknownUsed.size > 0) {
  console.log(`unrecognised "Used" values (defaulted to unused): ${[...unknownUsed].join(', ')}`);
}
