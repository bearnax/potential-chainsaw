/**
 * The control panel: source input, draw settings, pool and history.
 *
 * It owns no state of its own — it reads the store, writes back through it,
 * and re-renders on every change.
 */

import {
  dedupe,
  formatList,
  guessColumns,
  looksLikeHeader,
  parseDelimited,
  parseList,
  sniffDelimiter,
  tableToEntries,
  type ParseResult,
  type Table,
} from '../data/parse.ts';
import { oddsOf } from '../draw/rng.ts';
import { hueFor } from '../render/palette.ts';
import { activeEntries, effectiveWeights, type Store } from '../state/store.ts';
import { buildShareUrl } from '../state/persist.ts';
import { LIMITS, type AppState } from '../types.ts';
import { debounce, formatPercent, must, show } from './dom.ts';

export interface PanelHandlers {
  onEntriesChanged: () => void;
}

export function mountPanel(store: Store, handlers: PanelHandlers) {
  const paste = must<HTMLTextAreaElement>('paste');
  const parseReadout = must('parse-readout');
  const shareReadout = must('share-readout');
  const drop = must('drop');
  const fileInput = must<HTMLInputElement>('file');
  const cols = must('cols');
  const colName = must<HTMLSelectElement>('col-name');
  const colWeight = must<HTMLSelectElement>('col-weight');
  const hasHeader = must<HTMLInputElement>('has-header');
  const countInput = must<HTMLInputElement>('count');
  const countUp = must<HTMLButtonElement>('count-up');
  const countDown = must<HTMLButtonElement>('count-down');
  const useWeights = must<HTMLInputElement>('use-weights');
  const eliminate = must<HTMLInputElement>('eliminate');
  const sound = must<HTMLInputElement>('sound');
  const poolList = must<HTMLOListElement>('pool');
  const historyList = must<HTMLOListElement>('history');
  const undoBtn = must<HTMLButtonElement>('undo');
  const restoreBtn = must<HTMLButtonElement>('restore');
  const shareBtn = must<HTMLButtonElement>('share');
  const clearBtn = must<HTMLButtonElement>('clear');
  const panePaste = must('pane-paste');
  const paneFile = must('pane-file');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.seg__btn')];

  /** Last parsed table, kept so the column pickers can re-derive entries. */
  let table: Table | null = null;
  /** Set while the panel itself is writing the textarea, to skip re-parsing. */
  let syncing = false;

  /* ---------------- source tabs ---------------- */

  function selectTab(name: string): void {
    for (const tab of tabs) {
      const active = tab.dataset['tab'] === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    show(panePaste, name === 'paste');
    show(paneFile, name === 'file');
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset['tab'] ?? 'paste'));
  }

  /* ---------------- paste ---------------- */

  function applyResult(result: ParseResult, source: string): void {
    store.setEntries(dedupe(result.entries));
    const parts = [`${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'}`];

    const weighted = result.entries.filter((e) => e.weight !== 1).length;
    if (weighted) parts.push(`${weighted} weighted`);
    if (source === 'file' && result.skipped) parts.push(`${result.skipped} skipped`);
    parts.push(...result.warnings);

    parseReadout.textContent = parts.join(' · ');
    parseReadout.classList.toggle('is-warn', result.truncated);
    handlers.onEntriesChanged();
  }

  const reparse = debounce(() => {
    if (syncing) return;
    table = null;
    applyResult(parseList(paste.value), 'paste');
  }, 220);

  paste.addEventListener('input', reparse);

  /* ---------------- files ---------------- */

  function fillColumnPickers(current: Table): void {
    const header = hasHeader.checked ? current[0] : undefined;
    const width = Math.max(0, ...current.map((r) => r.length));
    const optionLabel = (i: number): string => {
      const name = header?.[i]?.trim();
      return name ? `${i + 1}. ${name}` : `Column ${i + 1}`;
    };

    const guess = guessColumns(current, hasHeader.checked);

    colName.replaceChildren(
      ...Array.from({ length: width }, (_, i) => new Option(optionLabel(i), String(i))),
    );
    colWeight.replaceChildren(
      new Option('None — all equal', ''),
      ...Array.from({ length: width }, (_, i) => new Option(optionLabel(i), String(i))),
    );

    colName.value = String(guess.name);
    colWeight.value = guess.weight === null ? '' : String(guess.weight);
  }

  function applyTable(): void {
    if (!table) return;
    const weightValue = colWeight.value;
    const result = tableToEntries(table, {
      hasHeader: hasHeader.checked,
      nameCol: Number(colName.value) || 0,
      weightCol: weightValue === '' ? null : Number(weightValue),
    });

    syncing = true;
    paste.value = formatList(result.entries);
    syncing = false;
    applyResult(result, 'file');
  }

  async function ingestFile(file: File): Promise<void> {
    if (file.size > LIMITS.maxFileBytes) {
      parseReadout.textContent = `file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB`;
      parseReadout.classList.add('is-warn');
      return;
    }

    const text = await file.text();
    const parsed = parseDelimited(text, sniffDelimiter(text));
    if (parsed.length === 0) {
      parseReadout.textContent = 'no rows found in that file';
      parseReadout.classList.add('is-warn');
      return;
    }

    table = parsed;
    hasHeader.checked = looksLikeHeader(parsed);
    fillColumnPickers(parsed);
    show(cols, true);
    applyTable();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void ingestFile(file);
  });

  colName.addEventListener('change', applyTable);
  colWeight.addEventListener('change', applyTable);
  hasHeader.addEventListener('change', () => {
    if (table) fillColumnPickers(table);
    applyTable();
  });

  // Drag and drop anywhere on the page, not just over the small dashed box.
  let dragDepth = 0;
  const setOver = (over: boolean) => drop.classList.toggle('is-over', over);

  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    dragDepth += 1;
    selectTab('file');
    setOver(true);
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setOver(false);
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dragDepth = 0;
    setOver(false);
    void ingestFile(event.dataTransfer.files[0]!);
  });

  /* ---------------- settings ---------------- */

  countInput.addEventListener('change', () => {
    const max = Math.max(1, activeEntries(store.get()).length);
    const value = Math.min(max, Math.max(1, Math.floor(Number(countInput.value) || 1)));
    store.patchSettings({ count: value });
  });
  countUp.addEventListener('click', () => {
    const max = Math.max(1, activeEntries(store.get()).length);
    store.patchSettings({ count: Math.min(max, store.get().settings.count + 1) });
  });
  countDown.addEventListener('click', () => {
    store.patchSettings({ count: Math.max(1, store.get().settings.count - 1) });
  });

  useWeights.addEventListener('change', () =>
    store.patchSettings({ useWeights: useWeights.checked }),
  );
  eliminate.addEventListener('change', () => store.patchSettings({ eliminate: eliminate.checked }));
  sound.addEventListener('change', () => store.patchSettings({ sound: sound.checked }));

  /* ---------------- pool, history, actions ---------------- */

  undoBtn.addEventListener('click', () => {
    store.undo();
    handlers.onEntriesChanged();
  });

  restoreBtn.addEventListener('click', () => {
    store.restoreAll();
    handlers.onEntriesChanged();
  });

  clearBtn.addEventListener('click', () => {
    syncing = true;
    paste.value = '';
    syncing = false;
    table = null;
    show(cols, false);
    fileInput.value = '';
    store.clear();
    parseReadout.textContent = 'no entries';
    parseReadout.classList.remove('is-warn');
    shareReadout.textContent = '';
    handlers.onEntriesChanged();
  });

  shareBtn.addEventListener('click', async () => {
    const { entries, settings } = store.get();
    if (entries.length === 0) {
      shareReadout.textContent = 'nothing to share yet';
      return;
    }

    const { url, tooLong } = await buildShareUrl(entries, settings);
    if (tooLong) {
      shareReadout.textContent = 'list too long for a URL — copy the text instead';
      shareReadout.classList.add('is-warn');
      return;
    }

    shareReadout.classList.remove('is-warn');
    try {
      await navigator.clipboard.writeText(url);
      shareReadout.textContent =
        'link copied — the list travels inside it, visible to anyone who has it';
    } catch {
      // Clipboard permission denied or an insecure context: put the link in the
      // address bar so it can still be copied by hand.
      location.hash = new URL(url).hash;
      shareReadout.textContent = 'link is in the address bar — copy it from there';
    }
  });

  /* ---------------- rendering ---------------- */

  function renderPool(state: AppState): void {
    const active = activeEntries(state);
    const odds = oddsOf(effectiveWeights(state, active));
    const oddsById = new Map(active.map((entry, i) => [entry.id, odds[i] ?? 0]));

    poolList.replaceChildren(
      ...state.entries.map((entry, index) => {
        const item = document.createElement('li');
        item.className = `pool__item${entry.eliminated ? ' is-out' : ''}`;

        const swatch = document.createElement('span');
        swatch.className = 'pool__swatch';
        swatch.style.background = hueFor(entry.label, index).css;

        const name = document.createElement('span');
        name.className = 'pool__name';
        name.textContent = entry.label;
        name.title = entry.label;

        const pct = document.createElement('span');
        pct.className = 'pool__pct';
        pct.textContent = entry.eliminated ? 'out' : formatPercent(oddsById.get(entry.id) ?? 0);

        const remove = document.createElement('button');
        remove.className = 'pool__drop';
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${entry.label}`);
        remove.addEventListener('click', () => {
          store.removeEntry(entry.id);
          syncing = true;
          paste.value = formatList(store.get().entries);
          syncing = false;
          handlers.onEntriesChanged();
        });

        item.append(swatch, name, pct, remove);
        return item;
      }),
    );
  }

  function renderHistory(state: AppState): void {
    if (state.history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'history__empty';
      empty.textContent = 'No draws yet.';
      historyList.replaceChildren(empty);
      return;
    }

    historyList.replaceChildren(
      ...state.history.map((record, i) => {
        const item = document.createElement('li');
        item.className = 'history__item';

        const n = document.createElement('span');
        n.className = 'history__n';
        n.textContent = String(state.history.length - i).padStart(2, '0');

        const names = document.createElement('span');
        names.className = 'history__names';
        names.textContent = record.winnerLabels.join(', ');

        item.append(n, names);
        return item;
      }),
    );
  }

  function render(state: AppState): void {
    const active = activeEntries(state);

    countInput.max = String(Math.max(1, active.length));
    countInput.value = String(state.settings.count);
    countDown.disabled = state.settings.count <= 1;
    countUp.disabled = state.settings.count >= active.length;

    useWeights.checked = state.settings.useWeights;
    eliminate.checked = state.settings.eliminate;
    sound.checked = state.settings.sound;

    undoBtn.hidden = state.history.length === 0;
    restoreBtn.hidden = !state.entries.some((e) => e.eliminated);

    renderPool(state);
    renderHistory(state);
  }

  /** Load entries from outside the panel (autosave, share link) into the UI. */
  function adopt(state: AppState): void {
    syncing = true;
    paste.value = formatList(state.entries);
    syncing = false;
    if (state.entries.length) {
      const weighted = state.entries.filter((e) => e.weight !== 1).length;
      parseReadout.textContent = [
        `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`,
        ...(weighted ? [`${weighted} weighted`] : []),
      ].join(' · ');
    }
  }

  store.subscribe(render);
  render(store.get());

  return { render, adopt, notice: (text: string) => (shareReadout.textContent = text) };
}
