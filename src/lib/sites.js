/**
 * Site/origin helpers for per-site toggling (Δ2, Δ3: `settings.disabledSites[]`).
 */

/**
 * Origin of a URL string, or "" for anything unparsable.
 * @param {string|undefined|null} url
 * @returns {string}
 */
export function getOrigin(url) {
  if (typeof url !== 'string' || url.length === 0) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Whether a URL's exact origin is listed as disabled.
 * @param {string|null} url target page URL
 * @param {string[]} disabledSites origin list from settings
 * @returns {boolean}
 */
export function isSiteDisabled(url, disabledSites) {
  const origins = Array.isArray(disabledSites)
    ? disabledSites.filter((s) => typeof s === 'string')
    : [];
  if (origins.length === 0) return false;
  const origin = getOrigin(url);
  if (origin === '') return false;
  return origins.includes(origin);
}
