/**
 * G10 — the extension's secure storage area (popup and background share it):
 * storage.local for data, storage.session (memory-only) for the vault key.
 */
import browser from './browser.js';
import { createSecureArea } from './secure-store.js';

/** @type {ReturnType<typeof createSecureArea>|null} */
let area = null;

export function secureArea() {
  if (!area) {
    const local = browser?.storage?.local;
    if (!local) throw new Error('Prompty: storage.local is unavailable');
    area = createSecureArea({ local, session: browser.storage.session ?? null });
  }
  return area;
}
