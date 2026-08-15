/**
 * Turn the hand-kept shield spreadsheet into a bundled TypeScript module.
 *
 * Mirrors `build-weapons.mjs` exactly: the sheet is the single place to edit
 * a shield's familiarity, and every weight and lockout downstream is derived
 * from it at runtime.
 *
 *   node scripts/build-shields.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'shields-source.csv');
const OUT = join(here, '..', 'src', 'eldenring', 'shields.ts');

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

/** The sheet's "Used" column, as a 0-5 familiarity score. Same map as weapons. */
const USED_SCORES = new Map([
  ['big time', 0],
  ['a good bit', 1],
  ['some', 2],
  ['a little bit', 3],
  ['not really, no', 5],
  ['', 5],
]);

const rows = parseCsv(readFileSync(SOURCE, 'utf8'));
const header = rows.shift().map((h) => h.trim());
const col = (name) => header.indexOf(name);
const iName = col('Name');
const iWeight = col('Weight');
const iType = col('Shield Type');
const iDlc = col('DLC?');
const iUsed = col('Used');

const shields = [];
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

  shields.push({
    name,
    type,
    dlc: (row[iDlc] ?? '').includes('✅'),
    familiarity: weight,
  });
}

shields.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

const types = [...new Set(shields.map((s) => s.type))].sort();

/** Single-quoted TS string literal, escaped for the apostrophes in the names. */
const str = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const shieldLines = shields
  .map(
    (s) =>
      `  { name: ${str(s.name)}, type: ${str(s.type)}, dlc: ${s.dlc}, familiarity: ${s.familiarity} },`,
  )
  .join('\n');

const typeLines = types.map((t) => `  ${str(t)},`).join('\n');

const body = `/**
 * The shield rack, generated from the spreadsheet by \`scripts/build-shields.mjs\`.
 *
 * Do not edit by hand: edit \`scripts/shields-source.csv\` and re-run the script.
 *
 * \`familiarity\` is 0-5 where 0 means "used big time" and 5 means "never really
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
${shieldLines}
];

/** Every distinct shield type in the sheet, alphabetically. */
export const SHIELD_TYPES: readonly string[] = [
${typeLines}
];
`;

writeFileSync(OUT, body);

console.log(`wrote ${shields.length} shields across ${types.length} types -> ${OUT}`);
if (unknownUsed.size > 0) {
  console.log(`unrecognised "Used" values (defaulted to unused): ${[...unknownUsed].join(', ')}`);
}
