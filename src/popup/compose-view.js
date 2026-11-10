/**
 * G9 — Compose view: build a shot from film-grammar blocks.
 * G9b — …and a sequence of shots: a strip of shots, each with its duration
 * and the cut out of it, written as one multi-shot prompt.
 *
 * The sequence lives in memory while the popup is open (the source of
 * truth, so storage live-sync never reverts what you're typing) and is saved
 * to `composerDraft` so closing the popup doesn't lose it. Delivery reuses
 * the shared fill-in form and insert/copy pipeline (actions.js).
 */
import { t, tn } from '../lib/i18n.js';
import browser from '../lib/browser.js';
import { secureArea } from '../lib/secure.js';
import {
  JOINERS,
  SLOTS,
  TEMPLATES,
  addBlock,
  compose,
  emptyComposition,
  fromTemplate,
  moveBlock,
  pickPrompt,
  promptsForSlot,
  removeBlock,
  updateBlock,
} from '../lib/composition.js';
import {
  CUTS,
  FORMATS,
  lintSequence,
  rememberFormat,
  suggestFormat,
  MAX_DURATION,
  MAX_SHOTS,
  MIN_DURATION,
  SEQUENCE_TEMPLATES,
  addShot,
  composeSequence,
  duplicateShot,
  emptySequence,
  fromSequenceTemplate,
  moveShot,
  removeShot,
  sequenceFrom,
  setShotComposition,
  storedComposition,
  updateShot,
} from '../lib/sequence.js';
import { rememberValues } from '../lib/variables.js';
import { deliverText } from './actions.js';
import { h, mount } from './dom.js';
import { upsertPrompt } from './library.js';
import { fillVariables, promptEditor, toast, OPEN_HISTORY } from './modals.js';
import { save, state } from './store.js';

/**
 * @typedef {import('../lib/composition.js').Composition} Composition
 * @typedef {import('../lib/composition.js').Block} Block
 * @typedef {import('../lib/sequence.js').Sequence} Sequence
 * @typedef {import('../lib/sequence.js').Shot} Shot
 */

const DRAFT_KEY = 'composerDraft';

/** G8b: labels from lib/ (ids) shown in the UI language. */
const slotLabel = (/** @type {string} */ id) => t(`slot_${id}`);
const cutLabel = (/** @type {string} */ id) => t(`cut_${id}`);
const formatLabel = (/** @type {string} */ id) => t(`format_${id.replace(/-/g, '_')}`);
const tplName = (/** @type {{ id: string }} */ tpl) => t(`tpl_${tpl.id.replace(/-/g, '_')}`);
/** @param {{ key: string, args: (string|number)[] }} l */
const lintText = (l) =>
  l.key === 'lintMuseSoft'
    ? t(
        l.key,
        String(l.args[0])
          .split(',')
          .map((c) => cutLabel(c).toLowerCase())
          .join(', '),
      )
    : t(l.key, ...l.args);
/** G9c: origin → format the user wrote for on that site. */
const TARGETS_KEY = 'composerTargets';

/** Active tab's web origin ('' when not a web page) and remembered targets, loaded once. */
const site = { loaded: false, origin: '', remembered: /** @type {unknown} */ ({}) };

/** @param {HTMLElement} root */
function loadSite(root) {
  site.loaded = true;
  void Promise.all([
    browser.tabs.query({ active: true, currentWindow: true }).catch(() => []),
    browser.storage.local.get([TARGETS_KEY]).catch(() => ({})),
  ]).then(([tabs, raw]) => {
    const url = /** @type {{ url?: string }[]} */ (tabs)[0]?.url ?? '';
    const origin = /^https?:/.test(url) ? new URL(url).origin : '';
    site.origin = origin;
    site.remembered = /** @type {Record<string, unknown>} */ (raw)?.[TARGETS_KEY] ?? {};
    if (rootEl === root) renderCompose(root);
  });
}

/** Pick a format; on a web page, remember it for that site. @param {string} format */
function setFormat(format) {
  if (site.origin) {
    site.remembered = rememberFormat(site.remembered, site.origin, format);
    void browser.storage.local.set({ [TARGETS_KEY]: site.remembered });
  }
  setSequence({ ...seq(), format });
}

/** @param {string} origin */
const hostOf = (origin) => origin.replace(/^https?:\/\//, '');
const newId = () => crypto.randomUUID();

/** @type {Sequence|null} */
let sequence = null;
/** The shot being edited. */
let activeId = '';

const freshSequence = () => emptySequence(emptyComposition(newId), newId());

/** @returns {Sequence} */
function seq() {
  if (!sequence) sequence = freshSequence();
  if (!sequence.shots.some((s) => s.id === activeId)) activeId = sequence.shots[0].id;
  return sequence;
}

/** The active shot. @returns {Shot} */
function shot() {
  const s = seq();
  return /** @type {Shot} */ (s.shots.find((x) => x.id === activeId));
}

/** @param {Sequence} next */
function setSequence(next) {
  sequence = next;
  persist();
  if (rootEl) renderCompose(rootEl);
}
/** Title to suggest when saving (template name or the reopened prompt's title). */
let suggestedTitle = '';
let draftTimer = 0;
/** @type {HTMLElement|null} */
let rootEl = null;

/**
 * Write the draft now. Vault off: a direct storage.local.set, dispatched
 * synchronously, so it survives the popup closing. Vault on: it must be
 * encrypted first (async), which is why persist() writes at once then.
 */
function writeDraft() {
  if (!sequence) return;
  if (state.vault === 'off' || state.vault === 'unsupported')
    void browser.storage.local.set({ [DRAFT_KEY]: sequence });
  else
    void secureArea()
      .set({ [DRAFT_KEY]: sequence })
      .catch(() => {});
}

/** Persist the draft soon (debounced; immediately while the vault is on) — and on close. */
function persist() {
  clearTimeout(draftTimer);
  if (state.vault === 'unlocked') return writeDraft();
  draftTimer = window.setTimeout(writeDraft, 400);
}
window.addEventListener('pagehide', writeDraft);

/** Replace the active shot's blocks. @param {Composition} next */
function setComposition(next) {
  setSequence(setShotComposition(seq(), shot().id, next));
}

/**
 * Open a saved prompt's composition (G9 shot or G9b sequence) in the Composer.
 * @param {unknown} c
 * @param {string} [title]
 */
export function openComposition(c, title = '') {
  sequence = sequenceFrom(c, newId) ?? freshSequence();
  activeId = sequence.shots[0].id;
  suggestedTitle = title;
  persist();
}

/**
 * @param {HTMLElement} root
 */
export function renderCompose(root) {
  rootEl = root;
  if (!sequence) {
    // First open this session: restore the saved draft (G9 drafts open as one shot), then render.
    sequence = freshSequence();
    void secureArea()
      .get([DRAFT_KEY])
      .then((/** @type {Record<string, unknown>} */ raw) => {
        const draft = sequenceFrom(raw?.[DRAFT_KEY], newId);
        if (draft && rootEl === root) {
          sequence = draft;
          activeId = draft.shots[0].id;
          renderCompose(root);
        }
      })
      .catch(() => {}); // locked vault: start from a fresh draft
  }
  const sq = seq();
  const current = shot();
  const c = current.composition;
  const multi = sq.shots.length > 1;
  if (!site.loaded) loadSite(root);
  const suggested = multi ? suggestFormat(site.origin, site.remembered) : null;
  const suggestion =
    suggested && suggested !== sq.format
      ? h(
          'button',
          {
            type: 'button',
            class: 'choice choice--seq compose__suggest',
            title: t('rewriteInFormat'),
            on: { click: () => setFormat(suggested) },
          },
          t('suggestFormatOn', hostOf(site.origin), formatLabel(suggested)),
        )
      : null;
  const lint = h('ul', { class: 'compose__lint', 'aria-live': 'polite' });

  // Keep focus and caret across re-renders.
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const focusKey = active?.dataset?.focusKey ?? null;
  const caret =
    active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;

  // Scrollable, so it takes focus (keyboard scrolling); not live, or it would talk on every keystroke.
  const preview = h('p', {
    class: 'compose__preview',
    tabindex: '0',
    'aria-label': t('assembledPrompt'),
  });
  const stats = h('span', { class: 'muted' });
  const updatePreview = () => {
    mount(
      lint,
      lintSequence(seq()).map((l) =>
        h(
          'li',
          { class: `compose__lint--${l.level}` },
          l.level === 'warn' ? '⚠ ' : 'ℹ ',
          lintText(l),
        ),
      ),
    );
    const out = composeSequence(seq());
    mount(
      preview,
      out.text ? highlightVariables(out.text) : h('span', { class: 'muted' }, t('composeEmpty')),
    );
    const vars = tn('nVariables', out.variables.length);
    if (seq().shots.length > 1) {
      stats.textContent = `${tn('nShots', out.used)} · ${out.duration}s · ${vars}`;
    } else {
      const blocks = compose(shot().composition).used;
      stats.textContent = `${tn('nBlocks', blocks)} · ${vars}`;
    }
  };

  mount(
    root,
    h(
      'div',
      { class: 'view__head' },
      h('h1', { class: 'view__title' }, multi ? t('composeSequenceTitle') : t('composeShotTitle')),
      h('span', { class: 'spacer' }),
      h(
        'div',
        { class: 'seg', role: 'radiogroup', 'aria-label': t('joinBlocksWith') },
        JOINERS.map((j) =>
          h(
            'button',
            {
              type: 'button',
              class: 'seg__btn',
              role: 'radio',
              'aria-checked': String(c.joiner === j),
              title: j === ', ' ? t('joinCommas') : t('joinSentences'),
              on: { click: () => setComposition({ ...c, joiner: j }) },
            },
            j === ', ' ? 'a, b' : 'A. B.',
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          on: {
            click: () => {
              suggestedTitle = '';
              setSequence(freshSequence());
            },
          },
        },
        t('clear'),
      ),
    ),
    h(
      'div',
      { class: 'compose__templates' },
      h('span', { class: 'field__label' }, t('startFrom')),
      TEMPLATES.map((tpl) =>
        h(
          'button',
          {
            class: 'choice',
            type: 'button',
            on: {
              click: () => {
                const next = fromTemplate(tpl.id, state.prompts, newId);
                if (!next) return;
                suggestedTitle = tplName(tpl);
                setComposition(next);
                toast(t('templateLoaded', tplName(tpl)));
              },
            },
          },
          tplName(tpl),
        ),
      ),
      SEQUENCE_TEMPLATES.map((tpl) =>
        h(
          'button',
          {
            class: 'choice choice--seq',
            type: 'button',
            title: t('sequenceTemplateHint'),
            on: {
              click: () => {
                const next = fromSequenceTemplate(tpl.id, state.prompts, newId);
                if (!next) return;
                suggestedTitle = tplName(tpl);
                activeId = next.shots[0].id;
                setSequence(next);
                toast(t('sequenceTemplateLoaded', tplName(tpl), next.shots.length));
              },
            },
          },
          `🎬 ${tplName(tpl)}`,
        ),
      ),
    ),
    shotStrip(sq, current),
    shotControls(sq, current),
    h(
      'ol',
      {
        class: 'compose__blocks',
        'aria-label': multi ? t('shotBlocksN', sq.shots.indexOf(current) + 1) : t('shotBlocks'),
      },
      c.blocks.map((b, i) => blockRow(b, i, c, updatePreview)),
    ),
    h(
      'div',
      { class: 'inline-form compose__add' },
      h(
        'select',
        {
          class: 'select',
          'aria-label': t('addABlock'),
          on: {
            change: (e) => {
              const select = /** @type {HTMLSelectElement} */ (e.target);
              if (!select.value) return;
              setComposition(addBlock(c, select.value, newId()));
            },
          },
        },
        h('option', { value: '' }, t('addBlockOption')),
        SLOTS.map((s) => h('option', { value: s.id }, slotLabel(s.id))),
      ),
    ),
    h(
      'section',
      { class: 'compose__out' },
      h(
        'div',
        { class: 'view__head' },
        h('span', { class: 'field__label' }, multi ? t('sequence') : t('shot')),
        multi
          ? h(
              'label',
              { class: 'shot-controls__field' },
              h('span', null, t('writeFor')),
              h(
                'select',
                {
                  class: 'select compose__format',
                  dataset: { focusKey: 'format' },
                  title: FORMATS.find((f) => f.id === sq.format)?.hint,
                  on: {
                    change: (e) => setFormat(/** @type {HTMLSelectElement} */ (e.target).value),
                  },
                },
                [
                  ['any', t('anyModel')],
                  ['model', t('modelDialect')],
                ].map(([group, label]) =>
                  h(
                    'optgroup',
                    { label },
                    FORMATS.filter((f) => f.group === group).map((f) =>
                      h('option', { value: f.id, selected: f.id === sq.format }, formatLabel(f.id)),
                    ),
                  ),
                ),
              ),
            )
          : null,
        suggestion,
        h('span', { class: 'spacer' }),
        stats,
      ),
      preview,
      lint,
      h(
        'div',
        { class: 'card__actions' },
        h(
          'button',
          {
            class: 'btn btn--primary btn--sm',
            type: 'button',
            on: { click: () => void deliver('insert') },
          },
          t('insert'),
        ),
        h(
          'button',
          { class: 'btn btn--sm', type: 'button', on: { click: () => void deliver('append') } },
          t('append'),
        ),
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            title: 'Ctrl+Enter',
            on: { click: () => void deliver('copy') },
          },
          t('copy'),
        ),
        site.origin
          ? h(
              'span',
              { class: 'compose__target', title: t('targetHint') },
              `→ ${hostOf(site.origin)}`,
            )
          : null,
        h('span', { class: 'spacer' }),
        h(
          'button',
          { class: 'btn btn--sm', type: 'button', on: { click: () => void saveAsPrompt() } },
          t('saveAsPrompt'),
        ),
      ),
    ),
  );
  updatePreview();

  if (focusKey) {
    const el = /** @type {HTMLElement|null} */ (
      root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)
    );
    el?.focus();
    if (el instanceof HTMLTextAreaElement && caret) el.setSelectionRange(caret[0], caret[1]);
  }
}

/**
 * @param {Block} b
 * @param {number} index
 * @param {Composition} c
 * @param {() => void} updatePreview
 */
function blockRow(b, index, c, updatePreview) {
  const slot = SLOTS.find((s) => s.id === b.slot) ?? SLOTS[SLOTS.length - 1];
  const options = promptsForSlot(b.slot, state.prompts, state.categories);
  /** Alt+↑/↓ reorders from any control in the row. */
  const onKey = (/** @type {Event} */ e) => {
    const ke = /** @type {KeyboardEvent} */ (e);
    if (!ke.altKey || (ke.key !== 'ArrowUp' && ke.key !== 'ArrowDown')) return;
    e.preventDefault();
    setComposition(moveBlock(c, b.id, ke.key === 'ArrowUp' ? -1 : 1));
  };
  const text = h('textarea', {
    class: 'compose__text',
    rows: '2',
    value: b.text,
    placeholder: options.length
      ? t('pickSlotPrompt', slotLabel(slot.id).toLowerCase())
      : t('describeSlot', slotLabel(slot.id).toLowerCase()),
    dataset: { focusKey: `${b.id}:text` },
    'aria-label': t('slotText', slotLabel(slot.id)),
    on: {
      input: (e) => {
        // In-place edit: update the model + preview without re-rendering (keeps typing smooth).
        sequence = setShotComposition(
          seq(),
          shot().id,
          updateBlock(shot().composition, b.id, {
            text: /** @type {HTMLTextAreaElement} */ (e.target).value,
          }),
        );
        persist();
        updatePreview();
      },
      keydown: onKey,
    },
  });
  return h(
    'li',
    {
      class: `compose__block${b.muted ? ' compose__block--muted' : ''}`,
      draggable: 'true',
      dataset: { id: b.id },
      on: {
        dragstart: (e) =>
          /** @type {DragEvent} */ (e).dataTransfer?.setData('application/x-prompty-block', b.id),
        dragover: (e) => {
          if (
            /** @type {DragEvent} */ (e).dataTransfer?.types.includes('application/x-prompty-block')
          )
            e.preventDefault();
        },
        drop: (e) => {
          e.preventDefault();
          const from = /** @type {DragEvent} */ (e).dataTransfer?.getData(
            'application/x-prompty-block',
          );
          const cur = shot().composition;
          const a = cur.blocks.findIndex((x) => x.id === from);
          if (a !== -1 && a !== index)
            setComposition(moveBlock(cur, /** @type {string} */ (from), index - a));
        },
      },
    },
    h(
      'div',
      { class: 'compose__head' },
      h('span', { class: 'compose__grip', 'aria-hidden': 'true', title: t('dragToReorder') }, '⋮⋮'),
      h('span', { class: 'compose__n' }, String(index + 1)),
      h(
        'select',
        {
          class: 'compose__slot',
          'aria-label': t('blockType'),
          dataset: { focusKey: `${b.id}:slot` },
          on: {
            change: (e) =>
              setComposition(
                updateBlock(c, b.id, { slot: /** @type {HTMLSelectElement} */ (e.target).value }),
              ),
            keydown: onKey,
          },
        },
        SLOTS.map((s) => h('option', { value: s.id, selected: s.id === b.slot }, slotLabel(s.id))),
      ),
      options.length
        ? h(
            'select',
            {
              class: 'compose__pick',
              'aria-label': t('slotPrompt', slotLabel(slot.id)),
              dataset: { focusKey: `${b.id}:pick` },
              on: {
                change: (e) => {
                  const id = /** @type {HTMLSelectElement} */ (e.target).value;
                  setComposition(
                    pickPrompt(c, b.id, state.prompts.find((p) => p.id === id) ?? null),
                  );
                },
                keydown: onKey,
              },
            },
            h(
              'option',
              { value: '' },
              b.promptId && !options.some((p) => p.id === b.promptId)
                ? t('customSourceDeleted')
                : t('customText'),
            ),
            options.map((p) =>
              h('option', { value: p.id, selected: p.id === b.promptId }, p.title),
            ),
          )
        : h('span', { class: 'spacer' }),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-pressed': String(b.muted),
          title: b.muted ? t('unmuteBlock') : t('muteBlockHint'),
          'aria-label': b.muted
            ? t('unmuteNamed', slotLabel(slot.id))
            : t('muteNamed', slotLabel(slot.id)),
          dataset: { focusKey: `${b.id}:mute` },
          on: {
            click: () => setComposition(updateBlock(c, b.id, { muted: !b.muted })),
            keydown: onKey,
          },
        },
        b.muted ? '◌' : '●',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn icon-btn--danger',
          title: t('removeBlock'),
          'aria-label': t('removeNamedBlock', slotLabel(slot.id)),
          on: { click: () => setComposition(removeBlock(c, b.id)) },
        },
        '✕',
      ),
    ),
    text,
  );
}

/**
 * Show the assembled text with {variables} as orange pills.
 * @param {string} text
 * @returns {DocumentFragment}
 */
function highlightVariables(text) {
  const frag = document.createDocumentFragment();
  const re = /\{[a-zA-Z_][a-zA-Z0-9_]*(?::[^{}]*|=[^{}]*)?\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = /** @type {number} */ (m.index);
    if (at > last) frag.append(text.slice(last, at));
    frag.append(h('span', { class: 'compose__var' }, m[0]));
    last = at + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/**
 * Fill variables once across all blocks, then insert / append / copy.
 * @param {'insert'|'append'|'copy'} mode
 */
export async function deliver(mode) {
  const out = composeSequence(seq());
  if (!out.text) return toast(t('shotEmptyDeliver'), 'error');
  let text = out.text;
  if (out.variables.length > 0) {
    const filled = await fillVariables(
      /** @type {any} */ ({
        id: 'composer',
        title:
          suggestedTitle || (seq().shots.length > 1 ? t('composedSequence') : t('composedShot')),
        text,
      }),
      mode,
      state.variableMemory,
    );
    if (!filled) return;
    text = filled.text;
    await save({ variableMemory: rememberValues(state.variableMemory, filled.values) });
  }
  const ok = await deliverText(text, mode);
  if (ok && mode !== 'copy') window.close();
}

/** Save the assembled shot/sequence (variables kept as variables) with its blocks, so it can be reopened here. */
async function saveAsPrompt() {
  const sq = seq();
  const out = composeSequence(sq);
  if (!out.text) return toast(t('shotEmptySave'), 'error');
  const draft = await promptEditor({
    initial: {
      title: suggestedTitle,
      text: out.text,
      tags: sq.shots.length > 1 ? ['composed', 'sequence'] : ['composed'],
    },
    categories: state.categories,
  });
  if (!draft || draft === OPEN_HISTORY) return;
  const id = newId();
  const prompts = upsertPrompt(state.prompts, draft, { id }).map((p) =>
    p.id === id ? { ...p, composition: structuredClone(storedComposition(sq)) } : p,
  );
  await save({ prompts });
  toast(t('composedSaved', draft.title.trim()));
}

/* ------------------------------------------------------------------ */
/* G9b: shot strip + per-shot controls                                 */
/* ------------------------------------------------------------------ */

/** @param {string} id */
function focusShotTab(id) {
  /** @type {HTMLElement|null|undefined} */ (
    rootEl?.querySelector(`[data-focus-key="shot:${CSS.escape(id)}"]`)
  )?.focus();
}

/**
 * Tabs for the shots, with the cut between each pair. ←/→ move between
 * shots; Alt+←/→ moves the active shot earlier/later.
 * @param {Sequence} sq
 * @param {Shot} current
 */
function shotStrip(sq, current) {
  const used = new Set(composeSequenceIds(sq));
  return h(
    'div',
    { class: 'shots' },
    h(
      'div',
      { class: 'shots__list', role: 'tablist', 'aria-label': t('shots') },
      sq.shots.flatMap((s, i) => [
        i > 0
          ? h(
              'span',
              {
                class: 'shots__cut',
                'aria-hidden': 'true',
                title: cutLabel(sq.shots[i - 1].cut),
              },
              cutGlyph(sq.shots[i - 1].cut),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: `shots__tab${used.has(s.id) ? '' : ' shots__tab--empty'}`,
            role: 'tab',
            'aria-label': `${t('shotTabName', i + 1, s.duration)}${
              i > 0 ? t('shotTabAfter', cutLabel(sq.shots[i - 1].cut).toLowerCase()) : ''
            }${used.has(s.id) ? '' : t('shotTabEmpty')}`,
            'aria-selected': String(s.id === current.id),
            tabindex: s.id === current.id ? '0' : '-1',
            title: used.has(s.id) ? t('shotN', i + 1) : t('shotNEmpty', i + 1),
            dataset: { focusKey: `shot:${s.id}` },
            on: {
              click: () => {
                activeId = s.id;
                if (rootEl) renderCompose(rootEl);
                focusShotTab(s.id);
              },
              keydown: (e) => {
                const ke = /** @type {KeyboardEvent} */ (e);
                if (ke.key !== 'ArrowLeft' && ke.key !== 'ArrowRight') return;
                e.preventDefault();
                const delta = ke.key === 'ArrowLeft' ? -1 : 1;
                if (ke.altKey) {
                  setSequence(moveShot(seq(), s.id, delta));
                } else {
                  const list = seq().shots;
                  const next = list[Math.max(0, Math.min(list.length - 1, i + delta))];
                  activeId = next.id;
                  if (rootEl) renderCompose(rootEl);
                }
                focusShotTab(activeId);
              },
            },
          },
          h('strong', null, String(i + 1)),
          h('span', { class: 'shots__dur' }, `${s.duration}s`),
        ),
      ]),
    ),
    sq.shots.length < MAX_SHOTS
      ? h(
          'button',
          {
            type: 'button',
            class: 'shots__add',
            title: t('addShotHint'),
            on: {
              click: () => {
                const id = newId();
                const next = addShot(seq(), current.id, id, emptyComposition(newId));
                activeId = id; // after seq(): it resets an id that doesn't exist yet
                setSequence(next);
                focusShotTab(id);
              },
            },
          },
          t('addShot'),
        )
      : null,
  );
}

/** Ids of shots that contribute text. @param {Sequence} sq */
function composeSequenceIds(sq) {
  return sq.shots.filter((s) => compose(s.composition).text).map((s) => s.id);
}

/** Short label shown between two shot tabs. @param {string} cut */
function cutGlyph(cut) {
  return (
    {
      cut: t('cutShort_cut'),
      match: t('cutShort_match'),
      smash: t('cutShort_smash'),
      whip: t('cutShort_whip'),
      dissolve: t('cutShort_dissolve'),
      continuous: '∞',
    }[cut] ?? t('cutShort_cut')
  );
}

/**
 * Duration, the cut out of this shot, Duplicate, Remove.
 * @param {Sequence} sq
 * @param {Shot} current
 */
function shotControls(sq, current) {
  const index = sq.shots.indexOf(current);
  const last = index === sq.shots.length - 1;
  return h(
    'div',
    { class: 'shot-controls' },
    h(
      'label',
      { class: 'shot-controls__field' },
      h('span', null, t('duration')),
      h('input', {
        type: 'number',
        class: 'input shot-controls__num',
        min: String(MIN_DURATION),
        max: String(MAX_DURATION),
        value: String(current.duration),
        dataset: { focusKey: `${current.id}:duration` },
        on: {
          change: (e) =>
            setSequence(
              updateShot(seq(), current.id, {
                duration: /** @type {HTMLInputElement} */ (e.target).value,
              }),
            ),
        },
      }),
      h('span', { class: 'muted' }, 's'),
    ),
    !last
      ? h(
          'label',
          { class: 'shot-controls__field' },
          h('span', null, t('intoShot', index + 2)),
          h(
            'select',
            {
              class: 'select',
              dataset: { focusKey: `${current.id}:cut` },
              on: {
                change: (e) =>
                  setSequence(
                    updateShot(seq(), current.id, {
                      cut: /** @type {HTMLSelectElement} */ (e.target).value,
                    }),
                  ),
              },
            },
            CUTS.map((cut) =>
              h('option', { value: cut.id, selected: cut.id === current.cut }, cutLabel(cut.id)),
            ),
          ),
        )
      : null,
    h('span', { class: 'spacer' }),
    sq.shots.length < MAX_SHOTS
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            title: t('duplicateShotHint'),
            on: {
              click: () => {
                const next = duplicateShot(seq(), current.id, newId);
                activeId = next.shots[index + 1].id;
                setSequence(next);
              },
            },
          },
          t('duplicate'),
        )
      : null,
    sq.shots.length > 1
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            title: t('removeShotHint'),
            on: {
              click: () => {
                activeId = sq.shots[index === 0 ? 1 : index - 1].id;
                setSequence(removeShot(seq(), current.id));
              },
            },
          },
          t('removeShot'),
        )
      : null,
  );
}

/** Ctrl/Cmd+Enter copies the shot while the Compose view is open. */
export function onComposeKey(/** @type {KeyboardEvent} */ e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void deliver('copy');
  }
}
