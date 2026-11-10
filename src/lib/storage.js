/**
 * Storage schema helpers (SPEC §1 storage contract) + storage.local wrappers.
 *
 * SECURITY.md rules honored here:
 * - imports are merged only via whitelist/id helpers — never a generic deep merge
 * - prototype-pollution safe: own-property checks only, no spread of untrusted keys
 */
import browser from './browser.js';

/**
 * @typedef {object} Prompt
 * @property {string} id
 * @property {string} title
 * @property {string} text
 * @property {number} createdAt
 * @property {number} useCount
 * @property {boolean} isFavorite
 * @property {string|null} categoryId
 * @property {string[]} tags
 * @property {string|null} aspectRatio
 * @property {string|null} quality
 * @property {number|null} lastUsedAt
 * @property {PromptVersion[]} [versions] previous title/text, newest first (G5; omitted when none)
 */

/**
 * @typedef {object} PromptVersion
 * @property {string} text
 * @property {string} title
 * @property {number} editedAt when this text was replaced
 */

/** History kept per prompt (G5). Oldest versions fall off first. */
export const MAX_VERSIONS = 20;

/**
 * @typedef {object} Category
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} icon
 * @property {number} order
 */

/**
 * @typedef {object} Recipe
 * @property {string} originPattern
 * @property {string[]} promptInput
 * @property {string[]} submit
 * @property {{ aspect: string, quality: string }} selects
 * @property {string[]} qualityValues
 * @property {string} [notes]
 */

/**
 * @typedef {object} Settings
 * @property {'all'|'favorites'|'recent'} defaultView
 * @property {'recent'|'created'|'name'|'mostUsed'} sortBy
 * @property {boolean} compactMode
 * @property {boolean} showFloatingWidget
 * @property {string[]} disabledSites
 * @property {boolean} autoUnlimited
 * @property {Recipe[]} siteRecipes
 * @property {string[]} enabledRecipes originPatterns of user recipes that are active
 * @property {string} quickTrigger single character that opens the in-page palette
 * @property {boolean} quickTriggerEnabled
 */

/**
 * @typedef {object} Snippet
 * @property {string} id
 * @property {string} text
 * @property {string} sourceOrigin
 */

/**
 * @typedef {object} LibraryData
 * @property {Prompt[]} prompts
 * @property {Category[]} categories
 * @property {Settings} settings
 */

/** Allowed settings keys (whitelist). NO generic deep merge — SECURITY.md. */
/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  defaultView: 'all',
  sortBy: 'recent',
  compactMode: false,
  showFloatingWidget: true,
  disabledSites: [],
  autoUnlimited: false,
  siteRecipes: [],
  enabledRecipes: [],
  quickTrigger: '!',
  quickTriggerEnabled: true,
};

/* ------------------------------------------------------------------ */
/* Prompt / category normalization                                     */
/* ------------------------------------------------------------------ */

/**
 * Normalize a raw prompt object (e.g. from import JSON) to the SPEC §1 schema.
 * Non-object inputs return null (caller drops them).
 * @param {unknown} raw
 * @returns {Prompt|null}
 */
export function normalizePrompt(raw) {
  if (!isRecord(raw)) return null;
  return {
    id: stringOr(raw.id) || generateId(),
    title: stringOr(raw.title),
    text: stringOr(raw.text),
    createdAt: numberOr(raw.createdAt, Date.now()),
    useCount: numberOr(raw.useCount, 0),
    isFavorite: boolOr(raw.isFavorite, false),
    categoryId: stringOr(raw.categoryId) || null,
    tags: stringArrayCoerce(raw.tags),
    aspectRatio: stringOr(raw.aspectRatio) || null,
    quality: stringOr(raw.quality) || null,
    lastUsedAt: numberOr(raw.lastUsedAt, null),
    ...versionsOf(raw.versions),
  };
}

/**
 * Whitelist prompt versions: keep entries with string text and a finite
 * editedAt, coerce title to string, cap at MAX_VERSIONS (newest first).
 * Returns `{}` (field omitted) when there is nothing valid.
 * @param {unknown} value
 * @returns {{ versions?: PromptVersion[] }}
 */
function versionsOf(value) {
  if (!Array.isArray(value)) return {};
  /** @type {PromptVersion[]} */
  const versions = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.text !== 'string') continue;
    const editedAt = numberOr(item.editedAt, null);
    if (editedAt === null) continue;
    versions.push({ text: item.text, title: stringOr(item.title), editedAt });
    if (versions.length === MAX_VERSIONS) break;
  }
  return versions.length > 0 ? { versions } : {};
}

/**
 * Normalize a raw category object (id, name, color, icon, order).
 * @param {unknown} raw
 * @returns {Category|null}
 */
export function normalizeCategory(raw) {
  if (!isRecord(raw)) return null;
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
 * MERGE mode: union of both arrays keyed by `id`; incoming wins on collision.
 * Ordering semantics (SPEC §1 import MERGE): existing items NOT overwritten
 * preserve their relative order first; then incoming items (both overwriting
 * and new) follow in their relative order. Duplicate incoming IDs are
 * deduped: last occurrence wins.
 * @template {{ id: unknown }} T
 * @param {T[]|null|undefined} existing
 * @param {T[]|null|undefined} incoming
 * @returns {T[]}
 */
export function mergeById(existing, incoming) {
  const incomingArr = asArray(incoming);
  /** @type {Map<unknown, number>} */
  const incomingLastIndex = new Map();
  for (let i = 0; i < incomingArr.length; i++) {
    incomingLastIndex.set(incomingArr[i].id, i);
  }
  const incomingIds = new Set(incomingLastIndex.keys());
  /** @type {T[]} */
  const result = [];
  // First: existing items that aren't overwritten, in their original order
  for (const item of asArray(existing)) {
    if (!incomingIds.has(item.id)) {
      result.push(item);
    }
  }
  // Then: incoming items (overwrites + new), in their original order (deduped to last occurrence)
  for (let i = 0; i < incomingArr.length; i++) {
    if (incomingLastIndex.get(incomingArr[i].id) === i) {
      result.push(incomingArr[i]);
    }
  }
  return result;
}

/**
 * MERGE mode for preset repair (presets.js): like mergeById, but additionally
 * dedupes on the display signature ("title" for prompts, "name" for categories)
 * so re-seeded v1→v2 data cannot duplicate entries that predate stable ids.
 * @template {{ id: unknown, title?: unknown, name?: unknown }} T
 * @param {T[]|null|undefined} existing
 * @param {T[]|null|undefined} incoming
 * @returns {T[]}
 */
export function mergePresets(existing, incoming) {
  /** @type {Map<unknown, T>} */
  const byId = new Map();
  /** @type {Set<unknown>} */
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

/**
 * REPLACE mode (import): exactly the normalized incoming array — invalid
 * entries dropped, valid ones normalized to the SPEC schema. Defaults to
 * prompt normalization; callers importing categories pass {@link} a normalizer.
 * @param {unknown[]|null|undefined} incoming
 * @param {((raw: unknown) => Prompt|Category|null)} [normalizer]
 * @returns {(Prompt|Category)[]}
 */
export function replaceAll(incoming, normalizer) {
  /** @type {(raw: unknown) => Prompt|Category|null} */
  const normalize = normalizer ?? normalizeAny;
  /** @type {(Prompt|Category)[]} */
  const out = [];
  for (const item of asArray(incoming)) {
    const normalized = normalize(item);
    if (normalized !== null && typeof normalized === 'object') {
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Whitelist merge for settings: only keys of {@link DEFAULT_SETTINGS} are
 * adopted, with per-key type coercion. Never performs a generic/object-value
 * deep merge, never trusts `__proto__`/`constructor` keys, never mutates base.
 * @param {Record<string, unknown>|null|undefined} [base] current settings (may be partial)
 * @param {Record<string, unknown>|null|undefined} [patch] untrusted patch (e.g. import JSON)
 * @returns {Settings}
 */
export function mergeSettings(base, patch) {
  /** @type {Record<string, unknown>} */
  const current = isRecord(base) ? base : /** @type {Record<string, unknown>} */ ({});
  /** @type {Record<string, unknown>} */
  const untrusted = isRecord(patch) ? patch : /** @type {Record<string, unknown>} */ ({});
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const fallback = /** @type {Record<string, unknown>} */ (DEFAULT_SETTINGS)[key];
    if (!hasOwn(untrusted, key)) {
      const valued = hasOwn(current, key) ? current[key] : fallback;
      out[key] = sameKindOr(valued, fallback);
      continue;
    }
    const proposed = untrusted[key];
    if (key === 'disabledSites' || key === 'enabledRecipes') {
      // Strict: only well-formed, non-empty string origins are kept.
      out[key] = Array.isArray(proposed)
        ? proposed.filter((v) => typeof v === 'string' && v.trim() !== '')
        : [];
    } else if (key === 'siteRecipes') {
      // Validate each recipe object
      out[key] = Array.isArray(proposed)
        ? proposed.filter((r) => {
            if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
            const rec = /** @type {{ originPattern?: unknown, promptInput?: unknown, submit?: unknown, selects?: unknown, qualityValues?: unknown }} */ (r);
            return (
              typeof rec.originPattern === 'string' &&
              rec.originPattern.trim() !== '' &&
              Array.isArray(rec.promptInput) &&
              Array.isArray(rec.submit) &&
              rec.selects && typeof rec.selects === 'object' &&
              /** @type {{ aspect?: unknown, quality?: unknown }} */ (rec.selects).aspect !== undefined &&
              /** @type {{ aspect?: unknown, quality?: unknown }} */ (rec.selects).quality !== undefined &&
              Array.isArray(rec.qualityValues)
            );
          })
        : [];
    } else if (key === 'quickTrigger') {
      // Content script requires exactly one non-whitespace character.
      out[key] =
        typeof proposed === 'string' && proposed.length === 1 && proposed.trim() !== ''
          ? proposed
          : fallback;
    } else if (typeof fallback === 'boolean') {
      out[key] = boolOr(proposed, fallback);
    } else {
      out[key] = stringOr(proposed) || fallback;
    }
  }
  return /** @type {Settings} */ (out);
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
 * - caps history at {@link SNIPPET_CAP} by dropping the oldest first
 * @param {Snippet[]|null|undefined} snippets
 * @param {{ text?: unknown, sourceOrigin?: unknown }} data
 * @returns {Snippet[]}
 */
export function appendSnippet(snippets, data) {
  const text = stringOr(data?.text).trim();
  if (text === '') return asArray(snippets);
  const history = asArray(snippets);
  /** @type {Snippet|undefined} */
  const mostRecent = history[history.length - 1];
  if (mostRecent && mostRecent.text === text) return history;
  const next = [
    ...history,
    {
      id: generateId(),
      text,
      sourceOrigin: stringOr(data?.sourceOrigin),
    },
  ];
  const overflow = next.length - SNIPPET_CAP;
  return overflow > 0 ? next.slice(overflow) : next;
}

/* ------------------------------------------------------------------ */
/* storage.local wrappers (default to the browser shim)                */
/* ------------------------------------------------------------------ */

const STORAGE_KEYS = /** @type {const} */ (['prompts', 'categories', 'settings']);

/**
 * Resolve the storage area to use: an injected area (tests, background) or
 * the shared `browser.storage.local`.
 * @param {{ get: Function, set: Function }|undefined} [area]
 * @returns {{ get: Function, set: Function }}
 */
function storageArea(area) {
  const store = area ?? browser?.storage?.local;
  if (!store) throw new Error('Prompty: storage.local is unavailable');
  return store;
}

/**
 * Read and normalize the full library from a storage area.
 * @param {{ get: Function, set: Function }} [area] defaults to browser.storage.local
 * @returns {Promise<LibraryData>}
 */
export async function readAll(area) {
  const store = storageArea(area);
  /** @type {Record<string, unknown>} */
  const raw = await store.get([...STORAGE_KEYS]);
  /** @type {unknown[]} */
  const rawPrompts = Array.isArray(raw.prompts) ? raw.prompts : [];
  /** @type {unknown[]} */
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  /** @type {Prompt[]} */
  const prompts = [];
  for (const item of rawPrompts) {
    const normalized = normalizePrompt(item);
    if (normalized) prompts.push(normalized);
  }
  /** @type {Category[]} */
  const categories = [];
  for (const item of rawCategories) {
    const normalized = normalizeCategory(item);
    if (normalized) categories.push(normalized);
  }
  const settings = mergeSettings(
    DEFAULT_SETTINGS,
    isRecord(raw.settings) ? raw.settings : null,
  );
  return { prompts, categories, settings };
}

/**
 * Write the library back to a storage area.
 * @param {{ get: Function, set: Function }} [area] defaults to browser.storage.local
 * @param {{ prompts?: Prompt[], categories?: Category[], settings?: unknown }|undefined} [partialData]
 * @returns {Promise<void>}
 */
export async function writeAll(area, partialData) {
  const store = storageArea(area);
  /** @type {Record<string, unknown>} */
  const payload = {};
  if (Array.isArray(partialData?.prompts)) {
    payload.prompts = partialData.prompts.filter((item) => item !== null);
  }
  if (Array.isArray(partialData?.categories)) {
    payload.categories = partialData.categories.filter((item) => item !== null);
  }
  if (partialData && hasOwn(partialData, 'settings') && partialData.settings !== undefined) {
    payload.settings = mergeSettings(
      DEFAULT_SETTINGS,
      isRecord(partialData.settings) ? partialData.settings : null,
    );
  }
  if (Object.keys(payload).length > 0) await store.set(payload);
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * @template T
 * @param {T[]|null|undefined} value
 * @returns {T[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} obj
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function stringOr(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/**
 * @template T
 * @param {unknown} value
 * @param {T} fallback
 * @returns {number|T}
 */
function numberOr(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * @template T
 * @param {unknown} value
 * @param {T} fallback
 * @returns {boolean|T}
 */
function boolOr(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
}

/**
 * Tags: coerce everything string-able, trim, drop empties and duplicates.
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArrayCoerce(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? [] : [trimmed];
  }
  if (!Array.isArray(value)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const entry = stringOr(item).trim();
    if (entry === '' || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/**
 * Keep a value only if it has the same primitive "kind" as the fallback
 * (arrays fall back through the stringArray path).
 * @param {unknown} value
 * @param {unknown} fallback
 * @returns {unknown}
 */
function sameKindOr(value, fallback) {
  if (Array.isArray(fallback)) return stringArrayCoerce(value);
  if (typeof value === typeof fallback && value !== null && value !== undefined) {
    return value;
  }
  return fallback;
}

/**
 * @param {{ title?: unknown, name?: unknown }} item
 * @returns {unknown}
 */
function displaySignature(item) {
  return item.name ?? item.title ?? '';
}

/**
 * @param {unknown} raw
 * @returns {Prompt|Category|null}
 */
function normalizeAny(raw) {
  if (isRecord(raw) && hasOwn(raw, 'name') && hasOwn(raw, 'color')) {
    return normalizeCategory(raw);
  }
  return normalizePrompt(raw);
}

/**
 * Prefer crypto.randomUUID (SECURITY.md); empty string if unavailable.
 * @returns {string}
 */
function generateId() {
  return globalThis.crypto?.randomUUID?.() ?? '';
}
