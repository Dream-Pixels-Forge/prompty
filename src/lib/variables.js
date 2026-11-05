/**
 * Template-variable helpers (SPEC §1: regex, unique-in-order dedupe,
 * fill-in values; unresolved tokens stay literal).
 */

/** Tokens like {subject}: first char must be a letter or underscore. {2x}, {a-b} never match. */
const VARIABLE_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Extract unique variable names from prompt text, in first-appearance order.
 * @param {string|null} text
 * @returns {string[]}
 */
export function extractVariables(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  const seen = new Set();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Substitute provided values into {@link name; {x} tokens that have no provided value
 * remain literal.
 * @param {string} text
 * @param {Record<string, unknown>} values
 * @returns {string}
 */
export function resolveVariables(text, values) {
  if (typeof text !== 'string') return text;
  if (values === null || typeof values !== 'object') return text;
  let out = text;
  for (const name of extractVariables(text)) {
    if (hasOwn(values, name)) {
      // $& would corrupt replacements containing "$" — always replace via function.
      out = out.replaceAll(`{${name}}`, () => String(values[name]));
    }
  }
  return out;
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
    .replace(/([a-z0-9])([A-Z])/g, '$1 \u0000$2')
    .toLowerCase()
    .split(/[\s_\u0000]+/)
    .filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
