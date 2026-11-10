/**
 * G10 — Vault crypto. WebCrypto only: PBKDF2-SHA-256 (250k iterations, random
 * 16-byte salt) derives an AES-GCM-256 key; every sealed value gets a fresh
 * 12-byte IV. Nothing here touches storage or keeps state; the passphrase is
 * never stored, and the key is passed around as a non-persisted JWK only by
 * the secure-store layer (storage.session: memory-only, cleared on restart).
 */

export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 250_000;
export const MIN_PASSPHRASE = 8;
const CHECK_TOKEN = 'prompty-vault-ok';

/**
 * @typedef {{ iv: string, ct: string }} Sealed base64 IV + ciphertext (with GCM tag)
 * @typedef {object} VaultMeta stored in plain `vault` (no secrets in it)
 * @property {1} v
 * @property {{ name: 'PBKDF2', hash: 'SHA-256', iterations: number, salt: string }} kdf
 * @property {Sealed} check a known token, to tell a wrong passphrase from corrupt data
 * @property {number} idleMinutes auto-lock after this much inactivity (0 = only on browser restart)
 */

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is unavailable');
  return s;
};

/** @param {Uint8Array} bytes */
export function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * @param {string} b64
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {number} n */
const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

/**
 * @param {string} passphrase
 * @param {Uint8Array<ArrayBuffer>} salt
 * @param {number} [iterations]
 * @returns {Promise<CryptoKey>} extractable, so it can sit in storage.session as a JWK
 */
export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * @param {CryptoKey} key
 * @param {unknown} value any JSON value
 * @returns {Promise<Sealed>}
 */
export async function seal(key, value) {
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(JSON.stringify(value ?? null));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data));
  return { iv: toB64(iv), ct: toB64(ct) };
}

/**
 * @param {CryptoKey} key
 * @param {Sealed} sealed
 * @returns {Promise<unknown>} throws when the key is wrong or the data was tampered with
 */
export async function open(key, sealed) {
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv) },
    key,
    fromB64(sealed.ct),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/** @param {unknown} v @returns {v is Sealed} */
export const isSealed = (v) =>
  !!v &&
  typeof v === 'object' &&
  typeof (/** @type {any} */ (v).iv) === 'string' &&
  typeof (/** @type {any} */ (v).ct) === 'string';

/**
 * New vault: fresh salt, derived key, sealed check token.
 * @param {string} passphrase
 * @param {{ idleMinutes?: number, iterations?: number }} [opts]
 * @returns {Promise<{ meta: VaultMeta, key: CryptoKey }>}
 */
export async function createVault(
  passphrase,
  { idleMinutes = 15, iterations = PBKDF2_ITERATIONS } = {},
) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE)
    throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, iterations);
  /** @type {VaultMeta} */
  const meta = {
    v: VAULT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    check: await seal(key, CHECK_TOKEN),
    idleMinutes,
  };
  return { meta, key };
}

/**
 * @param {unknown} meta
 * @returns {meta is VaultMeta}
 */
export function isVaultMeta(meta) {
  const m = /** @type {any} */ (meta);
  return (
    !!m &&
    m.v === VAULT_VERSION &&
    m.kdf?.name === 'PBKDF2' &&
    typeof m.kdf.salt === 'string' &&
    Number.isInteger(m.kdf.iterations) &&
    m.kdf.iterations >= 100_000 &&
    isSealed(m.check)
  );
}

/**
 * Derive the key from the passphrase; null when it's wrong.
 * @param {VaultMeta} meta
 * @param {string} passphrase
 * @returns {Promise<CryptoKey|null>}
 */
export async function unlockKey(meta, passphrase) {
  const key = await deriveKey(passphrase, fromB64(meta.kdf.salt), meta.kdf.iterations);
  try {
    return (await open(key, meta.check)) === CHECK_TOKEN ? key : null;
  } catch {
    return null;
  }
}

/** @param {CryptoKey} key */
export const exportKey = (key) => subtle().exportKey('jwk', key);

/** @param {JsonWebKey} jwk */
export const importKey = (jwk) =>
  subtle().importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
