/**
 * G7 — Local usage insights (pure). Computed only from fields Prompty already
 * stores (useCount, lastUsedAt, createdAt, categoryId, variableMemory); no new
 * tracking, no per-use timestamps.
 */

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 *
 * @typedef {object} Insights
 * @property {{ prompts: number, uses: number, favorites: number, categories: number }} totals
 * @property {Prompt[]} topPrompts most used first (useCount > 0)
 * @property {{ id: string|null, name: string, icon: string, uses: number, prompts: number }[]} topCategories
 * @property {Prompt[]} neverUsed
 * @property {Prompt[]} dormant used before, but not for DORMANT_DAYS
 * @property {{ key: string, label: string, added: number }[]} growth oldest month first
 * @property {{ name: string, value: string, usedAt: number }[]} variables most recent first
 */

export const DORMANT_DAYS = 90;
export const GROWTH_MONTHS = 6;
/** Prompts newer than this are not "never used" yet — they just arrived. */
export const GRACE_DAYS = 7;
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {{ prompts: Prompt[], categories: Category[], variableMemory?: unknown }} lib
 * @param {{ now?: number, top?: number }} [opts]
 * @returns {Insights}
 */
export function computeInsights(lib, { now = Date.now(), top = 5 } = {}) {
  const prompts = Array.isArray(lib.prompts) ? lib.prompts : [];
  const categories = Array.isArray(lib.categories) ? lib.categories : [];
  const uses = prompts.reduce((s, p) => s + Math.max(0, p.useCount || 0), 0);

  const topPrompts = prompts
    .filter((p) => p.useCount > 0)
    .sort((a, b) => b.useCount - a.useCount || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, top);

  /** @type {Map<string|null, { uses: number, prompts: number }>} */
  const byCat = new Map();
  for (const p of prompts) {
    const known = categories.some((c) => c.id === p.categoryId) ? p.categoryId : null;
    const e = byCat.get(known) ?? { uses: 0, prompts: 0 };
    e.uses += Math.max(0, p.useCount || 0);
    e.prompts += 1;
    byCat.set(known, e);
  }
  const topCategories = [...byCat]
    .filter(([, e]) => e.uses > 0)
    .map(([id, e]) => {
      const c = categories.find((x) => x.id === id);
      return { id, name: c?.name ?? 'Uncategorized', icon: c?.icon ?? '•', ...e };
    })
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
    .slice(0, top);

  const neverUsed = prompts
    .filter((p) => !(p.useCount > 0) && now - p.createdAt >= GRACE_DAYS * DAY)
    .sort((a, b) => a.createdAt - b.createdAt);
  const dormant = prompts
    .filter(
      (p) =>
        p.useCount > 0 &&
        typeof p.lastUsedAt === 'number' &&
        now - p.lastUsedAt >= DORMANT_DAYS * DAY,
    )
    .sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0));

  return {
    totals: {
      prompts: prompts.length,
      uses,
      favorites: prompts.filter((p) => p.isFavorite).length,
      categories: categories.length,
    },
    topPrompts,
    topCategories,
    neverUsed,
    dormant,
    growth: growthByMonth(prompts, now),
    variables: recentVariables(lib.variableMemory, top),
  };
}

/**
 * Prompts added per calendar month (local time), last GROWTH_MONTHS months.
 * @param {Prompt[]} prompts
 * @param {number} now
 */
export function growthByMonth(prompts, now) {
  const end = new Date(now);
  /** @type {{ key: string, label: string, added: number }[]} */
  const months = [];
  for (let i = GROWTH_MONTHS - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: MONTHS[d.getMonth()],
      added: 0,
    });
  }
  const index = new Map(months.map((m, i) => [m.key, i]));
  for (const p of prompts) {
    const d = new Date(p.createdAt);
    const at = index.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (at !== undefined) months[at].added += 1;
  }
  return months;
}

/**
 * Remembered fill-in values (G6), most recent first.
 * @param {unknown} memory
 * @param {number} limit
 */
export function recentVariables(memory, limit) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) return [];
  return Object.entries(/** @type {Record<string, any>} */ (memory))
    .filter(([, e]) => e && typeof e.value === 'string' && typeof e.usedAt === 'number')
    .map(([name, e]) => ({ name, value: e.value, usedAt: e.usedAt }))
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, limit);
}

/**
 * Bar length as a share of the largest value (0–1); never 0 for a non-zero value.
 * @param {number} value
 * @param {number} max
 */
export function barShare(value, max) {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(0.04, Math.min(1, value / max));
}
