/**
 * Seed presets (SPEC §1: 8 generic prompts + 6 categories, global tool).
 * Seeding is idempotent via `presetsInitialized` / `presetsVersion` storage keys.
 */
import browser from './browser.js';
import { mergePresets, normalizeCategory, normalizePrompt } from './storage.js';

/**
 * @typedef {import('./storage.js').Category} Category
 */

/**
 * @typedef {import('./storage.js').Prompt} Prompt
 */

/** Current seed version (v1→v2 history). Bump when seed data changes. */
export const PRESETS_VERSION = 2;

/** 6 categories per SPEC §1 palette (#hex + emoji + order). */
/** @type {Array<import('./storage.js').Category>} */
export const SEED_CATEGORIES = [
  { id: '', name: 'Characters', color: '#8b5cf6', icon: '👤', order: 0 },
  { id: '', name: 'Landscapes', color: '#10b981', icon: '🏔️', order: 1 },
  { id: '', name: 'Objects', color: '#f59e0b', icon: '📦', order: 2 },
  { id: '', name: 'Styles', color: '#ec4899', icon: '🎨', order: 3 },
  { id: '', name: 'Abstract', color: '#6366f1', icon: '✨', order: 4 },
  { id: '', name: 'Camera Angles', color: '#06b6d4', icon: '🎬', order: 5 },
];

/**
 * 8 generic seed prompt definitions (category = SEED_CATEGORIES index).
 * Texts are generic — Prompty works on any site, not only one platform.
 */
/** @type {Array<{title: string, text: string, categoryIndex: number, aspectRatio: string, quality: string}>} */
export const SEED_PROMPT_DEFS = [
  {
    title: 'Full-Body Character Portrait',
    text: 'Full-body portrait of {character}, {outfit}, standing in {environment}, soft rim lighting, sharp focus, highly detailed, professional photography',
    categoryIndex: 0,
    aspectRatio: '2:3',
    quality: 'high',
  },
  {
    title: 'Character Design Sheet',
    text: 'Character design sheet for {character}, multiple views (front, side, back), expression thumbnails, clean lineart, flat colors, neutral background',
    categoryIndex: 0,
    aspectRatio: '1:1',
    quality: 'high',
  },
  {
    title: 'Wide Scenic Landscape',
    text: 'Wide scenic landscape of {location} at {timeOfDay}, dramatic clouds, layered depth, atmospheric haze, epic scale, ultra-detailed nature photography',
    categoryIndex: 1,
    aspectRatio: '16:9',
    quality: 'high',
  },
  {
    title: 'Minimalistic Landscape',
    text: 'Minimalistic landscape, {silhouette} against a {colorGradient} sky, large negative space, clean composition, muted palette, fine-art style',
    categoryIndex: 1,
    aspectRatio: '16:9',
    quality: 'standard',
  },
  {
    title: 'Product-Style Object',
    text: 'Studio product shot of {object}, centered on a seamless {backgroundColor} backdrop, softbox lighting with gentle shadow, crisp reflections, commercial advertising quality',
    categoryIndex: 2,
    aspectRatio: '1:1',
    quality: 'high',
  },
  {
    title: 'Watercolor Style',
    text: 'Watercolor painting of {subject}, loose expressive brush strokes, soft color bleeds on textured paper, white background accents, hand-painted feel',
    categoryIndex: 3,
    aspectRatio: '4:5',
    quality: 'standard',
  },
  {
    title: 'Wide Shot',
    text: 'Wide establishing shot of {scene}, camera at eye level, subjects small in frame to establish scale and geography, cinematic composition, natural lighting',
    categoryIndex: 5,
    aspectRatio: '16:9',
    quality: 'high',
  },
  {
    title: 'Extreme Close-Up',
    text: 'Extreme close-up of {subject}, macro detail, shallow depth of field, minimal background bokeh, fine texture visible, directional soft light',
    categoryIndex: 5,
    aspectRatio: '1:1',
    quality: 'high',
  },
];

/**
 * Pure factory: builds a seeded {prompts, categories} instance with injected ids
 * (callers pass crypto.randomUUID() values to keep the function testable).
 * @param {{ categoryIds?: unknown[], promptIds?: unknown[] }} [seedIds]
 * @returns {{ prompts: Prompt[], categories: Category[] }}
 */
export function createPresetsInstance({ categoryIds = [], promptIds = [] } = {}) {
  /** @type {Category[]} */
  const categories = [];
  SEED_CATEGORIES.forEach((def, i) => {
    const category = normalizeCategory({ ...def, id: categoryIds[i] });
    if (category) categories.push(category);
  });
  /** @type {Prompt[]} */
  const prompts = [];
  SEED_PROMPT_DEFS.forEach((def, i) => {
    const prompt = normalizePrompt({
      ...def,
      categoryId: categories[def.categoryIndex]?.id ?? null,
      id: promptIds[i],
      createdAt: Date.now(),
    });
    if (prompt) prompts.push(prompt);
  });
  return { prompts, categories };
}

/**
 * Seed presets into a storage area — idempotent:
 * - never initialized → append the full instance once
 * - initialized and current version → no-op (user data untouched)
 * - initialized but older version (v1→v2) → repair-merge: add missing presets,
 *   dedupe on title/name signature, then bump version
 * @param {{ get: Function, set: Function }} [area] defaults to browser.storage.local
 * @returns {Promise<void>}
 */
export async function seedPresets(area) {
  const store = area ?? browser?.storage?.local;
  if (!store) throw new Error('Prompty: storage.local is unavailable');
  const keys = ['prompts', 'categories', 'presetsInitialized', 'presetsVersion'];
  /** @type {Record<string, unknown>} */
  const raw = await store.get(keys);
  const initialized = raw.presetsInitialized === true;
  const version = typeof raw.presetsVersion === 'number' ? raw.presetsVersion : 0;

  if (initialized && version >= PRESETS_VERSION) return; // already seeded — no-op

  /** @type {Prompt[]} */
  const existingPrompts = [];
  for (const item of Array.isArray(raw.prompts) ? raw.prompts : []) {
    const normalized = normalizePrompt(item);
    if (normalized) existingPrompts.push(normalized);
  }
  /** @type {Category[]} */
  const existingCategories = [];
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    const normalized = normalizeCategory(item);
    if (normalized) existingCategories.push(normalized);
  }

  const instance = createPresetsInstance({
    categoryIds: SEED_CATEGORIES.map(() => randomId()),
    promptIds: SEED_PROMPT_DEFS.map(() => randomId()),
  });

  const prompts =
    initialized && existingPrompts.length > 0
      ? mergePresets(existingPrompts, instance.prompts)
      : [...existingPrompts, ...instance.prompts];
  const categories =
    initialized && existingCategories.length > 0
      ? mergePresets(existingCategories, instance.categories)
      : [...existingCategories, ...instance.categories];

  await store.set({
    prompts,
    categories,
    presetsInitialized: true,
    presetsVersion: PRESETS_VERSION,
  });
}

/**
 * @returns {string}
 */
function randomId() {
  return globalThis.crypto.randomUUID();
}
