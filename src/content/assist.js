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
   * @returns {{ showFloatingWidget: boolean, disabledSites: string[], sortBy: string, compactMode: boolean }}
   */
  function normalizeSettings(raw) {
    const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sortBy = record.sortBy;
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
    const data = await store.get(['settings', posKey, 'prompts']);
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
   * Confirm: append the prompt to storage.prompts (own whitelist-built
   * object; existing entries pass through untouched — no untrusted merge).
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
      list.push(buildPromptObject(title, text));
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
   * @param {KeyboardEvent} ev
   */
  function onKeyDown(ev) {
    if (ev.key !== 'Escape') return;
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
