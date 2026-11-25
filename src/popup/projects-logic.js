import { t } from '../lib/i18n.js';

/**
 * Projects view logic — pure functions for sorting, filtering, and rendering.
 * No DOM, no extension API.
 */

/**
 * @typedef {import('../lib/documents.js').Project} Project
 * @typedef {import('../lib/documents.js').Document} Document
 */

/**
 * Sort projects by given criterion.
 * @param {Project[]} projects
 * @param {'order'|'name'|'created'} sortBy
 * @returns {Project[]}
 */
export function sortProjects(projects, sortBy) {
  const list = Array.isArray(projects) ? [...projects] : [];
  switch (sortBy) {
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt);
    case 'order':
    default:
      return list.sort((a, b) => a.order - b.order);
  }
}

/**
 * Filter projects by search query (case-insensitive, AND across terms).
 * Searches name and description.
 * @param {Project[]} projects
 * @param {string|null|undefined} query
 * @returns {Project[]}
 */
export function filterProjects(projects, query) {
  const haystack = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (haystack.length === 0) return Array.isArray(projects) ? [...projects] : [];
  return Array.isArray(projects) ? projects.filter((p) => {
    const name = String(p.name ?? '').toLowerCase();
    const description = String(p.description ?? '').toLowerCase();
    const combined = `${name} ${description}`;
    return haystack.every((term) => combined.includes(term));
  }) : [];
}

/**
 * Sort documents by given criterion.
 * @param {Document[]} documents
 * @param {'updated'|'name'|'kind'|'created'} sortBy
 * @returns {Document[]}
 */
export function sortDocuments(documents, sortBy) {
  const list = Array.isArray(documents) ? [...documents] : [];
  switch (sortBy) {
    case 'name':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'kind': {
      const kindOrder = { 'prompt-sheet': 0, screenplay: 1, 'project-card': 2, breakdown: 3, rules: 4, notes: 5 };
      return list.sort((a, b) => {
        const ka = kindOrder[a.kind] ?? 99;
        const kb = kindOrder[b.kind] ?? 99;
        if (ka !== kb) return ka - kb;
        return a.title.localeCompare(b.title);
      });
    }
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt);
    case 'updated':
    default:
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

/**
 * Filter documents by search query (case-insensitive, AND across terms).
 * Searches title and markdown content.
 * @param {Document[]} documents
 * @param {string|null|undefined} query
 * @returns {Document[]}
 */
export function filterDocuments(documents, query) {
  const haystack = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (haystack.length === 0) return Array.isArray(documents) ? [...documents] : [];
  return Array.isArray(documents) ? documents.filter((d) => {
    const title = String(d.title ?? '').toLowerCase();
    const markdown = String(d.markdown ?? '').toLowerCase();
    const combined = `${title} ${markdown}`;
    return haystack.every((term) => combined.includes(term));
  }) : [];
}

/**
 * Get kind label for display.
 * @param {Document['kind']} kind
 * @returns {string}
 */
export function kindLabel(kind) {
  const keys = {
    'prompt-sheet': 'kindPromptSheet',
    screenplay: 'kindScreenplay',
    'project-card': 'kindProjectCard',
    breakdown: 'kindBreakdown',
    rules: 'kindRules',
    notes: 'kindNotes',
  };
  return t(keys[kind] || 'kindNotes') || kind;
}

/**
 * Get kind icon for display.
 * @param {Document['kind']} kind
 * @returns {string}
 */
export function kindIcon(kind) {
  const icons = {
    'prompt-sheet': '📋',
    screenplay: '🎬',
    'project-card': '🃏',
    breakdown: '📐',
    rules: '📏',
    notes: '📝',
  };
  return icons[kind] || '📄';
}

/**
 * Format relative time for display.
 * @param {number} timestamp
 * @returns {string}
 */
export function formatRelative(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Extract plain text preview from markdown (first 200 chars, no formatting).
 * @param {string} markdown
 * @returns {string}
 */
export function markdownPreview(markdown) {
  if (!markdown) return '';
  return markdown
    .replace(/```[\s\S]*?```/g, '') // remove fenced code
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^>\s+/gm, '') // blockquotes
    .replace(/^[-*+]\s+/gm, '') // list markers
    .replace(/^\d+\.\s+/gm, '') // ordered list
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 200);
}