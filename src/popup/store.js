/**
 * Popup state + persistence. One in-memory copy of the library, written back
 * through lib/storage.js (whitelisted settings, normalized prompts). Changes
 * from elsewhere (content script, background, another popup) arrive through
 * storage.onChanged and re-render the UI (SPEC §1 live sync).
 */
import browser from '../lib/browser.js';
import { seedPresets } from '../lib/presets.js';
import { DEFAULT_SETTINGS, readAll, writeAll } from '../lib/storage.js';
import { secureArea } from '../lib/secure.js';
import { VaultLockedError } from '../lib/secure-store.js';
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
  /** G6 fill-in memory (`variableMemory` storage key). @type {import('../lib/variables.js').VariableMemory} */
  variableMemory: {},
  /** Prompts created after this moment get a "New" chip (previous popup open). */
  newSince: Infinity,
  /** G10: 'off' | 'locked' | 'unlocked' | 'unsupported'. While 'locked' the UI shows the lock screen. */
  vault: /** @type {import('../lib/secure-store.js').VaultStatus} */ ('off'),
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
  state.vault = await secureArea().status();
  if (state.vault === 'locked') return emit(); // lock screen; unlock() continues the load
  try {
    await seedPresets(secureArea());
  } catch {
    // seeding is best-effort; an empty library still renders
  }
  // "New" = created since the popup was last opened (first open: nothing is new).
  // G12: the library read starts now, alongside the bookkeeping, not after it.
  const library = reload();
  const seen = await browser.storage.local.get(['popupSeenAt']);
  state.newSince = typeof seen.popupSeenAt === 'number' ? seen.popupSeenAt : Infinity;
  await browser.storage.local.set({ popupSeenAt: Date.now() });
  await library;
  emit(); // newSince may have arrived after the first paint
}

/** Storage keys whose changes never affect what the popup shows (G12: skip the re-read). */
const IGNORED_KEYS = ['popupSeenAt', 'composerTargets', 'vault_composerDraft', 'composerDraft'];
/** @param {string} key */
const ignorable = (key) => IGNORED_KEYS.includes(key) || key.startsWith('widgetPositions:');

/**
 * G10: unlock the vault, then finish loading.
 * @param {string} passphrase
 * @returns {Promise<boolean>} false = wrong passphrase
 */
export async function unlock(passphrase) {
  if (!(await secureArea().unlock(passphrase))) return false;
  await load();
  return true;
}

/** G10: lock now (drops the in-memory key) and show the lock screen. */
export async function lockVault() {
  await secureArea().lock();
  state.vault = 'locked';
  state.prompts = [];
  state.snippets = [];
  state.variableMemory = {};
  emit();
}

/** Re-read the vault status (after enabling/disabling it from Settings). */
export async function refreshVault() {
  state.vault = await secureArea().status();
  if (state.vault === 'locked') return lockVault();
  await reload();
}

async function reload() {
  let lib;
  /** @type {Record<string, any>} */
  let raw;
  try {
    lib = await readAll(secureArea());
    raw = await secureArea().get(['snippets', 'variableMemory']);
  } catch (error) {
    if (error instanceof VaultLockedError) return lockVault(); // idle-locked meanwhile
    throw error;
  }
  state.prompts = lib.prompts;
  state.categories = lib.categories;
  state.settings = lib.settings;
  state.snippets = Array.isArray(raw.snippets) ? raw.snippets : [];
  state.variableMemory =
    raw.variableMemory &&
    typeof raw.variableMemory === 'object' &&
    !Array.isArray(raw.variableMemory)
      ? raw.variableMemory
      : {};
  emit();
}

/**
 * Persist any subset. Settings writes also mirror active user recipes to the
 * top-level `siteRecipes` key that the content script reads.
 * @param {{ prompts?: Prompt[], categories?: Category[], settings?: Partial<Settings>, snippets?: Snippet[], variableMemory?: import('../lib/variables.js').VariableMemory }} patch
 */
export async function save(patch) {
  if (patch.prompts) state.prompts = patch.prompts;
  if (patch.categories) state.categories = patch.categories;
  if (patch.settings) state.settings = { ...state.settings, ...patch.settings };
  if (patch.snippets) state.snippets = patch.snippets;
  if (patch.variableMemory) state.variableMemory = patch.variableMemory;
  emit();
  try {
    await persist(patch);
  } catch (error) {
    if (error instanceof VaultLockedError) return lockVault();
    throw error;
  }
}

/** @param {Parameters<typeof save>[0]} patch */
async function persist(patch) {
  await writeAll(secureArea(), {
    prompts: patch.prompts,
    categories: patch.categories,
    settings: patch.settings ? state.settings : undefined,
  });
  /** @type {Record<string, unknown>} */
  const extra = {};
  if (patch.snippets) extra.snippets = patch.snippets;
  if (patch.variableMemory) extra.variableMemory = patch.variableMemory;
  if (patch.settings) extra.siteRecipes = activeRecipes(state.settings);
  if (Object.keys(extra).length > 0) await secureArea().set(extra);
}

let reloadTimer = 0;
/** Re-read on external changes (debounced; our own writes are idempotent). */
export function watchStorage() {
  browser.storage?.onChanged?.addListener(
    /** @param {Record<string, unknown>} changes @param {string} area */
    (changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes ?? {}).every(ignorable)) return;
      clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => void reload(), 120);
    },
  );
}
