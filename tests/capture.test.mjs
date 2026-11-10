import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_WINDOW_MS,
  MAX_TITLE,
  isRecentDuplicate,
  planSave,
  promptFromSelection,
  siteTag,
} from '../src/lib/capture.js';

const NOW = 1_800_000_000_000;

describe('siteTag', () => {
  it('uses the hostname without www', () => {
    expect(siteTag('https://www.example.com/a?b')).toBe('example.com');
    expect(siteTag('https://chat.openai.com/c/1')).toBe('chat.openai.com');
  });
  it('is empty for non-web or invalid URLs', () => {
    expect(siteTag('chrome://extensions')).toBe('');
    expect(siteTag('file:///tmp/a.pdf')).toBe('');
    expect(siteTag('')).toBe('');
    expect(siteTag(undefined)).toBe('');
  });
});

describe('promptFromSelection', () => {
  const base = { id: 'n1', now: NOW };

  it('titles from the page and tags the site', () => {
    const p = promptFromSelection({
      ...base,
      text: '  Neon rain on wet asphalt  ',
      pageTitle: 'Shot ideas — Notes',
      url: 'https://www.notes.dev/x',
    });
    expect(p).toEqual({
      id: 'n1',
      title: 'Shot ideas — Notes',
      text: 'Neon rain on wet asphalt',
      createdAt: NOW,
      useCount: 0,
      isFavorite: false,
      categoryId: null,
      tags: ['notes.dev'],
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
    });
  });

  it('falls back to the first line of the selection when the page has no title', () => {
    const p = promptFromSelection({
      ...base,
      text: 'First line\nsecond line',
      pageTitle: '   ',
      url: '',
    });
    expect(p?.title).toBe('First line');
    expect(p?.text).toBe('First line\nsecond line');
    expect(p?.tags).toEqual([]);
  });

  it('truncates long titles with an ellipsis and collapses whitespace', () => {
    const p = promptFromSelection({ ...base, text: 'x', pageTitle: `A\n\n${'b'.repeat(200)}` });
    expect(p?.title.length).toBe(MAX_TITLE);
    expect(p?.title.endsWith('…')).toBe(true);
    expect(p?.title.startsWith('A b')).toBe(true);
  });

  it('returns null for blank or non-string selections', () => {
    expect(promptFromSelection({ ...base, text: '   \n ' })).toBeNull();
    expect(promptFromSelection({ ...base, text: /** @type {any} */ (null) })).toBeNull();
  });
});

describe('isRecentDuplicate', () => {
  /** @param {string} text @param {number} createdAt */
  const prompt = (text, createdAt) => ({ text, createdAt });
  it('flags the same text saved within the window', () => {
    const prompts = [prompt('a', NOW - 60_000), prompt('Neon', NOW - 3_000)];
    expect(isRecentDuplicate(prompts, ' Neon ', NOW)).toBe(true);
  });
  it('allows the same text after the window, and different text anytime', () => {
    expect(isRecentDuplicate([prompt('Neon', NOW - DUPLICATE_WINDOW_MS - 1)], 'Neon', NOW)).toBe(
      false,
    );
    expect(isRecentDuplicate([prompt('Neon', NOW - 1_000)], 'Rain', NOW)).toBe(false);
    expect(isRecentDuplicate([], 'Neon', NOW)).toBe(false);
  });
});

describe('planSave', () => {
  it('saves, then treats an immediate repeat as a duplicate', () => {
    const first = planSave({ prompts: [], text: 'Rim light', pageTitle: 'P', id: 'a', now: NOW });
    expect(first.status).toBe('saved');
    const saved = first.status === 'saved' ? [first.prompt] : [];
    expect(planSave({ prompts: saved, text: 'Rim light', id: 'b', now: NOW + 2_000 }).status).toBe(
      'duplicate',
    );
    expect(planSave({ prompts: saved, text: 'Rim light', id: 'c', now: NOW + 20_000 }).status).toBe(
      'saved',
    );
  });
  it('reports empty selections', () => {
    expect(planSave({ prompts: [], text: '  ', id: 'x', now: NOW })).toEqual({ status: 'empty' });
  });
});
