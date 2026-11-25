/**
 * G13 — `.prompty` share packs (pure, no DOM). A pack is data only: prompts
 * (with compositions) plus the categories they use, a name and an optional
 * author/description. Personal data — use counts, last-used dates, version
 * history, favorites — never leaves in a pack. Import goes through the G11
 * planner (dedupe by text, categories joined by name).
 */
import { normalizeCategory, normalizePrompt } from './storage.js';
import { normalizeProject, normalizeDocument, MAX_DOCUMENT_SIZE } from './documents.js';

/**
 * @typedef {import('./storage.js').Prompt} Prompt
 * @typedef {import('./storage.js').Category} Category
 * @typedef {import('./documents.js').Project} Project
 * @typedef {import('./documents.js').Document} Document
 *
 * @typedef {object} Pack
 * @property {'prompty-pack'} format
 * @property {1} v
 * @property {string} name
 * @property {string} [author]
 * @property {string} [description]
 * @property {number} createdAt
 * @property {Prompt[]} prompts
 * @property {Category[]} categories
 * @property {Project[]} [projects]    G15: optional, absent in older packs
 * @property {Document[]} [documents] G15: optional, absent in older packs
 */

export const PACK_FORMAT = 'prompty-pack';
export const PACK_VERSION = 1;
export const PACK_EXT = 'prompty';
/** Whole-file cap (bytes of JSON text). */
export const MAX_PACK_BYTES = 2_000_000;
export const MAX_PACK_PROMPTS = 1_000;
export const MAX_PACK_CATEGORIES = 100;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

/** @param {unknown} v @param {number} max */
const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * A prompt as it travels in a pack: no usage stats, history or favorite.
 * @param {Prompt} p
 * @param {number} now
 * @returns {Prompt}
 */
function shareable(p, now) {
  const { versions: _v, ...rest } = p;
  void _v;
  return { ...rest, useCount: 0, lastUsedAt: null, isFavorite: false, createdAt: now };
}

/**
 * A document as it travels in a pack: version history never leaves in a pack,
 * but the current markdown is kept so a recipient can rebuild the project.
 * @param {Document} d
 * @returns {Document}
 */
function shareableDocument(d) {
  const { versions: _v, ...rest } = d;
  void _v;
  return rest;
}

/**
 * @param {{ prompts: Prompt[], categories: Category[] }} lib
 * @param {string[]} ids prompts to share, in this order
 * @param {{ name: string, author?: string, description?: string, now?: number,
 *   projects?: Project[], documents?: Document[] }} meta
 * @returns {Pack}
 */
export function buildPack(lib, ids, { name, author = '', description = '', now = Date.now(),
  projects, documents }) {
  const byId = new Map(lib.prompts.map((p) => [p.id, p]));
  const prompts = ids
    .map((id) => byId.get(id))
    .filter((p) => p !== undefined)
    .slice(0, MAX_PACK_PROMPTS)
    .map((p) => shareable(p, now));
  const used = new Set(prompts.map((p) => p.categoryId));
  /** @type {Pack} */
  const pack = {
    format: PACK_FORMAT,
    v: PACK_VERSION,
    name: clip(name, MAX_NAME) || 'Untitled pack',
    createdAt: now,
    prompts,
    categories: lib.categories.filter((c) => used.has(c.id)),
  };
  if (clip(author, MAX_NAME)) pack.author = clip(author, MAX_NAME);
  if (clip(description, MAX_DESCRIPTION)) pack.description = clip(description, MAX_DESCRIPTION);
  if (Array.isArray(projects)) pack.projects = projects;
  if (Array.isArray(documents)) pack.documents = documents.map(shareableDocument);
  return pack;
}

/**
 * File name for a pack: its name in kebab case + ".prompty".
 * @param {string} name
 */
export function packFileName(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'prompty-pack'}.${PACK_EXT}`;
}

/** @param {unknown} raw */
export const looksLikePack = (raw) =>
  !!raw && typeof raw === 'object' && /** @type {any} */ (raw).format === PACK_FORMAT;

/**
 * Validate an untrusted pack. Strings stay inert text (the UI renders them
 * with textContent); unknown keys are dropped by the storage normalizers.
 * @param {string} text the file's raw JSON text
 * @returns {{ ok: true, pack: Pack } | { ok: false, error: string }}
 */
export function parsePack(text) {
  if (typeof text !== 'string' || text.length > MAX_PACK_BYTES)
    return { ok: false, error: 'Pack is too large (2 MB max).' };
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'Pack is not valid JSON.' };
  }
  if (!looksLikePack(raw)) return { ok: false, error: 'Not a Prompty pack.' };
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.v !== PACK_VERSION)
    return { ok: false, error: `Pack version ${String(r.v)} is not supported by this Prompty.` };
  if (!Array.isArray(r.prompts)) return { ok: false, error: 'Pack has no prompt list.' };
  if (r.prompts.length > MAX_PACK_PROMPTS)
    return { ok: false, error: `Pack has more than ${MAX_PACK_PROMPTS} prompts.` };
  const rawCats = Array.isArray(r.categories) ? r.categories : [];
  if (rawCats.length > MAX_PACK_CATEGORIES)
    return { ok: false, error: `Pack has more than ${MAX_PACK_CATEGORIES} categories.` };
  /** @type {Prompt[]} */
  const prompts = [];
  for (const item of r.prompts) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return { ok: false, error: 'Pack contains an invalid prompt.' };
    const p = normalizePrompt(item);
    if (!p || typeof (/** @type {any} */ (item).text) !== 'string')
      return { ok: false, error: 'Pack contains a prompt without text.' };
    prompts.push(shareable(p, p.createdAt));
  }
  /** @type {Category[]} */
  const categories = [];
  for (const item of rawCats) {
    const c = normalizeCategory(item);
    if (c) categories.push(c);
  }

  /** @type {Project[]} */
  const projects = [];
  const rawProjects = Array.isArray(r.projects) ? r.projects : [];
  for (const item of rawProjects) {
    const p = normalizeProject(item);
    if (!p) return { ok: false, error: 'Pack contains an invalid project.' };
    projects.push(p);
  }

  /** @type {Document[]} */
  const documents = [];
  const rawDocuments = Array.isArray(r.documents) ? r.documents : [];
  for (const item of rawDocuments) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return { ok: false, error: 'Pack contains an invalid document.' };
    if (
      typeof item.markdown === 'string' &&
      item.markdown.length > MAX_DOCUMENT_SIZE
    ) {
      return {
        ok: false,
        error: `Document markdown is too large (${MAX_DOCUMENT_SIZE / 1024} KB max).`,
      };
    }
    const d = normalizeDocument(item);
    if (!d) return { ok: false, error: 'Pack contains an invalid document.' };
    documents.push(d);
  }

  /** @type {Pack} */
  const pack = {
    format: PACK_FORMAT,
    v: PACK_VERSION,
    name: clip(r.name, MAX_NAME) || 'Untitled pack',
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    prompts,
    categories,
  };
  if (projects.length) pack.projects = projects;
  if (documents.length) pack.documents = documents;
  if (clip(r.author, MAX_NAME)) pack.author = clip(r.author, MAX_NAME);
  if (clip(r.description, MAX_DESCRIPTION)) pack.description = clip(r.description, MAX_DESCRIPTION);
  return { ok: true, pack };
}
