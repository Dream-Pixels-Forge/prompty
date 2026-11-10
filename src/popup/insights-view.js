/**
 * G7 — Insights view. Small, readable charts drawn with HTML/CSS:
 * - ranked horizontal bars (most-used prompts, uses by category), one hue,
 *   value at the tip, 4px rounded data end, 2px gaps
 * - a 6-month column strip with values on the caps
 * - stat tiles
 * Every mark has a native hover title, and every row is a button, so the
 * charts double as their own table view. Metrics live in ./insights.js.
 */
import { t, tn } from '../lib/i18n.js';
import { barShare, computeInsights, DORMANT_DAYS } from './insights.js';
import { h, mount } from './dom.js';
import { relativeTime } from './logic.js';
import { state } from './store.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {{ editPrompt: (id: string) => void, goCategory: (id: string|null) => void, selectPrompts: (ids: string[]) => void }} InsightsHost
 */

/** @param {number} n @param {string} one */
const count = (n, one) => tn(one, n);

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
  const head = h(
    'div',
    { class: 'view__head' },
    h('h1', { class: 'view__title' }, `▥ ${t('navInsights')}`),
  );
  if (ins.totals.prompts === 0) {
    mount(root, head, h('div', { class: 'empty' }, h('p', null, t('insEmptyLibrary'))));
    return;
  }

  const tiles = h(
    'div',
    { class: 'ins-tiles' },
    tile(t('tilePrompts'), ins.totals.prompts),
    tile(t('tileUses'), ins.totals.uses),
    tile(t('tileFavorites'), ins.totals.favorites),
    tile(t('tileCategories'), ins.totals.categories),
  );

  const maxUse = ins.topPrompts[0]?.useCount ?? 0;
  const mostUsed = panel(
    t('insMostUsed'),
    ins.topPrompts.length
      ? barList(
          ins.topPrompts.map((p) => ({
            label: p.title || t('untitled'),
            value: p.useCount,
            share: barShare(p.useCount, maxUse),
            title: t(
              'insPromptTip',
              p.title,
              count(p.useCount, 'nUses'),
              relativeTime(p.lastUsedAt ?? p.createdAt),
            ),
            onClick: () => host.editPrompt(p.id),
          })),
        )
      : h('p', { class: 'muted' }, t('insNoUsesPrompts')),
  );

  const maxCat = ins.topCategories[0]?.uses ?? 0;
  const byCategory = panel(
    t('insByCategory'),
    ins.topCategories.length
      ? barList(
          ins.topCategories.map((c) => ({
            label: `${c.icon} ${c.name}`,
            value: c.uses,
            share: barShare(c.uses, maxCat),
            title: t(
              'insCategoryTip',
              c.name,
              count(c.uses, 'nUses'),
              count(c.prompts, 'nPrompts'),
            ),
            onClick: () => host.goCategory(c.id),
          })),
        )
      : h('p', { class: 'muted' }, t('insNoUses')),
  );

  const maxAdded = Math.max(0, ...ins.growth.map((m) => m.added));
  const growth = panel(
    t('insAddedPerMonth'),
    h(
      'div',
      { class: 'ins-cols', role: 'list' },
      ins.growth.map((m) =>
        h(
          'div',
          {
            class: 'ins-col',
            role: 'listitem',
            title: t('insMonthTip', m.label, count(m.added, 'nPrompts')),
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
    t('insNeedsLook'),
    h(
      'div',
      { class: 'ins-attn' },
      attentionRow(t('insNeverUsed'), t('insNeverUsedHint'), ins.neverUsed, host),
      attentionRow(
        t('insDormant', DORMANT_DAYS),
        t('insDormantHint', DORMANT_DAYS),
        ins.dormant,
        host,
      ),
    ),
  );

  const fills = panel(
    t('insRecentFills'),
    ins.variables.length
      ? h(
          'ul',
          { class: 'ins-vars' },
          ins.variables.map((v) =>
            h(
              'li',
              { title: t('lastUsed', relativeTime(v.usedAt)) },
              h('code', null, `{${v.name}}`),
              ' ',
              h('span', null, v.value),
            ),
          ),
        )
      : h('p', { class: 'muted' }, t('insNoFills')),
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
              .map((p) => p.title || t('untitled'))
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
            title: t('selectTheseHint'),
            on: { click: () => host.selectPrompts(prompts.map((p) => p.id)) },
          },
          t('selectThese'),
        )
      : null,
  );
}
