import { describe, expect, it } from 'vitest';
import {
  listModels,
  getModel,
  modelForOrigin,
  normalizeModel,
  lintForModel,
  DIALECT_VALUES,
} from '../src/lib/models.js';

/** @param {string} id */
function requireModel(id) {
  const m = getModel(id);
  if (!m) throw new Error(`profile ${id} missing`);
  return m;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                            */
/* ------------------------------------------------------------------ */

describe('listModels', () => {
  it('ships the nine G15b profiles', () => {
    const models = listModels();
    expect(models).toHaveLength(9);
    expect(models.map((m) => m.id)).toEqual([
      'muse',
      'seedance-2.5',
      'kling',
      'minimax-hailuo',
      'veo',
      'runway',
      'wan',
      'luma',
      'higgsfield',
    ]);
  });

  it('returns copies, so mutating one does not affect the catalog', () => {
    const a = listModels();
    const b = listModels();
    a[0].label = 'mutated';
    expect(b[0].label).toBe('Muse Video');
  });

  it('every profile has the required fields', () => {
    for (const m of listModels()) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(Array.isArray(m.hosts)).toBe(true);
      expect(DIALECT_VALUES).toContain(m.dialect);
      expect(['meta-ai-pass-through', null]).toContain(m.wrapper);
      expect(m.maxPromptChars === null || typeof m.maxPromptChars === 'number').toBe(true);
      expect(typeof m.negativePrompt).toBe('boolean');
      expect(m.refSlots).toMatchObject({
        images: expect.any(Number),
        videos: expect.any(Number),
        audio: expect.any(Number),
      });
      expect(typeof m.source).toBe('string');
      expect(typeof m.verified).toBe('boolean');
    }
  });
});

describe('getModel', () => {
  it('returns the profile by id', () => {
    const kling = requireModel('kling');
    expect(kling.id).toBe('kling');
    expect(kling.label).toBe('Kling');
  });

  it('returns undefined for unknown ids', () => {
    expect(getModel('nope')).toBeUndefined();
    expect(getModel('')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Site → model                                                       */
/* ------------------------------------------------------------------ */

describe('modelForOrigin', () => {
  it('matches meta.ai to Muse (owner-confirmed host)', () => {
    expect(modelForOrigin('https://meta.ai')?.id).toBe('muse');
    expect(modelForOrigin('https://www.meta.ai/chat')?.id).toBe('muse');
  });

  it('matches Dreamina/BytePlus hosts to Seedance', () => {
    expect(modelForOrigin('https://dreamina.capcut.com')?.id).toBe('seedance-2.5');
    expect(modelForOrigin('https://console.byteplus.com')?.id).toBe('seedance-2.5');
  });

  it('matches kling.ai to Kling', () => {
    expect(modelForOrigin('https://kling.ai')?.id).toBe('kling');
    expect(modelForOrigin('https://www.kling.ai')?.id).toBe('kling');
  });

  it('matches hailuo.ai to MiniMax Hailuo', () => {
    expect(modelForOrigin('https://hailuo.ai')?.id).toBe('minimax-hailuo');
  });

  it('returns undefined for unknown origins and invalid input', () => {
    expect(modelForOrigin('https://unknown.example.com')).toBeUndefined();
    expect(modelForOrigin('')).toBeUndefined();
    expect(modelForOrigin(null)).toBeUndefined();
  });

  it('is case-insensitive and ignores ports', () => {
    expect(modelForOrigin('https://META.AI')?.id).toBe('muse');
    expect(modelForOrigin('https://kling.ai:8443')?.id).toBe('kling');
  });
});

/* ------------------------------------------------------------------ */
/* Normalization                                                      */
/* ------------------------------------------------------------------ */

describe('normalizeModel', () => {
  it('keeps a valid profile and drops unknown fields', () => {
    const m = normalizeModel({
      id: 'kling',
      label: 'Kling',
      hosts: ['kling.ai'],
      dialect: 'timecoded',
      wrapper: null,
      maxPromptChars: 8000,
      negativePrompt: true,
      refSlots: { images: 10, videos: 0, audio: 0 },
      durations: [3, 5, 10],
      aspectRatios: ['16:9', '9:16'],
      notes: 'x',
      source: 'https://kling.ai/doc',
      verified: true,
      bogus: 'dropped',
    });
    if (!m) throw new Error('normalizeModel returned null for a valid profile');
    expect(m).not.toHaveProperty('bogus');
    expect(m.maxPromptChars).toBe(8000);
  });

  it('rejects non-object input', () => {
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel('nope')).toBeNull();
    expect(normalizeModel(42)).toBeNull();
  });

  it('requires an id', () => {
    expect(normalizeModel({ label: 'No id' })).toBeNull();
  });

  it('coerces an unsourced numeric limit to null (anti-drift)', () => {
    const m = normalizeModel({
      id: 'custom',
      label: 'Custom',
      hosts: [],
      dialect: 'timecoded',
      wrapper: null,
      maxPromptChars: 5000,
      negativePrompt: false,
      refSlots: {},
      durations: [],
      aspectRatios: [],
      notes: '',
      source: '',
      verified: false,
    });
    if (!m) throw new Error('normalizeModel returned null');
    expect(m.maxPromptChars).toBeNull();
  });

  it('keeps a sourced numeric limit', () => {
    const m = normalizeModel({
      id: 'custom',
      label: 'Custom',
      hosts: [],
      dialect: 'timecoded',
      wrapper: null,
      maxPromptChars: 5000,
      negativePrompt: false,
      refSlots: {},
      durations: [],
      aspectRatios: [],
      notes: '',
      source: 'https://vendor.example.com/docs',
      verified: false,
    });
    if (!m) throw new Error('normalizeModel returned null');
    expect(m.maxPromptChars).toBe(5000);
  });

  it('defaults missing refSlots and booleans', () => {
    const m = normalizeModel({
      id: 'custom',
      label: 'Custom',
      hosts: [],
      dialect: 'timecoded',
      wrapper: null,
      maxPromptChars: null,
      refSlots: undefined,
      durations: [],
      aspectRatios: [],
      notes: '',
      source: '',
      verified: false,
    });
    if (!m) throw new Error('normalizeModel returned null');
    expect(m.refSlots).toEqual({ images: 0, videos: 0, audio: 0 });
    expect(m.negativePrompt).toBe(false);
    expect(m.verified).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Source rule (test fails if a non-null limit has no source)         */
/* ------------------------------------------------------------------ */

describe('source rule', () => {
  it('every shipped non-null numeric limit has a source', () => {
    const problems = [];
    for (const m of listModels()) {
      if (m.maxPromptChars !== null && (!m.source || !m.verified)) {
        problems.push(`${m.id}: maxPromptChars=${m.maxPromptChars} but source=${m.source} verified=${m.verified}`);
      }
      const slots = /** @type {Record<string, number|null>} */ (m.refSlots);
      for (const slot of Object.keys(slots)) {
        const n = Object.prototype.hasOwnProperty.call(slots, slot) ? slots[slot] : null;
        if (n !== null && n > 0 && (!m.source || !m.verified)) {
          problems.push(`${m.id}: refSlots.${slot}=${n} but source=${m.source} verified=${m.verified}`);
        }
      }
      for (const d of (m.durations ?? [])) {
        if (d !== null && (!m.source || !m.verified)) {
          problems.push(`${m.id}: duration=${d} but source=${m.source} verified=${m.verified}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Model checks (lint)                                                */
/* ------------------------------------------------------------------ */

describe('lintForModel', () => {
  const kling = requireModel('kling');

  it('warns when prompt exceeds maxPromptChars', () => {
    const warnings = lintForModel(
      { text: 'x'.repeat(8001), refs: [], duration: null, aspectRatio: null },
      kling,
    );
    expect(warnings.some((w) => w.key === 'lintModelChars')).toBe(true);
  });

  it('does not warn when under the limit', () => {
    const warnings = lintForModel(
      { text: 'short prompt', refs: [], duration: null, aspectRatio: null },
      kling,
    );
    expect(warnings.some((w) => w.key === 'lintModelChars')).toBe(false);
  });

  it('warns when negative-prompt section on a model without the field', () => {
    const muse = requireModel('muse');
    const warnings = lintForModel(
      { text: 'A dragon. Negative prompt: blurry', refs: [], duration: null, aspectRatio: null },
      muse,
    );
    expect(warnings.some((w) => w.key === 'lintModelNegative')).toBe(true);
  });

  it('warns when too many image refs', () => {
    const warnings = lintForModel(
      {
        text: 'prompt',
        refs: [
          '@image1', '@image2', '@image3', '@image4', '@image5', '@image6', '@image7', '@image8',
          '@image9', '@image10', '@image11',
        ],
        duration: null,
        aspectRatio: null,
      },
      kling,
    );
    expect(warnings.some((w) => w.key === 'lintModelRefs' && w.text.includes('11 image refs'))).toBe(true);
  });

  it('warns when seconds baked into the prompt for a duration-parameter model', () => {
    const warnings = lintForModel(
      { text: 'A dragon for 10 seconds', refs: [], duration: null, aspectRatio: null },
      kling,
    );
    expect(warnings.some((w) => w.key === 'lintModelDuration')).toBe(true);
  });

  it('warns when aspect ratio baked into the prompt', () => {
    const warnings = lintForModel(
      { text: 'A dragon 16:9 cinematic', refs: [], duration: null, aspectRatio: null },
      kling,
    );
    expect(warnings.some((w) => w.key === 'lintModelAspect')).toBe(true);
  });

  it('returns [] for a clean shot on an unverified model with null limits', () => {
    const higgsfield = requireModel('higgsfield');
    const warnings = lintForModel(
      { text: 'A dragon', refs: [], duration: null, aspectRatio: null },
      higgsfield,
    );
    expect(warnings).toEqual([]);
  });

  it('returns [] when there is no model', () => {
    expect(lintForModel({ text: 'anything', refs: [], duration: null, aspectRatio: null }, undefined)).toEqual([]);
  });
});
