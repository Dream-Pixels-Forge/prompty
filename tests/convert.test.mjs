import { describe, expect, it } from 'vitest';
import { convertVariant } from '../src/lib/prompt-sheet.js';

/**
 * Word-level diff: words removed (+) or added (-) between two strings.
 * Returns { removed: string[], added: string[] }.
 */
/** @param {string} a @param {string} b */
function wordDiff(a, b) {
  const aw = String(a ?? '').split(/\s+/).filter(Boolean);
  const bw = String(b ?? '').split(/\s+/).filter(Boolean);
  const removed = aw.filter((w) => !bw.includes(w));
  const added = bw.filter((w) => !aw.includes(w));
  return { removed, added };
}

/* ------------------------------------------------------------------ */
/* Muse → Seedance                                                    */
/* ------------------------------------------------------------------ */

describe('convertVariant Muse → Seedance', () => {
  it('strips Muse STOP. HARD CUT. ending, preserves content words', () => {
    const muse =
      'A dragon flies over the mountains, golden hour, cinematic. STOP. HARD CUT.';
    const result = convertVariant(muse, 'muse', 'seedance');
    expect(result.autoConverted).toBe(true);
    expect(result.sourceDialect).toBe('muse');
    expect(result.targetDialect).toBe('seedance');
    // Word-level diff of content: only cut markers changed
    const diff = wordDiff('A dragon flies over the mountains, golden hour, cinematic.', result.prompt);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
  });

  it('strips Muse STOP. ending (last shot)', () => {
    const muse = 'A dragon flies over the mountains. STOP.';
    const result = convertVariant(muse, 'muse', 'seedance');
    expect(result.prompt).toBe('A dragon flies over the mountains.');
  });

  it('strips Muse HARD CUT on a matching shape. ending (match cut)', () => {
    const muse =
      'A dragon flies over the mountains. HARD CUT on a matching shape.';
    const result = convertVariant(muse, 'muse', 'seedance');
    expect(result.prompt).toBe('A dragon flies over the mountains.');
  });

  it('preserves content when there are no cut markers (not auto-converted)', () => {
    const muse = 'A dragon flies over the mountains, golden hour.';
    const result = convertVariant(muse, 'muse', 'seedance');
    expect(result.prompt).toBe(muse);
    expect(result.autoConverted).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Seedance → Muse                                                    */
/* ------------------------------------------------------------------ */

describe('convertVariant Seedance → Muse', () => {
  it('strips Seedance At N seconds, cut prefix', () => {
    const seedance = 'At 4 seconds, hard cut. A dragon flies over the mountains.';
    const result = convertVariant(seedance, 'seedance', 'muse');
    expect(result.prompt).toBe('A dragon flies over the mountains.');
  });

  it('strips Seedance At N seconds, match cut prefix', () => {
    const seedance = 'At 4 seconds, match cut. A dragon flies over the mountains.';
    const result = convertVariant(seedance, 'seedance', 'muse');
    expect(result.prompt).toBe('A dragon flies over the mountains.');
  });

  it('preserves content words (word-level diff empty)', () => {
    const seedance = 'At 4 seconds, hard cut. A dragon flies over the mountains.';
    const result = convertVariant(seedance, 'seedance', 'muse');
    const diff = wordDiff('A dragon flies over the mountains.', result.prompt);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Neutral passthrough                                                */
/* ------------------------------------------------------------------ */

describe('convertVariant neutral', () => {
  it('neutral → neutral returns same content', () => {
    const neutral = 'A dragon flies over the mountains.';
    const result = convertVariant(neutral, null, null);
    expect(result.prompt).toBe(neutral);
  });

  it('unknown source dialect returns prompt unchanged', () => {
    const prompt = 'Some prompt text.';
    const result = convertVariant(prompt, 'unknown-dialect', 'muse');
    expect(result.prompt).toBe(prompt);
    expect(result.autoConverted).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Marked for review                                                  */
/* ------------------------------------------------------------------ */

describe('convertVariant review marking', () => {
  it('marks converted results as autoConverted', () => {
    const result = convertVariant('A dragon flies. STOP. HARD CUT.', 'muse', 'seedance');
    expect(result.autoConverted).toBe(true);
  });

  it('includes source and target dialect in result', () => {
    const result = convertVariant('A dragon flies. STOP.', 'muse', 'seedance');
    expect(result.sourceDialect).toBe('muse');
    expect(result.targetDialect).toBe('seedance');
  });
});
