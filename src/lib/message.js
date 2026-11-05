/**
 * Message contract constants + builder/validator helpers (SPEC §2 Δ4 Δ6 Δ7).
 * Pure functions — no DOM, no extension APIs. Shared by background, popup,
 * content script, and tests.
 */

/**
 * @readonly
 * @enum {string}
 */
export const MSG_OPEN_POPUP = 'OPEN_POPUP';
export const MSG_SAVE_SELECTION = 'PROMPTY_SAVE_SELECTION';
export const MSG_SHOW_TOAST = 'SHOW_TOAST';
export const MSG_INSERT_PROMPT = 'PROMPTY_INSERT';
export const MSG_TOGGLE_WIDGET = 'PROMPTY_TOGGLE_WIDGET';

/**
 * @param {unknown} text
 * @returns {{ type: string, text: string }}
 */
export function saveSelectionMessage(text) {
  return { type: MSG_SAVE_SELECTION, text: typeof text === 'string' ? text : '' };
}

/**
 * @param {unknown} message
 * @returns {{ type: string, message: string }}
 */
export function toastMessage(message) {
  return { type: MSG_SHOW_TOAST, message: typeof message === 'string' ? message : '' };
}

/**
 * Validates the exact payload shape for PROMPTY_SAVE_SELECTION.
 * @param {unknown} msg
 * @returns {boolean}
 */
export function isSaveSelectionMessage(msg) {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    /** @type {{ type?: unknown, text?: unknown }} */ (msg).type === MSG_SAVE_SELECTION &&
    typeof /** @type {{ type?: unknown, text?: unknown }} */ (msg).text === 'string'
  );
}

/**
 * Validates OPEN_POPUP message (allows extra properties for forward-compat).
 * @param {unknown} msg
 * @returns {boolean}
 */
export function isOpenPopupMessage(msg) {
  return (
    msg !== null &&
    typeof msg === 'object' &&
    /** @type {{ type?: unknown }} */ (msg).type === MSG_OPEN_POPUP
  );
}