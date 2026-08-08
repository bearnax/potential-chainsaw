import { describe, expect, it } from 'vitest';
import { commitPreimage, commitTo, verifyCommitment } from '../src/draw/commit.ts';
import { randomNonce } from '../src/draw/rng.ts';

describe('commit-reveal', () => {
  it('builds a canonical preimage', () => {
    expect(commitPreimage('abc', ['Ada', 'Grace'])).toBe('abc|Ada,Grace');
  });

  it('produces a stable 64-hex digest', async () => {
    const a = await commitTo('deadbeef', ['Ada']);
    const b = await commitTo('deadbeef', ['Ada']);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(a.short).toBe(a.digest.slice(0, 12));
  });

  it('matches an externally computed SHA-256 vector', async () => {
    // Independently checkable: printf 'test|a' | shasum -a 256
    const { digest } = await commitTo('test', ['a']);
    expect(digest).toBe('5fe7071c43b6b88fd44088746cc4f1a5de61a2badb0f52e13c35a64978745524');
  });

  it('verifies the committed winners and rejects any other set', async () => {
    const nonce = randomNonce();
    const winners = ['Katherine Johnson', 'Ada Lovelace'];
    const commitment = await commitTo(nonce, winners);

    expect(await verifyCommitment(commitment, winners)).toBe(true);
    expect(await verifyCommitment(commitment, ['Ada Lovelace', 'Katherine Johnson'])).toBe(false);
    expect(await verifyCommitment(commitment, ['Ada Lovelace'])).toBe(false);
    expect(await verifyCommitment({ ...commitment, nonce: 'other' }, winners)).toBe(false);
  });

  it('handles unicode names', async () => {
    const names = ['Ünïcödé 🎲', '日本語', 'RTL مرحبا'];
    const commitment = await commitTo(randomNonce(), names);
    expect(await verifyCommitment(commitment, names)).toBe(true);
  });

  it('uses a fresh nonce each draw', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomNonce()));
    expect(seen.size).toBe(500);
  });
});
