/**
 * Shim so all lib code can uniformly say `browser.*`:
 * In Firefox the global is `browser`, in Chromium (MV3) it's `chrome`.
 * Last-resort chain covers bundled/polyfilled environments.
 */
const api = globalThis.browser ?? globalThis.chrome;

export default api;
