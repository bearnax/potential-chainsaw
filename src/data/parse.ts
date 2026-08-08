/**
 * Turning whatever the user pasted or dropped into entries.
 *
 * Both paths report what they did — counts, coercions, things skipped — so the
 * panel can show a live readout instead of silently swallowing a bad row.
 */

import { normalizeWeight } from '../draw/rng.ts';
import { LIMITS, type Entry } from '../types.ts';

export interface ParseResult {
  readonly entries: Entry[];
  /** Rows that were blank or unusable. */
  readonly skipped: number;
  /** Rows whose weight could not be read and fell back to 1. */
  readonly coerced: number;
  readonly truncated: boolean;
  readonly warnings: string[];
}

let idCounter = 0;

/** Ids only need to be unique within a session, not across reloads. */
export function makeId(): string {
  idCounter += 1;
  return `e${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function makeEntry(label: string, weight: unknown = 1): Entry {
  return {
    id: makeId(),
    label: label.slice(0, LIMITS.maxLabel),
    weight: normalizeWeight(weight),
    eliminated: false,
  };
}

/**
 * A trailing number after the final comma or tab is read as a weight.
 *
 * Requiring the separator keeps "Studio 54" and "Apollo 13" intact — only
 * "Studio, 54" asks to be weighted. The panel shows a live count of how many
 * lines were read this way so the rule is never a silent surprise.
 */
const WEIGHTED_LINE = /^(.*[^\s,\t])[,\t][ \t]*(\d+(?:\.\d+)?)$/;

export function parseList(text: string): ParseResult {
  const warnings: string[] = [];
  const entries: Entry[] = [];
  let skipped = 0;
  let coerced = 0;
  let truncated = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) {
      skipped += 1;
      continue;
    }

    if (entries.length >= LIMITS.maxEntries) {
      truncated = true;
      break;
    }

    const match = WEIGHTED_LINE.exec(line);
    if (match) {
      const label = match[1]!.trim();
      const weight = Number(match[2]);
      if (label) {
        const normalized = normalizeWeight(weight);
        if (normalized !== weight) coerced += 1;
        entries.push(makeEntry(label, normalized));
        continue;
      }
    }

    entries.push(makeEntry(line, 1));
  }

  if (truncated) {
    warnings.push(`kept the first ${LIMITS.maxEntries} entries`);
  }
  if (coerced) {
    warnings.push(`${coerced} weight${coerced === 1 ? '' : 's'} fell back to 1`);
  }

  return { entries, skipped, coerced, truncated, warnings };
}

/** Render entries back into the paste format, round-tripping weights. */
export function formatList(entries: readonly Entry[]): string {
  return entries.map((e) => (e.weight === 1 ? e.label : `${e.label}, ${e.weight}`)).join('\n');
}

/* ------------------------------------------------------------------ */
/* Delimited files                                                     */
/* ------------------------------------------------------------------ */

export type Table = string[][];

/**
 * RFC 4180 reader: quoted fields, "" escapes, embedded delimiters and
 * newlines, and CRLF or LF line endings. Small enough to keep in-repo rather
 * than pulling in a CSV dependency for a static page.
 */
export function parseDelimited(text: string, delimiter: string): Table {
  const rows: Table = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  // A BOM at the head of a spreadsheet export would otherwise poison the first
  // header name and break column matching.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      endRow();
      if (text[i + 1] === '\n') i += 1;
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // A trailing newline shouldn't manufacture a phantom empty row.
  if (field !== '' || row.length > 0) endRow();

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Guess the delimiter from whichever splits the first line into most fields. */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    // Count outside quotes only, so "Last, First" doesn't win the vote.
    const count = parseDelimited(firstLine, candidate)[0]?.length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/**
 * Does row 0 look like a header?
 *
 * Heuristic, not a promise — the panel exposes it as a checkbox the user can
 * flip the moment the preview looks wrong.
 */
export function looksLikeHeader(table: Table): boolean {
  const [first, second] = table;
  if (!first) return false;

  const headerish = /^(name|label|option|entry|item|title|choice|weight|count|votes|tickets)$/i;
  if (first.some((cell) => headerish.test(cell.trim()))) return true;

  // A header row is all text; a data row usually has at least one number.
  if (!second) return false;
  const firstNumeric = first.filter((c) => c.trim() !== '' && Number.isFinite(Number(c))).length;
  const secondNumeric = second.filter((c) => c.trim() !== '' && Number.isFinite(Number(c))).length;
  return firstNumeric === 0 && secondNumeric > 0;
}

/** Best-guess column indices, matched by header name then by content shape. */
export function guessColumns(
  table: Table,
  hasHeader: boolean,
): { name: number; weight: number | null } {
  const header = hasHeader ? table[0] : undefined;
  const body = hasHeader ? table.slice(1) : table;
  const width = Math.max(0, ...table.map((r) => r.length));

  let name = 0;
  let weight: number | null = null;

  if (header) {
    const nameIdx = header.findIndex((h) =>
      /^(name|label|option|entry|item|title|choice)$/i.test(h.trim()),
    );
    const weightIdx = header.findIndex((h) =>
      /^(weight|weighting|count|votes|tickets|entries|odds|chances)$/i.test(h.trim()),
    );
    if (nameIdx >= 0) name = nameIdx;
    if (weightIdx >= 0) weight = weightIdx;
  }

  if (weight === null && body.length > 0) {
    // Fall back to the first fully numeric column that isn't the name column.
    for (let col = 0; col < width; col++) {
      if (col === name) continue;
      const values = body.map((r) => r[col]?.trim() ?? '');
      const filled = values.filter((v) => v !== '');
      if (filled.length === 0) continue;
      if (filled.every((v) => Number.isFinite(Number(v)))) {
        weight = col;
        break;
      }
    }
  }

  return { name, weight };
}

export function tableToEntries(
  table: Table,
  options: { hasHeader: boolean; nameCol: number; weightCol: number | null },
): ParseResult {
  const body = options.hasHeader ? table.slice(1) : table;
  const entries: Entry[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let coerced = 0;
  let truncated = false;

  for (const row of body) {
    if (entries.length >= LIMITS.maxEntries) {
      truncated = true;
      break;
    }

    const label = (row[options.nameCol] ?? '').trim();
    if (!label) {
      skipped += 1;
      continue;
    }

    let weight = 1;
    if (options.weightCol !== null) {
      const raw = (row[options.weightCol] ?? '').trim();
      const parsed = Number(raw);
      const normalized = normalizeWeight(parsed);
      if (raw === '' || !Number.isFinite(parsed) || parsed <= 0) coerced += 1;
      weight = normalized;
    }

    entries.push(makeEntry(label, weight));
  }

  if (truncated) warnings.push(`kept the first ${LIMITS.maxEntries} rows`);
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} had no name`);
  if (coerced) warnings.push(`${coerced} weight${coerced === 1 ? '' : 's'} fell back to 1`);

  return { entries, skipped, coerced, truncated, warnings };
}

/** Drop later duplicates, folding their weight into the first occurrence. */
export function dedupe(entries: readonly Entry[]): Entry[] {
  const byLabel = new Map<string, Entry>();
  for (const entry of entries) {
    const key = entry.label.toLocaleLowerCase();
    const existing = byLabel.get(key);
    byLabel.set(key, existing ? { ...existing, weight: existing.weight + entry.weight } : entry);
  }
  return [...byLabel.values()];
}
