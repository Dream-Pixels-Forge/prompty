/**
 * G2 — Keyboard-first command palette (pure layer).
 *
 * One ranked list mixes prompts, clipboard snippets and commands. Matching
 * reuses `src/lib/search.js` (subsequenceScore / extractMatches) — no second
 * matcher (ROADMAP G2 anti-drift rule). Zero DOM, zero extension API.
 */
import { extractMatches, subsequenceScore } from '../lib/search.js';
import { extractVariables } from '../lib/variables.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('../lib/storage.js').Snippet} Snippet
 * @typedef {import('../lib/storage.js').Settings} Settings
 */

/**
 * @typedef {'insert'|'append'|'copy'|'promote'|'run'} PaletteAction
 *
 * @typedef {object} PaletteCommand
 * @property {string} id
 * @property {string} label
 * @property {string} [hint]      Right-aligned hint (e.g. hotkey).
 * @property {string[]} [keywords] Extra searchable words.
 * @property {{ type: string, [key: string]: unknown }} effect What the UI should do.
 *
 * @typedef {object} PaletteItem
 * @property {'prompt'|'snippet'|'command'} kind
 * @property {string} id
 * @property {string} label
 * @property {string} detail       Secondary line (prompt preview / snippet origin / hint).
 * @property {number} score
 * @property {{start:number,end:number}[]} matches Ranges in `label` to highlight.
 * @property {PaletteAction[]} actions Actions this item supports, default first.
 * @property {Prompt} [prompt]
 * @property {Snippet} [snippet]
 * @property {PaletteCommand} [command]
 */

/** Kind weights: with equal match quality, prompts beat snippets beat commands. */
const KIND_WEIGHT = { prompt: 0.06, snippet: 0.02, command: 0 };
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * Build the command list for the current library state.
 * @param {{ categories?: Category[], settings?: Partial<Settings>, scopeCategoryId?: string|null }} [state]
 * @returns {PaletteCommand[]}
 */
export function buildCommands(state = {}) {
  const settings = state.settings ?? {};
  /** @type {PaletteCommand[]} */
  const commands = [];
  if (state.scopeCategoryId) {
    commands.push({
      id: 'cmd:scope-clear',
      label: 'Show all categories',
      keywords: ['clear', 'scope', 'filter', 'reset'],
      effect: { type: 'scope', categoryId: null },
    });
  }
  const categories = Array.isArray(state.categories) ? [...state.categories] : [];
  categories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const category of categories) {
    if (category.id === state.scopeCategoryId) continue;
    commands.push({
      id: `cmd:scope:${category.id}`,
      label: `Go to category: ${category.icon ? `${category.icon} ` : ''}${category.name}`,
      keywords: ['category', 'jump', 'filter'],
      effect: { type: 'scope', categoryId: category.id },
    });
  }
  commands.push(
    {
      id: 'cmd:compact',
      label: settings.compactMode ? 'Turn off compact mode' : 'Turn on compact mode',
      keywords: ['toggle', 'density', 'view', 'theme'],
      effect: { type: 'setting', key: 'compactMode', value: !settings.compactMode },
    },
    {
      id: 'cmd:widget',
      label:
        settings.showFloatingWidget === false
          ? 'Show floating widget on pages'
          : 'Hide floating widget on pages',
      keywords: ['toggle', 'bubble', 'widget'],
      effect: {
        type: 'setting',
        key: 'showFloatingWidget',
        value: settings.showFloatingWidget === false,
      },
    },
    {
      id: 'cmd:export',
      label: 'Export library as JSON',
      keywords: ['backup', 'download', 'save'],
      effect: { type: 'export' },
    },
  );
  return commands;
}

/** Score for a body-text hit: literal substring only (fuzzy over long text matches everything). */
const BODY_SCORE = 0.4;

/**
 * Best score of `query`: subsequence over the label (full weight) and short
 * secondary keys like tags/keywords (discounted), or a literal substring hit in
 * long body text (fixed low score). Null when nothing matches.
 * @param {string} label
 * @param {string[]} secondary
 * @param {string} query
 * @param {string} [body]
 * @returns {number|null}
 */
function bestScore(label, secondary, query, body = '') {
  let best = subsequenceScore(label, query);
  for (const key of secondary) {
    const s = subsequenceScore(key, query);
    if (s !== null && (best === null || s * 0.85 > best)) best = s * 0.85;
  }
  if (best === null && body && body.toLowerCase().includes(query.toLowerCase())) {
    best = BODY_SCORE;
  }
  return best;
}

/**
 * Recency/usage boost in [0, 0.25]: recent use (30-day linear decay) + log usage.
 * @param {Prompt} p
 * @param {number} now
 * @returns {number}
 */
function usageBoost(p, now) {
  const last = typeof p.lastUsedAt === 'number' ? p.lastUsedAt : 0;
  const recency = last > 0 ? Math.max(0, 0.15 * (1 - (now - last) / THIRTY_DAYS)) : 0;
  const uses = Math.min(0.1, Math.log10(1 + Math.max(0, p.useCount ?? 0)) * 0.05);
  return recency + uses;
}

/**
 * Single-line preview of a long text.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function preview(text, max = 90) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Rank prompts, snippets and commands for a query.
 *
 * Empty query: prompts by recent use, then snippets (newest first), then
 * commands — so opening the palette shows your most likely prompt on top.
 * Non-empty query: one list sorted by match score + usage boost + kind weight.
 *
 * @param {{ prompts?: Prompt[], snippets?: Snippet[], commands?: PaletteCommand[] }} sources
 * @param {string} query
 * @param {{ now?: number, scopeCategoryId?: string|null, maxResults?: number }} [options]
 * @returns {PaletteItem[]}
 */
export function rankPalette(sources, query, options = {}) {
  const now = options.now ?? Date.now();
  const maxResults = options.maxResults ?? 50;
  const q = String(query ?? '').trim();
  const scope = options.scopeCategoryId ?? null;
  const prompts = (Array.isArray(sources.prompts) ? sources.prompts : []).filter(
    (p) => !scope || p.categoryId === scope,
  );
  // Snippets have no category: hide them while scoped.
  const snippets = scope ? [] : Array.isArray(sources.snippets) ? sources.snippets : [];
  const commands = Array.isArray(sources.commands) ? sources.commands : [];

  /** @type {PaletteItem[]} */
  const items = [];

  prompts.forEach((p) => {
    const score = q === '' ? 1 : bestScore(p.title, p.tags ?? [], q, p.text ?? '');
    if (score === null) return;
    items.push({
      kind: 'prompt',
      id: p.id,
      label: p.title,
      detail: preview(p.text),
      score: score + usageBoost(p, now) + KIND_WEIGHT.prompt,
      matches: extractMatches(p.title, q),
      actions: ['insert', 'append', 'copy'],
      prompt: p,
    });
  });

  // Snippets are stored oldest→newest; newest should win ties.
  const snippetCount = snippets.length;
  snippets.forEach((s, index) => {
    const label = preview(s.text, 70);
    const score = q === '' ? 0.5 : bestScore(label, [], q, s.text);
    if (score === null) return;
    items.push({
      kind: 'snippet',
      id: s.id,
      label,
      detail: s.sourceOrigin ? `Snippet · ${s.sourceOrigin}` : 'Snippet',
      score: score + KIND_WEIGHT.snippet + (0.01 * (index + 1)) / Math.max(1, snippetCount),
      matches: extractMatches(label, q),
      actions: ['insert', 'append', 'copy', 'promote'],
      snippet: s,
    });
  });

  commands.forEach((c) => {
    const score = q === '' ? 0 : bestScore(c.label, c.keywords ?? [], q);
    if (score === null) return;
    items.push({
      kind: 'command',
      id: c.id,
      label: c.label,
      detail: c.hint ?? 'Command',
      score: score + KIND_WEIGHT.command,
      matches: extractMatches(c.label, q),
      actions: ['run'],
      command: c,
    });
  });

  if (q === '') {
    /** @param {PaletteItem} item */
    const group = (item) => (item.kind === 'prompt' ? 0 : item.kind === 'snippet' ? 1 : 2);
    items.sort((a, b) => group(a) - group(b) || b.score - a.score);
  } else {
    items.sort((a, b) => b.score - a.score);
  }
  return items.slice(0, maxResults);
}

/**
 * Map a keydown to a palette intent. Keyboard-only flow:
 *   ↑/↓ (or Ctrl+P/N) move · Enter default action · Shift+Enter append ·
 *   Ctrl/Cmd+Enter copy · Alt+Enter promote snippet · Esc back/clear/close ·
 *   Ctrl/Cmd+K reset palette.
 * @param {{ key: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} e
 * @returns {{ type: 'move', delta: number } | { type: 'act', action: PaletteAction|'default' } | { type: 'escape' } | { type: 'reset' } | null}
 */
export function keyIntent(e) {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  const key = e.key;
  if (mod && key.toLowerCase() === 'k') return { type: 'reset' };
  if (key === 'ArrowDown' || (e.ctrlKey && key.toLowerCase() === 'n'))
    return { type: 'move', delta: 1 };
  if (key === 'ArrowUp' || (e.ctrlKey && key.toLowerCase() === 'p'))
    return { type: 'move', delta: -1 };
  if (key === 'PageDown') return { type: 'move', delta: 5 };
  if (key === 'PageUp') return { type: 'move', delta: -5 };
  if (key === 'Escape') return { type: 'escape' };
  if (key === 'Enter') {
    if (mod) return { type: 'act', action: 'copy' };
    if (e.altKey) return { type: 'act', action: 'promote' };
    if (e.shiftKey) return { type: 'act', action: 'append' };
    return { type: 'act', action: 'default' };
  }
  return null;
}

/**
 * Resolve the concrete action for an item ('default' → its first action).
 * Returns null when the item does not support the requested action.
 * @param {PaletteItem|undefined} item
 * @param {PaletteAction|'default'} action
 * @returns {PaletteAction|null}
 */
export function resolveAction(item, action) {
  if (!item) return null;
  if (action === 'default') return item.actions[0] ?? null;
  return item.actions.includes(action) ? action : null;
}

/**
 * Clamp/wrap a selection index after a move.
 * @param {number} index
 * @param {number} delta
 * @param {number} length
 * @returns {number}
 */
export function moveSelection(index, delta, length) {
  if (length <= 0) return 0;
  if (Math.abs(delta) === 1) return (((index + delta) % length) + length) % length; // wrap
  return Math.min(length - 1, Math.max(0, index + delta)); // page: clamp
}

/**
 * Variables that must be filled before a prompt's text can be used.
 * @param {PaletteItem|undefined} item
 * @returns {string[]}
 */
export function requiredVariables(item) {
  if (!item || item.kind !== 'prompt' || !item.prompt) return [];
  return extractVariables(item.prompt.text);
}

/**
 * Pure: bump useCount + lastUsedAt for one prompt.
 * @param {Prompt[]} prompts
 * @param {string} id
 * @param {number} [now]
 * @returns {Prompt[]}
 */
export function markUsed(prompts, id, now = Date.now()) {
  return prompts.map((p) =>
    p.id === id ? { ...p, useCount: (p.useCount ?? 0) + 1, lastUsedAt: now } : p,
  );
}

/**
 * Pure: turn a snippet into a new prompt (title = first line, ≤60 chars).
 * @param {Snippet} snippet
 * @param {{ id: string, now?: number }} meta
 * @returns {Prompt}
 */
export function promoteSnippet(snippet, { id, now = Date.now() }) {
  const firstLine = String(snippet.text ?? '').split('\n')[0] ?? '';
  return {
    id,
    title: preview(firstLine, 60) || 'Untitled snippet',
    text: String(snippet.text ?? ''),
    createdAt: now,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
  };
}
