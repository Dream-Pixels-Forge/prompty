/**
 * G4 bulk operations — DOM layer: the contextual bulk bar and its two
 * dialogs (Move, Tag). Selection state and the pure transforms live in
 * ./library.js; popup.js owns the selection and wires these in.
 */
import { t, tn } from '../lib/i18n.js';
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
 * @property {() => void} pack
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
export const promptsLabel = (n) => tn('nPrompts', n);

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
      ` ${t('selectedSuffix')}`,
    ),
    count < visible
      ? btn(t('selectAllN', visible), on.selectAll, {
          cls: 'btn--ghost',
          title: t('selectAllHint'),
        })
      : null,
    h('span', { class: 'spacer' }),
    btn(t('moveEllipsis'), on.move, { title: t('moveHint') }),
    btn(t('tagEllipsis'), on.tag, { title: t('tagHint') }),
    btn(allFavorite ? t('unstarButton') : t('starButton'), on.favorite, {
      title: allFavorite ? t('removeFromFavorites') : t('addToFavorites'),
    }),
    btn(t('copy'), on.copy, { title: t('copyAllHint') }),
    btn(t('export'), on.exportSelected, { title: t('exportSelectionHint') }),
    btn(t('packEllipsis'), on.pack, { title: t('packHint') }),
    btn(t('delete'), on.remove, { cls: 'btn--danger', title: t('bulkDeleteHint') }),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: t('clearSelectionHint'),
        'aria-label': t('clearSelection'),
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
      { 'aria-label': t('destinationCategory') },
      h('option', { value: '' }, t('uncategorized')),
      orderedCategories(categories).map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`)),
    )
  );
  select.value = current ?? '';
  const result = await openModal({
    title: t('moveTitle', promptsLabel(count)),
    body: h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label' }, t('toCategory')),
      select,
    ),
    submitLabel: t('move'),
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
    h('input', { type: 'text', placeholder: t('tagsPlaceholder'), autocomplete: 'off' })
  );
  const error = h('span', { class: 'field__error', role: 'alert' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': t('tagsToRemove') });
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
            title: t('onCountOf', count, ids.length),
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
    title: t('tagTitle', promptsLabel(ids.length)),
    body: h(
      'div',
      null,
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, t('addTags')),
        input,
        h('span', { class: 'field__hint' }, t('addTagsHint')),
        error,
      ),
      existing.length
        ? h('div', { class: 'field' }, h('span', { class: 'field__label' }, t('removeTags')), chips)
        : h('p', { class: 'muted' }, t('noTagsYet')),
    ),
    submitLabel: t('apply'),
    onSubmit: () => {
      const add = parseTags(input.value);
      if (add.length === 0 && removing.size === 0) {
        error.textContent = t('tagNothingChosen');
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

/**
 * Name the pack (author and description optional).
 * @param {number} count
 * @param {string} [suggested]
 * @returns {Promise<{ name: string, author: string, description: string } | null>}
 */
export async function packDialog(count, suggested = '') {
  const name = /** @type {HTMLInputElement} */ (
    h('input', {
      type: 'text',
      value: suggested,
      maxlength: '80',
      placeholder: t('packNamePlaceholder'),
    })
  );
  const author = /** @type {HTMLInputElement} */ (
    h('input', { type: 'text', maxlength: '80', placeholder: t('optional') })
  );
  const description = /** @type {HTMLTextAreaElement} */ (
    h('textarea', { rows: '3', maxlength: '500', placeholder: t('packDescriptionPlaceholder') })
  );
  const error = h('span', { class: 'field__error', role: 'alert' });
  /**
   * @param {string} label
   * @param {HTMLElement} control
   * @param {HTMLElement} [extra]
   */
  const field = (label, control, extra) =>
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), control, extra);
  const result = await openModal({
    title: t('shareAsPackTitle', promptsLabel(count)),
    body: h(
      'div',
      null,
      field(t('packName'), name, error),
      field(t('author'), author),
      field(t('description'), description),
      h('p', { class: 'muted' }, t('packExplain')),
    ),
    submitLabel: t('downloadPack'),
    onSubmit: () => {
      if (!name.value.trim()) {
        error.textContent = t('packNameRequired');
        name.focus();
        return null;
      }
      return { name: name.value, author: author.value, description: description.value };
    },
  });
  return result ?? null;
}
