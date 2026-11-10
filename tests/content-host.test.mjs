import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Invariants for the content script's shadow host. assist.js is a classic
 * IIFE without a DOM test harness, so these guard the two lines that, when
 * wrong, make Prompty's invisible UI swallow every click on every website.
 */
const source = readFileSync(new URL('../src/content/assist.js', import.meta.url), 'utf8');

describe('content script shadow host', () => {
  it("applies `all: 'initial'` before the host's own positioning", () => {
    const block = source.slice(source.indexOf('applyStyles(host, {'));
    const body = block.slice(0, block.indexOf('});'));
    const keys = [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(keys[0]).toBe('all');
    expect(keys).toEqual(expect.arrayContaining(['position', 'pointerEvents', 'width', 'height']));
  });

  it('forces [hidden] elements out of layout inside the shadow root', () => {
    expect(source).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
