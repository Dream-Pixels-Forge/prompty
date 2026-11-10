import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SNIPPET_CAP,
  appendSnippet,
  mergeById,
  mergePresets,
  mergeSettings,
  normalizeCategory,
  normalizePrompt,
  readAll,
  replaceAll,
  writeAll,
  MAX_VERSIONS,
} from '../src/lib/storage.js';

/**
 * @typedef {import('../src/lib/storage.js').Prompt} Prompt
 * @typedef {import('../src/lib/storage.js').Category} Category
 * @typedef {import('../src/lib/storage.js').Snippet} Snippet
 * @typedef {import('../src/lib/storage.js').Settings} Settings
 */

describe('normalizePrompt', () => {
  it('fills all fields with SPEC §1 defaults', () => {
    /** @type {Prompt} */
    const p = /** @type {Prompt} */ (normalizePrompt({ title: 'T', text: 'B' }));
    expect(p).toEqual({
      id: expect.any(String),
      title: 'T',
      text: 'B',
      createdAt: expect.any(Number),
      useCount: 0,
      isFavorite: false,
      categoryId: null,
      tags: [],
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
    });
  });

  it('keeps provided values, coerces types', () => {
    /** @type {Prompt} */
    const p = /** @type {Prompt} */ (
      normalizePrompt({
        id: 'abc',
        title: 42,
        text: 'body',
        createdAt: '1000',
        useCount: '7',
        isFavorite: 1,
        categoryId: 'cat',
        tags: 'tag-a',
        aspectRatio: '16:9',
        quality: 'high',
        lastUsedAt: 2000,
      })
    );
    expect(p.id).toBe('abc');
    expect(p.title).toBe('42');
    expect(p.createdAt).toBe(1000);
    expect(p.useCount).toBe(7);
    expect(p.isFavorite).toBe(true);
    expect(p.tags).toEqual(['tag-a']);
    expect(p.lastUsedAt).toBe(2000);
  });

  it('coerces unexpected tag arrays to clean string arrays and strips dups', () => {
    /** @type {Prompt} */
    const p = /** @type {Prompt} */ (normalizePrompt({ tags: ['a', 2, '', 'a', null] }));
    expect(p.tags).toEqual(['a', '2']);
    /** @type {Prompt} */
    const weird = /** @type {Prompt} */ (normalizePrompt({ tags: { foo: 1 } }));
    expect(weird.tags).toEqual([]);
  });

  it('rejects non-object input by nulling', () => {
    expect(normalizePrompt(null)).toBe(null);
    expect(normalizePrompt('nope')).toBe(null);
  });
});

describe('normalizeCategory', () => {
  it('fills defaults (id, name, color, icon, order)', () => {
    /** @type {Category} */
    const c = /** @type {Category} */ (normalizeCategory({ name: 'Chars' }));
    expect(c).toEqual({
      id: expect.any(String),
      name: 'Chars',
      color: '#8b5cf6',
      icon: '👤',
      order: 0,
    });
  });

  it('rejects non-object input', () => {
    expect(normalizeCategory(null)).toBe(null);
  });
});

describe('mergeById (MERGE import mode)', () => {
  /** @type {Prompt} */
  const a = {
    id: 'a',
    title: 'A',
    text: '',
    createdAt: 1,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
  };
  /** @type {Prompt} */
  const b = {
    id: 'b',
    title: 'B',
    text: '',
    createdAt: 1,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
  };
  /** @type {Prompt} */
  const b2 = {
    id: 'b',
    title: 'B-imported',
    text: '',
    createdAt: 1,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
  };
  /** @type {Prompt} */
  const c = {
    id: 'c',
    title: 'C',
    text: '',
    createdAt: 1,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
  };

  it('unions arrays, incoming wins on id collision', () => {
    const merged = mergeById([a, b], [b2, c]);
    expect(merged.map((x) => x.title)).toEqual(['A', 'B-imported', 'C']);
  });

  it('accepts unsorted and duplicate incoming ids (last wins)', () => {
    const merged = mergeById([b], [a, c, c]);
    expect(merged.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('is safe with null/undefined inputs', () => {
    expect(mergeById(null, null)).toEqual([]);
    expect(mergeById([a], null)).toEqual([a]);
    expect(mergeById(null, [b])).toEqual([b]);
  });
});

describe('mergePresets (title/name signature dedupe for repair-merge)', () => {
  it('dedupes same-title incoming presets, keeps distinct ones', () => {
    /** @type {Prompt} */
    const existing = {
      id: 'p1',
      title: 'Full-Body Character Portrait',
      text: 'legacy',
      createdAt: 1,
      useCount: 0,
      isFavorite: false,
      categoryId: null,
      tags: [],
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
    };
    const incomingSame = { ...existing, id: 'p1-new', text: 'different text' };
    const incomingNew = { ...existing, id: 'p2', title: 'Other', text: 'x' };
    const merged = mergePresets([existing], [incomingSame, incomingNew]);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('replaceAll (REPLACE import mode)', () => {
  it('returns exactly the normalized incoming array, dropping invalid entries', () => {
    // Fixed createdAt: without it both sides default to Date.now() separately
    // and the test flaked whenever the two calls straddled a millisecond.
    const raw = { id: 'x', title: 'ok', text: 't', createdAt: 1 };
    const out = replaceAll([raw, null, 'garbage']);
    expect(out).toEqual([normalizePrompt(raw)]);
  });

  it('supports a custom normalizer (categories)', () => {
    const out = replaceAll([{ name: 'Cat' }], normalizeCategory);
    /** @type {Category} */
    const first = /** @type {Category} */ (out[0]);
    expect(first.name).toBe('Cat');
    expect(first.color).toBe('#8b5cf6');
  });
});

describe('mergeSettings (whitelist only — SECURITY.md)', () => {
  it('keeps defaults and applies whitelisted patch keys', () => {
    /** @type {Settings} */
    const s = mergeSettings(DEFAULT_SETTINGS, { compactMode: true, sortBy: 'name' });
    expect(s.compactMode).toBe(true);
    expect(s.sortBy).toBe('name');
    expect(s.defaultView).toBe('all');
    expect(s.showFloatingWidget).toBe(true);
  });

  it('never adopts non-whitelisted keys (no generic deep merge)', () => {
    const patch =
      /**
       * @type {Record<string, unknown> & { evil?: boolean, nested?: object }}
       */ ({ evil: true, nested: { pollution: 'attempt' } });
    // Prototype-pollution-style attack: only affects patch's own prototype.
    Object.setPrototypeOf(patch, { polluted: 'yes' });
    /** @type {Settings} */
    const s = mergeSettings(DEFAULT_SETTINGS, patch);
    expect('evil' in s).toBe(false);
    expect('nested' in s).toBe(false);
    expect(s.compactMode).toBe(false);
  });

  it('replaces disabledSites whole-array (typed sanitize)', () => {
    /** @type {Settings} */
    const s = mergeSettings(DEFAULT_SETTINGS, {
      disabledSites: ['https://x.com', 5, null],
    });
    expect(s.disabledSites).toEqual(['https://x.com']);
  });

  it('null patch falls back to defaults', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores patch values of wrong primitive type', () => {
    /** @type {Settings} */
    const s = mergeSettings(DEFAULT_SETTINGS, { compactMode: 'yes' });
    expect(s.compactMode).toBe(false);
  });
});

describe('appendSnippet (snippets[] helpers)', () => {
  it('appends {id,text,sourceOrigin} payload to the end', () => {
    /** @type {Snippet} */
    const a = { id: 's1', text: 'one', sourceOrigin: 'https://a.com' };
    const withB = appendSnippet([a], { text: 'two', sourceOrigin: 'https://b.com' });
    expect(withB).toHaveLength(2);
    expect(withB[1]).toEqual({
      id: expect.any(String),
      text: 'two',
      sourceOrigin: 'https://b.com',
    });
    expect(withB[0]).toEqual(a);
  });

  it('skips empty/whitespace text', () => {
    expect(appendSnippet([], { text: '  ' })).toEqual([]);
    expect(appendSnippet([], { text: '' })).toEqual([]);
    expect(appendSnippet(null, { text: '' })).toEqual([]);
  });

  it('dedupes consecutive identical text (no adjacent duplicates)', () => {
    const s1 = appendSnippet([], { text: 'same', sourceOrigin: 'x' });
    const s2 = appendSnippet(s1, { text: '  same  ' });
    const s3 = appendSnippet(s2, { text: 'same again?' });
    const s4 = appendSnippet(s3, { text: 'same' });
    expect(s2).toEqual(s1);
    expect(s3).toHaveLength(2);
    expect(s4[s4.length - 2].text).not.toBe('same');
  });

  it('caps history at 50 FIFO — oldest dropped first', () => {
    let history = /** @type {Snippet[]} */ ([]);
    for (let i = 0; i < 55; i++) {
      history = appendSnippet(history, { text: `snippet-${i}`, sourceOrigin: `u${i}` });
    }
    expect(history).toHaveLength(SNIPPET_CAP);
    expect(history[0].text).toBe('snippet-5');
    expect(history[49].text).toBe('snippet-54');
  });

  it('does not mutate the input array', () => {
    /** @type {Snippet[]} */
    const original = [{ id: 'id1', text: 'a', sourceOrigin: 'o' }];
    const copy = [...original];
    appendSnippet(original, { text: 'b' });
    expect(original).toEqual(copy);
  });
});

describe('mergeSettings — quick trigger (G1 keys used by the content script)', () => {
  it('defaults to "!" enabled and keeps valid single characters', () => {
    expect(DEFAULT_SETTINGS.quickTrigger).toBe('!');
    expect(DEFAULT_SETTINGS.quickTriggerEnabled).toBe(true);
    const s = mergeSettings(DEFAULT_SETTINGS, { quickTrigger: '/', quickTriggerEnabled: false });
    expect(s.quickTrigger).toBe('/');
    expect(s.quickTriggerEnabled).toBe(false);
  });
  it('rejects multi-character, empty and whitespace triggers', () => {
    for (const bad of ['//', '', ' ', 3]) {
      expect(mergeSettings(DEFAULT_SETTINGS, { quickTrigger: bad }).quickTrigger).toBe('!');
    }
  });
  it('preserves quick-trigger keys across unrelated updates', () => {
    const base = mergeSettings(DEFAULT_SETTINGS, { quickTrigger: ';' });
    expect(mergeSettings(base, { compactMode: true }).quickTrigger).toBe(';');
  });
});

describe('prompt versions (G5)', () => {
  const v = (/** @type {number} */ n) => ({ text: `t${n}`, title: `T${n}`, editedAt: n });

  it('keeps valid versions, drops malformed entries, and caps at MAX_VERSIONS (newest first)', () => {
    const many = Array.from({ length: MAX_VERSIONS + 5 }, (_, i) => v(100 - i));
    const p = /** @type {Prompt} */ (
      normalizePrompt({ title: 'X', text: 'Y', versions: [null, 'x', { text: 3 }, ...many] })
    );
    expect(MAX_VERSIONS).toBe(20);
    expect(p.versions).toHaveLength(MAX_VERSIONS);
    expect(p.versions?.[0]).toEqual(v(100));
  });

  it('coerces a missing version title to "" and omits the field when nothing is valid', () => {
    const p = /** @type {Prompt} */ (
      normalizePrompt({ title: 'X', text: 'Y', versions: [{ text: 'old', editedAt: 5 }] })
    );
    expect(p.versions).toEqual([{ text: 'old', title: '', editedAt: 5 }]);
    expect(
      'versions' in
        /** @type {Prompt} */ (normalizePrompt({ title: 'X', text: 'Y', versions: [] })),
    ).toBe(false);
    expect('versions' in /** @type {Prompt} */ (normalizePrompt({ title: 'X', text: 'Y' }))).toBe(
      false,
    );
  });

  it('survives a readAll → writeAll round-trip (the background save path)', async () => {
    /** @type {Record<string, unknown>} */
    const data = {
      prompts: [{ id: 'p', title: 'X', text: 'Y', versions: [v(2), v(1)] }],
    };
    const area = {
      async get(/** @type {string[]} */ keys) {
        return Object.fromEntries(
          keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]),
        );
      },
      async set(/** @type {Record<string, unknown>} */ patch) {
        Object.assign(data, structuredClone(patch));
      },
    };
    const lib = await readAll(area);
    await writeAll(area, { prompts: lib.prompts });
    expect(/** @type {Prompt[]} */ (data.prompts)[0].versions).toEqual([v(2), v(1)]);
  });
});
