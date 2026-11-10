import { describe, expect, it } from 'vitest';
import { diffWords, sides, tokenize } from '../src/lib/diff.js';

/** @param {ReturnType<typeof diffWords>} ops @param {string[]} keep */
const rejoin = (ops, keep) =>
  ops
    .filter((o) => keep.includes(o.op))
    .map((o) => o.text)
    .join('');

describe('tokenize', () => {
  it('splits words, punctuation and whitespace, losslessly', () => {
    const text = 'Slow push-in,  on {subject}.\nNeon!';
    expect(tokenize(text).join('')).toBe(text);
    expect(tokenize('a, b')).toEqual(['a', ',', ' ', 'b']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('diffWords', () => {
  it('identical texts are one "same" run', () => {
    expect(diffWords('wide shot of a city', 'wide shot of a city')).toEqual([
      { op: 'same', text: 'wide shot of a city' },
    ]);
  });

  it('marks an inserted word', () => {
    const ops = diffWords('soft rim light', 'soft blue rim light');
    expect(ops).toEqual([
      { op: 'same', text: 'soft ' },
      { op: 'add', text: 'blue ' },
      { op: 'same', text: 'rim light' },
    ]);
  });

  it('marks a deleted word and a replaced word', () => {
    expect(diffWords('85mm f/1.4 portrait', '85mm portrait')).toEqual([
      { op: 'same', text: '85mm ' },
      { op: 'del', text: 'f/1.4 ' },
      { op: 'same', text: 'portrait' },
    ]);
    const ops = diffWords('golden hour light', 'blue hour light');
    expect(ops.filter((o) => o.op !== 'same')).toEqual([
      { op: 'del', text: 'golden' },
      { op: 'add', text: 'blue' },
    ]);
  });

  it('handles reordering and punctuation, and always re-joins both sides exactly', () => {
    const pairs = [
      ['camera orbits, then cranes up.', 'camera cranes up, then orbits.'],
      ['', 'brand new text'],
      ['all of it goes', ''],
      ['line one\nline two', 'line one\n\nline 2!'],
    ];
    for (const [a, b] of pairs) {
      const ops = diffWords(a, b);
      expect(rejoin(ops, ['same', 'del'])).toBe(a);
      expect(rejoin(ops, ['same', 'add'])).toBe(b);
    }
  });

  it('past the size limit, diffs the changed middle coarsely instead of running O(n·m) LCS', () => {
    // Structural, not wall-clock: a timing assertion flaked under load.
    const a = `intro ${'alpha '.repeat(1500)}${'beta '.repeat(1500)}outro`;
    const b = `intro ${'beta '.repeat(1500)}${'alpha '.repeat(1500)}outro`;
    const ops = diffWords(a, b);
    expect(ops.map((o) => o.op)).toEqual(['same', 'del', 'add', 'same']);
    expect(rejoin(ops, ['same', 'del'])).toBe(a);
    expect(rejoin(ops, ['same', 'add'])).toBe(b);
  });
});

describe('phrasing', () => {
  it('groups nearby word changes into one phrase per side', () => {
    const ops = diffWords(
      'the camera tracks backward while zooming in',
      'the camera pulls back on a slow dolly while the lens zooms in',
    );
    expect(ops).toEqual([
      { op: 'same', text: 'the camera ' },
      { op: 'del', text: 'tracks backward' },
      { op: 'add', text: 'pulls back on a slow dolly' },
      { op: 'same', text: ' while ' },
      { op: 'del', text: 'zooming' },
      { op: 'add', text: 'the lens zooms' },
      { op: 'same', text: ' in' },
    ]);
  });
});

describe('sides', () => {
  it('splits ops into old/new columns for a side-by-side view', () => {
    const { before, after } = sides(diffWords('a b c', 'a x c'));
    expect(before).toEqual([
      { op: 'same', text: 'a ' },
      { op: 'del', text: 'b' },
      { op: 'same', text: ' c' },
    ]);
    expect(after).toEqual([
      { op: 'same', text: 'a ' },
      { op: 'add', text: 'x' },
      { op: 'same', text: ' c' },
    ]);
  });
});
