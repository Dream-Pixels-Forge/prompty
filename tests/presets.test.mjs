import { beforeEach, describe, expect, it } from 'vitest';
import {
  PRESETS_VERSION,
  SEED_CATEGORIES,
  SEED_PROMPT_DEFS,
  createPresetsInstance,
  seedPresets,
} from '../src/lib/presets.js';
import { extractVariables } from '../src/lib/variables.js';
import { CATEGORY_COLORS, CATEGORY_EMOJIS } from '../src/popup/logic.js';

/**
 * @typedef {import('../src/lib/storage.js').Prompt} Prompt
 * @typedef {import('../src/lib/storage.js').Category} Category
 */

const V2_TITLES = [
  'Full-Body Character Portrait',
  'Character Design Sheet',
  'Wide Scenic Landscape',
  'Minimalistic Landscape',
  'Product-Style Object',
  'Watercolor Style',
  'Wide Shot',
  'Extreme Close-Up',
];
const V2_CATEGORIES = [
  'Characters',
  'Landscapes',
  'Objects',
  'Styles',
  'Abstract',
  'Camera Angles',
];
const V3_CATEGORIES = [
  'Camera Movement',
  'Lighting',
  'Lens & Optics',
  'Locations',
  'Color Grading',
  'Composition',
  'Mood & Atmosphere',
  'VFX & Transitions',
  'Posters',
  'Logos',
];

const v3Prompts = SEED_PROMPT_DEFS.filter((p) => p.since === 3);

describe('seed data', () => {
  it('keeps the v2 originals first and adds the v3 cinematic pack', () => {
    expect(PRESETS_VERSION).toBe(3);
    expect(SEED_CATEGORIES.map((c) => c.name)).toEqual([...V2_CATEGORIES, ...V3_CATEGORIES]);
    expect(SEED_PROMPT_DEFS.slice(0, 8).map((p) => p.title)).toEqual(V2_TITLES);
    expect(v3Prompts.length).toBeGreaterThanOrEqual(40);
  });

  it('every v3 category has at least 3 prompts', () => {
    for (const name of V3_CATEGORIES) {
      expect(v3Prompts.filter((p) => p.category === name).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every prompt names a seed category, has a unique title and a fill-in variable', () => {
    const names = new Set(SEED_CATEGORIES.map((c) => c.name));
    const titles = new Set();
    for (const p of SEED_PROMPT_DEFS) {
      expect(names.has(p.category)).toBe(true);
      expect(titles.has(p.title)).toBe(false);
      titles.add(p.title);
      expect(extractVariables(p.text).length).toBeGreaterThan(0);
    }
  });

  it('category colors and icons are selectable in the category editor pickers', () => {
    for (const c of SEED_CATEGORIES) {
      expect(CATEGORY_COLORS).toContain(c.color);
      expect(CATEGORY_EMOJIS).toContain(c.icon);
    }
  });
});

describe('createPresetsInstance (pure factory)', () => {
  it('uses injected ids, orders categories, and links every prompt to its category', () => {
    const instance = createPresetsInstance({
      categoryIds: SEED_CATEGORIES.map((_, i) => `cat-${i}`),
      promptIds: SEED_PROMPT_DEFS.map((_, i) => `p-${i}`),
    });
    expect(instance.categories.map((c) => c.id)).toEqual(SEED_CATEGORIES.map((_, i) => `cat-${i}`));
    expect(instance.categories.map((c) => c.order)).toEqual(SEED_CATEGORIES.map((_, i) => i));
    expect(instance.prompts).toHaveLength(SEED_PROMPT_DEFS.length);
    const byId = new Map(instance.categories.map((c) => [c.id, c.name]));
    instance.prompts.forEach((p, i) => {
      expect(p.id).toBe(`p-${i}`);
      expect(byId.get(/** @type {string} */ (p.categoryId))).toBe(SEED_PROMPT_DEFS[i].category);
    });
  });
});

describe('seedPresets', () => {
  /** @type {ReturnType<typeof mockStorageArea>} */
  let store;
  beforeEach(() => {
    store = mockStorageArea();
  });

  /** @returns {Promise<{ prompts: Prompt[], categories: Category[], version: unknown }>} */
  const read = async () => {
    const d = await store.get(['prompts', 'categories', 'presetsVersion']);
    return {
      prompts: /** @type {Prompt[]} */ (d.prompts),
      categories: /** @type {Category[]} */ (d.categories),
      version: d.presetsVersion,
    };
  };

  it('fresh install seeds everything and sets the flags', async () => {
    await seedPresets(store);
    const { prompts, categories, version } = await read();
    expect(prompts).toHaveLength(SEED_PROMPT_DEFS.length);
    expect(categories).toHaveLength(SEED_CATEGORIES.length);
    expect(version).toBe(PRESETS_VERSION);
    expect((await store.get(['presetsInitialized'])).presetsInitialized).toBe(true);
  });

  it('is idempotent', async () => {
    await seedPresets(store);
    const first = await read();
    await seedPresets(store);
    expect(await read()).toEqual(first);
  });

  it('leaves user data alone at the current version', async () => {
    await seedPresets(store);
    const { prompts } = await read();
    await store.set({ prompts: [...prompts, prompt({ id: 'u1', title: 'User Custom' })] });
    await seedPresets(store);
    expect((await read()).prompts).toHaveLength(SEED_PROMPT_DEFS.length + 1);
  });

  it('v2 → v3 adds only the cinematic pack; deleted starters stay deleted', async () => {
    // A v2 user who deleted "Watercolor Style" and the "Abstract" category.
    const v2Cats = V2_CATEGORIES.filter((n) => n !== 'Abstract').map((name, order) => ({
      id: `old-${name}`,
      name,
      color: '#000000',
      icon: '•',
      order,
    }));
    const v2Prompts = V2_TITLES.filter((t) => t !== 'Watercolor Style').map((title, i) =>
      prompt({ id: `old-p${i}`, title, useCount: 5 }),
    );
    await store.set({
      prompts: v2Prompts,
      categories: v2Cats,
      presetsInitialized: true,
      presetsVersion: 2,
    });

    await seedPresets(store);
    const { prompts, categories, version } = await read();

    expect(version).toBe(3);
    expect(categories.map((c) => c.name)).toEqual([...v2Cats.map((c) => c.name), ...V3_CATEGORIES]);
    expect(categories.some((c) => c.name === 'Abstract')).toBe(false);
    expect(prompts.some((p) => p.title === 'Watercolor Style')).toBe(false);
    expect(prompts).toHaveLength(v2Prompts.length + v3Prompts.length);
    // existing prompts untouched
    expect(prompts.slice(0, v2Prompts.length)).toEqual(v2Prompts);
    // new categories ordered after the user's, every new prompt linked to a real category
    expect(categories.slice(v2Cats.length).map((c) => c.order)).toEqual(
      V3_CATEGORIES.map((_, i) => v2Cats.length + i),
    );
    const ids = new Set(categories.map((c) => c.id));
    for (const p of prompts.slice(v2Prompts.length))
      expect(ids.has(/** @type {string} */ (p.categoryId))).toBe(true);
  });

  it('joins new prompts to a same-named category the user already has', async () => {
    const mine = { id: 'my-lighting', name: 'lighting', color: '#111111', icon: '🔦', order: 0 };
    await store.set({
      prompts: [],
      categories: [mine],
      presetsInitialized: true,
      presetsVersion: 2,
    });
    await seedPresets(store);
    const { prompts, categories } = await read();
    expect(categories.filter((c) => c.name.toLowerCase() === 'lighting')).toEqual([mine]);
    const lighting = SEED_PROMPT_DEFS.filter((p) => p.category === 'Lighting').map((p) => p.title);
    for (const p of prompts.filter((x) => lighting.includes(x.title)))
      expect(p.categoryId).toBe('my-lighting');
  });

  it('v1 → v3 repair adds every starter, deduping by title', async () => {
    await store.set({
      prompts: [prompt({ id: 'legacy', title: V2_TITLES[0], useCount: 3 })],
      categories: [],
      presetsInitialized: true,
      presetsVersion: 1,
    });
    await seedPresets(store);
    const { prompts, categories } = await read();
    expect(prompts).toHaveLength(SEED_PROMPT_DEFS.length);
    expect(prompts[0]).toMatchObject({ id: 'legacy', useCount: 3 });
    expect(categories.map((c) => c.name)).toEqual([...V2_CATEGORIES, ...V3_CATEGORIES]);
  });
});

/**
 * @param {Partial<Prompt>} o
 * @returns {Prompt}
 */
function prompt(o) {
  return {
    id: 'p',
    title: 'T',
    text: 'x',
    createdAt: 1,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
    ...o,
  };
}

/** Mock storage.local (structuredClone deep-copy, Chrome-like). */
function mockStorageArea() {
  /** @type {Map<string, unknown>} */
  const data = new Map();
  return {
    /** @param {string | string[] | null} keys */
    async get(keys) {
      /** @type {Record<string, unknown>} */
      const out = {};
      const list = Array.isArray(keys) ? keys : keys == null ? [...data.keys()] : [keys];
      for (const k of list) {
        const value = data.get(k);
        if (value !== undefined) out[k] = structuredClone(value);
      }
      return out;
    },
    /** @param {Record<string, unknown>} patch */
    async set(patch) {
      for (const [k, v] of Object.entries(patch)) data.set(k, structuredClone(v));
    },
  };
}
