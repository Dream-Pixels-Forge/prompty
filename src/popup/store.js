/**
 * Popup state + persistence. One in-memory copy of the library, written back
 * through lib/storage.js (whitelisted settings, normalized prompts). Changes
 * from elsewhere (content script, background, another popup) arrive through
 * storage.onChanged and re-render the UI (SPEC §1 live sync).
 */
import browser from '../lib/browser.js';
import { seedPresets } from '../lib/presets.js';
import { DEFAULT_SETTINGS, readAll, writeAll } from '../lib/storage.js';
import { activeRecipes } from './library.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('../lib/storage.js').Settings} Settings
 * @typedef {import('../lib/storage.js').Snippet} Snippet
 */

export const state = {
  /** @type {Prompt[]} */ prompts: [],
  /** @type {Category[]} */ categories: [],
  /** @type {Settings} */ settings: { ...DEFAULT_SETTINGS },
  /** @type {Snippet[]} */ snippets: [],
  /** Prompts created after this moment get a "New" chip (previous popup open). */
  newSince: Infinity,
};

/** @type {Set<() => void>} */
const listeners = new Set();

/** @param {() => void} fn */
export function subscribe(fn) {
  listeners.add(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

/** Load (seeding starter prompts first if this profile has none). */
export async function load() {
  try {
    await seedPresets();
  } catch {
    // seeding is best-effort; an empty library still renders
  }
  // "New" = created since the popup was last opened (first open: nothing is new).
  const seen = await browser.storage.local.get(['popupSeenAt']);
  state.newSince = typeof seen.popupSeenAt === 'number' ? seen.popupSeenAt : Infinity;
  await browser.storage.local.set({ popupSeenAt: Date.now() });
  await reload();
}

async function reload() {
  const lib = await readAll();
  const raw = await browser.storage.local.get(['snippets']);
  state.prompts = lib.prompts;
  state.categories = lib.categories;
  state.settings = lib.settings;
  state.snippets = Array.isArray(raw.snippets) ? raw.snippets : [];
  emit();
}

/**
 * Persist any subset. Settings writes also mirror active user recipes to the
 * top-level `siteRecipes` key that the content script reads.
 * @param {{ prompts?: Prompt[], categories?: Category[], settings?: Partial<Settings>, snippets?: Snippet[] }} patch
 */
export async function save(patch) {
  if (patch.prompts) state.prompts = patch.prompts;
  if (patch.categories) state.categories = patch.categories;
  if (patch.settings) state.settings = { ...state.settings, ...patch.settings };
  if (patch.snippets) state.snippets = patch.snippets;
  emit();
  await writeAll(undefined, {
    prompts: patch.prompts,
    categories: patch.categories,
    settings: patch.settings ? state.settings : undefined,
  });
  /** @type {Record<string, unknown>} */
  const extra = {};
  if (patch.snippets) extra.snippets = patch.snippets;
  if (patch.settings) extra.siteRecipes = activeRecipes(state.settings);
  if (Object.keys(extra).length > 0) await browser.storage.local.set(extra);
}

let reloadTimer = 0;
/** Re-read on external changes (debounced; our own writes are idempotent). */
export function watchStorage() {
  browser.storage?.onChanged?.addListener(
    /** @param {Record<string, unknown>} _changes @param {string} area */
    (_changes, area) => {
      if (area !== 'local') return;
      clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => void reload(), 120);
    },
  );
}
