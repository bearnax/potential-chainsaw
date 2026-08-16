import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeShare, encodeShare, readShareUrl } from '../src/state/persist.ts';
import { makeEntry } from '../src/data/parse.ts';
import { defaultSettings } from '../src/state/store.ts';
import type { Entry } from '../src/types.ts';

const sample: Entry[] = [
  makeEntry('Ada Lovelace', 3),
  makeEntry('Grace Hopper'),
  makeEntry('Katherine Johnson', 2.5),
];

describe('share encoding', () => {
  it('round-trips labels and weights', async () => {
    const decoded = await decodeShare(await encodeShare(sample));
    expect(decoded?.entries.map((e) => e.label)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Katherine Johnson',
    ]);
    expect(decoded?.entries.map((e) => e.weight)).toEqual([3, 1, 2.5]);
  });

  it('round-trips unicode, emoji, RTL text and quotes', async () => {
    const tricky = [
      makeEntry('Ünïcödé 🎲'),
      makeEntry('日本語のなまえ'),
      makeEntry('مرحبا بالعالم'),
      makeEntry('She said "hi", loudly'),
    ];
    const decoded = await decodeShare(await encodeShare(tricky));
    expect(decoded?.entries.map((e) => e.label)).toEqual(tricky.map((e) => e.label));
  });

  it('round-trips settings when they are included', async () => {
    const settings = { ...defaultSettings(), count: 3, useWeights: false, eliminate: true };
    const decoded = await decodeShare(await encodeShare(sample, settings));
    expect(decoded?.settings).toMatchObject({ count: 3, useWeights: false, eliminate: true });
  });

  it('preserves elimination state', async () => {
    const withOut: Entry[] = [{ ...makeEntry('Ada'), eliminated: true }, makeEntry('Grace')];
    const decoded = await decodeShare(await encodeShare(withOut));
    expect(decoded?.entries.map((e) => e.eliminated)).toEqual([true, false]);
  });

  it("assigns fresh ids rather than reusing the sender's", async () => {
    const decoded = await decodeShare(await encodeShare(sample));
    const ids = decoded?.entries.map((e) => e.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(sample[0]!.id);
  });

  it('compresses a repetitive list well below its JSON size', async () => {
    const many = Array.from({ length: 300 }, (_, i) => makeEntry(`Contestant number ${i}`));
    const encoded = await encodeShare(many);
    const rawJson = JSON.stringify(many.map((e) => ({ n: e.label })));
    expect(encoded[0]).toBe('1');
    expect(encoded.length).toBeLessThan(rawJson.length / 2);
  });

  it('reads the uncompressed fallback form', async () => {
    const json = JSON.stringify({ v: 1, e: [{ n: 'Ada', w: 2 }] });
    const b64 = Buffer.from(json, 'utf8').toString('base64url');
    const decoded = await decodeShare(`0${b64}`);
    expect(decoded?.entries[0]).toMatchObject({ label: 'Ada', weight: 2 });
  });

  it('rejects junk instead of throwing', async () => {
    for (const junk of ['', 'x', '1', '1!!!!', '0bm90IGpzb24', 'zzzz']) {
      await expect(decodeShare(junk)).resolves.toBeNull();
    }
  });

  it('rejects a payload with the wrong version', async () => {
    const b64 = Buffer.from(JSON.stringify({ v: 9, e: [{ n: 'Ada' }] }), 'utf8').toString(
      'base64url',
    );
    await expect(decodeShare(`0${b64}`)).resolves.toBeNull();
  });

  it('drops entries with no usable label', async () => {
    const b64 = Buffer.from(
      JSON.stringify({ v: 1, e: [{ n: 'Ada' }, { n: '   ' }, { w: 3 }, null] }),
      'utf8',
    ).toString('base64url');
    const decoded = await decodeShare(`0${b64}`);
    expect(decoded?.entries.map((e) => e.label)).toEqual(['Ada']);
  });

  it('rejects a payload with missing entries array', async () => {
    const b64 = Buffer.from(JSON.stringify({ v: 1, e: null }), 'utf8').toString('base64url');
    await expect(decodeShare(`0${b64}`)).resolves.toBeNull();
  });
});

describe('share URLs', () => {
  const base = 'https://bearnax.github.io/potential-chainsaw/';

  it('builds a hash URL that reads back', async () => {
    const { url, tooLong } = await buildShareUrl(sample, defaultSettings(), base);
    expect(url.startsWith(`${base}#l=`)).toBe(true);
    expect(tooLong).toBe(false);

    const decoded = await readShareUrl(new URL(url).hash);
    expect(decoded?.entries.map((e) => e.label)).toEqual(sample.map((e) => e.label));
  });

  it('flags a list too large for a URL', async () => {
    const huge = Array.from({ length: 4000 }, (_, i) =>
      makeEntry(`${i}-${Math.random().toString(36).slice(2)}`),
    );
    const { tooLong } = await buildShareUrl(huge, defaultSettings(), base);
    expect(tooLong).toBe(true);
  });

  it('ignores a hash with no share payload', async () => {
    await expect(readShareUrl('#something-else')).resolves.toBeNull();
    await expect(readShareUrl('')).resolves.toBeNull();
  });
});
