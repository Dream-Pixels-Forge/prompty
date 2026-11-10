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
import browser from '../lib/browser.js';
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

/** Persist the draft soon (debounced) — and right away when the popup goes away. */
function persist() {
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    if (sequence) void browser.storage.local.set({ [DRAFT_KEY]: sequence });
  }, 400);
}
window.addEventListener('pagehide', () => {
  if (sequence) void browser.storage.local.set({ [DRAFT_KEY]: sequence });
});

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
    void browser.storage.local
      .get([DRAFT_KEY])
      .then((/** @type {Record<string, unknown>} */ raw) => {
        const draft = sequenceFrom(raw?.[DRAFT_KEY], newId);
        if (draft && rootEl === root) {
          sequence = draft;
          activeId = draft.shots[0].id;
          renderCompose(root);
        }
      });
  }
  const sq = seq();
  const current = shot();
  const c = current.composition;
  const multi = sq.shots.length > 1;

  // Keep focus and caret across re-renders.
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const focusKey = active?.dataset?.focusKey ?? null;
  const caret =
    active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;

  const preview = h('p', { class: 'compose__preview', 'aria-live': 'polite' });
  const stats = h('span', { class: 'muted' });
  const updatePreview = () => {
    const out = composeSequence(seq());
    mount(
      preview,
      out.text
        ? highlightVariables(out.text)
        : h('span', { class: 'muted' }, 'Pick or write a few blocks — the shot assembles here.'),
    );
    const vars = `${out.variables.length} variable${out.variables.length === 1 ? '' : 's'}`;
    if (seq().shots.length > 1) {
      stats.textContent = `${out.used} shot${out.used === 1 ? '' : 's'} · ${out.duration}s · ${vars}`;
    } else {
      const blocks = compose(shot().composition).used;
      stats.textContent = `${blocks} block${blocks === 1 ? '' : 's'} · ${vars}`;
    }
  };

  mount(
    root,
    h(
      'div',
      { class: 'view__head' },
      h('h1', { class: 'view__title' }, multi ? '✦ Compose a sequence' : '✦ Compose a shot'),
      h('span', { class: 'spacer' }),
      h(
        'div',
        { class: 'seg', role: 'radiogroup', 'aria-label': 'Join blocks with' },
        JOINERS.map((j) =>
          h(
            'button',
            {
              type: 'button',
              class: 'seg__btn',
              role: 'radio',
              'aria-checked': String(c.joiner === j),
              title: j === ', ' ? 'Join with commas' : 'Join as sentences',
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
        'Clear',
      ),
    ),
    h(
      'div',
      { class: 'compose__templates' },
      h('span', { class: 'field__label' }, 'Start from'),
      TEMPLATES.map((t) =>
        h(
          'button',
          {
            class: 'choice',
            type: 'button',
            on: {
              click: () => {
                const next = fromTemplate(t.id, state.prompts, newId);
                if (!next) return;
                suggestedTitle = t.name;
                setComposition(next);
                toast(`“${t.name}” loaded. Edit any block.`);
              },
            },
          },
          t.name,
        ),
      ),
      SEQUENCE_TEMPLATES.map((t) =>
        h(
          'button',
          {
            class: 'choice choice--seq',
            type: 'button',
            title: 'A whole sequence: replaces every shot',
            on: {
              click: () => {
                const next = fromSequenceTemplate(t.id, state.prompts, newId);
                if (!next) return;
                suggestedTitle = t.name;
                activeId = next.shots[0].id;
                setSequence(next);
                toast(`“${t.name}” loaded: ${next.shots.length} shots. {hero} is shared by all.`);
              },
            },
          },
          `🎬 ${t.name}`,
        ),
      ),
    ),
    shotStrip(sq, current),
    shotControls(sq, current),
    h(
      'ol',
      {
        class: 'compose__blocks',
        'aria-label': multi
          ? `Shot ${sq.shots.indexOf(current) + 1} blocks, in order`
          : 'Shot blocks, in order',
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
          'aria-label': 'Add a block',
          on: {
            change: (e) => {
              const select = /** @type {HTMLSelectElement} */ (e.target);
              if (!select.value) return;
              setComposition(addBlock(c, select.value, newId()));
            },
          },
        },
        h('option', { value: '' }, '+ Add block…'),
        SLOTS.map((s) => h('option', { value: s.id }, s.label)),
      ),
    ),
    h(
      'section',
      { class: 'compose__out' },
      h(
        'div',
        { class: 'view__head' },
        h('span', { class: 'field__label' }, multi ? 'Sequence' : 'Shot'),
        multi
          ? h(
              'div',
              { class: 'seg', role: 'radiogroup', 'aria-label': 'Write the sequence as' },
              FORMATS.map((f) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'seg__btn',
                    role: 'radio',
                    'aria-checked': String(sq.format === f.id),
                    title: f.hint,
                    on: { click: () => setSequence({ ...seq(), format: f.id }) },
                  },
                  f.label,
                ),
              ),
            )
          : null,
        h('span', { class: 'spacer' }),
        stats,
      ),
      preview,
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
          'Insert',
        ),
        h(
          'button',
          { class: 'btn btn--sm', type: 'button', on: { click: () => void deliver('append') } },
          'Append',
        ),
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            title: 'Ctrl+Enter',
            on: { click: () => void deliver('copy') },
          },
          'Copy',
        ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          { class: 'btn btn--sm', type: 'button', on: { click: () => void saveAsPrompt() } },
          'Save as prompt',
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
      ? `Pick a ${slot.label.toLowerCase()} prompt or write your own…`
      : `Describe the ${slot.label.toLowerCase()}…`,
    dataset: { focusKey: `${b.id}:text` },
    'aria-label': `${slot.label} text`,
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
      h(
        'span',
        { class: 'compose__grip', 'aria-hidden': 'true', title: 'Drag to reorder (or Alt+↑/↓)' },
        '⋮⋮',
      ),
      h('span', { class: 'compose__n' }, String(index + 1)),
      h(
        'select',
        {
          class: 'compose__slot',
          'aria-label': 'Block type',
          dataset: { focusKey: `${b.id}:slot` },
          on: {
            change: (e) =>
              setComposition(
                updateBlock(c, b.id, { slot: /** @type {HTMLSelectElement} */ (e.target).value }),
              ),
            keydown: onKey,
          },
        },
        SLOTS.map((s) => h('option', { value: s.id, selected: s.id === b.slot }, s.label)),
      ),
      options.length
        ? h(
            'select',
            {
              class: 'compose__pick',
              'aria-label': `${slot.label} prompt`,
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
                ? 'Custom (source deleted)'
                : 'Custom text',
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
          title: b.muted ? 'Unmute block' : 'Mute block (keep it, leave it out of the shot)',
          'aria-label': b.muted ? `Unmute ${slot.label}` : `Mute ${slot.label}`,
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
          title: 'Remove block',
          'aria-label': `Remove ${slot.label} block`,
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
  if (!out.text) return toast('The shot is empty — pick or write a block first.', 'error');
  let text = out.text;
  if (out.variables.length > 0) {
    const filled = await fillVariables(
      /** @type {any} */ ({
        id: 'composer',
        title: suggestedTitle || (seq().shots.length > 1 ? 'Composed sequence' : 'Composed shot'),
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
  if (!out.text) return toast('The shot is empty — nothing to save.', 'error');
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
  toast(`Saved “${draft.title.trim()}”. Reopen it here with 🎛 on its card.`);
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
    { class: 'shots', role: 'tablist', 'aria-label': 'Shots' },
    sq.shots.flatMap((s, i) => [
      i > 0
        ? h(
            'span',
            { class: 'shots__cut', title: CUTS.find((x) => x.id === sq.shots[i - 1].cut)?.label },
            cutGlyph(sq.shots[i - 1].cut),
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: `shots__tab${used.has(s.id) ? '' : ' shots__tab--empty'}`,
          role: 'tab',
          'aria-selected': String(s.id === current.id),
          tabindex: s.id === current.id ? '0' : '-1',
          title: used.has(s.id) ? `Shot ${i + 1}` : `Shot ${i + 1} (empty — left out)`,
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
    sq.shots.length < MAX_SHOTS
      ? h(
          'button',
          {
            type: 'button',
            class: 'shots__add',
            title: 'Add an empty shot after this one',
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
          '+ Shot',
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
      cut: 'cut',
      match: 'match',
      smash: 'smash',
      whip: 'whip',
      dissolve: 'dissolve',
      continuous: '∞',
    }[cut] ?? 'cut'
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
      h('span', null, 'Duration'),
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
          h('span', null, `Into shot ${index + 2}`),
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
              h('option', { value: cut.id, selected: cut.id === current.cut }, cut.label),
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
            title: 'Coverage: the same setup again, right after this shot',
            on: {
              click: () => {
                const next = duplicateShot(seq(), current.id, newId);
                activeId = next.shots[index + 1].id;
                setSequence(next);
              },
            },
          },
          'Duplicate',
        )
      : null,
    sq.shots.length > 1
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            title: 'Remove this shot',
            on: {
              click: () => {
                activeId = sq.shots[index === 0 ? 1 : index - 1].id;
                setSequence(removeShot(seq(), current.id));
              },
            },
          },
          'Remove shot',
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
