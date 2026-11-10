/**
 * G2 command palette overlay (Ctrl/Cmd+K). Ranking + key mapping live in
 * ./palette.js; this is the DOM layer. Prompts route through the shared
 * actions (variables → fill-in modal → PROMPTY_INSERT / clipboard).
 */
import { buildExport } from './logic.js';
import { usePrompt, deliverText } from './actions.js';
import { h, highlighted, mount } from './dom.js';
import { OPEN_HISTORY, promptEditor, toast } from './modals.js';
import { buildCommands, keyIntent, moveSelection, rankPalette, resolveAction } from './palette.js';
import { upsertPrompt } from './library.js';
import { save, state } from './store.js';
import browser from '../lib/browser.js';

/**
 * @typedef {import('./palette.js').PaletteItem} PaletteItem
 * @typedef {import('./palette.js').PaletteAction} PaletteAction
 * @typedef {{ goCategory: (id: string) => void, exportLibrary: () => void, showHistory: (id: string) => void, goCompose: () => void }} PaletteHost
 */

const ICONS = { prompt: '✦', snippet: '⧉', command: '›' };

/** @type {{ close: () => void } | null} */
let open = null;

export function isPaletteOpen() {
  return open !== null;
}

/**
 * Open (or reset, if already open) the palette.
 * @param {PaletteHost} host
 */
export function openPalette(host) {
  if (open) open.close();

  /** @type {PaletteItem[]} */
  let items = [];
  let selected = 0;
  let busy = false;

  const input = h('input', {
    class: 'palette__input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-results',
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Search prompts, snippets, commands…',
  });
  const list = h('ul', { id: 'palette-results', class: 'palette__list', role: 'listbox' });
  const panel = h(
    'div',
    { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div', { class: 'palette__head' }, input, h('kbd', null, 'Esc')),
    list,
    h(
      'div',
      { class: 'palette__foot' },
      h('span', null, h('kbd', null, '↵'), ' insert'),
      h('span', null, h('kbd', null, '⇧↵'), ' append'),
      h('span', null, h('kbd', null, 'Ctrl↵'), ' copy'),
      h('span', null, h('kbd', null, 'Alt↵'), ' save snippet'),
    ),
  );
  const overlay = h(
    'div',
    {
      class: 'backdrop backdrop--top',
      on: { mousedown: (e) => e.target === overlay && close() },
    },
    panel,
  );

  const refresh = () => {
    const commands = buildCommands({
      categories: state.categories,
      settings: state.settings,
      prompts: state.prompts,
    });
    items = rankPalette(
      { prompts: state.prompts, snippets: state.snippets, commands },
      input.value,
    );
    selected = Math.min(selected, Math.max(0, items.length - 1));
    render();
  };

  const render = () => {
    if (items.length === 0) {
      mount(
        list,
        h('li', { class: 'empty' }, input.value.trim() ? 'No matches' : 'Your library is empty'),
      );
      input.removeAttribute('aria-activedescendant');
      return;
    }
    mount(
      list,
      items.map((item, i) =>
        h(
          'li',
          {
            id: `pal-${i}`,
            class: 'palette__item',
            role: 'option',
            'aria-selected': String(i === selected),
            on: {
              mousemove: () => {
                if (selected !== i) {
                  selected = i;
                  render();
                }
              },
              click: () => void act('default'),
            },
          },
          h('span', { class: 'palette__icon', 'aria-hidden': 'true' }, ICONS[item.kind]),
          h('span', { class: 'palette__label' }, highlighted(item.label, item.matches)),
          h('span', { class: 'palette__detail' }, item.detail),
        ),
      ),
    );
    input.setAttribute('aria-activedescendant', `pal-${selected}`);
    document.getElementById(`pal-${selected}`)?.scrollIntoView({ block: 'nearest' });
  };

  /** @param {PaletteAction|'default'} requested */
  const act = async (requested) => {
    const item = items[selected];
    const action = resolveAction(item, requested);
    if (!item || !action || busy) {
      if (item && requested === 'promote') toast('Only snippets can be saved as prompts.', 'error');
      return;
    }
    busy = true;
    try {
      if (item.kind === 'command' && item.command) {
        const effect = item.command.effect;
        close();
        if (effect.type === 'scope' && typeof effect.categoryId === 'string')
          host.goCategory(effect.categoryId);
        else if (effect.type === 'setting' && typeof effect.key === 'string') {
          await save({ settings: { [effect.key]: effect.value } });
          toast(`${item.command.label}: done.`);
        } else if (effect.type === 'export') host.exportLibrary();
        else if (effect.type === 'compose') host.goCompose();
        else if (effect.type === 'history' && typeof effect.promptId === 'string')
          host.showHistory(effect.promptId);
        return;
      }
      if (action === 'promote' && item.snippet) {
        close();
        const draft = await promptEditor({
          initial: { text: item.snippet.text },
          categories: state.categories,
        });
        if (draft && draft !== OPEN_HISTORY) {
          await save({ prompts: upsertPrompt(state.prompts, draft, { id: crypto.randomUUID() }) });
          toast(`Saved “${draft.title.trim()}”.`);
        }
        return;
      }
      const mode = action === 'append' ? 'append' : action === 'copy' ? 'copy' : 'insert';
      if (item.prompt) {
        const ok = await usePrompt(item.prompt, mode);
        if (ok) close();
      } else if (item.snippet) {
        const ok = await deliverText(item.snippet.text, mode);
        if (ok && mode !== 'copy') window.close();
        if (ok) close();
      }
    } finally {
      busy = false;
    }
  };

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    // Let modals opened from the palette (variable fill-in) own the keyboard.
    if (document.querySelector('.backdrop:not(.backdrop--top)')) return;
    // aria-modal: focus stays in the palette (its only control is the search field).
    if (e.key === 'Tab') {
      e.preventDefault();
      input.focus();
      return;
    }
    const intent = keyIntent(e);
    if (!intent) return;
    e.preventDefault();
    e.stopPropagation();
    if (intent.type === 'reset') {
      input.value = '';
      selected = 0;
      refresh();
      input.focus();
    } else if (intent.type === 'escape') {
      if (input.value) {
        input.value = '';
        refresh();
      } else close();
    } else if (intent.type === 'move') {
      selected = moveSelection(selected, intent.delta, items.length);
      render();
    } else if (intent.type === 'act') void act(intent.action);
  };

  const previousFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    open = null;
    previousFocus?.focus?.();
  };

  input.addEventListener('input', () => {
    selected = 0;
    refresh();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  open = { close };
  refresh();
  input.focus();
}

/**
 * Download the library as JSON (SPEC §1 export envelope). With a G4 subset
 * (`{ prompts, categories }`) only those are written and settings are left
 * out, so importing the file never changes the importer's preferences.
 * Settings' "Export JSON" passes its click event here, hence the guard.
 * @param {unknown} [subset]
 */
export function exportLibrary(subset) {
  const part =
    subset && typeof subset === 'object' && Array.isArray(/** @type {any} */ (subset).prompts)
      ? /** @type {{ prompts: import('../lib/storage.js').Prompt[], categories: import('../lib/storage.js').Category[] }} */ (
          subset
        )
      : null;
  const full = buildExport(
    part
      ? { ...part, settings: undefined }
      : { prompts: state.prompts, categories: state.categories, settings: state.settings },
    { version: browser.runtime.getManifest().version },
  );
  /** @type {Record<string, unknown>} */
  const data = { ...full };
  if (part) delete data.settings;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const day = new Date().toISOString().slice(0, 10);
  const a = h('a', {
    href: URL.createObjectURL(blob),
    download: part ? `prompty-selection-${day}.json` : `prompty-export-${day}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const n = full.prompts.length;
  toast(`Exported ${n} prompt${n === 1 ? '' : 's'}.`);
}
