// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Prompty MCP — local prompt store.
 *
 * Two files under `~/.prompty`:
 *   library.json  prompts, categories, deletion tombstones (0600)
 *   bridge.json   `{ token, port }` pairing secret for the extension (0600)
 *
 * Prompt bookkeeping: `source` says who made it (`mcp` or `extension`),
 * `syncedAt === null` means "queued for the extension on its next sync".
 * Writes are atomic (tmp file + rename) so a crash cannot truncate the library.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Longest prompt body accepted (matches the extension-side bridge cap). */
export const MAX_TEXT = 100_000;
/** Tags kept per prompt. */
export const MAX_TAGS = 20;
/** Deletion tombstones retained; older ones fall off. */
export const TOMBSTONE_CAP = 500;
export const DEFAULT_PORT = 47821;

const PALETTE = [
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
  '#14b8a6',
  '#f97316',
  '#a855f7',
  '#0ea5e9',
];

/** Duplicate key: whitespace collapsed, case-folded (same rule as the extension). */
export const textKey = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Open (or create) the store.
 * @param {{
 *   home: string,
 *   port?: number,
 *   now?: () => number,
 *   newId?: () => string,
 * }} options
 */
export async function openStore({ home, port = DEFAULT_PORT, now = Date.now, newId = randomUUID }) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const libraryPath = join(home, 'library.json');
  const bridgePath = join(home, 'bridge.json');

  const bridge = await readBridge(bridgePath);
  const token = bridge?.token ?? randomBytes(24).toString('hex');
  const activePort = Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;

  const loaded = await readLibrary(libraryPath, now);
  const state = {
    prompts: loaded.prompts,
    categories: loaded.categories,
    tombstones: loaded.tombstones,
  };

  /** @param {string} path @param {unknown} data */
  const writeJson = async (path, data) => {
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  };

  const persist = () =>
    writeJson(libraryPath, {
      version: 1,
      prompts: state.prompts,
      categories: state.categories,
      tombstones: state.tombstones,
      updatedAt: now(),
    });

  // Create both files on first run, and always re-assert bridge permissions.
  await persist();
  await writeJson(bridgePath, { token, port: activePort });

  /**
   * Find or create a category by display name.
   * @param {string} name
   * @returns {string} category id
   */
  const resolveCategory = (name) => {
    const clean = name.trim().replace(/\s+/g, ' ');
    const key = textKey(clean);
    const existing = state.categories.find((category) => textKey(category.name) === key);
    if (existing) return existing.id;
    const category = {
      id: newId(),
      name: clean,
      color: PALETTE[state.categories.length % PALETTE.length],
      icon: '📁',
      order: state.categories.length,
    };
    state.categories.push(category);
    return category.id;
  };

  /**
   * Save an agent-authored prompt. Identical body → update in place.
   * @param {{ title?: string, text: string, tags?: unknown, category?: string, favorite?: boolean }} input
   */
  const savePrompt = async (input) => {
    const text = typeof input?.text === 'string' ? input.text : '';
    if (text.trim() === '') throw new Error('Prompt text is required');
    if (text.length > MAX_TEXT) throw new Error(`Prompt text is too long (max ${MAX_TEXT})`);

    const key = textKey(text);
    const existing = state.prompts.find((prompt) => textKey(prompt.text) === key);
    if (existing) {
      if (typeof input.title === 'string' && input.title.trim() !== '') {
        existing.title = input.title.trim().slice(0, 200);
      }
      if (input.tags !== undefined) existing.tags = normalizeTags(input.tags);
      if (typeof input.category === 'string' && input.category.trim() !== '') {
        existing.categoryId = resolveCategory(input.category);
      }
      if (input.favorite === true) existing.isFavorite = true;
      existing.syncedAt = null;
      await persist();
      return { created: false, prompt: existing };
    }

    const categoryId =
      typeof input.category === 'string' && input.category.trim() !== ''
        ? resolveCategory(input.category)
        : null;

    const prompt = {
      id: newId(),
      title: titleFrom(input.title, text),
      text,
      createdAt: now(),
      useCount: 0,
      isFavorite: input.favorite === true,
      categoryId,
      tags: normalizeTags(input.tags),
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
      source: 'mcp',
      syncedAt: null,
    };
    state.prompts.push(prompt);
    await persist();
    return { created: true, prompt };
  };

  /** @param {string} id @param {Record<string, unknown>} patch */
  const updatePrompt = async (id, patch) => {
    const prompt = state.prompts.find((item) => item.id === id);
    if (!prompt) throw new Error(`Prompt not found: ${id}`);

    if (typeof patch.text === 'string') {
      if (patch.text.trim() === '') throw new Error('Prompt text is required');
      if (patch.text.length > MAX_TEXT) throw new Error(`Prompt text is too long (max ${MAX_TEXT})`);
      prompt.text = patch.text;
    }
    if (typeof patch.title === 'string' && patch.title.trim() !== '') {
      prompt.title = patch.title.trim().slice(0, 200);
    }
    if (patch.tags !== undefined) prompt.tags = normalizeTags(patch.tags);
    if (typeof patch.favorite === 'boolean') prompt.isFavorite = patch.favorite;
    if (typeof patch.category === 'string' && patch.category.trim() !== '') {
      prompt.categoryId = resolveCategory(patch.category);
    }
    if (patch.aspectRatio === null || typeof patch.aspectRatio === 'string') {
      prompt.aspectRatio = patch.aspectRatio;
    }
    if (patch.quality === null || typeof patch.quality === 'string') {
      prompt.quality = patch.quality;
    }
    prompt.syncedAt = null;
    await persist();
    return prompt;
  };

  /** @param {string} id */
  const deletePrompt = async (id) => {
    const index = state.prompts.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Prompt not found: ${id}`);
    state.prompts.splice(index, 1);
    state.tombstones.push({ id, deletedAt: now() });
    if (state.tombstones.length > TOMBSTONE_CAP) {
      state.tombstones = state.tombstones.slice(-TOMBSTONE_CAP);
    }
    await persist();
    return { deleted: true, id };
  };

  /** @param {unknown} ids */
  const ack = async (ids) => {
    const set = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
    if (set.size === 0) return 0;
    let acked = 0;
    for (const prompt of state.prompts) {
      if (prompt.syncedAt === null && set.has(prompt.id)) {
        prompt.syncedAt = now();
        acked++;
      }
    }
    state.tombstones = state.tombstones.filter((tombstone) => !set.has(tombstone.id));
    await persist();
    return acked;
  };

  /** Everything the extension has not imported yet. */
  const pending = () => ({
    prompts: state.prompts.filter((prompt) => prompt.syncedAt === null),
    categories: state.categories,
    deleted: state.tombstones.map((tombstone) => ({ id: tombstone.id })),
  });

  /**
   * Merge the extension's library back in. Synced prompts mirror the browser;
   * prompts still queued for the extension survive the merge.
   * @param {{ prompts?: unknown, categories?: unknown }} payload
   */
  const snapshot = async (payload) => {
    const incoming = [];
    for (const raw of asArray(payload?.prompts)) {
      const prompt = normalizeStored(raw, now);
      if (prompt) {
        prompt.source = 'extension';
        prompt.syncedAt = now();
        incoming.push(prompt);
      }
    }

    /** @type {Map<string, any>} */
    const byId = new Map(incoming.map((prompt) => [prompt.id, prompt]));
    for (const prompt of state.prompts) {
      if (prompt.syncedAt === null && !byId.has(prompt.id)) byId.set(prompt.id, prompt);
    }
    state.prompts = [...byId.values()];

    /** @type {Map<string, any>} */
    const categories = new Map();
    for (const raw of asArray(payload?.categories)) {
      if (!isRecord(raw)) continue;
      if (typeof raw.id !== 'string' || raw.id === '') continue;
      if (typeof raw.name !== 'string' || raw.name.trim() === '') continue;
      categories.set(raw.id, {
        id: raw.id,
        name: raw.name.trim(),
        color: typeof raw.color === 'string' ? raw.color : PALETTE[categories.size % PALETTE.length],
        icon: typeof raw.icon === 'string' ? raw.icon : '📁',
        order: Number.isFinite(raw.order) ? Number(raw.order) : categories.size,
      });
    }
    // Keep local categories that a still-pending prompt refers to.
    const used = new Set(state.prompts.map((prompt) => prompt.categoryId).filter(Boolean));
    for (const category of state.categories) {
      if (used.has(category.id) && !categories.has(category.id)) {
        categories.set(category.id, category);
      }
    }
    state.categories = [...categories.values()];

    await persist();
    return { stored: state.prompts.length };
  };

  return {
    path: libraryPath,
    home,
    token,
    port: activePort,
    recovered: loaded.recovered,
    listPrompts: () => state.prompts,
    listCategories: () => state.categories,
    savePrompt,
    updatePrompt,
    deletePrompt,
    ack,
    pending,
    snapshot,
  };
}

/* ------------------------------------------------------------------ */
/* files                                                               */
/* ------------------------------------------------------------------ */

/** @param {string} path */
async function readBridge(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (isRecord(parsed) && typeof parsed.token === 'string' && /^[a-f0-9]{48}$/.test(parsed.token)) {
      return { token: parsed.token };
    }
  } catch {
    // Missing or corrupt — a fresh token is generated below.
  }
  return null;
}

/**
 * @param {string} path
 * @param {() => number} now
 */
async function readLibrary(path, now) {
  /** @type {unknown} */
  let parsed = null;
  let recovered = false;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    recovered = !(error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT');
  }
  if (!isRecord(parsed)) {
    return { prompts: [], categories: [], tombstones: [], recovered };
  }
  return {
    prompts: asArray(parsed.prompts).map((raw) => normalizeStored(raw, now)).filter(Boolean),
    categories: asArray(parsed.categories)
      .filter(
        (raw) =>
          isRecord(raw) && typeof raw.id === 'string' && raw.id !== '' && typeof raw.name === 'string',
      )
      .map((raw) => ({
        id: raw.id,
        name: String(raw.name).trim(),
        color: typeof raw.color === 'string' ? raw.color : PALETTE[0],
        icon: typeof raw.icon === 'string' ? raw.icon : '📁',
        order: Number.isFinite(raw.order) ? Number(raw.order) : 0,
      })),
    tombstones: asArray(parsed.tombstones)
      .filter((raw) => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '')
      .map((raw) => ({ id: raw.id, deletedAt: Number.isFinite(raw.deletedAt) ? raw.deletedAt : 0 }))
      .slice(-TOMBSTONE_CAP),
    recovered,
  };
}

/* ------------------------------------------------------------------ */
/* normalization                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {unknown} raw
 * @param {() => number} now
 */
export function normalizeStored(raw, now = Date.now) {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.text !== 'string' || raw.text.trim() === '') return null;
  if (raw.text.length > MAX_TEXT) return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim() : titleFrom('', raw.text),
    text: raw.text,
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now(),
    useCount: Number.isFinite(raw.useCount) ? Number(raw.useCount) : 0,
    isFavorite: raw.isFavorite === true,
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId !== '' ? raw.categoryId : null,
    tags: normalizeTags(raw.tags),
    aspectRatio: typeof raw.aspectRatio === 'string' ? raw.aspectRatio : null,
    quality: typeof raw.quality === 'string' ? raw.quality : null,
    lastUsedAt: Number.isFinite(raw.lastUsedAt) ? Number(raw.lastUsedAt) : null,
    source: raw.source === 'extension' ? 'extension' : 'mcp',
    syncedAt: Number.isFinite(raw.syncedAt) ? Number(raw.syncedAt) : raw.syncedAt === null ? null : null,
  };
}

/** @param {unknown} value */
export function normalizeTags(value) {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    if (tag === '' || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * @param {unknown} title
 * @param {string} text
 */
export function titleFrom(title, text) {
  if (typeof title === 'string' && title.trim() !== '') return title.trim().slice(0, 200);
  const line = text.trim().split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/** @template T @param {unknown} value @returns {T[]} */
function asArray(value) {
  return Array.isArray(value) ? /** @type {T[]} */ (value) : [];
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
