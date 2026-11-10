import { describe, expect, it } from 'vitest';
import {
  VARIABLE_MEMORY_CAP,
  checkVariableValue,
  describeVariable,
  extractVariables,
  parseVariables,
  randomInRange,
  recallValue,
  rememberValues,
  resolveVariables,
} from '../src/lib/variables.js';

describe('parseVariables (G6 grammar)', () => {
  it('understands text, choice, range and default forms', () => {
    expect(
      parseVariables(
        'A {shot:wide|medium|close} of {subject} on {lens: 35mm | 85mm }, seed {seed:1-999}, {mood=melancholic}',
      ),
    ).toEqual([
      { name: 'shot', kind: 'choice', options: ['wide', 'medium', 'close'] },
      { name: 'subject', kind: 'text' },
      { name: 'lens', kind: 'choice', options: ['35mm', '85mm'] },
      { name: 'seed', kind: 'range', min: 1, max: 999 },
      { name: 'mood', kind: 'text', default: 'melancholic' },
    ]);
  });

  it('the first valid occurrence defines a name; later forms reuse it', () => {
    expect(parseVariables('{x:a|b} then {x} then {x=zz}')).toEqual([
      { name: 'x', kind: 'choice', options: ['a', 'b'] },
    ]);
  });

  it('supports negative ranges', () => {
    expect(parseVariables('{ev:-3-3}')).toEqual([{ name: 'ev', kind: 'range', min: -3, max: 3 }]);
  });

  it('malformed tokens stay literal text and never throw', () => {
    for (const bad of [
      '{a:}',
      '{a:5-1}',
      '{a:5-5}',
      '{a|b}',
      '{a:solo}',
      '{a:x||y}',
      '{a:x|x}',
      '{a=}',
      '{2x}',
    ]) {
      expect(() => parseVariables(bad)).not.toThrow();
      expect(parseVariables(bad), bad).toEqual([]);
      expect(resolveVariables(bad, { a: 'Z' }), bad).toBe(bad);
    }
  });
});

describe('nesting', () => {
  it('is not supported: the outer braces stay literal, an inner {b} is its own variable', () => {
    expect(parseVariables('{a:{b}}')).toEqual([{ name: 'b', kind: 'text' }]);
    expect(resolveVariables('{a:{b}}', { a: 'X', b: 'Z' })).toBe('{a:Z}');
  });
});

describe('backward compatibility', () => {
  it('plain {name} prompts behave exactly as before', () => {
    const text = 'Portrait of {character}, {outfit}, in {environment}, {character} again';
    expect(extractVariables(text)).toEqual(['character', 'outfit', 'environment']);
    expect(resolveVariables(text, { character: 'a dancer', outfit: 'silver' })).toBe(
      'Portrait of a dancer, silver, in {environment}, a dancer again',
    );
  });

  it('extractVariables includes the new forms by name', () => {
    expect(extractVariables('{lens:24mm|50mm} {seed:1-9} {mood=calm} {subject}')).toEqual([
      'lens',
      'seed',
      'mood',
      'subject',
    ]);
  });
});

describe('resolveVariables (all token forms)', () => {
  it('replaces every form of a provided name; "$" in values is safe', () => {
    expect(
      resolveVariables('{lens:24mm|50mm} then {lens} then {lens=x}', { lens: '50mm $&' }),
    ).toBe('50mm $& then 50mm $& then 50mm $&');
  });
  it('leaves unprovided names literal in their original form', () => {
    expect(resolveVariables('{a:1-9} and {b=hi}', {})).toBe('{a:1-9} and {b=hi}');
  });
});

describe('checkVariableValue', () => {
  const [choice, range, text] = parseVariables('{s:wide|close} {n:1-10} {t}');
  it('requires a value', () => {
    expect(checkVariableValue(text, '  ')).toMatch(/fill in/i);
    expect(checkVariableValue(text, 'ok')).toBe('');
  });
  it('restricts choices to the options', () => {
    expect(checkVariableValue(choice, 'close')).toBe('');
    expect(checkVariableValue(choice, 'medium')).toMatch(/options/i);
  });
  it('accepts whole numbers inside the range only', () => {
    expect(checkVariableValue(range, '10')).toBe('');
    expect(checkVariableValue(range, '11')).toMatch(/1.*10/);
    expect(checkVariableValue(range, '2.5')).not.toBe('');
    expect(checkVariableValue(range, 'x')).not.toBe('');
  });
});

describe('randomInRange', () => {
  it('stays within bounds, inclusive', () => {
    const range = /** @type {{ min: number, max: number }} */ (
      /** @type {unknown} */ (parseVariables('{n:1-3}')[0])
    );
    expect(randomInRange(range, () => 0)).toBe(1);
    expect(randomInRange(range, () => 0.9999)).toBe(3);
  });
});

describe('variable memory', () => {
  it('remembers values with recency and caps the oldest out', () => {
    /** @type {import('../src/lib/variables.js').VariableMemory} */
    let memory = {};
    for (let i = 0; i < VARIABLE_MEMORY_CAP + 5; i++)
      memory = rememberValues(memory, { [`v${i}`]: String(i) }, i);
    expect(Object.keys(memory)).toHaveLength(VARIABLE_MEMORY_CAP);
    expect(memory).not.toHaveProperty('v0');
    expect(memory[`v${VARIABLE_MEMORY_CAP + 4}`]).toEqual({
      value: String(VARIABLE_MEMORY_CAP + 4),
      usedAt: VARIABLE_MEMORY_CAP + 4,
    });
  });

  it('recall: valid memory → default → empty', () => {
    const [mood] = parseVariables('{mood=calm}');
    const [lens] = parseVariables('{lens:24mm|50mm}');
    expect(recallValue({}, mood)).toBe('calm');
    expect(recallValue({ mood: { value: 'tense', usedAt: 1 } }, mood)).toBe('tense');
    // a remembered value that no longer fits the choices is ignored
    expect(recallValue({ lens: { value: '85mm', usedAt: 1 } }, lens)).toBe('');
    expect(recallValue({ lens: { value: '50mm', usedAt: 1 } }, lens)).toBe('50mm');
  });

  it('ignores malformed memory and blank values', () => {
    expect(rememberValues(/** @type {any} */ ('junk'), { a: ' ' }, 1)).toEqual({});
    const [t] = parseVariables('{t}');
    expect(recallValue(/** @type {any} */ ({ t: 'raw' }), t)).toBe('');
  });
});

describe('describeVariable', () => {
  it('summarizes each kind for the editor hint', () => {
    const [a, b, c, d] = parseVariables('{lens:24mm|35mm|50mm} {seed:1-999} {mood=calm} {subject}');
    expect(describeVariable(a)).toBe('lens · 3 choices');
    expect(describeVariable(b)).toBe('seed · 1–999');
    expect(describeVariable(c)).toBe('mood = calm');
    expect(describeVariable(d)).toBe('subject');
  });
});
