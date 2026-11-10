/**
 * Popup entry — library shell (SPEC §1): sidebar views + categories CRUD,
 * prompt grid with insert/append/copy/edit/delete/favorite, snippets tab,
 * settings, and the Ctrl/Cmd+K command palette (G2).
 */
import { extractVariables } from '../lib/variables.js';
import { copyText, usePrompt } from './actions.js';
import {
  PROMPTS_DRAG_TYPE,
  moveDialog,
  packDialog,
  promptsLabel,
  renderBulkBar,
  setDragGhost,
  tagDialog,
} from './bulk-ui.js';
import { h, mount } from './dom.js';
import {
  bulkFavorite,
  bulkMove,
  bulkTag,
  clearSelection,
  countByCategory,
  deleteCategory,
  joinedText,
  pruneSelection,
  rangeSelection,
  removeMany,
  restoreMany,
  selectAllVisible,
  selectionLibrary,
  toggleSelection,
  moveCategory,
  orderedCategories,
  removePrompt,
  restorePrompt,
  restoreVersion,
  toggleFavorite,
  upsertCategory,
  upsertPrompt,
  viewPrompts,
} from './library.js';
import { SORT_OPTIONS, chipsFor, relativeTime } from './logic.js';
import {
  OPEN_HISTORY,
  categoryEditor,
  confirmDialog,
  historyModal,
  promptEditor,
  toast,
} from './modals.js';
import { exportLibrary, openPalette } from './palette-ui.js';
import { onComposeKey, openComposition, renderCompose } from './compose-view.js';
import { renderSettings } from './settings-view.js';
import { renderSnippets } from './snippets-view.js';
import { load, save, state, subscribe, watchStorage } from './store.js';
import { migrateFrom } from './import-ui.js';
import { buildPack, packFileName } from '../lib/pack.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {'all'|'favorites'|'recent'|'category'|'snippets'|'compose'|'settings'} View
 */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const navEl = $('nav');
const navBottomEl = $('nav-bottom');
const categoriesEl = $('categories');
const viewEl = $('view');
const searchEl = /** @type {HTMLInputElement} */ ($('search'));
const sortEl = /** @type {HTMLSelectElement} */ ($('sort'));
const toolbarEl = $('toolbar');
const bulkbarEl = $('bulkbar');

const route = {
  /** @type {View} */ view: 'all',
  /** @type {string|null} */ categoryId: null,
};

const NAV = /** @type {const} */ ([
  ['all', '◎', 'All prompts'],
  ['favorites', '★', 'Favorites'],
  ['recent', '↺', 'Recently used'],
  ['snippets', '⧉', 'Snippets'],
  ['compose', '✦', 'Compose'],
]);

/**
 * @param {View} view
 * @param {string|null} [categoryId]
 */
function go(view, categoryId = null) {
  route.view = view;
  route.categoryId = categoryId;
  render();
  viewEl.scrollTop = 0;
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function renderSidebar() {
  const counts = countByCategory(state.prompts);
  /**
   * @param {View} view
   * @param {string} icon
   * @param {string} label
   * @param {number|null} [count]
   */
  const navButton = (view, icon, label, count = null) =>
    h(
      'button',
      {
        type: 'button',
        class: 'nav__item',
        'aria-current': route.view === view ? 'page' : 'false',
        on: { click: () => go(view) },
      },
      h('span', { class: 'nav__icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'nav__label' }, label),
      count !== null ? h('span', { class: 'nav__count' }, String(count)) : null,
    );

  mount(
    navEl,
    NAV.map(([view, icon, label]) =>
      navButton(
        view,
        icon,
        label,
        view === 'all'
          ? state.prompts.length
          : view === 'favorites'
            ? state.prompts.filter((p) => p.isFavorite).length
            : view === 'snippets'
              ? state.snippets.length
              : null,
      ),
    ),
  );
  mount(navBottomEl, navButton('settings', '⚙', 'Settings'));

  const cats = orderedCategories(state.categories);
  mount(
    categoriesEl,
    cats.length === 0 ? h('p', { class: 'nav__empty' }, 'No categories yet') : null,
    cats.map((cat) =>
      h(
        'div',
        {
          class: 'nav__row',
          draggable: 'true',
          dataset: { id: cat.id },
          on: {
            dragstart: (e) => {
              dragId = cat.id;
              /** @type {DragEvent} */ (e).dataTransfer?.setData('text/plain', cat.id);
            },
            dragover: (e) => {
              const prompts = isPromptDrag(/** @type {DragEvent} */ (e));
              if (!prompts && (!dragId || dragId === cat.id)) return;
              e.preventDefault();
              const de = /** @type {DragEvent} */ (e);
              if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
              /** @type {HTMLElement} */ (e.currentTarget).classList.add('nav__row--drop');
            },
            dragleave: (e) =>
              /** @type {HTMLElement} */ (e.currentTarget).classList.remove('nav__row--drop'),
            drop: (e) => {
              e.preventDefault();
              /** @type {HTMLElement} */ (e.currentTarget).classList.remove('nav__row--drop');
              const de = /** @type {DragEvent} */ (e);
              if (isPromptDrag(de)) {
                void moveTo(draggedIds(de), cat.id);
              } else if (dragId) dropCategory(dragId, cat.id);
              dragId = null;
            },
            dragend: () => (dragId = null),
          },
        },
        h(
          'button',
          {
            type: 'button',
            class: 'nav__item',
            'aria-current':
              route.view === 'category' && route.categoryId === cat.id ? 'page' : 'false',
            on: { click: () => go('category', cat.id) },
          },
          h('span', { class: 'dot', style: { background: cat.color }, 'aria-hidden': 'true' }),
          h('span', { class: 'nav__label' }, `${cat.icon} ${cat.name}`),
          h('span', { class: 'nav__count' }, String(counts.get(cat.id) ?? 0)),
        ),
        h(
          'span',
          { class: 'nav__tools' },
          iconButton('✎', `Edit ${cat.name}`, () => void editCategory(cat)),
          iconButton('✕', `Delete ${cat.name}`, () => void removeCategory(cat), 'icon-btn--danger'),
        ),
      ),
    ),
  );
}

/** Category being dragged in the sidebar. @type {string|null} */
let dragId = null;

/** @param {DragEvent} e */
const isPromptDrag = (e) => Boolean(e.dataTransfer?.types.includes(PROMPTS_DRAG_TYPE));

/**
 * @param {DragEvent} e
 * @returns {string[]}
 */
function draggedIds(e) {
  try {
    const ids = JSON.parse(e.dataTransfer?.getData(PROMPTS_DRAG_TYPE) || '[]');
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Drop `fromId` onto `toId`'s slot.
 * @param {string} fromId
 * @param {string} toId
 */
function dropCategory(fromId, toId) {
  const list = orderedCategories(state.categories);
  const from = list.findIndex((c) => c.id === fromId);
  const to = list.findIndex((c) => c.id === toId);
  if (from !== -1 && to !== -1 && from !== to) reorderCategory(fromId, to - from);
}

/**
 * @param {string} glyph
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [extraClass]
 */
function iconButton(glyph, label, onClick, extraClass = '') {
  return h(
    'button',
    {
      type: 'button',
      class: `icon-btn ${extraClass}`.trim(),
      title: label,
      'aria-label': label,
      on: {
        click: (e) => {
          e.stopPropagation();
          onClick();
        },
      },
    },
    glyph,
  );
}

/* ------------------------------------------------------------------ */
/* Category CRUD                                                       */
/* ------------------------------------------------------------------ */

async function addCategory() {
  const draft = await categoryEditor();
  if (!draft) return;
  const id = crypto.randomUUID();
  await save({ categories: upsertCategory(state.categories, draft, { id }) });
  go('category', id);
}

/** @param {Category} cat */
async function editCategory(cat) {
  const list = orderedCategories(state.categories);
  const position = list.findIndex((c) => c.id === cat.id);
  const draft = await categoryEditor(cat, { position, total: list.length });
  if (!draft) return;
  let categories = upsertCategory(state.categories, draft, { id: cat.id });
  if (draft.position !== undefined && draft.position !== position) {
    categories = moveCategory(categories, cat.id, draft.position - position);
  }
  await save({ categories });
}

/** @param {Category} cat */
async function removeCategory(cat) {
  const count = state.prompts.filter((p) => p.categoryId === cat.id).length;
  const ok = await confirmDialog(
    `Delete “${cat.name}”?`,
    count > 0
      ? `Its ${count} prompt${count === 1 ? '' : 's'} will stay in your library, uncategorized.`
      : 'This category is empty.',
    { confirmLabel: 'Delete', danger: true },
  );
  if (!ok) return;
  await save(deleteCategory({ prompts: state.prompts, categories: state.categories }, cat.id));
  if (route.categoryId === cat.id) go('all');
}

/**
 * @param {string} id
 * @param {number} delta
 */
function reorderCategory(id, delta) {
  void save({ categories: moveCategory(state.categories, id, delta) });
}

/* ------------------------------------------------------------------ */
/* Prompt grid                                                         */
/* ------------------------------------------------------------------ */

function renderLibrary() {
  const prompts = viewPrompts(state.prompts, {
    view: route.view,
    categoryId: route.categoryId,
    query: searchEl.value,
    sortBy: state.settings.sortBy,
  });
  visibleIds = prompts.map((p) => p.id);
  selection = pruneSelection(selection, visibleIds);
  const category = state.categories.find((c) => c.id === route.categoryId);
  const heading =
    route.view === 'category' && category
      ? `${category.icon} ${category.name}`
      : (NAV.find(([v]) => v === route.view)?.[2] ?? 'All prompts');

  const header = h(
    'div',
    { class: 'view__head' },
    h('h1', { class: 'view__title' }, heading),
    h('span', { class: 'muted' }, `${prompts.length} prompt${prompts.length === 1 ? '' : 's'}`),
  );

  if (prompts.length === 0) {
    const query = searchEl.value.trim();
    const message = query
      ? `Nothing matches “${query}”.`
      : route.view === 'favorites'
        ? 'Star a prompt to pin it here.'
        : route.view === 'recent'
          ? 'Prompts you insert or copy show up here.'
          : 'No prompts here yet.';
    mount(
      viewEl,
      header,
      h(
        'div',
        { class: 'empty' },
        h('p', null, message),
        query || route.view === 'favorites' || route.view === 'recent'
          ? null
          : h(
              'button',
              { class: 'btn btn--primary', type: 'button', on: { click: () => void newPrompt() } },
              '+ New prompt',
            ),
      ),
    );
    return;
  }

  mount(
    viewEl,
    header,
    h(
      'div',
      { class: `grid${state.settings.compactMode ? ' grid--compact' : ''}` },
      prompts.map(card),
    ),
  );
}

/** @param {Prompt} prompt */
function card(prompt) {
  const category = state.categories.find((c) => c.id === prompt.categoryId);
  const vars = extractVariables(prompt.text).length;
  const selected = selection.ids.includes(prompt.id);
  return h(
    'article',
    {
      class: `card${selected ? ' card--selected' : ''}`,
      tabindex: '0',
      draggable: 'true',
      'aria-label': prompt.title || 'Untitled',
      dataset: { id: prompt.id },
      on: {
        // Ctrl/Cmd-click toggles, Shift-click extends — on the card body, not its buttons.
        click: (e) => {
          const me = /** @type {MouseEvent} */ (e);
          if (!(me.ctrlKey || me.metaKey || me.shiftKey)) return;
          if (me.target instanceof Element && me.target.closest('button, input, a')) return;
          me.preventDefault();
          if (me.shiftKey) extendTo(prompt.id);
          else toggleOne(prompt.id);
        },
        dragstart: (e) => {
          const de = /** @type {DragEvent} */ (e);
          if (!de.dataTransfer) return;
          const ids = selected ? orderedSelection() : [prompt.id];
          de.dataTransfer.effectAllowed = 'move';
          de.dataTransfer.setData(PROMPTS_DRAG_TYPE, JSON.stringify(ids));
          setDragGhost(de, ids.length);
        },
      },
    },
    // Category eyebrow — redundant inside that category's own view.
    category && route.view !== 'category'
      ? h(
          'button',
          {
            type: 'button',
            class: 'card__eyebrow',
            title: `Open ${category.name}`,
            on: { click: () => go('category', category.id) },
          },
          h('span', { class: 'dot', style: { background: category.color }, 'aria-hidden': 'true' }),
          `${category.icon} ${category.name}`,
        )
      : null,
    h(
      'header',
      { class: 'card__head' },
      h('input', {
        type: 'checkbox',
        class: 'card__check',
        checked: selected,
        'aria-label': `Select ${prompt.title || 'Untitled'}`,
        title: 'Select (Space) · Shift-click for a range',
        on: {
          click: (e) => {
            e.stopPropagation();
            const me = /** @type {MouseEvent} */ (e);
            if (me.shiftKey) extendTo(prompt.id);
            else toggleOne(prompt.id);
          },
        },
      }),
      prompt.createdAt > state.newSince ? h('span', { class: 'chip-new' }, 'New') : null,
      h('h2', { class: 'card__title', title: prompt.title }, prompt.title || 'Untitled'),
      h(
        'button',
        {
          type: 'button',
          class: `star${prompt.isFavorite ? ' star--on' : ''}`,
          'aria-pressed': String(prompt.isFavorite),
          'aria-label': prompt.isFavorite ? 'Remove from favorites' : 'Add to favorites',
          title: prompt.isFavorite ? 'Unfavorite' : 'Favorite',
          on: { click: () => void save({ prompts: toggleFavorite(state.prompts, prompt.id) }) },
        },
        prompt.isFavorite ? '★' : '☆',
      ),
    ),
    h('p', { class: 'card__text' }, prompt.text),
    h(
      'div',
      { class: 'card__meta' },
      vars > 0 ? h('span', { class: 'badge' }, `⚡ ${vars} var${vars === 1 ? '' : 's'}`) : null,
      chipsFor(prompt.tags).map((tag) => h('span', { class: 'chip' }, tag)),
      h(
        'span',
        { class: 'card__stats' },
        `${prompt.useCount} use${prompt.useCount === 1 ? '' : 's'} · ${relativeTime(prompt.lastUsedAt ?? prompt.createdAt)}`,
      ),
    ),
    h(
      'footer',
      { class: 'card__actions' },
      h(
        'button',
        {
          class: 'btn btn--primary btn--sm',
          type: 'button',
          on: { click: () => void usePrompt(prompt, 'insert') },
        },
        'Insert',
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => void usePrompt(prompt, 'append') },
        },
        'Append',
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => void usePrompt(prompt, 'copy') },
        },
        'Copy',
      ),
      h('span', { class: 'spacer' }),
      prompt.versions?.length
        ? iconButton(
            '🕘',
            `History of ${prompt.title} (${prompt.versions.length})`,
            () => void showHistory(prompt.id),
          )
        : null,
      prompt.composition
        ? iconButton('🎛', `Open ${prompt.title} in Composer`, () => {
            openComposition(/** @type {any} */ (prompt.composition), prompt.title);
            go('compose');
          })
        : null,
      iconButton('✎', `Edit ${prompt.title}`, () => void editPrompt(prompt)),
      iconButton(
        '🗑',
        `Delete ${prompt.title}`,
        () => void deletePrompt(prompt),
        'icon-btn--danger',
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Prompt CRUD                                                         */
/* ------------------------------------------------------------------ */

/** @param {Partial<import('./library.js').PromptDraft>} [initial] */
export async function newPrompt(initial = {}) {
  const draft = await promptEditor({
    initial: { categoryId: route.view === 'category' ? route.categoryId : null, ...initial },
    categories: state.categories,
  });
  // A new prompt has no history, so the editor can't hand off to it here.
  if (!draft || draft === OPEN_HISTORY) return false;
  await save({ prompts: upsertPrompt(state.prompts, draft, { id: crypto.randomUUID() }) });
  toast(`Added “${draft.title.trim()}”.`);
  return true;
}

/** @param {Prompt} prompt */
async function editPrompt(prompt) {
  const draft = await promptEditor({ prompt, categories: state.categories });
  if (draft === OPEN_HISTORY) return showHistory(prompt.id);
  if (draft) await save({ prompts: upsertPrompt(state.prompts, draft, { id: prompt.id }) });
}

/** @param {string} id — G5 version history; restore is itself undoable. */
async function showHistory(id) {
  const prompt = state.prompts.find((p) => p.id === id);
  if (!prompt?.versions?.length) return toast('No earlier versions yet.');
  const index = await historyModal(prompt);
  if (index === null) return;
  const when = relativeTime(prompt.versions[index].editedAt);
  await save({ prompts: restoreVersion(state.prompts, id, index) });
  toast(`Restored the version from ${when}. Your previous text is in History.`);
}

/** @param {Prompt} prompt — immediate delete with a 10s undo (no confirm friction). */
async function deletePrompt(prompt) {
  const { prompts, removed, index } = removePrompt(state.prompts, prompt.id);
  if (!removed) return;
  await save({ prompts });
  toast(`Deleted “${removed.title}”.`, 'info', {
    actionLabel: 'Undo',
    ms: 10_000,
    onAction: () => void save({ prompts: restorePrompt(state.prompts, removed, index) }),
  });
}

/* ------------------------------------------------------------------ */
/* G4: selection + bulk operations                                     */
/* ------------------------------------------------------------------ */

/** @type {import('./library.js').Selection} */
let selection = clearSelection();
/** Ids selected before the current Shift range began. @type {string[]} */
let rangeBase = [];
/** Grid order of the library view on screen. @type {string[]} */
let visibleIds = [];

/** Selected ids in grid order (what Copy/Export/drag use). */
function orderedSelection() {
  const set = new Set(selection.ids);
  return visibleIds.filter((id) => set.has(id));
}

/** @param {import('./library.js').Selection} next */
function setSelection(next) {
  selection = next;
  render();
}

/** @param {string} id */
function toggleOne(id) {
  const next = toggleSelection(selection, id);
  rangeBase = next.ids.filter((x) => x !== id);
  setSelection(next);
}

/** @param {string} id */
function extendTo(id) {
  if (selection.anchor === null) return toggleOne(id);
  setSelection(rangeSelection(selection, id, visibleIds, rangeBase));
}

function clearAll() {
  rangeBase = [];
  setSelection(clearSelection());
}

/**
 * @param {string[]} ids
 * @param {string|null} categoryId
 */
async function moveTo(ids, categoryId) {
  if (ids.length === 0) return;
  await save({ prompts: bulkMove(state.prompts, ids, categoryId) });
  const cat = state.categories.find((c) => c.id === categoryId);
  toast(
    `Moved ${promptsLabel(ids.length)} to ${cat ? `${cat.icon} ${cat.name}` : 'Uncategorized'}.`,
  );
}

async function bulkMoveDialog() {
  const ids = orderedSelection();
  const target = await moveDialog(
    state.categories,
    ids.length,
    route.view === 'category' ? route.categoryId : null,
  );
  if (target !== null) await moveTo(ids, target || null);
}

async function bulkTagDialog() {
  const ids = orderedSelection();
  const change = await tagDialog(state.prompts, ids);
  if (!change) return;
  await save({ prompts: bulkTag(state.prompts, ids, change.add, change.remove) });
  const parts = [
    change.add.length ? `added ${change.add.join(', ')}` : '',
    change.remove.length ? `removed ${change.remove.join(', ')}` : '',
  ].filter(Boolean);
  toast(`Tags ${parts.join(' · ')} on ${promptsLabel(ids.length)}.`);
}

async function bulkDelete() {
  const ids = orderedSelection();
  if (ids.length === 0) return;
  const { prompts, removed } = removeMany(state.prompts, ids);
  rangeBase = [];
  selection = clearSelection();
  await save({ prompts });
  toast(`Deleted ${promptsLabel(removed.length)}.`, 'info', {
    actionLabel: 'Undo',
    ms: 10_000,
    onAction: () => {
      selection = { ids: removed.map((r) => r.prompt.id), anchor: null };
      void save({ prompts: restoreMany(state.prompts, removed) });
    },
  });
}

/** G13: download the selection as a `.prompty` pack. */
async function sharePack() {
  const ids = orderedSelection();
  if (ids.length === 0) return;
  const category =
    route.view === 'category' ? state.categories.find((c) => c.id === route.categoryId) : null;
  const meta = await packDialog(ids.length, category ? `${category.name} kit` : '');
  if (!meta) return;
  const pack = buildPack({ prompts: state.prompts, categories: state.categories }, ids, meta);
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: packFileName(pack.name) });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Pack “${pack.name}” saved: ${promptsLabel(pack.prompts.length)}.`);
}

/** @type {import('./bulk-ui.js').BulkHandlers} */
const bulkHandlers = {
  move: () => void bulkMoveDialog(),
  tag: () => void bulkTagDialog(),
  favorite: () => void save({ prompts: bulkFavorite(state.prompts, orderedSelection()) }),
  copy: () => void copyText(joinedText(state.prompts, orderedSelection())),
  exportSelected: () =>
    exportLibrary(
      selectionLibrary(
        { prompts: state.prompts, categories: state.categories },
        orderedSelection(),
      ),
    ),
  pack: () => void sharePack(),
  remove: () => void bulkDelete(),
  selectAll: () => setSelection(selectAllVisible(visibleIds)),
  clear: clearAll,
};

/** Toolbar ↔ bulk bar, after the grid has rendered. */
function renderChrome() {
  const ids = orderedSelection();
  const selecting = isLibraryView() && ids.length > 0;
  document.body.classList.toggle('selecting', selecting);
  toolbarEl.hidden = selecting;
  bulkbarEl.hidden = !selecting;
  if (!selecting) return;
  const chosen = state.prompts.filter((p) => ids.includes(p.id));
  renderBulkBar(
    bulkbarEl,
    {
      count: ids.length,
      visible: visibleIds.length,
      allFavorite: chosen.every((p) => p.isFavorite),
    },
    bulkHandlers,
  );
}

const isLibraryView = () => !['snippets', 'settings', 'compose'].includes(route.view);

/**
 * Columns in the grid right now (cards sharing the first card's top edge).
 * @param {HTMLElement[]} cards
 */
function gridColumns(cards) {
  const top = cards[0]?.offsetTop;
  const n = cards.filter((c) => c.offsetTop === top).length;
  return Math.max(1, n);
}

/**
 * Grid keyboard (G4 DoD): Space toggles, arrows move, Shift+arrows extend,
 * Ctrl/Cmd+A selects visible, Delete deletes (undoable), Esc clears.
 * @param {KeyboardEvent} e
 * @param {boolean} typing focus is in a text field
 * @returns {boolean} handled
 */
function onGridKey(e, typing) {
  const mod = e.ctrlKey || e.metaKey;
  if (typing) return false;
  if (mod && e.key.toLowerCase() === 'a') {
    setSelection(selectAllVisible(visibleIds));
    return true;
  }
  if (e.key === 'Escape' && selection.ids.length > 0) {
    clearAll();
    return true;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection.ids.length > 0) {
    void bulkDelete();
    return true;
  }
  const cardEl = e.target instanceof HTMLElement ? e.target.closest('.card') : null;
  if (!(cardEl instanceof HTMLElement) || e.target !== cardEl) return false;
  const id = cardEl.dataset.id ?? '';
  if (e.key === ' ' && !mod) {
    if (e.shiftKey) extendTo(id);
    else toggleOne(id);
    return true;
  }
  if (e.key === 'Enter' && !mod) {
    const prompt = state.prompts.find((p) => p.id === id);
    if (prompt) void usePrompt(prompt, e.shiftKey ? 'append' : 'insert');
    return true;
  }
  const cards = /** @type {HTMLElement[]} */ ([...viewEl.querySelectorAll('.card')]);
  const cols = gridColumns(cards);
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
  if (step === undefined || mod) return false;
  const at = cards.indexOf(cardEl);
  const next = cards[Math.max(0, Math.min(cards.length - 1, at + step))];
  if (!next || next === cardEl) return true;
  const nextId = next.dataset.id ?? '';
  if (e.shiftKey) {
    // Start a range at the focused card unless one is already anchored in the selection.
    if (selection.anchor === null || !selection.ids.includes(selection.anchor)) {
      rangeBase = selection.ids.filter((x) => x !== id);
      selection = { ids: [...rangeBase, id], anchor: id };
    }
    setSelection(rangeSelection(selection, nextId, visibleIds, rangeBase));
  }
  focusCard(nextId);
  return true;
}

/** @param {string} id */
function focusCard(id) {
  const el = /** @type {HTMLElement|null} */ (
    viewEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`)
  );
  el?.focus();
  el?.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------------ */
/* Render + boot                                                       */
/* ------------------------------------------------------------------ */

function render() {
  // Re-rendering replaces the grid; keep keyboard focus on the same card.
  const active = document.activeElement;
  const focusedCard =
    active instanceof HTMLElement && viewEl.contains(active) ? active.closest('.card') : null;
  const focus =
    focusedCard instanceof HTMLElement
      ? { id: focusedCard.dataset.id ?? '', check: active?.classList.contains('card__check') }
      : null;

  document.body.classList.toggle('compact', state.settings.compactMode);
  renderSidebar();
  const isLibrary = isLibraryView();
  if (!isLibrary) {
    selection = clearSelection();
    visibleIds = [];
  }
  sortEl.disabled = !isLibrary || route.view === 'recent';
  sortEl.value = state.settings.sortBy;
  searchEl.placeholder =
    route.view === 'snippets' ? 'Search snippets…  ( / )' : 'Search title, text, tags…  ( / )';
  searchEl.disabled = route.view === 'settings' || route.view === 'compose';
  if (route.view === 'snippets') renderSnippets(viewEl, searchEl.value, { newPrompt });
  else if (route.view === 'settings') renderSettings(viewEl);
  else if (route.view === 'compose') renderCompose(viewEl);
  else renderLibrary();
  renderChrome();

  if (focus) {
    const card = viewEl.querySelector(`.card[data-id="${CSS.escape(focus.id)}"]`);
    const target = focus.check ? card?.querySelector('.card__check') : card;
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }
}

mount(
  sortEl,
  SORT_OPTIONS.map((o) => h('option', { value: o.id }, o.label)),
);
sortEl.addEventListener('change', () => {
  void save({ settings: { sortBy: /** @type {any} */ (sortEl.value) } });
});
searchEl.addEventListener('input', render);
$('new-prompt').addEventListener('click', () => void newPrompt());
$('add-category').addEventListener('click', () => void addCategory());

const paletteHost = {
  /** @param {string} id */
  goCategory: (id) => go('category', id),
  /** @param {string} id */
  showHistory: (id) => void showHistory(id),
  goCompose: () => go('compose'),
  exportLibrary,
};
$('open-palette').addEventListener('click', () => openPalette(paletteHost));

// G11/G13: drop a pack or a file from another tool anywhere on the popup to import it.
/** @param {DragEvent} e */
const isFileDrag = (e) => Boolean(e.dataTransfer?.types.includes('Files'));
document.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('dropping');
});
document.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  document.body.classList.remove('dropping');
  const file = e.dataTransfer?.files?.[0];
  if (file) void migrateFrom(file);
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.backdrop')) return; // a modal or the palette owns the keyboard
  const typing =
    e.target instanceof HTMLElement &&
    e.target.closest('input:not([type=checkbox]), textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette(paletteHost);
  } else if (e.key === '/' && !typing) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
  } else if (route.view === 'compose') {
    onComposeKey(e);
  } else if (isLibraryView() && onGridKey(e, Boolean(typing))) {
    e.preventDefault();
  } else if (e.key === 'Escape' && e.target === searchEl && searchEl.value) {
    e.preventDefault();
    searchEl.value = '';
    render();
  }
});

// The palette and modals are overlays, so the view underneath can always re-render.
subscribe(render);

load()
  .then(() => {
    const view = state.settings.defaultView;
    route.view = view === 'favorites' || view === 'recent' ? view : 'all';
  })
  .catch(() => toast('Could not load your library.', 'error'))
  .finally(() => {
    render();
    watchStorage();
    searchEl.focus();
  });
