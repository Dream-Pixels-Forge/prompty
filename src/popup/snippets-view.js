/**
 * Snippets tab (SPEC Δ5c/Δ5d): clipboard history, newest first. Search, insert/
 * append into the page, copy, save as prompt, delete, clear all.
 */
import { t } from '../lib/i18n.js';
import { deliverText } from './actions.js';
import { h, mount } from './dom.js';
import { filterPrompts } from './logic.js';
import { confirmDialog, toast } from './modals.js';
import { save, state } from './store.js';

/**
 * @typedef {import('../lib/storage.js').Snippet} Snippet
 * @typedef {{ newPrompt: (initial: { text: string, title?: string }) => Promise<boolean> }} SnippetHost
 */

/**
 * @param {HTMLElement} root
 * @param {string} query
 * @param {SnippetHost} host
 */
export function renderSnippets(root, query, host) {
  const newestFirst = [...state.snippets].reverse();
  const shown = filterPrompts(newestFirst, query);

  const header = h(
    'div',
    { class: 'view__head' },
    h('h1', { class: 'view__title' }, t('navSnippets')),
    h('span', { class: 'muted' }, t('snippetsKept', state.snippets.length, 50)),
    h('span', { class: 'spacer' }),
    state.snippets.length > 0
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            on: {
              click: async () => {
                const ok = await confirmDialog(t('clearSnippetsTitle'), t('clearSnippetsBody'), {
                  confirmLabel: t('clear'),
                  danger: true,
                });
                if (ok) await save({ snippets: [] });
              },
            },
          },
          t('clearAll'),
        )
      : null,
  );

  if (shown.length === 0) {
    mount(
      root,
      header,
      h(
        'div',
        { class: 'empty' },
        h('p', null, query.trim() ? t('noSnippetsMatch', query.trim()) : t('snippetsEmpty')),
      ),
    );
    return;
  }

  mount(
    root,
    header,
    h(
      'ul',
      { class: 'snippets' },
      shown.map((s) => row(s, host)),
    ),
  );
}

/**
 * @param {Snippet} snippet
 * @param {SnippetHost} host
 */
function row(snippet, host) {
  const origin =
    snippet.sourceOrigin && snippet.sourceOrigin !== 'prompty'
      ? snippet.sourceOrigin
      : t('copiedInPrompty');
  /** @param {'insert'|'append'} mode */
  const put = async (mode) => {
    if (await deliverText(snippet.text, mode)) window.close();
  };
  return h(
    'li',
    { class: 'snippet' },
    h('p', { class: 'snippet__text' }, snippet.text),
    h(
      'div',
      { class: 'snippet__foot' },
      h('span', { class: 'muted snippet__origin', title: origin }, origin),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn btn--primary btn--sm',
          type: 'button',
          on: { click: () => void put('insert') },
        },
        t('insert'),
      ),
      h(
        'button',
        { class: 'btn btn--sm', type: 'button', on: { click: () => void put('append') } },
        t('append'),
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => void deliverText(snippet.text, 'copy') },
        },
        t('copy'),
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => void host.newPrompt({ text: snippet.text }) },
        },
        t('saveAsPrompt'),
      ),
      h(
        'button',
        {
          class: 'icon-btn icon-btn--danger',
          type: 'button',
          title: t('deleteSnippet'),
          'aria-label': t('deleteSnippet'),
          on: {
            click: async () => {
              await save({ snippets: state.snippets.filter((s) => s.id !== snippet.id) });
              toast(t('snippetDeleted'));
            },
          },
        },
        '🗑',
      ),
    ),
  );
}
