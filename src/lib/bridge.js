/**
 * G14 — Agent bridge, extension side (pure). An MCP server (`mcp/`) hands the
 * browser prompts over loopback; these helpers guard the URL, validate an
 * untrusted payload, and merge it into the library without mutating it.
 *
 * SECURITY.md: the bridge is loopback-only, every field is whitelisted through
 * the storage normalizers, and a payload can never write an arbitrary key.
 */
import { textKey } from './migrate.js';
import { normalizeCategory, normalizePrompt } from './storage.js';

/** Wire protocol the extension speaks + the default agent address. */
import { BRIDGE_PROTOCOL, DEFAULT_BRIDGE_URL } from './bridge-constants.js';

/** Most prompts one sync may import (a runaway agent cannot flood storage). */
export const MAX_PENDING_PROMPTS = 1000;

/** Longest prompt body the bridge accepts, in characters. */
export const MAX_PENDING_TEXT = 100_000;

/** Fallback category colours when the caller (or a test) passes none. */
const FALLBACK_COLORS = ['#8b5cf6'];

/**
 * @typedef {import('./storage.js').Prompt} Prompt
 * @typedef {import('./storage.js').Category} Category
 *
 * @typedef {object} PendingPrompt
 * @property {string} id
 * @property {string} text
 * @property {string} [title]
 * @property {string[]} [tags]
 * @property {string|null} [categoryId]
 * @property {number} [createdAt]
 * @property {boolean} [isFavorite]
 * @property {string|null} [aspectRatio]
 * @property {string|null} [quality]
 *
 * @typedef {object} PendingCategory
 * @property {string} id
 * @property {string} name
 *
 * @typedef {object} Pending
 * @property {PendingPrompt[]} prompts
 * @property {PendingCategory[]} categories
 * @property {{ id: string }[]} deleted
 *
 * @typedef {object} ApplyResult
 * @property {Prompt[]} prompts
 * @property {Category[]} categories
 * @property {{ added: number, updated: number, skipped: number, removed: number, categoriesAdded: number }} applied
 * @property {string[]} importedIds ids the bridge may acknowledge
 */

/**
 * Accept only a plain loopback `http://` base URL with no credentials, path,
 * query, hash or IPv6 literal. Returns the canonical form (no trailing slash).
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeBridgeUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  if (!/^http:\/\//i.test(raw)) return null;
  /** @type {URL} */
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
  const host = url.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') return null;
  if (!/^\d{1,5}$/.test(url.port)) return null;
  const port = Number(url.port);
  if (port < 1 || port > 65535) return null;
  return `http://${host}:${port}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLoopbackUrl(value) {
  return normalizeBridgeUrl(value) !== null;
}

/**
 * Validate an untrusted `/pending` payload.
 * Batch-level problems (wrong types, oversized text, too many prompts) reject
 * the whole batch; malformed individual entries are dropped.
 * @param {unknown} payload
 * @returns {{ ok: true, data: Pending } | { ok: false, error: string }}
 */
export function validatePending(payload) {
  if (!isRecord(payload)) return { ok: false, error: 'payload is not an object' };

  /** @type {unknown} */
  const rawPrompts = hasOwn(payload, 'prompts') ? payload.prompts : [];
  /** @type {unknown} */
  const rawCategories = hasOwn(payload, 'categories') ? payload.categories : [];
  /** @type {unknown} */
  const rawDeleted = hasOwn(payload, 'deleted') ? payload.deleted : [];

  if (!Array.isArray(rawPrompts)) return { ok: false, error: 'prompts is not an array' };
  if (!Array.isArray(rawCategories)) return { ok: false, error: 'categories is not an array' };
  if (!Array.isArray(rawDeleted)) return { ok: false, error: 'deleted is not an array' };
  if (rawPrompts.length > MAX_PENDING_PROMPTS) {
    return { ok: false, error: `too many prompts (max ${MAX_PENDING_PROMPTS})` };
  }

  /** @type {PendingPrompt[]} */
  const prompts = [];
  for (const entry of rawPrompts) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    if (typeof entry.text !== 'string') continue;
    if (entry.text.length > MAX_PENDING_TEXT) {
      return { ok: false, error: `prompt text too long (max ${MAX_PENDING_TEXT})` };
    }
    if (entry.text.trim() === '') continue;
    if (typeof entry.title === 'string' && entry.title.length > 2000) {
      return { ok: false, error: 'prompt title too long' };
    }
    prompts.push(
      /** @type {PendingPrompt} */ ({
        id: entry.id,
        text: entry.text,
        ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
        ...(Array.isArray(entry.tags) ? { tags: entry.tags.filter(isString) } : {}),
        ...(typeof entry.categoryId === 'string' ? { categoryId: entry.categoryId } : {}),
        ...(typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
          ? { createdAt: entry.createdAt }
          : {}),
        ...(typeof entry.isFavorite === 'boolean' ? { isFavorite: entry.isFavorite } : {}),
        ...(typeof entry.aspectRatio === 'string' ? { aspectRatio: entry.aspectRatio } : {}),
        ...(typeof entry.quality === 'string' ? { quality: entry.quality } : {}),
      }),
    );
  }

  /** @type {PendingCategory[]} */
  const categories = [];
  for (const entry of rawCategories) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    if (typeof entry.name !== 'string' || entry.name.trim() === '') continue;
    categories.push({ id: entry.id, name: entry.name });
  }

  /** @type {{ id: string }[]} */
  const deleted = [];
  for (const entry of rawDeleted) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    deleted.push({ id: entry.id });
  }

  return { ok: true, data: { prompts, categories, deleted } };
}

/**
 * Merge a validated payload into a library snapshot. Pure: the input arrays
 * are never mutated and every added item goes through the storage normalizers.
 * @param {{ prompts: Prompt[], categories: Category[] }} library
 * @param {Pending} pending
 * @param {{ now: number, newId: () => string, colors?: string[] }} options
 * @returns {ApplyResult}
 */
export function applyPending(library, pending, options) {
  const now = options.now;
  const colors = options.colors && options.colors.length > 0 ? options.colors : FALLBACK_COLORS;

  /** @type {Category[]} */
  const categories = library.categories.map((category) => ({ ...category }));
  /** @type {Map<string, string>} server category id → local category id */
  const categoryIdMap = new Map();
  /** @type {Map<string, string>} lowercased name → local category id */
  const byName = new Map();
  /** @type {Set<string>} ids already taken locally */
  const takenIds = new Set();
  for (const category of categories) {
    byName.set(nameKey(category.name), category.id);
    takenIds.add(category.id);
  }

  let categoriesAdded = 0;
  for (const incoming of pending.categories) {
    const key = nameKey(incoming.name);
    const existingId = byName.get(key);
    if (existingId) {
      categoryIdMap.set(incoming.id, existingId);
      continue;
    }
    // A crafted payload could reuse a local category id with a different name;
    // mint a fresh id instead of creating a duplicate local id.
    const id = takenIds.has(incoming.id) ? options.newId() : incoming.id;
    const created =
      normalizeCategory({
        id,
        name: incoming.name.trim(),
        color: colors[categories.length % colors.length],
        order: categories.length,
      }) ?? null;
    if (!created) continue;
    categories.push(created);
    byName.set(key, created.id);
    takenIds.add(created.id);
    categoryIdMap.set(incoming.id, created.id);
    categoriesAdded++;
  }

  /** @type {string[]} */
  const importedIds = [];
  /** @type {Set<string>} */
  const tombstoned = new Set(pending.deleted.map((entry) => entry.id));
  for (const entry of pending.deleted) importedIds.push(entry.id);

  /** @type {Prompt[]} */
  const prompts = library.prompts
    .filter((prompt) => !tombstoned.has(prompt.id))
    .map((prompt) => ({ ...prompt }));
  const removed = library.prompts.length - prompts.length;

  /** @type {Map<string, number>} */
  const indexById = new Map();
  /** @type {Map<string, number>} */
  const indexByText = new Map();
  prompts.forEach((prompt, index) => {
    indexById.set(prompt.id, index);
    const key = textKey(prompt.text);
    if (!indexByText.has(key)) indexByText.set(key, index);
  });

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const incoming of pending.prompts) {
    importedIds.push(incoming.id);
    if (tombstoned.has(incoming.id)) continue;

    const categoryId = remapCategory(incoming.categoryId, categoryIdMap, categories);
    const incomingKey = textKey(incoming.text);

    const byId = indexById.get(incoming.id);
    if (byId !== undefined) {
      const before = prompts[byId];
      prompts[byId] = normalizePrompt({
        ...before,
        title: incoming.title ?? before.title,
        text: incoming.text,
        categoryId,
        tags: incoming.tags ?? before.tags,
        ...(incoming.aspectRatio !== undefined ? { aspectRatio: incoming.aspectRatio } : {}),
        ...(incoming.quality !== undefined ? { quality: incoming.quality } : {}),
        // usage stats and history stay with the local prompt
        useCount: before.useCount,
        isFavorite: before.isFavorite,
        lastUsedAt: before.lastUsedAt,
        createdAt: before.createdAt,
        ...(before.versions ? { versions: before.versions } : {}),
        ...(before.composition ? { composition: before.composition } : {}),
      }) ?? before;
      updated++;
      refreshTextIndex(indexByText, before.text, prompts[byId].text, byId);
      const key = textKey(prompts[byId].text);
      if (!indexByText.has(key)) indexByText.set(key, byId);
      continue;
    }

    if (indexByText.has(incomingKey)) {
      skipped++;
      continue;
    }

    const created = normalizePrompt({
      ...incoming,
      createdAt: incoming.createdAt ?? now,
      categoryId,
      isFavorite: incoming.isFavorite ?? false,
    });
    if (!created) continue;
    prompts.push(created);
    indexById.set(created.id, prompts.length - 1);
    indexByText.set(incomingKey, prompts.length - 1);
    added++;
  }

  return {
    prompts,
    categories,
    applied: { added, updated, skipped, removed, categoriesAdded },
    importedIds,
  };
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {string|null|undefined} serverId
 * @param {Map<string, string>} idMap
 * @param {Category[]} categories
 * @returns {string|null}
 */
function remapCategory(serverId, idMap, categories) {
  if (!serverId) return null;
  const mapped = idMap.get(serverId);
  if (mapped) return mapped;
  return categories.some((category) => category.id === serverId) ? serverId : null;
}

/** @param {string} name */
const nameKey = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * @param {Map<string, number>} index
 * @param {string} before
 * @param {string} after
 * @param {number} position
 */
function refreshTextIndex(index, before, after, position) {
  if (before === after) return;
  const key = textKey(before);
  if (index.get(key) === position) index.delete(key);
}

/** @param {unknown} value @returns {value is string} */
const isString = (value) => typeof value === 'string';

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, unknown>} obj @param {string} key */
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Re-export so the sync client and Settings share one copy.
export { BRIDGE_PROTOCOL, DEFAULT_BRIDGE_URL };
