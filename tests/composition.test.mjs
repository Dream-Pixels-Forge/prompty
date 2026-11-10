import { describe, expect, it } from 'vitest';
import {
  MAX_BLOCKS,
  SLOT_IDS,
  TEMPLATES,
  addBlock,
  compose,
  emptyComposition,
  fromTemplate,
  moveBlock,
  normalizeComposition,
  pickPrompt,
  promptsForSlot,
  removeBlock,
  updateBlock,
} from '../src/lib/composition.js';
import { SEED_CATEGORIES, SEED_PROMPT_DEFS, createPresetsInstance } from '../src/lib/presets.js';
import { normalizePrompt } from '../src/lib/storage.js';

/**
 * @typedef {import('../src/lib/storage.js').Prompt} Prompt
 * @typedef {import('../src/lib/composition.js').Composition} Composition
 */

let n = 0;
const newId = () => `id${n++}`;
const seed = createPresetsInstance({
  categoryIds: SEED_CATEGORIES.map((_, i) => `c${i}`),
  promptIds: SEED_PROMPT_DEFS.map((_, i) => `p${i}`),
});
/** @param {string} title */
const byTitle = (title) => /** @type {Prompt} */ (seed.prompts.find((p) => p.title === title));

describe('slots', () => {
  it('follow film-grammar order', () => {
    expect(SLOT_IDS).toEqual([
      'subject',
      'location',
      'camera',
      'lens',
      'composition',
      'lighting',
      'grade',
      'mood',
      'transition',
      'extra',
    ]);
  });

  it('draw prompts from their categories by name; Extra draws from everything', () => {
    const lighting = promptsForSlot('lighting', seed.prompts, seed.categories).map((p) => p.title);
    expect(lighting).toEqual([
      'Golden Hour Backlight',
      'Neon Noir',
      'Rembrandt Portrait',
      'Single Practical Source',
      'Volumetric God Rays',
    ]);
    const camera = promptsForSlot('camera', seed.prompts, seed.categories).map((p) => p.title);
    expect(camera).toContain('Dolly Zoom'); // Camera Movement
    expect(camera).toContain('Wide Shot'); // Camera Angles
    expect(promptsForSlot('extra', seed.prompts, seed.categories)).toHaveLength(
      seed.prompts.length,
    );
  });

  it('a slot whose categories the user deleted offers nothing (free text still works)', () => {
    const noLighting = seed.categories.filter((c) => c.name !== 'Lighting');
    expect(promptsForSlot('lighting', seed.prompts, noLighting)).toEqual([]);
  });
});

describe('compose', () => {
  /** @param {Partial<import('../src/lib/composition.js').Block>[]} blocks @returns {Composition} */
  const comp = (blocks, joiner = /** @type {', '|'. '} */ (', ')) => ({
    joiner,
    blocks: blocks.map((b, i) => ({
      id: `b${i}`,
      slot: 'extra',
      promptId: null,
      text: '',
      muted: false,
      ...b,
    })),
  });

  it('skips muted and empty blocks, trims trailing punctuation, joins in order', () => {
    const out = compose(
      comp([
        { text: 'A dancer spins.  ' },
        { text: '   ' },
        { text: 'muted', muted: true },
        { text: 'neon rain,' },
      ]),
    );
    expect(out).toMatchObject({ text: 'A dancer spins, neon rain', used: 2 });
  });

  it('supports a sentence joiner', () => {
    expect(compose(comp([{ text: 'Wide shot' }, { text: 'Golden hour' }], '. ')).text).toBe(
      'Wide shot. Golden hour',
    );
  });

  it('asks a shared variable once and keeps distinct ones', () => {
    const out = compose(
      comp([
        { text: 'Push in on {subject}' },
        { text: '{subject} lit by {neon:red|blue}' },
        { text: 'shot on {lens}' },
      ]),
    );
    expect(out.variables.map((v) => v.name)).toEqual(['subject', 'neon', 'lens']);
  });

  it('an empty composition composes to nothing', () => {
    expect(compose(emptyComposition(newId))).toEqual({ text: '', used: 0, variables: [] });
  });
});

describe('block operations', () => {
  it('starts with one empty block per slot except Extra', () => {
    const c = emptyComposition(newId);
    expect(c.blocks.map((b) => b.slot)).toEqual(SLOT_IDS.filter((s) => s !== 'extra'));
  });

  it('adds blocks in film order and caps the count', () => {
    let c = /** @type {Composition} */ ({ joiner: ', ', blocks: [] });
    c = addBlock(c, 'lighting', 'L');
    c = addBlock(c, 'subject', 'S');
    c = addBlock(c, 'extra', 'X');
    c = addBlock(c, 'camera', 'C');
    c = addBlock(c, 'subject', 'S2');
    expect(c.blocks.map((b) => b.id)).toEqual(['S', 'S2', 'C', 'L', 'X']);
    for (let i = 0; i < MAX_BLOCKS; i++) c = addBlock(c, 'extra', `x${i}`);
    expect(c.blocks).toHaveLength(MAX_BLOCKS);
  });

  it('moves, mutes, edits and removes', () => {
    let c = emptyComposition(newId);
    const [a, b] = c.blocks;
    c = moveBlock(c, a.id, 1);
    expect(c.blocks[1].id).toBe(a.id);
    expect(moveBlock(c, c.blocks[0].id, -1)).toBe(c);
    c = updateBlock(c, b.id, { muted: true, text: 'x' });
    expect(c.blocks[0]).toMatchObject({ id: b.id, muted: true, text: 'x' });
    c = removeBlock(c, b.id);
    expect(c.blocks.some((x) => x.id === b.id)).toBe(false);
  });

  it('picking a prompt snapshots its text; the snapshot survives the prompt being deleted', () => {
    let c = emptyComposition(newId);
    const neon = byTitle('Neon Noir');
    c = pickPrompt(c, c.blocks[5].id, neon);
    expect(c.blocks[5]).toMatchObject({ promptId: neon.id, text: neon.text });
    // library loses the prompt: the block still composes from its snapshot
    expect(compose(c).text).toBe(neon.text.trim().replace(/[\s.,;:]+$/, ''));
    c = pickPrompt(c, c.blocks[5].id, null);
    expect(c.blocks[5]).toMatchObject({ promptId: null, text: '' });
  });
});

describe('templates', () => {
  it('every template only uses seed prompts that exist', () => {
    for (const t of TEMPLATES) {
      for (const b of t.blocks)
        expect(
          SEED_PROMPT_DEFS.some((d) => d.title === b.title),
          `${t.name}: ${b.title}`,
        ).toBe(true);
    }
  });

  it('builds a composition in film order from the user’s prompts', () => {
    const c = /** @type {Composition} */ (fromTemplate('neon-noir-push-in', seed.prompts, newId));
    expect(c.blocks.map((b) => b.slot)).toEqual([
      'location',
      'camera',
      'lens',
      'lighting',
      'grade',
    ]);
    expect(c.blocks.every((b) => b.promptId && b.text)).toBe(true);
    const shot = compose(c);
    // {subject} appears in two blocks but is asked once
    expect(shot.variables.filter((v) => v.name === 'subject')).toHaveLength(1);
    expect(shot.text).toContain('anamorphic lens');
  });

  it('missing template prompts become empty blocks; unknown templates return null', () => {
    const c = /** @type {Composition} */ (fromTemplate('golden-hour-crane-reveal', [], newId));
    expect(c.blocks.every((b) => b.promptId === null && b.text === '')).toBe(true);
    expect(fromTemplate('nope', seed.prompts, newId)).toBeNull();
  });
});

describe('storage (Prompt.composition)', () => {
  it('normalizeComposition whitelists blocks, slots, joiner and caps sizes', () => {
    const raw = {
      joiner: '; ',
      blocks: [
        { id: 'a', slot: 'camera', promptId: 'p1', text: 'orbit', muted: 'yes' },
        { slot: 'bogus', text: 'x'.repeat(5000) },
        { text: 3 },
        null,
        ...Array.from({ length: 30 }, () => ({ slot: 'mood', text: 'm' })),
      ],
    };
    const c = /** @type {Composition} */ (normalizeComposition(raw));
    expect(c.joiner).toBe(', ');
    expect(c.blocks).toHaveLength(MAX_BLOCKS);
    expect(c.blocks[0]).toEqual({
      id: 'a',
      slot: 'camera',
      promptId: 'p1',
      text: 'orbit',
      muted: false,
    });
    expect(c.blocks[1]).toMatchObject({ slot: 'extra', promptId: null });
    expect(c.blocks[1].text).toHaveLength(4000);
    expect(normalizeComposition({ blocks: [] })).toBeNull();
    expect(normalizeComposition('x')).toBeNull();
  });

  it('normalizePrompt keeps a composition (omitted when invalid), so saved shots round-trip', () => {
    const composition = {
      joiner: '. ',
      blocks: [{ id: 'a', slot: 'lens', promptId: null, text: '85mm', muted: false }],
    };
    const p = /** @type {Prompt} */ (normalizePrompt({ title: 'Shot', text: '85mm', composition }));
    expect(p.composition).toEqual(composition);
    expect(
      'composition' in
        /** @type {Prompt} */ (
          normalizePrompt({ title: 'S', text: 't', composition: { blocks: [] } })
        ),
    ).toBe(false);
  });
});
