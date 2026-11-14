// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startBridge } from '../mcp/lib/bridge.mjs';
import { openStore } from '../mcp/lib/store.mjs';

const NOW = 1_700_000_000_000;
/** @type {Array<{ close: () => Promise<void> }>} */
const open = [];
/** @type {string[]} */
const homes = [];

async function bridge() {
  const home = await mkdtemp(join(tmpdir(), 'prompty-bridge-'));
  homes.push(home);
  let i = 0;
  const store = await openStore({
    home,
    now: () => NOW,
    newId: () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`,
  });
  const server = await startBridge({ store, token: store.token, port: 0 });
  open.push(server);
  /** @param {string} path @param {RequestInit} [init] */
  const call = (path, init = {}) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      ...init,
      headers: {
        'X-Prompty-Token': store.token,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  return { store, server, call };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('auth', () => {
  it('rejects every route without the token', async () => {
    const { server } = await bridge();
    for (const [method, path] of [
      ['GET', '/health'],
      ['GET', '/pending'],
      ['POST', '/ack'],
      ['POST', '/snapshot'],
    ]) {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('rejects a wrong token', async () => {
    const { server } = await bridge();
    const res = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { 'X-Prompty-Token': 'f'.repeat(48) },
    });
    expect(res.status).toBe(401);
  });

  it('never echoes the token in a response', async () => {
    const { call, store } = await bridge();
    const text = await (await call('/health')).text();
    expect(text).not.toContain(store.token);
  });
});

describe('routes', () => {
  it('reports health and pending counts', async () => {
    const { call, store } = await bridge();
    await store.savePrompt({ text: 'queued' });
    const health = await (await call('/health')).json();
    expect(health).toMatchObject({ ok: true, name: 'prompty-mcp', protocol: 1, pending: 1, prompts: 1 });
    expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('serves pending prompts without internal bookkeeping fields', async () => {
    const { call, store } = await bridge();
    await store.savePrompt({ text: 'queued', category: 'Camera' });
    const pending = await (await call('/pending')).json();
    expect(pending.prompts).toHaveLength(1);
    expect(pending.categories.map((c) => c.name)).toEqual(['Camera']);
    expect(pending.prompts[0]).not.toHaveProperty('syncedAt');
    expect(pending.prompts[0]).not.toHaveProperty('source');
  });

  it('acks ids', async () => {
    const { call, store } = await bridge();
    const { prompt } = await store.savePrompt({ text: 'queued' });
    const res = await (await call('/ack', { method: 'POST', body: JSON.stringify({ ids: [prompt.id] }) })).json();
    expect(res).toEqual({ ok: true, acked: 1 });
    expect(store.pending().prompts).toEqual([]);
  });

  it('merges a snapshot from the extension', async () => {
    const { call, store } = await bridge();
    const res = await (
      await call('/snapshot', {
        method: 'POST',
        body: JSON.stringify({
          prompts: [{ id: 'ext-1', title: 'From browser', text: 'library body' }],
          categories: [{ id: 'cat-1', name: 'Browser' }],
        }),
      })
    ).json();
    expect(res).toEqual({ ok: true, stored: 1 });
    expect(store.listPrompts()[0].source).toBe('extension');
  });

  it('rejects wrong methods', async () => {
    const { call, server } = await bridge();
    expect((await call('/health', { method: 'POST' })).status).toBe(405);
    expect((await call('/ack')).status).toBe(405);
    const missing = await fetch(`http://127.0.0.1:${server.port}/nope`, {
      headers: { 'X-Prompty-Token': (await call('/health')).headers.get('x-test') ?? 'x' },
    });
    expect([401, 404]).toContain(missing.status);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const { call } = await bridge();
    const bad = await call('/ack', { method: 'POST', body: '{ nope' });
    expect(bad.status).toBe(400);

    const huge = await call('/snapshot', {
      method: 'POST',
      body: JSON.stringify({ prompts: [{ id: 'a', text: 'x'.repeat(1_048_577) }] }),
    });
    expect(huge.status).toBe(413);
  });

  it('sends no CORS headers and no-store caching', async () => {
    const { call } = await bridge();
    const res = await call('/health');
    expect(res.headers.get('access-control-allow-origin')).toBe(null);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
