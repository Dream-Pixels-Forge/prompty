/**
 * Placeholder background entry (reserved for Issue #4 — context menus,
 * command routing, OPEN_POPUP handling). Kept as a minimal valid module
 * service worker / event page until then.
 */
import browser from './lib/browser.js';

// Placeholder listener so the event page has a registered surface; Issue #4
// replaces this with real message/command routing.
browser?.runtime?.onMessage?.addListener?.(() => {
  // Reserved for Issue #4. Respond with a minimal envelope per SECURITY.md.
  return false;
});
