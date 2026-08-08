/**
 * The stage's text layer: the verdict, the live announcement, and the verify
 * disclosure that lets a sceptic check the draw was settled before it played.
 */

import type { Commitment } from '../draw/commit.ts';
import { hueFor } from '../render/palette.ts';
import type { Entry } from '../types.ts';
import { formatPercent, must } from './dom.ts';

export function mountResults() {
  const verdict = must('verdict');
  const status = must('stage-status');
  const announce = must('announce');
  const verifyHash = must('verify-hash');
  const verifyOdds = must('verify-odds');

  /**
   * The corner readout. An exhausted pool and an empty one look identical from
   * an entry count alone, and telling someone who just drew their whole list to
   * "add entries" would be nonsense — so they get different copy.
   */
  function setStatus(total: number, active: number): void {
    if (total === 0) {
      status.textContent = 'add entries to begin';
    } else if (active === 0) {
      status.textContent = 'every entry drawn — undo or restore';
    } else {
      status.textContent = `${active} ${active === 1 ? 'entry' : 'entries'} in the chamber`;
    }
  }

  /** Clear the winner and go back to waiting. */
  function showIdle(): void {
    verdict.classList.remove('is-live', 'verdict--multi');
    verdict.setAttribute('aria-hidden', 'true');
    verdict.replaceChildren();
  }

  function showWinners(winners: readonly Entry[], indexOf: (entry: Entry) => number): void {
    verdict.classList.toggle('verdict--multi', winners.length > 1);
    verdict.setAttribute('aria-hidden', 'false');

    verdict.replaceChildren(
      ...winners.map((winner, i) => {
        const item = document.createElement('span');
        item.className = 'verdict__item';
        item.style.color = hueFor(winner.label, indexOf(winner)).css;

        if (winners.length > 1) {
          const rank = document.createElement('span');
          rank.className = 'verdict__rank';
          rank.textContent = `${i + 1}`;
          item.append(rank);
        }
        item.append(document.createTextNode(winner.label));
        return item;
      }),
    );

    verdict.classList.add('is-live');
    announce.textContent =
      winners.length === 1
        ? `Winner: ${winners[0]?.label}`
        : `Winners: ${winners.map((w) => w.label).join(', ')}`;
  }

  function hideVerdict(): void {
    verdict.classList.remove('is-live');
  }

  /** Before the spin: publish the commitment hash. */
  function showCommitment(commitment: Commitment | null): void {
    verifyHash.textContent = commitment ? `sha256:${commitment.short}…` : '';
    verifyHash.title = commitment ? 'SHA-256 of nonce|winners, published before the draw' : '';
  }

  /** After the reveal: publish the nonce so the hash can be recomputed. */
  function showOdds(
    entries: readonly Entry[],
    odds: readonly number[],
    commitment: Commitment | null,
  ): void {
    const rows: HTMLElement[] = [];

    if (commitment) {
      const revealed = document.createElement('p');
      revealed.className = 'verify__note';
      revealed.textContent = `nonce ${commitment.nonce}`;
      revealed.style.fontFamily = 'var(--font-mono)';
      revealed.style.overflowWrap = 'anywhere';
      rows.push(revealed);
    }

    entries.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = `odd${entry.eliminated ? ' is-out' : ''}`;

      const swatch = document.createElement('span');
      swatch.className = 'odd__swatch';
      swatch.style.background = hueFor(entry.label, i).css;

      const name = document.createElement('span');
      name.className = 'odd__name';
      name.textContent = entry.label;

      const pct = document.createElement('span');
      pct.className = 'odd__pct';
      pct.textContent = entry.eliminated ? 'out' : formatPercent(odds[i] ?? 0);

      row.append(swatch, name, pct);
      rows.push(row);
    });

    verifyOdds.replaceChildren(...rows);
  }

  return { setStatus, showIdle, showWinners, hideVerdict, showCommitment, showOdds };
}
