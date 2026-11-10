/**
 * Modal dialogs + toasts for the popup. Styled in-page dialogs only — no
 * window.prompt/confirm (SPEC §1 quirk fix). Each dialog resolves a promise;
 * Esc or the backdrop cancels (null), Ctrl/Cmd+Enter submits.
 */
import { localizeVarProblem, t, tn } from '../lib/i18n.js';
import { diffWords, sides } from '../lib/diff.js';
import {
  checkVariableValue,
  describeVariable,
  humanizeVar,
  parseVariables,
  randomInRange,
  recallValue,
  resolveVariables,
} from '../lib/variables.js';
import { h, mount } from './dom.js';
import { MAX_TITLE, orderedCategories, parseTags, validatePromptDraft } from './library.js';
import { CATEGORY_COLORS, CATEGORY_EMOJIS, relativeTime } from './logic.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('./library.js').PromptDraft} PromptDraft
 */

/** @type {HTMLElement|null} */
let toastHost = null;
let modalSeq = 0;

/**
 * Keep Tab / Shift+Tab inside an open dialog (it is aria-modal).
 * @param {KeyboardEvent} e
 * @param {HTMLElement} root
 */
export function trapTab(e, root) {
  const items = /** @type {HTMLElement[]} */ ([
    ...root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ]).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Bottom toast. Optional action button (e.g. Undo); auto-hides after `ms`.
 * @param {string} message
 * @param {'info'|'error'} [kind]
 * @param {{ actionLabel?: string, onAction?: () => void, ms?: number }} [opts]
 */
export function toast(message, kind = 'info', opts = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const item = h(
    'div',
    { class: `toast${kind === 'error' ? ' toast--error' : ''}` },
    h('span', null, kind === 'error' ? '✗ ' : '', message),
    opts.actionLabel
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            on: {
              click: () => {
                opts.onAction?.();
                item.remove();
              },
            },
          },
          opts.actionLabel,
        )
      : null,
  );
  toastHost.append(item);
  setTimeout(() => item.remove(), opts.ms ?? (kind === 'error' ? 6000 : 2500));
}

/**
 * Generic modal shell.
 * @template T
 * @param {{
 *   title: string,
 *   body: Node,
 *   submitLabel?: string,
 *   danger?: boolean,
 *   extra?: { label: string, value: T }[],
 *   onSubmit: () => T | null | undefined,
 *   wide?: boolean,
 * }} cfg onSubmit returns the resolved value, or null/undefined to keep the dialog open
 * @returns {Promise<T|null>}
 */
export function openModal(cfg) {
  return new Promise((resolve) => {
    const previousFocus = /** @type {HTMLElement|null} */ (document.activeElement);
    /** @param {T|null} value */
    const close = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      previousFocus?.focus?.();
      resolve(value);
    };
    const submit = () => {
      const value = cfg.onSubmit();
      if (value !== null && value !== undefined) close(value);
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        submit();
      } else if (e.key === 'Tab') {
        trapTab(e, dialog);
      }
    };
    const titleId = `modal-title-${++modalSeq}`;
    const dialog = h(
      'form',
      {
        class: `modal${cfg.wide ? ' modal--wide' : ''}`,
        on: {
          submit: (e) => {
            e.preventDefault();
            submit();
          },
        },
      },
      h('h2', { class: 'modal__title', id: titleId }, cfg.title),
      h('div', { class: 'modal__body' }, cfg.body),
      h(
        'div',
        { class: 'modal__actions' },
        h(
          'button',
          { class: 'btn btn--ghost', type: 'button', on: { click: () => close(null) } },
          t('cancel'),
        ),
        (cfg.extra ?? []).map((x) =>
          h(
            'button',
            { class: 'btn', type: 'button', on: { click: () => close(x.value) } },
            x.label,
          ),
        ),
        h(
          'button',
          { class: `btn ${cfg.danger ? 'btn--danger' : 'btn--primary'}`, type: 'submit' },
          cfg.submitLabel ?? t('save'),
        ),
      ),
    );
    const backdrop = h(
      'div',
      {
        class: 'backdrop',
        // The dialog role sits on the overlay: ARIA doesn't allow it on <form>.
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        on: {
          mousedown: (e) => {
            if (e.target === backdrop) close(null);
          },
        },
      },
      dialog,
    );
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    const first = /** @type {HTMLElement|null} */ (
      dialog.querySelector('input:not([type=checkbox]), textarea, select, button[type=submit]')
    );
    first?.focus();
  });
}

/**
 * @param {string} title
 * @param {string} message
 * @param {{ confirmLabel?: string, danger?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export async function confirmDialog(title, message, opts = {}) {
  const result = await openModal({
    title,
    body: h('p', { class: 'muted' }, message),
    submitLabel: opts.confirmLabel ?? 'OK',
    danger: opts.danger,
    onSubmit: () => true,
  });
  return result === true;
}

/**
 * @param {string} label
 * @param {HTMLElement} control
 * @param {HTMLElement} [error]
 */
function field(label, control, error) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label' }, label),
    control,
    error,
  );
}

/* ------------------------------------------------------------------ */
/* Variable fill-in (SPEC §1: all values required, live preview)       */
/* ------------------------------------------------------------------ */

/** Choices with at most this many options render as one-tap chips; more → a select. */
const CHIP_LIMIT = 6;

/**
 * Fill-in form (SPEC §1 + G6): text fields, choice chips/select, number +
 * 🎲 for ranges. Prefill: remembered value that still fits → default → empty.
 * @param {Prompt} prompt
 * @param {'insert'|'append'|'copy'} mode
 * @param {unknown} [memory] variableMemory from storage
 * @returns {Promise<{ text: string, values: Record<string, string> } | null>} null if cancelled
 */
export function fillVariables(prompt, mode, memory = {}) {
  const specs = parseVariables(prompt.text);
  /** @type {Record<string, { get: () => string, focus: () => void, error: HTMLElement }>} */
  const fields = {};
  const preview = h('p', { class: 'preview' });
  const values = () => {
    /** @type {Record<string, string>} */
    const out = {};
    for (const spec of specs) {
      const v = fields[spec.name].get().trim();
      if (v !== '') out[spec.name] = v;
    }
    return out;
  };
  const update = () => {
    preview.textContent = resolveVariables(prompt.text, values());
  };
  /** Enter moves to the next field; on the last one it submits (Ctrl/Cmd+Enter submits anywhere). */
  const nextOnEnter = (/** @type {number} */ i) => (/** @type {Event} */ e) => {
    const ke = /** @type {KeyboardEvent} */ (e);
    if (ke.key !== 'Enter' || ke.ctrlKey || ke.metaKey || i === specs.length - 1) return;
    ke.preventDefault();
    fields[specs[i + 1].name].focus();
  };

  const rows = specs.map((spec, i) => {
    const prefill = recallValue(memory, spec);
    const error = h('span', { class: 'field__error' });
    const label =
      spec.kind === 'range'
        ? `${humanizeVar(spec.name)} (${spec.min}–${spec.max})`
        : humanizeVar(spec.name);

    if (spec.kind === 'choice' && spec.options.length <= CHIP_LIMIT) {
      let current = prefill;
      const group = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label });
      const render = () =>
        mount(
          group,
          spec.options.map((option) =>
            h(
              'button',
              {
                type: 'button',
                class: 'choice',
                role: 'radio',
                'aria-checked': String(option === current),
                on: {
                  click: () => {
                    current = option;
                    error.textContent = '';
                    render();
                    update();
                    /** @type {HTMLElement|null} */ (
                      group.querySelector('[aria-checked="true"]')
                    )?.focus();
                  },
                  keydown: (e) => {
                    const ke = /** @type {KeyboardEvent} */ (e);
                    const k = ke.key;
                    if (k === 'Enter' && !ke.ctrlKey && !ke.metaKey) {
                      // Like a text field: Enter picks this chip, then moves on (or submits on the last field).
                      e.preventDefault();
                      current = option;
                      error.textContent = '';
                      render();
                      update();
                      if (i < specs.length - 1) fields[specs[i + 1].name].focus();
                      else
                        /** @type {HTMLFormElement|null} */ (
                          group.closest('form')
                        )?.requestSubmit();
                      return;
                    }
                    if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
                    e.preventDefault();
                    const at = Math.max(0, spec.options.indexOf(current));
                    const n = spec.options.length;
                    current = spec.options[(at + (k === 'ArrowRight' ? 1 : n - 1)) % n];
                    render();
                    update();
                    /** @type {HTMLElement|null} */ (
                      group.querySelector('[aria-checked="true"]')
                    )?.focus();
                  },
                },
              },
              option,
            ),
          ),
        );
      render();
      fields[spec.name] = {
        get: () => current,
        focus: () =>
          /** @type {HTMLElement|null} */ (
            group.querySelector('[aria-checked="true"]') || group.querySelector('button')
          )?.focus(),
        error,
      };
      return h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, label),
        group,
        error,
      );
    }

    if (spec.kind === 'choice') {
      const select = h(
        'select',
        { name: spec.name, on: { change: update, keydown: nextOnEnter(i) } },
        h('option', { value: '' }, t('choose')),
        spec.options.map((o) => h('option', { value: o, selected: o === prefill }, o)),
      );
      fields[spec.name] = { get: () => select.value, focus: () => select.focus(), error };
      return h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, label),
        select,
        error,
      );
    }

    if (spec.kind === 'range') {
      const input = h('input', {
        type: 'number',
        name: spec.name,
        min: String(spec.min),
        max: String(spec.max),
        step: '1',
        value: prefill,
        placeholder: `${spec.min}–${spec.max}`,
        on: { input: update, keydown: nextOnEnter(i) },
      });
      const dice = h(
        'button',
        {
          type: 'button',
          class: 'btn dice',
          title: t('random'),
          'aria-label': t('randomNamed', humanizeVar(spec.name)),
          on: {
            click: () => {
              input.value = String(randomInRange(spec));
              error.textContent = '';
              update();
              input.focus();
            },
          },
        },
        '🎲',
      );
      fields[spec.name] = { get: () => input.value, focus: () => input.focus(), error };
      return h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, label),
        h('div', { class: 'inline-form' }, input, dice),
        error,
      );
    }

    const input = h('input', {
      type: 'text',
      name: spec.name,
      autocomplete: 'off',
      value: prefill,
      placeholder: spec.kind === 'text' && spec.default ? spec.default : '',
      on: { input: update, keydown: nextOnEnter(i) },
    });
    fields[spec.name] = { get: () => input.value, focus: () => input.focus(), error };
    return field(label, input, error);
  });
  update();

  const verb = mode === 'copy' ? t('copy') : mode === 'append' ? t('append') : t('insert');
  const pending = openModal({
    title: prompt.title,
    body: h(
      'div',
      { class: 'stack' },
      rows,
      h('span', { class: 'field__label' }, t('preview')),
      preview,
    ),
    submitLabel: verb,
    onSubmit: () => {
      let first = null;
      for (const spec of specs) {
        const problem = checkVariableValue(spec, fields[spec.name].get());
        fields[spec.name].error.textContent = localizeVarProblem(problem);
        if (problem && !first) first = spec.name;
      }
      if (first) {
        fields[first].focus();
        return null;
      }
      const v = values();
      return { text: resolveVariables(prompt.text, v), values: v };
    },
  });
  // Start where input is needed: the first field without a prefilled value.
  queueMicrotask(() => {
    const needs = specs.find((spec) => fields[spec.name].get().trim() === '');
    if (needs) fields[needs.name].focus();
  });
  return pending;
}

/* ------------------------------------------------------------------ */
/* Prompt editor                                                       */
/* ------------------------------------------------------------------ */

/** Returned by {@link promptEditor} when the user asks for the version history. */
export const OPEN_HISTORY = 'open-history';

/**
 * @param {{ prompt?: Prompt, initial?: Partial<PromptDraft>, categories: Category[] }} opts
 * @returns {Promise<PromptDraft|typeof OPEN_HISTORY|null>}
 */
export function promptEditor({ prompt, initial = {}, categories }) {
  const start = { ...prompt, ...initial };
  const title = h('input', {
    type: 'text',
    maxlength: String(MAX_TITLE),
    value: start.title ?? '',
    placeholder: t('titlePlaceholder'),
  });
  const text = h('textarea', {
    rows: '7',
    value: start.text ?? '',
    placeholder: t('textPlaceholder'),
  });
  const varsHint = h('span', { class: 'field__hint' });
  const updateVars = () => {
    const vars = parseVariables(text.value);
    varsHint.textContent =
      vars.length > 0
        ? `⚡ ${tn('nVariablesList', vars.length, vars.map(describeVariable).join(', '))}`
        : t('variablesTip');
  };
  text.addEventListener('input', updateVars);
  updateVars();
  const category = h(
    'select',
    null,
    h('option', { value: '' }, t('noCategory')),
    orderedCategories(categories).map((c) =>
      h('option', { value: c.id, selected: c.id === start.categoryId }, `${c.icon} ${c.name}`),
    ),
  );
  const tags = h('input', {
    type: 'text',
    value: (start.tags ?? []).join(', '),
    placeholder: t('tagsInputPlaceholder'),
  });
  const favorite = h('input', { type: 'checkbox', checked: Boolean(start.isFavorite) });
  const titleError = h('span', { class: 'field__error' });
  const textError = h('span', { class: 'field__error' });

  return openModal({
    title: prompt ? t('editPrompt') : t('newPrompt'),
    wide: true,
    body: h(
      'div',
      { class: 'stack' },
      field(t('title'), title, titleError),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, t('prompt')),
        text,
        varsHint,
        textError,
      ),
      h('div', { class: 'row' }, field(t('category'), category), field(t('tags'), tags)),
      h('label', { class: 'check' }, favorite, ` ${t('favorite')}`),
    ),
    submitLabel: prompt ? t('save') : t('addPrompt'),
    // G5: jump to the version history (discards unsaved edits, like Cancel).
    extra: prompt?.versions?.length
      ? [
          {
            label: t('historyCount', prompt.versions.length),
            value: /** @type {any} */ (OPEN_HISTORY),
          },
        ]
      : [],
    onSubmit: () => {
      const draft = {
        title: title.value,
        text: text.value,
        categoryId: category.value || null,
        tags: parseTags(tags.value),
        isFavorite: favorite.checked,
      };
      const errors = validatePromptDraft(draft);
      titleError.textContent = errors.title ?? '';
      textError.textContent = errors.text ?? '';
      if (errors.title) title.focus();
      else if (errors.text) text.focus();
      return Object.keys(errors).length > 0 ? null : draft;
    },
  });
}

/* ------------------------------------------------------------------ */
/* Category editor (18 colors × 24 emoji, SPEC §1)                     */
/* ------------------------------------------------------------------ */

/**
 * @param {Category} [category]
 * @param {{ position: number, total: number }} [place] editing only: current 0-based slot
 * @returns {Promise<{ name: string, color: string, icon: string, position?: number } | null>}
 */
export function categoryEditor(category, place) {
  let color = category?.color ?? CATEGORY_COLORS[0];
  let icon = category?.icon ?? CATEGORY_EMOJIS[0];
  const name = h('input', {
    type: 'text',
    maxlength: '40',
    value: category?.name ?? '',
    placeholder: t('categoryName'),
  });
  const error = h('span', { class: 'field__error' });
  const colors = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('color') });
  const icons = h('div', {
    class: 'swatches swatches--emoji',
    role: 'radiogroup',
    'aria-label': t('icon'),
  });
  const render = () => {
    mount(
      colors,
      CATEGORY_COLORS.map((c) =>
        h('button', {
          type: 'button',
          class: 'swatch',
          role: 'radio',
          'aria-checked': String(c === color),
          'aria-label': c,
          style: { background: c },
          on: { click: () => ((color = c), render()) },
        }),
      ),
    );
    mount(
      icons,
      CATEGORY_EMOJIS.map((e) =>
        h(
          'button',
          {
            type: 'button',
            class: 'swatch swatch--emoji',
            role: 'radio',
            'aria-checked': String(e === icon),
            on: { click: () => ((icon = e), render()) },
          },
          e,
        ),
      ),
    );
  };
  render();
  // Keyboard-accessible reorder (drag-and-drop in the sidebar does the same).
  const position = place
    ? h(
        'select',
        null,
        Array.from({ length: place.total }, (_, i) =>
          h(
            'option',
            { value: String(i), selected: i === place.position },
            t('positionOf', i + 1, place.total),
          ),
        ),
      )
    : null;
  return openModal({
    title: category ? t('editCategory') : t('newCategory'),
    wide: true,
    body: h(
      'div',
      { class: 'stack' },
      position
        ? h('div', { class: 'row' }, field(t('name'), name, error), field(t('position'), position))
        : field(t('name'), name, error),
      field(t('color'), colors),
      field(t('icon'), icons),
    ),
    submitLabel: category ? t('save') : t('addCategory'),
    onSubmit: () => {
      if (name.value.trim() === '') {
        error.textContent = t('categoryNameRequired');
        name.focus();
        return null;
      }
      return {
        name: name.value.trim(),
        color,
        icon,
        ...(position ? { position: Number(position.value) } : {}),
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Version history (G5)                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {import('../lib/diff.js').DiffOp[]} ops
 * @returns {HTMLElement}
 */
function diffColumn(ops) {
  return h(
    'p',
    { class: 'diff' },
    ops.map((o) =>
      o.op === 'same'
        ? o.text
        : h(o.op === 'add' ? 'ins' : 'del', { class: `diff__${o.op}` }, o.text),
    ),
  );
}

/**
 * Version list + side-by-side compare (selected version → current).
 * Resolves to the index of the version to restore, or null.
 * @param {Prompt} prompt
 * @returns {Promise<number|null>}
 */
export function historyModal(prompt) {
  const versions = prompt.versions ?? [];
  let selected = 0;
  const list = h('ol', { class: 'history__list', role: 'listbox', 'aria-label': t('versions') });
  const compare = h('div', { class: 'history__compare' });
  const render = () => {
    mount(
      list,
      h(
        'li',
        { class: 'history__item history__item--current', 'aria-disabled': 'true' },
        h('strong', null, t('current')),
        h('span', { class: 'muted' }, prompt.title),
      ),
      versions.map((v, i) =>
        h(
          'li',
          {
            class: 'history__item',
            role: 'option',
            tabindex: '0',
            'aria-selected': String(i === selected),
            on: {
              click: () => ((selected = i), render()),
              keydown: (e) => {
                const k = /** @type {KeyboardEvent} */ (e).key;
                if (k === 'ArrowDown' || k === 'ArrowUp') {
                  e.preventDefault();
                  selected = Math.max(
                    0,
                    Math.min(versions.length - 1, selected + (k === 'ArrowDown' ? 1 : -1)),
                  );
                  render();
                  /** @type {HTMLElement|null} */ (
                    list.querySelector('[aria-selected="true"]')
                  )?.focus();
                }
              },
            },
          },
          h('strong', null, `v${versions.length - i} · ${relativeTime(v.editedAt)}`),
          h('span', { class: 'muted' }, v.text.replace(/\s+/g, ' ').slice(0, 60)),
        ),
      ),
    );
    const v = versions[selected];
    const { before, after } = sides(diffWords(v.text, prompt.text));
    mount(
      compare,
      v.title && v.title !== prompt.title
        ? h(
            'p',
            { class: 'history__title muted' },
            `${t('title')}: `,
            h('del', { class: 'diff__del' }, v.title),
            ' → ',
            h('ins', { class: 'diff__add' }, prompt.title),
          )
        : null,
      h(
        'div',
        { class: 'history__cols' },
        h(
          'section',
          null,
          h(
            'span',
            { class: 'field__label' },
            `v${versions.length - selected} · ${relativeTime(v.editedAt)}`,
          ),
          diffColumn(before),
        ),
        h('section', null, h('span', { class: 'field__label' }, t('current')), diffColumn(after)),
      ),
    );
  };
  render();
  return openModal({
    title: t('historyTitle', prompt.title),
    wide: true,
    body: h('div', { class: 'history' }, list, compare),
    submitLabel: t('restoreThisVersion'),
    onSubmit: () => selected,
  });
}
