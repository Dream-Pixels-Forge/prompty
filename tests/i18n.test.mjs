import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import EN from '../src/locales/en.js';
import FR from '../src/locales/fr.js';
import { fill, t, tn } from '../src/lib/i18n.js';

const popupDir = new URL('../src/popup/', import.meta.url);
const files = readdirSync(popupDir).filter((f) => f.endsWith('.js'));
const sources = Object.fromEntries(
  files.map((f) => [f, readFileSync(new URL(f, popupDir), 'utf8')]),
);
const html = readFileSync(new URL('index.html', popupDir), 'utf8');
/** @param {string} s */
const placeholders = (s) => [...new Set(s.match(/\$\d/g) ?? [])].sort();

describe('catalogs', () => {
  it('fr has exactly the keys of en', () => {
    expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('keys are browser.i18n-safe; no empty messages', () => {
    for (const [k, v] of Object.entries(EN)) {
      expect(k).toMatch(/^[A-Za-z0-9_]+$/);
      expect(String(v).trim()).not.toBe('');
      expect(String(/** @type {any} */ (FR)[k]).trim()).not.toBe('');
    }
  });

  it('every translation uses the same $N placeholders as English', () => {
    const bad = Object.keys(EN).filter(
      (k) =>
        placeholders(/** @type {any} */ (EN)[k]).join() !==
        placeholders(/** @type {any} */ (FR)[k]).join(),
    );
    expect(bad).toEqual([]);
  });

  it('no "$x$" sequences (browser.i18n reads them as named placeholders)', () => {
    for (const cat of [EN, FR])
      expect(Object.entries(cat).filter(([, v]) => /\$\w+\$/.test(String(v)))).toEqual([]);
  });

  it('plural pairs are complete', () => {
    for (const k of Object.keys(EN)) {
      const m = k.match(/^(.*)_(one|other)$/);
      if (m) expect(Object.keys(EN)).toContain(`${m[1]}_${m[2] === 'one' ? 'other' : 'one'}`);
    }
  });
});

describe('usage', () => {
  it('every t()/tn() key used in the popup exists (tn needs _one and _other)', () => {
    /** @type {string[]} */
    const missing = [];
    for (const [f, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g))
        if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
      for (const m of src.matchAll(/\btn\('([A-Za-z0-9_]+)'/g))
        for (const form of ['one', 'other'])
          if (!(`${m[1]}_${form}` in EN)) missing.push(`${f}: ${m[1]}_${form}`);
      // dynamic families built from ids
      for (const m of src.matchAll(/t\(`([a-zA-Z]+)_\$\{/g)) {
        const prefix = m[1];
        expect(
          Object.keys(EN).some((k) => k.startsWith(`${prefix}_`)),
          `${f}: ${prefix}_*`,
        ).toBe(true);
      }
    }
    for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g))
      if (!(m[1] in EN)) missing.push(`index.html: ${m[1]}`);
    expect(missing).toEqual([]);
  });

  it('id-based label families cover every id', async () => {
    const { SLOTS } = await import('../src/lib/composition.js');
    const { CUTS, FORMATS } = await import('../src/lib/sequence.js');
    const { TEMPLATES } = await import('../src/lib/composition.js');
    const { SEQUENCE_TEMPLATES } = await import('../src/lib/sequence.js');
    const keys = [
      ...SLOTS.map((s) => `slot_${s.id}`),
      ...CUTS.map((c) => `cut_${c.id}`),
      ...FORMATS.map((f) => `format_${f.id.replace(/-/g, '_')}`),
      ...[...TEMPLATES, ...SEQUENCE_TEMPLATES].map((x) => `tpl_${x.id.replace(/-/g, '_')}`),
    ];
    expect(keys.filter((k) => !(k in EN))).toEqual([]);
  });

  it('no hard-coded English UI text left in the popup', () => {
    // Capitalized literals of 2+ words, or in UI-only positions. Allow-listed: developer-facing
    // recipe/JSON validation, the recipe template note, and key names.
    const allow = [
      /must be an? (array|object)/,
      /must contain only/,
      /is required and must be/,
      /^Recipe must be an object$/,
      /^Invalid JSON: $/,
      /^What this recipe is for$/,
      /^Ctrl\+Enter$/, // a key chord, not a word
      /^example\.com$/, // placeholder domain
    ];
    const uiPosition =
      /(?:toast\(|title:\s*|'aria-label':\s*|placeholder:\s*|submitLabel:\s*|confirmLabel:\s*|label:\s*)'([^']*[A-Za-z]{2}[^']*)'/g;
    const multiWord = /'([A-Z][a-z]+(?: [A-Za-z’'.,…:!?()-]+)+)'/g;
    /** @type {string[]} */
    const found = [];
    for (const [f, src] of Object.entries(sources)) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of [uiPosition, multiWord])
        for (const m of code.matchAll(re)) {
          const text = m[1];
          if (allow.some((a) => a.test(text))) continue;
          if (/^[a-z0-9_-]+$/.test(text)) continue; // ids, keys, classes
          found.push(`${f}: ${text}`);
        }
    }
    expect(found).toEqual([]);
  });
});

describe('t / tn', () => {
  it('falls back to the bundled English catalog and fills $N', () => {
    expect(t('nothingMatches', 'neon')).toBe('Nothing matches “neon”.');
    expect(t('no_such_key')).toBe('no_such_key');
    expect(fill('$2 then $1, $1', ['a', 'b'])).toBe('b then a, a');
  });

  it('tn picks one/other and passes the count as $1', () => {
    expect(tn('nPrompts', 1)).toBe('1 prompt');
    expect(tn('nPrompts', 2)).toBe('2 prompts');
    expect(tn('nPrompts', 0)).toBe('0 prompts'); // English: 0 is plural (French would say "0 prompt")
  });
});
