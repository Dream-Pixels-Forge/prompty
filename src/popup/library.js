/**
 * Library state transitions for the popup screens (pure, immutable, tested).
 * Prompts, categories, recipes and site lists — no DOM, no extension API.
 * Search/sort reuse ./logic.js; nothing here re-implements them.
 */
import { t } from '../lib/i18n.js';
import { getOrigin } from '../lib/sites.js';
import { MAX_VERSIONS } from '../lib/storage.js';
import { filterPrompts, sortPrompts } from './logic.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('../lib/storage.js').Settings} Settings
 * @typedef {import('../lib/storage.js').Recipe} Recipe
 *
 * @typedef {object} PromptDraft
 * @property {string} title
 * @property {string} text
 * @property {string|null} categoryId
 * @property {string[]} tags
 * @property {boolean} [isFavorite]
 */

/** "Recently used" view shows at most this many prompts. */
export const RECENT_LIMIT = 20;
export const MAX_TAGS = 10;
export const MAX_TITLE = 120;

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * Prompts visible for a sidebar view + search + sort.
 * view: 'all' | 'favorites' | 'recent' | 'category' (with categoryId).
 * 'recent' ignores sortBy (it is the recency list by definition).
 * @param {Prompt[]} prompts
 * @param {{ view: string, categoryId?: string|null, query?: string, sortBy?: string }} opts
 * @returns {Prompt[]}
 */
export function viewPrompts(prompts, { view, categoryId = null, query = '', sortBy = 'recent' }) {
  let list = Array.isArray(prompts) ? prompts : [];
  if (view === 'favorites') list = list.filter((p) => p.isFavorite);
  if (view === 'category') list = list.filter((p) => p.categoryId === categoryId);
  if (view === 'recent') {
    list = list.filter((p) => typeof p.lastUsedAt === 'number');
    return filterPrompts(sortPrompts(list, 'recent'), query).slice(0, RECENT_LIMIT);
  }
  return filterPrompts(sortPrompts(list, sortBy), query);
}

/**
 * Prompt count per category id (plus `null` for uncategorized).
 * @param {Prompt[]} prompts
 * @returns {Map<string|null, number>}
 */
export function countByCategory(prompts) {
  /** @type {Map<string|null, number>} */
  const counts = new Map();
  for (const p of prompts) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  return counts;
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

/**
 * Comma-separated tags → unique (case-insensitive), trimmed, ≤ MAX_TAGS.
 * A leading "#" is dropped so "#neon, Neon" is one tag.
 * @param {string} input
 * @returns {string[]}
 */
export function parseTags(input) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const raw of String(input ?? '').split(',')) {
    const tag = raw.trim().replace(/^#+/, '').trim();
    const key = tag.toLowerCase();
    if (tag === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * @param {{ title?: string, text?: string }} draft
 * @returns {{ title?: string, text?: string }} field → message; empty object = valid
 */
export function validatePromptDraft(draft) {
  /** @type {{ title?: string, text?: string }} */
  const errors = {};
  const title = String(draft.title ?? '').trim();
  if (title === '') errors.title = t('titleRequired');
  else if (title.length > MAX_TITLE) errors.title = t('titleTooLong', MAX_TITLE);
  if (String(draft.text ?? '').trim() === '') errors.text = t('textRequired');
  return errors;
}

/**
 * Create (id not in list) or update (id in list) a prompt from a draft.
 * Updates keep createdAt, useCount, lastUsedAt and the opaque aspect/quality.
 * @param {Prompt[]} prompts
 * @param {PromptDraft} draft
 * @param {{ id: string, now?: number }} meta
 * @returns {Prompt[]}
 */
export function upsertPrompt(prompts, draft, { id, now = Date.now() }) {
  const fields = {
    title: draft.title.trim(),
    text: draft.text,
    categoryId: draft.categoryId || null,
    tags: [...draft.tags],
  };
  const existing = prompts.find((p) => p.id === id);
  if (existing) {
    return prompts.map((p) =>
      p.id === id
        ? {
            ...withVersion(p, fields, now),
            ...fields,
            isFavorite: draft.isFavorite ?? p.isFavorite,
          }
        : p,
    );
  }
  return [
    ...prompts,
    {
      id,
      ...fields,
      createdAt: now,
      useCount: 0,
      isFavorite: draft.isFavorite ?? false,
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
    },
  ];
}

/**
 * G5: when title or text changes, keep the previous title/text as the newest
 * version (capped, oldest dropped). Other edits (tags, category, favorite)
 * are not versions.
 * @param {Prompt} prompt
 * @param {{ title: string, text: string }} next
 * @param {number} now
 * @returns {Prompt}
 */
export function withVersion(prompt, next, now) {
  if (prompt.title === next.title && prompt.text === next.text) return prompt;
  const versions = [
    { text: prompt.text, title: prompt.title, editedAt: now },
    ...(prompt.versions ?? []),
  ].slice(0, MAX_VERSIONS);
  return { ...prompt, versions };
}

/**
 * G5: restore a version. The current title/text is saved as a version first,
 * so a restore never loses anything (restoring is itself undoable).
 * @param {Prompt[]} prompts
 * @param {string} id
 * @param {number} index position in that prompt's versions (0 = newest)
 * @param {number} [now]
 * @returns {Prompt[]}
 */
export function restoreVersion(prompts, id, index, now = Date.now()) {
  return prompts.map((p) => {
    const version = p.id === id ? p.versions?.[index] : undefined;
    if (!version) return p;
    const next = { title: version.title || p.title, text: version.text };
    return { ...withVersion(p, next, now), ...next };
  });
}

/**
 * @param {Prompt[]} prompts
 * @param {string} id
 * @returns {Prompt[]}
 */
export function toggleFavorite(prompts, id) {
  return prompts.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p));
}

/**
 * Pure delete returning the removed prompt and its index (for undo).
 * @param {Prompt[]} prompts
 * @param {string} id
 * @returns {{ prompts: Prompt[], removed: Prompt|null, index: number }}
 */
export function removePrompt(prompts, id) {
  const index = prompts.findIndex((p) => p.id === id);
  if (index === -1) return { prompts, removed: null, index: -1 };
  return { prompts: prompts.filter((p) => p.id !== id), removed: prompts[index], index };
}

/**
 * Undo a delete: put the prompt back where it was (unless already present).
 * @param {Prompt[]} prompts
 * @param {Prompt} removed
 * @param {number} index
 * @returns {Prompt[]}
 */
export function restorePrompt(prompts, removed, index) {
  if (prompts.some((p) => p.id === removed.id)) return prompts;
  const next = [...prompts];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, removed);
  return next;
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Category[]} categories
 * @returns {Category[]} sorted by order
 */
export function orderedCategories(categories) {
  return [...categories].sort((a, b) => a.order - b.order);
}

/**
 * Create or rename/recolor a category. New ones go last.
 * @param {Category[]} categories
 * @param {{ name: string, color: string, icon: string }} draft
 * @param {{ id: string }} meta
 * @returns {Category[]}
 */
export function upsertCategory(categories, draft, { id }) {
  const fields = { name: draft.name.trim(), color: draft.color, icon: draft.icon };
  if (categories.some((c) => c.id === id)) {
    return categories.map((c) => (c.id === id ? { ...c, ...fields } : c));
  }
  const order = categories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  return [...categories, { id, ...fields, order }];
}

/**
 * Delete a category; its prompts become uncategorized (never deleted).
 * @param {{ prompts: Prompt[], categories: Category[] }} lib
 * @param {string} id
 * @returns {{ prompts: Prompt[], categories: Category[] }}
 */
export function deleteCategory({ prompts, categories }, id) {
  return {
    categories: categories.filter((c) => c.id !== id),
    prompts: prompts.map((p) => (p.categoryId === id ? { ...p, categoryId: null } : p)),
  };
}

/**
 * Move a category up (-1) or down (+1); orders are renumbered 0..n-1.
 * @param {Category[]} categories
 * @param {string} id
 * @param {number} delta
 * @returns {Category[]}
 */
export function moveCategory(categories, id, delta) {
  const list = orderedCategories(categories);
  const from = list.findIndex((c) => c.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return categories;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return list.map((c, order) => ({ ...c, order }));
}

/* ------------------------------------------------------------------ */
/* Settings: sites + recipes                                           */
/* ------------------------------------------------------------------ */

/**
 * "example.com", "example.com/path" or a full URL → origin ("https://example.com").
 * Returns "" for anything that is not an http(s) origin.
 * @param {string} input
 * @returns {string}
 */
export function normalizeSiteInput(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const origin = getOrigin(withScheme);
  return /^https?:\/\//.test(origin) ? origin : '';
}

/**
 * User recipes that are switched on. The content script reads this list from
 * the top-level `siteRecipes` storage key (built-ins are always merged there).
 * @param {Partial<Settings>} settings
 * @returns {Recipe[]}
 */
export function activeRecipes(settings) {
  const enabled = new Set(settings.enabledRecipes ?? []);
  return (settings.siteRecipes ?? []).filter((r) => enabled.has(r.originPattern));
}

/**
 * Add or replace (same originPattern) a user recipe; new/replaced ones are enabled.
 * @param {Partial<Settings>} settings
 * @param {Recipe} recipe
 * @returns {{ siteRecipes: Recipe[], enabledRecipes: string[] }}
 */
export function upsertRecipe(settings, recipe) {
  const others = (settings.siteRecipes ?? []).filter(
    (r) => r.originPattern !== recipe.originPattern,
  );
  const enabled = new Set(settings.enabledRecipes ?? []);
  enabled.add(recipe.originPattern);
  return { siteRecipes: [...others, recipe], enabledRecipes: [...enabled] };
}

/**
 * @param {Partial<Settings>} settings
 * @param {string} originPattern
 * @returns {{ siteRecipes: Recipe[], enabledRecipes: string[] }}
 */
export function removeRecipe(settings, originPattern) {
  return {
    siteRecipes: (settings.siteRecipes ?? []).filter((r) => r.originPattern !== originPattern),
    enabledRecipes: (settings.enabledRecipes ?? []).filter((p) => p !== originPattern),
  };
}

/**
 * @param {Partial<Settings>} settings
 * @param {string} originPattern
 * @returns {{ enabledRecipes: string[] }}
 */
export function toggleRecipe(settings, originPattern) {
  const enabled = settings.enabledRecipes ?? [];
  return {
    enabledRecipes: enabled.includes(originPattern)
      ? enabled.filter((p) => p !== originPattern)
      : [...enabled, originPattern],
  };
}

/* ------------------------------------------------------------------ */
/* G4: multi-select                                                    */
/* ------------------------------------------------------------------ */

/**
 * Selection of prompt ids in the grid. `ids` keeps the order things were
 * selected in; `anchor` is where a Shift range starts.
 * @typedef {{ ids: string[], anchor: string|null }} Selection
 */

/** @returns {Selection} */
export function clearSelection() {
  return { ids: [], anchor: null };
}

/**
 * Select only `id` (a plain click on a card).
 * @param {string} id
 * @returns {Selection}
 */
export function selectOnly(id) {
  return { ids: [id], anchor: id };
}

/**
 * Add or remove one id; it becomes the range anchor either way.
 * @param {Selection} sel
 * @param {string} id
 * @returns {Selection}
 */
export function toggleSelection(sel, id) {
  const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
  return { ids, anchor: id };
}

/**
 * Shift-click / Shift+arrow: add every visible id between the anchor and `id`
 * (inclusive) to the selection. With no usable anchor it selects just `id`.
 * The anchor stays put, so repeated Shift moves grow or shrink one range.
 * @param {Selection} sel
 * @param {string} id
 * @param {string[]} visibleIds grid order
 * @param {string[]} [base] ids selected before this range started (kept)
 * @returns {Selection}
 */
export function rangeSelection(sel, id, visibleIds, base = []) {
  const to = visibleIds.indexOf(id);
  if (to === -1) return sel;
  const from = sel.anchor === null ? -1 : visibleIds.indexOf(sel.anchor);
  if (from === -1) return { ids: [id], anchor: id };
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const range = visibleIds.slice(lo, hi + 1);
  const ids = [...base.filter((x) => !range.includes(x)), ...range];
  return { ids, anchor: sel.anchor };
}

/**
 * Ctrl/Cmd+A: every visible prompt.
 * @param {string[]} visibleIds
 * @returns {Selection}
 */
export function selectAllVisible(visibleIds) {
  return { ids: [...visibleIds], anchor: visibleIds[0] ?? null };
}

/**
 * Drop ids that are no longer visible (filter/view change, deletes, moves out).
 * Returns the same object when nothing changed.
 * @param {Selection} sel
 * @param {string[]} visibleIds
 * @returns {Selection}
 */
export function pruneSelection(sel, visibleIds) {
  const visible = new Set(visibleIds);
  const ids = sel.ids.filter((id) => visible.has(id));
  const anchor = sel.anchor !== null && visible.has(sel.anchor) ? sel.anchor : null;
  if (ids.length === sel.ids.length && anchor === sel.anchor) return sel;
  return { ids, anchor };
}

/* ------------------------------------------------------------------ */
/* G4: bulk transforms (no versions: title/text never change here)    */
/* ------------------------------------------------------------------ */

/**
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @param {string|null} categoryId null = uncategorized
 * @returns {Prompt[]}
 */
export function bulkMove(prompts, ids, categoryId) {
  const set = new Set(ids);
  const target = categoryId || null;
  return prompts.map((p) =>
    set.has(p.id) && p.categoryId !== target ? { ...p, categoryId: target } : p,
  );
}

/**
 * Add and/or remove tags (case-insensitive, "#" ignored). Added tags keep the
 * spelling given; a prompt never ends up with more than MAX_TAGS.
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @param {string[]} add
 * @param {string[]} [remove]
 * @returns {Prompt[]}
 */
export function bulkTag(prompts, ids, add, remove = []) {
  const set = new Set(ids);
  const adding = parseTags(add.join(','));
  const removing = new Set(parseTags(remove.join(',')).map((t) => t.toLowerCase()));
  return prompts.map((p) => {
    if (!set.has(p.id)) return p;
    const kept = p.tags.filter((t) => !removing.has(t.toLowerCase()));
    const have = new Set(kept.map((t) => t.toLowerCase()));
    const tags = [...kept];
    for (const tag of adding) {
      if (tags.length >= MAX_TAGS) break;
      if (have.has(tag.toLowerCase())) continue;
      have.add(tag.toLowerCase());
      tags.push(tag);
    }
    const same = tags.length === p.tags.length && tags.every((t, i) => t === p.tags[i]);
    return same ? p : { ...p, tags };
  });
}

/**
 * Favorite or unfavorite many. Without `value`: if every selected prompt is
 * already a favorite they are all unfavorited, otherwise all are favorited.
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @param {boolean} [value]
 * @returns {Prompt[]}
 */
export function bulkFavorite(prompts, ids, value) {
  const set = new Set(ids);
  const chosen = prompts.filter((p) => set.has(p.id));
  const next = value ?? !(chosen.length > 0 && chosen.every((p) => p.isFavorite));
  return prompts.map((p) =>
    set.has(p.id) && p.isFavorite !== next ? { ...p, isFavorite: next } : p,
  );
}

/**
 * Delete many; each removed prompt remembers its index in the original list.
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @returns {{ prompts: Prompt[], removed: { prompt: Prompt, index: number }[] }}
 */
export function removeMany(prompts, ids) {
  const set = new Set(ids);
  /** @type {{ prompt: Prompt, index: number }[]} */
  const removed = [];
  prompts.forEach((prompt, index) => {
    if (set.has(prompt.id)) removed.push({ prompt, index });
  });
  return { prompts: prompts.filter((p) => !set.has(p.id)), removed };
}

/**
 * Undo {@link removeMany}: re-insert in ascending original index so the list
 * comes back in exactly its old order. Ids already present are skipped.
 * @param {Prompt[]} prompts
 * @param {{ prompt: Prompt, index: number }[]} removed
 * @returns {Prompt[]}
 */
export function restoreMany(prompts, removed) {
  const present = new Set(prompts.map((p) => p.id));
  const next = [...prompts];
  for (const { prompt, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (present.has(prompt.id)) continue;
    present.add(prompt.id);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, prompt);
  }
  return next;
}

/**
 * Prompts for `ids`, in the order given (grid order for the bulk bar).
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @returns {Prompt[]}
 */
export function pickPrompts(prompts, ids) {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p) => p !== undefined);
}

/**
 * Bulk Copy: texts joined by a blank line. Variables stay as {tokens}.
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @returns {string}
 */
export function joinedText(prompts, ids) {
  return pickPrompts(prompts, ids)
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Bulk Export payload: the chosen prompts plus only the categories they use.
 * No settings, so importing it never touches the importer's preferences.
 * @param {{ prompts: Prompt[], categories: Category[] }} lib
 * @param {string[]} ids
 * @returns {{ prompts: Prompt[], categories: Category[] }}
 */
export function selectionLibrary({ prompts, categories }, ids) {
  const chosen = pickPrompts(prompts, ids);
  const used = new Set(chosen.map((p) => p.categoryId));
  return { prompts: chosen, categories: categories.filter((c) => used.has(c.id)) };
}

/**
 * Tags used by the chosen prompts with how many of them carry each
 * (case-insensitive; first spelling wins), most common first.
 * @param {Prompt[]} prompts
 * @param {string[]} ids
 * @returns {{ tag: string, count: number }[]}
 */
export function tagsInSelection(prompts, ids) {
  /** @type {Map<string, { tag: string, count: number }>} */
  const tally = new Map();
  for (const p of pickPrompts(prompts, ids)) {
    for (const tag of p.tags) {
      const key = tag.toLowerCase();
      const entry = tally.get(key) ?? { tag, count: 0 };
      entry.count += 1;
      tally.set(key, entry);
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
