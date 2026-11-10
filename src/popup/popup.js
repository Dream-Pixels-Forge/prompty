/**
 * Popup entry — library shell (SPEC §1): sidebar views + categories CRUD,
 * prompt grid with insert/append/copy/edit/delete/favorite, snippets tab,
 * settings, and the Ctrl/Cmd+K command palette (G2).
 */
import { extractVariables } from '../lib/variables.js';
import { usePrompt } from './actions.js';
import { h, mount } from './dom.js';
import {
  countByCategory,
  deleteCategory,
  moveCategory,
  orderedCategories,
  removePrompt,
  restorePrompt,
  toggleFavorite,
  upsertCategory,
  upsertPrompt,
  viewPrompts,
} from './library.js';
import { SORT_OPTIONS, chipsFor, relativeTime } from './logic.js';
import { categoryEditor, confirmDialog, promptEditor, toast } from './modals.js';
import { exportLibrary, openPalette } from './palette-ui.js';
import { renderSettings } from './settings-view.js';
import { renderSnippets } from './snippets-view.js';
import { load, save, state, subscribe, watchStorage } from './store.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {'all'|'favorites'|'recent'|'category'|'snippets'|'settings'} View
 */

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const navEl = $('nav');
const navBottomEl = $('nav-bottom');
const categoriesEl = $('categories');
const viewEl = $('view');
const searchEl = /** @type {HTMLInputElement} */ ($('search'));
const sortEl = /** @type {HTMLSelectElement} */ ($('sort'));

const route = {
  /** @type {View} */ view: 'all',
  /** @type {string|null} */ categoryId: null,
};

const NAV = /** @type {const} */ ([
  ['all', '◎', 'All prompts'],
  ['favorites', '★', 'Favorites'],
  ['recent', '↺', 'Recently used'],
  ['snippets', '⧉', 'Snippets'],
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
              if (!dragId || dragId === cat.id) return;
              e.preventDefault();
              /** @type {HTMLElement} */ (e.currentTarget).classList.add('nav__row--drop');
            },
            dragleave: (e) =>
              /** @type {HTMLElement} */ (e.currentTarget).classList.remove('nav__row--drop'),
            drop: (e) => {
              e.preventDefault();
              /** @type {HTMLElement} */ (e.currentTarget).classList.remove('nav__row--drop');
              if (dragId) dropCategory(dragId, cat.id);
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
  return h(
    'article',
    { class: 'card', dataset: { id: prompt.id } },
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
  if (!draft) return false;
  await save({ prompts: upsertPrompt(state.prompts, draft, { id: crypto.randomUUID() }) });
  toast(`Added “${draft.title.trim()}”.`);
  return true;
}

/** @param {Prompt} prompt */
async function editPrompt(prompt) {
  const draft = await promptEditor({ prompt, categories: state.categories });
  if (draft) await save({ prompts: upsertPrompt(state.prompts, draft, { id: prompt.id }) });
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
/* Render + boot                                                       */
/* ------------------------------------------------------------------ */

function render() {
  document.body.classList.toggle('compact', state.settings.compactMode);
  renderSidebar();
  const isLibrary = route.view !== 'snippets' && route.view !== 'settings';
  sortEl.disabled = !isLibrary || route.view === 'recent';
  sortEl.value = state.settings.sortBy;
  searchEl.placeholder =
    route.view === 'snippets' ? 'Search snippets…  ( / )' : 'Search title, text, tags…  ( / )';
  searchEl.disabled = route.view === 'settings';
  if (route.view === 'snippets') renderSnippets(viewEl, searchEl.value, { newPrompt });
  else if (route.view === 'settings') renderSettings(viewEl);
  else renderLibrary();
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
  exportLibrary,
};
$('open-palette').addEventListener('click', () => openPalette(paletteHost));

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.backdrop')) return; // a modal or the palette owns the keyboard
  const typing =
    e.target instanceof HTMLElement &&
    e.target.closest('input, textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette(paletteHost);
  } else if (e.key === '/' && !typing) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
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
