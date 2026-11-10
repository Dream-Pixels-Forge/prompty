import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * S2 — the in-page UI (content script) and the popup share one brand.
 * The content script is a standalone IIFE, so its tokens are a copy; this
 * test keeps the copy honest and checks contrast in both themes.
 */
const popupCss = readFileSync(new URL('../src/popup/popup.css', import.meta.url), 'utf8');
const assist = readFileSync(new URL('../src/content/assist.js', import.meta.url), 'utf8');

/**
 * Custom properties declared in the first block matching `selector {`, and
 * in its `@media (prefers-color-scheme: dark)` override.
 * @param {string} css
 * @param {string} selector e.g. ':root' or ':host'
 * @param {string} prefix  e.g. '--' or '--pf-'
 */
function tokens(css, selector, prefix) {
  /** @param {string} body */
  const parse = (body) =>
    Object.fromEntries(
      [...body.matchAll(new RegExp(`(${prefix}[\\w-]+)\\s*:\\s*([^;]+);`, 'g'))].map((m) => [
        m[1].slice(prefix.length),
        m[2].trim().toLowerCase(),
      ]),
    );
  /** @param {number} from */
  const blockAt = (from) => {
    const open = css.indexOf('{', from);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
    }
    return '';
  };
  const light = parse(blockAt(css.indexOf(`${selector} {`)));
  const mediaAt = css.indexOf('@media (prefers-color-scheme: dark)');
  const media = blockAt(mediaAt);
  const darkInner = media.slice(media.indexOf(selector));
  const dark = { ...light, ...parse(blockAt(media.indexOf(selector) + mediaAt) || darkInner) };
  return { light, dark };
}

const themeCss = assist.slice(
  assist.indexOf('const THEME_CSS = `'),
  assist.indexOf('`;', assist.indexOf('const THEME_CSS = `')),
);
const popup = tokens(popupCss, ':root', '--');
const page = tokens(themeCss, ':host', '--pf-');

/** @param {string} hex */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** @param {string} a @param {string} b */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('brand parity: popup ↔ in-page UI', () => {
  it('parses both themes (dark overrides really differ from light)', () => {
    expect(popup.light.fg).toBe('#0a0a0a');
    expect(popup.dark.fg).toBe('#f5f5f5');
    expect(page.light.surface).toBe('#ffffff');
    expect(page.dark.surface).toBe('#17171a');
    expect(page.dark['accent-text']).toBe('#ff8a33');
  });

  const shared = /** @type {const} */ ([
    ['accent', 'accent'],
    ['accent-hover', 'accent-hover'],
    ['accent-ink', 'accent-ink'],
    ['accent-text', 'accent-text'],
    ['accent-soft', 'accent-soft'],
    ['fg', 'fg'],
    ['muted', 'muted'],
    ['invert-bg', 'invert-bg'],
    ['invert-fg', 'invert-fg'],
    ['danger', 'danger'],
  ]);

  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    it(`${theme}: shared brand tokens are identical`, () => {
      for (const [p, c] of shared) {
        expect(page[theme][c], `--pf-${c} vs popup --${p}`).toBe(popup[theme][p]);
      }
    });

    it(`${theme}: text ≥ 4.5:1 and UI marks ≥ 3:1`, () => {
      const t = page[theme];
      expect(contrast(t.fg, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.sunken)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['accent-ink'], t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['accent-text'], t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['invert-fg'], t['invert-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accent, t['mascot-bg'])).toBeGreaterThanOrEqual(3);
    });
  }

  it('no legacy purple remains in the content script', () => {
    expect(assist).not.toMatch(/#8b5cf6|139\s*,\s*92\s*,\s*246|#a78bfa|#7c3aed/i);
  });

  it('every color in STYLES comes from a token', () => {
    const styles = assist.slice(assist.indexOf('const STYLES = {'), assist.indexOf('const SVG_NS'));
    const literals = [...styles.matchAll(/(?:color|background|border\w*|boxShadow):\s*'([^']*)'/g)]
      .map((m) => m[1])
      .filter((v) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(v));
    // The bubble's glyph color is the mascot's fixed white, not a theme token.
    expect(literals).toEqual(['#ffffff']);
  });
});
