/**
 * Template-variable helpers (SPEC §1: unique-in-order names, fill-in values,
 * unresolved tokens stay literal) + G6 grammar:
 *
 *   {subject}               text
 *   {lens:24mm|50mm|85mm}   choice (≥ 2 distinct, non-empty options)
 *   {seed:1-999}            whole-number range (min < max, negatives allowed)
 *   {mood=melancholic}      text with a default
 *
 * Anything else in braces ({a:}, {a:5-1}, {a|b}, {2x}…) is plain text.
 *
 * The block between the <variable-grammar> markers is copied VERBATIM into
 * src/content/assist.js (content scripts can't import). tests/
 * variable-parity.test.mjs fails if the two copies ever differ.
 */

/* <variable-grammar> */
// Shared verbatim with src/content/assist.js — edit both or the parity test fails.
/**
 * @typedef {{ name: string, kind: 'text', default?: string }
 *   | { name: string, kind: 'choice', options: string[] }
 *   | { name: string, kind: 'range', min: number, max: number }} VariableSpec
 * @typedef {Record<string, { value: string, usedAt: number }>} VariableMemory
 */
const VAR_TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^{}]*)|=([^{}]*))?\}/g;
const VAR_MEMORY_CAP = 100;

/**
 * @param {unknown} obj
 * @param {string} key
 * @returns {boolean}
 */
function varHasOwn(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Spec for one token, or null when malformed (then it stays literal).
 * @param {string} name
 * @param {string|undefined} choiceOrRange text after ":" (undefined when absent)
 * @param {string|undefined} fallback text after "=" (undefined when absent)
 * @returns {VariableSpec|null}
 */
function varSpecOf(name, choiceOrRange, fallback) {
  if (choiceOrRange === undefined && fallback === undefined) return { name, kind: 'text' };
  if (fallback !== undefined) {
    const value = fallback.trim();
    return value === '' ? null : { name, kind: 'text', default: value };
  }
  const body = String(choiceOrRange);
  const range = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(body);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return min < max ? { name, kind: 'range', min, max } : null;
  }
  if (!body.includes('|')) return null;
  const options = body.split('|').map((o) => o.trim());
  if (options.length < 2 || options.some((o) => o === '')) return null;
  if (new Set(options).size !== options.length) return null;
  return { name, kind: 'choice', options };
}

/**
 * Unique variables in first-appearance order; the first valid occurrence of a
 * name defines its spec.
 * @param {unknown} text
 * @returns {VariableSpec[]}
 */
function varParse(text) {
  /** @type {VariableSpec[]} */
  const out = [];
  if (typeof text !== 'string') return out;
  const seen = new Set();
  for (const m of text.matchAll(VAR_TOKEN)) {
    const spec = varSpecOf(m[1], m[2], m[3]);
    if (!spec || seen.has(spec.name)) continue;
    seen.add(spec.name);
    out.push(spec);
  }
  return out;
}

/**
 * Replace every well-formed token whose name has a value; others stay as written.
 * @param {string} text
 * @param {Record<string, unknown>} values
 * @returns {string}
 */
function varResolve(text, values) {
  return text.replace(VAR_TOKEN, (whole, name, choiceOrRange, fallback) => {
    if (!varSpecOf(name, choiceOrRange, fallback)) return whole;
    return varHasOwn(values, name) ? String(values[name]) : whole;
  });
}

/**
 * '' when the value is acceptable for the spec, else a short reason.
 * @param {VariableSpec} spec
 * @param {unknown} value
 * @returns {string}
 */
function varCheck(spec, value) {
  const v = String(value ?? '').trim();
  if (v === '') return 'Fill in this field';
  if (spec.kind === 'choice' && !spec.options.includes(v)) return 'Pick one of the options';
  if (spec.kind === 'range') {
    const n = /^-?\d+$/.test(v) ? Number(v) : NaN;
    if (!(n >= spec.min && n <= spec.max)) return `Enter a whole number from ${spec.min} to ${spec.max}`;
  }
  return '';
}

/**
 * Uniform whole number within a range spec (inclusive).
 * @param {{ min: number, max: number }} spec
 * @param {() => number} [rand]
 * @returns {number}
 */
function varRandom(spec, rand = Math.random) {
  return spec.min + Math.floor(rand() * (spec.max - spec.min + 1));
}

/**
 * Store the latest values (non-blank) with recency; keep the newest VAR_MEMORY_CAP.
 * @param {unknown} memory
 * @param {Record<string, unknown>} values
 * @param {number} now
 * @returns {VariableMemory}
 */
function varRemember(memory, values, now) {
  /** @type {VariableMemory} */
  const next = {};
  if (memory !== null && typeof memory === 'object' && !Array.isArray(memory)) {
    for (const [name, entry] of Object.entries(memory)) {
      if (entry && typeof entry.value === 'string' && typeof entry.usedAt === 'number') {
        next[name] = { value: entry.value, usedAt: entry.usedAt };
      }
    }
  }
  for (const [name, raw] of Object.entries(values ?? {})) {
    const value = String(raw ?? '').trim();
    if (value !== '') next[name] = { value, usedAt: now };
  }
  const keep = Object.entries(next)
    .sort((a, b) => b[1].usedAt - a[1].usedAt)
    .slice(0, VAR_MEMORY_CAP);
  return Object.fromEntries(keep);
}

/**
 * Prefill for a field: a remembered value that still fits → the default → ''.
 * @param {unknown} memory
 * @param {VariableSpec} spec
 * @returns {string}
 */
function varRecall(memory, spec) {
  const entry = varHasOwn(memory, spec.name) ? /** @type {any} */ (memory)[spec.name] : null;
  if (entry && typeof entry.value === 'string' && varCheck(spec, entry.value) === '') return entry.value;
  return spec.kind === 'text' && spec.default ? spec.default : '';
}
/* </variable-grammar> */

/** @typedef {VariableSpec} ParsedVariable */

/** Remembered values kept (LRU). */
export const VARIABLE_MEMORY_CAP = VAR_MEMORY_CAP;

/**
 * Parse every well-formed variable (G6 grammar), first appearance wins.
 * @param {string|null} text
 * @returns {VariableSpec[]}
 */
export function parseVariables(text) {
  return varParse(text);
}

/**
 * Unique variable names in first-appearance order (all token forms).
 * @param {string|null} text
 * @returns {string[]}
 */
export function extractVariables(text) {
  return varParse(text).map((spec) => spec.name);
}

/**
 * Substitute provided values into every form of their tokens; tokens without a
 * provided value — and malformed ones — remain literal.
 * @param {string} text
 * @param {Record<string, unknown>} values
 * @returns {string}
 */
export function resolveVariables(text, values) {
  if (typeof text !== 'string') return text;
  if (values === null || typeof values !== 'object') return text;
  return varResolve(text, values);
}

/**
 * @param {VariableSpec} spec
 * @param {unknown} value
 * @returns {string} '' when valid, else a reason
 */
export function checkVariableValue(spec, value) {
  return varCheck(spec, value);
}

/**
 * @param {{ min: number, max: number }} spec
 * @param {() => number} [rand]
 * @returns {number}
 */
export function randomInRange(spec, rand) {
  return varRandom(spec, rand);
}

/**
 * @param {unknown} memory
 * @param {Record<string, unknown>} values
 * @param {number} [now]
 * @returns {VariableMemory}
 */
export function rememberValues(memory, values, now = Date.now()) {
  return varRemember(memory, values, now);
}

/**
 * @param {unknown} memory
 * @param {VariableSpec} spec
 * @returns {string}
 */
export function recallValue(memory, spec) {
  return varRecall(memory, spec);
}

/**
 * One-line summary for the editor hint.
 * @param {VariableSpec} spec
 * @returns {string}
 */
export function describeVariable(spec) {
  if (spec.kind === 'choice') return `${spec.name} · ${spec.options.length} choices`;
  if (spec.kind === 'range') return `${spec.name} · ${spec.min}–${spec.max}`;
  return spec.default ? `${spec.name} = ${spec.default}` : spec.name;
}

/**
 * Human-readable label for a variable name: snake_case / camelCase / UPPER → Title Case.
 * E.g. "background_light" → "Background Light", "keyLight" → "Key Light".
 * @param {string} name
 * @returns {string}
 */
export function humanizeVar(name) {
  if (typeof name !== 'string' || name.length === 0) return '';
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
