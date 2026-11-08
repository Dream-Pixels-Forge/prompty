/**
 * Fuzzy subsequence matcher (a.k.a. "abbreviation" / "fuzzy" match).
 *
 * Query "pt" matches "prompt text", "portrait", "paint" — case-insensitive.
 * Score = subsequence match quality + optional recency boost.
 * Pure ES module — zero DOM, zero extension API.
 */

/**
 * Check if `query` is a subsequence of `target` (case-insensitive).
 * Returns the match score [0, 1] where 1 = perfect prefix match,
 * or null if not a subsequence.
 * @param {string} target
 * @param {string} query
 * @returns {number|null}
 */
export function subsequenceScore(target, query) {
  if (typeof target !== 'string' || typeof query !== 'string') return null;
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  if (q.length === 0) return 1;
  if (q.length > t.length) return null;

  let ti = 0;
  let qi = 0;
  let firstMatchIndex = -1;
  const matchIndices = [];

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (firstMatchIndex === -1) firstMatchIndex = ti;
      matchIndices.push(ti);
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return null; // not a subsequence

  // Score factors:
  // 1. Earlier first match is better
  // 2. More compact match (consecutive chars) is better
  // 3. Prefix match (starts at 0) gets bonus
  // 4. Shorter target relative to query gets slight bonus

  const spread = matchIndices[matchIndices.length - 1] - matchIndices[0] + 1;
  const compactness = q.length / spread; // 1.0 = perfectly consecutive
  const prefixBonus = firstMatchIndex === 0 ? 0.15 : 0;
  const positionPenalty = firstMatchIndex / t.length * 0.2; // max 0.2 penalty
  const lengthBonus = Math.min(q.length / t.length, 0.1); // slight bonus for shorter targets

  const score = compactness * 0.7 + (1 - positionPenalty) * 0.15 + prefixBonus + lengthBonus;
  return Math.min(1, Math.max(0, score));
}

/**
 * Extract matched character indices for highlighting.
 * Returns array of {start, end} ranges (inclusive start, exclusive end)
 * for consecutive matched characters in the target string.
 * @param {string} text
 * @param {string} query
 * @returns {{start: number, end: number}[]}
 */
export function extractMatches(text, query) {
  if (typeof text !== 'string' || typeof query !== 'string' || query.length === 0) return [];
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  const indices = [];
  let ti = 0;
  let qi = 0;

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return []; // not a subsequence

  // Group consecutive indices into ranges
  const ranges = [];
  let rangeStart = indices[0];
  let prev = indices[0];

  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === prev + 1) {
      prev = indices[i];
    } else {
      ranges.push({ start: rangeStart, end: prev + 1 });
      rangeStart = indices[i];
      prev = indices[i];
    }
  }
  ranges.push({ start: rangeStart, end: prev + 1 });

  return ranges;
}

/**
 * Fuzzy match items against a query with optional recency weighting.
 * @template T
 * @param {T[]} items - Array of items to search
 * @param {string} query - Search query
 * @param {Object} [options]
 * @param {(item: T) => string} options.keyFn - Function to extract searchable text from item
 * @param {(item: T) => number} [options.recencyFn] - Function to extract recency timestamp (higher = more recent)
 * @param {number} [options.maxResults=10] - Maximum results to return
 * @returns {Array<{item: T, score: number}>}
 */
export function fuzzyMatch(items, query, options) {
  /** @type { { keyFn: (item: T) => string, recencyFn?: (item: T) => number, maxResults?: number } } */
  const { keyFn, recencyFn, maxResults = 10 } = /** @type {any} */ (options ?? {});
  if (!Array.isArray(items) || typeof keyFn !== 'function') return [];

  const q = String(query ?? '').trim().toLowerCase();
  if (q.length === 0) {
    // No query: return recent-first if recencyFn provided, else original order
    const scored = items.map((item) => ({
      item,
      score: recencyFn ? (recencyFn(item) || 0) / 1e13 : 1, // normalize timestamp
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }

  const scored = [];
  const now = Date.now();

  for (const item of items) {
    const key = keyFn(item);
    if (typeof key !== 'string') continue;

    const subScore = subsequenceScore(key, q);
    if (subScore === null) continue;

    let recencyScore = 0;
    if (recencyFn) {
      const ts = recencyFn(item);
      if (typeof ts === 'number' && ts > 0) {
        // Normalize: recent items (within last 30 days) get up to 0.2 boost
        const ageMs = now - ts;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        recencyScore = Math.max(0, 0.2 * (1 - ageMs / thirtyDaysMs));
      }
    }

    const score = subScore + recencyScore;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}