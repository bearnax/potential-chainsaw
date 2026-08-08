import { describe, expect, it } from 'vitest';
import {
  dedupe,
  formatList,
  guessColumns,
  looksLikeHeader,
  makeEntry,
  parseDelimited,
  parseList,
  sniffDelimiter,
  tableToEntries,
} from '../src/data/parse.ts';
import { LIMITS } from '../src/types.ts';

const labels = (entries: { label: string }[]) => entries.map((e) => e.label);
const weights = (entries: { weight: number }[]) => entries.map((e) => e.weight);

describe('parseList', () => {
  it('reads one entry per line and trims whitespace', () => {
    const { entries } = parseList('  Ada  \nGrace\n\n  Katherine\n');
    expect(labels(entries)).toEqual(['Ada', 'Grace', 'Katherine']);
    expect(weights(entries)).toEqual([1, 1, 1]);
  });

  it('counts blank lines as skipped rather than entries', () => {
    const { entries, skipped } = parseList('Ada\n\n\nGrace\n');
    expect(entries).toHaveLength(2);
    expect(skipped).toBe(3);
  });

  it('reads a trailing number after a comma or tab as a weight', () => {
    const { entries } = parseList('Ada, 3\nGrace,2\nJean\t4.5');
    expect(weights(entries)).toEqual([3, 2, 4.5]);
    expect(labels(entries)).toEqual(['Ada', 'Grace', 'Jean']);
  });

  it('leaves numbers that are part of the name alone', () => {
    const { entries } = parseList('Apollo 13\nStudio 54\nRoom 101');
    expect(labels(entries)).toEqual(['Apollo 13', 'Studio 54', 'Room 101']);
    expect(weights(entries)).toEqual([1, 1, 1]);
  });

  it('keeps commas inside a name when no weight follows', () => {
    const { entries } = parseList('Lovelace, Ada\nHopper, Grace');
    expect(labels(entries)).toEqual(['Lovelace, Ada', 'Hopper, Grace']);
  });

  it('coerces an unusable weight to 1 and reports it', () => {
    const { entries, coerced, warnings } = parseList('Ada, 0');
    expect(weights(entries)).toEqual([1]);
    expect(coerced).toBe(1);
    expect(warnings.join(' ')).toMatch(/fell back to 1/);
  });

  it('handles CRLF endings', () => {
    const { entries } = parseList('Ada\r\nGrace\r\n');
    expect(labels(entries)).toEqual(['Ada', 'Grace']);
  });

  it('preserves unicode and emoji', () => {
    const { entries } = parseList('日本語\nÜnïcödé 🎲, 2');
    expect(labels(entries)).toEqual(['日本語', 'Ünïcödé 🎲']);
    expect(weights(entries)).toEqual([1, 2]);
  });

  it('truncates at the entry ceiling and says so', () => {
    const text = Array.from({ length: LIMITS.maxEntries + 25 }, (_, i) => `e${i}`).join('\n');
    const { entries, truncated, warnings } = parseList(text);
    expect(entries).toHaveLength(LIMITS.maxEntries);
    expect(truncated).toBe(true);
    expect(warnings.join(' ')).toMatch(/first 5000/);
  });

  it('round-trips through formatList', () => {
    const source = 'Ada, 3\nGrace\nKatherine, 2.5';
    expect(formatList(parseList(source).entries)).toBe(source);
  });
});

describe('parseDelimited', () => {
  it('reads plain rows', () => {
    expect(parseDelimited('a,b\nc,d', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps delimiters inside quoted fields', () => {
    expect(parseDelimited('"Lovelace, Ada",3', ',')).toEqual([['Lovelace, Ada', '3']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseDelimited('"She said ""hi""",1', ',')).toEqual([['She said "hi"', '1']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseDelimited('"line one\nline two",2', ',')).toEqual([['line one\nline two', '2']]);
  });

  it('handles CRLF endings and a trailing newline', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('strips a leading BOM', () => {
    expect(parseDelimited('﻿name,weight\nAda,3', ',')).toEqual([
      ['name', 'weight'],
      ['Ada', '3'],
    ]);
  });

  it('drops fully blank rows', () => {
    expect(parseDelimited('a,b\n,\nc,d', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('reads tabs when told to', () => {
    expect(parseDelimited('a\tb\nc\td', '\t')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('sniffDelimiter', () => {
  it('finds commas, tabs and semicolons', () => {
    expect(sniffDelimiter('name,weight\nAda,3')).toBe(',');
    expect(sniffDelimiter('name\tweight\nAda\t3')).toBe('\t');
    expect(sniffDelimiter('name;weight;note\nAda;3;x')).toBe(';');
  });

  it('is not fooled by a comma inside a quoted header', () => {
    expect(sniffDelimiter('"last, first"\tweight\nAda\t3')).toBe('\t');
  });
});

describe('looksLikeHeader', () => {
  it('spots a recognised header name', () => {
    expect(
      looksLikeHeader([
        ['name', 'weight'],
        ['Ada', '3'],
      ]),
    ).toBe(true);
  });

  it('spots an all-text row above numeric data', () => {
    expect(
      looksLikeHeader([
        ['who', 'how many'],
        ['Ada', '3'],
      ]),
    ).toBe(true);
  });

  it('does not invent a header when row one is data', () => {
    expect(
      looksLikeHeader([
        ['Ada', '3'],
        ['Grace', '2'],
      ]),
    ).toBe(false);
  });

  it('handles a single-row table', () => {
    expect(looksLikeHeader([['Ada', '3']])).toBe(false);
    expect(looksLikeHeader([])).toBe(false);
  });
});

describe('guessColumns', () => {
  it('matches columns by header name', () => {
    const table = [
      ['id', 'label', 'votes'],
      ['1', 'Ada', '3'],
    ];
    expect(guessColumns(table, true)).toEqual({ name: 1, weight: 2 });
  });

  it('falls back to the first numeric column for weight', () => {
    const table = [
      ['Ada', '3'],
      ['Grace', '2'],
    ];
    expect(guessColumns(table, false)).toEqual({ name: 0, weight: 1 });
  });

  it('reports no weight column when nothing is numeric', () => {
    const table = [
      ['Ada', 'engineer'],
      ['Grace', 'admiral'],
    ];
    expect(guessColumns(table, false)).toEqual({ name: 0, weight: null });
  });
});

describe('tableToEntries', () => {
  const table = [
    ['name', 'weight'],
    ['Ada', '3'],
    ['', '9'],
    ['Grace', 'n/a'],
  ];

  it('builds entries and reports skipped and coerced rows', () => {
    const result = tableToEntries(table, { hasHeader: true, nameCol: 0, weightCol: 1 });
    expect(labels(result.entries)).toEqual(['Ada', 'Grace']);
    expect(weights(result.entries)).toEqual([3, 1]);
    expect(result.skipped).toBe(1);
    expect(result.coerced).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/had no name/);
  });

  it('ignores weights entirely when no weight column is chosen', () => {
    const result = tableToEntries(table, { hasHeader: true, nameCol: 0, weightCol: null });
    expect(weights(result.entries)).toEqual([1, 1]);
    expect(result.coerced).toBe(0);
  });

  it('treats every row as data when there is no header', () => {
    const result = tableToEntries(
      [
        ['Ada', '3'],
        ['Grace', '2'],
      ],
      { hasHeader: false, nameCol: 0, weightCol: 1 },
    );
    expect(labels(result.entries)).toEqual(['Ada', 'Grace']);
  });
});

describe('dedupe', () => {
  it('folds duplicate labels together and sums their weight', () => {
    const entries = [makeEntry('Ada', 2), makeEntry('ada', 3), makeEntry('Grace', 1)];
    const result = dedupe(entries);
    expect(result).toHaveLength(2);
    expect(result[0]?.weight).toBe(5);
    expect(result[1]?.label).toBe('Grace');
  });

  it('leaves a list with no duplicates untouched', () => {
    const entries = [makeEntry('Ada'), makeEntry('Grace')];
    expect(dedupe(entries)).toHaveLength(2);
  });
});
