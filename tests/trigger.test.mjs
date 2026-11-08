/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest';
import { fuzzyMatch, extractMatches, subsequenceScore } from '../src/lib/search.js';
import { extractVariables, humanizeVar, resolveVariables } from '../src/lib/variables.js';

describe('G1 Trigger-char quick-insert', () => {
  describe('fuzzyMatch (src/lib/search.js)', () => {
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

    it('matches subsequence across title and text (case-insensitive)', () => {
      const results = fuzzyMatch(items, 'pt', { keyFn, recencyFn, maxResults: 10 });
      expect(results.length).toBeGreaterThan(0);
      const titles = results.map(r => r.item.title);
      expect(titles).toContain('Character Prompt');
      expect(titles).toContain('Portrait Style');
      expect(titles).toContain('Paint Effect');
      expect(titles).toContain('Product Photo');
    });

    it('matches case-insensitively', () => {
      const results = fuzzyMatch(items, 'PT', { keyFn, recencyFn, maxResults: 10 });
      expect(results.length).toBeGreaterThan(0);
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
      const badItems = [{ id: '1' }, { id: '2', title: 'Valid' }];
      /** @param {{title?: string}} i */
      const results = fuzzyMatch(badItems, 'valid', { keyFn: (i) => i.title ?? '', maxResults: 10 });
      expect(results.length).toBe(1);
      expect(results[0].item.id).toBe('2');
    });
  });

  describe('extractMatches (highlighting)', () => {
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

  describe('subsequenceScore', () => {
    it('returns 1 for exact match', () => {
      expect(subsequenceScore('prompt', 'prompt')).toBe(1);
    });

    it('matches subsequence case-insensitively', () => {
      expect(subsequenceScore('Prompt Text', 'pt')).not.toBeNull();
      expect(subsequenceScore('PORTRAIT', 'pt')).not.toBeNull();
      expect(subsequenceScore('paint', 'pt')).not.toBeNull();
      expect(subsequenceScore('Product Photo', 'ph')).not.toBeNull();
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

    it('scores consecutive matches higher (compactness)', () => {
      const consecutive = subsequenceScore('port', 'pt');
      const spread = subsequenceScore('paint', 'pt');
      expect(consecutive).not.toBeNull();
      expect(spread).not.toBeNull();
      if (consecutive !== null && spread !== null) {
        expect(consecutive).toBeGreaterThan(spread);
      }
    });

    it('scores prefix matches higher', () => {
      const prefix = subsequenceScore('prompt', 'pr');
      const nonPrefix = subsequenceScore('xprompt', 'pr');
      expect(prefix).not.toBeNull();
      expect(nonPrefix).not.toBeNull();
      if (prefix !== null && nonPrefix !== null) {
        expect(prefix).toBeGreaterThan(nonPrefix);
      }
    });
  });

  describe('Variable helpers (src/lib/variables.js)', () => {
    it('extracts variables in order', () => {
      expect(extractVariables('A {subject} with {background}')).toEqual(['subject', 'background']);
    });

    it('dedupes repeated variables', () => {
      expect(extractVariables('{subject} and {subject}')).toEqual(['subject']);
    });

    it('ignores invalid tokens', () => {
      expect(extractVariables('{2x} {bad-name} {valid}')).toEqual(['valid']);
    });

    it('humanizes snake_case', () => {
      expect(humanizeVar('background_light')).toBe('Background Light');
    });

    it('humanizes camelCase', () => {
      expect(humanizeVar('keyLight')).toBe('Key Light');
    });

    it('resolves variables', () => {
      expect(resolveVariables('A {subject} with {background}', { subject: 'cat', background: 'forest' }))
        .toBe('A cat with forest');
    });

    it('leaves unknown variables literal', () => {
      expect(resolveVariables('A {subject} with {background}', { subject: 'cat' }))
        .toBe('A cat with {background}');
    });

    it('stringifies non-string values', () => {
      expect(resolveVariables('Count: {n}', { n: 42 })).toBe('Count: 42');
    });
  });

  describe('normalizeSettings logic (mirrors content script)', () => {
    // The content script's normalizeSettings is nearly identical to mergeSettings
    // with different defaults for quickTrigger and quickTriggerEnabled
    /**
     * @param {Record<string, unknown>} raw
     * @returns {{showFloatingWidget: boolean, disabledSites: string[], sortBy: string, compactMode: boolean, quickTrigger: string, quickTriggerEnabled: boolean}}
     */
    function normalizeSettingsForTest(raw) {
      const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const sortBy = record.sortBy;
      const quickTrigger = record.quickTrigger;
      return {
        showFloatingWidget: typeof record.showFloatingWidget === 'boolean' ? record.showFloatingWidget : true,
        disabledSites: Array.isArray(record.disabledSites)
          ? record.disabledSites.filter((v) => typeof v === 'string' && v.trim() !== '')
          : [],
        sortBy:
          sortBy === 'recent' || sortBy === 'created' || sortBy === 'name' || sortBy === 'mostUsed'
            ? String(sortBy)
            : 'recent',
        compactMode: typeof record.compactMode === 'boolean' ? record.compactMode : false,
        quickTrigger: typeof quickTrigger === 'string' && quickTrigger.length === 1 ? quickTrigger : '!',
        quickTriggerEnabled: typeof record.quickTriggerEnabled === 'boolean' ? record.quickTriggerEnabled : true,
      };
    }

    it('defaults quickTrigger to "!"', () => {
      const settings = normalizeSettingsForTest({});
      expect(settings.quickTrigger).toBe('!');
    });

    it('defaults quickTriggerEnabled to true', () => {
      const settings = normalizeSettingsForTest({});
      expect(settings.quickTriggerEnabled).toBe(true);
    });

    it('accepts custom quickTrigger (single char)', () => {
      const settings = normalizeSettingsForTest({ quickTrigger: '/' });
      expect(settings.quickTrigger).toBe('/');
    });

    it('rejects multi-char quickTrigger, falls back to default', () => {
      const settings = normalizeSettingsForTest({ quickTrigger: '!!' });
      expect(settings.quickTrigger).toBe('!');
    });

    it('rejects non-string quickTrigger, falls back to default', () => {
      const settings = normalizeSettingsForTest({ quickTrigger: 123 });
      expect(settings.quickTrigger).toBe('!');
    });

    it('accepts quickTriggerEnabled false', () => {
      const settings = normalizeSettingsForTest({ quickTriggerEnabled: false });
      expect(settings.quickTriggerEnabled).toBe(false);
    });

    it('rejects non-boolean quickTriggerEnabled, falls back to default', () => {
      const settings = normalizeSettingsForTest({ quickTriggerEnabled: 'yes' });
      expect(settings.quickTriggerEnabled).toBe(true);
    });

    it('preserves other settings', () => {
      const settings = normalizeSettingsForTest({
        showFloatingWidget: false,
        disabledSites: ['https://example.com'],
        sortBy: 'name',
        compactMode: true,
      });
      expect(settings.showFloatingWidget).toBe(false);
      expect(settings.disabledSites).toEqual(['https://example.com']);
      expect(settings.sortBy).toBe('name');
      expect(settings.compactMode).toBe(true);
    });
  });

  describe('Trigger state machine (boundary detection logic)', () => {
    /**
     * @param {{value: string}} textarea
     * @param {number} selectionStart
     * @returns {boolean}
     */
    function isAtWordBoundary(textarea, selectionStart) {
      if (selectionStart === 0) return true;
      const charBefore = textarea.value[selectionStart - 1];
      return /\s/.test(charBefore);
    }

    /**
     * @param {{textContent: string | null | undefined}} textNode
     * @param {number} offset
     * @returns {boolean}
     */
    function isAtWordBoundaryContentEditable(textNode, offset) {
      if (offset === 0) return true;
      const text = textNode.textContent || '';
      if (offset > 0 && offset <= text.length) {
        const charBefore = text[offset - 1];
        return /\s/.test(charBefore);
      }
      return true;
    }

    it('detects boundary at start of textarea', () => {
      const ta = { value: 'hello' };
      expect(isAtWordBoundary(ta, 0)).toBe(true);
    });

    it('detects boundary after space in textarea', () => {
      const ta = { value: 'hello world' };
      expect(isAtWordBoundary(ta, 6)).toBe(true);
    });

    it('detects boundary after newline in textarea', () => {
      const ta = { value: 'hello\nworld' };
      expect(isAtWordBoundary(ta, 6)).toBe(true);
    });

    it('detects boundary after tab in textarea', () => {
      const ta = { value: 'hello\tworld' };
      expect(isAtWordBoundary(ta, 6)).toBe(true);
    });

    it('rejects boundary in middle of word in textarea', () => {
      const ta = { value: 'helloworld' };
      expect(isAtWordBoundary(ta, 5)).toBe(false);
    });

    it('detects boundary at start of contenteditable text node', () => {
      const node = { textContent: 'hello' };
      expect(isAtWordBoundaryContentEditable(node, 0)).toBe(true);
    });

    it('detects boundary after space in contenteditable', () => {
      const node = { textContent: 'hello world' };
      expect(isAtWordBoundaryContentEditable(node, 6)).toBe(true);
    });

    it('rejects boundary in middle of word in contenteditable', () => {
      const node = { textContent: 'helloworld' };
      expect(isAtWordBoundaryContentEditable(node, 5)).toBe(false);
    });
  });
});