/**
 * Emit dist/chrome and dist/firefox from src/manifest.base.json (issue #1, Δ1).
 *
 * Target-specific manifest shapes live in `scripts/manifest.mjs`:
 * - dist/chrome: `background.service_worker` (module MV3 SW) and nothing else
 *   from the Firefox side of the world (issue #42).
 * - dist/firefox: `background.scripts[]` module event page + the Gecko block.
 *
 * Gate: `scripts/validate-manifests.mjs` runs after both targets are written and
 * fails the build on target-shape regressions, cross-target keys, missing
 * referenced files, unresolved `__MSG_*__` placeholders or version drift.
 * `web-ext lint --warnings-as-errors` stays the AMO-specific gate on Firefox.
 */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildManifests } from './manifest.mjs';

/** Project root (src/, dist/) — derived from this script's location. */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** @type {import('./manifest.mjs').ManifestShape} */
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

/** @type {ReturnType<typeof buildManifests>} */
const manifests = buildManifests(base);

for (const [target, manifest] of Object.entries(manifests)) {
  const outDir = path.join(DIST, target);
  await mkdir(outDir, { recursive: true });

  await writeFile(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  // G8b: src/locales/<lang>.js → _locales/<lang>/messages.json (browser.i18n format).
  for (const [lang, messages] of locales) {
    const localeDir = path.join(outDir, '_locales', lang);
    await mkdir(localeDir, { recursive: true });
    await writeFile(
      path.join(localeDir, 'messages.json'),
      `${JSON.stringify(messages, null, 2)}\n`,
      'utf8',
    );
  }

  // Shared assets: background entry, lib ES modules, content script, popup, icons, assets (recipes.json), locales.
  for (const asset of ['background.js', 'lib', 'content', 'popup', 'icons', 'assets', 'locales']) {
    await cp(path.join(SRC, asset), path.join(outDir, asset), { recursive: true });
  }

  process.stderr.write(`built dist/${target}\n`);
}
