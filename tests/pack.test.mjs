import { describe, expect, it } from 'vitest';
import { planMigration, readFile } from '../src/lib/migrate.js';
import {
  MAX_PACK_BYTES,
  MAX_PACK_PROMPTS,
  PACK_FORMAT,
  buildPack,
  packFileName,
  parsePack,
} from '../src/lib/pack.js';

/** @typedef {import('../src/lib/storage.js').Prompt} Prompt */

/**
 * @param {string} id
 * @param {Partial<Prompt>} [extra]
 * @returns {Prompt}
 */
const P = (id, extra = {}) => ({
  id,
  title: `T${id}`,
  text: `text ${id} with {subject}`,
  categoryId: 'k1',
  tags: ['neon'],
  createdAt: 100,
  useCount: 9,
  isFavorite: true,
  aspectRatio: '16:9',
  quality: 'high',
  lastUsedAt: 500,
  versions: [{ text: 'old', title: 'old', editedAt: 50 }],
  ...extra,
});
const cats = [
  { id: 'k1', name: 'Lighting', color: '#f59e0b', icon: '💡', order: 0 },
  { id: 'k2', name: 'Unused', color: '#000000', icon: '•', order: 1 },
];
/** @type {import('../src/lib/composition.js').Composition} */
const composition = {
  joiner: ', ',
  blocks: [{ id: 'b', slot: 'lighting', promptId: null, text: 'neon', muted: false }],
};
const lib = { prompts: [P('a'), P('b', { composition, categoryId: null })], categories: cats };
let n = 0;
const newId = () => `n${++n}`;

describe('buildPack', () => {
  it('only chosen prompts and the categories they use; personal data stripped', () => {
    const pack = buildPack(lib, ['b', 'a', 'missing'], {
      name: ' Neon kit ',
      author: 'DPF',
      now: 7,
    });
    expect(pack).toMatchObject({
      format: PACK_FORMAT,
      v: 1,
      name: 'Neon kit',
      author: 'DPF',
      createdAt: 7,
    });
    expect(pack.prompts.map((p) => p.id)).toEqual(['b', 'a']);
    expect(pack.categories.map((c) => c.id)).toEqual(['k1']);
    for (const p of pack.prompts) {
      expect(p).toMatchObject({ useCount: 0, lastUsedAt: null, isFavorite: false, createdAt: 7 });
      expect('versions' in p).toBe(false);
    }
    expect('description' in pack).toBe(false);
  });

  it('packFileName slugs the name', () => {
    expect(packFileName('Néon Noir: Kit #1!')).toBe('neon-noir-kit-1.prompty');
    expect(packFileName('***')).toBe('prompty-pack.prompty');
  });
});

describe('round trip', () => {
  it('export → parse is lossless field by field (for what a pack carries)', () => {
    const pack = buildPack(lib, ['a', 'b'], {
      name: 'Kit',
      description: 'For night scenes',
      now: 7,
    });
    const parsed = parsePack(JSON.stringify(pack));
    expect(parsed).toEqual({ ok: true, pack });
  });

  it('import through G11: added once, composition kept, category joined by name', () => {
    const pack = buildPack(lib, ['a', 'b'], { name: 'Kit', now: 7 });
    const file = readFile('kit.prompty', JSON.stringify(pack));
    expect(file.format).toBe('pack');
    expect(file.pack?.name).toBe('Kit');
    const target = {
      prompts: [],
      categories: [{ id: 'mine', name: 'lighting', color: '#111111', icon: '💡', order: 0 }],
    };
    const first = planMigration(target, file.candidates, { newId });
    expect(first.report.added).toEqual(['Ta', 'Tb']);
    expect(first.report.categoriesAdded).toEqual([]);
    expect(first.prompts[0].categoryId).toBe('mine');
    expect(first.prompts[1].composition).toEqual(composition);
    const again = planMigration(first, file.candidates, { newId });
    expect(again.report.added).toEqual([]);
  });

  it('a pack saved as .json is still recognized by its format field', () => {
    const pack = buildPack(lib, ['a'], { name: 'Kit' });
    expect(readFile('kit.json', JSON.stringify(pack)).format).toBe('pack');
  });
});

describe('malicious or broken packs are rejected', () => {
  const ok = buildPack(lib, ['a'], { name: 'Kit', now: 1 });
  /** @param {Record<string, unknown>} patch */
  const withPatch = (patch) => JSON.stringify({ ...ok, ...patch });
  it.each([
    ['not JSON', '{nope', 'not valid JSON'],
    ['not a pack', '{"prompts":[]}', 'Not a Prompty pack'],
    ['future version', withPatch({ v: 2 }), 'version 2'],
    ['no prompt list', withPatch({ prompts: 'x' }), 'no prompt list'],
    ['prompt is not an object', withPatch({ prompts: [42] }), 'invalid prompt'],
    ['prompt without text', withPatch({ prompts: [{ title: 'x' }] }), 'without text'],
    [
      'too many prompts',
      withPatch({ prompts: Array(MAX_PACK_PROMPTS + 1).fill({ text: 'x' }) }),
      'more than',
    ],
    ['too many categories', withPatch({ categories: Array(101).fill(cats[0]) }), 'more than 100'],
    ['oversize', ' '.repeat(MAX_PACK_BYTES + 1), 'too large'],
  ])('%s', (_label, text, error) => {
    const out = parsePack(text);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain(error);
    expect(readFile('x.prompty', text).candidates).toEqual([]);
  });

  it('prototype keys and unknown fields are dropped; script strings stay inert text', () => {
    const evil =
      '{"format":"prompty-pack","v":1,"name":"<img src=x onerror=alert(1)>",' +
      '"__proto__":{"polluted":true},"prompts":[{"text":"<script>alert(1)</script>",' +
      '"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"evil":"y"}],"categories":[]}';
    const out = parsePack(evil);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.pack.name).toBe('<img src=x onerror=alert(1)>');
    expect(out.pack.prompts[0].text).toBe('<script>alert(1)</script>');
    expect(Object.keys(out.pack.prompts[0])).not.toContain('evil');
    expect(/** @type {any} */ ({}).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(out.pack)).toBe(Object.prototype);
  });
});
