// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Prompty MCP — template-variable reader.
 *
 * Mirrors the popup grammar so an agent can tell the user which blanks a
 * prompt has: `{subject}`, `{lens:24mm|50mm}`, `{seed:1-999}`, `{mood=neutral}`.
 * Tokens that do not parse are plain text and are not reported.
 */

const TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)(?::([^{}]*)|=([^{}]*))?\}/g;
const RANGE = /^(-?\d+)-(-?\d+)$/;

/**
 * @param {unknown} text
 * @returns {Array<{ name: string, kind: 'text', default?: string } | { name: string, kind: 'choice', options: string[] } | { name: string, kind: 'range', min: number, max: number }>}
 */
export function parseVariables(text) {
  if (typeof text !== 'string' || text === '') return [];

  /** @type {Array<{ name: string, kind: 'text', default?: string } | { name: string, kind: 'choice', options: string[] } | { name: string, kind: 'range', min: number, max: number }>} */
  const specs = [];
  const seen = new Set();

  for (const match of text.matchAll(TOKEN)) {
    const name = match[1];
    const choice = match[2];
    const fallback = match[3];
    if (seen.has(name)) continue;

    if (choice !== undefined) {
      const options = choice.split('|').map((option) => option.trim());
      if (
        options.length >= 2 &&
        options.every((option) => option !== '') &&
        new Set(options).size === options.length
      ) {
        specs.push({ name, kind: 'choice', options });
        seen.add(name);
        continue;
      }
      const range = RANGE.exec(choice.trim());
      if (range) {
        const min = Number(range[1]);
        const max = Number(range[2]);
        if (min < max) {
          specs.push({ name, kind: 'range', min, max });
          seen.add(name);
          continue;
        }
      }
      // `{a:}`, `{a:5-1}`, `{a:x|y|z}` with duplicates: plain text, not a variable.
      continue;
    }

    if (fallback !== undefined) {
      specs.push({ name, kind: 'text', ...(fallback !== '' ? { default: fallback } : {}) });
      seen.add(name);
      continue;
    }

    specs.push({ name, kind: 'text' });
    seen.add(name);
  }

  return specs;
}

/**
 * Short human summary for a tool result, e.g. "lens (24mm | 50mm), subject".
 * @param {ReturnType<typeof parseVariables>} specs
 */
export function describeVariables(specs) {
  return specs
    .map((spec) => {
      if (spec.kind === 'choice') return `${spec.name} (${spec.options.join(' | ')})`;
      if (spec.kind === 'range') return `${spec.name} (${spec.min}–${spec.max})`;
      return spec.default !== undefined ? `${spec.name} (=${spec.default})` : spec.name;
    })
    .join(', ');
}
