import { describe, expect, it } from 'vitest';
import {
  BRIDGE_PROTOCOL,
  DEFAULT_BRIDGE_URL,
  applyPending,
  isLoopbackUrl,
  normalizeBridgeUrl,
  validatePending,
} from '../src/lib/bridge.js';
import { DEFAULT_SETTINGS, normalizePrompt } from '../src/lib/storage.js';

const NOW = 1_700_000_000_000;
/** @param {number} n */
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const colors = ['#111111', '#222222'];

/** @param {Partial<import('../src/lib/storage.js').Prompt>} over */
const prompt = (over = {}) =>
  normalizePrompt({
    id: id(1),
    title: 'Dolly zoom',
    text: 'A slow dolly zoom on {subject}',
    createdAt: NOW,
    ...over,
  });

const library = (over = {}) => ({
  prompts: [],
  categories: [],
  projects: [],
  documents: [],
  settings: { ...DEFAULT_SETTINGS },
  ...over,
});

describe('normalizeBridgeUrl', () => {
  it('accepts loopback http URLs and strips a trailing slash', () => {
    expect(normalizeBridgeUrl('http://127.0.0.1:47821')).toBe('http://127.0.0.1:47821');
    expect(normalizeBridgeUrl('http://127.0.0.1:47821/')).toBe('http://127.0.0.1:47821');
    expect(normalizeBridgeUrl(' http://localhost:9000/ ')).toBe('http://localhost:9000');
  });

  it('refuses anything that is not plain loopback http', () => {
    for (const bad of [
      '',
      'localhost:47821',
      'https://127.0.0.1:47821',
      'http://example.com:47821',
      'http://192.168.1.10:47821',
      'http://user:pw@127.0.0.1:47821',
      'http://127.0.0.1:47821/path',
      'http://127.0.0.1:47821?q=1',
      'http://[::1]:47821',
      'javascript:alert(1)',
      null,
    ]) {
      expect(normalizeBridgeUrl(bad), String(bad)).toBe(null);
    }
  });

  it('default URL is loopback and the protocol is pinned', () => {
    expect(normalizeBridgeUrl(DEFAULT_BRIDGE_URL)).toBe(DEFAULT_BRIDGE_URL);
    expect(isLoopbackUrl(DEFAULT_BRIDGE_URL)).toBe(true);
    expect(BRIDGE_PROTOCOL).toBe(1);
  });
});

describe('validatePending', () => {
  it('accepts the wire shape and defaults missing arrays', () => {
    const check = validatePending({
      prompts: [{ id: id(1), title: 'T', text: 'Body', tags: ['a'], categoryId: 'c1' }],
      categories: [{ id: 'c1', name: 'Camera' }],
    });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.data.prompts).toHaveLength(1);
      expect(check.data.deleted).toEqual([]);
      expect(check.data.categories).toHaveLength(1);
    }
    expect(validatePending({}).ok).toBe(true);
  });

  it('rejects a non-object payload and over-long text', () => {
    expect(validatePending(null).ok).toBe(false);
    expect(validatePending([]).ok).toBe(false);
    const long = validatePending({ prompts: [{ id: id(1), text: 'x'.repeat(100_001) }] });
    expect(long.ok).toBe(false);
  });

  it('caps how much a single sync can bring in', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: id(i + 1), text: `p${i}` }));
    expect(validatePending({ prompts: many }).ok).toBe(false);
  });

  it('drops malformed prompt entries instead of failing the batch', () => {
    const check = validatePending({
      prompts: [
        { id: id(1), text: 'ok' },
        { id: id(2) },
        { text: 'no id' },
        null,
        'nope',
      ],
    });
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.data.prompts).toHaveLength(1);
  });
});

describe('applyPending', () => {
  it('adds prompts with the server id and normalizes unknown fields away', () => {
    const pending = validatePending({
      prompts: [
        {
          id: id(1),
          title: 'Dolly zoom',
          text: 'A slow dolly zoom on {subject}',
          createdAt: NOW,
          tags: ['camera', 'camera', ''],
          evil: 'dropped',
        },
      ],
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const result = applyPending(library(), pending.data, { now: NOW, newId: () => id(9), colors });
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].id).toBe(id(1));
    expect(result.prompts[0].tags).toEqual(['camera']);
    expect(/** @type {any} */ (result.prompts[0]).evil).toBeUndefined();
    expect(result.applied).toMatchObject({ added: 1, updated: 0, skipped: 0, removed: 0 });
    expect(result.importedIds).toEqual([id(1)]);
  });

  it('dedupes by text instead of adding a second copy', () => {
    const existing = prompt({ id: id(5), text: 'A   slow dolly zoom' });
    const pending = validatePending({
      prompts: [{ id: id(1), title: 'Same text', text: 'a slow DOLLY zoom', tags: ['new'] }],
    });
    if (!pending.ok) throw new Error('fixture');
    const result = applyPending(library({ prompts: [existing] }), pending.data, {
      now: NOW,
      newId: () => id(9),
      colors,
    });
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0].id).toBe(id(5)); // existing stays, no duplicate
    expect(result.applied.skipped).toBe(1);
    expect(result.importedIds).toEqual([id(1)]); // still acked
  });

  it('updates a prompt in place when the id matches, keeping usage stats', () => {
    const existing = prompt({ id: id(1), useCount: 7, isFavorite: true, lastUsedAt: NOW - 50 });
    const pending = validatePending({
      prompts: [{ id: id(1), title: 'Renamed', text: 'New body {lens:24mm|50mm}' }],
    });
    if (!pending.ok) throw new Error('fixture');
    const result = applyPending(library({ prompts: [existing] }), pending.data, {
      now: NOW,
      newId: () => id(9),
      colors,
    });
    expect(result.prompts[0]).toMatchObject({
      id: id(1),
      title: 'Renamed',
      text: 'New body {lens:24mm|50mm}',
      useCount: 7,
      isFavorite: true,
    });
    expect(result.applied.updated).toBe(1);
  });

  it('creates missing categories, reuses ones with the same name, and remaps ids', () => {
    const existingCat = { id: 'cat-local', name: 'Camera', color: '#abcdef', icon: '🎬', order: 0 };
    const pending = validatePending({
      prompts: [
        { id: id(1), title: 'A', text: 'alpha', categoryId: 'cat-server' },
        { id: id(2), title: 'B', text: 'beta', categoryId: 'cat-new' },
      ],
      categories: [
        { id: 'cat-server', name: ' camera ' },
        { id: 'cat-new', name: 'Lighting' },
      ],
    });
    if (!pending.ok) throw new Error('fixture');
    const result = applyPending(library({ categories: [existingCat] }), pending.data, {
      now: NOW,
      newId: () => id(9),
      colors,
    });
    expect(result.categories.map((c) => c.name)).toEqual(['Camera', 'Lighting']);
    expect(result.categories[0].id).toBe('cat-local'); // reused, not duplicated
    const a = result.prompts.find((p) => p.text === 'alpha');
    const b = result.prompts.find((p) => p.text === 'beta');
    expect(a?.categoryId).toBe('cat-local');
    expect(b?.categoryId).toBe('cat-new');
    expect(result.applied.categoriesAdded).toBe(1);
  });

  it('mints a fresh local id when a server category id collides with another local category', () => {
    const existingCat = { id: 'cat-x', name: 'Other', color: '#abcdef', icon: '📁', order: 0 };
    const pending = validatePending({
      prompts: [{ id: id(1), title: 'A', text: 'alpha', categoryId: 'cat-x' }],
      categories: [{ id: 'cat-x', name: 'Camera' }],
    });
    if (!pending.ok) throw new Error('fixture');
    const result = applyPending(library({ categories: [existingCat] }), pending.data, {
      now: NOW,
      newId: () => 'cat-fresh',
      colors,
    });
    expect(result.categories.map((c) => c.id)).toEqual(['cat-x', 'cat-fresh']);
    expect(result.prompts[0].categoryId).toBe('cat-fresh');
  });

  it('applies tombstones and counts them', () => {
    const existing = prompt({ id: id(1) });
    const pending = validatePending({ deleted: [{ id: id(1) }, { id: id(2) }] });
    if (!pending.ok) throw new Error('fixture');
    const result = applyPending(library({ prompts: [existing] }), pending.data, {
      now: NOW,
      newId: () => id(9),
      colors,
    });
    expect(result.prompts).toEqual([]);
    expect(result.applied.removed).toBe(1);
    expect(result.importedIds.sort()).toEqual([id(1), id(2)].sort());
  });

  it('never mutates the input library', () => {
    const lib = library();
    const pending = validatePending({ prompts: [{ id: id(1), text: 'x' }] });
    if (!pending.ok) throw new Error('fixture');
    const before = JSON.stringify(lib);
    applyPending(lib, pending.data, { now: NOW, newId: () => id(9), colors });
    expect(JSON.stringify(lib)).toBe(before);
  });

  it('tolerates a payload with no prompts, categories or tombstones', () => {
    const pending = validatePending({});
    if (!pending.ok) throw new Error('fixture');
    const result = applyPending(library(), pending.data, { now: NOW, newId: () => id(9), colors });
    expect(result.prompts).toEqual([]);
    expect(result.importedIds).toEqual([]);
  });
});
