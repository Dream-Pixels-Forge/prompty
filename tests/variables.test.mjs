import { describe, expect, it } from 'vitest';
import {
  extractVariables,
  humanizeVar,
  resolveVariables,
} from '../src/lib/variables.js';

describe('extractVariables', () => {
  it('extracts unique variables in first-appearance order', () => {
    const text = 'A {subject} with {background}, then {subject} again and {style}.';
    expect(extractVariables(text)).toEqual(['subject', 'background', 'style']);
  });

  it('returns [] when there are no variables', () => {
    expect(extractVariables('no placeholders here')).toEqual([]);
    expect(extractVariables('')).toEqual([]);
    expect(extractVariables(null)).toEqual([]);
  });

  it('ignores tokens that start with a digit (e.g. {2x} not detected)', () => {
    expect(extractVariables('{2x} and {1shot} stay literal')).toEqual([]);
  });

  it('ignores tokens with invalid characters', () => {
    expect(extractVariables('{bad-name} {bad name} {o.k}')).toEqual([]);
  });

  it('supports underscores and leading underscores', () => {
    expect(extractVariables('{_priv} and {snake_case_2}')).toEqual([
      '_priv',
      'snake_case_2',
    ]);
  });
});

describe('resolveVariables', () => {
  const text = 'A {subject} with {background} and {subject}.';

  it('substitutes only the provided keys, reusing them for repeats', () => {
    expect(resolveVariables(text, { subject: 'a knight' })).toBe(
      'A a knight with {background} and a knight.',
    );
  });

  it('leaves unknown {x} tokens literal', () => {
    expect(resolveVariables(text, {})).toBe(text);
  });

  it('resolves all provided values and stringifies non-strings', () => {
    expect(
      resolveVariables(text, { subject: 'a knight', background: 42 }),
    ).toBe('A a knight with 42 and a knight.');
  });

  it('does not block keys that would collide with Object.prototype (no prototype pollution)', () => {
    expect(resolveVariables(text, { constructor: 'safe', subject: 'x' })).toBe(
      'A x with {background} and x.',
    );
  });
});

describe('humanizeVar', () => {
  it('converts snake_case to Title Case words', () => {
    expect(humanizeVar('background_light')).toBe('Background Light');
  });

  it('converts camelCase to Title Case words', () => {
    expect(humanizeVar('keyLight')).toBe('Key Light');
  });

  it('single words render capitalized', () => {
    expect(humanizeVar('mood')).toBe('Mood');
    expect(humanizeVar('MOOD')).toBe('Mood');
  });

  it('handles mixed underscores + camelCase', () => {
    expect(humanizeVar('wide_shot_colorGrade')).toBe('Wide Shot Color Grade');
  });
});
