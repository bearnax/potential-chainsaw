/**
 * Commit-reveal for the draw.
 *
 * The chamber animation takes a couple of seconds, which raises a fair
 * question: is the outcome decided by the physics, or was it fixed in advance
 * and the physics is theatre? It is the latter — so we prove it. Before the
 * first particle moves we publish a SHA-256 commitment to the result. Once the
 * winner is revealed we publish the nonce, and anyone can recompute the digest
 * and confirm it matches the hash they were staring at the whole time.
 */

/** Canonical preimage, so an independent verifier can rebuild it exactly. */
export function commitPreimage(nonce: string, winners: readonly string[]): string {
  return `${nonce}|${winners.join(',')}`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Commitment {
  readonly nonce: string;
  readonly digest: string;
  /** Short form shown in the UI while the chamber spins. */
  readonly short: string;
}

export async function commitTo(nonce: string, winners: readonly string[]): Promise<Commitment> {
  const digest = await sha256Hex(commitPreimage(nonce, winners));
  return { nonce, digest, short: digest.slice(0, 12) };
}

/** Recompute and compare — the check a sceptical user would run by hand. */
export async function verifyCommitment(
  commitment: Commitment,
  winners: readonly string[],
): Promise<boolean> {
  const digest = await sha256Hex(commitPreimage(commitment.nonce, winners));
  return digest === commitment.digest;
}
