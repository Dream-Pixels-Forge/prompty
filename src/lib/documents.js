/**
 * Documents library (G15) — Projects, documents, prompt-sheet extraction, shot linking.
 * Pure ES modules, no browser dependencies, JSDoc typed.
 *
 * Storage keys (whitelisted in storage.js):
 *   - projects: Project[]
 *   - documents: Document[]
 */

import { MAX_VERSIONS } from './storage.js';
import { extractShotVariants } from './prompt-sheet.js';

/** @typedef {'screenplay'|'project-card'|'breakdown'|'prompt-sheet'|'rules'|'notes'} DocumentKind */

/**
 * @typedef {object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} icon
 * @property {string} [description]
 * @property {number} order
 * @property {number} createdAt
 */

/**
 * @typedef {object} Document
 * @property {string} id
 * @property {string} projectId
 * @property {string} title
 * @property {DocumentKind} kind
 * @property {string} markdown
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {DocumentVersion[]} [versions] previous markdown, newest first (G5 style; omitted when none)
 */

/**
 * @typedef {object} DocumentVersion
 * @property {string} markdown
 * @property {number} updatedAt
 */

/**
 * @typedef {object} DocumentComposition
 * @property {string} documentId
 * @property {string} shotId
 * @property {string} [modelId]
 * @property {string[]} refs
 * @property {string} [edit]
 * @property {string} [check]
 * @property {string} versionTag
 */

/**
 * @typedef {object} Shot
 * @property {string} shotId
 * @property {string} name
 * @property {string[]} refs
 * @property {string} prompt
 * @property {string} [modelId]
 * @property {string} edit
 * @property {string} check
 * @property {string} documentId
 * @property {string} projectName
 */

/** Valid document kinds. */
export const KIND_VALUES = /** @type {const} */ (
  ['screenplay', 'project-card', 'breakdown', 'prompt-sheet', 'rules', 'notes']
);

/** Maximum document size (512 KB). */
export const MAX_DOCUMENT_SIZE = 512 * 1024;
/** Maximum documents total. */
export const MAX_DOCUMENTS = 300;
/** Maximum projects total. */
export const MAX_PROJECTS = 50;
/** Maximum document versions (matches G5 prompt history). */
export const MAX_DOCUMENT_VERSIONS = MAX_VERSIONS;

/** Default project settings (for future use). */
export const DEFAULT_PROJECT_SETTINGS = {};

/* ------------------------------------------------------------------ */
/* ID generation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Generate a cryptographically random UUID (SECURITY.md).
 * @returns {string}
 */
export function generateId() {
  return globalThis.crypto?.randomUUID?.() ?? '';
}

/* ------------------------------------------------------------------ */
/* Project normalization                                               */
/* ------------------------------------------------------------------ */

/**
 * Normalize a raw project object to the G15 schema.
 * @param {unknown} raw
 * @returns {Project|null}
 */
export function normalizeProject(raw) {
  if (!isRecord(raw)) return null;
  const color = stringOr(raw.color);
  const icon = stringOr(raw.icon);
  // Validate hex color format
  const validColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : defaultColor();
  const validIcon = icon || defaultIcon();
  return {
    id: stringOr(raw.id) || generateId(),
    name: stringOr(raw.name),
    color: validColor,
    icon: validIcon,
    order: numberOr(raw.order, 0),
    createdAt: numberOr(raw.createdAt, Date.now()),
  };
}

/**
 * @returns {string}
 */
function defaultColor() {
  // Deterministic but varied default colors for projects
  const colors = [
    '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b',
    '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * @returns {string}
 */
function defaultIcon() {
  const icons = ['🎬', '📝', '🎭', '🎨', '📋', '🗂️', '📚', '🎯', '✨', '🔮'];
  return icons[Math.floor(Math.random() * icons.length)];
}

/* ------------------------------------------------------------------ */
/* Document normalization                                              */
/* ------------------------------------------------------------------ */

/**
 * Normalize a raw document object to the G15 schema.
 * Refuses oversized documents (never truncates silently).
 * @param {unknown} raw
 * @returns {Document|null}
 */
export function normalizeDocument(raw) {
  if (!isRecord(raw)) return null;

  const kind = stringOr(raw.kind);
  if (!KIND_VALUES.includes(/** @type {DocumentKind} */ (kind))) return null;

  const markdown = stringOr(raw.markdown);
  if (!markdown || markdown.length > MAX_DOCUMENT_SIZE) return null; // refuse empty or oversized

  const projectId = stringOr(raw.projectId);
  const title = stringOr(raw.title);
  if (!projectId || !title) return null;

  const now = Date.now();
  return {
    id: stringOr(raw.id) || generateId(),
    projectId,
    title,
    kind: /** @type {DocumentKind} */ (kind),
    markdown,
    createdAt: numberOr(raw.createdAt, now),
    updatedAt: numberOr(raw.updatedAt, now),
    ...versionsOf(raw.versions),
  };
}

/**
 * Whitelist document versions: keep entries with string markdown and finite updatedAt,
 * cap at MAX_DOCUMENT_VERSIONS (newest first).
 * Returns `{}` (field omitted) when nothing valid.
 * @param {unknown} value
 * @returns {{ versions?: DocumentVersion[] }}
 */
function versionsOf(value) {
  if (!Array.isArray(value)) return {};
  /** @type {DocumentVersion[]} */
  const versions = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.markdown !== 'string') continue;
    const updatedAt = numberOr(item.updatedAt, 0);
    if (updatedAt === 0) continue;
    versions.push({ markdown: item.markdown, updatedAt });
    if (versions.length === MAX_DOCUMENT_VERSIONS) break;
  }
  return versions.length > 0 ? { versions } : {};
}

/* ------------------------------------------------------------------ */
/* Document version normalization (standalone helper)                  */
/* ------------------------------------------------------------------ */

/**
 * Normalize an array of document versions.
 * @param {unknown} value
 * @returns {DocumentVersion[]}
 */
export function normalizeDocumentVersion(value) {
  if (!Array.isArray(value)) return [];
  /** @type {DocumentVersion[]} */
  const out = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.markdown !== 'string') continue;
    const updatedAt = numberOr(item.updatedAt, 0);
    if (updatedAt === 0) continue;
    out.push({ markdown: item.markdown, updatedAt });
    if (out.length === MAX_DOCUMENT_VERSIONS) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Document merge by project + title (upsert for save_document)       */
/* ------------------------------------------------------------------ */

/**
 * Merge an incoming document into an array by (projectId, title).
 * - If projectId+title exists and markdown changed → new version (capped).
 * - If projectId+title exists and markdown unchanged → no-op.
 * - If not found → add as new document.
 * @param {Document[]} existing
 * @param {Document} incoming
 * @returns {Document[]}
 */
export function mergeDocumentsByProjectAndTitle(existing, incoming) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const idx = list.findIndex(
    (d) => d.projectId === incoming.projectId && d.title === incoming.title,
  );

  if (idx >= 0) {
    const existingDoc = list[idx];
    if (existingDoc.markdown !== incoming.markdown) {
      // Markdown changed: create new version from old content
      const newVersion = {
        markdown: existingDoc.markdown,
        updatedAt: existingDoc.updatedAt,
      };
      const versions = existingDoc.versions ? [newVersion, ...existingDoc.versions] : [newVersion];
      const cappedVersions = versions.slice(0, MAX_DOCUMENT_VERSIONS);
      list[idx] = {
        ...existingDoc,
        markdown: incoming.markdown,
        updatedAt: incoming.updatedAt || Date.now(),
        versions: cappedVersions.length > 0 ? cappedVersions : undefined,
      };
    }
    // else: unchanged, no-op
    return list;
  }

  // New document - ensure it has no versions initially
  const newDoc = { ...incoming };
  if (!newDoc.versions || newDoc.versions.length === 0) {
    newDoc.versions = undefined;
  }
  list.push(newDoc);
  return list;
}

/* ------------------------------------------------------------------ */
/* Shot extraction from markdown (prompt-sheet)                        */
/* ------------------------------------------------------------------ */

/**
 * Extract shot sections from a prompt-sheet markdown document.
 * Parses `## <ID> — <name>` headings; each recognized fenced-block variant
 * (known model or neutral) becomes its own Shot tagged with `modelId`.
 * Delegates to {@link extractShotVariants} in prompt-sheet.js.
 * @param {string} markdown
 * @param {string} documentId
 * @param {string} projectName
 * @returns {Shot[]}
 */
export function extractShotFromMarkdown(markdown, documentId, projectName) {
  return extractShotVariants(markdown, documentId, projectName);
}

/**
 * Parse Refs line into array of @reference tokens.
 * Supports: `1 \`@lizard\` · 2 \`@plate\``, `@char1, @char2 and @prop1`, etc.
 * @param {string} refsText
 * @returns {string[]}
 */
export function parseRefs(refsText) {
  /** @type {string[]} */
  const refs = [];
  // Match @word tokens (backtick-wrapped or bare)
  const matches = refsText.match(/@([a-zA-Z0-9_-]+)/g);
  if (matches) {
    for (const m of matches) {
      const ref = m.startsWith('@') ? m : `@${m}`;
      if (!refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

/* ------------------------------------------------------------------ */
/* Prompt linking to document                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a Prompty prompt linked to a document shot.
 * The caller is responsible for setting the correct categoryId (project-named category).
 * When `id` is omitted a random id is generated; when provided (e.g. a stable
 * {@link stableShotId}) the prompt keeps the same id across re-saves.
 * @param {object} params
 * @param {string} params.shotId
 * @param {string} params.name
 * @param {string} params.prompt
 * @param {string[]} params.refs
 * @param {string} params.documentId
 * @param {string} params.projectName
 * @param {string} params.versionTag
 * @param {string} [params.modelId]
 * @param {string} [params.edit]
 * @param {string} [params.check]
 * @param {string|null} [params.categoryId]
 * @param {string} [params.id] stable id for document-linked prompts (re-save in place)
 * @returns {import('./storage.js').Prompt}
 */
export function linkPromptToDocument({
  shotId,
  name,
  prompt,
  refs,
  documentId,
  projectName,
  versionTag,
  modelId,
  edit,
  check,
  categoryId = null,
  id,
}) {
  /** @type {string[]} */
  const tags = [projectName, shotId, versionTag];
  if (modelId) tags.push(modelId);
  // Note: refs, edit, check are stored in the prompt's metadata via composition field
  // or could be added as custom fields; for now they're tracked via tags and the
  // MCP get_shot tool returns them from the document source.

  /** @type {import('./storage.js').Prompt['composition']} */
  const composition = {
    documentId,
    shotId,
    modelId,
    refs,
    edit,
    check,
    versionTag,
  };

  return {
    id: id ?? generateId(),
    title: `${shotId} — ${name}`,
    text: prompt,
    createdAt: Date.now(),
    useCount: 0,
    isFavorite: false,
    categoryId,
    tags,
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
    composition,
  };
}

/* ------------------------------------------------------------------ */
/* Storage readers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Read projects and documents from a storage area.
 * @param {{ get: Function }} area
 * @returns {Promise<{ projects: Project[], documents: Document[] }>}
 */
export async function readAll(area) {
  const store = area;
  const raw = await store.get(['projects', 'documents']);
  /** @type {unknown[]} */
  const rawProjects = Array.isArray(raw.projects) ? raw.projects : [];
  /** @type {unknown[]} */
  const rawDocuments = Array.isArray(raw.documents) ? raw.documents : [];

  /** @type {Project[]} */
  const projects = [];
  for (const item of rawProjects) {
    const normalized = normalizeProject(item);
    if (normalized) projects.push(normalized);
  }

  /** @type {Document[]} */
  const documents = [];
  for (const item of rawDocuments) {
    const normalized = normalizeDocument(item);
    if (normalized) documents.push(normalized);
  }

  return { projects, documents };
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function stringOr(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}