import { describe, expect, it } from 'vitest';
import { compose } from '../src/lib/composition.js';
import { SEED_CATEGORIES, SEED_PROMPT_DEFS, createPresetsInstance } from '../src/lib/presets.js';
import {
  CUTS,
  DEFAULT_DURATION,
  MAX_DURATION,
  MAX_SHOTS,
  addShot,
  composeSequence,
  duplicateShot,
  emptySequence,
  fromSequenceTemplate,
  moveShot,
  normalizeSequence,
  normalizeStoredComposition,
  removeShot,
  sequenceFrom,
  setShotComposition,
  storedComposition,
  timeline,
  updateShot,
} from '../src/lib/sequence.js';
import { normalizePrompt } from '../src/lib/storage.js';

/**
 * @typedef {import('../src/lib/composition.js').Composition} Composition
 * @typedef {import('../src/lib/sequence.js').Sequence} Sequence
 */

let n = 0;
const newId = () => `id${++n}`;

/**
 * @param {...string} texts
 * @returns {Composition}
 */
const comp = (...texts) => ({
  joiner: ', ',
  blocks: texts.map((text, i) => ({
    id: `b${i}`,
    slot: 'extra',
    promptId: null,
    text,
    muted: false,
  })),
});

/**
 * @param {[string, number, string][]} shots text, duration, cut
 * @param {string} [format]
 * @returns {Sequence}
 */
const seqOf = (shots, format = 'timecoded') => ({
  format,
  shots: shots.map(([text, duration, cut], i) => ({
    id: `s${i}`,
    duration,
    cut,
    composition: text ? comp(text) : comp(),
  })),
});

describe('composeSequence', () => {
  it('single shot is exactly the G9 shot (no timecodes)', () => {
    const c = comp('a hero, ', 'neon rain.');
    const seq = emptySequence(c, 's1');
    const out = composeSequence(seq);
    expect(out.text).toBe(compose(c).text);
    expect(out).toMatchObject({ used: 1, duration: DEFAULT_DURATION });
  });

  it('timecoded: running timecodes and the cut phrase of the previous shot', () => {
    const seq = seqOf([
      ['raindrop on an eyelash', 4, 'match'],
      ['neon sign in the rain.', 3, 'smash'],
      ['tiny figure on a salt flat', 5, 'cut'],
    ]);
    expect(composeSequence(seq)).toMatchObject({
      text:
        'Shot 1 (0–4s): raindrop on an eyelash.\n' +
        'Match cut to Shot 2 (4–7s): neon sign in the rain.\n' +
        'Smash cut to Shot 3 (7–12s): tiny figure on a salt flat.',
      used: 3,
      duration: 12,
    });
  });

  it('empty shots are skipped; timecodes and numbering run over used shots', () => {
    const seq = seqOf([
      ['a', 2, 'whip'],
      ['', 9, 'match'],
      ['b', 3, 'cut'],
    ]);
    const out = composeSequence(seq);
    expect(out.text).toBe('Shot 1 (0–2s): a.\nWhip pan to Shot 2 (2–5s): b.');
    expect(timeline(seq).map((u) => [u.n, u.start, u.end])).toEqual([
      [1, 0, 2],
      [2, 2, 5],
    ]);
  });

  it('every cut has a phrase and a script line', () => {
    for (const cut of CUTS) {
      const out = composeSequence(
        seqOf([
          ['a', 1, cut.id],
          ['b', 1, 'cut'],
        ]),
      );
      expect(out.text).toContain(`${cut.phrase} Shot 2`);
      const script = composeSequence(
        seqOf(
          [
            ['a', 1, cut.id],
            ['b', 1, 'cut'],
          ],
          'script',
        ),
      );
      expect(script.text).toContain(cut.script);
    }
  });

  it('script format', () => {
    const out = composeSequence(
      seqOf(
        [
          ['a', 4, 'dissolve'],
          ['b', 2, 'cut'],
        ],
        'script',
      ),
    );
    expect(out.text).toBe('SHOT 1 — 4s\na.\n\nDISSOLVE TO:\n\nSHOT 2 — 2s\nb.');
  });

  it('one-take ignores cuts', () => {
    const out = composeSequence(
      seqOf(
        [
          ['a', 4, 'smash'],
          ['b', 2, 'match'],
        ],
        'one-take',
      ),
    );
    expect(out.text).toBe(
      'One continuous take, 6s, no cuts. 0–4s: a. Then, without cutting, 4–6s: b.',
    );
    expect(out.text).not.toMatch(/smash|match/i);
  });

  it('variables are merged across shots (continuity)', () => {
    const out = composeSequence(
      seqOf([
        ['{hero} wakes', 2, 'cut'],
        ['{hero} runs, {lens:35mm|85mm}', 2, 'cut'],
      ]),
    );
    expect(out.variables.map((v) => v.name)).toEqual(['hero', 'lens']);
  });

  it('all-empty sequence composes to nothing', () => {
    expect(
      composeSequence(
        seqOf([
          ['', 2, 'cut'],
          ['', 2, 'cut'],
        ]),
      ),
    ).toMatchObject({ text: '', used: 0, duration: 0 });
  });
});

describe('shot operations', () => {
  const base = seqOf([
    ['a', 2, 'cut'],
    ['b', 3, 'cut'],
  ]);

  it('addShot after an id or at the end; capped at MAX_SHOTS', () => {
    expect(addShot(base, 's0', 'new').shots.map((s) => s.id)).toEqual(['s0', 'new', 's1']);
    expect(addShot(base, null, 'new').shots.map((s) => s.id)).toEqual(['s0', 's1', 'new']);
    let full = base;
    for (let i = 0; i < MAX_SHOTS + 3; i++) full = addShot(full, null, `x${i}`);
    expect(full.shots).toHaveLength(MAX_SHOTS);
  });

  it('duplicateShot copies the setup with new ids right after it', () => {
    const d = duplicateShot(base, 's0', newId);
    expect(d.shots).toHaveLength(3);
    expect(d.shots[1].composition.blocks[0].text).toBe('a');
    expect(d.shots[1].id).not.toBe('s0');
    expect(d.shots[1].composition.blocks[0].id).not.toBe(base.shots[0].composition.blocks[0].id);
  });

  it('removeShot never leaves zero shots', () => {
    const one = removeShot(base, 's0');
    expect(one.shots.map((s) => s.id)).toEqual(['s1']);
    expect(removeShot(one, 's1')).toBe(one);
  });

  it('moveShot is a no-op at the edges', () => {
    expect(moveShot(base, 's0', 1).shots.map((s) => s.id)).toEqual(['s1', 's0']);
    expect(moveShot(base, 's0', -1)).toBe(base);
  });

  it('updateShot clamps duration and rejects unknown cuts', () => {
    expect(updateShot(base, 's0', { duration: 999 }).shots[0].duration).toBe(MAX_DURATION);
    expect(updateShot(base, 's0', { duration: 0 }).shots[0].duration).toBe(1);
    expect(updateShot(base, 's0', { duration: 'x' }).shots[0].duration).toBe(DEFAULT_DURATION);
    expect(updateShot(base, 's0', { cut: 'match' }).shots[0].cut).toBe('match');
    expect(updateShot(base, 's0', { cut: 'explode' }).shots[0].cut).toBe('cut');
  });

  it('setShotComposition replaces one shot only', () => {
    const next = setShotComposition(base, 's1', comp('z'));
    expect(next.shots[1].composition.blocks[0].text).toBe('z');
    expect(next.shots[0]).toBe(base.shots[0]);
  });
});

describe('storage', () => {
  it('sequenceFrom wraps a G9 composition as one shot', () => {
    const s = sequenceFrom(comp('a'), newId);
    expect(s?.shots).toHaveLength(1);
    expect(composeSequence(/** @type {Sequence} */ (s)).text).toBe('a');
    expect(sequenceFrom('junk', newId)).toBeNull();
  });

  it('normalizeSequence whitelists and clamps', () => {
    const s = normalizeSequence({
      format: 'weird',
      evil: 1,
      shots: [
        { id: 'a', duration: 500, cut: 'nope', composition: comp('x'), extra: 1 },
        null,
        { duration: 2, cut: 'match', composition: { joiner: '. ', blocks: [] } },
      ],
    });
    expect(s).toEqual({
      format: 'timecoded',
      shots: [
        { id: 'a', duration: MAX_DURATION, cut: 'cut', composition: comp('x') },
        { id: 's2', duration: 2, cut: 'match', composition: { joiner: '. ', blocks: [] } },
      ],
    });
    expect(normalizeSequence({ shots: [] })).toBeNull();
    expect(normalizeSequence(comp('x'))).toBeNull();
  });

  it('normalizeStoredComposition accepts both shapes; all-blank sequence is dropped', () => {
    expect(normalizeStoredComposition(comp('x'))).toEqual(comp('x'));
    const seq = seqOf([
      ['a', 2, 'cut'],
      ['b', 2, 'match'],
    ]);
    expect(normalizeStoredComposition(seq)).toEqual(seq);
    expect(normalizeStoredComposition(seqOf([['', 2, 'cut']]))).toBeNull();
    expect(normalizeStoredComposition(42)).toBeNull();
  });

  it('storedComposition: one shot stays a G9 composition', () => {
    const one = emptySequence(comp('a'), 's');
    expect(storedComposition(one)).toEqual(comp('a'));
    const two = seqOf([
      ['a', 2, 'cut'],
      ['b', 2, 'cut'],
    ]);
    expect(storedComposition(two)).toBe(two);
  });

  it('normalizePrompt keeps a sequence on Prompt.composition', () => {
    const seq = seqOf(
      [
        ['a', 2, 'cut'],
        ['b', 3, 'whip'],
      ],
      'script',
    );
    const p = normalizePrompt({ id: 'p', title: 't', text: 'x', composition: seq });
    expect(p?.composition).toEqual(seq);
  });
});

describe('starter sequence', () => {
  it('three-beat reveal uses seed prompts and a {hero} continuity variable', () => {
    const seed = createPresetsInstance({
      categoryIds: SEED_CATEGORIES.map((_, i) => `c${i}`),
      promptIds: SEED_PROMPT_DEFS.map((_, i) => `p${i}`),
    });
    const s = /** @type {Sequence} */ (
      fromSequenceTemplate('three-beat-reveal', seed.prompts, newId)
    );
    expect(s.shots).toHaveLength(3);
    expect(s.shots.map((x) => x.cut)).toEqual(['match', 'smash', 'cut']);
    for (const shot of s.shots) {
      expect(shot.composition.blocks[0].slot).toBe('subject');
      expect(shot.composition.blocks.filter((b) => b.promptId).length).toBeGreaterThanOrEqual(3);
    }
    const out = composeSequence(s);
    expect(out.duration).toBe(12);
    expect(out.variables.filter((v) => v.name === 'hero')).toHaveLength(1);
    expect(out.text).toMatch(/^Shot 1 \(0–4s\): a single raindrop/);
    expect(fromSequenceTemplate('nope', seed.prompts, newId)).toBeNull();
  });
});
