// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../mcp/lib/store.mjs';
import { createTools, toolDefinitions } from '../mcp/lib/tools.mjs';
import { parseVariables } from '../mcp/lib/variables.mjs';

const NOW = 1_700_000_000_000;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** @type {string[]} */
const homes = [];

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'prompty-tools-'));
  homes.push(home);
  let i = 0;
  const store = await openStore({
    home,
    now: () => NOW,
    newId: () => id(++i),
  });
  return { home, store, tools: createTools(store) };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('tool definitions', () => {
  it('exposes the agent-facing tools with JSON schemas', () => {
    const names = toolDefinitions.map((t) => t.name).sort();
    expect(names).toEqual([
      'bridge_status',
      'delete_document',
      'delete_prompt',
      'get_document',
      'get_prompt',
      'get_shot',
      'list_categories',
      'list_documents',
      'list_projects',
      'list_prompts',
      'save_document',
      'save_prompt',
      'search_prompts',
      'update_prompt',
    ]);
    for (const tool of toolDefinitions) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
    const save = toolDefinitions.find((t) => t.name === 'save_prompt');
    expect(save?.inputSchema.required).toEqual(['text']);
    expect(save?.description).toMatch(/\{subject\}/);
  });
});

describe('parseVariables', () => {
  it('reads text, choice, range and default tokens', () => {
    const specs = parseVariables(
      'A {subject} shot with {lens:24mm|50mm} at {seed:1-999}, mood {mood=neutral}',
    );
    expect(specs.map((s) => [s.name, s.kind])).toEqual([
      ['subject', 'text'],
      ['lens', 'choice'],
      ['seed', 'range'],
      ['mood', 'text'],
    ]);
  });

  it('ignores malformed tokens and duplicates', () => {
    expect(parseVariables('{a:} {b:5-1} {c|d} {2x} {ok} {ok:again}')).toEqual([
      { name: 'ok', kind: 'text' },
    ]);
    expect(parseVariables(null)).toEqual([]);
  });
});

describe('save_prompt', () => {
  it('saves a prompt and reports category and variables back to the agent', async () => {
    const { tools, store } = await setup();
    const result = await tools.call('save_prompt', {
      title: 'Dolly zoom',
      text: 'A slow dolly zoom on {subject} with {lens:24mm|35mm}',
      category: 'Camera Movement',
      tags: ['camera', 'movement'],
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/saved/i);
    expect(result.content[0].text).toContain('Dolly zoom');
    expect(result.structuredContent).toMatchObject({
      title: 'Dolly zoom',
      category: 'Camera Movement',
      tags: ['camera', 'movement'],
      pending: true,
    });
    expect(result.structuredContent.variables.map((v) => v.name)).toEqual(['subject', 'lens']);
    expect(store.listPrompts()).toHaveLength(1);
  });

  it('derives a title when none is given', async () => {
    const { tools } = await setup();
    const result = await tools.call('save_prompt', {
      text: 'Golden hour close-up\nwith rim light',
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.title).toBe('Golden hour close-up');
  });

  it('returns an error result (not a throw) for a missing body', async () => {
    const { tools } = await setup();
    const result = await tools.call('save_prompt', { title: 'No body' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/text/i);
  });

  it('does not duplicate a prompt with identical text', async () => {
    const { tools, store } = await setup();
    await tools.call('save_prompt', { text: 'slow dolly zoom' });
    const second = await tools.call('save_prompt', { title: 'Again', text: 'Slow  DOLLY zoom' });
    expect(second.structuredContent.created).toBe(false);
    expect(store.listPrompts()).toHaveLength(1);
  });
});

describe('list, search and get', () => {
  it('lists prompts with filters and a limit', async () => {
    const { tools } = await setup();
    await tools.call('save_prompt', { text: 'one', category: 'Camera' });
    await tools.call('save_prompt', { text: 'two', category: 'Lighting' });
    await tools.call('save_prompt', { text: 'three', tags: ['camera'] });

    const all = await tools.call('list_prompts', {});
    expect(all.structuredContent.total).toBe(3);

    const camera = await tools.call('list_prompts', { category: 'camera' });
    expect(camera.structuredContent.prompts.map((p) => p.title)).toEqual(['one']);

    const tagged = await tools.call('list_prompts', { tag: 'CAMERA' });
    expect(tagged.structuredContent.prompts.map((p) => p.title)).toEqual(['three']);

    const limited = await tools.call('list_prompts', { limit: 2 });
    expect(limited.structuredContent.prompts).toHaveLength(2);
    expect(limited.structuredContent.total).toBe(3);
  });

  it('searches title, body and tags', async () => {
    const { tools } = await setup();
    await tools.call('save_prompt', { title: 'Dolly zoom', text: 'push in slowly' });
    await tools.call('save_prompt', { title: 'Rim light', text: 'backlight edge', tags: ['lighting'] });

    const byTitle = await tools.call('search_prompts', { query: 'dlz' });
    expect(byTitle.structuredContent.prompts[0].title).toBe('Dolly zoom');

    const byText = await tools.call('search_prompts', { query: 'backlight' });
    expect(byText.structuredContent.prompts[0].title).toBe('Rim light');

    const byTag = await tools.call('search_prompts', { query: 'lighting' });
    expect(byTag.structuredContent.prompts[0].title).toBe('Rim light');

    const none = await tools.call('search_prompts', { query: 'zzzz' });
    expect(none.structuredContent.prompts).toEqual([]);
    expect(none.content[0].text).toMatch(/no prompts/i);
  });

  it('returns the full text for one id and errors on unknown ids', async () => {
    const { tools, store } = await setup();
    const saved = await tools.call('save_prompt', { text: 'full body here' });
    const got = await tools.call('get_prompt', { id: saved.structuredContent.id });
    expect(got.structuredContent.text).toBe('full body here');
    const missing = await tools.call('get_prompt', { id: 'nope' });
    expect(missing.isError).toBe(true);
    expect(store.listPrompts()).toHaveLength(1);
  });
});

describe('update and delete', () => {
  it('updates fields', async () => {
    const { tools } = await setup();
    const saved = await tools.call('save_prompt', { text: 'draft' });
    const updated = await tools.call('update_prompt', {
      id: saved.structuredContent.id,
      title: 'Final',
      text: 'final body',
      tags: ['done'],
    });
    expect(updated.structuredContent).toMatchObject({ title: 'Final', text: 'final body' });
  });

  it('reports unknown ids and never throws', async () => {
    const { tools } = await setup();
    for (const call of [
      ['update_prompt', { id: 'x', title: 'y' }],
      ['delete_prompt', { id: 'x' }],
    ]) {
      const result = await tools.call(call[0], call[1]);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not found/i);
    }
  });

  it('deletes a prompt', async () => {
    const { tools, store } = await setup();
    const saved = await tools.call('save_prompt', { text: 'bye' });
    const result = await tools.call('delete_prompt', { id: saved.structuredContent.id });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.deleted).toBe(true);
    expect(store.listPrompts()).toEqual([]);
  });
});

describe('categories and bridge status', () => {
  it('lists categories with counts', async () => {
    const { tools } = await setup();
    await tools.call('save_prompt', { text: 'a', category: 'Camera' });
    await tools.call('save_prompt', { text: 'b', category: 'Camera' });
    await tools.call('save_prompt', { text: 'c', category: 'Lighting' });
    const result = await tools.call('list_categories', {});
    expect(result.structuredContent.categories).toEqual([
      expect.objectContaining({ name: 'Camera', count: 2 }),
      expect.objectContaining({ name: 'Lighting', count: 1 }),
    ]);
  });

  it('returns pairing info the user can paste into Prompty', async () => {
    const { tools } = await setup();
    await tools.call('save_prompt', { text: 'pending' });
    const result = await tools.call('bridge_status', {});
    expect(result.structuredContent).toMatchObject({
      running: true,
      port: 47821,
      pending: 1,
      prompts: 1,
    });
    expect(result.structuredContent.url).toBe('http://127.0.0.1:47821');
    expect(result.structuredContent.token).toMatch(/^[a-f0-9]{48}$/);
  });
});

describe('unknown tools', () => {
  it('rejects an unknown tool name', async () => {
    const { tools } = await setup();
    await expect(tools.call('nope', {})).rejects.toThrow(/unknown tool/i);
  });
});
