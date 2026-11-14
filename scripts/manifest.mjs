/**
 * Target-specific manifest shapes for the dual build (issue #1, Δ1; issue #42).
 *
 * Chromium and Firefox disagree about two things in a Manifest V3 package:
 *
 * - the background entry: `background.service_worker` (Chromium, module SW)
 *   vs `background.scripts[]` (Firefox, module event page);
 * - the Gecko metadata block (`browser_specific_settings`), which only Firefox
 *   reads.
 *
 * Each target therefore gets a manifest containing only its own keys. This used
 * to be padded in the other direction — the Chrome package also carried
 * `background.scripts` and a Gecko block so Mozilla's `addons-linter` would
 * accept it — which made the Chrome Web Store report unrecognized keys and left
 * the CI gate unable to fail. `scripts/validate-manifests.mjs` now checks the
 * Chromium target instead.
 *
 * Kept dependency-free and free of I/O so `tests/manifest.test.mjs` can import
 * it without running a build.
 */

export const GECKO_ID = 'prompty@dream-pixels-forge.dev';
export const GECKO_STRICT_MIN_VERSION = '142.0';

/**
 * Firefox-only metadata. AMO requires both the add-on id and an explicit
 * data-collection declaration for new MV3 submissions.
 * @type {{ gecko: { id: string, strict_min_version: string, data_collection_permissions: { required: string[] } } }}
 */
export const GECKO_SETTINGS = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: GECKO_STRICT_MIN_VERSION,
    data_collection_permissions: { required: ['none'] },
  },
};

/**
 * @typedef {object} ManifestShape
 * @property {number} [manifest_version]
 * @property {string} [name]
 * @property {string} [version]
 * @property {string} [description]
 * @property {string} [default_locale]
 * @property {string[]} [permissions]
 * @property {string[]} [host_permissions]
 * @property {{ matches?: string[], js?: string[], run_at?: string }[]} [content_scripts]
 * @property {Record<string, { suggested_key?: { default?: string }, description?: string }>} [commands]
 * @property {{ service_worker?: string, scripts?: string[], type?: string }} [background]
 * @property {{ gecko?: { id?: string, strict_min_version?: string, data_collection_permissions?: { required?: string[] } } }} [browser_specific_settings]
 * @property {{ default_popup?: string, default_title?: string, default_icon?: Record<string, string> }} [action]
 * @property {Record<string, string>} [icons]
 */

/**
 * Build the two target manifests from the shared base.
 * @param {ManifestShape} base  `src/manifest.base.json`
 * @returns {{ chrome: ManifestShape, firefox: ManifestShape }}
 */
export function buildManifests(base) {
  return {
    chrome: {
      ...base,
      // Chromium runs the module service worker. No `scripts`, no Gecko block.
      background: { service_worker: 'background.js', type: 'module' },
    },
    firefox: {
      ...base,
      // Firefox runs the module event page. No service worker.
      background: { scripts: ['background.js'], type: 'module' },
      browser_specific_settings: GECKO_SETTINGS,
    },
  };
}
