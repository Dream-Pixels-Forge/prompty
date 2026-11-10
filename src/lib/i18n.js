/**
 * G8b — UI strings. Catalogs live in src/locales/<lang>.js (one source of
 * truth); scripts/build.mjs turns them into _locales/<lang>/messages.json for
 * browser.i18n. `t()` asks browser.i18n first (the user's browser language,
 * falling back to default_locale "en"), then the bundled English catalog —
 * so tests and any context without i18n still get real text.
 *
 * Messages use $1…$9 for substitutions (the browser.i18n convention).
 * Plurals: `tn('key', n)` picks `key_one` / `key_other` by the UI language's
 * plural rules (French counts 0 and 1 as singular) and passes n as $1.
 */
import browser from './browser.js';
import EN from '../locales/en.js';

/** @typedef {keyof typeof EN} MessageKey */

/**
 * Fill $1…$9.
 * @param {string} raw
 * @param {string[]} subs
 */
export function fill(raw, subs) {
  return raw.replace(/\$(\d)/g, (_m, d) => subs[Number(d) - 1] ?? '');
}

/** The browser UI language ("fr", "en-US"…), or "en". */
export function uiLanguage() {
  try {
    return browser?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en';
  } catch {
    return 'en';
  }
}

/**
 * @param {string} key
 * @param {...(string|number)} subs
 * @returns {string}
 */
export function t(key, ...subs) {
  const s = subs.map(String);
  try {
    const msg = browser?.i18n?.getMessage?.(key, s);
    if (msg) return msg;
  } catch {
    /* no i18n here (tests): use the bundled catalog */
  }
  const raw = /** @type {Record<string, string>} */ (EN)[key];
  return raw === undefined ? key : fill(raw, s);
}

/** @type {Intl.PluralRules|null} */
let rules = null;

/**
 * Plural-aware: `key_one` or `key_other`, with n (localized) as $1.
 * @param {string} key
 * @param {number} n
 * @param {...(string|number)} subs
 */
export function tn(key, n, ...subs) {
  rules ??= new Intl.PluralRules(uiLanguage());
  const form = rules.select(n) === 'one' ? 'one' : 'other';
  return t(`${key}_${form}`, n.toLocaleString(uiLanguage()), ...subs);
}

/**
 * Translate a static page: `data-i18n="key"` sets text, and
 * `data-i18n-<attr>="key"` sets that attribute (placeholder, title, aria-label).
 * @param {ParentNode} root
 */
export function localizeDom(root) {
  for (const el of root.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement)) continue;
    for (const [name, key] of Object.entries(el.dataset)) {
      if (!key) continue;
      if (name === 'i18n') el.textContent = t(key);
      else if (name.startsWith('i18n')) {
        const attr = name
          .slice(4)
          .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
          .replace(/^-/, '');
        el.setAttribute(attr, t(key));
      }
    }
  }
}

/**
 * G8c: the variable grammar's validation messages stay English inside the
 * shared grammar block (it is copied verbatim into the content script); this
 * maps them to the UI language where they are shown.
 * @param {string} problem
 */
export function localizeVarProblem(problem) {
  if (problem === 'Fill in this field') return t('varFillIn');
  if (problem === 'Pick one of the options') return t('varPickOption');
  const m = /^Enter a whole number from (-?\d+) to (-?\d+)$/.exec(problem);
  if (m) return t('varWholeNumber', m[1], m[2]);
  return problem;
}
