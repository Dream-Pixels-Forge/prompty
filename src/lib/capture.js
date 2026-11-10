/**
 * S1 — capture a page selection as a prompt (SPEC Δ5b: title = document
 * title, text = selection). Pure: no DOM, no extension API.
 */
import { normalizePrompt } from './storage.js';

/** @typedef {import('./storage.js').Prompt} Prompt */

/** Longest title we derive (popup editor allows 120; keep cards tidy). */
export const MAX_TITLE = 80;
/** Saving the same text again within this window is treated as a double trigger. */
export const DUPLICATE_WINDOW_MS = 10_000;

/**
 * Hostname tag for http(s) pages ("www." dropped); "" otherwise.
 * @param {string|undefined|null} url
 * @returns {string}
 */
export function siteTag(url) {
  if (typeof url !== 'string' || url === '') return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function shortTitle(value) {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

/**
 * Build a new prompt from a selection. Title: page title, else the
 * selection's first line. Tag: the site's hostname. Null for blank text.
 * @param {{ text: unknown, pageTitle?: string, url?: string, id: string, now?: number }} input
 * @returns {Prompt|null}
 */
export function promptFromSelection({ text, pageTitle = '', url = '', id, now = Date.now() }) {
  if (typeof text !== 'string') return null;
  const body = text.trim();
  if (body === '') return null;
  const firstLine = body.split('\n')[0] ?? body;
  const title = shortTitle(pageTitle) || shortTitle(firstLine);
  const tag = siteTag(url);
  return normalizePrompt({
    id,
    title,
    text: body,
    createdAt: now,
    useCount: 0,
    isFavorite: false,
    categoryId: null,
    tags: tag ? [tag] : [],
    aspectRatio: null,
    quality: null,
    lastUsedAt: null,
  });
}

/**
 * True when a prompt with the same (trimmed) text was created within
 * {@link DUPLICATE_WINDOW_MS} — e.g. the shortcut pressed twice.
 * @param {{ text: string, createdAt: number }[]} prompts
 * @param {string} text
 * @param {number} [now]
 * @returns {boolean}
 */
export function isRecentDuplicate(prompts, text, now = Date.now()) {
  const needle = String(text ?? '').trim();
  return prompts.some(
    (p) =>
      p.text.trim() === needle &&
      now - p.createdAt >= 0 &&
      now - p.createdAt <= DUPLICATE_WINDOW_MS,
  );
}

/**
 * Decide what a save gesture does — the background only performs the I/O.
 * @param {{ prompts: Prompt[], text: unknown, pageTitle?: string, url?: string, id: string, now?: number }} input
 * @returns {{ status: 'saved', prompt: Prompt } | { status: 'duplicate' } | { status: 'empty' }}
 */
export function planSave({ prompts, text, pageTitle, url, id, now = Date.now() }) {
  const prompt = promptFromSelection({ text, pageTitle, url, id, now });
  if (!prompt) return { status: 'empty' };
  if (isRecentDuplicate(prompts, prompt.text, now)) return { status: 'duplicate' };
  return { status: 'saved', prompt };
}
