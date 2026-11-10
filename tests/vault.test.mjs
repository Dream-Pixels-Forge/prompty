import { describe, expect, it } from 'vitest';
import {
  SECRET_KEYS,
  VaultLockedError,
  createSecureArea,
  sealedKey,
} from '../src/lib/secure-store.js';
import { createVault, isVaultMeta, open, seal, unlockKey } from '../src/lib/vault.js';
import { readAll, writeAll } from '../src/lib/storage.js';

// Fast KDF for tests; production uses PBKDF2_ITERATIONS (250k), checked separately.
const FAST = { iterations: 100_000 };

/** In-memory stand-in for chrome.storage.{local,session}. */
function fakeArea(initial = {}) {
  /** @type {Map<string, unknown>} */
  const m = new Map(Object.entries(structuredClone(initial)));
  return {
    m,
    /** @param {string|string[]|null} [keys] */
    async get(keys) {
      const list = keys == null ? [...m.keys()] : Array.isArray(keys) ? keys : [keys];
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const k of list) if (m.has(k)) out[k] = structuredClone(m.get(k));
      return out;
    },
    /** @param {Record<string, unknown>} items */
    async set(items) {
      for (const [k, v] of Object.entries(items)) m.set(k, structuredClone(v));
    },
    /** @param {string|string[]} keys */
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) m.delete(k);
    },
  };
}

const PROMPT = {
  id: 'p1',
  title: 'Secret shot',
  text: 'a confidential client brief: {hero} in the rain',
  createdAt: 1,
  useCount: 0,
  isFavorite: false,
  categoryId: null,
  tags: ['client-x'],
  aspectRatio: null,
  quality: null,
  lastUsedAt: null,
};
const seed = () => ({
  prompts: [PROMPT],
  snippets: [{ id: 's', text: 'copied secret', createdAt: 1 }],
  variableMemory: { hero: { value: 'Ana', usedAt: 1 } },
  settings: { sortBy: 'name' },
  categories: [{ id: 'c', name: 'Clients', color: '#000000', icon: '•', order: 0 }],
});
/** Every byte stored on "disk" (storage.local), as one string. */
const disk = (/** @type {ReturnType<typeof fakeArea>} */ a) => JSON.stringify([...a.m]);

describe('vault crypto', () => {
  it('seal/open round trip; fresh IV every time', async () => {
    const { key } = await createVault('correct horse battery', FAST);
    const a = await seal(key, { x: [1, 'ü'] });
    const b = await seal(key, { x: [1, 'ü'] });
    expect(a.iv).not.toBe(b.iv);
    expect(await open(key, a)).toEqual({ x: [1, 'ü'] });
  });

  it('wrong passphrase → null; right one unlocks', async () => {
    const { meta } = await createVault('correct horse battery', FAST);
    expect(isVaultMeta(meta)).toBe(true);
    expect(await unlockKey(meta, 'wrong horse battery')).toBeNull();
    expect(await unlockKey(meta, 'correct horse battery')).not.toBeNull();
  });

  it('tampered ciphertext fails (GCM tag)', async () => {
    const { key } = await createVault('correct horse battery', FAST);
    const s = await seal(key, 'hello');
    const bytes = atob(s.ct).split('');
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 1);
    await expect(open(key, { iv: s.iv, ct: btoa(bytes.join('')) })).rejects.toThrow();
  });

  it('short passphrases are refused; production uses 250k iterations', async () => {
    await expect(createVault('short', FAST)).rejects.toThrow(/at least 8/);
    const { meta } = await createVault('long enough pass');
    expect(meta.kdf.iterations).toBe(250_000);
  });
});

describe('secure area', () => {
  /** @param {number} [t] */
  const setup = (t = 0) => {
    const local = fakeArea(seed());
    const session = fakeArea();
    let clock = t;
    const area = createSecureArea({ local, session, now: () => clock });
    return { local, session, area, tick: (/** @type {number} */ ms) => (clock += ms) };
  };

  it('off: plain pass-through', async () => {
    const { area } = setup();
    expect(await area.status()).toBe('off');
    expect((await area.get(['prompts'])).prompts).toEqual([PROMPT]);
  });

  it('enable: no plaintext secret on disk; reads decrypt; plain keys untouched', async () => {
    const { local, area } = setup();
    await area.enable('correct horse battery', FAST);
    expect(await area.status()).toBe('unlocked');
    const bytes = disk(local);
    for (const needle of [
      'confidential client brief',
      'copied secret',
      'Ana',
      'Secret shot',
      'client-x',
    ])
      expect(bytes).not.toContain(needle);
    for (const k of SECRET_KEYS) expect(local.m.has(k)).toBe(false);
    expect(local.m.has(sealedKey('prompts'))).toBe(true);
    expect(bytes).toContain('Clients'); // categories/settings stay plain (lock screen, content script)
    const got = await area.get(['prompts', 'snippets', 'variableMemory', 'settings']);
    expect(got.prompts).toEqual([PROMPT]);
    expect(got.variableMemory).toEqual({ hero: { value: 'Ana', usedAt: 1 } });
    expect(got.settings).toEqual({ sortBy: 'name' });
    expect(Object.keys(got).some((k) => k.startsWith('vault_'))).toBe(false);
  });

  it('readAll/writeAll work unchanged on the secure area', async () => {
    const { local, area } = setup();
    await area.enable('correct horse battery', FAST);
    const lib = await readAll(area);
    expect(lib.prompts.map((p) => p.title)).toEqual(['Secret shot']);
    await writeAll(area, {
      prompts: [...lib.prompts, { ...PROMPT, id: 'p2', title: 'Second secret' }],
    });
    expect(disk(local)).not.toContain('Second secret');
    expect((await readAll(area)).prompts).toHaveLength(2);
  });

  it('locked: secret reads/writes throw, plain keys still work; unlock restores', async () => {
    const { area } = setup();
    await area.enable('correct horse battery', FAST);
    await area.lock();
    expect(await area.status()).toBe('locked');
    await expect(area.get(['prompts'])).rejects.toBeInstanceOf(VaultLockedError);
    await expect(area.set({ snippets: [] })).rejects.toBeInstanceOf(VaultLockedError);
    expect((await area.get(['settings'])).settings).toEqual({ sortBy: 'name' });
    await area.set({ settings: { sortBy: 'recent' } });
    expect(await area.unlock('nope nope nope')).toBe(false);
    expect(await area.unlock('correct horse battery')).toBe(true);
    expect((await area.get(['prompts'])).prompts).toEqual([PROMPT]);
  });

  it('auto-locks after idle minutes; activity keeps it open', async () => {
    const { area, tick } = setup();
    await area.enable('correct horse battery', { ...FAST, idleMinutes: 15 });
    tick(10 * 60_000);
    expect(await area.status()).toBe('unlocked'); // access touches the clock
    tick(10 * 60_000);
    expect(await area.status()).toBe('unlocked');
    tick(16 * 60_000);
    expect(await area.status()).toBe('locked');
  });

  it('a new area (e.g. restarted worker) reuses the session key; empty session = locked', async () => {
    const { local, session, area } = setup();
    await area.enable('correct horse battery', FAST);
    const again = createSecureArea({ local, session, now: () => 0 });
    expect((await again.get(['prompts'])).prompts).toEqual([PROMPT]);
    const restarted = createSecureArea({ local, session: fakeArea(), now: () => 0 });
    expect(await restarted.status()).toBe('locked');
  });

  it('disable: plaintext restored, vault keys gone, session cleared', async () => {
    const { local, session, area } = setup();
    await area.enable('correct horse battery', FAST);
    await area.set({ variableMemory: { lens: { value: '35mm', usedAt: 2 } } });
    await area.disable();
    expect(await area.status()).toBe('off');
    expect(local.m.get('prompts')).toEqual([PROMPT]);
    expect(local.m.get('variableMemory')).toEqual({ lens: { value: '35mm', usedAt: 2 } });
    expect([...local.m.keys()].some((k) => k.startsWith('vault'))).toBe(false);
    expect(session.m.size).toBe(0);
  });

  it('unsupported without storage.session; enabling twice is refused', async () => {
    const plain = createSecureArea({ local: fakeArea(), session: null });
    expect(await plain.status()).toBe('unsupported');
    await expect(plain.enable('correct horse battery', FAST)).rejects.toThrow();
    const { area } = setup();
    await area.enable('correct horse battery', FAST);
    await expect(area.enable('correct horse battery', FAST)).rejects.toThrow(/already/);
  });
});
