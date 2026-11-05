/**
 * Text join helper for the "Append" card action (SPEC §1: join `", "`).
 */

/**
 * Join trimmed existing + incoming texts with ", ".
 * Empty/blank/null existing → just the trimmed incoming.
 * @param {string|null|undefined} existing
 * @param {string|null|undefined} incoming
 * @returns {string}
 */
export function joinForAppend(existing, incoming) {
  const current = typeof existing === 'string' ? existing.trim() : '';
  const addition = typeof incoming === 'string' ? incoming.trim() : '';
  if (current.length === 0) return addition;
  if (addition.length === 0) return current;
  return `${current}, ${addition}`;
}
