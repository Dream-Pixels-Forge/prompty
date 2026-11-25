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

/* ------------------------------------------------------------------ */
/* G15 — projects and documents in packs                              */
/* ------------------------------------------------------------------ */

import { normalizeProject, normalizeDocument } from '../src/lib/documents.js';

const mkProject = (over = {}) =>
  /** @type {import('../src/lib/documents.js').Project} */ (
    normalizeProject({ id: 'proj-1', name: 'GOLDHUNTER', color: '#8b5cf6', icon: '🎬', order: 0, ...over })
  );
const mkDocument = (over = {}) =>
  /** @type {import('../src/lib/documents.js').Document} */ (
    normalizeDocument({
      id: 'doc-1',
      projectId: 'proj-1',
      title: 'PROMPTS v3',
      kind: 'prompt-sheet',
      markdown: '## G01 — Shot\n```muse\nprompt\n```\n',
      createdAt: 1000,
      updatedAt: 2000,
      ...over,
    })
  );

describe('packs carry projects and documents (G15)', () => {
  it('buildPack includes projects and documents when provided', () => {
    const project = mkProject();
    const document = mkDocument();
    const pack = buildPack(lib, ['a'], {
      name: 'Kit',
      projects: [project],
      documents: [document],
    });
    expect(pack.projects).toEqual([project]);
    expect(pack.documents).toEqual([document]);
  });

  it('buildPack omits projects/documents when not provided', () => {
    const pack = buildPack(lib, ['a'], { name: 'Kit' });
    expect('projects' in pack).toBe(false);
    expect('documents' in pack).toBe(false);
  });

  it('buildPack strips document versions (history never leaves in a pack)', () => {
    const document = mkDocument({ versions: [{ markdown: 'old', updatedAt: 999 }] });
    const pack = buildPack(lib, ['a'], { name: 'Kit', documents: [document] });
    const documents = pack.documents ?? [];
    expect(documents).toHaveLength(1);
    expect('versions' in documents[0]).toBe(false);
    expect(documents[0].markdown).toBe(document.markdown);
  });

  it('parsePack reads projects and documents when present', () => {
    const project = mkProject();
    const document = mkDocument();
    const pack = buildPack(lib, ['a'], { name: 'Kit', projects: [project], documents: [document] });
    const parsed = parsePack(JSON.stringify(pack));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.projects).toEqual([project]);
    expect(parsed.pack.documents).toEqual([document]);
  });

  it('parsePack tolerates packs without projects/documents (older packs)', () => {
    const pack = buildPack(lib, ['a'], { name: 'Kit' });
    const parsed = parsePack(JSON.stringify(pack));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.projects).toBeUndefined();
    expect(parsed.pack.documents).toBeUndefined();
  });

  it('parsePack rejects a document with an invalid kind', () => {
    const project = mkProject();
    const bad = /** @type {any} */ ({ ...mkDocument(), kind: 'novel' });
    const pack = buildPack(lib, ['a'], { name: 'Kit', projects: [project], documents: [bad] });
    const parsed = parsePack(JSON.stringify(pack));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain('document');
  });

  it('parsePack rejects an oversized document markdown', () => {
    const big = { ...mkDocument(), markdown: 'x'.repeat(513 * 1024) };
    const pack = buildPack(lib, ['a'], { name: 'Kit', documents: [big] });
    const parsed = parsePack(JSON.stringify(pack));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain('too');
  });

  it('round trip export → parse keeps projects and documents field by field', () => {
    const project = mkProject();
    const document = mkDocument({ versions: [{ markdown: 'v1', updatedAt: 999 }] });
    const pack = buildPack(lib, ['a'], { name: 'Kit', projects: [project], documents: [document] });
    const parsed = parsePack(JSON.stringify(pack));
    expect(parsed).toEqual({ ok: true, pack });
  });
});
