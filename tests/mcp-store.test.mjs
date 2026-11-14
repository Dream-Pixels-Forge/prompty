// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_TEXT, openStore } from '../mcp/lib/store.mjs';

const NOW = 1_700_000_000_000;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** @type {string[]} */
const homes = [];

async function tempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'prompty-mcp-'));
  homes.push(dir);
  return dir;
}

/** @param {{ home: string, ids?: string[], now?: () => number }} opts */
async function storeAt({ home, ids = [id(1)], now = () => NOW }) {
  let i = 0;
  return openStore({ home, now, newId: () => ids[i++] ?? id(900 + i) });
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('openStore', () => {
  it('creates the home dir, library file and a 0600 bridge config with a 48-hex token', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    expect(store.path).toBe(join(home, 'library.json'));
    expect(store.pending().prompts).toEqual([]);

    const bridge = JSON.parse(await readFile(join(home, 'bridge.json'), 'utf8'));
    expect(bridge.token).toMatch(/^[a-f0-9]{48}$/);
    expect(bridge.port).toBe(47821);
    expect(store.token).toBe(bridge.token);
    if (process.platform !== 'win32') {
      const mode = (await stat(join(home, 'bridge.json'))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    const library = JSON.parse(await readFile(join(home, 'library.json'), 'utf8'));
    expect(library).toMatchObject({ version: 1, prompts: [], categories: [], tombstones: [] });
  });

  it('persists across reopen', async () => {
    const home = await tempHome();
    const first = await storeAt({ home });
    await first.savePrompt({ title: 'Dolly zoom', text: 'slow zoom on {subject}' });
    const second = await storeAt({ home });
    expect(second.listPrompts()).toHaveLength(1);
    expect(second.listPrompts()[0].title).toBe('Dolly zoom');
  });

  it('recovers from a corrupt library file instead of crashing', async () => {
    const home = await tempHome();
    await storeAt({ home });
    await writeFile(join(home, 'library.json'), '{ not json');
    const store = await storeAt({ home });
    expect(store.listPrompts()).toEqual([]);
    expect(store.recovered).toBe(true);
  });
});

describe('savePrompt', () => {
  it('fills defaults, derives a title and queues the prompt for the bridge', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    const saved = await store.savePrompt({
      text: 'A slow dolly zoom on {subject}\nsecond line',
      tags: ['camera', 'camera', ''],
    });
    expect(saved.created).toBe(true);
    expect(saved.prompt).toMatchObject({
      id: id(1),
      title: 'A slow dolly zoom on {subject}',
      text: 'A slow dolly zoom on {subject}\nsecond line',
      tags: ['camera'],
      source: 'mcp',
      syncedAt: null,
      isFavorite: false,
    });
    expect(store.pending().prompts).toHaveLength(1);
  });

  it('creates a category by name, reusing it case-insensitively', async () => {
    const home = await tempHome();
    const store = await storeAt({ home, ids: ['cat-1', id(1), id(2)] });
    await store.savePrompt({ text: 'one', category: 'Camera Movement' });
    await store.savePrompt({ text: 'two', category: 'camera movement' });
    expect(store.listCategories()).toHaveLength(1);
    expect(store.listPrompts().every((p) => p.categoryId === 'cat-1')).toBe(true);
  });

  it('updates an existing prompt with the same text instead of duplicating it', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    const first = await store.savePrompt({ text: 'Slow dolly zoom' });
    const second = await store.savePrompt({
      title: 'Dolly zoom (slow)',
      text: 'slow   DOLLY zoom',
      tags: ['camera'],
    });
    expect(second.created).toBe(false);
    expect(second.prompt.id).toBe(first.prompt.id);
    expect(store.listPrompts()).toHaveLength(1);
    expect(store.listPrompts()[0].title).toBe('Dolly zoom (slow)');
  });

  it('rejects empty or oversized text and caps tags', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    await expect(store.savePrompt({ text: '   ' })).rejects.toThrow(/text/i);
    await expect(store.savePrompt({ text: 'x'.repeat(MAX_TEXT + 1) })).rejects.toThrow(/too long/i);
    const saved = await store.savePrompt({
      text: 'ok',
      tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
    });
    expect(saved.prompt.tags).toHaveLength(20);
  });
});

describe('update and delete', () => {
  it('updates fields and re-queues the prompt', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    const { prompt } = await store.savePrompt({ text: 'before', tags: ['a'] });
    await store.ack([prompt.id]);
    expect(store.pending().prompts).toHaveLength(0);

    const updated = await store.updatePrompt(prompt.id, {
      title: 'After',
      text: 'after',
      tags: ['b'],
      favorite: true,
    });
    expect(updated).toMatchObject({ title: 'After', text: 'after', tags: ['b'], isFavorite: true });
    expect(store.pending().prompts).toHaveLength(1);
  });

  it('rejects updates for unknown ids', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    await expect(store.updatePrompt(id(7), { title: 'x' })).rejects.toThrow(/not found/i);
  });

  it('tombstones deletions until the extension acks them', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    const { prompt } = await store.savePrompt({ text: 'delete me' });
    await store.ack([prompt.id]);
    await store.deletePrompt(prompt.id);
    expect(store.listPrompts()).toEqual([]);
    expect(store.pending().deleted).toEqual([{ id: prompt.id }]);

    await store.ack([prompt.id]);
    expect(store.pending().deleted).toEqual([]);
  });
});

describe('snapshot and ack', () => {
  it('merges the extension library and keeps unsynced agent prompts', async () => {
    const home = await tempHome();
    const store = await storeAt({ home, ids: [id(1), id(2)] });
    const unsynced = await store.savePrompt({ text: 'agent prompt' });
    await store.ack([unsynced.prompt.id]);
    const queued = await store.savePrompt({ text: 'not imported yet' });

    await store.snapshot({
      prompts: [
        { id: id(50), title: 'From extension', text: 'library prompt', tags: ['x'] },
        { id: unsynced.prompt.id, title: 'agent prompt', text: 'agent prompt', tags: ['y'] },
      ],
      categories: [{ id: 'cat-ext', name: 'Extension', color: '#123456' }],
    });

    const all = store.listPrompts();
    expect(all.map((p) => p.text).sort()).toEqual(['agent prompt', 'library prompt', 'not imported yet']);
    expect(all.find((p) => p.id === id(50))?.source).toBe('extension');
    expect(all.find((p) => p.text === 'agent prompt')?.tags).toEqual(['y']);
    expect(store.listCategories().map((c) => c.name)).toEqual(['Extension']);
    expect(store.pending().prompts.map((p) => p.id)).toEqual([queued.prompt.id]);
  });

  it('drops prompts the extension no longer has, except pending ones', async () => {
    const home = await tempHome();
    const store = await storeAt({ home, ids: [id(1), id(2)] });
    const gone = await store.savePrompt({ text: 'deleted in browser' });
    await store.ack([gone.prompt.id]);
    const pending = await store.savePrompt({ text: 'still pending' });

    await store.snapshot({ prompts: [], categories: [] });
    expect(store.listPrompts().map((p) => p.text)).toEqual(['still pending']);
    expect(store.pending().prompts[0].id).toBe(pending.prompt.id);
  });

  it('ignores unknown prompt shapes in a snapshot', async () => {
    const home = await tempHome();
    const store = await storeAt({ home });
    await store.snapshot({ prompts: [null, 'x', { id: 'a' }], categories: 'nope' });
    expect(store.listPrompts()).toEqual([]);
  });
});
