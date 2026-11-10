/**
 * Emit dist/chrome and dist/firefox from src/manifest.base.json (issue #1, Δ1).
 *
 * Dual-manifest details:
 * - dist/chrome: `background.service_worker` (module MV3 SW) is authoritative for
 *   Chromium. It is PAIRED with a `scripts` fallback and a Gecko id so the
 *   linter sees a Firefox-compatible shape; Chromium ignores both extra keys.
 * - dist/firefox: `background.scripts[]` module event page + gecko id.
 *
 * Lint gates (CI):
 * - firefox: `web-ext lint --warnings-as-errors` (0 errors / 0 warnings).
 * - chrome: `addons-linter --enable-background-service-worker --warnings-as-errors`
 *   — web-ext@8 has no chromо target and cannot enable its bundled linter's
 *   MV3 service-worker feature flag, so addons-linter (the engine web-ext ones)
 *   is invoked directly for the Chromium target.
 */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Project root (src/, dist/) — derived from this script's location. */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const GECKO_ID = 'prompty@dream-pixels-forge.dev';
const GECKO_STRICT_MIN_VERSION = '142.0';
const GECKO_SETTINGS = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: GECKO_STRICT_MIN_VERSION,
    data_collection_permissions: { required: ['none'] },
  },
};

/**
 * @typedef {object} BuildTarget
 * @property {'chrome'|'firefox'} dir
 * @property {Record<string, unknown>} background
 * @property {{ gecko: { id: string, strict_min_version: string, data_collection_permissions: { required: string[] } } }} browser_specific_settings
 */

/** @type {Record<string, unknown>} */
const base = JSON.parse(await readFile(path.join(SRC, 'manifest.base.json'), 'utf8'));

/**
 * Locale catalogs as browser.i18n messages. `$` not followed by a digit is a
 * literal dollar and must be doubled in messages.json.
 * @type {[string, Record<string, { message: string }>][]}
 */
const locales = [];
for (const file of (await readdir(path.join(SRC, 'locales')))
  .filter((f) => f.endsWith('.js'))
  .sort()) {
  const { default: catalog } = await import(path.join(SRC, 'locales', file));
  /** @type {Record<string, { message: string }>} */
  const messages = {};
  for (const [key, text] of Object.entries(catalog)) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) throw new Error(`locales/${file}: bad key "${key}"`);
    messages[key] = { message: String(text).replace(/\$(?!\d)/g, '$$$$') };
  }
  locales.push([file.replace(/\.js$/, ''), messages]);
}

/** @type {BuildTarget[]} */
const targets = [
  {
    dir: 'chrome',
    background: {
      // Chromium runs the module service worker; ignores `scripts`.
      service_worker: 'background.js',
      scripts: ['background.js'],
      type: 'module',
    },
    browser_specific_settings: GECKO_SETTINGS,
  },
  {
    dir: 'firefox',
    background: {
      // Firefox runs the module event page; no service worker.
      scripts: ['background.js'],
      type: 'module',
    },
    browser_specific_settings: GECKO_SETTINGS,
  },
];

for (const target of targets) {
  const outDir = path.join(DIST, target.dir);
  await mkdir(outDir, { recursive: true });

  /** @type {Record<string, unknown>} */
  const manifest = {
    ...base,
    background: target.background,
    browser_specific_settings: target.browser_specific_settings,
  };

  await writeFile(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  // G8b: src/locales/<lang>.js → _locales/<lang>/messages.json (browser.i18n format).
  for (const [lang, messages] of locales) {
    const dir = path.join(outDir, '_locales', lang);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'messages.json'),
      `${JSON.stringify(messages, null, 2)}\n`,
      'utf8',
    );
  }

  // Shared assets: background entry, lib ES modules, content script, popup, icons, assets (recipes.json), locales.
  for (const asset of ['background.js', 'lib', 'content', 'popup', 'icons', 'assets', 'locales']) {
    await cp(path.join(SRC, asset), path.join(outDir, asset), { recursive: true });
  }

  process.stderr.write(`built dist/${target.dir}\n`);
}
