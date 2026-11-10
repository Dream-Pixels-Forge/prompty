/**
 * G10 — a storage "area" with the same get/set/remove shape as
 * storage.local, encrypting the secret keys while the vault is on.
 *
 * - Plain keys (settings, categories, recipes, positions…) pass straight through.
 * - Secret keys (SECRET_KEYS) live as separate sealed blobs `vault_<key>`, so
 *   two writers touching different keys never clobber each other — same as
 *   plain storage. Their plaintext keys are removed.
 * - The key lives in storage.session as a JWK (memory only, cleared on
 *   browser restart, not readable from content scripts by default). It is
 *   dropped after `idleMinutes` without access (checked on every access).
 * - While locked, reading or writing a secret key throws VaultLockedError.
 */
import {
  createVault,
  exportKey,
  importKey,
  isSealed,
  isVaultMeta,
  open,
  seal,
  unlockKey,
} from './vault.js';

/**
 * @typedef {{ get: (keys?: string|string[]|null) => Promise<Record<string, unknown>>, set: (items: Record<string, unknown>) => Promise<void>, remove: (keys: string|string[]) => Promise<void> }} Area
 * @typedef {'off'|'locked'|'unlocked'|'unsupported'} VaultStatus
 */

export const SECRET_KEYS = /** @type {const} */ ([
  'prompts',
  'snippets',
  'variableMemory',
  'composerDraft',
]);
export const META_KEY = 'vault';
const SESSION_KEY = 'vaultKey';
const SESSION_ACTIVE = 'vaultActiveAt';
/** @param {string} k */
export const sealedKey = (k) => `vault_${k}`;
/** @param {string} k */
const isSecret = (k) => /** @type {readonly string[]} */ (SECRET_KEYS).includes(k);

export class VaultLockedError extends Error {
  constructor() {
    super('Vault locked — open Prompty to unlock.');
    this.name = 'VaultLockedError';
  }
}

/**
 * @param {{ local: Area, session?: Area|null, now?: () => number }} deps
 */
export function createSecureArea({ local, session, now = () => Date.now() }) {
  /** @type {{ k: string, key: CryptoKey }|null} */
  let cached = null;

  const meta = async () => {
    const raw = (await local.get([META_KEY]))[META_KEY];
    return isVaultMeta(raw) ? raw : null;
  };

  /** The key if unlocked and not idle-expired, touching the activity clock; else null. */
  const getKey = async () => {
    const m = await meta();
    if (!m || !session) return null;
    const s = await session.get([SESSION_KEY, SESSION_ACTIVE]);
    const jwk = /** @type {JsonWebKey|undefined} */ (s[SESSION_KEY]);
    if (!jwk || typeof jwk.k !== 'string') return null;
    const active = typeof s[SESSION_ACTIVE] === 'number' ? s[SESSION_ACTIVE] : 0;
    if (m.idleMinutes > 0 && now() - active > m.idleMinutes * 60_000) {
      await lock();
      return null;
    }
    await session.set({ [SESSION_ACTIVE]: now() });
    if (cached?.k !== jwk.k) cached = { k: jwk.k, key: await importKey(jwk) };
    return cached.key;
  };

  /** @param {CryptoKey} key */
  const remember = async (key) => {
    const jwk = await exportKey(key);
    await /** @type {Area} */ (session).set({ [SESSION_KEY]: jwk, [SESSION_ACTIVE]: now() });
    cached = { k: /** @type {string} */ (jwk.k), key };
  };

  async function lock() {
    cached = null;
    if (session) await session.remove([SESSION_KEY, SESSION_ACTIVE]);
  }

  /** @returns {Promise<VaultStatus>} */
  async function status() {
    if (!(await meta())) return session ? 'off' : 'unsupported';
    return (await getKey()) ? 'unlocked' : 'locked';
  }

  /** @param {string|string[]|null|undefined} keys */
  const listOf = (keys) => (keys == null ? null : Array.isArray(keys) ? keys : [keys]);

  /** @type {Area['get']} */
  async function get(keys) {
    const wanted = listOf(keys);
    if (!(await meta())) return local.get(keys ?? null);
    const asked = wanted ?? [...SECRET_KEYS];
    const plain = asked.filter((k) => !isSecret(k));
    const secret = asked.filter(isSecret);
    /** @type {Record<string, unknown>} */
    const out =
      wanted === null ? await local.get(null) : plain.length ? await local.get(plain) : {};
    for (const k of SECRET_KEYS) delete out[sealedKey(k)];
    if (secret.length === 0) return out;
    const key = await getKey();
    if (!key) throw new VaultLockedError();
    const blobs = await local.get(secret.map(sealedKey));
    for (const k of secret) {
      const b = blobs[sealedKey(k)];
      if (isSealed(b)) out[k] = await open(key, b);
    }
    return out;
  }

  /** @type {Area['set']} */
  async function set(items) {
    if (!(await meta())) return local.set(items);
    /** @type {Record<string, unknown>} */
    const plain = {};
    /** @type {Record<string, unknown>} */
    const secret = {};
    for (const [k, v] of Object.entries(items)) (isSecret(k) ? secret : plain)[k] = v;
    if (Object.keys(secret).length) {
      const key = await getKey();
      if (!key) throw new VaultLockedError();
      for (const [k, v] of Object.entries(secret)) plain[sealedKey(k)] = await seal(key, v);
    }
    if (Object.keys(plain).length) await local.set(plain);
  }

  /** @type {Area['remove']} */
  async function remove(keys) {
    const list = listOf(keys) ?? [];
    if (await meta()) await local.remove(list.map((k) => (isSecret(k) ? sealedKey(k) : k)));
    else await local.remove(list);
  }

  /**
   * Turn the vault on: seal what's there now, then drop the plaintext.
   * @param {string} passphrase
   * @param {{ idleMinutes?: number, iterations?: number }} [opts]
   */
  async function enable(passphrase, opts) {
    if (!session) throw new Error('This browser cannot hold a vault key in memory.');
    if (await meta()) throw new Error('The vault is already on.');
    const { meta: m, key } = await createVault(passphrase, opts);
    const current = await local.get([...SECRET_KEYS]);
    /** @type {Record<string, unknown>} */
    const sealed = { [META_KEY]: m };
    for (const k of SECRET_KEYS)
      if (k in current) sealed[sealedKey(k)] = await seal(key, current[k]);
    await local.set(sealed); // sealed copies first…
    await local.remove([...SECRET_KEYS]); // …then the plaintext goes
    await remember(key);
  }

  /** @param {string} passphrase @returns {Promise<boolean>} */
  async function unlock(passphrase) {
    const m = await meta();
    if (!m || !session) return false;
    const key = await unlockKey(m, passphrase);
    if (!key) return false;
    await remember(key);
    return true;
  }

  /** Turn the vault off (must be unlocked): decrypt back to plain keys. */
  async function disable() {
    const key = await getKey();
    if (!key) throw new VaultLockedError();
    const blobs = await local.get(SECRET_KEYS.map(sealedKey));
    /** @type {Record<string, unknown>} */
    const plain = {};
    for (const k of SECRET_KEYS) {
      const b = blobs[sealedKey(k)];
      if (isSealed(b)) plain[k] = await open(key, b);
    }
    await local.set(plain); // plaintext back first…
    await local.remove([META_KEY, ...SECRET_KEYS.map(sealedKey)]); // …then the vault goes
    await lock();
  }

  /** @param {number} minutes 0 = lock only when the browser restarts */
  async function setIdleMinutes(minutes) {
    const m = await meta();
    if (!m) return;
    const idleMinutes = Math.max(0, Math.min(24 * 60, Math.round(Number(minutes) || 0)));
    await local.set({ [META_KEY]: { ...m, idleMinutes } });
  }

  return {
    get,
    set,
    remove,
    status,
    enable,
    unlock,
    lock,
    disable,
    setIdleMinutes,
    meta,
  };
}

/** Storage keys whose change means "secret data changed" (for onChanged listeners). */
export const WATCH_KEYS = [...SECRET_KEYS, ...SECRET_KEYS.map(sealedKey), META_KEY];
