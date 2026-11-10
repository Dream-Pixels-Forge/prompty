import { describe, expect, it } from 'vitest';
import {
  MAX_TAGS,
  bulkFavorite,
  bulkMove,
  bulkTag,
  clearSelection,
  joinedText,
  pickPrompts,
  pruneSelection,
  rangeSelection,
  removeMany,
  restoreMany,
  selectAllVisible,
  selectOnly,
  selectionLibrary,
  tagsInSelection,
  toggleSelection,
} from '../src/popup/library.js';
import { applyImportData } from '../src/popup/logic.js';

/** @typedef {import('../src/lib/storage.js').Prompt} Prompt */

/**
 * @param {string} id
 * @param {Partial<Prompt>} [extra]
 * @returns {Prompt}
 */
const P = (id, extra = {}) => ({
  id,
  title: `T${id}`,
  text: `text ${id}`,
  categoryId: null,
  tags: [],
  createdAt: 1,
  useCount: 0,
  isFavorite: false,
  aspectRatio: null,
  quality: null,
  lastUsedAt: null,
  ...extra,
});

const visible = ['a', 'b', 'c', 'd', 'e'];

describe('selection reducer', () => {
  it('selectOnly / clear', () => {
    expect(selectOnly('b')).toEqual({ ids: ['b'], anchor: 'b' });
    expect(clearSelection()).toEqual({ ids: [], anchor: null });
  });

  it('toggle adds and removes, moving the anchor', () => {
    let s = toggleSelection(clearSelection(), 'a');
    s = toggleSelection(s, 'c');
    expect(s).toEqual({ ids: ['a', 'c'], anchor: 'c' });
    s = toggleSelection(s, 'a');
    expect(s).toEqual({ ids: ['c'], anchor: 'a' });
  });

  it('range spans anchor → id in grid order, either direction', () => {
    expect(rangeSelection(selectOnly('b'), 'd', visible).ids).toEqual(['b', 'c', 'd']);
    expect(rangeSelection(selectOnly('d'), 'b', visible).ids).toEqual(['b', 'c', 'd']);
  });

  it('range keeps the anchor so Shift+arrow can shrink it', () => {
    const start = selectOnly('b');
    const grown = rangeSelection(start, 'e', visible);
    const shrunk = rangeSelection(grown, 'c', visible);
    expect(shrunk).toEqual({ ids: ['b', 'c'], anchor: 'b' });
  });

  it('range keeps an earlier base selection', () => {
    const s = rangeSelection({ ids: ['a', 'd'], anchor: 'd' }, 'e', visible, ['a']);
    expect(s.ids).toEqual(['a', 'd', 'e']);
  });

  it('range without an anchor (or an invisible one) selects just the id', () => {
    expect(rangeSelection(clearSelection(), 'c', visible)).toEqual({ ids: ['c'], anchor: 'c' });
    expect(rangeSelection(selectOnly('zz'), 'c', visible)).toEqual({ ids: ['c'], anchor: 'c' });
    const s = selectOnly('a');
    expect(rangeSelection(s, 'nope', visible)).toBe(s);
  });

  it('selectAllVisible', () => {
    expect(selectAllVisible(visible)).toEqual({ ids: visible, anchor: 'a' });
    expect(selectAllVisible([])).toEqual({ ids: [], anchor: null });
  });

  it('prune drops ids no longer visible; same object when unchanged', () => {
    const s = { ids: ['a', 'c', 'x'], anchor: 'x' };
    expect(pruneSelection(s, visible)).toEqual({ ids: ['a', 'c'], anchor: null });
    const ok = { ids: ['a'], anchor: 'a' };
    expect(pruneSelection(ok, visible)).toBe(ok);
  });
});

describe('bulk transforms', () => {
  const lib = [P('a', { categoryId: 'k1' }), P('b'), P('c', { categoryId: 'k2' }), P('d')];

  it('bulkMove sets category on selected only, null = uncategorized', () => {
    const next = bulkMove(lib, ['a', 'b'], 'k2');
    expect(next.map((p) => p.categoryId)).toEqual(['k2', 'k2', 'k2', null]);
    expect(next[3]).toBe(lib[3]);
    expect(bulkMove(lib, ['a'], '')[0].categoryId).toBeNull();
  });

  it('bulkMove never adds versions (text unchanged)', () => {
    expect(bulkMove(lib, ['a'], 'k2')[0].versions).toBeUndefined();
  });

  it('bulkTag adds case-insensitively, removes, ignores #', () => {
    const tagged = [P('a', { tags: ['Neon', 'night'] }), P('b', { tags: [] }), P('c')];
    const next = bulkTag(tagged, ['a', 'b'], ['#neon', 'client-x'], ['NIGHT']);
    expect(next[0].tags).toEqual(['Neon', 'client-x']);
    expect(next[1].tags).toEqual(['neon', 'client-x']);
    expect(next[2]).toBe(tagged[2]);
  });

  it('bulkTag caps at MAX_TAGS and returns unchanged prompts as-is', () => {
    const full = P('a', { tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`) });
    const [next] = bulkTag([full], ['a'], ['extra']);
    expect(next).toBe(full);
    expect(next.tags).toHaveLength(MAX_TAGS);
  });

  it('bulkFavorite: all on → off, otherwise all on; explicit value wins', () => {
    const mixed = [P('a', { isFavorite: true }), P('b'), P('c')];
    expect(bulkFavorite(mixed, ['a', 'b']).map((p) => p.isFavorite)).toEqual([true, true, false]);
    const allOn = [P('a', { isFavorite: true }), P('b', { isFavorite: true })];
    expect(bulkFavorite(allOn, ['a', 'b']).map((p) => p.isFavorite)).toEqual([false, false]);
    expect(bulkFavorite(allOn, ['a'], true)[0]).toBe(allOn[0]);
  });

  it('removeMany + restoreMany restores the exact original order', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => P(id));
    const { prompts, removed } = removeMany(list, ['e', 'a', 'c']);
    expect(prompts.map((p) => p.id)).toEqual(['b', 'd', 'f']);
    expect(removed.map((r) => [r.prompt.id, r.index])).toEqual([
      ['a', 0],
      ['c', 2],
      ['e', 4],
    ]);
    // removed passed in any order still restores exactly
    const back = restoreMany(prompts, [...removed].reverse());
    expect(back.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(back[0]).toBe(list[0]);
  });

  it('restoreMany skips ids already present and clamps past-the-end indexes', () => {
    const { prompts, removed } = removeMany([P('a'), P('b'), P('c')], ['a', 'c']);
    const back = restoreMany([...prompts, P('a')], removed);
    expect(back.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(restoreMany([], removed).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('pickPrompts / joinedText follow the order given and skip missing ids', () => {
    expect(pickPrompts(lib, ['c', 'zz', 'a']).map((p) => p.id)).toEqual(['c', 'a']);
    expect(joinedText([P('a', { text: ' one ' }), P('b', { text: 'two' })], ['b', 'a'])).toBe(
      'two\n\none',
    );
  });

  it('selectionLibrary carries only used categories and no settings', () => {
    const cats = [
      { id: 'k1', name: 'One', color: '#000', icon: '•', order: 0 },
      { id: 'k2', name: 'Two', color: '#000', icon: '•', order: 1 },
    ];
    const out = selectionLibrary({ prompts: lib, categories: cats }, ['a', 'b']);
    expect(out.prompts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(out.categories.map((c) => c.id)).toEqual(['k1']);
    expect('settings' in out).toBe(false);
  });

  it('tagsInSelection counts case-insensitively, most common first', () => {
    const tagged = [
      P('a', { tags: ['neon', 'x'] }),
      P('b', { tags: ['Neon'] }),
      P('c', { tags: ['y'] }),
    ];
    expect(tagsInSelection(tagged, ['a', 'b'])).toEqual([
      { tag: 'neon', count: 2 },
      { tag: 'x', count: 1 },
    ]);
  });
});

describe('import without settings (export selected)', () => {
  it('keeps the current settings in merge and replace mode', () => {
    const current = {
      prompts: [],
      categories: [],
      settings: { sortBy: 'name', compactMode: true },
    };
    for (const mode of /** @type {const} */ (['merge', 'replace'])) {
      const next = applyImportData(
        { prompts: [P('a')], categories: [] },
        /** @type {any} */ (current),
        mode,
      );
      expect(next.settings.sortBy).toBe('name');
      expect(next.settings.compactMode).toBe(true);
      expect(next.prompts.map((p) => p.id)).toContain('a');
    }
  });
});
