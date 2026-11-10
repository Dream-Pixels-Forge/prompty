/**
 * G11/G13 — import from another tool or a `.prompty` pack: read the file,
 * show what would happen (pack card + added/merged/skipped), import on
 * confirm with a 10 s undo. Used by Settings and by dropping a file on the popup.
 */
import { planMigration, readFile } from '../lib/migrate.js';
import { h } from './dom.js';
import { CATEGORY_COLORS } from './logic.js';
import { openModal, toast } from './modals.js';
import { save, state } from './store.js';

/** File picker filter for every importable format. */
export const IMPORT_ACCEPT =
  '.prompty,.json,.csv,.tsv,.txt,.md,application/json,text/csv,text/plain,text/markdown';

const FORMAT_LABEL = /** @type {Record<string, string>} */ ({
  pack: 'Prompty pack',
  envelope: 'Prompty / Higgsfield Prompt Saver export',
  'json-list': 'JSON list',
  csv: 'CSV',
  txt: 'text / Markdown',
});

/** @param {number} n */
const nPrompts = (n) => `${n} prompt${n === 1 ? '' : 's'}`;

/**
 * G11: read a file from another tool, show what would happen, import on confirm (10 s undo).
 * @param {File} file
 */
export async function migrateFrom(file) {
  const { format, candidates, pack, error } = readFile(file.name, await file.text());
  if (error) return toast(`${file.name}: ${error}`, 'error');
  if (format === 'unknown' || candidates.length === 0)
    return toast(`Nothing to import from ${file.name}.`, 'error');
  const plan = planMigration({ prompts: state.prompts, categories: state.categories }, candidates, {
    newId: () => crypto.randomUUID(),
    colors: CATEGORY_COLORS,
  });
  const { added, merged, skipped, categoriesAdded } = plan.report;
  /**
   * @param {string} label
   * @param {string[]} items
   */
  const bucket = (label, items) =>
    items.length
      ? h(
          'div',
          { class: 'migrate__bucket' },
          h('strong', null, `${label} (${items.length})`),
          h(
            'ul',
            null,
            items.slice(0, 5).map((t) => h('li', null, t)),
            items.length > 5 ? h('li', { class: 'muted' }, `…and ${items.length - 5} more`) : null,
          ),
        )
      : null;
  const nothing = added.length === 0 && merged.length === 0;
  const ok = await openModal({
    title: nothing
      ? 'Nothing new to import'
      : pack
        ? `Add the “${pack.name}” pack?`
        : `Import from ${file.name}?`,
    body: h(
      'div',
      { class: 'migrate' },
      pack
        ? h(
            'div',
            { class: 'pack-card' },
            h('span', { class: 'pack-card__icon', 'aria-hidden': 'true' }, '🎞'),
            h(
              'div',
              null,
              h('strong', { class: 'pack-card__name' }, pack.name),
              pack.author ? h('span', { class: 'muted' }, ` by ${pack.author}`) : null,
              pack.description ? h('p', { class: 'pack-card__desc' }, pack.description) : null,
            ),
          )
        : null,
      h(
        'p',
        { class: 'muted' },
        `Read as ${FORMAT_LABEL[format]}: ${nPrompts(candidates.length)}.`,
      ),
      bucket('Add', added),
      bucket('Merge tags/favorite into existing', merged),
      bucket(
        'Skip',
        skipped.map((s) => `${s.title} — ${s.reason}`),
      ),
      bucket('New categories', categoriesAdded),
    ),
    submitLabel: nothing ? 'OK' : `Import ${nPrompts(added.length)}`,
    onSubmit: () => true,
  });
  if (!ok || nothing) return;
  const before = { prompts: state.prompts, categories: state.categories };
  await save({ prompts: plan.prompts, categories: plan.categories });
  toast(
    `Imported ${nPrompts(added.length)}${merged.length ? `, merged ${merged.length}` : ''}${skipped.length ? `, skipped ${skipped.length}` : ''}.`,
    'info',
    { actionLabel: 'Undo', ms: 10_000, onAction: () => void save(before) },
  );
}
