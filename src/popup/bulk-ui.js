/**
 * G4 bulk operations — DOM layer: the contextual bulk bar and its two
 * dialogs (Move, Tag). Selection state and the pure transforms live in
 * ./library.js; popup.js owns the selection and wires these in.
 */
import { h, mount } from './dom.js';
import { orderedCategories, parseTags, tagsInSelection } from './library.js';
import { openModal } from './modals.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 *
 * @typedef {object} BulkHandlers
 * @property {() => void} move
 * @property {() => void} tag
 * @property {() => void} favorite
 * @property {() => void} copy
 * @property {() => void} exportSelected
 * @property {() => void} remove
 * @property {() => void} selectAll
 * @property {() => void} clear
 */

/** Drag type for prompt cards — never `text/plain`, which category reordering uses. */
export const PROMPTS_DRAG_TYPE = 'application/x-prompty-prompts';

/**
 * @param {number} n
 * @returns {string}
 */
export const promptsLabel = (n) => `${n} prompt${n === 1 ? '' : 's'}`;

/**
 * Fill the bulk bar.
 * @param {HTMLElement} el
 * @param {{ count: number, visible: number, allFavorite: boolean }} info
 * @param {BulkHandlers} on
 */
export function renderBulkBar(el, { count, visible, allFavorite }, on) {
  /**
   * @param {string} label
   * @param {() => void} click
   * @param {{ cls?: string, title?: string }} [opts]
   */
  const btn = (label, click, opts = {}) =>
    h(
      'button',
      {
        type: 'button',
        class: `btn btn--sm ${opts.cls ?? ''}`.trim(),
        title: opts.title ?? label,
        on: { click },
      },
      label,
    );
  mount(
    el,
    h(
      'span',
      { class: 'bulkbar__count', 'aria-live': 'polite' },
      h('strong', null, String(count)),
      ' selected',
    ),
    count < visible
      ? btn(`All ${visible}`, on.selectAll, {
          cls: 'btn--ghost',
          title: 'Select every visible prompt (Ctrl/Cmd+A)',
        })
      : null,
    h('span', { class: 'spacer' }),
    btn('Move…', on.move, { title: 'Move to a category (or drag onto one in the sidebar)' }),
    btn('Tag…', on.tag, { title: 'Add or remove tags' }),
    btn(allFavorite ? '☆ Unstar' : '★ Star', on.favorite, {
      title: allFavorite ? 'Remove from favorites' : 'Add to favorites',
    }),
    btn('Copy', on.copy, { title: 'Copy all texts, one blank line apart' }),
    btn('Export', on.exportSelected, { title: 'Download the selection as JSON' }),
    btn('Delete', on.remove, { cls: 'btn--danger', title: 'Delete (Del) — undo for 10 s' }),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: 'Clear selection (Esc)',
        'aria-label': 'Clear selection',
        on: { click: on.clear },
      },
      '✕',
    ),
  );
}

/**
 * Choose a destination category.
 * @param {Category[]} categories
 * @param {number} count
 * @param {string|null} [current] preselected category (the view's, if any)
 * @returns {Promise<string|null>} category id, '' = uncategorized, null = cancelled
 */
export async function moveDialog(categories, count, current = null) {
  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { 'aria-label': 'Destination category' },
      h('option', { value: '' }, 'Uncategorized'),
      orderedCategories(categories).map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`)),
    )
  );
  select.value = current ?? '';
  const result = await openModal({
    title: `Move ${promptsLabel(count)}`,
    body: h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label' }, 'To category'),
      select,
    ),
    submitLabel: 'Move',
    onSubmit: () => ({ categoryId: select.value }),
  });
  return result ? result.categoryId : null;
}

/**
 * Add tags (typed) and remove tags (toggle the ones the selection carries).
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @returns {Promise<{ add: string[], remove: string[] } | null>}
 */
export async function tagDialog(prompts, ids) {
  const existing = tagsInSelection(prompts, ids);
  /** @type {Set<string>} */
  const removing = new Set();
  const input = /** @type {HTMLInputElement} */ (
    h('input', { type: 'text', placeholder: 'client-x, neon, hero', autocomplete: 'off' })
  );
  const error = h('span', { class: 'field__error', role: 'alert' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tags to remove' });
  const drawChips = () =>
    mount(
      chips,
      existing.map(({ tag, count }) =>
        h(
          'button',
          {
            type: 'button',
            class: 'choice choice--remove',
            role: 'checkbox',
            'aria-checked': String(removing.has(tag)),
            title: `On ${count} of ${ids.length}`,
            on: {
              click: () => {
                if (removing.has(tag)) removing.delete(tag);
                else removing.add(tag);
                drawChips();
                /** @type {HTMLElement|null} */ (
                  chips.querySelector(`[data-tag="${CSS.escape(tag)}"]`)
                )?.focus();
              },
            },
            dataset: { tag },
          },
          `${tag} · ${count}`,
        ),
      ),
    );
  drawChips();

  const result = await openModal({
    title: `Tag ${promptsLabel(ids.length)}`,
    body: h(
      'div',
      null,
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Add tags'),
        input,
        h('span', { class: 'field__hint' }, 'Comma-separated. Existing tags are kept.'),
        error,
      ),
      existing.length
        ? h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Remove tags'), chips)
        : h('p', { class: 'muted' }, 'None of these prompts has tags yet.'),
    ),
    submitLabel: 'Apply',
    onSubmit: () => {
      const add = parseTags(input.value);
      if (add.length === 0 && removing.size === 0) {
        error.textContent = 'Type a tag to add, or pick one to remove.';
        input.focus();
        return null;
      }
      return { add, remove: [...removing] };
    },
  });
  return result ?? null;
}

/**
 * A small "N prompts" drag ghost (removed right after the browser snapshots it).
 * @param {DragEvent} e
 * @param {number} count
 */
export function setDragGhost(e, count) {
  if (!e.dataTransfer || count < 2) return;
  const ghost = h('div', { class: 'drag-ghost' }, `✦ ${promptsLabel(count)}`);
  document.body.append(ghost);
  e.dataTransfer.setDragImage(ghost, 12, 12);
  setTimeout(() => ghost.remove(), 0);
}
