import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  appendSnippet,
  mergeById,
  mergeSettings,
  normalizeCategory,
  normalizePrompt,
  replaceAll,
} from '../src/lib/storage.js';

describe('normalizePrompt', () => {
  it('fills all fields with SPEC §1 defaults', () => {
    const p = normalizePrompt({ title: 'T', text: 'B' });
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
    const p = normalizePrompt({
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
    });
    expect(p.id).toBe('abc');
    expect(p.title).toBe('42');
    expect(p.createdAt).toBe(1000);
    expect(p.useCount).toBe(7);
    expect(p.isFavorite).toBe(true);
    expect(p.tags).toEqual(['tag-a']);
    expect(p.lastUsedAt).toBe(2000);
  });

  it('coerces unexpected tag arrays to clean string arrays and strips dups', () => {
    expect(normalizePrompt({ tags: ['a', 2, '', 'a', null] }).tags).toEqual(['a', '2']);
    expect(normalizePrompt({ tags: { foo: 1 } }).tags).toEqual([]);
  });

  it(' rejects non-object input by nulling', () => {
    expect(normalizePrompt(null)).toBe(null);
    expect(normalizePrompt('nope')).toBe(null);
  });
});

describe('normalizeCategory', () => {
  it('fills defaults (id, name, color, icon, order)', () => {
    const c = normalizeCategory({ name: 'Chars' });
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
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };
  const b2 = { id: 'b', name: 'B-imported' };
  const c = { id: 'c', name: 'C' };

  it('unions arrays, incoming wins on id collision', () => {
    const merged = mergeById([a, b], [b2, c]);
    expect(merged.map((x) => x.name)).toEqual(['A', 'B-imported', 'C']);
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

describe('replaceAll (REPLACE import mode)', () => {
  it('returns exactly the normalized incoming array, dropping invalid entries', () => {
    const out = replaceAll([{ id: 'x', title: 'ok', text: 't' }, null, 'garbage']);
    expect(out).toEqual([normalizePrompt({ id: 'x', title: 'ok', text: 't' })]);
  });
});

describe('mergeSettings (whitelist only — SECURITY.md)', () => {
  it('keeps defaults and applies whitelisted patch keys', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { compactMode: true, sortBy: 'name' });
    expect(s.compactMode).toBe(true);
    expect(s.sortBy).toBe('name');
    expect(s.defaultView).toBe('all');
    expect(s.showFloatingWidget).toBe(true);
  });

  it('never adopts non-whitelisted keys (no generic deep merge)', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      evil: true,
      __proto__: { polluted: 'yes' },
      nested: { pollution: 'attempt' },
    });
    expect('evil' in s).toBe(false);
    expect('nested' in s).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  it('replaces disabledSites whole-array (typed sanitize)', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { disabledSites: ['https://x.com', 5, null] });
    expect(s.disabledSites).toEqual(['https://x.com']);
  });

  it('null patch falls back to defaults', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores patch values of wrong primitive type', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { compactMode: 'yes', useCountWontPass: 1 });
    expect(s.compactMode).toBe(false);
  });
});

describe('appendSnippet (snippets[] helpers)', () => {
  it('appends {id,text,sourceOrigin} payload to the end', () => {
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
    let history = [];
    for (let i = 0; i < 55; i++) {
      history = appendSnippet(history, { text: `snippet-${i}`, sourceOrigin: `u${i}` });
    }
    expect(history).toHaveLength(50);
    expect(history[0].text).toBe('snippet-5');
    expect(history[49].text).toBe('snippet-54');
  });

  it('does not mutate the input array', () => {
    const original = [{ id: 'id1', text: 'a', sourceOrigin: 'o' }];
    const copy = [...original];
    appendSnippet(original, { text: 'b' });
    expect(original).toEqual(copy);
  });
});

