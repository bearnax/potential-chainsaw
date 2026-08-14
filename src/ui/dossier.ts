/**
 * The dossier: what the run decided, and what it forbids.
 *
 * The stage results are the easy half. The half worth building is the lockout
 * table — a weapon class means nothing on its own when a third of the class is
 * something I have already worn out, so every drawn class prints its own
 * three-act contract and the list of weapons it is not allowed to touch.
 */

import type { Loadout } from '../eldenring/protocol.ts';
import type { Progression, Ruling } from '../eldenring/loadout.ts';

const ACT_ID = ['i', 'ii', 'iii'];

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function verdictRow(label: string, values: readonly string[]): HTMLElement {
  const row = el('div', 'dossier__row');
  row.append(el('span', 'dossier__key', label));

  const list = el('span', 'dossier__values');
  for (const value of values) list.append(el('span', 'dossier__value', value));
  row.append(list);
  return row;
}

function rulingChip(ruling: Ruling): HTMLElement {
  const chip = el('li', `chip chip--${ruling.standing}`);
  chip.append(el('span', 'chip__name', ruling.weapon.name));
  if (ruling.weapon.dlc) chip.append(el('span', 'chip__tag', 'DLC'));
  chip.title = ruling.reason;
  return chip;
}

function progressionCard(progression: Progression): HTMLElement {
  const card = el('section', 'prog');
  card.append(el('h3', 'prog__type', progression.type));

  if (progression.exhausted) {
    card.append(
      el(
        'p',
        'prog__warn',
        'Every weapon in this class is already used up. Widen the DLC setting or accept a repeat.',
      ),
    );
  }

  const acts = el('ol', 'prog__acts');
  progression.acts.forEach((act, i) => {
    const item = el('li', `act act--${ACT_ID[i] ?? 'i'}`);

    const head = el('div', 'act__head');
    head.append(el('span', 'act__name', act.name));
    head.append(el('span', 'act__window', act.window));
    item.append(head);

    item.append(el('p', 'act__rule', act.rule));

    if (act.allowed.length === 0) {
      item.append(el('p', 'act__none', 'nothing eligible'));
    } else {
      const allowed = el('ul', 'act__allowed');
      for (const weapon of act.allowed) {
        const entry = el('li', 'act__weapon', weapon.name);
        if (weapon.dlc) entry.append(el('span', 'chip__tag', 'DLC'));
        allowed.append(entry);
      }
      item.append(allowed);
    }

    acts.append(item);
  });
  card.append(acts);

  const barred = progression.rulings.filter((r) => r.standing !== 'open');
  if (barred.length > 0) {
    const block = el('div', 'prog__locks');
    const locked = barred.filter((r) => r.standing === 'locked').length;
    block.append(
      el(
        'h4',
        'prog__locks-title',
        `Locked out — ${locked} used big time, ${barred.length - locked} early only`,
      ),
    );

    const chips = el('ul', 'chips');
    for (const ruling of barred) chips.append(rulingChip(ruling));
    block.append(chips);
    card.append(block);
  }

  return card;
}

export function mountDossier(host: HTMLElement) {
  function clear(): void {
    host.replaceChildren();
    host.hidden = true;
  }

  function render(loadout: Loadout): void {
    const summary = el('div', 'dossier__summary');
    for (const result of loadout.results) {
      summary.append(
        verdictRow(
          result.stage.title,
          result.winners.map((w) => w.label),
        ),
      );
    }

    const progs = el('div', 'dossier__progs');
    for (const progression of loadout.progressions) progs.append(progressionCard(progression));

    host.replaceChildren(
      el('h2', 'dossier__title', 'Run dossier'),
      summary,
      el(
        'p',
        'dossier__note',
        'Acts gate commitment, not map progress: take what drops early, narrow by the midgame, ' +
          'finish on one weapon you have never used.',
      ),
      progs,
    );
    host.hidden = false;
  }

  return { render, clear };
}
