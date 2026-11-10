import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  CATEGORY_EMOJIS,
  SORT_OPTIONS,
  applyImportData,
  buildExport,
  chipsFor,
  filterPrompts,
  parseImport,
  relativeTime,
  sortPrompts,
  varCount,
} from '../src/popup/logic.js';
import { SNIPPET_CAP, appendSnippet } from '../src/lib/storage.js';

/**
 * @typedef {import('../src/lib/storage.js').Prompt} Prompt
 * @typedef {import('../src/lib/storage.js').Category} Category
 * @typedef {import('../src/lib/storage.js').Settings} Settings
 */

/** @param {Partial<Prompt>} overrides */
const prompt = (overrides) => ({
  id: 'p1',
  title: 'Title',
  text: 'Body text',
  createdAt: 1000,
  useCount: 0,
  isFavorite: false,
  categoryId: null,
  tags: [],
  aspectRatio: null,
  quality: null,
  lastUsedAt: null,
  ...overrides,
});

describe('popup constants', () => {
  it('exposes 18 category colors and 36 category emojis (SPEC §1 + cinematic pack)', () => {
    expect(CATEGORY_COLORS).toHaveLength(18);
    expect(CATEGORY_EMOJIS).toHaveLength(36);
    expect(new Set(CATEGORY_COLORS).size).toBe(18);
    expect(new Set(CATEGORY_EMOJIS).size).toBe(36);
  });

  it('exposes the four SPEC sorts', () => {
    expect(SORT_OPTIONS.map((option) => option.id)).toEqual([
      'recent',
      'created',
      'name',
      'mostUsed',
    ]);
  });
});

describe('filterPrompts', () => {
  const items = [
    prompt({ id: 'a', title: 'Portrait Knight', text: 'full body shot', tags: ['hero'] }),
    prompt({ id: 'b', title: 'Landscape', text: 'wide scenic view', tags: ['nature', 'wide'] }),
    prompt({ id: 'c', title: 'Knight Wide Shot', text: 'establishing frame', tags: [] }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterPrompts(items, '')).toHaveLength(3);
    expect(filterPrompts(items, '   ')).toHaveLength(3);
    expect(filterPrompts([], 'anything')).toEqual([]);
  });

  it('searches case-insensitively across title, text and tags', () => {
    expect(filterPrompts(items, 'portrait').map((p) => p.id)).toEqual(['a']);
    expect(filterPrompts(items, 'SCENIC').map((p) => p.id)).toEqual(['b']);
    expect(filterPrompts(items, 'hero').map((p) => p.id)).toEqual(['a']);
  });

  it('ANDs multiple whitespace-separated terms', () => {
    // Both 'a' (Portrait Knight + full body shot) and 'c' (Knight Wide Shot) match
    expect(filterPrompts(items, 'knight shot').map((p) => p.id).sort()).toEqual(['a', 'c']);
    // Only 'c' has all three: knight, shot, establishing
    expect(filterPrompts(items, 'knight shot establishing').map((p) => p.id)).toEqual(['c']);
    expect(filterPrompts(items, 'knight missingterm')).toEqual([]);
  });

  it('works as a snippet search (same contract over plain items)', () => {
    const snippets = [
      /** @type {any} */ ({ title: 'clip one', text: 'a', tags: [] }),
      /** @type {any} */ ({ title: 'clip two', text: 'b', tags: [] }),
    ];
    expect(filterPrompts(snippets, 'one').map((p) => p.title)).toEqual(['clip one']);
  });

  it('never mutates the input array', () => {
    const snapshot = JSON.stringify(items);
    filterPrompts(items, 'knight');
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('sortPrompts', () => {
  const items = [
    prompt({ id: 'recent', title: 'Beta', createdAt: 1000, lastUsedAt: 5000 }),
    prompt({ id: 'created', title: 'alpha', createdAt: 9000, lastUsedAt: null }),
    prompt({ id: 'used', title: 'Gamma', createdAt: 2000, useCount: 42 }),
    prompt({ id: 'old', title: 'Delta', createdAt: 3000, useCount: 1 }),
  ];

  it('sorts by recent activity, falling back to createdAt', () => {
    expect(sortPrompts(items, 'recent').map((p) => p.id)).toEqual([
      'created',
      'recent',
      'old',
      'used',
    ]);
  });

  it('sorts newest-created first', () => {
    expect(sortPrompts(items, 'created').map((p) => p.id)).toEqual([
      'created',
      'old',
      'used',
      'recent',
    ]);
  });

  it('sorts by title A→Z, case-insensitively', () => {
    // Alphabetical (case-insensitive): 'alpha' < 'Beta' < 'Delta' < 'Gamma'
    expect(sortPrompts(items, 'name').map((p) => p.id)).toEqual([
      'created',
      'recent',
      'old',
      'used',
    ]);
  });

  it('sorts by most-used with recent-activity tiebreak', () => {
    expect(sortPrompts(items, 'mostUsed').map((p) => p.id)).toEqual([
      'used',
      'old',
      'created',
      'recent',
    ]);
  });

  it('tolerates an unknown sort id (no-op order = recent default)', () => {
    expect(sortPrompts(items, 'nope').map((p) => p.id)).toEqual(
      sortPrompts(items, 'recent').map((p) => p.id),
    );
  });

  it('returns a new array (inputs untouched)', () => {
    const sorted = sortPrompts(items, 'name');
    expect(sorted).not.toBe(items);
    expect(items[0].id).toBe('recent');
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;

  it('labels sub-minute gaps "just now"', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
  });

  it('labels minutes and hours', () => {
    expect(relativeTime(now - minute * 3, now)).toBe('3m ago');
    expect(relativeTime(now - hour * 2, now)).toBe('2h ago');
  });

  it('labels days up to a week, then an absolute date', () => {
    expect(relativeTime(now - day * 6, now)).toBe('6d ago');
    expect(relativeTime(now - day * 8, now)).toBe(
      new Date(now - day * 8).toLocaleDateString(),
    );
  });

  it('never yields negative labels for future timestamps', () => {
    expect(relativeTime(now + minute, now)).toBe('just now');
  });

  it('falls back for missing timestamps', () => {
    expect(relativeTime(null, now)).toBe('—');
  });
});

describe('varCount / chipsFor', () => {
  it('reuses lib/variables extraction for the badge count', () => {
    expect(varCount('a {subject} and {subject} plus {x_1}')).toBe(2);
    expect(varCount('plain')).toBe(0);
    expect(varCount(null)).toBe(0);
  });

  it('keeps at most 2 tag chips', () => {
    expect(chipsFor(['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(chipsFor(['only'])).toEqual(['only']);
    expect(chipsFor([])).toEqual([]);
  });
});

describe('buildExport', () => {
  it('emits the SPEC §1 export envelope', () => {
    const library = {
      prompts: [prompt({})],
      categories: [],
      settings: { sortBy: 'name' },
    };
    const body = buildExport(
      /** @type {any} */ (library),
      { now: 5555, version: '0.2.0' },
    );
    expect(Object.keys(body).sort()).toEqual(
      ['categories', 'exportedAt', 'prompts', 'settings', 'version'].sort(),
    );
    expect(body.version).toBe('0.2.0');
    expect(body.exportedAt).toBe(5555);
    expect(body.prompts).toHaveLength(1);
  });
});

describe('parseImport + applyImportData', () => {
  it('rejects garbage / non-envelope JSON', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport('[1,2,3]').ok).toBe(false);
    expect(parseImport('42').ok).toBe(false);
    expect(parseImport('{}').ok).toBe(false);
  });

  it('rejects envelopes whose arrays are not arrays', () => {
    expect(parseImport('{"prompts": "oops"}').ok).toBe(false);
    expect(parseImport('{"prompts": [], "categories": "nope"}').ok).toBe(false);
  });

  it('accepts prompts-only or categories-only imports', () => {
    const promptsOnly = parseImport('{"prompts": [{"title": "T", "text": "B"}]}');
    expect(promptsOnly.ok).toBe(true);
    const catsOnly = parseImport('{"categories": [{"name": "N", "color": "#000", "icon": "x"}]}');
    expect(catsOnly.ok).toBe(true);
  });

  it('REPLACE mode swaps the library wholesale via storage normalizers', () => {
    const existing = {
      prompts: [prompt({ id: 'old1', title: 'Old' })],
      categories: [],
      settings: { sortBy: 'name', compactMode: true },
    };
    const data = {
      prompts: [{ id: 'new1', title: 'New', text: 'B' }],
      categories: [{ id: 'c1', name: 'Cats', color: '#8b5cf6', icon: '👤', order: 0 }],
      settings: { sortBy: 'mostUsed' },
    };
    const next = applyImportData(
      /** @type {any} */ (data),
      /** @type {any} */ (existing),
      'replace',
    );
    expect(next.prompts.map((p) => p.id)).toEqual(['new1']);
    expect(next.categories.map((c) => c.id)).toEqual(['c1']);
    // settings adopt the import but keep SPEC defaults untouched elsewhere
    expect(next.settings.sortBy).toBe('mostUsed');
    expect(next.settings.compactMode).toBe(false);
    expect('prototypeKey' in next.settings).toBe(false);
  });

  it('MERGE mode unions by id with incoming winning collisions', () => {
    const existing = {
      prompts: [
        prompt({ id: 'shared', title: 'Older', text: 'old' }),
        prompt({ id: 'mine', title: 'Mine', text: 'keep' }),
      ],
      categories: [],
      settings: {},
    };
    const next = applyImportData(
      {
        prompts: [
          { id: 'shared', title: 'Imported', text: 'fresh' },
          { id: 'extra', title: 'Extra', text: 'x' },
        ],
      },
      /** @type {any} */ (existing),
      'merge',
    );
    expect(next.prompts.map((p) => p.id)).toEqual(['mine', 'shared', 'extra']);
    expect(next.categories).toEqual([]);
    expect(next.settings.sortBy).toBe(SORT_OPTIONS[0].id);
  });

  it('drops invalid entries in both modes', () => {
    const data = { prompts: [{ title: 'ok', text: 'b' }, 'garbage', 42] };
    const next = applyImportData(
      /** @type {any} */ (data),
      /** @type {any} */ ({ prompts: [], categories: [], settings: {} }),
      'replace',
    );
    expect(next.prompts).toHaveLength(1);
  });
});

describe('snippet helpers (storage.js composition)', () => {
  it('appendSnippet caps history FIFO at 50 with dedupe of consecutive text', () => {
    /** @type {import('../src/lib/storage.js').Snippet[]} */
    let snippets = [];
    for (let i = 0; i < SNIPPET_CAP + 5; i++) {
      snippets = appendSnippet(snippets, { text: `s${i}`, sourceOrigin: 'https://x' });
    }
    expect(snippets).toHaveLength(SNIPPET_CAP);
    expect(snippets[0].text).toBe('s5'); // oldest dropped first
    expect(snippets[SNIPPET_CAP - 1].text).toBe(`s${SNIPPET_CAP + 4}`);
    const before = snippets.length;
    snippets = appendSnippet(snippets, { text: `s${SNIPPET_CAP + 4}`, sourceOrigin: '' });
    expect(snippets).toHaveLength(before); // consecutive duplicate rejected
  });
});
