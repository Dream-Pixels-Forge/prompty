import { describe, expect, it } from 'vitest';
import {
  listWrappers,
  getWrapper,
  wrapPrompt,
  normalizeWrapper,
} from '../src/lib/wrappers.js';

/** @typedef {{ id: string, label: string, template: string, notes: string, source: string }} Wrapper */

/* ------------------------------------------------------------------ */
/* Catalog                                                            */
/* ------------------------------------------------------------------ */

describe('listWrappers', () => {
  it('ships the meta-ai-pass-through wrapper', () => {
    /** @type {Wrapper[]} */
    const wrappers = listWrappers();
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].id).toBe('meta-ai-pass-through');
    expect(wrappers[0].label).toBe('Meta AI pass-through');
    expect(typeof wrappers[0].template).toBe('string');
    expect(wrappers[0].template.length).toBeGreaterThan(0);
  });

  it('returns copies, so mutating one does not affect the catalog', () => {
    /** @type {Wrapper[]} */
    const a = listWrappers();
    /** @type {Wrapper[]} */
    const b = listWrappers();
    a[0].label = 'mutated';
    expect(b[0].label).toBe('Meta AI pass-through');
  });

  it('every wrapper has the required fields', () => {
    /** @type {Wrapper[]} */
    const all = listWrappers();
    for (const w of all) {
      expect(typeof w.id).toBe('string');
      expect(typeof w.label).toBe('string');
      expect(typeof w.template).toBe('string');
      expect(typeof w.notes).toBe('string');
      expect(typeof w.source).toBe('string');
    }
  });
});

describe('getWrapper', () => {
  it('returns the wrapper by id', () => {
    /** @type {Wrapper|undefined} */
    const w = getWrapper('meta-ai-pass-through');
    expect(w?.id).toBe('meta-ai-pass-through');
  });

  it('returns undefined for unknown ids', () => {
    expect(getWrapper('nope')).toBeUndefined();
    expect(getWrapper('')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* wrapPrompt                                                         */
/* ------------------------------------------------------------------ */

describe('wrapPrompt', () => {
  it('wraps a prompt with meta-ai-pass-through', () => {
    const wrapped = wrapPrompt('A dragon flies over the mountains', 'meta-ai-pass-through');
    expect(wrapped).toContain('VIDEO GENERATION — PASS-THROUGH MODE.');
    expect(wrapped).toContain('<<<PROMPT');
    expect(wrapped).toContain('PROMPT>>>');
    expect(wrapped).toContain('A dragon flies over the mountains');
    expect(wrapped.split('{prompt}').length).toBe(1);
  });

  it('returns the prompt unchanged for null/unknown wrapper', () => {
    const prompt = 'A dragon flies over the mountains';
    expect(wrapPrompt(prompt, null)).toBe(prompt);
    expect(wrapPrompt(prompt, undefined)).toBe(prompt);
    expect(wrapPrompt(prompt, 'nope')).toBe(prompt);
  });

  it('handles empty prompt', () => {
    const wrapped = wrapPrompt('', 'meta-ai-pass-through');
    expect(wrapped).toContain('<<<PROMPT');
    expect(wrapped).toContain('PROMPT>>>');
  });
});

/* ------------------------------------------------------------------ */
/* normalizeWrapper                                                   */
/* ------------------------------------------------------------------ */

describe('normalizeWrapper', () => {
  it('keeps a valid wrapper and drops unknown fields', () => {
    const w = normalizeWrapper({
      id: 'meta-ai-pass-through',
      label: 'Meta AI pass-through',
      template: '<<<PROMPT\n{prompt}\nPROMPT>>>',
      notes: 'x',
      source: 'fixture',
      bogus: 'dropped',
    });
    if (!w) throw new Error('normalizeWrapper returned null for a valid wrapper');
    /** @type {Wrapper} */
    const ww = w;
    expect(ww).not.toHaveProperty('bogus');
    expect(ww.template).toBe('<<<PROMPT\n{prompt}\nPROMPT>>>');
  });

  it('rejects non-object input', () => {
    expect(normalizeWrapper(null)).toBeNull();
    expect(normalizeWrapper('nope')).toBeNull();
    expect(normalizeWrapper(42)).toBeNull();
  });

  it('requires an id', () => {
    expect(normalizeWrapper({ label: 'No id' })).toBeNull();
  });

  it('requires a template', () => {
    expect(normalizeWrapper({ id: 'x', label: 'X', template: '' })).toBeNull();
  });

  it('defaults missing optional fields', () => {
    const w = normalizeWrapper({
      id: 'custom',
      label: 'Custom',
      template: '<<<{prompt}>>>',
      notes: undefined,
      source: undefined,
    });
    if (!w) throw new Error('normalizeWrapper returned null');
    /** @type {Wrapper} */
    const ww = w;
    expect(ww.notes).toBe('');
    expect(ww.source).toBe('');
  });
});
