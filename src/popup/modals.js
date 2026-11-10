/**
 * Modal dialogs + toasts for the popup. Styled in-page dialogs only — no
 * window.prompt/confirm (SPEC §1 quirk fix). Each dialog resolves a promise;
 * Esc or the backdrop cancels (null), Ctrl/Cmd+Enter submits.
 */
import { extractVariables, humanizeVar, resolveVariables } from '../lib/variables.js';
import { h, mount } from './dom.js';
import { MAX_TITLE, orderedCategories, parseTags, validatePromptDraft } from './library.js';
import { CATEGORY_COLORS, CATEGORY_EMOJIS } from './logic.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {import('../lib/storage.js').Category} Category
 * @typedef {import('./library.js').PromptDraft} PromptDraft
 */

/** @type {HTMLElement|null} */
let toastHost = null;

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
      }
    };
    const dialog = h(
      'form',
      {
        class: `modal${cfg.wide ? ' modal--wide' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': cfg.title,
        on: {
          submit: (e) => {
            e.preventDefault();
            submit();
          },
        },
      },
      h('h2', { class: 'modal__title' }, cfg.title),
      h('div', { class: 'modal__body' }, cfg.body),
      h(
        'div',
        { class: 'modal__actions' },
        h(
          'button',
          { class: 'btn btn--ghost', type: 'button', on: { click: () => close(null) } },
          'Cancel',
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
          cfg.submitLabel ?? 'Save',
        ),
      ),
    );
    const backdrop = h(
      'div',
      {
        class: 'backdrop',
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

/**
 * @param {Prompt} prompt
 * @param {'insert'|'append'|'copy'} mode
 * @returns {Promise<string|null>} resolved text, or null if cancelled
 */
export function fillVariables(prompt, mode) {
  const names = extractVariables(prompt.text);
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  const preview = h('p', { class: 'preview' });
  const error = h('p', { class: 'field__error' });
  const values = () => {
    /** @type {Record<string, string>} */
    const out = {};
    for (const name of names) if (inputs[name].value.trim() !== '') out[name] = inputs[name].value;
    return out;
  };
  const update = () => {
    preview.textContent = resolveVariables(prompt.text, values());
  };
  const fields = names.map((name) => {
    inputs[name] = h('input', {
      type: 'text',
      name,
      autocomplete: 'off',
      on: {
        input: update,
        keydown: (e) => {
          // Enter moves to the next field; on the last one it submits.
          const ke = /** @type {KeyboardEvent} */ (e);
          if (ke.key !== 'Enter' || ke.ctrlKey || ke.metaKey) return;
          const i = names.indexOf(name);
          if (i < names.length - 1) {
            ke.preventDefault();
            inputs[names[i + 1]].focus();
          }
        },
      },
    });
    return field(humanizeVar(name), inputs[name]);
  });
  update();
  const verb = mode === 'copy' ? 'Copy' : mode === 'append' ? 'Append' : 'Insert';
  return openModal({
    title: prompt.title,
    body: h(
      'div',
      { class: 'stack' },
      fields,
      h('span', { class: 'field__label' }, 'Preview'),
      preview,
      error,
    ),
    submitLabel: verb,
    onSubmit: () => {
      const v = values();
      const missing = names.filter((n) => !(n in v));
      if (missing.length > 0) {
        error.textContent = `Fill in: ${missing.map(humanizeVar).join(', ')}`;
        inputs[missing[0]].focus();
        return null;
      }
      return resolveVariables(prompt.text, v);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Prompt editor                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {{ prompt?: Prompt, initial?: Partial<PromptDraft>, categories: Category[] }} opts
 * @returns {Promise<PromptDraft|null>}
 */
export function promptEditor({ prompt, initial = {}, categories }) {
  const start = { ...prompt, ...initial };
  const title = h('input', {
    type: 'text',
    maxlength: String(MAX_TITLE),
    value: start.title ?? '',
    placeholder: 'e.g. Neon city portrait',
  });
  const text = h('textarea', {
    rows: '7',
    value: start.text ?? '',
    placeholder: 'Prompt text. Use {variable} for fill-in fields.',
  });
  const varsHint = h('span', { class: 'field__hint' });
  const updateVars = () => {
    const vars = extractVariables(text.value);
    varsHint.textContent =
      vars.length > 0
        ? `⚡ ${vars.length} variable${vars.length === 1 ? '' : 's'}: ${vars.join(', ')}`
        : 'Tip: {subject} becomes a fill-in field.';
  };
  text.addEventListener('input', updateVars);
  updateVars();
  const category = h(
    'select',
    null,
    h('option', { value: '' }, 'No category'),
    orderedCategories(categories).map((c) =>
      h('option', { value: c.id, selected: c.id === start.categoryId }, `${c.icon} ${c.name}`),
    ),
  );
  const tags = h('input', {
    type: 'text',
    value: (start.tags ?? []).join(', '),
    placeholder: 'comma, separated',
  });
  const favorite = h('input', { type: 'checkbox', checked: Boolean(start.isFavorite) });
  const titleError = h('span', { class: 'field__error' });
  const textError = h('span', { class: 'field__error' });

  return openModal({
    title: prompt ? 'Edit prompt' : 'New prompt',
    wide: true,
    body: h(
      'div',
      { class: 'stack' },
      field('Title', title, titleError),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Prompt'),
        text,
        varsHint,
        textError,
      ),
      h('div', { class: 'row' }, field('Category', category), field('Tags', tags)),
      h('label', { class: 'check' }, favorite, ' Favorite'),
    ),
    submitLabel: prompt ? 'Save' : 'Add prompt',
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
    placeholder: 'Category name',
  });
  const error = h('span', { class: 'field__error' });
  const colors = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' });
  const icons = h('div', {
    class: 'swatches swatches--emoji',
    role: 'radiogroup',
    'aria-label': 'Icon',
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
            `${i + 1} of ${place.total}`,
          ),
        ),
      )
    : null;
  return openModal({
    title: category ? 'Edit category' : 'New category',
    wide: true,
    body: h(
      'div',
      { class: 'stack' },
      position
        ? h('div', { class: 'row' }, field('Name', name, error), field('Position', position))
        : field('Name', name, error),
      field('Color', colors),
      field('Icon', icons),
    ),
    submitLabel: category ? 'Save' : 'Add category',
    onSubmit: () => {
      if (name.value.trim() === '') {
        error.textContent = 'Name the category.';
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
