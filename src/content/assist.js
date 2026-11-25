/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Prompty content script — smart assist pill + floating widget + targeted
 * message handlers (SPEC §2 Δ2, Δ3, Δ7; issue #3).
 *
 * MUST stay a single IIFE with zero imports: content scripts run as plain
 * classic scripts shared by both dual-manifest dists (SPEC §4), and ES module
 * import maps do not exist in that context. Small pure helpers (append join,
 * origin match, settings coercion, search/sort) are therefore inline ports of
 * `src/lib/text.js` / `src/lib/sites.js` / `src/lib/storage.js` algorithms.
 * Non-drift is enforced in `tests/assist.test.mjs`, which loads this file in a
 * sandbox and compares the exact same algorithms against the lib modules.
 *
 * SECURITY.md rules honored here:
 * - all page-derived strings are set via `textContent`/`value` — never
 *   `innerHTML`; CSS is applied programmatically (CSSOM), immune to a page's
 *   `style-src` CSP;
 * - the whole UI lives in one shadow root attached to a zero-size host pinned
 *   at the viewport origin with z-index 2147483647 — the page layout is never
 *   touched beyond that container;
 * - every runtime message is answered (`sendResponse` always), unknown types
 *   respond `{success:false,error:"unknown type"}` (upstream bug #11 fixed);
 * - site-disabled mode only suppresses our passive UI; explicit user actions
 *   (popup paste, context-menu save) keep working.
 */
(() => {
  'use strict';

  /* ==================================================================== *
   * PURE SECTION — no DOM, no extension API, no side effects.            *
   * Exposed to the vitest sandbox via the test-only hook below.          *
   * ==================================================================== */

  // ---- inline port of src/lib/text.js joinForAppend (same algorithm) ----
  /**
   * Join trimmed existing + incoming texts with ", ".
   * Empty/blank/null existing → just the trimmed incoming.
   * @param {unknown} existing
   * @param {unknown} incoming
   * @returns {string}
   */
  function appendJoin(existing, incoming) {
    const current = typeof existing === 'string' ? existing.trim() : '';
    const addition = typeof incoming === 'string' ? incoming.trim() : '';
    if (current.length === 0) return addition;
    if (addition.length === 0) return current;
    return `${current}, ${addition}`;
  }

  // ---- inline port of src/lib/sites.js (same algorithms) ----
  /**
   * Origin of a URL string, or "" for anything unparsable.
   * @param {unknown} url
   * @returns {string}
   */
  function getOrigin(url) {
    if (typeof url !== 'string' || url.length === 0) return '';
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  }

  /**
   * Whether a URL's exact origin is listed as disabled.
   * @param {string} url target page URL
   * @param {unknown} disabledSites origin list from settings
   * @returns {boolean}
   */
  function isSiteDisabled(url, disabledSites) {
    const origins = Array.isArray(disabledSites)
      ? disabledSites.filter((s) => typeof s === 'string')
      : [];
    if (origins.length === 0) return false;
    const origin = getOrigin(url);
    if (origin === '') return false;
    return origins.includes(origin);
  }

  /**
   * Settings subset the content script reads — whitelist coercion mirroring
   * `src/lib/storage.js mergeSettings` for exactly these keys. Never merges
   * unknown keys, never mutates the input.
   * @param {unknown} raw stored settings (may be partial/garbage)
   * @returns {{ showFloatingWidget: boolean, disabledSites: string[], sortBy: string, compactMode: boolean, quickTrigger: string, quickTriggerEnabled: boolean }}
   */
  function normalizeSettings(raw) {
    const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sortBy = record.sortBy;
    const quickTrigger = record.quickTrigger;
    return {
      showFloatingWidget: typeof record.showFloatingWidget === 'boolean' ? record.showFloatingWidget : true,
      disabledSites: Array.isArray(record.disabledSites)
        ? record.disabledSites.filter((v) => typeof v === 'string' && v.trim() !== '')
        : [],
      sortBy:
        sortBy === 'recent' || sortBy === 'created' || sortBy === 'name' || sortBy === 'mostUsed'
          ? sortBy
          : 'recent',
      compactMode: typeof record.compactMode === 'boolean' ? record.compactMode : false,
      quickTrigger: typeof quickTrigger === 'string' && quickTrigger.length === 1 ? quickTrigger : '!',
      quickTriggerEnabled: typeof record.quickTriggerEnabled === 'boolean' ? record.quickTriggerEnabled : true,
    };
  }

  /**
   * Tag name of a DOM-like object, uppercase; '' for non-elements.
   * @param {unknown} el
   * @returns {string}
   */
  function elementTag(el) {
    if (el === null || typeof el !== 'object' || typeof el.tagName !== 'string') return '';
    return String(el.tagName).toUpperCase();
  }

  /** Input types whose `value` is prompt-like text (pill + insert). */
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);

  /**
   * Whether an input type accepts prompt text.
   * @param {unknown} type
   * @returns {boolean}
   */
  function isKnownInputType(type) {
    return typeof type === 'string' && TEXT_INPUT_TYPES.has(type.toLowerCase());
  }

  /**
   * Page editable the pill may anchor to (textarea / text-like input /
   * contenteditable). Duck-typed so the same predicate works with the shadow
   * sandbox in tests.
   * @param {unknown} el
   * @returns {boolean}
   */
  function isPageEditableElement(el) {
    const tag = elementTag(el);
    if (tag === '') return false;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return isKnownInputType(el.type);
    return el.isContentEditable === true;
  }

  /**
   * Whether a target accepts PROMPTY_INSERT (page editables + <select>).
   * @param {unknown} el
   * @returns {boolean}
   */
  function isInsertableElement(el) {
    return isPageEditableElement(el) || elementTag(el) === 'SELECT';
  }

  /**
   * Case-insensitive substring search over title/text/tags (SPEC §1 popup
   * search semantics). Empty query matches everything.
   * @param {{ title?: unknown, text?: unknown, tags?: unknown }} prompt
   * @param {string} query
   * @returns {boolean}
   */
  function promptMatchesSearch(prompt, query) {
    const needle = String(query ?? '').trim().toLowerCase();
    if (needle === '') return true;
    const title = typeof prompt.title === 'string' ? prompt.title : '';
    const text = typeof prompt.text === 'string' ? prompt.text : '';
    const tags = Array.isArray(prompt.tags) ? prompt.tags : [];
    if (title.toLowerCase().includes(needle)) return true;
    if (text.toLowerCase().includes(needle)) return true;
    return tags.some((t) => typeof t === 'string' && t.toLowerCase().includes(needle));
  }

  /**
   * Sort comparator for one prompt pair, per SPEC §1 popup sorts.
   * @param {{ title?: unknown, text?: unknown, createdAt?: unknown, useCount?: unknown, lastUsedAt?: unknown }} a
   * @param {{ title?: unknown, text?: unknown, createdAt?: unknown, useCount?: unknown, lastUsedAt?: unknown }} b
   * @param {string} sortBy
   * @returns {number}
   */
  function comparePrompts(a, b, sortBy) {
    const numOr = (value, fallback) => (typeof value === 'number' ? value : fallback);
    if (sortBy === 'mostUsed') {
      return numOr(b.useCount, 0) - numOr(a.useCount, 0);
    }
    if (sortBy === 'created') {
      return numOr(b.createdAt, 0) - numOr(a.createdAt, 0);
    }
    if (sortBy === 'name') {
      return String(a.title ?? '').localeCompare(String(b.title ?? ''));
    }
    // 'recent': lastUsedAt ?? createdAt, descending
    const aRecent = numOr(a.lastUsedAt, numOr(a.createdAt, 0));
    const bRecent = numOr(b.lastUsedAt, numOr(b.createdAt, 0));
    return bRecent - aRecent;
  }

  /**
   * Stable copy of `list` sorted by `sortBy` (never mutates input).
   * @template {{ title?: unknown, text?: unknown, createdAt?: unknown, useCount?: unknown, lastUsedAt?: unknown }} T
   * @param {unknown} list
   * @param {string} sortBy
   * @returns {T[]}
   */
  function sortPrompts(list, sortBy) {
    if (!Array.isArray(list)) return [];
    return list.slice().sort((a, b) => comparePrompts(a, b, sortBy));
  }

  /**
   * Light pass-through validation for stored prompts (own storage, already
   * normalized): keep object records only. No prototype-unsafe merging —
   * SECURITY.md.
   * @param {unknown} list
   * @returns {unknown[]}
   */
  function storedPromptList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
  }

  /* ------------------------------------------------------------------ */
  /* G15: prompt-sheet shot extraction (inline port of src/lib/documents.js
   * extractShotFromMarkdown / parseShotSection — content scripts cannot
   * import ES modules, so the algorithm is duplicated here and kept in
   * sync by tests/assist-parity.test.mjs). */
  /* ------------------------------------------------------------------ */

  /** Shot ids look like G01, G08, V12. */
  const SHOT_HEADING = /^([A-Z]\d+)\s*(?:—\s*(.+))?/;

  /**
   * Recognized model info strings (sourced dialects from G9c + G15b).
   * Kept in sync with src/lib/documents.js KNOWN_MODELS.
   */
  const SHOT_KNOWN_MODELS = new Set([
    'muse', 'seedance', 'seedance-2.5', 'kling', 'minimax-hailuo', 'veo',
    'runway', 'wan', 'luma', 'higgsfield', 'timecoded', 'script', 'one-take',
  ]);

  /**
   * Parse Refs line into array of @reference tokens.
   * @param {string} refsText
   * @returns {string[]}
   */
  function shotParseRefs(refsText) {
    const refs = [];
    const matches = String(refsText ?? '').match(/@([a-zA-Z0-9_-]+)/g);
    if (matches) {
      for (const m of matches) {
        const ref = m.startsWith('@') ? m : `@${m}`;
        if (!refs.includes(ref)) refs.push(ref);
      }
    }
    return refs;
  }

  /**
   * Parse one `## ID — Name` shot section into shot variant records.
   * Each recognized fenced-block variant (known model or neutral) is its own
   * shot; unknown info strings (e.g. `json`, `text`) are not variants.
   * @param {string} section
   * @param {string} documentId
   * @param {string} projectName
   * @returns {Array<{ shotId:string,name:string,refs:string[],prompt:string,modelId:string|null,edit:string,check:string,documentId:string,projectName:string }>}
   */
  function shotParseSection(section, documentId, projectName) {
    const headingMatch = String(section ?? '').match(SHOT_HEADING);
    if (!headingMatch) return [];

    const shotId = String(headingMatch[1]).trim();
    const name = String(headingMatch[2] ?? '').trim();
    const remaining = String(section).slice(headingMatch[0].length);

    const refsMatch = remaining.match(/\*\*Refs:\*\*\s*([\s\S]*?)(?:\n\*\*|\n```|\n##|$)/);
    const refs = shotParseRefs(refsMatch ? refsMatch[1] : '');

    const fencedBlocks = [...remaining.matchAll(/```([a-zA-Z0-9.-]*)\n([\s\S]*?)\n```/g)];

    const editMatch = remaining.match(/\*\*Edit:\*\*\s*([\s\S]*?)(?:\n\*\*|\n```|\n##|$)/);
    const edit = editMatch ? String(editMatch[1]).trim() : '';

    const checkMatch = remaining.match(/\*\*CHECK:\*\*\s*([\s\S]*?)(?:\n\*\*|\n```|\n##|$)/);
    const check = checkMatch ? String(checkMatch[1]).trim() : '';

    /** @type {Array<{ shotId:string,name:string,refs:string[],prompt:string,modelId:string|null,edit:string,check:string,documentId:string,projectName:string }>} */
    const shots = [];
    for (const block of fencedBlocks) {
      const info = String(block[1] ?? '').toLowerCase().trim();
      const content = String(block[2] ?? '').trimEnd();
      if (!info || SHOT_KNOWN_MODELS.has(info)) {
        shots.push({
          shotId,
          name,
          refs,
          prompt: content,
          modelId: info || null,
          edit,
          check,
          documentId,
          projectName,
        });
      }
    }
    return shots;
  }

  /**
   * Extract shot sections from a prompt-sheet markdown document.
   * Parses `## <ID> — <name>` headings with fenced code blocks.
   * @param {string} markdown
   * @param {string} documentId
   * @param {string} projectName
   * @returns {Array<{shotId:string,name:string,refs:string[],prompt:string,modelId:string|null,edit:string,check:string,documentId:string,projectName:string}>}
   */
  function extractShotsFromMarkdown(markdown, documentId, projectName) {
    if (typeof markdown !== 'string') return [];
    const shots = [];
    const sections = String(markdown).split(/(?:^|\n)## /);
    for (let i = 1; i < sections.length; i++) {
      for (const shot of shotParseSection(sections[i], documentId, projectName)) {
        shots.push(shot);
      }
    }
    return shots;
  }

  /* <variable-grammar> */
  // Shared verbatim with src/content/assist.js — edit both or the parity test fails.
  /**
   * @typedef {{ name: string, kind: 'text', default?: string }
   *   | { name: string, kind: 'choice', options: string[] }
   *   | { name: string, kind: 'range', min: number, max: number }} VariableSpec
   * @typedef {Record<string, { value: string, usedAt: number }>} VariableMemory
   */
  const VAR_TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^{}]*)|=([^{}]*))?\}/g;
  const VAR_MEMORY_CAP = 100;

  /**
   * @param {unknown} obj
   * @param {string} key
   * @returns {boolean}
   */
  function varHasOwn(obj, key) {
    return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
  }

  /**
   * Spec for one token, or null when malformed (then it stays literal).
   * @param {string} name
   * @param {string|undefined} choiceOrRange text after ":" (undefined when absent)
   * @param {string|undefined} fallback text after "=" (undefined when absent)
   * @returns {VariableSpec|null}
   */
  function varSpecOf(name, choiceOrRange, fallback) {
    if (choiceOrRange === undefined && fallback === undefined) return { name, kind: 'text' };
    if (fallback !== undefined) {
      const value = fallback.trim();
      return value === '' ? null : { name, kind: 'text', default: value };
    }
    const body = String(choiceOrRange);
    const range = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(body);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      return min < max ? { name, kind: 'range', min, max } : null;
    }
    if (!body.includes('|')) return null;
    const options = body.split('|').map((o) => o.trim());
    if (options.length < 2 || options.some((o) => o === '')) return null;
    if (new Set(options).size !== options.length) return null;
    return { name, kind: 'choice', options };
  }

  /**
   * Unique variables in first-appearance order; the first valid occurrence of a
   * name defines its spec.
   * @param {unknown} text
   * @returns {VariableSpec[]}
   */
  function varParse(text) {
    /** @type {VariableSpec[]} */
    const out = [];
    if (typeof text !== 'string') return out;
    const seen = new Set();
    for (const m of text.matchAll(VAR_TOKEN)) {
      const spec = varSpecOf(m[1], m[2], m[3]);
      if (!spec || seen.has(spec.name)) continue;
      seen.add(spec.name);
      out.push(spec);
    }
    return out;
  }

  /**
   * Replace every well-formed token whose name has a value; others stay as written.
   * @param {string} text
   * @param {Record<string, unknown>} values
   * @returns {string}
   */
  function varResolve(text, values) {
    return text.replace(VAR_TOKEN, (whole, name, choiceOrRange, fallback) => {
      if (!varSpecOf(name, choiceOrRange, fallback)) return whole;
      return varHasOwn(values, name) ? String(values[name]) : whole;
    });
  }

  /**
   * '' when the value is acceptable for the spec, else a short reason.
   * @param {VariableSpec} spec
   * @param {unknown} value
   * @returns {string}
   */
  function varCheck(spec, value) {
    const v = String(value ?? '').trim();
    if (v === '') return 'Fill in this field';
    if (spec.kind === 'choice' && !spec.options.includes(v)) return 'Pick one of the options';
    if (spec.kind === 'range') {
      const n = /^-?\d+$/.test(v) ? Number(v) : NaN;
      if (!(n >= spec.min && n <= spec.max)) return `Enter a whole number from ${spec.min} to ${spec.max}`;
    }
    return '';
  }

  /**
   * Uniform whole number within a range spec (inclusive).
   * @param {{ min: number, max: number }} spec
   * @param {() => number} [rand]
   * @returns {number}
   */
  function varRandom(spec, rand = Math.random) {
    return spec.min + Math.floor(rand() * (spec.max - spec.min + 1));
  }

  /**
   * Store the latest values (non-blank) with recency; keep the newest VAR_MEMORY_CAP.
   * @param {unknown} memory
   * @param {Record<string, unknown>} values
   * @param {number} now
   * @returns {VariableMemory}
   */
  function varRemember(memory, values, now) {
    /** @type {VariableMemory} */
    const next = {};
    if (memory !== null && typeof memory === 'object' && !Array.isArray(memory)) {
      for (const [name, entry] of Object.entries(memory)) {
        if (entry && typeof entry.value === 'string' && typeof entry.usedAt === 'number') {
          next[name] = { value: entry.value, usedAt: entry.usedAt };
        }
      }
    }
    for (const [name, raw] of Object.entries(values ?? {})) {
      const value = String(raw ?? '').trim();
      if (value !== '') next[name] = { value, usedAt: now };
    }
    const keep = Object.entries(next)
      .sort((a, b) => b[1].usedAt - a[1].usedAt)
      .slice(0, VAR_MEMORY_CAP);
    return Object.fromEntries(keep);
  }

  /**
   * Prefill for a field: a remembered value that still fits → the default → ''.
   * @param {unknown} memory
   * @param {VariableSpec} spec
   * @returns {string}
   */
  function varRecall(memory, spec) {
    const entry = varHasOwn(memory, spec.name) ? /** @type {any} */ (memory)[spec.name] : null;
    if (entry && typeof entry.value === 'string' && varCheck(spec, entry.value) === '') return entry.value;
    return spec.kind === 'text' && spec.default ? spec.default : '';
  }
  /* </variable-grammar> */

  /**
   * Clamp a number helper (positions math).
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function clampNumber(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /**
   * First non-empty line of a text, trimmed, cut to `max` chars — used for
   * default prompt titles (upstream quirk fix: no window.prompt titles;
   * the modal's input pre-fills with this).
   * @param {unknown} text
   * @param {number} [max]
   * @returns {string}
   */
  function truncatedTitle(text, max = 60) {
    const source = typeof text === 'string' ? text : '';
    for (const line of source.split(/\r?\n|\\n/)) {
      const trimmed = line.trim();
      if (trimmed !== '') return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
    }
    return '';
  }

  /**
   * crypto-randomUUID id (SECURITY.md); '' if unavailable — the popup's
   * normalize pass regenerates ids on next read.
   * @returns {string}
   */
  function randomId() {
    return globalThis.crypto?.randomUUID?.() ?? '';
  }

  /**
   * Fresh prompt object in the SPEC §1 schema.
   * @param {unknown} title
   * @param {unknown} text
   * @param {number} [now] injectable timestamp (tests)
   * @returns {Record<string, unknown>}
   */
  function buildPromptObject(title, text, now) {
    return {
      id: randomId(),
      title: typeof title === 'string' ? title.trim() : '',
      text: typeof text === 'string' ? text : '',
      createdAt: typeof now === 'number' ? now : Date.now(),
      useCount: 0,
      isFavorite: false,
      categoryId: null,
      tags: [],
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
    };
  }

  // ---- inline port of src/lib/recipes.js (same algorithms) ----
  /**
   * Check if a URL matches a glob-style pattern.
   * Matches against the host + pathname (without protocol) with minimatch-like logic.
   * Supports * at start, end, or both (e.g., '*.example.com/*', 'example.com/*', 'example.com').
   * @param {string} url - Full URL to test
   * @param {string} pattern - Glob-style pattern
   * @returns {boolean}
   */
  function matchOriginPattern(url, pattern) {
    if (typeof url !== 'string' || typeof pattern !== 'string') return false;

    let hostPath;
    try {
      const u = new URL(url);
      hostPath = u.host + u.pathname;
    } catch {
      return false;
    }

    // Escape regex special chars except *
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    const regex = new RegExp(`^${escaped}$`);
    return regex.test(hostPath);
  }

  /**
   * Find the first recipe that matches the given URL.
   * @param {string} url - Full URL to match
   * @param {Array} recipes - Array of recipe objects
   * @returns {object|null} The first matching recipe, or null if none match
   */
  function matchRecipe(url, recipes) {
    if (!Array.isArray(recipes)) return null;

    for (const recipe of recipes) {
      if (matchOriginPattern(url, recipe.originPattern)) {
        return recipe;
      }
    }
    return null;
  }

  /**
   * Get the default generic fallback recipe (heuristic selectors from original).
   * @returns {object}
   */
  function getDefaultRecipe() {
    return {
      originPattern: '*',
      promptInput: [
        'textarea[placeholder*="prompt" i]',
        'textarea[placeholder*="describe" i]',
        'textarea[placeholder*="scene" i]',
        'textarea',
        'input[type="text"][placeholder*="prompt" i]',
        '[contenteditable="true"]',
      ],
      submit: [
        'button[type="submit"]',
        'button:has-text("Generate")',
        'button:has-text("Create")',
        'button:has-text("Submit")',
        '[role="button"]:has-text("Generate")',
      ],
      selects: {
        aspect: 'select[options*="1:1" i][options*="16:9" i][options*="9:16" i]',
        quality: 'select[options*="1k" i][options*="2k" i][options*="4k" i]',
      },
      qualityValues: ['1k', '2k', '4k'],
      notes: 'Generic fallback — heuristic chain from original behavior',
    };
  }

  // Built-in recipes (embedded from assets/recipes.json at build time)
  const BUILTIN_RECIPES = [
    {
      originPattern: '*.higgsfield.ai/*',
      promptInput: [
        'textarea.reference-prompt',
        'textarea[placeholder*="Describe the scene" i]',
        'textarea[placeholder*="prompt" i]',
        'main textarea',
      ],
      submit: [
        '#hf\\:image-form-submit',
        'button[type="submit"]:has-text("Generate")',
      ],
      selects: {
        aspect: 'select[options*="1:1"][options*="16:9"][options*="9:16"]',
        quality: 'select[options*="1k"][options*="2k"][options*="4k"]',
      },
      qualityValues: ['1k', '2k', '4k'],
      notes: 'Higgsfield AI — ported from original hardcoded selectors',
    },
    {
      originPattern: 'chat.openai.com/*',
      promptInput: [
        'textarea#prompt-textarea',
        'textarea[placeholder*="Message" i]',
        'textarea[data-testid="prompt-textarea"]',
        'div[contenteditable="true"][data-testid="prompt-textarea"]',
      ],
      submit: [
        'button[data-testid="send-button"]',
        'button:has-text("Send")',
        'button[type="submit"]',
      ],
      selects: {
        aspect: 'select[name*="aspect" i]',
        quality: 'select[name*="quality" i]',
      },
      qualityValues: ['standard', 'hd', '4k'],
      notes: 'ChatGPT / OpenAI — primary chat interface',
    },
    {
      originPattern: 'claude.ai/*',
      promptInput: [
        'div[contenteditable="true"][placeholder*="Talk" i]',
        'div[contenteditable="true"][data-testid="chat-input"]',
        'textarea[placeholder*="Talk" i]',
      ],
      submit: [
        'button[aria-label*="Send" i]',
        'button:has-text("Send")',
        'button[type="submit"]',
      ],
      selects: {
        aspect: 'select[name*="aspect" i]',
        quality: 'select[name*="quality" i]',
      },
      qualityValues: ['standard', 'high'],
      notes: 'Claude AI — Anthropic chat interface',
    },
    {
      originPattern: 'gemini.google.com/*',
      promptInput: [
        'div[contenteditable="true"][aria-label*="Enter" i]',
        'div[contenteditable="true"][placeholder*="Enter" i]',
        'textarea[placeholder*="Enter" i]',
      ],
      submit: [
        'button[aria-label*="Send" i]',
        'button:has-text("Send")',
        'button[type="submit"]',
      ],
      selects: {
        aspect: 'select[name*="aspect" i]',
        quality: 'select[name*="quality" i]',
      },
      qualityValues: ['standard', 'high'],
      notes: 'Google Gemini — chat interface',
    },
    {
      originPattern: 'perplexity.ai/*',
      promptInput: [
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder*="Search" i]',
        'div[contenteditable="true"][placeholder*="Ask" i]',
      ],
      submit: [
        'button[aria-label*="Submit" i]',
        'button:has-text("Submit")',
        'button[type="submit"]',
      ],
      selects: {
        aspect: 'select[name*="aspect" i]',
        quality: 'select[name*="quality" i]',
      },
      qualityValues: ['standard', 'detailed'],
      notes: 'Perplexity AI — search/chat interface',
    },
    {
      originPattern: '*',
      promptInput: [
        'textarea[placeholder*="prompt" i]',
        'textarea[placeholder*="describe" i]',
        'textarea[placeholder*="scene" i]',
        'textarea',
        'input[type="text"][placeholder*="prompt" i]',
        '[contenteditable="true"]',
      ],
      submit: [
        'button[type="submit"]',
        'button:has-text("Generate")',
        'button:has-text("Create")',
        'button:has-text("Submit")',
        '[role="button"]:has-text("Generate")',
      ],
      selects: {
        aspect: 'select[options*="1:1" i][options*="16:9" i][options*="9:16" i]',
        quality: 'select[options*="1k" i][options*="2k" i][options*="4k" i]',
      },
      qualityValues: ['1k', '2k', '4k'],
      notes: 'Generic fallback — heuristic chain from original behavior',
    },
  ];

  /* ------------------------------------------------------------------ *
   * Sandbox hook — ONLY fires when no document exists (vitest stub). A   *
   * live page always has `document`, so site scripts can never invoke    *
   * the hook (SECURITY.md).                                              *
   * ------------------------------------------------------------------ */
  const hook = typeof self !== 'undefined' && typeof self.document === 'undefined' ? self.__PROMPTY_TEST_HOOK__ : undefined;
  if (typeof hook === 'function') {
    hook({
      appendJoin,
      getOrigin,
      isSiteDisabled,
      normalizeSettings,
      isPageEditableElement,
      isInsertableElement,
      isKnownInputType,
      promptMatchesSearch,
      sortPrompts,
      storedPromptList,
      clampNumber,
      truncatedTitle,
      buildPromptObject,
      randomId,
      matchOriginPattern,
      matchRecipe,
      getDefaultRecipe,
      BUILTIN_RECIPES,
      // G1 trigger-char palette functions
      subsequenceScoreInline,
      extractMatchesInline,
      extractVariablesInline,
      humanizeVarInline,
      resolveVariablesInline,
      // G15 prompt-sheet shot extraction
      extractShotsFromMarkdown,
      shotParseSection,
      shotParseRefs,
      // G6 grammar (shared verbatim with src/lib/variables.js)
      varParse,
      varResolve,
      varCheck,
      varRandom,
      varRemember,
      varRecall,
    });
    return;
  }

  /* ==================================================================== *
   * RUNTIME SECTION — DOM + extension API (content scripts only).        *
   * ==================================================================== */

  /** @type {any} */
  const globalScope = globalThis;
  /** @type {any} */
  const api = globalScope.browser ?? globalScope.chrome;
  if (!api || !api.runtime) return;

  /* G8c: in-page strings come from the same catalogs as the popup (_locales, via
   * browser.i18n). The English fallback is the catalog text itself — a test keeps
   * them identical — so pages and the test hook still read right without i18n. */
  function tr(key, fallback, ...subs) {
    const s = subs.map(String);
    try {
      return (api.i18n && api.i18n.getMessage(key, s)) || fallback.replace(/\$(\d)/g, (_m, d) => s[Number(d) - 1] ?? '');
    } catch {
      return fallback.replace(/\$(\d)/g, (_m, d) => s[Number(d) - 1] ?? '');
    }
  }

  /** Grammar-block messages (kept English there for parity) → UI language. */
  function trVarProblem(problem) {
    if (problem === 'Fill in this field') return tr('varFillIn', 'Fill in this field');
    if (problem === 'Pick one of the options') return tr('varPickOption', 'Pick one of the options');
    const m = /^Enter a whole number from (-?\d+) to (-?\d+)$/.exec(problem);
    if (m) return tr('varWholeNumber', 'Enter a whole number from $1 to $2', m[1], m[2]);
    return problem;
  }

  const HOST_ID = 'prompty-content-ui';
  const WIDGET_SIZE = 42;
  const PILL_HIDE_DELAY_MS = 400;
  const POLL_INTERVAL_MS = 1500;

  /** @type {any} */ let host = null;
  /** @type {any} */ let pill = null;
  /** @type {any} */ let pillMenu = null;
  /** @type {any} */ let widgetBubble = null;
  /** @type {any} */ let widgetPanel = null;
  /** @type {any} */ let widgetSearchInput = null;
  /** @type {any} */ let widgetList = null;
  /** @type {any} */ let saveModal = null;
  /** @type {any} */ let saveTitleInput = null;
  /** @type {any} */ let toastEl = null;

  // Quick-insert palette (G1)
  /** @type {any} */ let palette = null;
  /** @type {any} */ let paletteList = null;
  /** @type {any} */ let paletteSearch = null;
  /** @type {any} */ let paletteSelectedIndex = 0;
  /** @type {any} */ let paletteItems = [];
  /** @type {any} */ let paletteTarget = null;
  /** @type {any} */ let paletteVariablePrompt = null;
  /** @type {any} */ let paletteVariableInputs = null;
  /** @type {any} */ let paletteVariableSpecs = null;
  /** @type {any} */ let paletteVariableMemory = {};
  let paletteVisible = false;

  /** @type {any} */ let pillAnchor = null;
  let pillVisible = false;
  /** @type {any} */ let lastPageEditable = null;

  let settings = normalizeSettings(null);
  let prompts = [];
  let pageOrigin = getOrigin(location.href);
  let lastUrl = location.href;
  let widgetExpanded = false;
  let sessionWidgetHidden = false;
  let saveModalPendingText = '';
  let pollTimer = 0;
  let hideTimer = 0;
  let toastTimer = 0;
  let savePosTimer = 0;
  /** @type {any} */ let storageChangedListener = null;
  /** @type {any} */ let messageListener = null;
  /** @type {any} */ let observer = null;

  // Site recipes (merged built-in + user from storage)
  let siteRecipes = [];

  /* ------------------------------------------------------------------ */
  /* DOM construction helpers (CSSOM only — CSP-proof, textContent only) */
  /* ------------------------------------------------------------------ */

  /**
   * Apply a styles map via CSSOM (never inline HTML style attributes —
   * survives page CSP style-src directives).
   * @param {any} el
   * @param {Record<string, string>} styles
   */
  function applyStyles(el, styles) {
    for (const key of Object.keys(styles)) {
      el.style[key] = styles[key];
    }
  }

  /**
   * Create an element inside our shadow root.
   * @param {string} tag
   * @param {string} className
   * @returns {any}
   */
  function elInShadow(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* UI: shared palette                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Brand tokens (Dream Pixels Forge): black/white structure, one orange accent.
   * Mirrors src/popup/popup.css — kept in sync by tests/theme-parity.test.mjs.
   * Lives in the shadow root as CSS custom properties, so inline STYLES can use
   * var(--pf-*) and light/dark follows the user's preference with no JS.
   * (`all: initial` on the host does not reset custom properties.)
   */
  const THEME_CSS = `
:host {
  --pf-accent: #ff6a00;
  --pf-accent-hover: #ff7f24;
  --pf-accent-ink: #0e0e10;
  --pf-accent-text: #b84c00;
  --pf-accent-soft: #fff1eb;
  --pf-surface: #ffffff;
  --pf-sunken: #f4f4f4;
  --pf-fg: #0a0a0a;
  --pf-muted: #666666;
  --pf-line: #e8e8e8;
  --pf-line-strong: #cfcfcf;
  --pf-invert-bg: #0a0a0a;
  --pf-invert-fg: #ffffff;
  --pf-danger: #d92d20;
  --pf-mascot-bg: #0e0e10;
  --pf-scrim: rgba(10, 10, 15, 0.45);
  --pf-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  --pf-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.22);
}
@media (prefers-color-scheme: dark) {
  :host {
    --pf-accent-text: #ff8a33;
    --pf-accent-soft: #2b1208;
    --pf-surface: #17171a;
    --pf-sunken: #1f1f23;
    --pf-fg: #f5f5f5;
    --pf-muted: #9a9a9a;
    --pf-line: #2a2a30;
    --pf-line-strong: #3a3a42;
    --pf-invert-bg: #f5f5f5;
    --pf-invert-fg: #0a0a0a;
    --pf-danger: #ff6b5e;
    --pf-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    --pf-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.7);
  }
}
input:focus { border-color: var(--pf-accent) !important; }
button:focus-visible { outline: 2px solid var(--pf-accent-text); outline-offset: 1px; }
`;

  const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  const STYLES = {
    pill: {
      position: 'absolute',
      display: 'flex',
      gap: '2px',
      padding: '3px',
      background: 'var(--pf-surface)',
      border: '1px solid var(--pf-line)',
      borderRadius: '10px',
      boxShadow: 'var(--pf-shadow)',
      pointerEvents: 'auto',
    },
    pillButton: {
      appearance: 'none',
      border: '0',
      background: 'transparent',
      color: 'var(--pf-fg)',
      fontSize: '13px',
      lineHeight: '1',
      padding: '5px 7px',
      borderRadius: '7px',
      cursor: 'pointer',
      fontFamily: FONT,
    },
    pillButtonHover: { background: 'var(--pf-accent-soft)' },
    menu: {
      position: 'absolute',
      background: 'var(--pf-surface)',
      border: '1px solid var(--pf-line)',
      borderRadius: '8px',
      boxShadow: 'var(--pf-shadow)',
      padding: '4px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      pointerEvents: 'auto',
      minWidth: '150px',
    },
    widgetBubble: {
      position: 'absolute',
      width: `${WIDGET_SIZE}px`,
      height: `${WIDGET_SIZE}px`,
      // Rounded square like the app icon: dark tile, white mascot, orange accents.
      borderRadius: '14px',
      background: 'var(--pf-mascot-bg)',
      color: '#ffffff',
      border: '2px solid var(--pf-accent)',
      boxShadow: 'var(--pf-shadow)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '18px',
      fontWeight: '700',
      cursor: 'grab',
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'none',
      fontFamily: FONT,
    },
    widgetPanel: {
      position: 'absolute',
      width: '320px',
      boxSizing: 'border-box',
      maxHeight: '340px',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--pf-surface)',
      border: '1px solid var(--pf-line)',
      borderRadius: '10px',
      boxShadow: 'var(--pf-shadow-lg)',
      padding: '8px',
      gap: '6px',
      pointerEvents: 'auto',
      fontFamily: FONT,
    },
    widgetSearch: {
      width: '100%',
      background: 'var(--pf-sunken)',
      border: '1px solid var(--pf-line)',
      borderRadius: '7px',
      color: 'var(--pf-fg)',
      fontSize: '13px',
      padding: '6px 8px',
      outline: 'none',
      boxSizing: 'border-box',
    },
    widgetList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      overflowY: 'auto',
      maxHeight: '260px',
    },
    row: {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      padding: '6px 7px',
      background: 'var(--pf-sunken)',
      borderRadius: '8px',
    },
    rowTitle: {
      color: 'var(--pf-fg)',
      fontSize: '13px',
      fontWeight: '600',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    rowText: {
      color: 'var(--pf-muted)',
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    rowActions: { display: 'flex', gap: '4px' },
    rowButton: {
      appearance: 'none',
      border: '1px solid var(--pf-line-strong)',
      background: 'var(--pf-surface)',
      color: 'var(--pf-fg)',
      fontSize: '11px',
      fontWeight: '600',
      padding: '3px 8px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    menuButton: {
      appearance: 'none',
      border: '0',
      background: 'transparent',
      color: 'var(--pf-fg)',
      fontSize: '12px',
      textAlign: 'left',
      padding: '6px 8px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: FONT,
      whiteSpace: 'nowrap',
    },
    emptyList: {
      color: 'var(--pf-muted)',
      fontSize: '12px',
      padding: '8px 4px',
    },
    overlay: {
      position: 'absolute',
      inset: '0',
      width: '100vw',
      height: '100vh',
      background: 'var(--pf-scrim)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
    },
    modal: {
      width: '320px',
      background: 'var(--pf-surface)',
      border: '1px solid var(--pf-line)',
      borderRadius: '12px',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxShadow: 'var(--pf-shadow-lg)',
      fontFamily: FONT,
    },
    modalLabel: { color: 'var(--pf-fg)', fontSize: '13px', fontWeight: '700' },
    modalText: { color: 'var(--pf-muted)', fontSize: '11px', maxHeight: '44px', overflow: 'hidden' },
    modalInput: {
      width: '100%',
      background: 'var(--pf-sunken)',
      border: '1px solid var(--pf-line)',
      borderRadius: '7px',
      color: 'var(--pf-fg)',
      fontSize: '13px',
      padding: '7px 9px',
      outline: 'none',
      boxSizing: 'border-box',
    },
    modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '6px' },
    modalPrimary: {
      appearance: 'none',
      border: '0',
      background: 'var(--pf-accent)',
      color: 'var(--pf-accent-ink)',
      fontSize: '13px',
      fontWeight: '700',
      padding: '7px 14px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    modalSecondary: {
      appearance: 'none',
      border: '1px solid var(--pf-line-strong)',
      background: 'transparent',
      color: 'var(--pf-fg)',
      fontSize: '13px',
      padding: '7px 14px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    toast: {
      // Viewport-anchored: the host is a 0×0 box, so absolute right/bottom
      // would place the toast above-left of the screen.
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      maxWidth: '340px',
      // Inverted like the popup's toasts, with the brand edge.
      background: 'var(--pf-invert-bg)',
      border: '0',
      borderLeft: '3px solid var(--pf-accent)',
      borderRadius: '8px',
      padding: '10px 14px',
      color: 'var(--pf-invert-fg)',
      fontSize: '13px',
      boxShadow: 'var(--pf-shadow-lg)',
      pointerEvents: 'none',
      fontFamily: FONT,
    },
    friendlyNote: {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    },
    // Quick-insert palette (G1)
    palette: {
      position: 'absolute',
      background: 'var(--pf-surface)',
      border: '1px solid var(--pf-line)',
      borderRadius: '10px',
      boxShadow: 'var(--pf-shadow-lg)',
      padding: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      pointerEvents: 'auto',
      minWidth: '280px',
      maxWidth: '420px',
      maxHeight: '360px',
      fontFamily: FONT,
      zIndex: '2147483647',
    },
    paletteSearch: {
      width: '100%',
      background: 'var(--pf-sunken)',
      border: '1px solid var(--pf-line)',
      borderRadius: '7px',
      color: 'var(--pf-fg)',
      fontSize: '13px',
      padding: '6px 8px',
      outline: 'none',
      boxSizing: 'border-box',
    },
    paletteList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      overflowY: 'auto',
      maxHeight: '280px',
    },
    paletteItem: {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      padding: '7px 9px',
      background: 'transparent',
      borderRadius: '7px',
      cursor: 'pointer',
      border: '1px solid transparent',
      boxShadow: 'none',
      transition: 'background 0.08s',
    },
    // Same selection language as the popup palette: sunken row + orange bar.
    paletteItemSelected: {
      background: 'var(--pf-sunken)',
      borderColor: 'transparent',
      boxShadow: 'inset 3px 0 0 var(--pf-accent)',
    },
    paletteItemTitle: {
      color: 'var(--pf-fg)',
      fontSize: '13px',
      fontWeight: '600',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    paletteItemText: {
      color: 'var(--pf-muted)',
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    paletteItemHighlight: {
      background: 'transparent',
      color: 'var(--pf-accent-text)',
      fontWeight: '700',
      padding: '0',
    },
    paletteVarForm: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '6px 2px',
      borderTop: '1px solid var(--pf-line)',
      marginTop: '2px',
    },
    paletteVarLabel: {
      color: 'var(--pf-muted)',
      fontSize: '11px',
      fontWeight: '600',
    },
    paletteVarInput: {
      width: '100%',
      background: 'var(--pf-sunken)',
      border: '1px solid var(--pf-line)',
      borderRadius: '6px',
      color: 'var(--pf-fg)',
      fontSize: '12px',
      padding: '5px 7px',
      outline: 'none',
      boxSizing: 'border-box',
    },
    paletteHint: {
      color: 'var(--pf-muted)',
      fontSize: '11px',
      textAlign: 'center',
      padding: '2px 0',
    },
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * The Prompty mascot as inline SVG (white monitor, dark screen, orange
   * cheeks + cursor). Built with createElementNS — no innerHTML, no <img>,
   * so page CSP (img-src) can't block it and no web_accessible_resources are
   * exposed for sites to fingerprint.
   * @param {number} size px
   * @returns {SVGSVGElement}
   */
  function mascotSvg(size) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';
    /** @param {string} tag @param {Record<string, string|number>} attrs */
    const add = (tag, attrs) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      svg.appendChild(node);
      return node;
    };
    // body + screen
    add('rect', { x: 5, y: 10, width: 34, height: 29, rx: 10, fill: '#ffffff' });
    add('rect', { x: 10, y: 15, width: 24, height: 17, rx: 5, fill: '#0e0e10' });
    // eyes with highlights
    add('circle', { cx: 17, cy: 23, r: 3.3, fill: '#2b2b31' });
    add('circle', { cx: 27, cy: 23, r: 3.3, fill: '#2b2b31' });
    add('circle', { cx: 18, cy: 21.8, r: 1.1, fill: '#ffffff' });
    add('circle', { cx: 28, cy: 21.8, r: 1.1, fill: '#ffffff' });
    // cheeks + smile
    add('ellipse', { cx: 14.6, cy: 27.4, rx: 1.9, ry: 1.2, fill: '#ff6a00' });
    add('ellipse', { cx: 29.4, cy: 27.4, rx: 1.9, ry: 1.2, fill: '#ff6a00' });
    add('path', { d: 'M19.6 27.2 q2.4 2 4.8 0', fill: 'none', stroke: '#8a8a94', 'stroke-width': 1.2, 'stroke-linecap': 'round' });
    // bezel buttons
    add('rect', { x: 24, y: 34.4, width: 6, height: 2.4, rx: 1.2, fill: '#0e0e10' });
    add('circle', { cx: 33.4, cy: 35.6, r: 1.4, fill: '#ff6a00' });
    // orange cursor + click sparks (top-right)
    add('path', { d: 'M35 5 L44.5 9.2 L40.6 10.6 L43.2 13.4 L41.6 15 L39 12.2 L37.6 16 Z', fill: '#ff6a00', 'stroke-linejoin': 'round' });
    add('path', { d: 'M33.5 2.8 l-0.6 -1.8 M38.6 2.6 l1 -1.6 M42.4 5 l1.8 -0.4', stroke: '#ff6a00', 'stroke-width': 1.3, 'stroke-linecap': 'round' });
    return svg;
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Build shadow host + all UI nodes once.
   */
  function buildUi() {
    host = document.createElement('div');
    host.id = HOST_ID;
    // `all: initial` MUST come first: it resets every property, so anything
    // set before it (fixed position, zero size, pointer-events) is lost and the
    // host would sit in the page flow and catch clicks meant for the site.
    applyStyles(host, {
      all: 'initial',
      position: 'fixed',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    // Our panels set `display` inline, which beats the UA `[hidden]` rule — so a
    // "hidden" full-screen backdrop would still cover the page. An !important
    // author rule wins over non-important inline styles and restores `hidden`.
    const baseStyle = document.createElement('style');
    baseStyle.textContent = `[hidden] { display: none !important; }\n${THEME_CSS}`;
    shadow.appendChild(baseStyle);
    document.documentElement.appendChild(host);

    // Pill
    pill = elInShadow('div');
    applyStyles(pill, STYLES.pill);
    pillButton(pill, '⌕', tr('pageOpenLibrary', 'Open Prompty library'), () => openLibrary());
    pillButton(pill, '⤒', tr('pageSaveFocused', 'Save focused text as prompt'), () => startSaveFlow());
    pillButton(pill, '⋯', tr('pageMoreOptions', 'More options'), () => togglePillMenu());
    pill.hidden = true;
    shadow.appendChild(pill);

    // Pill menu ("Disable on this site")
    pillMenu = elInShadow('div');
    applyStyles(pillMenu, STYLES.menu);
    const disableButton = elInShadow('button');
    disableButton.textContent = tr('pageDisableSite', 'Disable Prompty on this site');
    disableButton.setAttribute('role', 'menuitem');
    applyStyles(disableButton, STYLES.menuButton);
    disableButton.addEventListener('click', () => {
      hidePill();
      void disableOnThisSite();
    });
    pillMenu.appendChild(disableButton);
    pillMenu.hidden = true;
    shadow.appendChild(pillMenu);

    // Widget bubble + panel
    widgetBubble = elInShadow('div');
    widgetBubble.appendChild(mascotSvg(WIDGET_SIZE - 10));
    widgetBubble.setAttribute('aria-label', 'Prompty');
    widgetBubble.setAttribute('role', 'button');
    widgetBubble.setAttribute('title', tr('pageWidgetTitle', 'Prompty — drag to move, click to open'));
    applyStyles(widgetBubble, STYLES.widgetBubble);
    widgetBubble.hidden = true;
    shadow.appendChild(widgetBubble);

    widgetPanel = elInShadow('div');
    applyStyles(widgetPanel, STYLES.widgetPanel);
    widgetSearchInput = elInShadow('input');
    widgetSearchInput.type = 'search';
    widgetSearchInput.placeholder = tr('pageSearchPrompts', 'Search prompts…');
    applyStyles(widgetSearchInput, STYLES.widgetSearch);
    widgetSearchInput.addEventListener('input', () => renderList());
    widgetList = elInShadow('div');
    applyStyles(widgetList, STYLES.widgetList);
    widgetPanel.appendChild(widgetSearchInput);
    widgetPanel.appendChild(widgetList);
    widgetPanel.hidden = true;
    shadow.appendChild(widgetPanel);

    // Save-title modal (never window.prompt — quirk fix)
    saveModal = elInShadow('div');
    const card = elInShadow('div');
    const label = elInShadow('div');
    label.textContent = tr('saveAsPrompt', 'Save as prompt');
    const textPreview = elInShadow('div');
    saveTitleInput = elInShadow('input');
    saveTitleInput.type = 'text';
    saveTitleInput.placeholder = tr('pagePromptTitle', 'Prompt title');
    const actions = elInShadow('div');
    const cancelButton = elInShadow('button');
    cancelButton.textContent = tr('cancel', 'Cancel');
    const saveButton = elInShadow('button');
    saveButton.textContent = tr('save', 'Save');
    cancelButton.addEventListener('click', closeSaveModal);
    saveButton.addEventListener('click', () => confirmSave());
    applyStyles(card, STYLES.modal);
    applyStyles(label, STYLES.modalLabel);
    applyStyles(textPreview, STYLES.modalText);
    applyStyles(saveTitleInput, STYLES.modalInput);
    applyStyles(actions, STYLES.modalActions);
    applyStyles(cancelButton, STYLES.modalSecondary);
    applyStyles(saveButton, STYLES.modalPrimary);
    saveTitleInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') confirmSave();
      if (ev.key === 'Escape') closeSaveModal();
    });
    actions.appendChild(cancelButton);
    actions.appendChild(saveButton);
    card.appendChild(label);
    card.appendChild(saveTitleInput);
    card.appendChild(textPreview);
    card.appendChild(actions);
    applyStyles(saveModal, STYLES.overlay);
    saveModal.appendChild(card);
    saveModal.hidden = true;
    shadow.appendChild(saveModal);

    // Toast (page-level fallback display — SHOW_TOAST passthrough)
    toastEl = elInShadow('div');
    applyStyles(toastEl, STYLES.toast);
    toastEl.hidden = true;
    shadow.appendChild(toastEl);

    // Quick-insert palette (G1) — built but hidden initially
    palette = elInShadow('div');
    applyStyles(palette, STYLES.palette);
    palette.hidden = true;

    paletteSearch = elInShadow('input');
    paletteSearch.type = 'search';
    paletteSearch.placeholder = tr('pageSearchPrompts', 'Search prompts…');
    applyStyles(paletteSearch, STYLES.paletteSearch);
    paletteSearch.addEventListener('input', () => filterPalette());
    // Keys reach handlePaletteKeydown through the document capture listener
    // (onKeyDown); a second listener here moved the selection two rows per press.
    palette.appendChild(paletteSearch);

    paletteList = elInShadow('div');
    applyStyles(paletteList, STYLES.paletteList);
    palette.appendChild(paletteList);

    const paletteHint = elInShadow('div');
    paletteHint.textContent = tr('pagePaletteHint', '↑↓ navigate · Enter insert · Esc close');
    applyStyles(paletteHint, STYLES.paletteHint);
    palette.appendChild(paletteHint);

    shadow.appendChild(palette);
  }

  /**
   * Small pill button factory.
   * @param {any} parent
   * @param {string} glyph
   * @param {string} title
   * @param {() => void} onClick
   */
  function pillButton(parent, glyph, title, onClick) {
    const button = elInShadow('button');
    button.textContent = glyph;
    button.title = title;
    button.setAttribute('aria-label', title);
    applyStyles(button, STYLES.pillButton);
    // keep focus in the page editable while pressing pill actions
    button.addEventListener('mousedown', (ev) => ev.preventDefault());
    button.addEventListener('mouseenter', () => applyStyles(button, STYLES.pillButtonHover));
    button.addEventListener('mouseleave', () => applyStyles(button, STYLES.pillButton));
    button.addEventListener('click', onClick);
    parent.appendChild(button);
  }

  /**
   * Create host + kick off async setup. Safe to call from document_idle.
   */
  function start() {
    buildUi();
    wireWidgetDrag();
    void Promise.resolve(bootstrapState()).catch(() => {});
    registerGlobalListeners();
  }

  /* ------------------------------------------------------------------ */
  /* G10 Vault: secret keys go through the background while the vault is on */
  /* ------------------------------------------------------------------ */

  /** Keys the content script needs that are encrypted when the vault is on. */
  const VAULT_SECRET_KEYS = ['prompts', 'documents', 'variableMemory'];
  /** True after the background reported the vault as locked. */
  let vaultLocked = false;
  const VAULT_LOCKED_MESSAGE = tr('pageVaultLocked', 'Vault locked — open Prompty to unlock');

  /**
   * storage.local look-alike: plain keys read/write directly; with the vault
   * on, prompts/variableMemory are decrypted/encrypted by the background
   * (the key never reaches the page). Locked reads omit the secret keys;
   * locked writes throw.
   * @returns {{ get: (keys: string[]) => Promise<any>, set: (items: Record<string, any>) => Promise<void> } | null}
   */
  function pageStore() {
    const local = api.storage && api.storage.local;
    if (!local) return null;
    const isOn = async () => {
      const meta = await local.get(['vault']);
      return !!(meta && meta.vault);
    };
    return {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const secret = list.filter((k) => VAULT_SECRET_KEYS.includes(k));
        if (secret.length === 0 || !(await isOn())) {
          vaultLocked = false;
          return local.get(list);
        }
        const plain = list.filter((k) => !VAULT_SECRET_KEYS.includes(k));
        const out = plain.length ? await local.get(plain) : {};
        const res = await api.runtime.sendMessage({ type: 'PROMPTY_VAULT_GET', keys: secret });
        vaultLocked = !!(res && res.locked);
        if (res && res.ok && res.data && typeof res.data === 'object') Object.assign(out, res.data);
        return out;
      },
      async set(items) {
        const secret = {};
        const plain = {};
        for (const [k, v] of Object.entries(items)) (VAULT_SECRET_KEYS.includes(k) ? secret : plain)[k] = v;
        if (Object.keys(plain).length) await local.set(plain);
        if (Object.keys(secret).length === 0) return;
        if (!(await isOn())) {
          await local.set(secret);
          return;
        }
        const res = await api.runtime.sendMessage({ type: 'PROMPTY_VAULT_SET', items: secret });
        vaultLocked = !!(res && res.locked);
        if (!res || !res.ok) throw new Error(vaultLocked ? VAULT_LOCKED_MESSAGE : tr('pageCouldNotSave', 'Could not save'));
      },
    };
  }

  /**
   * Read settings + position + prompts from storage and apply.
   */
  async function bootstrapState() {
    const store = pageStore();
    if (!store) return;
    const posKey = `widgetPositions:${pageOrigin}`;
    const data = await store.get(['settings', posKey, 'prompts', 'siteRecipes']);
    settings = normalizeSettings(data?.settings);
    prompts = storedPromptList(data?.prompts);
    const pos = data?.[posKey];
    if (widgetBubble) {
      const x = typeof pos === 'object' && pos !== null ? Number(pos.x) : NaN;
      const y = typeof pos === 'object' && pos !== null ? Number(pos.y) : NaN;
      placeWidgetBubble(
        Number.isFinite(x) ? x : window.innerWidth - WIDGET_SIZE - 24,
        Number.isFinite(y) ? y : Math.round(window.innerHeight * 0.35),
      );
    }
    // Merge built-in recipes with user recipes from storage
    const userRecipes = Array.isArray(data?.siteRecipes) ? data.siteRecipes : [];
    siteRecipes = [...BUILTIN_RECIPES, ...userRecipes];
    applyWidgetVisibility();
    renderList();
  }

  /* ------------------------------------------------------------------ */
  /* Settings / widget visibility (Δ2, Δ3)                               */
  /* ------------------------------------------------------------------ */

  /**
   * Apply visibility rules: settings.showFloatingWidget + per-site
   * disabledSites[] honor + session toggle. Site-disabled only suppresses
   * our passive UI, never the explicit message handlers (SECURITY.md).
   */
  function applyWidgetVisibility() {
    if (!widgetBubble) return;
    const disabled = isSiteDisabled(location.href, settings.disabledSites);
    widgetBubble.hidden = !settings.showFloatingWidget || disabled || sessionWidgetHidden;
    if (widgetBubble.hidden) {
      widgetExpanded = false;
      widgetPanel.hidden = true;
    }
    if (disabled) hidePill();
  }

  /**
   * Persist current origin to settings.disabledSites ("Disable on this
   * site" menu item). Read-modify-write with a whitelist of the only key the
   * content script ever changes.
   */
  async function disableOnThisSite() {
    const store = pageStore();
    if (!store) return;
    const origin = getOrigin(location.href);
    if (origin === '') return;
    try {
      const data = await store.get(['settings']);
      const existing = data?.settings;
      const previous = Array.isArray(existing?.disabledSites)
        ? existing.disabledSites.filter((s) => typeof s === 'string')
        : [];
      const next = previous.includes(origin) ? previous : [...previous, origin];
      // Own-storage spread + downstream re-whitelist on read (SECURITY.md).
      await store.set({ settings: { ...(existing && typeof existing === 'object' ? existing : {}), disabledSites: next } });
      settings.disabledSites = next;
      applyWidgetVisibility();
    } catch {
      // storage failures are non-fatal in content scripts
    }
  }

  /* ------------------------------------------------------------------ */
  /* Assist pill (Δ2)                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Show the pill anchored to `el`'s rect.
   * @param {any} el
   */
  function showPill(el) {
    if (!host || !isPageEditableElement(el)) return;
    lastPageEditable = el;
    pillAnchor = el;
    window.clearTimeout(hideTimer);
    pillVisible = true;
    pill.hidden = false;
    positionPill();
  }

  /**
   * Debounced (400ms) collapse — SPEC Δ2. Cancel pending hides on show.
   */
  function schedulePillHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hidePill, PILL_HIDE_DELAY_MS);
  }

  /**
   * Immediately hide pill + menu.
   */
  function hidePill() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    pillVisible = false;
    pillAnchor = null;
    if (pill) pill.hidden = true;
    if (pillMenu) pillMenu.hidden = true;
  }

  /**
   * Anchor pill near the editable rect (below-right, clamped in-viewport,
   * above the element when there is no room underneath).
   */
  function positionPill() {
    if (!pill || !pillVisible || !pillAnchor || !pillAnchor.isConnected) return;
    const rect = pillAnchor.getBoundingClientRect();
    const pillWidth = pill.offsetWidth || 120;
    const pillHeight = pill.offsetHeight || 32;
    const x = clampNumber(rect.right - pillWidth, 8, Math.max(8, window.innerWidth - pillWidth - 8));
    let y = rect.bottom + 6;
    if (y + pillHeight > window.innerHeight - 8) y = Math.max(8, rect.top - pillHeight - 6);
    pill.style.left = `${x}px`;
    pill.style.top = `${y}px`;
    pillMenu.style.left = `${x}px`;
    pillMenu.style.top = `${y + pillHeight + 4}px`;
  }

  function togglePillMenu() {
    if (!pillMenu) return;
    pillMenu.hidden = !pillMenu.hidden;
    if (!pillMenu.hidden) positionPill();
  }

  /* ------------------------------------------------------------------ */
  /* Save-focused-text flow (styled shadow modal — no window.prompt)     */
  /* ------------------------------------------------------------------ */

  /**
   * ⤒ action: capture focused editable's text, open the styled title modal.
   */
  function startSaveFlow() {
    const target = pillAnchor && pillAnchor.isConnected ? pillAnchor : editableValueTarget();
    const text = readEditableText(target);
    if (text.trim() === '') {
      showToast({ message: tr('pageFieldEmpty', 'Focused field is empty'), isError: true });
      return;
    }
    saveModalPendingText = text;
    hidePill();
    openSaveModal(truncatedTitle(text) || tr('pageUntitledPrompt', 'Untitled prompt'), text);
  }

  /**
   * Target for save capture when pill lost its anchor.
   * @returns {any}
   */
  function editableValueTarget() {
    const active = document.activeElement;
    if (active && isPageEditableElement(active) && !isInsideOurHost(active)) return active;
    if (lastPageEditable && lastPageEditable.isConnected && isPageEditableElement(lastPageEditable)) {
      return lastPageEditable;
    }
    return null;
  }

  /**
   * Open the styled save modal in the shadow root.
   * @param {string} defaultTitle
   * @param {string} text
   */
  function openSaveModal(defaultTitle, text) {
    saveTitleInput.value = defaultTitle;
    const preview = saveModal.firstElementChild.children[2];
    preview.textContent = text.length > 220 ? `${text.slice(0, 220)}…` : text;
    saveModal.hidden = false;
    saveTitleInput.focus();
  }

  function closeSaveModal() {
    saveModal.hidden = true;
    saveModalPendingText = '';
  }

  /**
   * Get the selected value from a <select> element matching the selector.
   * @param {string} selector
   * @returns {string|null}
   */
  function getSelectValue(selector) {
    try {
      const el = document.querySelector(selector);
      if (el && el.tagName === 'SELECT') {
        return el.value || null;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Confirm: append the prompt to storage.prompts (own whitelist-built
   * object; existing entries pass through untouched — no untrusted merge).
   * Uses matched site recipe to capture aspectRatio/quality from page selects.
   */
  async function confirmSave() {
    const store = pageStore();
    const text = saveModalPendingText;
    const title = String(saveTitleInput.value || '').trim() || truncatedTitle(text, 40) || tr('pageUntitledPrompt', 'Untitled prompt');
    closeSaveModal();
    if (!store) {
      showToast({ message: tr('pageStorageUnavailable', 'Storage unavailable'), isError: true });
      return;
    }
    try {
      const data = await store.get(['prompts']);
      const list = storedPromptList(data?.prompts);

      // Match recipe for current URL to capture aspect/quality
      const recipe = matchRecipe(location.href, siteRecipes);
      let aspectRatio = null;
      let quality = null;
      if (recipe) {
        aspectRatio = getSelectValue(recipe.selects?.aspect);
        quality = getSelectValue(recipe.selects?.quality);
        // Validate quality against recipe's qualityValues
        if (quality && Array.isArray(recipe.qualityValues) && !recipe.qualityValues.includes(quality)) {
          quality = null;
        }
      }

      const promptObj = buildPromptObject(title, text);
      promptObj.aspectRatio = aspectRatio;
      promptObj.quality = quality;

      list.push(promptObj);
      await store.set({ prompts: list });
      prompts = list;
      renderList();
      showToast({ message: tr('pagePromptSaved', 'Prompt saved'), icon: '✓' });
    } catch {
      showToast({ message: vaultLocked ? VAULT_LOCKED_MESSAGE : tr('pageCouldNotSavePrompt', 'Could not save prompt'), isError: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Insert machinery (SPEC §1 native setters + bubbled events, Δ7)      */
  /* ------------------------------------------------------------------ */

  /**
   * Fire a bubbling Event on `el`.
   * @param {any} el
   * @param {string} type
   */
  function fireBubbled(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }

  /**
   * Native prototype value setter (React-proof) with a fallback assignment.
   * @param {any} el
   * @param {string} value
   * @returns {boolean}
   */
  function setNativeValue(el, value) {
    const ownerProto =
      elementTag(el) === 'TEXTAREA'
        ? window.HTMLTextAreaElement?.prototype
        : elementTag(el) === 'SELECT'
          ? window.HTMLSelectElement?.prototype
          : window.HTMLInputElement?.prototype;
    const descriptor = ownerProto ? Object.getOwnPropertyDescriptor(ownerProto, 'value') : undefined;
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, value);
      return true;
    }
    el.value = value;
    return true;
  }

  /**
   * Insert/append text into textarea|input (native setter + input/change +
   * keydown/keyup bubbled, upstream-proven Spec §1).
   * @param {any} el
   * @param {string} text
   * @param {string} mode
   * @returns {{success: boolean, error?: string}}
   */
  function insertIntoTextField(el, text, mode) {
    const joined = mode === 'append' ? appendJoin(el.value, text) : text;
    if (joined === '') return { success: false, error: tr('pageEmptyPromptText', 'Empty prompt text') };
    try {
      fireBubbled(el, 'keydown');
      setNativeValue(el, joined);
      fireBubbled(el, 'input');
      fireBubbled(el, 'keyup');
      fireBubbled(el, 'change');
    } catch {
      return { success: false, error: tr('pageInsertRejected', 'Insert rejected by page') };
    }
    if (document.activeElement === el && typeof el.setSelectionRange === 'function') {
      try {
        el.setSelectionRange(joined.length, joined.length);
      } catch {
        // setSelectionRange may reject on exotic input types
      }
    }
    return { success: true };
  }

  /**
   * Insert/append into <select>: native setter + change (SPEC §1). Requires
   * an option whose exact trimmed label matches the prompt text.
   * @param {any} el
   * @param {string} text
   * @param {string} mode
   * @returns {{success: boolean, error?: string}}
   */
  function insertIntoSelect(el, text, mode) {
    const wanted = mode === 'append' ? appendJoin('', text) : text;
    const needle = String(wanted).trim();
    const options = Array.isArray(el.options) ? Array.from(el.options) : [];
    const match = options.find((option) => option && option.textContent && option.textContent.trim() === needle);
    if (!match) return { success: false, error: tr('pageNoMatchingOption', 'No matching select option') };
    try {
      setNativeValue(el, match.value);
      fireBubbled(el, 'change');
    } catch {
      return { success: false, error: tr('pageInsertRejected', 'Insert rejected by page') };
    }
    return { success: true };
  }

  /**
   * Caret to end of a contenteditable element.
   * @param {any} el
   * @returns {boolean}
   */
  function placeCaretAtEnd(el) {
    const selection = window.getSelection && window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  /**
   * Insert/append into contenteditable: focus + Range/selection + input
   * event (SPEC §1). execCommand('insertText') is used when available;
   * fallback is a textContent replace + manual input event.
   * @param {any} el
   * @param {string} text
   * @param {string} mode
   * @returns {{success: boolean, error?: string}}
   */
  function insertIntoContentEditable(el, text, mode) {
    try {
      el.focus({ preventScroll: true });
      if (mode === 'append') placeCaretAtEnd(el);
      else {
        const selection = window.getSelection && window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      const executed = document.execCommand && document.execCommand('insertText', false, text);
      if (!executed) {
        el.textContent = mode === 'append' ? appendJoin(el.textContent, text) : text;
        fireBubbled(el, 'input');
      }
    } catch {
      return { success: false, error: tr('pageInsertRejected', 'Insert rejected by page') };
    }
    return { success: true };
  }

  /**
   * Shared insertion dispatcher used by PROMPTY_INSERT and widget buttons.
   * @param {any} target
   * @param {string} text
   * @param {string} mode 'insert'|'append'
   * @returns {{success: boolean, error?: string}}
   */
  function insertInto(target, text, mode) {
    const tag = elementTag(target);
    if (tag === 'TEXTAREA' || tag === 'INPUT') return insertIntoTextField(target, text, mode);
    if (tag === 'SELECT') return insertIntoSelect(target, text, mode);
    if (target.isContentEditable === true) return insertIntoContentEditable(target, text, mode);
    return { success: false, error: tr('pageNoTarget', 'No editable target found') };
  }

  /**
   * Focused page editable first, else assist-detected (Δ7 target rule).
   * Our own shadow UI never counts as a target.
   * @returns {any}
   */
  function resolveInsertTarget() {
    const active = document.activeElement;
    if (active) {
      const composed = typeof active.shadowRoot === 'object' ? active : active;
      if (isPageEditableElement(composed) && !isInsideOurHost(composed)) return composed;
      if (elementTag(composed) === 'SELECT' && !isInsideOurHost(composed)) return composed;
    }
    if (lastPageEditable && lastPageEditable.isConnected && isPageEditableElement(lastPageEditable)) {
      return lastPageEditable;
    }
    return null;
  }

  /**
   * Read the current text of an editable (for the save flow).
   * @param {any} el
   * @returns {string}
   */
  function readEditableText(el) {
    if (!el) return '';
    if (elementTag(el) === 'TEXTAREA' || elementTag(el) === 'INPUT') return String(el.value ?? '');
    if (el.isContentEditable === true) return String(el.isContentEditable !== undefined ? el.textContent ?? '' : '');
    return '';
  }

  /**
   * Whether a node belongs to our shadow UI (never a page target).
   * @param {any} node
   * @returns {boolean}
   */
  function isInsideOurHost(node) {
    if (!node || typeof node.getRootNode !== 'function') return false;
    let root = node.getRootNode();
    while (root && typeof root === 'object') {
      if (root === host) return true;
      root = typeof root.host === 'object' ? root.host : null;
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Quick-insert palette (G1)                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Get caret coordinates for an editable element.
   * Returns {x, y, height} relative to viewport.
   * @param {any} el
   * @returns {{x: number, y: number, height: number}}
   */
  function getCaretCoordinates(el) {
    const tag = elementTag(el);
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      // For textarea/input, create a mirror div to measure caret position
      const value = el.value;
      const prefix = value.slice(0, el.selectionStart);
      const mirror = document.createElement('div');
      const style = window.getComputedStyle(el);
      mirror.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre-wrap;
        word-wrap: break-word;
        font: ${style.font};
        line-height: ${style.lineHeight};
        padding: ${style.padding};
        border: ${style.border};
        box-sizing: ${style.boxSizing};
        width: ${style.width};
        top: -9999px;
        left: -9999px;
      `;
      // Measure a marker at the caret relative to the mirror, *while attached*
      // (a detached element reports a zero rect), then map onto the field.
      mirror.textContent = prefix;
      const marker = document.createElement('span');
      marker.textContent = '\u200B'; // zero-width space at caret
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const mirrorRect = mirror.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      document.body.removeChild(mirror);
      const elRect = el.getBoundingClientRect();
      return {
        x: elRect.left + (markerRect.left - mirrorRect.left) - (el.scrollLeft || 0),
        y: elRect.top + (markerRect.top - mirrorRect.top) - (el.scrollTop || 0),
        height: lineHeight,
      };
    }
    if (el.isContentEditable === true) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          height: rect.height || 20,
        };
      }
    }
    // Fallback: element position
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, height: 20 };
  }

  /**
   * Open the quick-insert palette anchored near the caret.
   * @param {any} target
   */
  function openPalette(target) {
    if (!palette || !settings.quickTriggerEnabled) return;
    paletteTarget = target;
    paletteVisible = true;
    paletteSelectedIndex = 0;
    paletteVariablePrompt = null;
    paletteVariableInputs = null;

    // Load prompts from storage
    loadPromptsForPalette().then(() => {
      filterPalette();
      palette.hidden = false; // unhide first so positionPalette measures the real size
      positionPalette();
      paletteSearch.focus({ preventScroll: true });
      paletteSearch.value = '';
    });
  }

  /**
   * Load prompts + document shots from storage for the palette.
   * Shots come from prompt-sheet documents (## ID — Name + fenced block).
   */
  async function loadPromptsForPalette() {
    const store = pageStore();
    if (!store) return;
    try {
      const data = await store.get(['prompts', 'documents', 'projects']);
      const promptItems = storedPromptList(data?.prompts).map((p) => ({ kind: 'prompt', ...p }));
      const projectById = new Map();
      for (const p of Array.isArray(data?.projects) ? data.projects : []) {
        if (p && typeof p.id === 'string') projectById.set(p.id, p);
      }
      /** @type {any[]} */
      const shotItems = [];
      for (const doc of Array.isArray(data?.documents) ? data.documents : []) {
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
        const project = projectById.get(doc.projectId) || {};
        const shots = extractShotsFromMarkdown(doc.markdown, doc.id, String(project.name ?? ''));
        for (const shot of shots) {
          shotItems.push({ kind: 'shot', ...shot });
        }
      }
      paletteItems = [...promptItems, ...shotItems];
      if (vaultLocked) showToast({ message: VAULT_LOCKED_MESSAGE, isError: true });
    } catch {
      paletteItems = [];
    }
  }

  /**
   * Position the palette near the caret of the target element.
   */
  function positionPalette() {
    if (!palette || !paletteTarget || !paletteVisible) return;
    const coords = getCaretCoordinates(paletteTarget);
    const paletteWidth = palette.offsetWidth || 320;
    const paletteHeight = palette.offsetHeight || 300;

    let x = coords.x;
    let y = coords.y + coords.height + 4;

    // Clamp to viewport
    x = clampNumber(x, 8, Math.max(8, window.innerWidth - paletteWidth - 8));
    if (y + paletteHeight > window.innerHeight - 8) {
      y = Math.max(8, coords.y - paletteHeight - 4);
    }

    palette.style.left = `${x}px`;
    palette.style.top = `${y}px`;
  }

  /**
   * Close the palette and reset state.
   */
  function closePalette() {
    paletteVisible = false;
    paletteTarget = null;
    paletteVariablePrompt = null;
    paletteVariableInputs = null;
    paletteVariableSpecs = null;
    if (palette) palette.hidden = true;
    if (paletteSearch) paletteSearch.value = '';
    if (paletteList) {
      while (paletteList.firstChild) paletteList.removeChild(paletteList.firstChild);
    }
  }

  /**
   * Filter and render palette items based on search input.
   */
  function filterPalette() {
    if (!paletteList || !paletteSearch) return;
    const query = paletteSearch.value.trim().toLowerCase();

    // Use inline fuzzy match (non-drift via test hook)
    const scored = [];
    for (const item of paletteItems) {
      let key, ts;
      if (item.kind === 'shot') {
        // Search across shot id, name, project and prompt text.
        key = `${String(item.shotId ?? '')} ${String(item.name ?? '')} ${String(item.projectName ?? '')} ${String(item.prompt ?? '')}`;
        ts = 0; // shots rank on match quality only
      } else {
        key = `${String(item.title ?? '')} ${String(item.text ?? '')}`;
        ts = item.lastUsedAt || item.createdAt;
      }
      const subScore = subsequenceScoreInline(key, query);
      if (subScore !== null) {
        let recencyScore = 0;
        if (typeof ts === 'number' && ts > 0) {
          const ageMs = Date.now() - ts;
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          recencyScore = Math.max(0, 0.2 * (1 - ageMs / thirtyDaysMs));
        }
        scored.push({ item, score: subScore + recencyScore, key });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const topItems = scored.slice(0, 8);

    // Render
    while (paletteList.firstChild) paletteList.removeChild(paletteList.firstChild);
    for (let i = 0; i < topItems.length; i++) {
      const { item, key } = topItems[i];
      paletteList.appendChild(createPaletteItem(item, key, query, i === paletteSelectedIndex));
    }

    // Update selected index if out of bounds
    if (paletteSelectedIndex >= topItems.length) {
      paletteSelectedIndex = Math.max(0, topItems.length - 1);
    }
    updatePaletteSelection(topItems.length);
  }

  /**
   * Inline subsequence score (copied from src/lib/search.js for non-drift testing).
   * @param {string} target
   * @param {string} query
   * @returns {number|null}
   */
  function subsequenceScoreInline(target, query) {
    if (typeof target !== 'string' || typeof query !== 'string') return null;
    const t = target.toLowerCase();
    const q = query.toLowerCase();
    if (q.length === 0) return 1;
    if (q.length > t.length) return null;

    let ti = 0;
    let qi = 0;
    let firstMatchIndex = -1;
    const matchIndices = [];

    while (ti < t.length && qi < q.length) {
      if (t[ti] === q[qi]) {
        if (firstMatchIndex === -1) firstMatchIndex = ti;
        matchIndices.push(ti);
        qi++;
      }
      ti++;
    }

    if (qi < q.length) return null;

    const spread = matchIndices[matchIndices.length - 1] - matchIndices[0] + 1;
    const compactness = q.length / spread;
    const prefixBonus = firstMatchIndex === 0 ? 0.15 : 0;
    const positionPenalty = firstMatchIndex / t.length * 0.2;
    const lengthBonus = Math.min(q.length / t.length, 0.1);

    const score = compactness * 0.7 + (1 - positionPenalty) * 0.15 + prefixBonus + lengthBonus;
    return Math.min(1, Math.max(0, score));
  }

  /**
   * Extract match indices for highlighting (inline copy).
   * @param {string} text
   * @param {string} query
   * @returns {{start: number, end: number}[]}
   */
  function extractMatchesInline(text, query) {
    if (typeof text !== 'string' || typeof query !== 'string' || query.length === 0) return [];
    const t = text.toLowerCase();
    const q = query.toLowerCase();

    const indices = [];
    let ti = 0;
    let qi = 0;

    while (ti < t.length && qi < q.length) {
      if (t[ti] === q[qi]) {
        indices.push(ti);
        qi++;
      }
      ti++;
    }

    if (qi < q.length) return [];

    const ranges = [];
    let rangeStart = indices[0];
    let prev = indices[0];

    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === prev + 1) {
        prev = indices[i];
      } else {
        ranges.push({ start: rangeStart, end: prev + 1 });
        rangeStart = indices[i];
        prev = indices[i];
      }
    }
    ranges.push({ start: rangeStart, end: prev + 1 });

    return ranges;
  }

  /**
   * Create a palette item element.
   * @param {any} item prompt or shot ({kind:'shot'|'prompt', ...})
   * @param {string} key
   * @param {string} query
   * @param {boolean} selected
   * @returns {any}
   */
  function createPaletteItem(item, key, query, selected) {
    const isShot = item.kind === 'shot';
    const itemEl = elInShadow('div');
    applyStyles(itemEl, STYLES.paletteItem);
    if (selected) applyStyles(itemEl, STYLES.paletteItemSelected);

    const title = elInShadow('div');
    applyStyles(title, STYLES.paletteItemTitle);
    if (isShot) {
      const shotTitle = String(item.shotId ?? '');
      const shotName = String(item.name ?? '');
      highlightText(title, shotName ? `${shotTitle} — ${shotName}` : shotTitle, query);
    } else {
      highlightText(title, String(item.title ?? '') || '(untitled)', query);
    }
    itemEl.appendChild(title);

    const subtitle = elInShadow('div');
    applyStyles(subtitle, STYLES.paletteItemText);
    if (isShot) {
      const badge = String(item.modelId ?? '');
      subtitle.textContent = String(item.projectName ?? '') + (badge ? ` · ${badge}` : '');
    } else {
      subtitle.textContent = '';
    }
    itemEl.appendChild(subtitle);

    const snippet = elInShadow('div');
    applyStyles(snippet, STYLES.paletteItemText);
    highlightText(snippet, isShot ? String(item.prompt ?? '') : String(item.text ?? ''), query);
    itemEl.appendChild(snippet);

    item.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); // keep focus in page editable
      paletteSelectedIndex = Array.from(paletteList.children).indexOf(item);
      insertFromPalette();
    });
    item.addEventListener('mouseenter', () => {
      paletteSelectedIndex = Array.from(paletteList.children).indexOf(item);
      updatePaletteSelection(paletteList.children.length);
    });

    return item;
  }

  /**
   * Highlight matched characters in text.
   * @param {any} container
   * @param {string} text
   * @param {string} query
   */
  function highlightText(container, text, query) {
    const ranges = extractMatchesInline(text, query);
    if (ranges.length === 0) {
      container.textContent = text;
      return;
    }
    let lastEnd = 0;
    for (const range of ranges) {
      if (range.start > lastEnd) {
        container.appendChild(document.createTextNode(text.slice(lastEnd, range.start)));
      }
      const highlight = document.createElement('mark');
      applyStyles(highlight, STYLES.paletteItemHighlight);
      highlight.textContent = text.slice(range.start, range.end);
      container.appendChild(highlight);
      lastEnd = range.end;
    }
    if (lastEnd < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastEnd)));
    }
  }

  /**
   * Update visual selection state.
   * @param {number} count
   */
  function updatePaletteSelection(count) {
    if (!paletteList) return;
    const children = Array.from(paletteList.children);
    for (let i = 0; i < count; i++) {
      const child = children[i];
      if (i === paletteSelectedIndex) {
        applyStyles(child, STYLES.paletteItemSelected);
        child.scrollIntoView({ block: 'nearest' });
      } else {
        // Reset to base style
        applyStyles(child, STYLES.paletteItem);
      }
    }
  }

  /**
   * Handle keyboard navigation in palette.
   * @param {KeyboardEvent} ev
   */
  function handlePaletteKeydown(ev) {
    if (!paletteVisible) return;
    // The variable form handles its own Enter/Escape; don't treat them as list keys.
    if (paletteVariablePrompt) return;
    // Rendered rows (not just matches) — the list may hold an empty-state row.
    const count = paletteList ? paletteList.children.length : 0;

    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        paletteSelectedIndex = Math.min(paletteSelectedIndex + 1, count - 1);
        updatePaletteSelection(count);
        break;
      case 'ArrowUp':
        ev.preventDefault();
        paletteSelectedIndex = Math.max(paletteSelectedIndex - 1, 0);
        updatePaletteSelection(count);
        break;
      case 'Enter':
        ev.preventDefault();
        insertFromPalette();
        break;
      case 'Escape':
        ev.preventDefault();
        closePalette();
        // Restore focus to target
        if (paletteTarget && typeof paletteTarget.focus === 'function') {
          paletteTarget.focus({ preventScroll: true });
        }
        break;
      case 'Tab':
        // Allow tab to close palette and move focus naturally
        closePalette();
        break;
      default:
        // Let search input handle other keys
        break;
    }
  }

  /**
   * Insert the selected prompt from palette into target.
   */
  function insertFromPalette() {
    if (!paletteList || !paletteTarget || paletteSelectedIndex < 0) return;
    const children = Array.from(paletteList.children);
    if (paletteSelectedIndex >= children.length) return;

    // Find the actual selected prompt from the filtered list
    const query = paletteSearch.value.trim().toLowerCase();
    const scored = [];
    for (const item of paletteItems) {
      const key = `${String(item.title ?? '')} ${String(item.text ?? '')}`;
      const subScore = subsequenceScoreInline(key, query);
      if (subScore !== null) {
        let recencyScore = 0;
        const ts = item.lastUsedAt || item.createdAt;
        if (typeof ts === 'number' && ts > 0) {
          const ageMs = Date.now() - ts;
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          recencyScore = Math.max(0, 0.2 * (1 - ageMs / thirtyDaysMs));
        }
        scored.push({ item, score: subScore + recencyScore });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const topItems = scored.slice(0, 8);

    if (paletteSelectedIndex >= topItems.length) return;
    const selected = topItems[paletteSelectedIndex].item;
    const isShot = selected.kind === 'shot';

    // Shots insert directly — no variable form in the in-page palette
    // (variable fill-in for shot prompts lives in the popup reader).
    if (isShot) {
      const text = String(selected.prompt ?? '');
      const result = insertInto(paletteTarget, text, 'insert');
      if (result.success) {
        showToast({ message: tr('pageInserted', 'Inserted'), icon: '✓' });
      } else {
        showToast({ message: result.error || tr('insertFailedDefault', 'Insert failed'), isError: true });
      }
      closePalette();
      if (paletteTarget && typeof paletteTarget.focus === 'function') {
        paletteTarget.focus({ preventScroll: true });
      }
      return;
    }

    // Check for variables (prompts only)
    const specs = varParse(String(selected.text ?? ''));
    if (specs.length > 0) {
      void showVariableForm(selected, specs);
      return;
    }

    // Direct insert
    const text = String(selected.text ?? '');
    const result = insertInto(paletteTarget, text, 'insert');
    if (result.success) {
      showToast({ message: tr('pageInserted', 'Inserted'), icon: '✓' });
      // Update lastUsedAt
      updatePromptLastUsed(selected.id);
    } else {
      showToast({ message: result.error || tr('insertFailedDefault', 'Insert failed'), isError: true });
    }
    closePalette();
    if (paletteTarget && typeof paletteTarget.focus === 'function') {
      paletteTarget.focus({ preventScroll: true });
    }
  }

  /**
   * Inline variable extraction (copied from src/lib/variables.js for non-drift).
   * @param {string} text
   * @returns {string[]}
   */
  function extractVariablesInline(text) {
    return varParse(text).map((spec) => spec.name);
  }

  /**
   * Show the variable fill-in form for the selected prompt (G6): choices as a
   * select, ranges as a number with a 🎲, defaults and remembered values
   * prefilled.
   * @param {any} prompt
   * @param {any[]} specs parsed variables (varParse)
   */
  async function showVariableForm(prompt, specs) {
    paletteVariablePrompt = prompt;
    paletteVariableSpecs = specs;
    paletteVariableInputs = {};
    paletteVariableMemory = {};
    try {
      const data = await pageStore().get(['variableMemory']);
      paletteVariableMemory = data && data.variableMemory ? data.variableMemory : {};
    } catch {
      // memory is a convenience; the form works without it
    }
    if (paletteVariablePrompt !== prompt) return; // palette closed meanwhile

    // Clear list and show form
    while (paletteList.firstChild) paletteList.removeChild(paletteList.firstChild);

    const form = elInShadow('div');
    applyStyles(form, STYLES.paletteVarForm);

    /** @param {KeyboardEvent} ev */
    const onKey = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        confirmVariableInsert();
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        filterPalette(); // back to list
      }
    };

    for (const spec of specs) {
      const label = elInShadow('div');
      label.textContent =
        spec.kind === 'range'
          ? `${humanizeVarInline(spec.name)} (${spec.min}–${spec.max})`
          : humanizeVarInline(spec.name);
      applyStyles(label, STYLES.paletteVarLabel);
      form.appendChild(label);

      const prefill = varRecall(paletteVariableMemory, spec);
      /** @type {any} */ let control;
      if (spec.kind === 'choice') {
        control = elInShadow('select');
        for (const option of spec.options) {
          const opt = elInShadow('option');
          opt.value = option;
          opt.textContent = option;
          control.appendChild(opt);
        }
        control.value = prefill || spec.options[0];
        applyStyles(control, STYLES.paletteVarInput);
        control.addEventListener('keydown', onKey);
        form.appendChild(control);
      } else if (spec.kind === 'range') {
        const row = elInShadow('div');
        applyStyles(row, { display: 'flex', gap: '6px' });
        control = elInShadow('input');
        control.type = 'number';
        control.min = String(spec.min);
        control.max = String(spec.max);
        control.step = '1';
        control.value = prefill;
        control.placeholder = `${spec.min}–${spec.max}`;
        applyStyles(control, STYLES.paletteVarInput);
        control.addEventListener('keydown', onKey);
        const dice = elInShadow('button');
        dice.type = 'button';
        dice.textContent = '🎲';
        dice.title = tr('random', 'Random');
        dice.setAttribute('aria-label', tr('randomNamed', 'Random $1', humanizeVarInline(spec.name)));
        applyStyles(dice, STYLES.modalSecondary);
        dice.style.padding = '3px 9px';
        const input = control;
        dice.addEventListener('click', () => {
          input.value = String(varRandom(spec));
          input.focus();
        });
        row.appendChild(control);
        row.appendChild(dice);
        form.appendChild(row);
      } else {
        control = elInShadow('input');
        control.type = 'text';
        control.value = prefill;
        control.placeholder = humanizeVarInline(spec.name);
        applyStyles(control, STYLES.paletteVarInput);
        control.addEventListener('keydown', onKey);
        form.appendChild(control);
      }
      paletteVariableInputs[spec.name] = control;
    }

    const confirmBtn = elInShadow('button');
    confirmBtn.textContent = tr('insert', 'Insert');
    applyStyles(confirmBtn, STYLES.modalPrimary);
    confirmBtn.style.width = '100%';
    confirmBtn.style.marginTop = '4px';
    confirmBtn.addEventListener('click', confirmVariableInsert);
    form.appendChild(confirmBtn);

    paletteList.appendChild(form);

    // Focus the first field that still needs a value (else the first field).
    const fields = Object.values(paletteVariableInputs);
    const target = fields.find((f) => String(f.value).trim() === '') || fields[0];
    if (target) target.focus();
  }

  /**
   * Inline humanizeVar (copied from src/lib/variables.js for non-drift).
   * @param {string} name
   * @returns {string}
   */
  function humanizeVarInline(name) {
    if (typeof name !== 'string' || name.length === 0) return '';
    const words = name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[\s_]+/)
      .filter(Boolean);
    return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * Confirm variable insert: resolve variables and insert.
   */
  function confirmVariableInsert() {
    if (!paletteVariablePrompt || !paletteVariableInputs || !paletteTarget) return;
    const values = {};
    for (const spec of paletteVariableSpecs || []) {
      const input = paletteVariableInputs[spec.name];
      if (!input) continue;
      // SPEC §1 + G6: every value is required and must fit its kind.
      const problem = varCheck(spec, input.value);
      if (problem) {
        input.focus();
        showToast({ message: `${humanizeVarInline(spec.name)}: ${trVarProblem(problem)}`, isError: true });
        return;
      }
      values[spec.name] = String(input.value).trim();
    }
    rememberVariableValues(values);
    const resolved = resolveVariablesInline(String(paletteVariablePrompt.text ?? ''), values);
    const result = insertInto(paletteTarget, resolved, 'insert');
    if (result.success) {
      showToast({ message: tr('pageInserted', 'Inserted'), icon: '✓' });
      updatePromptLastUsed(paletteVariablePrompt.id);
    } else {
      showToast({ message: result.error || tr('insertFailedDefault', 'Insert failed'), isError: true });
    }
    closePalette();
    if (paletteTarget && typeof paletteTarget.focus === 'function') {
      paletteTarget.focus({ preventScroll: true });
    }
  }

  /**
   * G6: remember the values just used (best effort, LRU in storage).
   * @param {Record<string, string>} values
   */
  function rememberVariableValues(values) {
    const store = pageStore();
    if (!store) return;
    void store
      .get(['variableMemory'])
      .then((data) => store.set({ variableMemory: varRemember(data && data.variableMemory, values, Date.now()) }))
      .catch(() => {});
  }

  /**
   * Inline variable resolution (copied from src/lib/variables.js for non-drift).
   * @param {string} text
   * @param {Record<string, unknown>} values
   * @returns {string}
   */
  function resolveVariablesInline(text, values) {
    if (typeof text !== 'string') return text;
    if (values === null || typeof values !== 'object') return text;
    return varResolve(text, values);
  }

  /**
   * Update prompt's lastUsedAt in storage.
   * @param {string} id
   */
  async function updatePromptLastUsed(id) {
    const store = pageStore();
    if (!store) return;
    try {
      const data = await store.get(['prompts']);
      const list = storedPromptList(data?.prompts);
      for (const p of list) {
        if (p.id === id) {
          p.lastUsedAt = Date.now();
          p.useCount = (p.useCount || 0) + 1;
          break;
        }
      }
      await store.set({ prompts: list });
      prompts = list; // update local cache
    } catch {
      // non-fatal
    }
  }

  /* ------------------------------------------------------------------ */
  /* Message handlers (Δ7) — every handler ALWAYS responds               */
  /* ------------------------------------------------------------------ */

  /**
   * @param {unknown} message
   * @param {(response: unknown) => void} respond
   * @returns {void}
   */
  function handleMessage(message, respond) {
    /** @type {(response: unknown) => void} */
    const respondSafe = (response) => {
      try {
        respond(response);
      } catch {
        // channel already closed — nothing to do
      }
    };
    try {
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        respondSafe({ success: false, error: 'unknown type' });
        return;
      }
      switch (message.type) {
        case 'PROMPTY_INSERT': {
          const text = typeof message.text === 'string' ? message.text : '';
          const mode = message.mode === 'append' ? 'append' : 'insert';
          const target = resolveInsertTarget();
          if (!target) {
            respondSafe({ success: false, error: tr('pageNoTarget', 'No editable target found') });
            return;
          }
          respondSafe(insertInto(target, text, mode));
          return;
        }
        case 'PROMPTY_SAVE_SELECTION': {
          const selection = window.getSelection ? window.getSelection() : null;
          const text = selection ? String(selection) : '';
          if (text.trim() === '') {
            respondSafe({ success: false, error: tr('pageNoSelection', 'No selection') });
            return;
          }
          respondSafe({
            success: true,
            text,
            title: truncatedTitle(document.title ?? '', 80) || truncatedTitle(text, 80),
            origin: pageOrigin,
          });
          return;
        }
        case 'SHOW_TOAST': {
          showToast(message);
          respondSafe({ success: true });
          return;
        }
        case 'PROMPTY_TOGGLE_WIDGET': {
          sessionWidgetHidden = !sessionWidgetHidden;
          applyWidgetVisibility();
          respondSafe({ success: true });
          return;
        }
        default:
          respondSafe({ success: false, error: 'unknown type' });
          return;
      }
    } catch (error) {
      respondSafe({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Register the runtime message listener (Chromium-style: keep the channel
   * open and always call sendResponse; Firefox honors the same 3-arg form).
   */
  function registerMessageRoute() {
    messageListener = (message, _sender, sendResponse) => {
      handleMessage(message, sendResponse ?? (() => {}));
      return true;
    };
    api.runtime.onMessage.addListener(messageListener);
  }

  /* ------------------------------------------------------------------ */
  /* Pill actions                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * ⌕: ask the background to open the popup (OPEN_POPUP per SPEC Δ6).
   * Content scripts cannot open popups themselves.
   */
  function openLibrary() {
    try {
      const sent = api.runtime.sendMessage({ type: 'OPEN_POPUP' });
      if (sent && typeof sent.catch === 'function') sent.catch(() => {});
    } catch {
      // no receiver — background fallback toast is its responsibility (Δ6)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Float widget (Δ3) — draggable bubble + mini-library panel           */
  /* ------------------------------------------------------------------ */

  /**
   * Position the bubble (clamped to viewport).
   * @param {number} x
   * @param {number} y
   */
  function placeWidgetBubble(x, y) {
    if (!widgetBubble) return;
    const nx = clampNumber(x, 4, Math.max(4, window.innerWidth - WIDGET_SIZE - 4));
    const ny = clampNumber(y, 4, Math.max(4, window.innerHeight - WIDGET_SIZE - 4));
    widgetBubble.style.left = `${nx}px`;
    widgetBubble.style.top = `${ny}px`;
  }

  /**
   * Debounced per-origin position persistence — storage key
   * `widgetPositions:{origin}`.
   */
  function persistWidgetPosition() {
    window.clearTimeout(savePosTimer);
    savePosTimer = window.setTimeout(() => {
      const store = pageStore();
      if (!store || !widgetBubble) return;
      try {
        void store.set({
          [`widgetPositions:${pageOrigin}`]: {
            x: parseInt(widgetBubble.style.left, 10) || 0,
            y: parseInt(widgetBubble.style.top, 10) || 0,
          },
        });
      } catch {
        // non-fatal
      }
    }, 300);
  }

  /**
   * Drag the bubble via pointer events; small movement = click → expand.
   */
  function wireWidgetDrag() {
    buttonDragListeners(widgetBubble, () => toggleWidgetPanel());
  }

  /**
   * Shared pointer-drag wiring for a floating node.
   * @param {any} node
   * @param {() => void} onTap
   */
  function buttonDragListeners(node, onTap) {
    /** @type {number} */ let startX = 0;
    /** @type {number} */ let startY = 0;
    /** @type {number} */ let originX = 0;
    /** @type {number} */ let originY = 0;
    /** @type {boolean} */ let dragging = false;
    /** @type {boolean} */ let pressed = false;
    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      pressed = true;
      dragging = false;
      startX = ev.clientX;
      startY = ev.clientY;
      originX = parseInt(node.style.left, 10) || 0;
      originY = parseInt(node.style.top, 10) || 0;
      try {
        node.setPointerCapture(ev.pointerId);
      } catch {
        // pointer capture can fail on detached nodes
      }
    });
    node.addEventListener('pointermove', (ev) => {
      // Hover fires pointermove too; only a held button drags (otherwise the
      // bubble jumped away from the cursor and clicks never registered as taps).
      if (!pressed) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      dragging = true;
      placeWidgetBubble(originX + dx, originY + dy);
    });
    node.addEventListener('pointerup', (ev) => {
      try {
        node.releasePointerCapture(ev.pointerId);
      } catch {
        // already released
      }
      if (!pressed) return;
      pressed = false;
      if (!dragging) onTap();
      else persistWidgetPosition();
      dragging = false;
    });
    node.addEventListener('pointercancel', () => {
      if (dragging) persistWidgetPosition();
      pressed = false;
      dragging = false;
    });
  }

  /**
   * Toggle the mini-library panel (search + list).
   */
  function toggleWidgetPanel() {
    if (!widgetPanel) return;
    widgetExpanded = !widgetExpanded;
    widgetPanel.hidden = !widgetExpanded;
    if (widgetExpanded) {
      positionWidgetPanel();
      void loadPrompts().then(() => renderList());
      widgetSearchInput.focus();
    }
  }

  /**
   * Anchor the panel next to the bubble, clamped to the viewport.
   */
  function positionWidgetPanel() {
    if (!widgetPanel || !widgetBubble) return;
    const bx = parseInt(widgetBubble.style.left, 10) || 0;
    const by = parseInt(widgetBubble.style.top, 10) || 0;
    const panelWidth = widgetPanel.offsetWidth || 320;
    const panelHeight = widgetPanel.offsetHeight || 340;
    // Open on the side with room. The default bubble sits at the right edge;
    // clamping a right-side panel into the viewport used to slide it over the
    // bubble, so the next click (to close or drag) hit the panel instead.
    const rightX = bx + WIDGET_SIZE + 8;
    const leftX = bx - panelWidth - 8;
    const fitsRight = rightX + panelWidth <= window.innerWidth - 8;
    const x = clampNumber(fitsRight || leftX < 8 ? rightX : leftX, 8, Math.max(8, window.innerWidth - panelWidth - 8));
    let y = by;
    if (y + panelHeight > window.innerHeight - 8) y = Math.max(8, window.innerHeight - panelHeight - 8);
    widgetPanel.style.left = `${x}px`;
    widgetPanel.style.top = `${y}px`;
  }

  /**
   * Read the live prompts list from storage.
   */
  async function loadPrompts() {
    const store = pageStore();
    if (!store) return;
    try {
      const data = await store.get(['prompts']);
      prompts = storedPromptList(data?.prompts);
    } catch {
      // keep last known list
    }
  }

  /**
   * Render the mini-library list (textContent only, no innerHTML ever).
   */
  function renderList() {
    if (!widgetList) return;
    while (widgetList.firstChild) widgetList.removeChild(widgetList.firstChild);
    const query = widgetSearchInput ? String(widgetSearchInput.value ?? '') : '';
    const sorted = sortPrompts(prompts, settings.sortBy);
    let shown = 0;
    for (const prompt of sorted) {
      if (!promptMatchesSearch(prompt, query)) continue;
      shown += 1;
      widgetList.appendChild(widgetRow(prompt));
      if (shown >= 50) break; // guard extreme libraries; full list in popup
    }
    if (shown === 0) {
      const empty = elInShadow('div');
      empty.textContent = vaultLocked ? VAULT_LOCKED_MESSAGE : query.trim() === '' ? tr('pageNoPromptsYet', 'No prompts yet') : tr('pageNoPromptsMatch', 'No prompts match');
      applyStyles(empty, STYLES.emptyList);
      widgetList.appendChild(empty);
    }
  }

  /**
   * One prompt row with Insert / Append / Copy actions.
   * @param {any} prompt
   * @returns {any}
   */
  function widgetRow(prompt) {
    const row = elInShadow('div');
    applyStyles(row, STYLES.row);
    const title = elInShadow('div');
    title.textContent = String(prompt.title ?? '') || '(untitled)';
    applyStyles(title, STYLES.rowTitle);
    const snippet = elInShadow('div');
    snippet.textContent = String(prompt.text ?? '');
    applyStyles(snippet, STYLES.rowText);
    const actions = elInShadow('div');
    applyStyles(actions, STYLES.rowActions);
    rowAction(actions, tr('insert', 'Insert'), tr('pageInsertHint', 'Insert (replace field)'), () => insertFromWidget(prompt.text, 'insert'));
    rowAction(actions, tr('append', 'Append'), tr('pageAppendHint', 'Append (join with ", ")'), () => insertFromWidget(prompt.text, 'append'));
    rowAction(actions, tr('copy', 'Copy'), tr('pageCopyHint', 'Copy to clipboard'), () => copyFromWidget(prompt.text));
    row.appendChild(title);
    row.appendChild(snippet);
    row.appendChild(actions);
    return row;
  }

  /**
   * Row action button factory.
   * @param {any} parent
   * @param {string} label
   * @param {string} title
   * @param {() => void} onClick
   */
  function rowAction(parent, label, title, onClick) {
    const button = elInShadow('button');
    button.textContent = label;
    button.title = title;
    applyStyles(button, STYLES.rowButton);
    button.addEventListener('click', onClick);
    parent.appendChild(button);
  }

  /**
   * Insert/append a widget row's prompt text into the page's focused (or
   * assist-detected) editable — same machinery as PROMPTY_INSERT.
   * @param {unknown} text
   * @param {string} mode
   */
  function insertFromWidget(text, mode) {
    const value = typeof text === 'string' ? text : '';
    const target = resolveInsertTarget();
    if (!target) {
      showToast({ message: tr('pageNoTarget', 'No editable target found'), isError: true });
      return;
    }
    const result = insertInto(target, value, mode === 'append' ? 'append' : 'insert');
    showToast(
      result.success
        ? { message: mode === 'append' ? tr('pageAppended', 'Appended to field') : tr('pageInsertedInto', 'Inserted into field'), icon: '✓' }
        : { message: result.error || tr('insertFailedDefault', 'Insert failed'), isError: true },
    );
  }

  /**
   * Copy with user-gesture-gated clipboard + execCommand fallback (Δ5a).
   * @param {unknown} text
   */
  async function copyFromWidget(text) {
    const value = typeof text === 'string' ? text : '';
    if (value === '') return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        showToast({ message: tr('pageCopied', 'Copied to clipboard'), icon: '✓' });
        return;
      }
    } catch {
      // fall through to execCommand path
    }
    const scratch = elInShadow('textarea');
    scratch.value = value;
    scratch.setAttribute('readonly', 'true');
    applyStyles(scratch, {
      position: 'absolute',
      left: '-9999px',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
    });
    if (host) {
      host.appendChild(scratch);
      scratch.select();
      let ok;
      try {
        ok = document.execCommand ? document.execCommand('copy') : false;
      } catch {
        ok = false;
      }
      scratch.remove();
      showToast(ok ? { message: tr('pageCopied', 'Copied to clipboard'), icon: '✓' } : { message: tr('pageCopyFailed', 'Copy failed'), isError: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Toast (SHOW_TOAST passthrough target; failure toasts carry ✗)       */
  /* ------------------------------------------------------------------ */

  /**
   * Show a shadow-root toast bottom-right (SPEC §1: page toast).
   * @param {{ message?: unknown, icon?: unknown, isError?: unknown }} payload
   */
  function showToast(payload) {
    if (!toastEl) return;
    const message = typeof payload.message === 'string' ? payload.message : '';
    const icon = payload.isError ? '✗' : typeof payload.icon === 'string' && payload.icon !== '' ? payload.icon : '✓';
    toastEl.textContent = `${icon} ${message}`;
    toastEl.style.borderLeftColor = payload.isError ? 'var(--pf-danger)' : 'var(--pf-accent)';
    toastEl.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
      toastTimer = 0;
    }, 2600);
  }

  /* ------------------------------------------------------------------ */
  /* Global listeners + SPA tolerance (Δ2: MutationObserver/poll hybrid) */
  /* ------------------------------------------------------------------ */

  /**
   * Register document/window listeners for focus routing, Esc, scroll,
   * resize, storage sync, polling + mutation observation, and pagehide
   * cleanup.
   */
  function registerGlobalListeners() {
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onDocScroll, { capture: true, passive: true });
    window.addEventListener('resize', onDocScroll, { passive: true });

    if (api.storage && api.storage.onChanged && typeof api.storage.onChanged.addListener === 'function') {
      storageChangedListener = (_changes, area) => {
        if (area && area !== 'local') return;
        void refreshFromStorage();
      };
      api.storage.onChanged.addListener(storageChangedListener);
    }

    /**
     * SPA poll: URL changes → re-evaluate origin/visibility; detached pill
     * anchor → hide; stale widget position → clamp. Cheap, no per-DOM hook.
     */
    pollTimer = window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        pageOrigin = getOrigin(lastUrl);
        applyWidgetVisibility();
      }
      if (pillVisible && pillAnchor && !pillAnchor.isConnected) hidePill();
      if (widgetBubble && !widgetBubble.hidden) positionWidgetPanel();
    }, POLL_INTERVAL_MS);

    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => {
        // SPA route swaps may detach the anchor element mid-interaction
        if (pillVisible && pillAnchor && !pillAnchor.isConnected) hidePill();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    registerMessageRoute();
    window.addEventListener('pagehide', cleanup);
  }

  /**
   * Refresh cached state from storage (settings + prompts), then re-apply.
   * @returns {Promise<void>}
   */
  async function refreshFromStorage() {
    const store = pageStore();
    if (!store) return;
    try {
      const data = await store.get(['settings', 'prompts']);
      settings = normalizeSettings(data?.settings);
      prompts = storedPromptList(data?.prompts);
      applyWidgetVisibility();
      if (widgetExpanded) renderList();
    } catch {
      // storage temporarily unavailable — keep stale state
    }
  }

  /**
   * focusin: route editable focus to the pill; our own shadow UI is ignored
   * (composedPath includes host).
   * @param {any} ev
   */
  function onFocusIn(ev) {
    if (!host || host === null) return;
    const target = ev.target;
    if (isInsideOurHost(target)) return;
    if (isPageEditableElement(target)) showPill(target);
    else schedulePillHide();
  }

  /**
   * focusout: schedule the debounced hide; cancelled by any new
   * focusin/esc-key/user interaction inside our UI.
   */
  function onFocusOut() {
    if (pillVisible) schedulePillHide();
  }

  /**
   * Esc collapses the pill (Δ2) / closes modal / closes menu.
   * Trigger-char opens quick-insert palette (G1).
   * @param {KeyboardEvent} ev
   */
  function onKeyDown(ev) {
    // If palette is visible, let it handle keys first
    if (paletteVisible) {
      handlePaletteKeydown(ev);
      return;
    }

    // Escape handling (existing)
    if (ev.key === 'Escape') {
      if (saveModal && !saveModal.hidden) {
        closeSaveModal();
        ev.stopPropagation();
        return;
      }
      if (pillMenu && !pillMenu.hidden) {
        pillMenu.hidden = true;
        return;
      }
      if (pillVisible) {
        hidePill();
        ev.stopPropagation();
      }
      return;
    }

    // Trigger-char detection (G1)
    if (settings.quickTriggerEnabled && ev.key === settings.quickTrigger && ev.key.length === 1) {
      const target = ev.target;
      // Only trigger on page editables, not our own UI
      if (isPageEditableElement(target) && !isInsideOurHost(target)) {
        // Check word boundary: cursor at start, or preceded by space/linebreak
        const tag = elementTag(target);
        let atBoundary = false;
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
          const pos = target.selectionStart;
          if (pos === 0) {
            atBoundary = true;
          } else {
            const charBefore = target.value[pos - 1];
            atBoundary = /\s/.test(charBefore);
          }
        } else if (target.isContentEditable === true) {
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            // Check if at start of text node or after whitespace
            if (range.startOffset === 0) {
              atBoundary = true;
            } else if (range.startContainer.nodeType === Node.TEXT_NODE) {
              const text = range.startContainer.textContent;
              if (text && range.startOffset > 0) {
                const charBefore = text[range.startOffset - 1];
                atBoundary = /\s/.test(charBefore);
              } else {
                atBoundary = true;
              }
            } else {
              atBoundary = true;
            }
          } else {
            atBoundary = true;
          }
        }
        if (atBoundary) {
          ev.preventDefault();
          ev.stopPropagation();
          openPalette(target);
        }
      }
    }
  }

  /**
   * Scroll/resize: re-anchor the pill to the (possibly moved) element. The
   * recalc is cheap (getBoundingClientRect + two style writes), so rAF-batch.
   */
  function onDocScroll() {
    if (!pillVisible) return;
    window.clearTimeout(savePosTimer);
    savePosTimer = window.setTimeout(() => {
      void window.requestAnimationFrame(positionPill);
    }, 50);
  }

  /**
   * Full cleanup on pagehide (lists, observers, listeners, UI container).
   */
  function cleanup() {
    window.clearInterval(pollTimer);
    window.clearTimeout(hideTimer);
    window.clearTimeout(savePosTimer);
    window.clearTimeout(toastTimer);
    pollTimer = 0;
    hideTimer = 0;
    savePosTimer = 0;
    toastTimer = 0;
    if (observer) observer.disconnect();
    observer = null;
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onDocScroll, { capture: true });
    window.removeEventListener('resize', onDocScroll);
    window.removeEventListener('pagehide', cleanup);
    if (storageChangedListener && api.storage && api.storage.onChanged) {
      api.storage.onChanged.removeListener(storageChangedListener);
    }
    storageChangedListener = null;
    if (messageListener && api.runtime.onMessage) api.runtime.onMessage.removeListener(messageListener);
    messageListener = null;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    lastPageEditable = null;
    pillAnchor = null;
    pillVisible = false;
    widgetExpanded = false;
  }

  /* ------------------------------------------------------------------ *
   * boot                                                                *
   * ------------------------------------------------------------------ */

  start();
})();
