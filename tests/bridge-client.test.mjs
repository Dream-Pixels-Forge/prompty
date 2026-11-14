import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_STATUS_KEY, syncBridge } from '../src/lib/bridge-client.js';
import { readAll } from '../src/lib/storage.js';

const NOW = 1_700_000_000_000;
/** @param {number} n */
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Minimal storage area with the get/set surface storage.js needs.
 * @param {Record<string, unknown>} [initial]
 */
function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    /** @param {unknown} keys */
    async get(keys) {
      if (keys === undefined || keys === null) return { ...data };
      const list = /** @type {string[]} */ (Array.isArray(keys) ? keys : [keys]);
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    },
    /** @param {Record<string, unknown>} patch */
    async set(patch) {
      Object.assign(data, patch);
    },
  };
}

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * @param {{ pending?: unknown, health?: unknown, snapshot?: unknown, ack?: unknown, fail?: boolean }} [plan]
 */
function fakeFetch(plan = {}) {
  /** @type {Array<{ path: string, init: any }>} */
  const calls = [];
  const impl = vi.fn(async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, init });
    if (plan.fail) throw new TypeError('Failed to fetch');
    if (path === '/pending') return json(plan.pending ?? { prompts: [], categories: [], deleted: [] });
    if (path === '/ack') return json(plan.ack ?? { ok: true, acked: 1 });
    if (path === '/snapshot') return json(plan.snapshot ?? { ok: true, stored: 1 });
    if (path === '/health') return json(plan.health ?? { ok: true, version: '0.5.0', pending: 0 });
    return json({ error: 'not found' }, 404);
  });
  return { impl, calls };
}

const CONFIG = {
  enabled: true,
  url: 'http://127.0.0.1:47821',
  token: 'a'.repeat(48),
};

describe('syncBridge', () => {
  it('does nothing when the bridge is off', async () => {
    const { impl, calls } = fakeFetch();
    const area = memoryArea({ prompts: [], categories: [], settings: {} });
    const result = await syncBridge(area, { ...CONFIG, enabled: false }, { fetchImpl: impl, now: NOW });
    expect(result).toMatchObject({ ok: false, reason: 'disabled' });
    expect(calls).toHaveLength(0);
  });

  it('requires a token', async () => {
    const { impl, calls } = fakeFetch();
    const area = memoryArea({});
    const result = await syncBridge(area, { ...CONFIG, token: '  ' }, { fetchImpl: impl, now: NOW });
    expect(result).toMatchObject({ ok: false, reason: 'not-configured' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-loopback URL without making a request', async () => {
    const { impl, calls } = fakeFetch();
    const area = memoryArea({});
    const result = await syncBridge(
      area,
      { ...CONFIG, url: 'https://collect.example.com' },
      { fetchImpl: impl, now: NOW },
    );
    expect(result).toMatchObject({ ok: false, reason: 'bad-url' });
    expect(calls).toHaveLength(0);
  });

  it('pulls pending prompts, imports them, acks, then snapshots', async () => {
    const { impl, calls } = fakeFetch({
      pending: {
        prompts: [
          {
            id: id(1),
            title: 'Dolly zoom',
            text: 'A slow dolly zoom on {subject}',
            createdAt: NOW,
            tags: ['camera'],
          },
          { id: id(2), title: 'Duplicate', text: 'already here' },
        ],
        categories: [],
        deleted: [],
      },
    });
    const area = memoryArea({
      prompts: [
        {
          id: id(9),
          title: 'Existing',
          text: 'already   here',
          createdAt: NOW,
          useCount: 3,
          isFavorite: false,
          categoryId: null,
          tags: [],
          aspectRatio: null,
          quality: null,
          lastUsedAt: null,
        },
      ],
      categories: [],
      settings: {},
    });

    const result = await syncBridge(area, CONFIG, { fetchImpl: impl, now: NOW, colors: ['#111'] });

    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(calls.map((c) => c.path)).toEqual(['/pending', '/ack', '/snapshot']);

    const library = await readAll(area);
    expect(library.prompts.map((p) => p.text)).toContain('A slow dolly zoom on {subject}');

    const ack = JSON.parse(String(calls[1].init.body));
    expect(ack.ids.sort()).toEqual([id(1), id(2)].sort());

    const snapshot = JSON.parse(String(calls[2].init.body));
    expect(snapshot.prompts).toHaveLength(2);
    expect(snapshot.categories).toEqual([]);

    for (const call of calls) {
      expect(call.init.headers['X-Prompty-Token']).toBe(CONFIG.token);
    }
    expect(area.data[BRIDGE_STATUS_KEY]).toMatchObject({ ok: true, added: 1, at: NOW });
  });

  it('imports deletions from the bridge', async () => {
    const { impl } = fakeFetch({
      pending: { prompts: [], categories: [], deleted: [{ id: id(1) }] },
    });
    const area = memoryArea({
      prompts: [
        {
          id: id(1),
          title: 'Doomed',
          text: 'delete me',
          createdAt: NOW,
          useCount: 0,
          isFavorite: false,
          categoryId: null,
          tags: [],
          aspectRatio: null,
          quality: null,
          lastUsedAt: null,
        },
      ],
      categories: [],
      settings: {},
    });
    const result = await syncBridge(area, CONFIG, { fetchImpl: impl, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(1);
    expect((await readAll(area)).prompts).toEqual([]);
  });

  it('reports an HTTP failure and leaves the library untouched', async () => {
    const { impl } = fakeFetch();
    const area = memoryArea({ prompts: [], categories: [], settings: {} });
    const unauthorized = vi.fn(async () => json({ error: 'unauthorized' }, 401));
    const result = await syncBridge(area, CONFIG, { fetchImpl: unauthorized, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('http');
    expect(result.error).toMatch(/401/);
    expect(area.data[BRIDGE_STATUS_KEY]).toMatchObject({ ok: false, reason: 'http' });
    expect(await readAll(area)).toMatchObject({ prompts: [] });
    void impl;
  });

  it('captures network errors instead of throwing', async () => {
    const { impl } = fakeFetch({ fail: true });
    const area = memoryArea({});
    const result = await syncBridge(area, CONFIG, { fetchImpl: impl, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network');
    expect(area.data[BRIDGE_STATUS_KEY]).toMatchObject({ ok: false, reason: 'network' });
  });

  it('survives a malformed pending payload', async () => {
    const { impl, calls } = fakeFetch({ pending: { prompts: 'nope' } });
    const area = memoryArea({});
    const result = await syncBridge(area, CONFIG, { fetchImpl: impl, now: NOW });
    expect(result).toMatchObject({ ok: false, reason: 'bad-payload' });
    expect(calls.map((c) => c.path)).toEqual(['/pending']);
  });
});
