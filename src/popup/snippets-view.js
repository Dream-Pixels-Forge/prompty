/**
 * Snippets tab (SPEC Δ5c/Δ5d): clipboard history, newest first. Search, insert/
 * append into the page, copy, save as prompt, delete, clear all.
 */
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
    h('h1', { class: 'view__title' }, 'Snippets'),
    h('span', { class: 'muted' }, `${state.snippets.length} of 50 kept`),
    h('span', { class: 'spacer' }),
    state.snippets.length > 0
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            on: {
              click: async () => {
                const ok = await confirmDialog(
                  'Clear all snippets?',
                  'Your saved prompts are not affected.',
                  {
                    confirmLabel: 'Clear',
                    danger: true,
                  },
                );
                if (ok) await save({ snippets: [] });
              },
            },
          },
          'Clear all',
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
        h(
          'p',
          null,
          query.trim()
            ? `No snippets match “${query.trim()}”.`
            : 'Text you copy with Prompty lands here, newest first.',
        ),
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
      : 'Copied in Prompty';
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
        'Insert',
      ),
      h(
        'button',
        { class: 'btn btn--sm', type: 'button', on: { click: () => void put('append') } },
        'Append',
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => void deliverText(snippet.text, 'copy') },
        },
        'Copy',
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => void host.newPrompt({ text: snippet.text }) },
        },
        'Save as prompt',
      ),
      h(
        'button',
        {
          class: 'icon-btn icon-btn--danger',
          type: 'button',
          title: 'Delete snippet',
          'aria-label': 'Delete snippet',
          on: {
            click: async () => {
              await save({ snippets: state.snippets.filter((s) => s.id !== snippet.id) });
              toast('Snippet deleted.');
            },
          },
        },
        '🗑',
      ),
    ),
  );
}
