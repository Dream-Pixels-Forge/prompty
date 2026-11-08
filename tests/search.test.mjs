import { describe, expect, it } from 'vitest';
import { subsequenceScore, extractMatches, fuzzyMatch } from '../src/lib/search.js';

describe('subsequenceScore', () => {
  it('returns 1 for exact match', () => {
    expect(subsequenceScore('prompt', 'prompt')).toBe(1);
  });

  it('returns high score for prefix match', () => {
    const score = subsequenceScore('prompt text', 'pt');
    expect(score).not.toBeNull();
    if (score !== null) expect(score).toBeGreaterThan(0.5);
  });

  it('matches subsequence case-insensitively', () => {
    expect(subsequenceScore('Prompt Text', 'pt')).not.toBeNull();
    expect(subsequenceScore('PORTRAIT', 'pt')).not.toBeNull();
    expect(subsequenceScore('paint', 'pt')).not.toBeNull();
  });

  it('returns null when query is not a subsequence', () => {
    expect(subsequenceScore('hello', 'xyz')).toBeNull();
    expect(subsequenceScore('abc', 'abcd')).toBeNull();
  });

  it('returns 1 for empty query', () => {
    expect(subsequenceScore('anything', '')).toBe(1);
  });

  it('returns null for empty target with non-empty query', () => {
    expect(subsequenceScore('', 'a')).toBeNull();
  });

  it('scores earlier matches higher', () => {
    const early = subsequenceScore('prompt', 'pt');
    const late = subsequenceScore('xprompt', 'pt');
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    if (early !== null && late !== null) {
      expect(early).toBeGreaterThan(late);
    }
  });

  it('scores consecutive matches higher', () => {
    const consecutive = subsequenceScore('port', 'pt');
    const spread = subsequenceScore('paint', 'pt');
    expect(consecutive).not.toBeNull();
    expect(spread).not.toBeNull();
    if (consecutive !== null && spread !== null) {
      expect(consecutive).toBeGreaterThan(spread);
    }
  });
});

describe('extractMatches', () => {
  it('returns ranges for matched characters', () => {
    const ranges = extractMatches('prompt text', 'pt');
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0]).toHaveProperty('start');
    expect(ranges[0]).toHaveProperty('end');
  });

  it('returns empty array for non-matching query', () => {
    expect(extractMatches('hello', 'xyz')).toEqual([]);
  });

  it('returns empty array for empty query', () => {
    expect(extractMatches('hello', '')).toEqual([]);
  });

  it('groups consecutive matches', () => {
    const ranges = extractMatches('portrait', 'port');
    expect(ranges).toEqual([{ start: 0, end: 4 }]);
  });

  it('splits non-consecutive matches', () => {
    const ranges = extractMatches('paint', 'pt');
    expect(ranges).toEqual([{ start: 0, end: 1 }, { start: 4, end: 5 }]);
  });

  it('is case-insensitive', () => {
    const upper = extractMatches('PROMPT', 'pt');
    const lower = extractMatches('prompt', 'pt');
    expect(upper).toEqual(lower);
  });

  it('handles multiple separate matches', () => {
    const ranges = extractMatches('prompt text here', 'pth');
    expect(ranges.length).toBe(3);
  });
});

describe('fuzzyMatch', () => {
  /** @type {Array<{id: string, title: string, text: string, lastUsedAt: number}>} */
  const items = [
    { id: '1', title: 'Character Prompt', text: 'A detailed character description', lastUsedAt: 1000 },
    { id: '2', title: 'Portrait Style', text: 'Portrait photography settings', lastUsedAt: 2000 },
    { id: '3', title: 'Paint Effect', text: 'Digital painting style', lastUsedAt: 3000 },
    { id: '4', title: 'Product Photo', text: 'Product photography prompt', lastUsedAt: 4000 },
    { id: '5', title: 'Landscape', text: 'Nature landscape prompt', lastUsedAt: 5000 },
  ];

  /** @param {{title: string, text: string}} item */
  const keyFn = (item) => `${item.title} ${item.text}`;
  /** @param {{lastUsedAt: number}} item */
  const recencyFn = (item) => item.lastUsedAt;

  it('returns empty array for non-matching query', () => {
    const results = fuzzyMatch(items, 'xyz', { keyFn, recencyFn, maxResults: 10 });
    expect(results).toEqual([]);
  });

  it('matches subsequence across title and text', () => {
    const results = fuzzyMatch(items, 'pt', { keyFn, recencyFn, maxResults: 10 });
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map(r => r.item.title);
    expect(titles).toContain('Character Prompt');
    expect(titles).toContain('Portrait Style');
    expect(titles).toContain('Paint Effect');
    expect(titles).toContain('Product Photo');
  });

  it('respects maxResults limit', () => {
    const results = fuzzyMatch(items, 'p', { keyFn, recencyFn, maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('sorts by score descending', () => {
    const results = fuzzyMatch(items, 'port', { keyFn, recencyFn, maxResults: 10 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('boosts recent items when recencyFn provided', () => {
    const results = fuzzyMatch(items, 'pho', { keyFn, recencyFn, maxResults: 10 });
    const titles = results.map(r => r.item.title);
    const productIdx = titles.indexOf('Product Photo');
    const portraitIdx = titles.indexOf('Portrait Style');
    if (productIdx !== -1 && portraitIdx !== -1) {
      expect(productIdx).toBeLessThan(portraitIdx);
    }
  });

  it('works without recencyFn', () => {
    const results = fuzzyMatch(items, 'pt', { keyFn, maxResults: 10 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns all items (up to maxResults) for empty query, sorted by recency', () => {
    const results = fuzzyMatch(items, '', { keyFn, recencyFn, maxResults: 10 });
    expect(results.length).toBe(5);
    expect(results[0].item.title).toBe('Landscape');
    expect(results[1].item.title).toBe('Product Photo');
  });

  it('handles items with missing key gracefully', () => {
    /** @type {Array<{id: string, title?: string}>} */
    const badItems = [{ id: '1' }, { id: '2', title: 'Valid' }];
    /** @param {{title?: string}} i */
    const results = fuzzyMatch(badItems, 'valid', { keyFn: (i) => i.title ?? '', maxResults: 10 });
    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('2');
  });
});