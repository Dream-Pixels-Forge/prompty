/**
 * Popup entry — mounts the G2 keyboard-first command palette.
 * All ranking/keys logic lives in ./palette.js (tested); this file is the thin
 * DOM + extension-API layer. Untrusted text is only ever set via textContent.
 */
import browser from '../lib/browser.js';
import { MSG_INSERT_PROMPT } from '../lib/message.js';
import { seedPresets } from '../lib/presets.js';
import { appendSnippet, readAll, writeAll } from '../lib/storage.js';
import { humanizeVar, resolveVariables } from '../lib/variables.js';
import { buildExport } from './logic.js';
import {
  buildCommands,
  keyIntent,
  markUsed,
  moveSelection,
  promoteSnippet,
  rankPalette,
  requiredVariables,
  resolveAction,
} from './palette.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('../lib/storage.js').Settings} Settings
 * @typedef {import('../lib/storage.js').Snippet} Snippet
 * @typedef {import('./palette.js').PaletteItem} PaletteItem
 * @typedef {import('./palette.js').PaletteAction} PaletteAction
 */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const queryEl = /** @type {HTMLInputElement} */ ($('query'));
const listEl = $('results');
const scopeEl = $('scope');
const statusEl = $('status');
const varsForm = /** @type {HTMLFormElement} */ ($('vars'));
const varsTitle = $('vars-title');
const varsFields = $('vars-fields');
const varsPreview = $('vars-preview');
const hintsEl = $('hints');

const ICONS = { prompt: '✦', snippet: '⧉', command: '›' };

const state = {
  /** @type {Prompt[]} */ prompts: [],
  /** @type {Category[]} */ categories: [],
  /** @type {Settings|null} */ settings: null,
  /** @type {Snippet[]} */ snippets: [],
  /** @type {string|null} */ scope: null,
  /** @type {PaletteItem[]} */ items: [],
  selected: 0,
  /** @type {{ item: PaletteItem, action: PaletteAction, names: string[] } | null} */
  pending: null,
};

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

async function load() {
  try {
    await seedPresets();
  } catch {
    // seeding is best-effort; an empty library still renders
  }
  const lib = await readAll();
  const raw = await browser.storage.local.get(['snippets']);
  state.prompts = lib.prompts;
  state.categories = lib.categories;
  state.settings = lib.settings;
  state.snippets = Array.isArray(raw.snippets) ? raw.snippets : [];
  document.body.classList.toggle('compact', lib.settings.compactMode === true);
}

/** @param {Prompt[]} prompts */
async function savePrompts(prompts) {
  state.prompts = prompts;
  await writeAll(undefined, { prompts });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function refresh() {
  const commands = buildCommands({
    categories: state.categories,
    settings: state.settings ?? undefined,
    scopeCategoryId: state.scope,
  });
  state.items = rankPalette(
    { prompts: state.prompts, snippets: state.snippets, commands },
    queryEl.value,
    { scopeCategoryId: state.scope },
  );
  state.selected = Math.min(state.selected, Math.max(0, state.items.length - 1));
  renderList();
  renderScope();
}

function renderScope() {
  const cat = state.categories.find((c) => c.id === state.scope);
  scopeEl.hidden = !cat;
  scopeEl.textContent = cat ? `${cat.icon ?? ''} ${cat.name}`.trim() : '';
}

function renderList() {
  listEl.replaceChildren();
  if (state.items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = queryEl.value.trim() ? 'No matches' : 'Your library is empty';
    listEl.append(li);
    queryEl.removeAttribute('aria-activedescendant');
    return;
  }
  state.items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.id = `opt-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(index === state.selected));
    li.dataset.index = String(index);

    const icon = document.createElement('span');
    icon.className = 'item__icon';
    icon.textContent = ICONS[item.kind];
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'item__label';
    appendHighlighted(label, item.label, item.matches);

    const detail = document.createElement('span');
    detail.className = 'item__detail';
    detail.textContent = item.detail;

    li.append(icon, label, detail);
    listEl.append(li);
  });
  queryEl.setAttribute('aria-activedescendant', `opt-${state.selected}`);
  document.getElementById(`opt-${state.selected}`)?.scrollIntoView({ block: 'nearest' });
}

/**
 * @param {HTMLElement} parent
 * @param {string} text
 * @param {{start:number,end:number}[]} ranges
 */
function appendHighlighted(parent, text, ranges) {
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) parent.append(text.slice(cursor, start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    parent.append(mark);
    cursor = end;
  }
  if (cursor < text.length) parent.append(text.slice(cursor));
}

/**
 * @param {string} message
 * @param {boolean} [isError]
 */
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

/* ------------------------------------------------------------------ */
/* Variable fill-in                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {PaletteItem} item
 * @param {PaletteAction} action
 * @param {string[]} names
 */
function openVars(item, action, names) {
  state.pending = { item, action, names };
  listEl.hidden = true;
  hintsEl.hidden = true;
  varsForm.hidden = false;
  varsTitle.textContent = item.label;
  varsFields.replaceChildren();
  names.forEach((name) => {
    const label = document.createElement('label');
    label.textContent = humanizeVar(name);
    const input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    input.autocomplete = 'off';
    input.addEventListener('input', updatePreview);
    label.append(input);
    varsFields.append(label);
  });
  updatePreview();
  setStatus(
    'Fill every field, then Enter on the last one (Ctrl+Enter from anywhere). Esc goes back.',
  );
  /** @type {HTMLInputElement|null} */ (varsFields.querySelector('input'))?.focus();
}

function closeVars() {
  state.pending = null;
  varsForm.hidden = true;
  listEl.hidden = false;
  hintsEl.hidden = false;
  setStatus('');
  queryEl.focus();
}

/** @returns {Record<string, string>} */
function varValues() {
  /** @type {Record<string, string>} */
  const values = {};
  varsFields.querySelectorAll('input').forEach((input) => {
    if (input.value.trim() !== '') values[input.name] = input.value;
  });
  return values;
}

function updatePreview() {
  if (!state.pending?.item.prompt) return;
  varsPreview.textContent = resolveVariables(state.pending.item.prompt.text, varValues());
}

async function submitVars() {
  const pending = state.pending;
  if (!pending?.item.prompt) return;
  const values = varValues();
  const missing = pending.names.filter((n) => !(n in values));
  if (missing.length > 0) {
    setStatus(`Missing: ${missing.map(humanizeVar).join(', ')}`, true);
    /** @type {HTMLInputElement|null} */ (
      varsFields.querySelector(`input[name="${CSS.escape(missing[0])}"]`)
    )?.focus();
    return;
  }
  await deliver(pending.item, pending.action, resolveVariables(pending.item.prompt.text, values));
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {PaletteItem|undefined} item
 * @param {PaletteAction|'default'} requested
 */
async function act(item, requested) {
  const action = resolveAction(item, requested);
  if (!item || !action) {
    if (item && requested === 'promote') setStatus('Only snippets can be saved as prompts.', true);
    return;
  }
  if (item.kind === 'command' && item.command) return runCommand(item.command);
  if (action === 'promote' && item.snippet) return promote(item.snippet);

  const names = requiredVariables(item);
  if (names.length > 0) return openVars(item, action, names);
  const text = item.prompt?.text ?? item.snippet?.text ?? '';
  return deliver(item, action, text);
}

/**
 * Insert/append into the page, or copy to the clipboard.
 * @param {PaletteItem} item
 * @param {PaletteAction} action
 * @param {string} text
 */
async function deliver(item, action, text) {
  if (action === 'copy') {
    const ok = await copyText(text);
    if (!ok) return setStatus('Copy failed — clipboard unavailable.', true);
    state.snippets = appendSnippet(state.snippets, { text, sourceOrigin: 'prompty' });
    await browser.storage.local.set({ snippets: state.snippets });
    if (item.prompt) await savePrompts(markUsed(state.prompts, item.prompt.id));
    setStatus('Copied to clipboard.');
    setTimeout(() => window.close(), 500);
    return;
  }

  const mode = action === 'append' ? 'append' : 'insert';
  /** @type {{ success?: boolean, error?: string } | null} */
  let response = null;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      response = await browser.tabs.sendMessage(tab.id, { type: MSG_INSERT_PROMPT, text, mode });
    }
  } catch {
    response = null;
  }
  if (!response) {
    return setStatus(
      "Prompty can't reach this page (browser pages block extensions). Ctrl+Enter copies instead.",
      true,
    );
  }
  if (!response.success) {
    return setStatus(
      `${response.error ?? 'Insert failed'} — click a text field on the page first, or Ctrl+Enter to copy.`,
      true,
    );
  }
  if (item.prompt) await savePrompts(markUsed(state.prompts, item.prompt.id));
  window.close();
}

/** @param {Snippet} snippet */
async function promote(snippet) {
  const prompt = promoteSnippet(snippet, { id: crypto.randomUUID() });
  await savePrompts([...state.prompts, prompt]);
  setStatus(`Saved “${prompt.title}” as a prompt.`);
  refresh();
}

/** @param {import('./palette.js').PaletteCommand} command */
async function runCommand(command) {
  const effect = command.effect;
  if (effect.type === 'scope') {
    state.scope = typeof effect.categoryId === 'string' ? effect.categoryId : null;
    queryEl.value = '';
    state.selected = 0;
    setStatus('');
    refresh();
    return;
  }
  if (effect.type === 'setting' && state.settings && typeof effect.key === 'string') {
    state.settings = { ...state.settings, [effect.key]: effect.value };
    await writeAll(undefined, { settings: state.settings });
    document.body.classList.toggle('compact', state.settings.compactMode === true);
    setStatus(`${command.label} — done.`);
    queryEl.value = '';
    refresh();
    return;
  }
  if (effect.type === 'export') {
    const data = buildExport(
      { prompts: state.prompts, categories: state.categories, settings: state.settings },
      { version: browser.runtime.getManifest().version },
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prompty-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(`Exported ${state.prompts.length} prompts.`);
  }
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function resetPalette() {
  if (state.pending) closeVars();
  state.scope = null;
  queryEl.value = '';
  state.selected = 0;
  setStatus('');
  refresh();
  queryEl.focus();
}

/** @param {KeyboardEvent} event */
function onKeydown(event) {
  const intent = keyIntent(event);
  if (!intent) return;

  if (intent.type === 'reset') {
    event.preventDefault();
    resetPalette();
    return;
  }

  if (state.pending) {
    if (intent.type === 'escape') {
      event.preventDefault();
      closeVars();
    } else if (intent.type === 'act') {
      const inputs = [...varsFields.querySelectorAll('input')];
      const onLast = event.target === inputs[inputs.length - 1];
      if (onLast || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        void submitVars();
      } else {
        event.preventDefault();
        const i = inputs.indexOf(/** @type {HTMLInputElement} */ (event.target));
        inputs[i + 1]?.focus();
      }
    }
    return;
  }

  if (intent.type === 'move') {
    event.preventDefault();
    state.selected = moveSelection(state.selected, intent.delta, state.items.length);
    renderList();
  } else if (intent.type === 'act') {
    event.preventDefault();
    void act(state.items[state.selected], intent.action);
  } else if (intent.type === 'escape') {
    event.preventDefault();
    if (queryEl.value) {
      queryEl.value = '';
      refresh();
    } else if (state.scope) {
      state.scope = null;
      refresh();
    } else {
      window.close();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

queryEl.addEventListener('input', () => {
  state.selected = 0;
  setStatus('');
  refresh();
});
document.addEventListener('keydown', onKeydown);
varsForm.addEventListener('submit', (event) => event.preventDefault());
listEl.addEventListener('click', (event) => {
  const li = /** @type {HTMLElement|null} */ (
    /** @type {HTMLElement} */ (event.target).closest('[data-index]')
  );
  if (!li) return;
  state.selected = Number(li.dataset.index);
  void act(state.items[state.selected], 'default');
});

load()
  .catch(() => setStatus('Could not load your library.', true))
  .finally(() => {
    refresh();
    queryEl.focus();
  });
