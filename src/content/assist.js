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

  const STYLES = {
    pill: {
      position: 'absolute',
      display: 'flex',
      gap: '2px',
      padding: '3px',
      background: 'rgba(17,17,24,0.96)',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: '10px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      pointerEvents: 'auto',
    },
    pillButton: {
      appearance: 'none',
      border: '0',
      background: 'transparent',
      color: '#e6e6f0',
      fontSize: '13px',
      lineHeight: '1',
      padding: '5px 7px',
      borderRadius: '7px',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    pillButtonHover: { background: 'rgba(139,92,246,0.35)' },
    menu: {
      position: 'absolute',
      background: 'rgba(17,17,24,0.98)',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: '8px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
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
      borderRadius: '50%',
      background: 'rgba(139,92,246,0.95)',
      color: '#fff',
      border: '2px solid rgba(255,255,255,0.25)',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '18px',
      fontWeight: '700',
      cursor: 'grab',
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'none',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    widgetPanel: {
      position: 'absolute',
      width: '320px',
      maxHeight: '340px',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(17,17,24,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      padding: '8px',
      gap: '6px',
      pointerEvents: 'auto',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    widgetSearch: {
      width: '100%',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '7px',
      color: '#f0f0f8',
      fontSize: '13px',
      padding: '6px 8px',
      outline: 'none',
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
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '8px',
    },
    rowTitle: {
      color: '#f2f2f8',
      fontSize: '13px',
      fontWeight: '600',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    rowText: {
      color: 'rgba(240,240,248,0.65)',
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    rowActions: { display: 'flex', gap: '4px' },
    rowButton: {
      appearance: 'none',
      border: '1px solid rgba(139,92,246,0.5)',
      background: 'rgba(139,92,246,0.2)',
      color: '#e8e0ff',
      fontSize: '11px',
      padding: '3px 8px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    menuButton: {
      appearance: 'none',
      border: '0',
      background: 'transparent',
      color: '#e6e6f0',
      fontSize: '12px',
      textAlign: 'left',
      padding: '6px 8px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      whiteSpace: 'nowrap',
    },
    emptyList: {
      color: 'rgba(240,240,248,0.55)',
      fontSize: '12px',
      padding: '8px 4px',
    },
    overlay: {
      position: 'absolute',
      inset: '0',
      width: '100vw',
      height: '100vh',
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
    },
    modal: {
      width: '320px',
      background: 'rgba(23,23,32,0.98)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '12px',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    modalLabel: { color: '#f0f0f8', fontSize: '13px', fontWeight: '600' },
    modalText: { color: 'rgba(240,240,248,0.6)', fontSize: '11px', maxHeight: '44px', overflow: 'hidden' },
    modalInput: {
      width: '100%',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '7px',
      color: '#f0f0f8',
      fontSize: '13px',
      padding: '7px 9px',
      outline: 'none',
    },
    modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '6px' },
    modalPrimary: {
      appearance: 'none',
      border: '0',
      background: '#8b5cf6',
      color: '#fff',
      fontSize: '13px',
      padding: '7px 14px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    modalSecondary: {
      appearance: 'none',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'transparent',
      color: '#e6e6f0',
      fontSize: '13px',
      padding: '7px 14px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    toast: {
      position: 'absolute',
      right: '16px',
      bottom: '16px',
      maxWidth: '340px',
      background: 'rgba(17,17,24,0.97)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '10px',
      padding: '10px 14px',
      color: '#f0f0f8',
      fontSize: '13px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
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
      background: 'rgba(17,17,24,0.98)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      padding: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      pointerEvents: 'auto',
      minWidth: '280px',
      maxWidth: '420px',
      maxHeight: '360px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      zIndex: '2147483647',
    },
    paletteSearch: {
      width: '100%',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '7px',
      color: '#f0f0f8',
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
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '7px',
      cursor: 'pointer',
      border: '1px solid transparent',
      transition: 'background 0.08s, border-color 0.08s',
    },
    paletteItemSelected: {
      background: 'rgba(139,92,246,0.25)',
      borderColor: 'rgba(139,92,246,0.5)',
    },
    paletteItemTitle: {
      color: '#f2f2f8',
      fontSize: '13px',
      fontWeight: '600',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    paletteItemText: {
      color: 'rgba(240,240,248,0.6)',
      fontSize: '11px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    paletteItemHighlight: {
      background: 'rgba(139,92,246,0.35)',
      borderRadius: '2px',
      padding: '0 1px',
    },
    paletteVarForm: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '6px 2px',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      marginTop: '2px',
    },
    paletteVarLabel: {
      color: 'rgba(240,240,248,0.7)',
      fontSize: '11px',
      fontWeight: '500',
    },
    paletteVarInput: {
      width: '100%',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '6px',
      color: '#f0f0f8',
      fontSize: '12px',
      padding: '5px 7px',
      outline: 'none',
      boxSizing: 'border-box',
    },
    paletteHint: {
      color: 'rgba(240,240,248,0.45)',
      fontSize: '11px',
      textAlign: 'center',
      padding: '2px 0',
    },
  };

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Build shadow host + all UI nodes once.
   */
  function buildUi() {
    host = document.createElement('div');
    host.id = HOST_ID;
    applyStyles(host, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      all: 'initial',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);

    // Pill
    pill = elInShadow('div');
    applyStyles(pill, STYLES.pill);
    pillButton(pill, '⌕', 'Open Prompty library', () => openLibrary());
    pillButton(pill, '⤒', 'Save focused text as prompt', () => startSaveFlow());
    pillButton(pill, '⋯', 'More options', () => togglePillMenu());
    pill.hidden = true;
    shadow.appendChild(pill);

    // Pill menu ("Disable on this site")
    pillMenu = elInShadow('div');
    applyStyles(pillMenu, STYLES.menu);
    const disableButton = elInShadow('button');
    disableButton.textContent = 'Disable Prompty on this site';
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
    widgetBubble.textContent = 'P';
    widgetBubble.setAttribute('role', 'button');
    widgetBubble.setAttribute('title', 'Prompty — drag to move, click to open');
    applyStyles(widgetBubble, STYLES.widgetBubble);
    widgetBubble.hidden = true;
    shadow.appendChild(widgetBubble);

    widgetPanel = elInShadow('div');
    applyStyles(widgetPanel, STYLES.widgetPanel);
    widgetSearchInput = elInShadow('input');
    widgetSearchInput.type = 'search';
    widgetSearchInput.placeholder = 'Search prompts…';
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
    label.textContent = 'Save as prompt';
    const textPreview = elInShadow('div');
    saveTitleInput = elInShadow('input');
    saveTitleInput.type = 'text';
    saveTitleInput.placeholder = 'Prompt title';
    const actions = elInShadow('div');
    const cancelButton = elInShadow('button');
    cancelButton.textContent = 'Cancel';
    const saveButton = elInShadow('button');
    saveButton.textContent = 'Save';
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
    paletteSearch.placeholder = 'Search prompts…';
    applyStyles(paletteSearch, STYLES.paletteSearch);
    paletteSearch.addEventListener('input', () => filterPalette());
    paletteSearch.addEventListener('keydown', (ev) => handlePaletteKeydown(ev));
    palette.appendChild(paletteSearch);

    paletteList = elInShadow('div');
    applyStyles(paletteList, STYLES.paletteList);
    palette.appendChild(paletteList);

    const paletteHint = elInShadow('div');
    paletteHint.textContent = '↑↓ navigate · Enter insert · Esc close';
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

  /**
   * Read settings + position + prompts from storage and apply.
   */
  async function bootstrapState() {
    const store = api.storage && api.storage.local;
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
    const store = api.storage && api.storage.local;
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
      showToast({ message: 'Focused field is empty', isError: true });
      return;
    }
    saveModalPendingText = text;
    hidePill();
    openSaveModal(truncatedTitle(text) || 'Untitled prompt', text);
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
    const store = api.storage && api.storage.local;
    const text = saveModalPendingText;
    const title = String(saveTitleInput.value || '').trim() || truncatedTitle(text, 40) || 'Untitled prompt';
    closeSaveModal();
    if (!store) {
      showToast({ message: 'Storage unavailable', isError: true });
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
      showToast({ message: 'Prompt saved', icon: '✓' });
    } catch {
      showToast({ message: 'Could not save prompt', isError: true });
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
    if (joined === '') return { success: false, error: 'Empty prompt text' };
    try {
      fireBubbled(el, 'keydown');
      setNativeValue(el, joined);
      fireBubbled(el, 'input');
      fireBubbled(el, 'keyup');
      fireBubbled(el, 'change');
    } catch {
      return { success: false, error: 'Insert rejected by page' };
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
    if (!match) return { success: false, error: 'No matching select option' };
    try {
      setNativeValue(el, match.value);
      fireBubbled(el, 'change');
    } catch {
      return { success: false, error: 'Insert rejected by page' };
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
      return { success: false, error: 'Insert rejected by page' };
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
    return { success: false, error: 'No editable target found' };
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
      mirror.textContent = prefix + '\u200B'; // zero-width space at caret
      document.body.appendChild(mirror);
      const rect = mirror.getBoundingClientRect();
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      document.body.removeChild(mirror);
      const elRect = el.getBoundingClientRect();
      return {
        x: rect.left - mirror.getBoundingClientRect().left + elRect.left,
        y: rect.top - mirror.getBoundingClientRect().top + elRect.top,
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
      positionPalette();
      palette.hidden = false;
      paletteSearch.focus({ preventScroll: true });
      paletteSearch.value = '';
    });
  }

  /**
   * Load prompts from storage for the palette.
   */
  async function loadPromptsForPalette() {
    const store = api.storage && api.storage.local;
    if (!store) return;
    try {
      const data = await store.get(['prompts']);
      paletteItems = storedPromptList(data?.prompts);
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
   * @param {any} prompt
   * @param {string} key
   * @param {string} query
   * @param {boolean} selected
   * @returns {any}
   */
  function createPaletteItem(prompt, key, query, selected) {
    const item = elInShadow('div');
    applyStyles(item, STYLES.paletteItem);
    if (selected) applyStyles(item, STYLES.paletteItemSelected);

    const title = elInShadow('div');
    applyStyles(title, STYLES.paletteItemTitle);
    highlightText(title, String(prompt.title ?? '') || '(untitled)', query);
    item.appendChild(title);

    const snippet = elInShadow('div');
    applyStyles(snippet, STYLES.paletteItemText);
    highlightText(snippet, String(prompt.text ?? ''), query);
    item.appendChild(snippet);

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
    const selectedPrompt = topItems[paletteSelectedIndex].item;

    // Check for variables
    const variables = extractVariablesInline(String(selectedPrompt.text ?? ''));
    if (variables.length > 0) {
      showVariableForm(selectedPrompt, variables);
      return;
    }

    // Direct insert
    const text = String(selectedPrompt.text ?? '');
    const result = insertInto(paletteTarget, text, 'insert');
    if (result.success) {
      showToast({ message: 'Inserted', icon: '✓' });
      // Update lastUsedAt
      updatePromptLastUsed(selectedPrompt.id);
    } else {
      showToast({ message: result.error || 'Insert failed', isError: true });
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
    const VARIABLE_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    const out = [];
    if (typeof text !== 'string') return out;
    const seen = new Set();
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }

  /**
   * Show variable fill-in form for the selected prompt.
   * @param {any} prompt
   * @param {string[]} variables
   */
  function showVariableForm(prompt, variables) {
    paletteVariablePrompt = prompt;
    paletteVariableInputs = {};

    // Clear list and show form
    while (paletteList.firstChild) paletteList.removeChild(paletteList.firstChild);

    const form = elInShadow('div');
    applyStyles(form, STYLES.paletteVarForm);

    for (const varName of variables) {
      const label = elInShadow('div');
      label.textContent = humanizeVarInline(varName);
      applyStyles(label, STYLES.paletteVarLabel);
      form.appendChild(label);

      const input = elInShadow('input');
      input.type = 'text';
      input.placeholder = humanizeVarInline(varName);
      applyStyles(input, STYLES.paletteVarInput);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          confirmVariableInsert();
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          filterPalette(); // back to list
        }
      });
      form.appendChild(input);
      paletteVariableInputs[varName] = input;
    }

    const confirmBtn = elInShadow('button');
    confirmBtn.textContent = 'Insert';
    applyStyles(confirmBtn, STYLES.modalPrimary);
    confirmBtn.style.width = '100%';
    confirmBtn.style.marginTop = '4px';
    confirmBtn.addEventListener('click', confirmVariableInsert);
    form.appendChild(confirmBtn);

    paletteList.appendChild(form);

    // Focus first input
    const firstInput = form.querySelector('input');
    if (firstInput) firstInput.focus();
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
    for (const [name, input] of Object.entries(paletteVariableInputs)) {
      values[name] = input.value;
    }
    const resolved = resolveVariablesInline(String(paletteVariablePrompt.text ?? ''), values);
    const result = insertInto(paletteTarget, resolved, 'insert');
    if (result.success) {
      showToast({ message: 'Inserted', icon: '✓' });
      updatePromptLastUsed(paletteVariablePrompt.id);
    } else {
      showToast({ message: result.error || 'Insert failed', isError: true });
    }
    closePalette();
    if (paletteTarget && typeof paletteTarget.focus === 'function') {
      paletteTarget.focus({ preventScroll: true });
    }
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
    let out = text;
    for (const name of extractVariablesInline(text)) {
      if (Object.prototype.hasOwnProperty.call(values, name)) {
        out = out.replaceAll(`{${name}}`, () => String(values[name]));
      }
    }
    return out;
  }

  /**
   * Update prompt's lastUsedAt in storage.
   * @param {string} id
   */
  async function updatePromptLastUsed(id) {
    const store = api.storage && api.storage.local;
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
            respondSafe({ success: false, error: 'No editable target found' });
            return;
          }
          respondSafe(insertInto(target, text, mode));
          return;
        }
        case 'PROMPTY_SAVE_SELECTION': {
          const selection = window.getSelection ? window.getSelection() : null;
          const text = selection ? String(selection) : '';
          if (text.trim() === '') {
            respondSafe({ success: false, error: 'No selection' });
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
      const store = api.storage && api.storage.local;
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
    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
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
      if (!dragging) onTap();
      else persistWidgetPosition();
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
    const x = clampNumber(bx + WIDGET_SIZE + 8, 8, Math.max(8, window.innerWidth - panelWidth - 8));
    let y = by;
    if (y + panelHeight > window.innerHeight - 8) y = Math.max(8, window.innerHeight - panelHeight - 8);
    widgetPanel.style.left = `${x}px`;
    widgetPanel.style.top = `${y}px`;
  }

  /**
   * Read the live prompts list from storage.
   */
  async function loadPrompts() {
    const store = api.storage && api.storage.local;
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
      empty.textContent = query.trim() === '' ? 'No prompts yet' : 'No prompts match';
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
    rowAction(actions, 'Insert', 'Insert (replace field)', () => insertFromWidget(prompt.text, 'insert'));
    rowAction(actions, 'Append', 'Append (join with ", ")', () => insertFromWidget(prompt.text, 'append'));
    rowAction(actions, 'Copy', 'Copy to clipboard', () => copyFromWidget(prompt.text));
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
      showToast({ message: 'No editable target found', isError: true });
      return;
    }
    const result = insertInto(target, value, mode === 'append' ? 'append' : 'insert');
    showToast(
      result.success
        ? { message: mode === 'append' ? 'Appended to field' : 'Inserted into field', icon: '✓' }
        : { message: result.error || 'Insert failed', isError: true },
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
        showToast({ message: 'Copied to clipboard', icon: '✓' });
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
      let ok = false;
      try {
        ok = document.execCommand ? document.execCommand('copy') : false;
      } catch {
        ok = false;
      }
      scratch.remove();
      showToast(ok ? { message: 'Copied to clipboard', icon: '✓' } : { message: 'Copy failed', isError: true });
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
    toastSlotNumber += 1;
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
    const store = api.storage && api.storage.local;
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
    cssStateEl = null;
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
