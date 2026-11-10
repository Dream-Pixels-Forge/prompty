/**
 * G7 — Insights view. Small, readable charts drawn with HTML/CSS:
 * - ranked horizontal bars (most-used prompts, uses by category), one hue,
 *   value at the tip, 4px rounded data end, 2px gaps
 * - a 6-month column strip with values on the caps
 * - stat tiles
 * Every mark has a native hover title, and every row is a button, so the
 * charts double as their own table view. Metrics live in ./insights.js.
 */
import { barShare, computeInsights, DORMANT_DAYS } from './insights.js';
import { h, mount } from './dom.js';
import { relativeTime } from './logic.js';
import { state } from './store.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {{ editPrompt: (id: string) => void, goCategory: (id: string|null) => void, selectPrompts: (ids: string[]) => void }} InsightsHost
 */

/** @param {number} n @param {string} one */
const count = (n, one) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/**
 * @param {HTMLElement} root
 * @param {InsightsHost} host
 */
export function renderInsights(root, host) {
  const ins = computeInsights({
    prompts: state.prompts,
    categories: state.categories,
    variableMemory: state.variableMemory,
  });
  const head = h('div', { class: 'view__head' }, h('h1', { class: 'view__title' }, '▥ Insights'));
  if (ins.totals.prompts === 0) {
    mount(
      root,
      head,
      h('div', { class: 'empty' }, h('p', null, 'Add a few prompts and come back.')),
    );
    return;
  }

  const tiles = h(
    'div',
    { class: 'ins-tiles' },
    tile('Prompts', ins.totals.prompts),
    tile('Uses', ins.totals.uses),
    tile('Favorites', ins.totals.favorites),
    tile('Categories', ins.totals.categories),
  );

  const maxUse = ins.topPrompts[0]?.useCount ?? 0;
  const mostUsed = panel(
    'Most used',
    ins.topPrompts.length
      ? barList(
          ins.topPrompts.map((p) => ({
            label: p.title || 'Untitled',
            value: p.useCount,
            share: barShare(p.useCount, maxUse),
            title: `${p.title}: ${count(p.useCount, 'use')}, last ${relativeTime(p.lastUsedAt ?? p.createdAt)}`,
            onClick: () => host.editPrompt(p.id),
          })),
        )
      : h('p', { class: 'muted' }, 'Insert or copy a prompt and it shows up here.'),
  );

  const maxCat = ins.topCategories[0]?.uses ?? 0;
  const byCategory = panel(
    'Uses by category',
    ins.topCategories.length
      ? barList(
          ins.topCategories.map((c) => ({
            label: `${c.icon} ${c.name}`,
            value: c.uses,
            share: barShare(c.uses, maxCat),
            title: `${c.name}: ${count(c.uses, 'use')} across ${count(c.prompts, 'prompt')}`,
            onClick: () => host.goCategory(c.id),
          })),
        )
      : h('p', { class: 'muted' }, 'No uses yet.'),
  );

  const maxAdded = Math.max(0, ...ins.growth.map((m) => m.added));
  const growth = panel(
    'Added per month',
    h(
      'div',
      { class: 'ins-cols', role: 'list' },
      ins.growth.map((m) =>
        h(
          'div',
          {
            class: 'ins-col',
            role: 'listitem',
            title: `${m.label}: ${count(m.added, 'prompt')} added`,
          },
          h('span', { class: 'ins-col__value' }, String(m.added)),
          h(
            'span',
            { class: 'ins-col__track' },
            h('span', {
              class: 'ins-col__bar',
              style: { height: `${barShare(m.added, maxAdded) * 100}%` },
            }),
          ),
          h('span', { class: 'ins-col__label' }, m.label),
        ),
      ),
    ),
  );

  const attention = panel(
    'Needs a look',
    h(
      'div',
      { class: 'ins-attn' },
      attentionRow(
        'Never used',
        'Older than a week, never inserted or copied.',
        ins.neverUsed,
        host,
      ),
      attentionRow(
        `Dormant ${DORMANT_DAYS}+ days`,
        `Used before, but not in the last ${DORMANT_DAYS} days.`,
        ins.dormant,
        host,
      ),
    ),
  );

  const fills = panel(
    'Recent fill-ins',
    ins.variables.length
      ? h(
          'ul',
          { class: 'ins-vars' },
          ins.variables.map((v) =>
            h(
              'li',
              { title: `Last used ${relativeTime(v.usedAt)}` },
              h('code', null, `{${v.name}}`),
              ' ',
              h('span', null, v.value),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Values you type into {variables} appear here.'),
  );

  mount(
    root,
    head,
    tiles,
    h('div', { class: 'ins-grid' }, mostUsed, byCategory, growth, attention, fills),
  );
}

/** @param {string} label @param {number} value */
function tile(label, value) {
  return h(
    'div',
    { class: 'ins-tile' },
    h('span', { class: 'ins-tile__value' }, value.toLocaleString()),
    h('span', { class: 'ins-tile__label' }, label),
  );
}

/** @param {string} title @param {HTMLElement} body */
function panel(title, body) {
  return h('section', { class: 'ins-panel' }, h('h2', { class: 'ins-panel__title' }, title), body);
}

/**
 * @param {{ label: string, value: number, share: number, title: string, onClick: () => void }[]} rows
 */
function barList(rows) {
  return h(
    'ol',
    { class: 'ins-bars' },
    rows.map((r) =>
      h(
        'li',
        null,
        h(
          'button',
          { type: 'button', class: 'ins-bar', title: r.title, on: { click: r.onClick } },
          h('span', { class: 'ins-bar__label' }, r.label),
          h(
            'span',
            { class: 'ins-bar__track' },
            h('span', { class: 'ins-bar__fill', style: { width: `${r.share * 100}%` } }),
            h('span', { class: 'ins-bar__value' }, r.value.toLocaleString()),
          ),
        ),
      ),
    ),
  );
}

/**
 * @param {string} label
 * @param {string} hint
 * @param {Prompt[]} prompts
 * @param {InsightsHost} host
 */
function attentionRow(label, hint, prompts, host) {
  return h(
    'div',
    { class: 'ins-attn__row' },
    h(
      'div',
      null,
      h('strong', null, `${label} · ${prompts.length}`),
      h('span', { class: 'muted ins-attn__hint' }, hint),
      prompts.length
        ? h(
            'span',
            { class: 'ins-attn__sample' },
            prompts
              .slice(0, 3)
              .map((p) => p.title || 'Untitled')
              .join(' · ') + (prompts.length > 3 ? ' …' : ''),
          )
        : null,
    ),
    prompts.length
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn--sm',
            title: 'Select them in the library, then move, tag or delete in bulk',
            on: { click: () => host.selectPrompts(prompts.map((p) => p.id)) },
          },
          'Select these',
        )
      : null,
  );
}
