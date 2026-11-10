/**
 * G9 — Compose view: build a shot from film-grammar blocks.
 *
 * The composition lives in memory while the popup is open (the source of
 * truth, so storage live-sync never reverts what you're typing) and is saved
 * to `composerDraft` so closing the popup doesn't lose it. Delivery reuses
 * the shared fill-in form and insert/copy pipeline (actions.js).
 */
import browser from '../lib/browser.js';
import {
  JOINERS,
  SLOTS,
  TEMPLATES,
  addBlock,
  compose,
  emptyComposition,
  fromTemplate,
  moveBlock,
  normalizeComposition,
  pickPrompt,
  promptsForSlot,
  removeBlock,
  updateBlock,
} from '../lib/composition.js';
import { rememberValues } from '../lib/variables.js';
import { deliverText } from './actions.js';
import { h, mount } from './dom.js';
import { upsertPrompt } from './library.js';
import { fillVariables, promptEditor, toast, OPEN_HISTORY } from './modals.js';
import { save, state } from './store.js';

/**
 * @typedef {import('../lib/composition.js').Composition} Composition
 * @typedef {import('../lib/composition.js').Block} Block
 */

const DRAFT_KEY = 'composerDraft';
const newId = () => crypto.randomUUID();

/** @type {Composition|null} */
let composition = null;
/** Title to suggest when saving (template name or the reopened prompt's title). */
let suggestedTitle = '';
let draftTimer = 0;
/** @type {HTMLElement|null} */
let rootEl = null;

/** Persist the draft soon (debounced) — and right away when the popup goes away. */
function persist() {
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    if (composition) void browser.storage.local.set({ [DRAFT_KEY]: composition });
  }, 400);
}
window.addEventListener('pagehide', () => {
  if (composition) void browser.storage.local.set({ [DRAFT_KEY]: composition });
});

/** @param {Composition} next */
function setComposition(next) {
  composition = next;
  persist();
  if (rootEl) renderCompose(rootEl);
}

/**
 * Open an existing composition (e.g. a saved prompt's) in the Composer.
 * @param {Composition} c
 * @param {string} [title]
 */
export function openComposition(c, title = '') {
  composition = normalizeComposition(c) ?? emptyComposition(newId);
  suggestedTitle = title;
  persist();
}

/**
 * @param {HTMLElement} root
 */
export function renderCompose(root) {
  rootEl = root;
  if (!composition) {
    // First open this session: restore the saved draft, then render.
    composition = emptyComposition(newId);
    void browser.storage.local
      .get([DRAFT_KEY])
      .then((/** @type {Record<string, unknown>} */ raw) => {
        const draft = normalizeComposition(raw?.[DRAFT_KEY]);
        if (draft && rootEl === root) {
          composition = draft;
          renderCompose(root);
        }
      });
  }
  const c = composition;

  // Keep focus and caret across re-renders.
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const focusKey = active?.dataset?.focusKey ?? null;
  const caret =
    active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;

  const preview = h('p', { class: 'compose__preview', 'aria-live': 'polite' });
  const stats = h('span', { class: 'muted' });
  const updatePreview = () => {
    const shot = compose(/** @type {Composition} */ (composition));
    mount(
      preview,
      shot.text
        ? highlightVariables(shot.text)
        : h('span', { class: 'muted' }, 'Pick or write a few blocks — the shot assembles here.'),
    );
    stats.textContent = `${shot.used} block${shot.used === 1 ? '' : 's'} · ${shot.variables.length} variable${shot.variables.length === 1 ? '' : 's'}`;
  };

  mount(
    root,
    h(
      'div',
      { class: 'view__head' },
      h('h1', { class: 'view__title' }, '✦ Compose a shot'),
      h('span', { class: 'spacer' }),
      h(
        'div',
        { class: 'seg', role: 'radiogroup', 'aria-label': 'Join blocks with' },
        JOINERS.map((j) =>
          h(
            'button',
            {
              type: 'button',
              class: 'seg__btn',
              role: 'radio',
              'aria-checked': String(c.joiner === j),
              title: j === ', ' ? 'Join with commas' : 'Join as sentences',
              on: { click: () => setComposition({ ...c, joiner: j }) },
            },
            j === ', ' ? 'a, b' : 'A. B.',
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          on: {
            click: () => {
              suggestedTitle = '';
              setComposition(emptyComposition(newId));
            },
          },
        },
        'Clear',
      ),
    ),
    h(
      'div',
      { class: 'compose__templates' },
      h('span', { class: 'field__label' }, 'Start from'),
      TEMPLATES.map((t) =>
        h(
          'button',
          {
            class: 'choice',
            type: 'button',
            on: {
              click: () => {
                const next = fromTemplate(t.id, state.prompts, newId);
                if (!next) return;
                suggestedTitle = t.name;
                setComposition(next);
                toast(`“${t.name}” loaded. Edit any block.`);
              },
            },
          },
          t.name,
        ),
      ),
    ),
    h(
      'ol',
      { class: 'compose__blocks', 'aria-label': 'Shot blocks, in order' },
      c.blocks.map((b, i) => blockRow(b, i, c, updatePreview)),
    ),
    h(
      'div',
      { class: 'inline-form compose__add' },
      h(
        'select',
        {
          class: 'select',
          'aria-label': 'Add a block',
          on: {
            change: (e) => {
              const select = /** @type {HTMLSelectElement} */ (e.target);
              if (!select.value) return;
              setComposition(addBlock(c, select.value, newId()));
            },
          },
        },
        h('option', { value: '' }, '+ Add block…'),
        SLOTS.map((s) => h('option', { value: s.id }, s.label)),
      ),
    ),
    h(
      'section',
      { class: 'compose__out' },
      h(
        'div',
        { class: 'view__head' },
        h('span', { class: 'field__label' }, 'Shot'),
        h('span', { class: 'spacer' }),
        stats,
      ),
      preview,
      h(
        'div',
        { class: 'card__actions' },
        h(
          'button',
          {
            class: 'btn btn--primary btn--sm',
            type: 'button',
            on: { click: () => void deliver('insert') },
          },
          'Insert',
        ),
        h(
          'button',
          { class: 'btn btn--sm', type: 'button', on: { click: () => void deliver('append') } },
          'Append',
        ),
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            title: 'Ctrl+Enter',
            on: { click: () => void deliver('copy') },
          },
          'Copy',
        ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          { class: 'btn btn--sm', type: 'button', on: { click: () => void saveAsPrompt() } },
          'Save as prompt',
        ),
      ),
    ),
  );
  updatePreview();

  if (focusKey) {
    const el = /** @type {HTMLElement|null} */ (
      root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)
    );
    el?.focus();
    if (el instanceof HTMLTextAreaElement && caret) el.setSelectionRange(caret[0], caret[1]);
  }
}

/**
 * @param {Block} b
 * @param {number} index
 * @param {Composition} c
 * @param {() => void} updatePreview
 */
function blockRow(b, index, c, updatePreview) {
  const slot = SLOTS.find((s) => s.id === b.slot) ?? SLOTS[SLOTS.length - 1];
  const options = promptsForSlot(b.slot, state.prompts, state.categories);
  /** Alt+↑/↓ reorders from any control in the row. */
  const onKey = (/** @type {Event} */ e) => {
    const ke = /** @type {KeyboardEvent} */ (e);
    if (!ke.altKey || (ke.key !== 'ArrowUp' && ke.key !== 'ArrowDown')) return;
    e.preventDefault();
    setComposition(moveBlock(c, b.id, ke.key === 'ArrowUp' ? -1 : 1));
  };
  const text = h('textarea', {
    class: 'compose__text',
    rows: '2',
    value: b.text,
    placeholder: options.length
      ? `Pick a ${slot.label.toLowerCase()} prompt or write your own…`
      : `Describe the ${slot.label.toLowerCase()}…`,
    dataset: { focusKey: `${b.id}:text` },
    'aria-label': `${slot.label} text`,
    on: {
      input: (e) => {
        // In-place edit: update the model + preview without re-rendering (keeps typing smooth).
        composition = updateBlock(/** @type {Composition} */ (composition), b.id, {
          text: /** @type {HTMLTextAreaElement} */ (e.target).value,
        });
        persist();
        updatePreview();
      },
      keydown: onKey,
    },
  });
  return h(
    'li',
    {
      class: `compose__block${b.muted ? ' compose__block--muted' : ''}`,
      draggable: 'true',
      dataset: { id: b.id },
      on: {
        dragstart: (e) =>
          /** @type {DragEvent} */ (e).dataTransfer?.setData('application/x-prompty-block', b.id),
        dragover: (e) => {
          if (
            /** @type {DragEvent} */ (e).dataTransfer?.types.includes('application/x-prompty-block')
          )
            e.preventDefault();
        },
        drop: (e) => {
          e.preventDefault();
          const from = /** @type {DragEvent} */ (e).dataTransfer?.getData(
            'application/x-prompty-block',
          );
          const cur = /** @type {Composition} */ (composition);
          const a = cur.blocks.findIndex((x) => x.id === from);
          if (a !== -1 && a !== index)
            setComposition(moveBlock(cur, /** @type {string} */ (from), index - a));
        },
      },
    },
    h(
      'div',
      { class: 'compose__head' },
      h(
        'span',
        { class: 'compose__grip', 'aria-hidden': 'true', title: 'Drag to reorder (or Alt+↑/↓)' },
        '⋮⋮',
      ),
      h('span', { class: 'compose__n' }, String(index + 1)),
      h(
        'select',
        {
          class: 'compose__slot',
          'aria-label': 'Block type',
          dataset: { focusKey: `${b.id}:slot` },
          on: {
            change: (e) =>
              setComposition(
                updateBlock(c, b.id, { slot: /** @type {HTMLSelectElement} */ (e.target).value }),
              ),
            keydown: onKey,
          },
        },
        SLOTS.map((s) => h('option', { value: s.id, selected: s.id === b.slot }, s.label)),
      ),
      options.length
        ? h(
            'select',
            {
              class: 'compose__pick',
              'aria-label': `${slot.label} prompt`,
              dataset: { focusKey: `${b.id}:pick` },
              on: {
                change: (e) => {
                  const id = /** @type {HTMLSelectElement} */ (e.target).value;
                  setComposition(
                    pickPrompt(c, b.id, state.prompts.find((p) => p.id === id) ?? null),
                  );
                },
                keydown: onKey,
              },
            },
            h(
              'option',
              { value: '' },
              b.promptId && !options.some((p) => p.id === b.promptId)
                ? 'Custom (source deleted)'
                : 'Custom text',
            ),
            options.map((p) =>
              h('option', { value: p.id, selected: p.id === b.promptId }, p.title),
            ),
          )
        : h('span', { class: 'spacer' }),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-pressed': String(b.muted),
          title: b.muted ? 'Unmute block' : 'Mute block (keep it, leave it out of the shot)',
          'aria-label': b.muted ? `Unmute ${slot.label}` : `Mute ${slot.label}`,
          dataset: { focusKey: `${b.id}:mute` },
          on: {
            click: () => setComposition(updateBlock(c, b.id, { muted: !b.muted })),
            keydown: onKey,
          },
        },
        b.muted ? '◌' : '●',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn icon-btn--danger',
          title: 'Remove block',
          'aria-label': `Remove ${slot.label} block`,
          on: { click: () => setComposition(removeBlock(c, b.id)) },
        },
        '✕',
      ),
    ),
    text,
  );
}

/**
 * Show the assembled text with {variables} as orange pills.
 * @param {string} text
 * @returns {DocumentFragment}
 */
function highlightVariables(text) {
  const frag = document.createDocumentFragment();
  const re = /\{[a-zA-Z_][a-zA-Z0-9_]*(?::[^{}]*|=[^{}]*)?\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = /** @type {number} */ (m.index);
    if (at > last) frag.append(text.slice(last, at));
    frag.append(h('span', { class: 'compose__var' }, m[0]));
    last = at + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/**
 * Fill variables once across all blocks, then insert / append / copy.
 * @param {'insert'|'append'|'copy'} mode
 */
export async function deliver(mode) {
  const shot = compose(/** @type {Composition} */ (composition));
  if (!shot.text) return toast('The shot is empty — pick or write a block first.', 'error');
  let text = shot.text;
  if (shot.variables.length > 0) {
    const filled = await fillVariables(
      /** @type {any} */ ({ id: 'composer', title: suggestedTitle || 'Composed shot', text }),
      mode,
      state.variableMemory,
    );
    if (!filled) return;
    text = filled.text;
    await save({ variableMemory: rememberValues(state.variableMemory, filled.values) });
  }
  const ok = await deliverText(text, mode);
  if (ok && mode !== 'copy') window.close();
}

/** Save the assembled shot (variables kept as variables) with its blocks, so it can be reopened here. */
async function saveAsPrompt() {
  const c = /** @type {Composition} */ (composition);
  const shot = compose(c);
  if (!shot.text) return toast('The shot is empty — nothing to save.', 'error');
  const draft = await promptEditor({
    initial: { title: suggestedTitle, text: shot.text, tags: ['composed'] },
    categories: state.categories,
  });
  if (!draft || draft === OPEN_HISTORY) return;
  const id = newId();
  const prompts = upsertPrompt(state.prompts, draft, { id }).map((p) =>
    p.id === id ? { ...p, composition: structuredClone(c) } : p,
  );
  await save({ prompts });
  toast(`Saved “${draft.title.trim()}”. Reopen it here with 🎛 on its card.`);
}

/** Ctrl/Cmd+Enter copies the shot while the Compose view is open. */
export function onComposeKey(/** @type {KeyboardEvent} */ e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void deliver('copy');
  }
}
