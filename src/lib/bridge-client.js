/**
 * G14 — Agent bridge sync client. Runs in the background worker: pulls what a
 * coding agent queued in `~/.prompty`, merges it into `storage.local`, acks the
 * ids it consumed, then shares the library back so the agent can search it.
 *
 * Never throws: every failure becomes `{ok:false, reason}` and is persisted as
 * the last-sync status for Settings → Agent bridge.
 */
import { BRIDGE_STATUS_KEY } from './bridge-constants.js';
import { applyPending, normalizeBridgeUrl, validatePending } from './bridge.js';
import { CATEGORY_COLORS } from './colors.js';
import { readAll, writeAll } from './storage.js';

/**
 * @typedef {import('./storage.js').Prompt} Prompt
 * @typedef {import('./storage.js').Category} Category
 *
 * @typedef {object} BridgeConfig
 * @property {boolean} enabled
 * @property {string} url
 * @property {string} token
 *
 * @typedef {object} SyncOptions
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [now]
 * @property {string[]} [colors]
 *
 * @typedef {object} SyncResult
 * @property {boolean} ok
 * @property {'disabled'|'not-configured'|'bad-url'|'bad-payload'|'http'|'network'} [reason]
 * @property {string} [error]
 * @property {number} added
 * @property {number} updated
 * @property {number} skipped
 * @property {number} removed
 * @property {number} categoriesAdded
 * @property {number} at
 */

/** Timeout for one bridge request; a hung local server must not wedge sync. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * One sync cycle. Order matters: `pending` → merge → `ack` → `snapshot`.
 * @param {{ get: Function, set: Function }} area storage area (tests inject one)
 * @param {BridgeConfig} config
 * @param {SyncOptions} [options]
 * @returns {Promise<SyncResult>}
 */
export async function syncBridge(area, config, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const colors = options.colors ?? CATEGORY_COLORS;

  /** @param {Partial<SyncResult> & { reason: SyncResult['reason'] }} result */
  const fail = async (result) => {
    const status = { ...result, ok: false, at: now };
    await persistStatus(area, status);
    return /** @type {SyncResult} */ ({ ...status, added: 0, updated: 0, skipped: 0, removed: 0, categoriesAdded: 0 });
  };

  if (!config?.enabled) return fail({ reason: 'disabled' });
  const token = typeof config.token === 'string' ? config.token.trim() : '';
  if (token === '') return fail({ reason: 'not-configured' });
  const base = normalizeBridgeUrl(config.url);
  if (base === null) return fail({ reason: 'bad-url' });

  /** @param {string} path @param {RequestInit} [init] */
  const call = async (path, init = {}) => {
    /** @type {Record<string, string>} */
    const headers = { 'X-Prompty-Token': token };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    return await fetchImpl(`${base}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  /** @type {Response} */
  let pendingResponse;
  try {
    pendingResponse = await call('/pending');
  } catch (error) {
    return await fail({ reason: 'network', error: messageOf(error) });
  }
  if (!pendingResponse.ok) {
    return await fail({ reason: 'http', error: `HTTP ${pendingResponse.status}` });
  }

  /** @type {unknown} */
  let payload;
  try {
    payload = await pendingResponse.json();
  } catch (error) {
    return await fail({ reason: 'bad-payload', error: messageOf(error) });
  }

  const check = validatePending(payload);
  if (!check.ok) return await fail({ reason: 'bad-payload', error: check.error });

  const library = await readAll(area);
  const merged = applyPending(library, check.data, { now, newId: () => crypto.randomUUID(), colors });
  await writeAll(area, { prompts: merged.prompts, categories: merged.categories });

  // A failed ack is recoverable: the next sync re-sends the same ids and the
  // merge is a no-op for prompts already present.
  let ackFailed;
  try {
    const ack = await call('/ack', {
      method: 'POST',
      body: JSON.stringify({ ids: merged.importedIds }),
    });
    ackFailed = !ack.ok;
  } catch {
    ackFailed = true;
  }

  try {
    await call('/snapshot', {
      method: 'POST',
      body: JSON.stringify({ prompts: merged.prompts, categories: merged.categories }),
    });
  } catch {
    // Snapshot is a convenience for the agent's search; it never fails a sync.
  }

  const status = {
    ok: true,
    at: now,
    added: merged.applied.added,
    updated: merged.applied.updated,
    skipped: merged.applied.skipped,
    removed: merged.applied.removed,
    categoriesAdded: merged.applied.categoriesAdded,
    ...(ackFailed ? { ackFailed: true } : {}),
  };
  await persistStatus(area, status);
  return /** @type {SyncResult} */ (status);
}

/**
 * @param {{ set: Function }} area
 * @param {Record<string, unknown>} status
 */
async function persistStatus(area, status) {
  try {
    await area.set({ [BRIDGE_STATUS_KEY]: status });
  } catch {
    // A storage failure must not turn a good sync into an exception.
  }
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export { BRIDGE_STATUS_KEY };
