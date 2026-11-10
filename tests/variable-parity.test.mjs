import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as lib from '../src/lib/variables.js';

/**
 * G6 — the content script (no imports) carries a verbatim copy of the
 * variable grammar. This test keeps the two copies identical in text AND in
 * behavior, so the popup and the in-page `!` palette always agree.
 */
const libSource = readFileSync(new URL('../src/lib/variables.js', import.meta.url), 'utf8');
const assistSource = readFileSync(new URL('../src/content/assist.js', import.meta.url), 'utf8');

/** @param {string} source */
function grammarBlock(source) {
  const start = source.indexOf('/* <variable-grammar> */');
  const end = source.indexOf('/* </variable-grammar> */');
  expect(start, 'start marker').toBeGreaterThan(-1);
  expect(end, 'end marker').toBeGreaterThan(start);
  // Slice from the start of the marker's line so every line keeps its indent.
  const lines = source.slice(source.lastIndexOf('\n', start) + 1, end).split('\n');
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)?.[0].length ?? 0),
  );
  return lines.map((l) => l.slice(indent).trimEnd()).join('\n');
}

/** Load assist.js in a DOM-less sandbox; its test hook hands back the pure helpers. */
function loadContentHelpers() {
  /** @type {any} */
  let exposed = null;
  const sandbox = {
    self: { __PROMPTY_TEST_HOOK__: (/** @type {any} */ api) => (exposed = api) },
    console,
  };
  vm.runInNewContext(assistSource, sandbox);
  expect(exposed, 'content script test hook').not.toBeNull();
  return exposed;
}

const FIXTURES = [
  'A {shot:wide|medium|close} of {subject} on {lens: 35mm | 85mm }, seed {seed:1-999}, {mood=melancholic}',
  '{x:a|b} then {x} then {x=zz}',
  '{ev:-3-3} and {a:} {a:5-1} {a:5-5} {a|b} {a:solo} {a:x||y} {a:x|x} {a=} {2x}',
  'Portrait of {character}, {outfit}, in {environment}, {character} again',
  '{a:{b}} and $& {b}',
  '',
];

describe('variable grammar parity (popup ↔ content script)', () => {
  it('the content script carries the grammar block verbatim', () => {
    expect(grammarBlock(assistSource)).toBe(grammarBlock(libSource));
  });

  const content = loadContentHelpers();

  it('parses every fixture identically', () => {
    for (const text of FIXTURES)
      expect(content.varParse(text), text).toEqual(lib.parseVariables(text));
  });

  it('resolves every fixture identically', () => {
    const values = {
      shot: 'wide',
      subject: 'a dancer',
      lens: '85mm',
      seed: '7',
      mood: 'tense',
      x: 'b',
      b: '$1',
      character: 'C',
    };
    for (const text of FIXTURES) {
      expect(content.resolveVariablesInline(text, values), text).toBe(
        lib.resolveVariables(text, values),
      );
    }
  });

  it('validates, randomizes and remembers identically', () => {
    for (const spec of lib.parseVariables(FIXTURES[0])) {
      for (const value of ['', 'wide', '85mm', '7', '1000', 'x']) {
        expect(content.varCheck(spec, value)).toBe(lib.checkVariableValue(spec, value));
      }
      expect(content.varRecall({ [spec.name]: { value: '7', usedAt: 1 } }, spec)).toBe(
        lib.recallValue({ [spec.name]: { value: '7', usedAt: 1 } }, spec),
      );
    }
    expect(content.varRandom({ min: 1, max: 6 }, () => 0.5)).toBe(
      lib.randomInRange({ min: 1, max: 6 }, () => 0.5),
    );
    expect(content.varRemember({}, { a: 'x' }, 5)).toEqual(lib.rememberValues({}, { a: 'x' }, 5));
  });

  it('the content script’s name list matches the library’s', () => {
    for (const text of FIXTURES)
      expect(content.extractVariablesInline(text)).toEqual(lib.extractVariables(text));
  });
});
