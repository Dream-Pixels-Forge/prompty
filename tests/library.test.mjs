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
  restoreVersion,
  restorePrompt,
  toggleFavorite,
  toggleRecipe,
  upsertCategory,
  upsertPrompt,
  upsertRecipe,
  validatePromptDraft,
  viewPrompts,
  withVersion,
} from '../src/popup/library.js';
import { MAX_VERSIONS } from '../src/lib/storage.js';

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

describe('version history (G5)', () => {
  const base = prompt({ id: 'v', title: 'Dolly', text: 'push in slowly' });
  const draft = (/** @type {Partial<import('../src/popup/library.js').PromptDraft>} */ d) => ({
    title: 'Dolly',
    text: 'push in slowly',
    categoryId: null,
    tags: [],
    ...d,
  });

  it('a text or title edit keeps the previous title/text as the newest version', () => {
    const [p] = upsertPrompt([base], draft({ text: 'push in fast' }), { id: 'v', now: 10 });
    expect(p.text).toBe('push in fast');
    expect(p.versions).toEqual([{ text: 'push in slowly', title: 'Dolly', editedAt: 10 }]);
    const [q] = upsertPrompt([p], draft({ title: 'Dolly v2', text: 'push in fast' }), {
      id: 'v',
      now: 20,
    });
    expect(q.versions?.map((x) => x.editedAt)).toEqual([20, 10]);
    expect(q.versions?.[0]).toMatchObject({ title: 'Dolly', text: 'push in fast' });
  });

  it('tags, category or favorite changes alone are not versions', () => {
    const [p] = upsertPrompt([base], draft({ tags: ['x'], categoryId: 'c1', isFavorite: true }), {
      id: 'v',
      now: 10,
    });
    expect(p.versions).toBeUndefined();
    expect(withVersion(base, { title: 'Dolly', text: 'push in slowly' }, 5)).toBe(base);
  });

  it('caps history at MAX_VERSIONS, dropping the oldest', () => {
    let list = [base];
    for (let i = 1; i <= MAX_VERSIONS + 3; i++)
      list = upsertPrompt(list, draft({ text: `take ${i}` }), { id: 'v', now: i });
    const [p] = list;
    expect(p.versions).toHaveLength(MAX_VERSIONS);
    expect(p.versions?.[0].text).toBe(`take ${MAX_VERSIONS + 2}`);
    expect(p.versions?.at(-1)?.editedAt).toBe(4);
  });

  it('restore applies the version and saves the current text first (nothing is lost)', () => {
    const [p] = upsertPrompt([base], draft({ title: 'Dolly 2', text: 'whip pan' }), {
      id: 'v',
      now: 10,
    });
    const [r] = restoreVersion([p], 'v', 0, 30);
    expect(r).toMatchObject({ title: 'Dolly', text: 'push in slowly' });
    expect(r.versions?.map((x) => x.text)).toEqual(['whip pan', 'push in slowly']);
    // and restoring back is exact
    const [back] = restoreVersion([r], 'v', 0, 40);
    expect(back).toMatchObject({ title: 'Dolly 2', text: 'whip pan' });
    expect(back.versions).toHaveLength(3);
  });

  it('restore ignores unknown prompts and indexes', () => {
    const list = [base];
    expect(restoreVersion(list, 'v', 0)).toEqual(list);
    expect(restoreVersion(list, 'nope', 0)).toEqual(list);
  });

  it('a full 20-version history of 2 KB prompts stays small in storage', () => {
    const text = 'x'.repeat(2048);
    const p = {
      ...base,
      text,
      versions: Array.from({ length: MAX_VERSIONS }, (_, i) => ({ text, title: 'T', editedAt: i })),
    };
    expect(JSON.stringify(p).length).toBeLessThan(50_000); // a tiny fraction of storage.local's quota
  });
});
