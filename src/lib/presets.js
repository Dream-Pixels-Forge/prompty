/**
 * Seed presets (SPEC §1: 8 generic prompts + 6 categories, global tool).
 * Seeding is idempotent via `presetsInitialized` / `presetsVersion` storage keys.
 */
import browser from './browser.js';
import { mergePresets, normalizeCategory, normalizePrompt } from './storage.js';

/** Current seed version (v1→v2 history prompt). Bump when seed data changes. */
export const PRESETS_VERSION = 2;

/** 6 categories per SPEC §1 palette (#hex + emoji + order). */
export const SEED_CATEGORIES = [
  { name: 'Characters', color: '#8b5cf6', icon: '👤', order: 0 },
  { name: 'Landscapes', color: '#10b981', icon: '🏔️', order: 1 },
  { name: 'Objects', color: '#f59e0b', icon: '📦', order: 2 },
  { name: 'Styles', color: '#ec4899', icon: '🎨', order: 3 },
  { name: 'Abstract', color: '#6366f1', icon: '✨', order: 4 },
  { name: 'Camera Angles', color: '#06b6d4', icon: '🎬', order: 5 },
];

/**
 * 8 generic seed prompt definitions (category = SEED_CATEGORIES index).
 * Texts are generic — Prompty works on any site, not only one platform.
 */
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
    text: 'Character design sheet for {character}, multiple views (front, side, back), expression thumbnails, clean lineart, flat colors, character turnaround on a neutral background',
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
 * @param {{ categoryIds?: string[], promptIds?: string[] }} seedIds
 * @returns {{ prompts: object[], categories: object[] }}
 */
export function createPresetsInstance({ categoryIds = [], promptIds = [] } = {}) {
  const categories = SEED_CATEGORIES.map((def, i) =>
    normalizeCategory({ ...def, id: categoryIds[i] }),
  );
  const prompts = SEED_PROMPT_DEFS.map((def, i) =>
    normalizePrompt({
      ...def,
      categoryId: categories[def.categoryIndex]?.id ?? null,
      id: promptIds[i],
      createdAt: Date.now(),
    }),
  );
  return { prompts, categories };
}

/**
 * Seed presets into a storage area — idempotent:
 * - never initialized → append full instance once
 * - initialized and current version → no-op (user data untouched)
 * - initialized but older version (v1→v2) → repair-merge: add missing presets,
 *   dedupe on title/text signature, then bump version
 * @param {{ get: Function, set: Function }|null} [area=browser.storage.local]
 * @returns {Promise<void>}
 */
export async function seedPresets(area) {
  const store = area ?? browser.storage.local;
  const keys = ['prompts', 'categories', 'presetsInitialized', 'presetsVersion'];
  const raw = await store.get(keys);
  const initialized = raw.presetsInitialized === true;
  const version = typeof raw.presetsVersion === 'number' ? raw.presetsVersion : 0;

  if (initialized && version >= PRESETS_VERSION) return; // already seeded — no-op

  const existingPrompts = Array.isArray(raw.prompts)
    ? raw.prompts.map(normalizePrompt).filter((p) => p !== null)
    : [];
  const existingCategories = Array.isArray(raw.categories)
    ? raw.categories.map(normalizeCategory).filter((c) => c !== null)
    : [];

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

function randomId() {
  return globalThis.crypto.randomUUID();
}
