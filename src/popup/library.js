/**
 * Library state transitions for the popup screens (pure, immutable, tested).
 * Prompts, categories, recipes and site lists — no DOM, no extension API.
 * Search/sort reuse ./logic.js; nothing here re-implements them.
 */
import { getOrigin } from '../lib/sites.js';
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
  if (title === '') errors.title = 'Give the prompt a title.';
  else if (title.length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters.`;
  if (String(draft.text ?? '').trim() === '') errors.text = 'The prompt text is empty.';
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
      p.id === id ? { ...p, ...fields, isFavorite: draft.isFavorite ?? p.isFavorite } : p,
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
