/**
 * G11/G13 — import from another tool or a `.prompty` pack: read the file,
 * show what would happen (pack card + added/merged/skipped), import on
 * confirm with a 10 s undo. Used by Settings and by dropping a file on the popup.
 */
import { t, tn } from '../lib/i18n.js';
import { planMigration, readFile } from '../lib/migrate.js';
import { h } from './dom.js';
import { CATEGORY_COLORS } from './logic.js';
import { openModal, toast } from './modals.js';
import { save, state } from './store.js';

/** File picker filter for every importable format. */
export const IMPORT_ACCEPT =
  '.prompty,.json,.csv,.tsv,.txt,.md,application/json,text/csv,text/plain,text/markdown';

const FORMAT_LABEL = /** @type {Record<string, string>} */ ({
  pack: t('fmtPack'),
  envelope: t('fmtEnvelope'),
  'json-list': t('fmtJsonList'),
  csv: 'CSV',
  txt: t('fmtTxt'),
});

/** @param {number} n */
const nPrompts = (n) => tn('nPrompts', n);

/** Skip reasons from lib/migrate.js → UI language. @param {string} r */
const reasonLabel = (r) =>
  ({
    empty: t('skipEmpty'),
    'too long': t('skipTooLong'),
    'duplicate in file': t('skipDuplicateInFile'),
    'already in library': t('skipAlreadyInLibrary'),
    invalid: t('skipInvalid'),
  })[r] ?? r;

/**
 * G11: read a file from another tool, show what would happen, import on confirm (10 s undo).
 * @param {File} file
 */
export async function migrateFrom(file) {
  const { format, candidates, pack, error } = readFile(file.name, await file.text());
  if (error) return toast(`${file.name}: ${error}`, 'error');
  if (format === 'unknown' || candidates.length === 0)
    return toast(t('nothingToImportFrom', file.name), 'error');
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
            items.length > 5 ? h('li', { class: 'muted' }, t('andNMore', items.length - 5)) : null,
          ),
        )
      : null;
  const nothing = added.length === 0 && merged.length === 0;
  const ok = await openModal({
    title: nothing
      ? t('nothingNew')
      : pack
        ? t('addPackTitle', pack.name)
        : t('importFromTitle', file.name),
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
              pack.author ? h('span', { class: 'muted' }, ` ${t('byAuthor', pack.author)}`) : null,
              pack.description ? h('p', { class: 'pack-card__desc' }, pack.description) : null,
            ),
          )
        : null,
      h('p', { class: 'muted' }, t('readAs', FORMAT_LABEL[format], nPrompts(candidates.length))),
      bucket(t('bucketAdd'), added),
      bucket(t('bucketMerge'), merged),
      bucket(
        t('bucketSkip'),
        skipped.map((s) => `${s.title} — ${reasonLabel(s.reason)}`),
      ),
      bucket(t('bucketNewCategories'), categoriesAdded),
    ),
    submitLabel: nothing ? t('ok') : t('importN', nPrompts(added.length)),
    onSubmit: () => true,
  });
  if (!ok || nothing) return;
  const before = { prompts: state.prompts, categories: state.categories };
  await save({ prompts: plan.prompts, categories: plan.categories });
  toast(
    // Joined in code: "$1$2$3" would read as a named placeholder to browser.i18n linters.
    `${t('importedSummary', nPrompts(added.length))}${merged.length ? t('mergedPart', merged.length) : ''}${skipped.length ? t('skippedPart', skipped.length) : ''}.`,
    'info',
    { actionLabel: t('undo'), ms: 10_000, onAction: () => void save(before) },
  );
}
