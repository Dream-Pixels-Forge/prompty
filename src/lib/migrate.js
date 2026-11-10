/**
 * G11 — Migration Suite (pure, no DOM). Turns a file from another tool
 * (Prompty/upstream export envelope, JSON list, CSV, TXT/Markdown) into
 * candidates, then plans the import against the current library:
 * duplicates by normalized text, categories joined by name, a report with
 * a reason for every skip. Nothing is written here; the caller saves.
 */
import { shortTitle } from './capture.js';
import { looksLikePack, parsePack } from './pack.js';
import { normalizeCategory, normalizePrompt } from './storage.js';

/**
 * @typedef {import('./storage.js').Prompt} Prompt
 * @typedef {import('./storage.js').Category} Category
 *
 * @typedef {object} Candidate
 * @property {string} title
 * @property {string} text
 * @property {string|null} category category name (joined by name, case-insensitive)
 * @property {{ color?: string, icon?: string }} [categoryStyle] from an export envelope
 * @property {string[]} tags
 * @property {boolean} isFavorite
 * @property {Partial<Prompt>} [meta] extra fields kept from an export (counts, dates, history)
 *
 * @typedef {'pack'|'envelope'|'json-list'|'csv'|'txt'|'unknown'} Format
 *
 * @typedef {object} Report
 * @property {string[]} added titles
 * @property {string[]} merged titles (duplicate text; tags/favorite added to the existing prompt)
 * @property {{ title: string, reason: string }[]} skipped
 * @property {string[]} categoriesAdded
 */

export const MAX_TEXT = 20_000;
export const MAX_IMPORT = 5_000;
const MAX_TAGS = 10;
const DEFAULT_COLOR = '#FF6A00';
const DEFAULT_ICON = '📁';

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {string} fileName
 * @param {string} text
 * @returns {{ format: Format, data?: unknown }}
 */
export function detectFormat(fileName, text) {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  const body = stripBom(text).trim();
  if (ext === 'csv' || ext === 'tsv') return { format: 'csv' };
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') return { format: 'txt' };
  if (ext === 'prompty') return { format: 'pack' };
  if (ext === 'json' || body.startsWith('{') || body.startsWith('[')) {
    try {
      const data = JSON.parse(body);
      if (looksLikePack(data)) return { format: 'pack' };
      if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.prompts))
        return { format: 'envelope', data };
      if (Array.isArray(data)) return { format: 'json-list', data };
    } catch {
      /* not JSON */
    }
    return { format: 'unknown' };
  }
  return { format: body === '' ? 'unknown' : 'txt' };
}

/** @param {string} text */
const stripBom = (text) => text.replace(/^\uFEFF/, '');

/* ------------------------------------------------------------------ */
/* CSV (RFC 4180)                                                      */
/* ------------------------------------------------------------------ */

/**
 * The delimiter that splits the first line into the most fields (quotes respected).
 * @param {string} text
 */
function sniffDelimiter(text) {
  let best = ',';
  let most = 0;
  for (const d of [',', ';', '\t']) {
    const n = (parseCsv(text.split(/\r?\n/, 1)[0] ?? '', d)[0] ?? []).length;
    if (n > most) {
      most = n;
      best = d;
    }
  }
  return best;
}

/**
 * Rows of fields. Quotes may wrap delimiters and newlines; "" is a quote.
 * @param {string} text
 * @param {string} [delimiter] sniffed from the first line when omitted
 * @returns {string[][]}
 */
export function parseCsv(text, delimiter) {
  const src = stripBom(text).replace(/\r\n?/g, '\n');
  const d = delimiter ?? sniffDelimiter(src);
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADERS = /** @type {const} */ ({
  title: ['title', 'name', 'prompt name', 'label'],
  text: ['text', 'prompt', 'content', 'body', 'prompt text'],
  category: ['category', 'folder', 'collection', 'group'],
  tags: ['tags', 'labels', 'keywords'],
  favorite: ['favorite', 'favourite', 'starred', 'star', 'isfavorite', 'pinned'],
});

/** @param {unknown} v */
const truthy = (v) => /^(true|yes|y|1|x|★|✓)$/i.test(String(v ?? '').trim());

/** @param {unknown} v */
const tagsOf = (v) =>
  Array.isArray(v)
    ? v.filter((t) => typeof t === 'string')
    : typeof v === 'string'
      ? v.split(/[;|,]/)
      : [];

/**
 * @param {string[][]} rows
 * @returns {Candidate[]}
 */
export function csvCandidates(rows) {
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  /** @type {Record<string, number>} */
  const col = {};
  for (const [key, aliases] of Object.entries(HEADERS)) {
    const at = head.findIndex((h) => /** @type {readonly string[]} */ (aliases).includes(h));
    if (at !== -1) col[key] = at;
  }
  // A header row names columns only: every non-empty cell is a known alias.
  const known = new Set(Object.values(HEADERS).flat());
  const hasHeader =
    col.text !== undefined && head.every((h) => h === '' || known.has(/** @type {any} */ (h)));
  const body = hasHeader ? rows.slice(1) : rows;
  return body.map((r) => {
    if (!hasHeader) {
      const [a = '', b] = r;
      return candidate({ title: b === undefined ? '' : a, text: b === undefined ? a : b });
    }
    /** @param {string} key */
    const get = (key) => (col[key] === undefined ? '' : (r[col[key]] ?? ''));
    return candidate({
      title: get('title'),
      text: get('text'),
      category: get('category'),
      tags: tagsOf(get('tags')),
      isFavorite: truthy(get('favorite')),
    });
  });
}

/* ------------------------------------------------------------------ */
/* TXT / Markdown                                                      */
/* ------------------------------------------------------------------ */

const RULE = /^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Blocks split by blank lines or rules. A `# Heading` names the category for
 * what follows. A block that is all bullets is one prompt per bullet. A short
 * first line (≤ 8 words, no closing punctuation) above more text is the title.
 * @param {string} text
 * @returns {Candidate[]}
 */
export function txtCandidates(text) {
  const lines = stripBom(text).replace(/\r\n?/g, '\n').split('\n');
  /** @type {Candidate[]} */
  const out = [];
  /** @type {string|null} */
  let category = null;
  /** @type {string[]} */
  let block = [];
  const flush = () => {
    const b = block;
    block = [];
    if (b.length === 0) return;
    if (b.length > 1 && b.every((l) => BULLET.test(l))) {
      for (const l of b) out.push(candidate({ text: l.replace(BULLET, ''), category }));
      return;
    }
    const first = b[0]
      .replace(BULLET, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .trim();
    const looksLikeTitle =
      b.length > 1 && first.split(/\s+/).length <= 8 && !/[.,;:!?…]$/.test(first);
    out.push(
      looksLikeTitle
        ? candidate({ title: first, text: b.slice(1).join('\n'), category })
        : candidate({ text: b.join('\n'), category }),
    );
  };
  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      category = heading[1];
    } else if (line.trim() === '' || RULE.test(line)) flush();
    else block.push(line);
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ */
/* JSON list / export envelope                                         */
/* ------------------------------------------------------------------ */

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * An array of strings, or of objects with text|prompt|content|body.
 * @param {unknown[]} list
 * @returns {Candidate[]}
 */
export function jsonListCandidates(list) {
  return list.map((item) => {
    if (typeof item === 'string') return candidate({ text: item });
    const o = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
    return candidate({
      title: str(o.title) || str(o.name),
      text: str(o.text) || str(o.prompt) || str(o.content) || str(o.body),
      category: str(o.category) || str(o.folder) || str(o.categoryName),
      tags: tagsOf(o.tags),
      isFavorite: o.isFavorite === true || o.favorite === true || o.starred === true,
    });
  });
}

/**
 * A Prompty or upstream (Higgsfield Prompt Saver) export: categoryId is
 * resolved to the category's NAME so it can join the user's own categories.
 * Counts, dates, aspect/quality, history and compositions are kept.
 * @param {{ prompts: unknown[], categories?: unknown }} data
 * @returns {Candidate[]}
 */
export function envelopeCandidates(data) {
  const cats = new Map();
  for (const raw of Array.isArray(data.categories) ? data.categories : []) {
    const c = normalizeCategory(raw);
    if (c) cats.set(c.id, c);
  }
  return data.prompts.map((raw) => {
    const p = normalizePrompt(raw);
    if (!p) return candidate({ text: '' });
    const cat = p.categoryId ? cats.get(p.categoryId) : undefined;
    const { title, text, tags, isFavorite, ...rest } = p;
    const meta = { ...rest };
    delete (/** @type {Partial<Prompt>} */ (meta).id);
    delete (/** @type {Partial<Prompt>} */ (meta).categoryId);
    return {
      ...candidate({ title, text, category: cat?.name ?? null, tags, isFavorite }),
      categoryStyle: cat ? { color: cat.color, icon: cat.icon } : undefined,
      meta,
    };
  });
}

/**
 * @param {{ title?: string, text?: string, category?: string|null, tags?: string[], isFavorite?: boolean }} c
 * @returns {Candidate}
 */
function candidate({ title = '', text = '', category = null, tags = [], isFavorite = false }) {
  return {
    title: title.trim(),
    text: text.trim(),
    category: category && category.trim() ? category.trim() : null,
    tags: cleanTags(tags),
    isFavorite,
  };
}

/** @param {string[]} tags */
function cleanTags(tags) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * Any supported file → candidates.
 * @param {string} fileName
 * @param {string} text
 * @returns {{ format: Format, candidates: Candidate[], pack?: import('./pack.js').Pack, error?: string }}
 */
export function readFile(fileName, text) {
  const { format, data } = detectFormat(fileName, text);
  if (format === 'pack') {
    const parsed = parsePack(text);
    if (!parsed.ok) return { format, candidates: [], error: parsed.error };
    return { format, candidates: envelopeCandidates(parsed.pack), pack: parsed.pack };
  }
  if (format === 'envelope')
    return { format, candidates: envelopeCandidates(/** @type {any} */ (data)) };
  if (format === 'json-list')
    return { format, candidates: jsonListCandidates(/** @type {unknown[]} */ (data)) };
  if (format === 'csv') return { format, candidates: csvCandidates(parseCsv(text)) };
  if (format === 'txt') return { format, candidates: txtCandidates(text) };
  return { format, candidates: [] };
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

/** Duplicate key: whitespace collapsed, case-folded. @param {string} text */
export const textKey = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Plan an import. Returns the next prompts/categories and a report.
 * @param {{ prompts: Prompt[], categories: Category[] }} library
 * @param {Candidate[]} candidates
 * @param {{ now?: number, newId: () => string, colors?: string[] }} opts
 * @returns {{ prompts: Prompt[], categories: Category[], report: Report }}
 */
export function planMigration(library, candidates, { now = Date.now(), newId, colors = [] }) {
  const prompts = [...library.prompts];
  const categories = [...library.categories];
  /** @type {Report} */
  const report = { added: [], merged: [], skipped: [], categoriesAdded: [] };
  const byKey = new Map(prompts.map((p, i) => [textKey(p.text), i]));
  const seenInFile = new Set();
  const catByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  let order = categories.reduce((m, c) => Math.max(m, c.order), -1);

  /** @param {Candidate} c */
  const categoryFor = (c) => {
    if (!c.category) return null;
    const key = c.category.toLowerCase();
    const found = catByName.get(key);
    if (found) return found;
    const color =
      c.categoryStyle?.color ??
      colors[report.categoriesAdded.length % Math.max(1, colors.length)] ??
      DEFAULT_COLOR;
    const cat = normalizeCategory({
      id: newId(),
      name: c.category.slice(0, 60),
      color: color || DEFAULT_COLOR,
      icon: c.categoryStyle?.icon || DEFAULT_ICON,
      order: ++order,
    });
    if (!cat) return null;
    categories.push(cat);
    catByName.set(key, cat.id);
    report.categoriesAdded.push(cat.name);
    return cat.id;
  };

  candidates.slice(0, MAX_IMPORT).forEach((c, i) => {
    const title = c.title || shortTitle(c.text.split('\n')[0] ?? '') || `Untitled ${i + 1}`;
    if (!c.text) return report.skipped.push({ title, reason: 'empty' });
    if (c.text.length > MAX_TEXT) return report.skipped.push({ title, reason: 'too long' });
    const key = textKey(c.text);
    if (seenInFile.has(key)) return report.skipped.push({ title, reason: 'duplicate in file' });
    seenInFile.add(key);

    const at = byKey.get(key);
    if (at !== undefined) {
      const old = prompts[at];
      const tags = cleanTags([...old.tags, ...c.tags]);
      const isFavorite = old.isFavorite || c.isFavorite;
      const changed = tags.length !== old.tags.length || isFavorite !== old.isFavorite;
      if (!changed) return report.skipped.push({ title: old.title, reason: 'already in library' });
      prompts[at] = { ...old, tags, isFavorite };
      return report.merged.push(old.title);
    }

    const prompt = normalizePrompt({
      useCount: 0,
      lastUsedAt: null,
      aspectRatio: null,
      quality: null,
      createdAt: now,
      ...c.meta,
      id: newId(),
      title: title.slice(0, 120),
      text: c.text,
      categoryId: categoryFor(c),
      tags: c.tags,
      isFavorite: c.isFavorite,
    });
    if (!prompt) return report.skipped.push({ title, reason: 'invalid' });
    prompts.push(prompt);
    byKey.set(key, prompts.length - 1);
    report.added.push(prompt.title);
  });
  if (candidates.length > MAX_IMPORT) {
    report.skipped.push({
      title: `${candidates.length - MAX_IMPORT} more`,
      reason: `over the ${MAX_IMPORT}-prompt limit per import`,
    });
  }
  return { prompts, categories, report };
}
