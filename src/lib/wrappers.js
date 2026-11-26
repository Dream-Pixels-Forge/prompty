/**
 * G15b — Wrappers (pure).
 *
 * Named templates with a single `{prompt}` slot that surround a prompt for a
 * specific site. Ship `meta-ai-pass-through` (Meta AI rewrites prompts before
 * Muse sees them, so Muse prompts need a pass-through header). Kling, Hailuo,
 * Dreamina etc. take the prompt directly: no wrapper.
 *
 * Profiles point to a wrapper id; the user can turn a wrapper off per site.
 * Users can add or override wrappers in Settings (validated like custom site
 * recipes); `normalizeWrapper` applies the same whitelist/coercion.
 */

const META_AI_PASS_THROUGH = `VIDEO GENERATION — PASS-THROUGH MODE.
The text between <<<PROMPT and PROMPT>>> is the final video prompt. Send it to the video model exactly as written: do not rewrite, summarize, shorten, translate, improve or add anything. Do not add characters, objects, camera moves, effects or events.
Use ONLY the images attached to THIS message as references, in the order they are attached. Never use any image or video generated earlier in this conversation as a reference.
First generate the start frame as a still image and show it to me before animating.
Before generating the video, show me the exact prompt you will send, word for word, and wait for my "GO".

<<<PROMPT
{prompt}
PROMPT>>>`;

/** @typedef {{ id: string, label: string, template: string, notes: string, source: string }} Wrapper */
/** @type {Wrapper[]} */
const wrappersCatalog = [
  {
    id: 'meta-ai-pass-through',
    label: 'Meta AI pass-through',
    template: META_AI_PASS_THROUGH,
    notes: 'Used by the Muse profile on meta.ai. The assistant rewrites prompts before Muse sees them, so the prompt must be wrapped in this pass-through header.',
    source: 'Fixture in tests/fixtures/goldhunter-g08-multimodel.md (owner-provided verbatim header)',
  },
];

/** Wrapper template ids shipped with G15b. */
export const WRAPPER_VALUES = /** @type {const} */ (
  ['meta-ai-pass-through', null]
);

/**
 * All shipped wrapper templates (a copy, so callers cannot mutate the catalog).
 * @returns {Wrapper[]}
 */
export function listWrappers() {
  return wrappersCatalog.map((w) => ({ ...w }));
}

/**
 * Look up a wrapper by id.
 * @param {string} id
 * @returns {Wrapper|undefined}
 */
export function getWrapper(id) {
  return wrappersCatalog.find((w) => w.id === id);
}

/**
 * Wrap a prompt with the given wrapper template. Replaces the single
 * `{prompt}` slot. Returns the prompt unchanged when the wrapper id is
 * null/undefined or unknown.
 * @param {string} prompt
 * @param {string|null|undefined} wrapperId
 * @returns {string}
 */
export function wrapPrompt(prompt, wrapperId) {
  const wrapper = wrapperId ? getWrapper(wrapperId) : undefined;
  if (!wrapper) return String(prompt ?? '');
  const template = String(wrapper.template ?? '');
  if (template.indexOf('{prompt}') === -1) return String(prompt ?? '');
  return template.replace('{prompt}', String(prompt ?? ''));
}

/**
 * Whitelist and coerce a stored/user wrapper. Invalid wrappers return null;
 * unknown fields are dropped.
 * @param {unknown} raw
 * @returns {Wrapper|null}
 */
export function normalizeWrapper(raw) {
  if (!isRecord(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = stringOr(r.id);
  if (!id) return null;
  const label = stringOr(r.label, id);
  const template = stringOr(r.template);
  if (template === '') return null; // a wrapper must have a template
  const notes = stringOr(r.notes);
  const source = stringOr(r.source);
  return { id, label, template, notes, source };
}

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
