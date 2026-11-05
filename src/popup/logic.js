/**
 * Popup pure logic — the tested layer behind popup.js (Issue #2).
 * UI DOM code stays thin; all search/sort/import/export behaviour lives here
 * and reuses src/lib/ helpers rather than reimplementing them.
 */
import {
  DEFAULT_SETTINGS,
  mergeById,
  mergeSettings,
  normalizeCategory,
  normalizePrompt,
} from '../lib/storage.js';
import { extractVariables } from '../lib/variables.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('../lib/storage.js').Settings} Settings
 * @typedef {import('../lib/storage.js').LibraryData} LibraryData
 */

/** Sidebar view ids (SPEC §1 + Δ5c snippets tab). */
export const VIEWS = /** @type {const} */ (['all', 'favorites', 'recent', 'snippets', 'settings']);

/** The four SPEC §1 sorts, in the dropdown order shown to the user. */
export const SORT_OPTIONS = [
  { id: 'recent', label: 'Recently used' },
  { id: 'created', label: 'Newest created' },
  { id: 'name', label: 'Name (A→Z)' },
  { id: 'mostUsed', label: 'Most used' },
];

/** 18 category colors (SPEC §1 picker size), first six match the seed presets. */
export const CATEGORY_COLORS = [
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
  '#14b8a6',
  '#f97316',
  '#a855f7',
  '#0ea5e9',
  '#eab308',
  '#22c55e',
  '#f43f5e',
  '#d946ef',
  '#3b82f6',
  '#64748b',
];

/** 24 category emoji options (SPEC §1 picker size). */
export const CATEGORY_EMOJIS = [
  '👤',
  '🏔️',
  '📦',
  '🎨',
  '✨',
  '🎬',
  '💡',
  '🌿',
  '🐾',
  '🔥',
  '💧',
  '🌙',
  '🌞',
  '⚙️',
  '🚀',
  '🎵',
  '🖼️',
  '🧠',
  '❤️',
  '⭐',
  '🍃',
  '🪞',
  '🎯',
  '🧩',
];

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Live search across title, text and tags. Whitespace-separated terms are
 * ANDed; matching is case-insensitive substring. Works on prompts AND on
 * snippets (which expose {title?, text, tags?}) — used by both card search
 * and the snippets tab search. Pure.
 * @template {{ title?: unknown, text?: unknown, tags?: unknown }} T
 * @param {T[]|null|undefined} items
 * @param {string|null|undefined} query
 * @returns {T[]}
 */
export function filterPrompts(items, query) {
  const haystack = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (haystack.length === 0) return asList(items);
  return asList(items).filter((item) => {
    const title = stringOrBlank(item.title).toLowerCase();
    const text = stringOrBlank(item.text).toLowerCase();
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => stringOrBlank(tag).toLowerCase())
      : [];
    const field = `${title} ${text} ${tags.join(' ')}`;
    return haystack.every((term) => field.includes(term));
  });
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

/**
 * Sort prompts per SPEC §1: recent (lastUsedAt ?? createdAt, newest first),
 * created, name (case-insensitive), mostUsed (with recent tiebreak). Pure —
 * returns a new array; unknown ids fall back to the `recent` behaviour.
 * @param {Prompt[]|null|undefined} prompts
 * @param {string|null|undefined} [sortBy]
 * @returns {Prompt[]}
 */
export function sortPrompts(prompts, sortBy) {
  const ordered = [...asList(prompts)];
  /** @param {Prompt} p */
  const recency = (p) => p.lastUsedAt ?? p.createdAt ?? 0;
  switch (sortBy) {
    case 'created':
      ordered.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      break;
    case 'name':
      ordered.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      break;
    case 'mostUsed':
      ordered.sort(
        (a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || recency(b) - recency(a),
      );
      break;
    case 'recent':
    default:
      ordered.sort((a, b) => recency(b) - recency(a));
      break;
  }
  return ordered;
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * "⚡ N vars" badge count — reuses lib/variables extraction (no re-implementing).
 * @param {string|null|undefined} text
 * @returns {number}
 */
export function varCount(text) {
  return extractVariables(typeof text === 'string' ? text : '').length;
}

/**
 * At most 2 tag chips per card (SPEC §1). Pure.
 * @param {string[]|null|undefined} tags
 * @returns {string[]}
 */
export function chipsFor(tags) {
  const list = Array.isArray(tags) ? tags.slice(0, 2) : [];
  return list.filter((tag) => stringOrBlank(tag) !== '');
}

/**
 * Relative date label: just now / Xm ago / Xh ago / Xd ago / absolute date.
 * @param {number|null|undefined} timestamp ms epoch
 * @param {number} [now] injectable for tests
 * @returns {string}
 */
export function relativeTime(timestamp, now = Date.now()) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '—';
  const delta = Math.max(0, now - timestamp); // future stamps label as "just now"
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (delta < minute) return 'just now';
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  if (delta < day * 7) return `${Math.floor(delta / day)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/* ------------------------------------------------------------------ */
/* Export / import (SPEC §1 + SECURITY.md whitelist rules)             */
/* ------------------------------------------------------------------ */

/**
 * Build the SPEC §1 export envelope {version, exportedAt, prompts, categories, settings}.
 * @param {{ prompts?: Prompt[], categories?: Category[], settings?: unknown }} library
 * @param {{ version?: string, now?: number }} [options]
 * @returns {{ version: string, exportedAt: number, prompts: Prompt[], categories: Category[], settings: Settings }}
 */
export function buildExport(library, { version = '0.1.0', now = Date.now() } = {}) {
  return {
    version,
    exportedAt: now,
    prompts: asList(library?.prompts),
    categories: asList(library?.categories),
    settings:
      library?.settings && typeof library.settings === 'object'
        ? mergeSettings(DEFAULT_SETTINGS, /** @type {any} */ (library.settings))
        : mergeSettings(DEFAULT_SETTINGS, null),
  };
}

/**
 * Parse an import file into validated envelope data. Rejects non-JSON, arrays,
 * envelopes without at least one of prompts/categories, and wrong-typed arrays.
 * Security: validation only — normalization happens in {@link applyImportData}
 * via the storage.js normalizers, and settings adopt through the whitelist merge.
 * @param {string} jsonText raw file content
 * @returns {{ ok: true, data: { prompts?: unknown[], categories?: unknown[], settings?: Record<string, unknown> } } | { ok: false, error: string }}
 */
export function parseImport(jsonText) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Not an export file (expected a JSON object).' };
  }
  const record = /** @type {Record<string, unknown>} */ (parsed);
  const hasData = 'prompts' in record || 'categories' in record;
  if (!hasData) {
    return { ok: false, error: 'Export file has no prompts or categories.' };
  }
  if ('prompts' in record && !Array.isArray(record.prompts)) {
    return { ok: false, error: 'Field "prompts" must be an array.' };
  }
  if ('categories' in record && !Array.isArray(record.categories)) {
    return { ok: false, error: 'Field "categories" must be an array.' };
  }
  if ('settings' in record && !isRecord(record.settings)) {
    return { ok: false, error: 'Field "settings" must be an object.' };
  }
  return { ok: true, data: /** @type {any} */ (record) };
}

/**
 * Apply parsed import data in REPLACE or MERGE mode (SPEC §1: import = REPLACE
 * (OK) or MERGE by id (Cancel)). Pure — reuses storage.js normalizers so no
 * untrusted key ever merges generically (SECURITY.md).
 * @param {{ prompts?: unknown[], categories?: unknown[], settings?: unknown }|null} data validated envelope data
 * @param {{ prompts?: Prompt[], categories?: Category[], settings?: unknown }|null|undefined} library current library
 * @param {'replace'|'merge'} mode
 * @returns {{ prompts: Prompt[], categories: Category[], settings: Settings }}
 */
export function applyImportData(data, library, mode) {
  const dataRecord = isRecord(data) ? data : {};
  const incomingPrompts = Array.isArray(dataRecord.prompts) ? dataRecord.prompts : [];
  const incomingCategories = Array.isArray(dataRecord.categories) ? dataRecord.categories : [];

  /** @type {Prompt[]} */
  const incomingPromptsNormalized = [];
  for (const raw of incomingPrompts) {
    const normalized = normalizePrompt(raw);
    if (normalized) incomingPromptsNormalized.push(normalized);
  }
  /** @type {Category[]} */
  const incomingCategoriesNormalized = [];
  for (const raw of incomingCategories) {
    const normalized = normalizeCategory(raw);
    if (normalized) incomingCategoriesNormalized.push(normalized);
  }
  const incoming = {
    prompts: incomingPromptsNormalized,
    categories: incomingCategoriesNormalized,
  };

  if (mode === 'replace') {
    return {
      prompts: incoming.prompts,
      categories: incoming.categories,
      settings: mergeSettings(DEFAULT_SETTINGS, isRecord(dataRecord.settings) ? dataRecord.settings : null),
    };
  }

  const existingPrompts = asList(library?.prompts);
  const existingCategories = asList(library?.categories);
  return {
    prompts: mergeById(existingPrompts, incoming.prompts),
    categories: mergeById(existingCategories, incoming.categories),
    settings: mergeSettings(DEFAULT_SETTINGS, isRecord(dataRecord.settings) ? dataRecord.settings : null),
  };
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * @template T
 * @param {T[]|null|undefined} value
 * @returns {T[]}
 */
function asList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} thing
 * @returns {thing is Record<string, unknown>}
 */
function isRecord(thing) {
  return thing !== null && typeof thing === 'object' && !Array.isArray(thing);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringOrBlank(value) {
  return typeof value === 'string' ? value : '';
}
