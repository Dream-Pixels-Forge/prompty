/**
 * Placeholder popup script (reserved for Issue #3 — popup UI, grid, search).
 * ES module so it can import the shared lib once implemented.
 */
import browser from '../lib/browser.js';

// Reserved for Issue #3; keeps the shared `browser` shim wired up.
export const supported = Boolean(browser);
