/**
 * G15b — Multi-variant prompt-sheet extraction (pure, no DOM/API).
 *
 * A prompt-sheet markdown document holds one shot section per `## <ID> — <name>`
 * heading. Inside a section, each fenced code block whose info string is a known
 * model id (or empty = neutral variant) is a separate variant of the same shot:
 *
 *   ## G08 — Love, then greed
 *   ```muse
 *   … Muse variant …
 *   ```
 *   ```kling
 *   … Kling variant …
 *   ```
 *
 * Unknown info strings (e.g. `json`, `text`) are not shot variants.
 *
 * Each variant becomes its own Prompty prompt linked by
 * `{ documentId, shotId, modelId }`, tagged `<shotId>` + `<modelId>`.
 *
 * Prompt text is stored byte-for-byte (trimmed of the fence only) — never
 * rewritten (G15b anti-drift rule).
 */
import { getModel } from './models.js';

/** @typedef {import('./documents.js').Shot} Shot */

/**
 * Model info strings recognized as shot variants (G9c + G15b dialects).
 * @type {Set<string>}
 */
export const KNOWN_MODEL_VARIANTS = new Set([
  'muse',
  'seedance',
  'seedance-2.5',
  'kling',
  'minimax-hailuo',
  'veo',
  'runway',
  'wan',
  'luma',
  'higgsfield',
  'timecoded',
  'script',
  'one-take',
]);

/** Shot ids look like G01, G08, V12. */
const SHOT_HEADING = /^([A-Z]\d+)\s*(?:—\s*(.+))?/;

/** Fenced code block: ```info\ncontent\n``` */
const FENCED_BLOCK = /```([a-zA-Z0-9.-]*)\n([\s\S]*?)\n```/g;

/**
 * @typedef {object} ShotVariant
 * @property {string|null} modelId null for the neutral variant (no info string)
 * @property {string} prompt fenced content, byte-for-byte minus the fence
 */

/**
 * @param {string} section one `## ID — Name` section body
 * @returns {ShotVariant[]} one entry per recognized fenced block
 */
function parseSectionVariants(section) {
  /** @type {ShotVariant[]} */
  const variants = [];
  let match;
  FENCED_BLOCK.lastIndex = 0;
  while ((match = FENCED_BLOCK.exec(section)) !== null) {
    const info = String(match[1] ?? '').toLowerCase().trim();
    const content = String(match[2] ?? '').trimEnd();
    if (!info || KNOWN_MODEL_VARIANTS.has(info)) {
      variants.push({ modelId: info || null, prompt: content });
    }
  }
  return variants;
}

/**
 * @param {string} section
 * @returns {{ shotId: string, name: string, refs: string[], edit: string, check: string } | null}
 */
function parseSectionMeta(section) {
  const headingMatch = String(section ?? '').match(SHOT_HEADING);
  if (!headingMatch) return null;
  const remaining = String(section).slice(headingMatch[0].length);
  return {
    shotId: String(headingMatch[1]).trim(),
    name: String(headingMatch[2] ?? '').trim(),
    refs: parseRefs(remaining),
    edit: extractMetaLine(remaining, 'Edit') ?? '',
    check: extractMetaLine(remaining, 'CHECK') ?? '',
  };
}

/**
 * @param {string} text
 * @param {string} key 'Edit' | 'CHECK'
 * @returns {string|null}
 */
function extractMetaLine(text, key) {
  const pattern = '\\*\\*' + key + ':\\*\\*\\s*([\\s\\S]*?)(?:\\n\\*\\*|\\n```|\\n##|$)';
  const match = text.match(new RegExp(pattern));
  return match ? String(match[1]).trim() : null;
}

/**
 * Parse Refs line into array of @reference tokens.
 * @param {string} refsText
 * @returns {string[]}
 */
export function parseRefs(refsText) {
  /** @type {string[]} */
  const refs = [];
  const matches = String(refsText ?? '').match(/@([a-zA-Z0-9_-]+)/g);
  if (matches) {
    for (const m of matches) {
      const ref = m.startsWith('@') ? m : `@${m}`;
      if (!refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

/**
 * Extract every shot variant from a prompt-sheet markdown document.
 * One Shot per fenced-block variant (known model or neutral); sections with no
 * recognized variant yield nothing.
 * @param {string} markdown
 * @param {string} documentId
 * @param {string} projectName
 * @returns {Shot[]}
 */
export function extractShotVariants(markdown, documentId, projectName) {
  if (typeof markdown !== 'string') return [];
  /** @type {Shot[]} */
  const shots = [];
  const sections = String(markdown).split(/(?:^|\n)## /);
  for (let i = 1; i < sections.length; i++) {
    const meta = parseSectionMeta(sections[i]);
    if (!meta) continue;
    const variants = parseSectionVariants(sections[i]);
    if (variants.length === 0) continue;
    for (const v of variants) {
      shots.push({
        shotId: meta.shotId,
        name: meta.name,
        refs: meta.refs,
        prompt: v.prompt,
        modelId: v.modelId || undefined,
        edit: meta.edit,
        check: meta.check,
        documentId,
        projectName,
      });
    }
  }
  return shots;
}

/**
 * Deterministic id for a document-linked variant prompt, so re-saving the same
 * document updates the prompt in place (stable id) instead of duplicating it.
 * Derived from {documentId, shotId, modelId}; collisions are astronomically
 * unlikely for distinct inputs.
 * @param {string} documentId
 * @param {string} shotId
 * @param {string|null|undefined} modelId
 * @returns {string}
 */
export function stableShotId(documentId, shotId, modelId) {
  const source = `${String(documentId)}|${String(shotId)}|${String(modelId ?? '')}`;
  /** @type {number} */
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `shot-${Math.abs(h >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Check whether an info string is a recognized model variant (so unknown
 * strings such as `json` / `text` are excluded).
 * @param {string} info
 * @returns {boolean}
 */
export function isKnownModelVariant(info) {
  return KNOWN_MODEL_VARIANTS.has(String(info ?? '').toLowerCase().trim());
}

/**
 * Resolve a model profile for a variant, if one exists.
 * @param {string|null|undefined} modelId
 * @returns {Object|undefined}
 */
export function modelProfileForVariant(modelId) {
  if (!modelId) return undefined;
  return getModel(modelId);
}
