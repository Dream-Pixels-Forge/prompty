/**
 * Validate the built manifests in `dist/chrome` and `dist/firefox` (issue #42).
 *
 * Why this exists: `addons-linter` is Mozilla's **Firefox** linter. It used to
 * be run against the Chromium build, which only passed because
 * `dist/chrome/manifest.json` was padded with Firefox-only keys
 * (`background.scripts`, `browser_specific_settings`) that Chromium ignores.
 * Deleting them makes `addons-linter` demand *more* Firefox keys
 * (`ADDON_ID_REQUIRED`, `MISSING_DATA_COLLECTION_PERMISSIONS`), so a genuinely
 * Chromium-clean package can never satisfy it.
 *
 * `dist/chrome` is therefore checked here instead, and the rules are written
 * against what Chromium actually reads:
 *
 * - Manifest V3, version in sync with `package.json`;
 * - target-specific background shape, and no keys from the other browser;
 * - permissions the shipped features depend on;
 * - every file the manifest references exists in that target's dist;
 * - every `__MSG_*__` placeholder resolves in `_locales/<default_locale>`.
 *
 * `dist/firefox` gets the same structural checks; AMO-specific validation stays
 * with `web-ext lint --warnings-as-errors`.
 *
 * Usage: `node scripts/validate-manifests.mjs` (after `pnpm build`), or
 * `pnpm validate`. Exits 1 listing every problem.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/** @typedef {import('./manifest.mjs').ManifestShape} ManifestShape */

/**
 * @typedef {object} ValidationContext
 * @property {'chrome'|'firefox'} target
 * @property {string} version  Expected version (from `package.json`).
 * @property {(relPath: string) => boolean} exists  File presence inside `dist/<target>/`.
 * @property {Record<string, { message: string }> | null} messages  `_locales/<default_locale>/messages.json`.
 */

/** @type {('chrome'|'firefox')[]} */
const TARGETS = ['chrome', 'firefox'];

/** Permissions a shipped feature depends on; dropping one breaks it silently. */
const REQUIRED_PERMISSIONS = [
  ['storage', 'the prompt library'],
  ['alarms', 'the agent-bridge sync clock'],
  ['contextMenus', '"Save Selection as Prompt"'],
  ['notifications', 'save and error toasts'],
];

/**
 * Check one manifest against its target's rules.
 * @param {ManifestShape} manifest
 * @param {ValidationContext} context
 * @returns {string[]} Every problem found, prefixed with the target name.
 */
export function validateManifest(manifest, context) {
  const { target, version, exists, messages } = context;
  /** @type {string[]} */
  const errors = [];
  /** @param {string} message */
  const fail = (message) => errors.push(`${target}: ${message}`);

  if (manifest.manifest_version !== 3) {
    fail(`manifest_version must be 3 (got ${String(manifest.manifest_version)})`);
  }

  if (typeof manifest.version !== 'string' || manifest.version === '') {
    fail('version is required');
  } else if (manifest.version !== version) {
    fail(`version ${manifest.version} does not match package.json ${version}`);
  }

  const background = manifest.background;
  if (background === undefined) {
    fail('background is required');
  } else {
    if (background.type !== 'module') fail('background.type must be "module"');
    if (target === 'chrome') {
      if (background.service_worker !== 'background.js') {
        fail('background.service_worker must be "background.js"');
      }
      if (background.scripts !== undefined) {
        fail('background.scripts is Firefox-only and is ignored by Chromium');
      }
      if (manifest.browser_specific_settings !== undefined) {
        fail('browser_specific_settings is Firefox-only and is ignored by Chromium');
      }
    } else {
      if (!Array.isArray(background.scripts) || background.scripts[0] !== 'background.js') {
        fail('background.scripts[0] must be "background.js"');
      }
      if (background.service_worker !== undefined) {
        fail('background.service_worker is Chromium-only and is ignored by Firefox');
      }
      const gecko = manifest.browser_specific_settings?.gecko;
      if (gecko?.id === undefined || gecko.id === '') {
        fail('browser_specific_settings.gecko.id is required');
      }
      if (!Array.isArray(gecko?.data_collection_permissions?.required)) {
        fail(
          'browser_specific_settings.gecko.data_collection_permissions.required is required for AMO',
        );
      }
    }
  }

  const permissions = manifest.permissions ?? [];
  for (const [name, reason] of REQUIRED_PERMISSIONS) {
    if (!permissions.includes(name)) fail(`permissions must include "${name}" for ${reason}`);
  }
  if (!(manifest.host_permissions ?? []).includes('<all_urls>')) {
    fail('host_permissions must include "<all_urls>"');
  }

  /** @type {Set<string>} */
  const referenced = new Set();
  if (typeof background?.service_worker === 'string') referenced.add(background.service_worker);
  for (const script of background?.scripts ?? []) referenced.add(script);
  for (const entry of manifest.content_scripts ?? []) {
    for (const file of entry.js ?? []) referenced.add(file);
  }
  if (manifest.action?.default_popup !== undefined) referenced.add(manifest.action.default_popup);
  for (const file of Object.values(manifest.icons ?? {})) referenced.add(file);
  for (const file of Object.values(manifest.action?.default_icon ?? {})) referenced.add(file);
  for (const file of [...referenced].sort()) {
    if (!exists(file)) fail(`referenced file is missing from dist/${target}/: ${file}`);
  }

  const locale = manifest.default_locale;
  if (locale === undefined || locale === '') {
    fail('default_locale is required');
  } else if (messages === null) {
    fail(`_locales/${locale}/messages.json is missing`);
  } else {
    const keys = new Set();
    for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
      if (key !== undefined) keys.add(key);
    }
    for (const key of [...keys].sort()) {
      if (!(key in messages))
        fail(`__MSG_${key}__ has no entry in _locales/${locale}/messages.json`);
    }
  }

  return errors;
}

/**
 * Parse JSON without throwing.
 * @param {Buffer} raw
 * @returns {unknown}
 */
function parseJson(raw) {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
}

/** Validate both built manifests; exit 1 if anything is wrong. */
async function main() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  /** @type {string[]} */
  const errors = [];

  for (const target of TARGETS) {
    const dir = path.join(DIST, target);
    const raw = await readFile(path.join(dir, 'manifest.json')).catch(() => null);
    if (raw === null) {
      errors.push(`${target}: dist/${target}/manifest.json is missing — run \`pnpm build\` first`);
      continue;
    }
    const manifest = /** @type {ManifestShape | null} */ (parseJson(raw));
    if (manifest === null) {
      errors.push(`${target}: dist/${target}/manifest.json is not valid JSON`);
      continue;
    }

    const locale = manifest.default_locale;
    /** @type {Record<string, { message: string }> | null} */
    let messages = null;
    if (typeof locale === 'string' && locale !== '') {
      const catalog = await readFile(path.join(dir, '_locales', locale, 'messages.json')).catch(
        () => null,
      );
      messages =
        catalog === null
          ? null
          : /** @type {Record<string, { message: string }> | null} */ (parseJson(catalog));
    }

    errors.push(
      ...validateManifest(manifest, {
        target,
        version: String(pkg.version),
        exists: (relPath) => existsSync(path.join(dir, relPath)),
        messages,
      }),
    );
  }

  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`✗ ${error}\n`);
    process.stderr.write(`\n${String(errors.length)} manifest problem(s) in dist/\n`);
    process.exit(1);
  }
  process.stderr.write(
    `✓ dist/chrome + dist/firefox manifests valid (${TARGETS.length} targets)\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
