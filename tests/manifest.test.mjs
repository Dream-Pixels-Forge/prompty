import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GECKO_ID, buildManifests } from '../scripts/manifest.mjs';
import { validateManifest } from '../scripts/validate-manifests.mjs';

const base = JSON.parse(
  readFileSync(new URL('../src/manifest.base.json', import.meta.url), 'utf8'),
);

/** @typedef {Parameters<typeof validateManifest>[0]} ManifestShape */
/** @typedef {Parameters<typeof validateManifest>[1]} ValidationContext */

/**
 * Every `__MSG_key__` placeholder the manifest references.
 * @param {ManifestShape} manifest
 * @returns {string[]}
 */
function placeholderKeys(manifest) {
  const found = new Set();
  for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
    if (key) found.add(key);
  }
  return [...found].sort();
}

/**
 * Validation context for a manifest that is expected to pass: every referenced
 * file exists and every placeholder resolves.
 * @param {ManifestShape} manifest
 * @param {'chrome'|'firefox'} target
 * @returns {ValidationContext}
 */
function okContext(manifest, target) {
  const messages = Object.fromEntries(placeholderKeys(manifest).map((k) => [k, { message: 'x' }]));
  return { target, version: manifest.version ?? '', exists: () => true, messages };
}

describe('buildManifests', () => {
  const { chrome, firefox } = buildManifests(base);

  it('gives Chrome a service-worker-only background and no Firefox keys', () => {
    expect(chrome.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(chrome).not.toHaveProperty('browser_specific_settings');
  });

  it('gives Firefox an event-page background plus the Gecko block', () => {
    expect(firefox.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(firefox.browser_specific_settings?.gecko?.id).toBe(GECKO_ID);
    expect(firefox.browser_specific_settings?.gecko?.data_collection_permissions?.required).toEqual(
      ['none'],
    );
  });

  it('keeps the shared keys intact in both targets', () => {
    for (const manifest of [chrome, firefox]) {
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.permissions).toEqual(base.permissions);
      expect(manifest.host_permissions).toEqual(base.host_permissions);
      expect(manifest.content_scripts).toEqual(base.content_scripts);
      expect(manifest.action).toEqual(base.action);
    }
  });

  it('does not mutate the base manifest', () => {
    expect(base).not.toHaveProperty('background');
    expect(base).not.toHaveProperty('browser_specific_settings');
  });
});

describe('validateManifest', () => {
  const { chrome, firefox } = buildManifests(base);

  it('accepts the generated manifests', () => {
    expect(validateManifest(chrome, okContext(chrome, 'chrome'))).toEqual([]);
    expect(validateManifest(firefox, okContext(firefox, 'firefox'))).toEqual([]);
  });

  it('rejects a Firefox-only background fallback in the Chrome build', () => {
    const bad = {
      ...chrome,
      background: { service_worker: 'background.js', scripts: ['background.js'], type: 'module' },
    };
    expect(validateManifest(bad, okContext(bad, 'chrome')).join('\n')).toContain(
      'background.scripts is Firefox-only',
    );
  });

  it('rejects a Gecko block in the Chrome build', () => {
    /** @type {ManifestShape} */
    const bad = { ...chrome, browser_specific_settings: { gecko: { id: GECKO_ID } } };
    expect(validateManifest(bad, okContext(bad, 'chrome')).join('\n')).toContain(
      'browser_specific_settings is Firefox-only',
    );
  });

  it('rejects a service worker in the Firefox build', () => {
    const bad = {
      ...firefox,
      background: { service_worker: 'background.js', scripts: ['background.js'], type: 'module' },
    };
    expect(validateManifest(bad, okContext(bad, 'firefox')).join('\n')).toContain(
      'background.service_worker is Chromium-only',
    );
  });

  it('requires the Gecko id and data-collection declaration for Firefox', () => {
    /** @type {ManifestShape} */
    const bad = { ...firefox, browser_specific_settings: { gecko: {} } };
    const errors = validateManifest(bad, okContext(bad, 'firefox')).join('\n');
    expect(errors).toContain('gecko.id is required');
    expect(errors).toContain('data_collection_permissions');
  });

  it('flags version drift against package.json', () => {
    const ctx = { ...okContext(chrome, 'chrome'), version: '9.9.9' };
    expect(validateManifest(chrome, ctx).join('\n')).toContain('9.9.9');
  });

  it('flags a Manifest V2 manifest', () => {
    const bad = { ...chrome, manifest_version: 2 };
    expect(validateManifest(bad, okContext(bad, 'chrome')).join('\n')).toContain(
      'manifest_version',
    );
  });

  it('flags a referenced file that is missing from the build', () => {
    const ctx = {
      ...okContext(chrome, 'chrome'),
      exists: (/** @type {string} */ p) => p !== 'popup/index.html',
    };
    expect(validateManifest(chrome, ctx).join('\n')).toContain('popup/index.html');
  });

  it('flags an unresolved __MSG_ placeholder', () => {
    const ctx = { ...okContext(chrome, 'chrome'), messages: {} };
    expect(validateManifest(chrome, ctx).join('\n')).toContain('extName');
  });

  it('flags a missing locale catalog', () => {
    const ctx = { ...okContext(chrome, 'chrome'), messages: null };
    expect(validateManifest(chrome, ctx).join('\n')).toContain('_locales');
  });

  it('flags a dropped alarms permission (the bridge sync clock)', () => {
    const bad = { ...chrome, permissions: ['storage'] };
    expect(validateManifest(bad, okContext(bad, 'chrome')).join('\n')).toContain('alarms');
  });
});
