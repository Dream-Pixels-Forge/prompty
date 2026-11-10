import { describe, expect, it } from 'vitest';
import {
  DORMANT_DAYS,
  GRACE_DAYS,
  barShare,
  computeInsights,
  growthByMonth,
  recentVariables,
} from '../src/popup/insights.js';

/** @typedef {import('../src/lib/storage.js').Prompt} Prompt */
const DAY = 86_400_000;
const now = new Date(2026, 10, 10, 12).getTime(); // 10 Nov 2026, local
/**
 * @param {string} id
 * @param {Partial<Prompt>} [x]
 * @returns {Prompt}
 */
const P = (id, x = {}) => ({
  id,
  title: id,
  text: id,
  categoryId: null,
  tags: [],
  createdAt: now - 30 * DAY,
  useCount: 0,
  isFavorite: false,
  aspectRatio: null,
  quality: null,
  lastUsedAt: null,
  ...x,
});
const cats = [
  { id: 'L', name: 'Lighting', color: '#000', icon: '💡', order: 0 },
  { id: 'C', name: 'Camera', color: '#000', icon: '🎥', order: 1 },
];

describe('computeInsights', () => {
  const prompts = [
    P('a', { useCount: 9, categoryId: 'L', lastUsedAt: now - DAY, isFavorite: true }),
    P('b', { useCount: 9, categoryId: 'C', lastUsedAt: now - 2 * DAY }),
    P('c', { useCount: 3, categoryId: 'L', lastUsedAt: now - (DORMANT_DAYS + 1) * DAY }),
    P('d', { categoryId: 'gone' }),
    P('fresh', { createdAt: now - (GRACE_DAYS - 1) * DAY }),
  ];
  const out = computeInsights({ prompts, categories: cats }, { now });

  it('totals', () => {
    expect(out.totals).toEqual({ prompts: 5, uses: 21, favorites: 1, categories: 2 });
  });

  it('top prompts: by uses, ties broken by recency; unused excluded', () => {
    expect(out.topPrompts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('top categories sum uses; unknown category ids count as Uncategorized', () => {
    expect(out.topCategories).toEqual([
      { id: 'L', name: 'Lighting', icon: '💡', uses: 12, prompts: 2 },
      { id: 'C', name: 'Camera', icon: '🎥', uses: 9, prompts: 1 },
    ]);
  });

  it('never used skips brand-new prompts; dormant = used, then idle 90+ days', () => {
    expect(out.neverUsed.map((p) => p.id)).toEqual(['d']);
    expect(out.dormant.map((p) => p.id)).toEqual(['c']);
  });

  it('empty library', () => {
    const e = computeInsights({ prompts: [], categories: [] }, { now });
    expect(e.totals).toEqual({ prompts: 0, uses: 0, favorites: 0, categories: 0 });
    expect(e.topPrompts).toEqual([]);
    expect(e.growth.every((m) => m.added === 0)).toBe(true);
  });
});

describe('growthByMonth', () => {
  it('six calendar months ending this month, oldest first; older prompts ignored', () => {
    const g = growthByMonth(
      [
        P('x', { createdAt: new Date(2026, 10, 1).getTime() }),
        P('y', { createdAt: new Date(2026, 10, 9).getTime() }),
        P('z', { createdAt: new Date(2026, 5, 30).getTime() }),
        P('old', { createdAt: new Date(2026, 4, 31).getTime() }),
      ],
      now,
    );
    expect(g.map((m) => [m.label, m.added])).toEqual([
      ['Jun', 1],
      ['Jul', 0],
      ['Aug', 0],
      ['Sep', 0],
      ['Oct', 0],
      ['Nov', 2],
    ]);
  });

  it('crosses a year boundary', () => {
    const g = growthByMonth([], new Date(2027, 1, 3).getTime());
    expect(g.map((m) => m.key)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
});

describe('helpers', () => {
  it('recentVariables: most recent first, junk dropped', () => {
    expect(
      recentVariables(
        {
          lens: { value: '35mm', usedAt: 2 },
          hero: { value: 'a diver', usedAt: 5 },
          bad: { value: 1 },
        },
        5,
      ),
    ).toEqual([
      { name: 'hero', value: 'a diver', usedAt: 5 },
      { name: 'lens', value: '35mm', usedAt: 2 },
    ]);
    expect(recentVariables(null, 5)).toEqual([]);
  });

  it('barShare: proportional, small values stay visible, zero is zero', () => {
    expect(barShare(5, 10)).toBe(0.5);
    expect(barShare(1, 1000)).toBe(0.04);
    expect(barShare(0, 10)).toBe(0);
    expect(barShare(3, 0)).toBe(0);
  });
});
