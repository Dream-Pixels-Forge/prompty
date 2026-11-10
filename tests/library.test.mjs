import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  activeRecipes,
  countByCategory,
  deleteCategory,
  moveCategory,
  normalizeSiteInput,
  orderedCategories,
  parseTags,
  removePrompt,
  removeRecipe,
  restorePrompt,
  toggleFavorite,
  toggleRecipe,
  upsertCategory,
  upsertPrompt,
  upsertRecipe,
  validatePromptDraft,
  viewPrompts,
} from '../src/popup/library.js';

/**
 * @typedef {import('../src/lib/storage.js').Prompt} Prompt
 * @typedef {import('../src/lib/storage.js').Recipe} Recipe
 */

/** @param {Partial<Prompt>} o @returns {Prompt} */
const prompt = (o) => ({
  id: 'p',
  title: 'T',
  text: 'body',
  createdAt: 0,
  useCount: 0,
  isFavorite: false,
  categoryId: null,
  tags: [],
  aspectRatio: null,
  quality: null,
  lastUsedAt: null,
  ...o,
});

const lib = [
  prompt({ id: 'a', title: 'Alpha', categoryId: 'c1', isFavorite: true, createdAt: 1 }),
  prompt({ id: 'b', title: 'Bravo', categoryId: 'c2', lastUsedAt: 50, createdAt: 2 }),
  prompt({
    id: 'c',
    title: 'Charlie',
    categoryId: 'c1',
    lastUsedAt: 90,
    createdAt: 3,
    tags: ['neon'],
  }),
];

describe('viewPrompts', () => {
  it('filters by view and category', () => {
    expect(viewPrompts(lib, { view: 'favorites' }).map((p) => p.id)).toEqual(['a']);
    expect(
      viewPrompts(lib, { view: 'category', categoryId: 'c1', sortBy: 'name' }).map((p) => p.id),
    ).toEqual(['a', 'c']);
  });
  it('recent view lists only used prompts, newest use first', () => {
    expect(viewPrompts(lib, { view: 'recent', sortBy: 'name' }).map((p) => p.id)).toEqual([
      'c',
      'b',
    ]);
  });
  it('recent view caps at RECENT_LIMIT', () => {
    const many = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) =>
      prompt({ id: `p${i}`, lastUsedAt: i + 1 }),
    );
    expect(viewPrompts(many, { view: 'recent' })).toHaveLength(RECENT_LIMIT);
  });
  it('applies search and sort', () => {
    expect(viewPrompts(lib, { view: 'all', query: 'neon' }).map((p) => p.id)).toEqual(['c']);
    expect(viewPrompts(lib, { view: 'all', sortBy: 'created' }).map((p) => p.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
  it('countByCategory', () => {
    const counts = countByCategory(lib);
    expect(counts.get('c1')).toBe(2);
    expect(counts.get('c2')).toBe(1);
  });
});

describe('prompts', () => {
  it('parseTags trims, strips #, dedupes case-insensitively, caps at 10', () => {
    expect(parseTags(' #Neon, neon , film noir,, ')).toEqual(['Neon', 'film noir']);
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
  });

  it('validatePromptDraft requires title and text', () => {
    expect(validatePromptDraft({ title: ' ', text: '' })).toEqual({
      title: expect.any(String),
      text: expect.any(String),
    });
    expect(validatePromptDraft({ title: 'x'.repeat(121), text: 'ok' }).title).toMatch(/120/);
    expect(validatePromptDraft({ title: 'Ok', text: 'ok' })).toEqual({});
  });

  it('upsertPrompt creates with defaults', () => {
    const next = upsertPrompt(
      lib,
      { title: '  New ', text: 'x', categoryId: '', tags: ['t'] },
      { id: 'n', now: 99 },
    );
    expect(next.at(-1)).toEqual(
      prompt({ id: 'n', title: 'New', text: 'x', createdAt: 99, tags: ['t'] }),
    );
  });

  it('upsertPrompt edits in place and keeps usage stats', () => {
    const next = upsertPrompt(
      lib,
      { title: 'B2', text: 'new', categoryId: 'c1', tags: [] },
      { id: 'b' },
    );
    expect(next[1]).toMatchObject({
      id: 'b',
      title: 'B2',
      text: 'new',
      categoryId: 'c1',
      lastUsedAt: 50,
      createdAt: 2,
    });
    expect(next).toHaveLength(3);
  });

  it('toggleFavorite flips one prompt', () => {
    expect(toggleFavorite(lib, 'b')[1].isFavorite).toBe(true);
    expect(toggleFavorite(lib, 'a')[0].isFavorite).toBe(false);
  });

  it('remove + restore puts the prompt back at its index', () => {
    const { prompts, removed, index } = removePrompt(lib, 'b');
    expect(prompts.map((p) => p.id)).toEqual(['a', 'c']);
    expect(index).toBe(1);
    expect(restorePrompt(prompts, /** @type {Prompt} */ (removed), index)).toEqual(lib);
    expect(removePrompt(lib, 'zz').removed).toBeNull();
  });
});

describe('categories', () => {
  const cats = [
    { id: 'c1', name: 'One', color: '#1', icon: '1', order: 1 },
    { id: 'c2', name: 'Two', color: '#2', icon: '2', order: 0 },
  ];
  it('upsertCategory appends with next order, or edits', () => {
    const added = upsertCategory(cats, { name: ' Three ', color: '#3', icon: '3' }, { id: 'c3' });
    expect(added.at(-1)).toEqual({ id: 'c3', name: 'Three', color: '#3', icon: '3', order: 2 });
    expect(upsertCategory(cats, { name: 'Uno', color: '#9', icon: '9' }, { id: 'c1' })[0]).toEqual({
      id: 'c1',
      name: 'Uno',
      color: '#9',
      icon: '9',
      order: 1,
    });
  });
  it('deleteCategory uncategorizes its prompts', () => {
    const out = deleteCategory({ prompts: lib, categories: cats }, 'c1');
    expect(out.categories.map((c) => c.id)).toEqual(['c2']);
    expect(out.prompts.filter((p) => p.categoryId === null).map((p) => p.id)).toEqual(['a', 'c']);
  });
  it('moveCategory reorders and renumbers; no-op at edges', () => {
    expect(orderedCategories(moveCategory(cats, 'c1', -1)).map((c) => [c.id, c.order])).toEqual([
      ['c1', 0],
      ['c2', 1],
    ]);
    expect(moveCategory(cats, 'c2', -1)).toBe(cats);
  });
});

describe('settings helpers', () => {
  it('normalizeSiteInput accepts hosts and URLs, rejects junk', () => {
    expect(normalizeSiteInput('example.com')).toBe('https://example.com');
    expect(normalizeSiteInput('http://localhost:8080/x?y')).toBe('http://localhost:8080');
    expect(normalizeSiteInput('chrome://extensions')).toBe('');
    expect(normalizeSiteInput('   ')).toBe('');
  });

  /** @type {Recipe} */
  const recipe = {
    originPattern: 'x.dev/*',
    promptInput: ['textarea'],
    submit: ['button'],
    selects: { aspect: 'select.a', quality: 'select.q' },
    qualityValues: ['hd'],
  };
  it('upsert enables; toggle disables; active reflects it; remove drops both', () => {
    const s1 = upsertRecipe({}, recipe);
    expect(activeRecipes(s1)).toEqual([recipe]);
    const s2 = { ...s1, ...toggleRecipe(s1, 'x.dev/*') };
    expect(activeRecipes(s2)).toEqual([]);
    expect(s2.siteRecipes).toHaveLength(1);
    const replaced = upsertRecipe(s2, { ...recipe, notes: 'v2' });
    expect(replaced.siteRecipes).toEqual([{ ...recipe, notes: 'v2' }]);
    expect(removeRecipe(replaced, 'x.dev/*')).toEqual({ siteRecipes: [], enabledRecipes: [] });
  });
});
