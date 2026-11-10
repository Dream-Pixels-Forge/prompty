import { describe, expect, it } from 'vitest';
import {
  CUTS,
  MAX_REMEMBERED_SITES,
  composeSequence,
  lintSequence,
  normalizeTargets,
  rememberFormat,
  sharedVariables,
  suggestFormat,
} from '../src/lib/sequence.js';

/** @typedef {import('../src/lib/sequence.js').Sequence} Sequence */

/**
 * @param {[string, number, string][]} shots text, duration, cut
 * @param {string} format
 * @returns {Sequence}
 */
const seqOf = (shots, format) => ({
  format,
  shots: shots.map(([text, duration, cut], i) => ({
    id: `s${i}`,
    duration,
    cut,
    composition: {
      joiner: ', ',
      blocks: text ? [{ id: `b${i}`, slot: 'extra', promptId: null, text, muted: false }] : [],
    },
  })),
});

const scene = /** @type {[string, number, string][]} */ ([
  ["raindrop on {hero}'s eyelash", 4, 'match'],
  ['{hero} under neon', 3, 'smash'],
  ['{hero} alone on a salt flat', 5, 'cut'],
]);

describe('Seedance dialect', () => {
  it('time ranges, cuts as events at a time point, consistency line', () => {
    expect(composeSequence(seqOf(scene, 'seedance')).text).toBe(
      "0–4 seconds: raindrop on {hero}'s eyelash.\n" +
        'At 4 seconds, match cut. 4–7 seconds: {hero} under neon.\n' +
        'At 7 seconds, smash cut. 7–12 seconds: {hero} alone on a salt flat.\n' +
        'Keep {hero} consistent in every shot: same identity, clothing, props and screen direction.',
    );
  });

  it('every cut has a Seedance wording; whip is the guide’s transition event', () => {
    for (const cut of CUTS) {
      const text = composeSequence(
        seqOf(
          [
            ['a', 2, cut.id],
            ['b', 2, 'cut'],
          ],
          'seedance',
        ),
      ).text;
      expect(text).toMatch(/^0–2 seconds: a\.\nAt 2 seconds, .+\. 2–4 seconds: b\.$/);
    }
    expect(
      composeSequence(
        seqOf(
          [
            ['a', 2, 'whip'],
            ['b', 2, 'cut'],
          ],
          'seedance',
        ),
      ).text,
    ).toContain('At 2 seconds, the camera whip-pans and completes the transition.');
  });

  it('no consistency line when nothing is shared', () => {
    const text = composeSequence(
      seqOf(
        [
          ['{a} x', 2, 'cut'],
          ['{b} y', 2, 'cut'],
        ],
        'seedance',
      ),
    ).text;
    expect(text).not.toContain('Keep');
  });

  it('a shared choice variable keeps its full token', () => {
    const text = composeSequence(
      seqOf(
        [
          ['{lens:35mm|85mm} close', 2, 'cut'],
          ['{lens} wide', 2, 'cut'],
        ],
        'seedance',
      ),
    ).text;
    expect(text).toContain('Keep {lens:35mm|85mm} consistent');
    const v = composeSequence(
      seqOf(
        [
          ['{lens:35mm|85mm} close', 2, 'cut'],
          ['{lens} wide', 2, 'cut'],
        ],
        'seedance',
      ),
    ).variables;
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('choice');
  });
});

describe('Muse dialect', () => {
  it('STOP after every shot, HARD CUT between, identity line first, ban line last', () => {
    expect(composeSequence(seqOf(scene, 'muse')).text).toBe(
      'The same {hero} in every shot, exactly as first shown, never redesigned.\n' +
        "SHOT 1 (0–4 s): raindrop on {hero}'s eyelash. STOP. HARD CUT on a matching shape.\n" +
        'SHOT 2 (4–7 s): {hero} under neon. STOP. HARD CUT.\n' +
        'SHOT 3 (7–12 s): {hero} alone on a salt flat. STOP.\n' +
        'Hard cuts only, no dissolves, no morphs, no whip transitions.',
    );
  });

  it('soft transitions become hard cuts', () => {
    for (const cut of ['whip', 'dissolve', 'continuous']) {
      const text = composeSequence(
        seqOf(
          [
            ['a', 2, cut],
            ['b', 2, 'cut'],
          ],
          'muse',
        ),
      ).text;
      expect(text).toBe(
        'SHOT 1 (0–2 s): a. STOP. HARD CUT.\nSHOT 2 (2–4 s): b. STOP.\n' +
          'Hard cuts only, no dissolves, no morphs, no whip transitions.',
      );
    }
  });

  it('identity line keeps the first full token so the spec is not shadowed', () => {
    const out = composeSequence(
      seqOf(
        [
          ['{hero:diver|dancer} jumps', 2, 'cut'],
          ['{hero} lands', 2, 'cut'],
        ],
        'muse',
      ),
    );
    expect(out.text.startsWith('The same {hero:diver|dancer} in every shot')).toBe(true);
    expect(out.variables[0].kind).toBe('choice');
  });
});

describe('single shot parity', () => {
  it('every format writes a single shot exactly as G9', () => {
    for (const f of ['timecoded', 'script', 'one-take', 'seedance', 'muse']) {
      expect(composeSequence(seqOf([['{hero} waits', 4, 'cut']], f)).text).toBe('{hero} waits');
    }
  });
});

describe('sharedVariables', () => {
  it('names used in two or more shots with text', () => {
    const s = seqOf(
      [
        ['{a} {b}', 2, 'cut'],
        ['{a} {c}', 2, 'cut'],
        ['', 2, 'cut'],
        ['{c}', 2, 'cut'],
      ],
      'timecoded',
    );
    expect(sharedVariables(s)).toEqual(['a', 'c']);
  });
});

describe('lintSequence', () => {
  it('Muse: too many shots, short shots, soft cuts, word count', () => {
    const many = seqOf(
      [
        ['a', 1, 'whip'],
        ['b', 3, 'dissolve'],
        ['c', 3, 'cut'],
        ['d', 3, 'cut'],
        ['e', 3, 'cut'],
      ],
      'muse',
    );
    const texts = lintSequence(many).map((l) => l.text);
    expect(texts.some((t) => t.startsWith('5 shots in one Muse clip'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Shot 1 under 2 s'))).toBe(true);
    expect(
      texts.some((t) => t.includes('whip pan and dissolve will be written as a hard cut')),
    ).toBe(true);
    const long = seqOf(
      [
        [Array(300).fill('word').join(' '), 3, 'cut'],
        ['b', 3, 'cut'],
      ],
      'muse',
    );
    expect(lintSequence(long).some((l) => l.text.includes('Muse starts dropping clauses'))).toBe(
      true,
    );
    expect(
      lintSequence(
        seqOf(
          [
            ['a', 3, 'cut'],
            ['b', 3, 'match'],
          ],
          'muse',
        ),
      ),
    ).toEqual([]);
  });

  it('Seedance: duration tip; one take: cuts ignored; single shot: nothing', () => {
    expect(lintSequence(seqOf(scene, 'seedance'))).toEqual([
      {
        level: 'info',
        text: 'Set the duration to 12 s on the generation page. Seedance takes it from the settings, not the prompt.',
      },
    ]);
    expect(lintSequence(seqOf(scene, 'one-take'))[0].text).toContain('ignored');
    expect(
      lintSequence(
        seqOf(
          [
            ['a', 2, 'continuous'],
            ['b', 2, 'cut'],
          ],
          'one-take',
        ),
      ),
    ).toEqual([]);
    expect(lintSequence(seqOf([['a', 2, 'cut']], 'muse'))).toEqual([]);
    expect(lintSequence(seqOf(scene, 'timecoded'))).toEqual([]);
  });
});

describe('site suggestions', () => {
  it('remembered choice beats the built-in host; unknown sites get nothing', () => {
    expect(suggestFormat('https://dreamina.capcut.com', {})).toBe('seedance');
    expect(
      suggestFormat('https://dreamina.capcut.com', { 'https://dreamina.capcut.com': 'script' }),
    ).toBe('script');
    expect(suggestFormat('https://example.com', {})).toBeNull();
    expect(suggestFormat('chrome://extensions', {})).toBeNull();
    expect(suggestFormat('', null)).toBeNull();
  });

  it('rememberFormat moves the site to the end and caps the map', () => {
    /** @type {Record<string, string>} */
    let map = {};
    for (let i = 0; i < MAX_REMEMBERED_SITES + 5; i++)
      map = rememberFormat(map, `https://s${i}.com`, 'muse');
    expect(Object.keys(map)).toHaveLength(MAX_REMEMBERED_SITES);
    expect(map['https://s0.com']).toBeUndefined();
    map = rememberFormat(map, 'https://s10.com', 'seedance');
    expect(Object.keys(map).at(-1)).toBe('https://s10.com');
    expect(rememberFormat({}, 'https://a.com', 'nope')).toEqual({});
    expect(rememberFormat({}, 'file:///x', 'muse')).toEqual({});
  });

  it('normalizeTargets drops junk', () => {
    expect(
      normalizeTargets({
        'https://a.com': 'muse',
        'https://b.com/path': 'muse',
        'https://c.com': 'x',
        d: 1,
      }),
    ).toEqual({ 'https://a.com': 'muse' });
    expect(normalizeTargets([1])).toEqual({});
  });
});
