/**
 * Controls for a protocol run.
 *
 * Built from the armoury rather than written out by hand, so adding a weapon
 * class to the spreadsheet puts it in the exclusion list on the next build
 * without anyone editing this file.
 */

import {
  DEFAULT_EXCLUDED_KINDS,
  freshnessOf,
  kindOf,
  membersOf,
  type ProtocolConfig,
  type WeaponKind,
} from '../eldenring/loadout.ts';
import { WEAPON_TYPES } from '../eldenring/weapons.ts';

const KIND_LABELS: Record<WeaponKind, string> = {
  melee: 'Melee classes',
  ranged: 'Bows, crossbows, ballistae',
  catalyst: 'Staves and seals',
  utility: 'Torches',
};

export interface ProtocolPanelHandlers {
  onChange(config: ProtocolConfig): void;
}

export function mountProtocolPanel(
  host: HTMLElement,
  initial: ProtocolConfig,
  handlers: ProtocolPanelHandlers,
) {
  let config: ProtocolConfig = { ...initial };

  const countInput = document.createElement('input');
  const dlcInput = document.createElement('input');
  const biasInput = document.createElement('input');
  const biasReadout = document.createElement('span');
  const kindInputs = new Map<WeaponKind, HTMLInputElement>();
  const typeInputs = new Map<string, HTMLInputElement>();
  const poolReadout = document.createElement('p');

  function emit(): void {
    config = {
      ...config,
      meleeCount: Number(countInput.value),
      dlc: dlcInput.checked,
      freshnessBias: Number(biasInput.value),
      excludedKinds: [...kindInputs].filter(([, box]) => box.checked).map(([kind]) => kind),
      excludedTypes: [...typeInputs].filter(([, box]) => box.checked).map(([type]) => type),
    };
    refreshReadouts();
    handlers.onChange(config);
  }

  /**
   * The two numbers worth showing back: how strong "lean toward the unused"
   * currently is in plain words, and how many classes survive the exclusions.
   * A protocol that has quietly narrowed itself to four options should say so.
   */
  function refreshReadouts(): void {
    const bias = config.freshnessBias;
    const strength =
      bias < 0.4
        ? 'off — every class equal'
        : bias < 1.2
          ? 'gentle'
          : bias < 2.2
            ? 'firm'
            : 'harsh';
    biasReadout.textContent = `${bias.toFixed(1)} · ${strength}`;

    const excludedKinds = new Set(config.excludedKinds);
    const excludedTypes = new Set(config.excludedTypes);
    const live = WEAPON_TYPES.filter(
      (type) =>
        !excludedKinds.has(kindOf(type)) &&
        !excludedTypes.has(type) &&
        membersOf(type, config).length > 0,
    );
    poolReadout.textContent =
      live.length === 0
        ? 'no classes left — everything is excluded'
        : `${live.length} classes in the main-hand pool`;

    // Drawing more classes than exist is the one config that cannot run.
    countInput.max = String(Math.max(1, live.length));
    if (Number(countInput.value) > live.length && live.length > 0) {
      countInput.value = String(live.length);
    }
  }

  function field(labelText: string, control: HTMLElement, after?: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'field field--row';
    const label = document.createElement('label');
    label.className = 'field__label';
    label.textContent = labelText;
    label.htmlFor = control.id;
    wrap.append(label, control);
    if (after) wrap.append(after);
    return wrap;
  }

  function check(box: HTMLInputElement, text: string, note?: string): HTMLElement {
    const label = document.createElement('label');
    label.className = 'check';
    box.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = text;
    if (note) {
      const em = document.createElement('em');
      em.className = 'check__note';
      em.textContent = note;
      span.append(em);
    }
    label.append(box, span);
    return label;
  }

  /* ---------------- build ---------------- */

  countInput.id = 'melee-count';
  countInput.className = 'stepper__input';
  countInput.type = 'number';
  countInput.min = '1';
  countInput.value = String(config.meleeCount);
  countInput.inputMode = 'numeric';
  countInput.addEventListener('change', emit);

  dlcInput.id = 'protocol-dlc';
  dlcInput.checked = config.dlc;
  dlcInput.addEventListener('change', emit);

  biasInput.id = 'protocol-bias';
  biasInput.className = 'range';
  biasInput.type = 'range';
  biasInput.min = '0';
  biasInput.max = '3';
  biasInput.step = '0.2';
  biasInput.value = String(config.freshnessBias);
  biasInput.addEventListener('input', emit);
  biasReadout.className = 'field__readout';

  poolReadout.className = 'readout';

  const exclusions = document.createElement('fieldset');
  exclusions.className = 'exclude';
  const legend = document.createElement('legend');
  legend.className = 'exclude__legend';
  legend.textContent = 'Keep out of the main hand';
  exclusions.append(legend);

  for (const kind of ['ranged', 'catalyst', 'utility', 'melee'] as const) {
    const box = document.createElement('input');
    box.checked = config.excludedKinds.includes(kind);
    box.addEventListener('change', emit);
    kindInputs.set(kind, box);
    exclusions.append(
      check(
        box,
        KIND_LABELS[kind],
        DEFAULT_EXCLUDED_KINDS.includes(kind) ? 'excluded by default' : undefined,
      ),
    );
  }

  // Individual classes go behind a disclosure: forty checkboxes open by default
  // would bury the four settings that actually matter.
  const perType = document.createElement('details');
  perType.className = 'exclude__types';
  const summary = document.createElement('summary');
  summary.textContent = 'Bar individual classes';
  perType.append(summary);

  const grid = document.createElement('div');
  grid.className = 'exclude__grid';
  for (const type of WEAPON_TYPES) {
    const box = document.createElement('input');
    box.checked = config.excludedTypes.includes(type);
    box.addEventListener('change', emit);
    typeInputs.set(type, box);
    grid.append(check(box, type, `${freshnessOf(type, config).toFixed(1)}/5 unused`));
  }
  perType.append(grid);
  exclusions.append(perType);

  host.replaceChildren(
    field('Weapon classes', countInput),
    check(dlcInput, 'Shadow of the Erdtree', 'DLC weapons in every pool'),
    field('Lean toward the unused', biasInput, biasReadout),
    exclusions,
    poolReadout,
  );

  refreshReadouts();

  return {
    get config(): ProtocolConfig {
      return config;
    },
  };
}
