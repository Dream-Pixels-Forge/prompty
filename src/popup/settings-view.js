/**
 * Settings screen: general prefs, quick insert (G1), disabled sites (Δ2),
 * site recipes (G3 custom recipe editor), backup (export/import), about.
 */
import { t, tn } from '../lib/i18n.js';
import browser from '../lib/browser.js';
import { DEFAULT_SETTINGS } from '../lib/storage.js';
import { h, mount } from './dom.js';
import { normalizeSiteInput, removeRecipe, toggleRecipe, upsertRecipe } from './library.js';
import { applyImportData, parseImport, validateRecipeInput } from './logic.js';
import { IMPORT_ACCEPT, migrateFrom } from './import-ui.js';
import { vaultSection } from './vault-ui.js';
import { confirmDialog, openModal, toast } from './modals.js';
import { exportLibrary } from './palette-ui.js';
import { save, state } from './store.js';

/**
 * @typedef {import('../lib/storage.js').Settings} Settings
 * @typedef {import('../lib/storage.js').Recipe} Recipe
 */

/** @type {Recipe[]|null} */
let builtinRecipes = null;

/** @param {HTMLElement} root */
export function renderSettings(root) {
  const s = state.settings;
  if (builtinRecipes === null) {
    builtinRecipes = [];
    void fetch(browser.runtime.getURL('assets/recipes.json'))
      .then((r) => r.json())
      .then((list) => {
        builtinRecipes = Array.isArray(list) ? list : [];
        if (root.isConnected && root.querySelector('.settings')) renderSettings(root);
      })
      .catch(() => {});
  }

  mount(
    root,
    h('div', { class: 'view__head' }, h('h1', { class: 'view__title' }, t('navSettings'))),
    h(
      'div',
      { class: 'settings' },
      section(
        t('setGeneral'),
        null,
        selectRow(t('setOpenOn'), 'defaultView', [
          ['all', t('navAll')],
          ['favorites', t('navFavorites')],
          ['recent', t('navRecent')],
        ]),
        toggleRow(t('setCompact'), 'compactMode', t('setCompactHint')),
        toggleRow(t('setWidget'), 'showFloatingWidget', t('setWidgetHint')),
      ),
      section(
        t('setQuickInsert'),
        t('setQuickInsertDesc'),
        toggleRow(t('setQuickInsertEnable'), 'quickTriggerEnabled'),
        triggerRow(s),
      ),
      memorySection(),
      sitesSection(s),
      recipesSection(s),
      vaultSection(section, () => renderSettings(root)),
      backupSection(),
      section(
        t('setAbout'),
        null,
        h('p', { class: 'muted' }, t('setAboutText', browser.runtime.getManifest().version)),
      ),
    ),
  );
}

/**
 * @param {string} title
 * @param {string|null} description
 * @param {...(Node|null)} rows
 */
function section(title, description, ...rows) {
  return h(
    'section',
    { class: 'settings__section' },
    h('h2', { class: 'settings__title' }, title),
    description ? h('p', { class: 'muted settings__desc' }, description) : null,
    rows,
  );
}

/**
 * @param {string} label
 * @param {'compactMode'|'showFloatingWidget'|'quickTriggerEnabled'} key
 * @param {string} [hint]
 */
function toggleRow(label, key, hint) {
  return h(
    'label',
    { class: 'setting' },
    h(
      'span',
      { class: 'setting__text' },
      h('span', null, label),
      hint ? h('span', { class: 'muted setting__hint' }, hint) : null,
    ),
    h('input', {
      type: 'checkbox',
      class: 'switch',
      checked: state.settings[key],
      on: {
        change: (e) =>
          void save({ settings: { [key]: /** @type {HTMLInputElement} */ (e.target).checked } }),
      },
    }),
  );
}

/**
 * @param {string} label
 * @param {'defaultView'} key
 * @param {[string, string][]} options
 */
function selectRow(label, key, options) {
  return h(
    'label',
    { class: 'setting' },
    h('span', { class: 'setting__text' }, label),
    h(
      'select',
      {
        class: 'select',
        on: {
          change: (e) =>
            void save({
              settings: {
                [key]: /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value),
              },
            }),
        },
      },
      options.map(([value, text]) =>
        h('option', { value, selected: state.settings[key] === value }, text),
      ),
    ),
  );
}

/** @param {Settings} s */
function triggerRow(s) {
  const input = h('input', {
    type: 'text',
    class: 'input input--char',
    maxlength: '1',
    value: s.quickTrigger,
    'aria-label': t('setTrigger'),
    disabled: !s.quickTriggerEnabled,
  });
  input.addEventListener('change', () => {
    const value = input.value;
    if (value.length !== 1 || value.trim() === '') {
      toast(t('setTriggerInvalid'), 'error');
      input.value = state.settings.quickTrigger;
      return;
    }
    void save({ settings: { quickTrigger: value } });
    toast(t('setTriggerSaved', value));
  });
  return h(
    'label',
    { class: 'setting' },
    h(
      'span',
      { class: 'setting__text' },
      h('span', null, t('setTrigger')),
      h(
        'span',
        { class: 'muted setting__hint' },
        t('setTriggerDefault', DEFAULT_SETTINGS.quickTrigger),
      ),
    ),
    input,
  );
}

/* ------------------------------------------------------------------ */
/* Fill-in memory (G6)                                                 */
/* ------------------------------------------------------------------ */

function memorySection() {
  const count = Object.keys(state.variableMemory).length;
  return section(
    t('setMemory'),
    t('setMemoryDesc'),
    h(
      'div',
      { class: 'setting' },
      h(
        'span',
        { class: 'setting__text' },
        count === 0 ? t('setMemoryNone') : tn('setMemoryCount', count),
      ),
      h(
        'button',
        {
          class: 'btn btn--sm',
          type: 'button',
          disabled: count === 0,
          on: {
            click: async () => {
              await save({ variableMemory: {} });
              toast(t('setMemoryCleared'));
            },
          },
        },
        t('setMemoryForget'),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Disabled sites                                                      */
/* ------------------------------------------------------------------ */

/** @param {Settings} s */
function sitesSection(s) {
  const input = h('input', {
    type: 'text',
    class: 'input',
    placeholder: 'example.com',
    'aria-label': t('setSiteToDisable'),
  });
  const add = () => {
    const origin = normalizeSiteInput(input.value);
    if (!origin) return toast(t('setSiteInvalid'), 'error');
    if (s.disabledSites.includes(origin)) return toast(t('setSiteAlreadyOff', origin));
    void save({ settings: { disabledSites: [...s.disabledSites, origin] } });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  return section(
    t('setSitesOff'),
    t('setSitesOffDesc'),
    s.disabledSites.length === 0
      ? h('p', { class: 'muted' }, t('setSitesNone'))
      : h(
          'ul',
          { class: 'list' },
          s.disabledSites.map((origin) =>
            h(
              'li',
              { class: 'list__row' },
              h('span', { class: 'mono' }, origin),
              h(
                'button',
                {
                  class: 'btn btn--ghost btn--sm',
                  type: 'button',
                  on: {
                    click: () =>
                      void save({
                        settings: { disabledSites: s.disabledSites.filter((o) => o !== origin) },
                      }),
                  },
                },
                t('setTurnBackOn'),
              ),
            ),
          ),
        ),
    h(
      'div',
      { class: 'inline-form' },
      input,
      h('button', { class: 'btn', type: 'button', on: { click: add } }, t('turnOff')),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Site recipes                                                        */
/* ------------------------------------------------------------------ */

/** @param {Settings} s */
function recipesSection(s) {
  const enabled = new Set(s.enabledRecipes);
  return section(
    t('setRecipes'),
    t('setRecipesDesc'),
    h('h3', { class: 'settings__sub' }, t('setYourRecipes')),
    s.siteRecipes.length === 0
      ? h('p', { class: 'muted' }, t('noneYet'))
      : h(
          'ul',
          { class: 'list' },
          s.siteRecipes.map((r) =>
            h(
              'li',
              { class: 'list__row' },
              h(
                'span',
                { class: 'list__main' },
                h('span', { class: 'mono' }, r.originPattern),
                r.notes ? h('span', { class: 'muted' }, r.notes) : null,
              ),
              h('input', {
                type: 'checkbox',
                class: 'switch',
                checked: enabled.has(r.originPattern),
                'aria-label': t('setUseRecipe', r.originPattern),
                on: {
                  change: () =>
                    void save({ settings: toggleRecipe(state.settings, r.originPattern) }),
                },
              }),
              h(
                'button',
                {
                  class: 'btn btn--ghost btn--sm',
                  type: 'button',
                  on: { click: () => void editRecipe(r) },
                },
                t('edit'),
              ),
              h(
                'button',
                {
                  class: 'icon-btn icon-btn--danger',
                  type: 'button',
                  'aria-label': t('setDeleteRecipe', r.originPattern),
                  on: {
                    click: () =>
                      void save({ settings: removeRecipe(state.settings, r.originPattern) }),
                  },
                },
                '🗑',
              ),
            ),
          ),
        ),
    h(
      'button',
      { class: 'btn', type: 'button', on: { click: () => void editRecipe() } },
      t('setAddRecipe'),
    ),
    h('h3', { class: 'settings__sub' }, t('setBuiltIn')),
    h(
      'ul',
      { class: 'list' },
      (builtinRecipes ?? []).map((r) =>
        h(
          'li',
          { class: 'list__row' },
          h(
            'span',
            { class: 'list__main' },
            h('span', { class: 'mono' }, r.originPattern),
            r.notes ? h('span', { class: 'muted' }, r.notes) : null,
          ),
          h(
            'button',
            {
              class: 'btn btn--ghost btn--sm',
              type: 'button',
              on: { click: () => void editRecipe(r, true) },
            },
            t('setCustomize'),
          ),
        ),
      ),
    ),
  );
}

const RECIPE_TEMPLATE = {
  originPattern: 'example.com/*',
  promptInput: ['textarea'],
  submit: ['button[type="submit"]'],
  selects: { aspect: 'select[name="aspect"]', quality: 'select[name="quality"]' },
  qualityValues: ['standard', 'hd'],
  notes: 'What this recipe is for',
};

/**
 * @param {Recipe} [recipe]
 * @param {boolean} [fromBuiltin] copy a built-in as the starting point
 */
async function editRecipe(recipe, fromBuiltin = false) {
  const text = h('textarea', {
    class: 'mono',
    rows: '14',
    spellcheck: 'false',
    value: JSON.stringify(recipe ?? RECIPE_TEMPLATE, null, 2),
  });
  const errors = h('ul', { class: 'field__error' });
  const result = await openModal({
    title: recipe && !fromBuiltin ? t('setEditRecipe') : t('setNewRecipe'),
    wide: true,
    body: h(
      'div',
      { class: 'stack' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, t('setRecipeJson')),
        text,
      ),
      errors,
    ),
    submitLabel: t('setSaveRecipe'),
    onSubmit: () => {
      const check = validateRecipeInput(text.value);
      mount(
        errors,
        check.errors.map((e) => h('li', null, e)),
      );
      return check.ok ? check.recipe : null;
    },
  });
  if (!result) return;
  /** @type {{ siteRecipes: Recipe[], enabledRecipes: string[] }} */
  let next = upsertRecipe(state.settings, result);
  // Renaming the pattern while editing replaces the old entry.
  if (recipe && !fromBuiltin && recipe.originPattern !== result.originPattern) {
    next = { ...next, ...removeRecipe({ ...state.settings, ...next }, recipe.originPattern) };
    next = upsertRecipe({ ...state.settings, ...next }, result);
  }
  await save({ settings: next });
  toast(t('setRecipeSaved', result.originPattern));
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

function backupSection() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    const parsed = parseImport(await chosen.text());
    if (!parsed.ok) return toast(parsed.error, 'error');
    const incoming = parsed.data.prompts?.length ?? 0;
    const mode = await openModal({
      title: t('setImportTitle', tn('nPrompts', incoming)),
      body: h('p', { class: 'muted' }, t('setImportBody')),
      submitLabel: t('merge'),
      extra: [{ label: t('replaceEverything'), value: 'replace' }],
      onSubmit: () => 'merge',
    });
    if (!mode) return;
    if (mode === 'replace') {
      const sure = await confirmDialog(t('replaceLibraryTitle'), t('replaceLibraryBody'), {
        confirmLabel: t('replace'),
        danger: true,
      });
      if (!sure) return;
    }
    const next = applyImportData(parsed.data, state, mode === 'replace' ? 'replace' : 'merge');
    // Merge keeps your settings; replace adopts the file's (whitelisted) settings.
    await save(mode === 'replace' ? next : { prompts: next.prompts, categories: next.categories });
    toast(t('importedLibrary', tn('nPrompts', next.prompts.length)));
  });
  const migrateFile = h('input', {
    type: 'file',
    accept: IMPORT_ACCEPT,
    hidden: true,
  });
  migrateFile.addEventListener('change', async () => {
    const chosen = migrateFile.files?.[0];
    migrateFile.value = '';
    if (chosen) await migrateFrom(chosen);
  });
  return section(
    t('setBackup'),
    t('setBackupDesc'),
    h(
      'div',
      { class: 'inline-form' },
      h('button', { class: 'btn', type: 'button', on: { click: exportLibrary } }, t('exportJson')),
      h(
        'button',
        { class: 'btn', type: 'button', on: { click: () => file.click() } },
        t('importJson'),
      ),
      file,
      h(
        'button',
        { class: 'btn', type: 'button', on: { click: () => migrateFile.click() } },
        t('importOtherTool'),
      ),
      migrateFile,
    ),
  );
}
