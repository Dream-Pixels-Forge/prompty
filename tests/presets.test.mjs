import { beforeEach, describe, expect, it } from 'vitest';

const SEED_TITLES = [
  'Full-Body Character Portrait',
  'Character Design Sheet',
  'Wide Scenic Landscape',
  'Minimalistic Landscape',
  'Product-Style Object',
  'Watercolor Style',
  'Wide Shot',
  'Extreme Close-Up',
];
const SEED_CATEGORY_NAMES = [
  'Characters',
  'Landscapes',
  'Objects',
  'Styles',
  'Abstract',
  'Camera Angles',
];

describe('createPresetsInstance (pure factory)', () => {
  it('builds 6 categories and 8 prompts from injected seed ids', async () => {
    const { createPresetsInstance, SEED_PROMPT_DEFS, SEED_CATEGORIES } = await import(
      '../src/lib/presets.js'
    );
    expect(SEED_PROMPT_DEFS).toHaveLength(8);
    expect(SEED_CATEGORIES).toHaveLength(6);
    const instance = createPresetsInstance({
      categoryIds: SEED_CATEGORIES.map((_, i) => `cat-${i}`),
      promptIds: SEED_PROMPT_DEFS.map((_, i) => `p-${i}`),
    });
    expect(instance.categories.map((c) => c.name)).toEqual(SEED_CATEGORY_NAMES);
    expect(instance.prompts.map((p) => p.title)).toEqual(SEED_TITLES);
    expect(instance.categories.map((c) => c.id)).toEqual(
      SEED_CATEGORIES.map((_, i) => `cat-${i}`),
    );
  });

  it('every preset prompt references a valid category id and is fully normalized', async () => {
    const { createPresetsInstance, SEED_PROMPT_DEFS, SEED_CATEGORIES } = await import(
      '../src/lib/presets.js'
    );
    const instance = createPresetsInstance({
      categoryIds: SEED_CATEGORIES.map((_, i) => `cat-${i}`),
      promptIds: SEED_PROMPT_DEFS.map((_, i) => `p-${i}`),
    });
    const catIds = new Set(instance.categories.map((c) => c.id));
    for (const p of instance.prompts) {
      expect(p.id).toBeTruthy();
      expect(p.text.length).toBeGreaterThan(0);
      expect(catIds.has(p.categoryId)).toBe(true);
    }
  });

  it('category colors match SPEC §1 palette', async () => {
    const { SEED_CATEGORIES } = await import('../src/lib/presets.js');
    const colors = SEED_CATEGORIES.map((c) => c.color);
    expect(colors).toEqual(
      expect.arrayContaining([
        '#8b5cf6',
        '#10b981',
        '#f59e0b',
        '#ec4899',
        '#6366f1',
        '#06b6d4',
      ]),
    );
  });

  it('category icons match SPEC §1 emoji set', async () => {
    const { SEED_CATEGORIES } = await import('../src/lib/presets.js');
    expect(SEED_CATEGORIES.map((c) => c.icon)).toEqual([
      '👤',
      '🏔️',
      '📦',
      '🎨',
      '✨',
      '🎬',
    ]);
  });
});

describe('seedPresets (idempotent via presetsInitialized/presetsVersion)', () => {
  let storageMock;

  beforeEach(() => {
    storageMock = mockStorageArea();
  });

  it('seeds empty storage once: 8 prompts + 6 categories, flags set', async () => {
    const { seedPresets, PRESETS_VERSION } = await import('../src/lib/presets.js');
    await seedPresets(storageMock);
    const data = await storageMock.get(['prompts', 'categories', 'presetsInitialized', 'presetsVersion']);
    expect(data.prompts).toHaveLength(8);
    expect(data.categories).toHaveLength(6);
    expect(data.presetsInitialized).toBe(true);
    expect(data.presetsVersion).toBe(PRESETS_VERSION);
  });

  it('is idempotent — second seed does not append duplicates', async () => {
    const { seedPresets } = await import('../src/lib/presets.js');
    await seedPresets(storageMock);
    const first = await storageMock.get(['prompts', 'categories']);
    await seedPresets(storageMock);
    const second = await storageMock.get(['prompts', 'categories']);
    expect(second.prompts).toHaveLength(8);
    expect(second.categories).toHaveLength(6);
    expect(second).toEqual(first);
  });

  it('v1→v2 repair-merge: adds missing presets, dedupes existing ones', async () => {
    const { seedPresets, PRESETS_VERSION } = await import('../src/lib/presets.js');
    // Simulate a v1 install: one prompt seeded, then user (or partial v1 seed) lost 7.
    await storageMock.set({
      prompts: [
        {
          id: 'legacy-p1',
          title: SEED_TITLES[0],
          text: 'legacy text with same title signature',
          createdAt: 1,
          useCount: 3,
          isFavorite: false,
          categoryId: 'legacy-cat',
          tags: [],
          aspectRatio: null,
          quality: null,
          lastUsedAt: null,
        },
      ],
      categories: [],
      presetsInitialized: true,
      presetsVersion: 1,
    });
    await seedPresets(storageMock);
    const data = await storageMock.get(['prompts', 'categories', 'presetsVersion']);
    expect(data.presetsVersion).toBe(PRESETS_VERSION);
    expect(data.prompts).toHaveLength(8);
    expect(data.prompts.map((p) => p.title)).toEqual(
      expect.arrayContaining(SEED_TITLES),
    );
    expect(data.categories.map((c) => c.name)).toEqual(SEED_CATEGORY_NAMES);
  });

  it('does not touch user prompts when already initialized at current version', async () => {
    const { seedPresets, PRESETS_VERSION } = await import('../src/lib/presets.js');
    await seedPresets(storageMock);
    const { prompts: afterSeed } = await storageMock.get(['prompts']);
    await storageMock.set({
      prompts: [
        ...afterSeed,
        {
          id: 'user-1',
          title: 'User Custom',
          text: 'user text',
          createdAt: 1,
          useCount: 0,
          isFavorite: false,
          categoryId: null,
          tags: [],
          aspectRatio: null,
          quality: null,
          lastUsedAt: null,
        },
      ],
      presetsVersion: PRESETS_VERSION,
      presetsInitialized: true,
    });
    await seedPresets(storageMock);
    const { prompts } = await storageMock.get(['prompts']);
    expect(prompts).toHaveLength(9);
    expect(prompts.some((p) => p.title === 'User Custom')).toBe(true);
  });
});

function mockStorageArea() {
  const data = new Map();
  return {
    async get(keys) {
      const out = {};
      const list = Array.isArray(keys) ? keys : keys == null ? [...data.keys()] : [keys];
      for (const k of list) {
        if (data.has(k)) out[k] = structuredClone(data.get(k));
      }
      return out;
    },
    async set(patch) {
      for (const [k, v] of Object.entries(patch)) data.set(k, structuredClone(v));
    },
    _dump: () => Object.fromEntries(data),
  };
}

