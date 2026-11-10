/**
 * G9 — Prompt Composer core (pure, no DOM). A shot is a stack of blocks in
 * film-grammar order; each block draws from the library (by category) or is
 * free text. compose() assembles them into one prompt whose {variables} are
 * asked once across all blocks (the existing fill-in form does that).
 */
import { parseVariables } from './variables.js';

/**
 * @typedef {import('./storage.js').Prompt} Prompt
 * @typedef {import('./storage.js').Category} Category
 *
 * @typedef {object} Block
 * @property {string} id
 * @property {string} slot one of SLOT_IDS
 * @property {string|null} promptId library prompt it was picked from (kept for reference)
 * @property {string} text snapshot (editable); survives the source prompt being deleted
 * @property {boolean} muted muted blocks are skipped when composing
 *
 * @typedef {object} Composition
 * @property {', '|'. '} joiner
 * @property {Block[]} blocks
 */

/** Film-grammar order: how a director briefs a shot. `categories` match library categories by name. */
export const SLOTS = /** @type {const} */ ([
  { id: 'subject', label: 'Subject & Action', categories: ['Characters', 'Objects'] },
  { id: 'location', label: 'Location', categories: ['Locations', 'Landscapes'] },
  { id: 'camera', label: 'Camera', categories: ['Camera Movement', 'Camera Angles'] },
  { id: 'lens', label: 'Lens', categories: ['Lens & Optics'] },
  { id: 'composition', label: 'Composition', categories: ['Composition'] },
  { id: 'lighting', label: 'Lighting', categories: ['Lighting'] },
  { id: 'grade', label: 'Color Grade', categories: ['Color Grading'] },
  { id: 'mood', label: 'Mood', categories: ['Mood & Atmosphere'] },
  { id: 'transition', label: 'Transition', categories: ['VFX & Transitions'] },
  { id: 'extra', label: 'Extra', categories: [] }, // any prompt
]);
export const SLOT_IDS = SLOTS.map((s) => s.id);
export const JOINERS = /** @type {const} */ ([', ', '. ']);
export const MAX_BLOCKS = 20;
export const MAX_BLOCK_TEXT = 4000;

/** @param {string} slot */
const rank = (slot) => {
  const i = SLOT_IDS.indexOf(/** @type {any} */ (slot));
  return i === -1 ? SLOT_IDS.length : i;
};

/**
 * One empty block per slot (except Extra): a director's checklist.
 * @param {(i: number) => string} newId
 * @returns {Composition}
 */
export function emptyComposition(newId) {
  return {
    joiner: ', ',
    blocks: SLOTS.filter((s) => s.id !== 'extra').map((s, i) => ({
      id: newId(i),
      slot: s.id,
      promptId: null,
      text: '',
      muted: false,
    })),
  };
}

/**
 * Library prompts a slot can draw from (by category name, case-insensitive),
 * A→Z. The Extra slot offers every prompt.
 * @param {string} slot
 * @param {Prompt[]} prompts
 * @param {Category[]} categories
 * @returns {Prompt[]}
 */
export function promptsForSlot(slot, prompts, categories) {
  const def = SLOTS.find((s) => s.id === slot);
  /** @type {Prompt[]} */
  let list = prompts;
  if (def && def.categories.length > 0) {
    const wanted = new Set(def.categories.map((n) => n.toLowerCase()));
    const ids = new Set(
      categories.filter((c) => wanted.has(c.name.trim().toLowerCase())).map((c) => c.id),
    );
    list = prompts.filter((p) => p.categoryId !== null && ids.has(p.categoryId));
  }
  return [...list].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

/** @param {string} text */
const tidy = (text) => text.trim().replace(/[\s.,;:]+$/, '');

/**
 * Assemble the shot: skip muted/empty blocks, trim trailing punctuation, join.
 * Variables come from the assembled text, so a name used in several blocks
 * (e.g. {subject}) is asked once.
 * @param {Composition} composition
 * @returns {{ text: string, used: number, variables: import('./variables.js').VariableSpec[] }}
 */
export function compose(composition) {
  const parts = composition.blocks
    .filter((b) => !b.muted)
    .map((b) => tidy(b.text))
    .filter(Boolean);
  const text = parts.join(composition.joiner);
  return { text, used: parts.length, variables: parseVariables(text) };
}

/**
 * Insert a block in film order (after the last block of the same or an earlier slot).
 * @param {Composition} c
 * @param {string} slot
 * @param {string} id
 * @returns {Composition}
 */
export function addBlock(c, slot, id) {
  if (c.blocks.length >= MAX_BLOCKS) return c;
  const block = {
    id,
    slot: SLOT_IDS.includes(/** @type {any} */ (slot)) ? slot : 'extra',
    promptId: null,
    text: '',
    muted: false,
  };
  let at = c.blocks.length;
  for (let i = c.blocks.length - 1; i >= 0; i--) {
    if (rank(c.blocks[i].slot) <= rank(block.slot)) {
      at = i + 1;
      break;
    }
    at = i;
  }
  const blocks = [...c.blocks];
  blocks.splice(at, 0, block);
  return { ...c, blocks };
}

/**
 * @param {Composition} c
 * @param {string} id
 * @returns {Composition}
 */
export function removeBlock(c, id) {
  return { ...c, blocks: c.blocks.filter((b) => b.id !== id) };
}

/**
 * Move a block up (-1) or down (+1); no-op at the edges.
 * @param {Composition} c
 * @param {string} id
 * @param {number} delta
 * @returns {Composition}
 */
export function moveBlock(c, id, delta) {
  const from = c.blocks.findIndex((b) => b.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= c.blocks.length) return c;
  const blocks = [...c.blocks];
  const [b] = blocks.splice(from, 1);
  blocks.splice(to, 0, b);
  return { ...c, blocks };
}

/**
 * @param {Composition} c
 * @param {string} id
 * @param {Partial<Pick<Block, 'slot'|'text'|'muted'>>} patch
 * @returns {Composition}
 */
export function updateBlock(c, id, patch) {
  return { ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

/**
 * Fill a block from a library prompt (or clear it with null).
 * @param {Composition} c
 * @param {string} id
 * @param {Prompt|null} prompt
 * @returns {Composition}
 */
export function pickPrompt(c, id, prompt) {
  return updateBlock(
    c,
    id,
    /** @type {any} */ ({ promptId: prompt ? prompt.id : null, text: prompt ? prompt.text : '' }),
  );
}

/* ------------------------------------------------------------------ */
/* Starter templates (built only from seed prompts, found by title)    */
/* ------------------------------------------------------------------ */

export const TEMPLATES = /** @type {const} */ ([
  {
    id: 'neon-noir-push-in',
    name: 'Neon noir push-in',
    blocks: [
      { slot: 'location', title: 'Rain-Soaked Night Market' },
      { slot: 'camera', title: 'Slow Push-In Reveal' },
      { slot: 'lens', title: 'Anamorphic Widescreen' },
      { slot: 'lighting', title: 'Neon Noir' },
      { slot: 'grade', title: 'Bleach Bypass' },
    ],
  },
  {
    id: 'golden-hour-crane-reveal',
    name: 'Golden-hour crane reveal',
    blocks: [
      { slot: 'location', title: 'Salt Flat Mirror' },
      { slot: 'camera', title: 'Crane-Up Reveal' },
      { slot: 'lighting', title: 'Golden Hour Backlight' },
      { slot: 'grade', title: 'Pastel Film Stock' },
      { slot: 'mood', title: 'Dreamy Haze' },
    ],
  },
  {
    id: 'impossible-macro-to-wide',
    name: 'Impossible macro-to-wide',
    blocks: [
      { slot: 'camera', title: 'Impossible Macro-to-Wide' },
      { slot: 'location', title: 'Fog Forest' },
      { slot: 'lens', title: 'Vintage Swirl Bokeh' },
      { slot: 'transition', title: 'Through-the-Object' },
    ],
  },
]);

/**
 * Build a composition from a template using the user's current prompts
 * (found by title, case-insensitive). Missing prompts become empty blocks.
 * Blocks come out in film order.
 * @param {string} templateId
 * @param {Prompt[]} prompts
 * @param {(i: number) => string} newId
 * @returns {Composition|null}
 */
export function fromTemplate(templateId, prompts, newId) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return null;
  const byTitle = new Map(prompts.map((p) => [p.title.trim().toLowerCase(), p]));
  const blocks = t.blocks
    .map((b, i) => {
      const p = byTitle.get(b.title.toLowerCase()) ?? null;
      return {
        id: newId(i),
        slot: b.slot,
        promptId: p ? p.id : null,
        text: p ? p.text : '',
        muted: false,
      };
    })
    .sort((a, b) => rank(a.slot) - rank(b.slot));
  return { joiner: ', ', blocks };
}

/* ------------------------------------------------------------------ */
/* Storage (Prompt.composition)                                        */
/* ------------------------------------------------------------------ */

/**
 * Whitelist a stored composition: known slots, string text (capped), at most
 * MAX_BLOCKS blocks, a known joiner. Null when nothing usable remains.
 * @param {unknown} raw
 * @returns {Composition|null}
 */
export function normalizeComposition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(r.blocks)) return null;
  /** @type {Block[]} */
  const blocks = [];
  r.blocks.forEach((item, i) => {
    if (blocks.length >= MAX_BLOCKS || !item || typeof item !== 'object' || Array.isArray(item))
      return;
    const b = /** @type {Record<string, unknown>} */ (item);
    if (typeof b.text !== 'string') return;
    blocks.push({
      id: typeof b.id === 'string' && b.id !== '' ? b.id : `b${i}`,
      slot: SLOT_IDS.includes(/** @type {any} */ (b.slot))
        ? /** @type {string} */ (b.slot)
        : 'extra',
      promptId: typeof b.promptId === 'string' && b.promptId !== '' ? b.promptId : null,
      text: b.text.slice(0, MAX_BLOCK_TEXT),
      muted: b.muted === true,
    });
  });
  if (blocks.length === 0) return null;
  return { joiner: r.joiner === '. ' ? '. ' : ', ', blocks };
}
