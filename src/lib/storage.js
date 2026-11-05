/**
 * Storage schema helpers (SPEC §1 storage contract) + storage.local wrappers.
 *
 * SECURITY.md rules honored here:
 * - imports are merged only via whitelist/id helpers — never a generic deep merge
 *   (prototype-pollution safe: own-property checks, no recursive spread of untrusted keys)
 */
import browser from './browser.js';

/** Allowed settings keys (whitelist). NO generic deep merge. */
export const DEFAULT_SETTINGS = Object.freeze({
  defaultView: 'all',
  sortBy: 'recent',
  compactMode: false,
  showFloatingWidget: true,
  disabledSites: [],
  autoUnlimited: false,
});

/* ------------------------------------------------------------------ */
/* Prompt / category normalization                                     */
/* ------------------------------------------------------------------ */

/**
 * Normalize a raw prompt object (e.g. from import JSON) to the SPEC §1 schema.
 * Non-object inputs return null (caller drops them).
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizePrompt(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    id: stringOr(raw.id) || generateId(),
    title: stringOr(raw.title),
    text: stringOr(raw.text),
    createdAt: numberOr(raw.createdAt, Date.now()),
    useCount: numberOr(raw.useCount, 0),
    isFavorite: boolOr(raw.isFavorite, false),
    categoryId: stringOr(raw.categoryId) || null,
    tags: stringArrayOr(raw.tags),
    aspectRatio: stringOr(raw.aspectRatio) || null,
    quality: stringOr(raw.quality) || null,
    lastUsedAt: numberOr(raw.lastUsedAt, null),
  };
}

/**
 * Normalize a raw category object (id, name, color, icon, order).
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizeCategory(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    id: stringOr(raw.id) || generateId(),
    name: stringOr(raw.name),
    color: stringOr(raw.color, '#8b5cf6'),
    icon: stringOr(raw.icon, '👤'),
    order: numberOr(raw.order, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Import merge helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * MERGE mode: union of both arrays keyed by `id`; incoming wins on collision
 * (last occurrence of an incoming id wins). Pure. Works for prompts & categories.
 * @template {{ id?: string|null }} T
 * @param {T[]|null|undefined} existing
 * @param {T[]|null|undefined} incoming
 * @returns {T[]}
 */
export function mergeById(existing, incoming) {
  const map = new Map();
  for (const item of asArray(existing)) {
    map.set(item.id, item);
  }
  for (const item of asArray(incoming)) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

/**
 * MERGE mode for preset repair (presets.js): like mergeById, but additionally
 * dedupes on the display signature ("title" for prompts, "name" for categories)
 * so re-seeded v1→v2 data cannot duplicate entries that predate stable ids.
 * @param {object[]|null|undefined} existing normalized items
 * @param {object[]|null|undefined} incoming normalized items
 * @returns {object[]}
 */
export function mergePresets(existing, incoming) {
  const byId = new Map();
  const signature = new Set();
  for (const item of asArray(existing)) {
    byId.set(item.id, item);
    signature.add(displaySignature(item));
  }
  for (const item of asArray(incoming)) {
    if (byId.has(item.id) || signature.has(displaySignature(item))) continue;
    byId.set(item.id, item);
    signature.add(displaySignature(item));
  }
  return [...byId.values()];
}

function displaySignature(item) {
  return item.name ?? item.title ?? '';
}

/**
 * REPLACE mode (import): exactly the normalized incoming array — invalid
 * entries dropped, valid ones normalized to the SPEC schema. Defaults to
 * prompt normalization; callers importing categories pass {@link normalizeCategory}.
 * @template {object} T
 * @param {(unknown)[]|null|undefined} incoming
 * @param {(raw: unknown) => T|null} [normalizer=normalize]
 * @returns {T[]}
 */
export function replaceAll(incoming, normalizer) {
  const normalize = normalizer ?? normalizeAny;
  const out = [];
  for (const item of asArray(incoming)) {
    const n = normalize(item);
    if (n !== null && typeof n === 'object') out.push(n);
  }
  return out;
}

/**
 * Whitelist merge for settings: only keys of {@link DEFAULT_SETTINGS} are adopted,
 * with per-key type coercion. Never performs a generic/object-value deep merge,
 * never trusts `__proto__`/constructor keys, never mutates base.
 * @param {typeof DEFAULT_SETTINGS|object} base current settings (may be partial)
 * @param {object|undefined|null} patch untrusted patch (e.g. import JSON)
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function mergeSettings(base, patch) {
  if (patch === null || typeof patch !== 'object') return mergeSettings(base, {});
  const current = base === null || typeof base !== 'object' ? {} : base;
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const fallback = DEFAULT_SETTINGS[key];
    if (!hasOwn(patch, key)) {
      out[key] = cloneSetting(current[key] ?? fallback, fallback);
      continue;
    }
    const proposed = patch[key];
    if (key === 'disabledSites') {
      // Strict: only well-formed, non-empty string origins are kept.
      out[key] = Array.isArray(proposed)
        ? proposed.filter((v) => typeof v === 'string' && v.trim() !== '')
        : [];
    } else if (typeof fallback === 'boolean') {
      out[key] = boolOr(proposed, fallback);
    } else {
      out[key] = stringOr(proposed) || fallback;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clipboard snippets helpers (Δ5c)                                    */
/* ------------------------------------------------------------------ */

/** Maximum clipboard snippets retained (FIFO). */
export const SNIPPET_CAP = 50;

/**
 * Pure: append a snippet ({id,text,sourceOrigin}) to history.
 * - trims text; whitespace-only text is rejected
 * - dedupes `text` if it matches the most recent entry
 * - caps history at {@link SNIPPET_CAP} oldest-first
 * @param {object[]|null|undefined} snippets
 * @param {{ text?: unknown, sourceOrigin?: unknown }} data
 * @returns {object[]}
 */
export function appendSnippet(snippets, data) {
  const text = stringOr(data && data.text).trim();
  if (text === '') return asArray(snippets);
  const history = asArray(snippets);
  const mostRecent = history[history.length - 1];
  if (mostRecent && mostRecent.text === text) return history;
  const next = [
    ...history,
    {
      id: generateId(),
      text,
      sourceOrigin: stringOr(data && data.sourceOrigin) || '',
    },
  ];
  const overflow = next.length - SNIPPET_CAP;
  return overflow > 0 ? next.slice(overflow) : next;
}

/* ------------------------------------------------------------------ */
/* storage.local wrappers (all default to the browser shim)            */
/* ------------------------------------------------------------------ */

const STORAGE_KEYS = /** @type {const} */ (['prompts', 'categories', 'settings']);

/**
 * Read and normalize the full library from a storage area.
 * @param {{ get: Function, set: Function }|null} [area=browser.storage.local]
 * @returns {Promise<{prompts: object[], categories: object[], settings: object}>}
 */
export async function readAll(area) {
  const store = area ?? browser.storage.local;
  const raw = await store.get([...STORAGE_KEYS]);
  const prompts = asArray(raw.prompts)
    .map(normalizePrompt)
    .filter((p) => p !== null);
  const categories = asArray(raw.categories)
    .map(normalizeCategory)
    .filter((c) => c !== null);
  const settings = mergeSettings(DEFAULT_SETTINGS, raw.settings);
  return { prompts, categories, settings };
}

/**
 * Write the library back to a storage area.
 * @param {{ get: Function, set: Function }|null} [area=browser.storage.local]
 * @param {{ prompts?: object[], categories?: object[], settings?: object }} data
 * @returns {Promise<void>}
 */
export async function writeAll(area, data) {
  const store = area ?? browser.storage.local;
  const payload = {};
  if (Array.isArray(data.prompts)) payload.prompts = data.prompts;
  if (Array.isArray(data.categories)) payload.categories = data.categories;
  if (data.settings !== undefined) {
    payload.settings = mergeSettings(DEFAULT_SETTINGS, data.settings);
  }
  if (Object.keys(payload).length > 0) await store.set(payload);
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function stringOr(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function numberOr(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function boolOr(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
}

function stringArrayOr(value) {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? [] : [t];
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const s = stringOr(item).trim();
    if (s === '' || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function cloneSetting(value, fallback) {
  if (Array.isArray(fallback)) return stringArrayOr(value);
  if (typeof value === typeof fallback) return value;
  return fallback;
}

function generateId() {
  return globalThis.crypto?.randomUUID?.() ?? '';
}

function normalizeAny(raw) {
  if (raw !== null && typeof raw === 'object' && hasOwn(raw, 'name')) {
    return normalizeCategory(raw);
  }
  return normalizePrompt(raw);
}
