import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  extractShotVariants,
  stableShotId,
  isKnownModelVariant,
  parseRefs,
} from '../src/lib/prompt-sheet.js';
import {
  extractShotFromMarkdown,
  linkPromptToDocument,
} from '../src/lib/documents.js';

const FIXTURE_PATH = new URL('./fixtures/goldhunter-g08-multimodel.md', import.meta.url);
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');

/** @typedef {import('../src/lib/documents.js').Shot} Shot */

/* ------------------------------------------------------------------ */
/* extractShotVariants                                                */
/* ------------------------------------------------------------------ */

describe('extractShotVariants', () => {
  it('extracts all four G08 variants from the fixture (muse, seedance-2.5, kling, neutral)', () => {
    /** @type {Shot[]} */
    const shots = extractShotVariants(FIXTURE, 'doc-1', 'GOLDHUNTER');
    const g08 = shots.filter((s) => s.shotId === 'G08');
    expect(g08).toHaveLength(4);
    expect(new Set(g08.map((s) => s.modelId))).toEqual(
      new Set([undefined, 'kling', 'muse', 'seedance-2.5']),
    );
    // Neutral variant (no info string) is included
    const neutral = g08.find((s) => s.modelId === undefined);
    expect(neutral).toBeDefined();
    expect(neutral?.prompt).toContain('35mm anamorphic');
    // Each variant stored byte-for-byte (minus fence)
    const muse = g08.find((s) => s.modelId === 'muse');
    expect(muse?.prompt).toContain('STOP. HARD CUT.');
    expect(muse?.prompt).not.toContain('```');
  });

  it('tags each variant with shotId and modelId', () => {
    /** @type {Shot[]} */
    const shots = extractShotVariants(FIXTURE, 'doc-9', 'PROJ-X');
    const g08muse = shots.find((s) => s.shotId === 'G08' && s.modelId === 'muse');
    expect(g08muse).toBeDefined();
    expect(g08muse?.documentId).toBe('doc-9');
    expect(g08muse?.projectName).toBe('PROJ-X');
    expect(g08muse?.shotId).toBe('G08');
  });

  it('excludes unknown info strings (json) as shot variants', () => {
    const markdown = `## G01 — Shot
\`\`\`json
{ "not": "a variant" }
\`\`\`
\`\`\`muse
real variant
\`\`\``;
    /** @type {Shot[]} */
    const shots = extractShotVariants(markdown, 'd', 'p');
    expect(shots).toHaveLength(1);
    expect(shots[0].modelId).toBe('muse');
    expect(shots[0].prompt).toBe('real variant');
  });

  it('includes neutral variant (no info string)', () => {
    const markdown = `## G01 — Shot
\`\`\`
plain neutral prompt
\`\`\``;
    /** @type {Shot[]} */
    const shots = extractShotVariants(markdown, 'd', 'p');
    expect(shots).toHaveLength(1);
    expect(shots[0].modelId).toBeUndefined();
    expect(shots[0].prompt).toBe('plain neutral prompt');
  });

  it('returns [] for content with no recognized variant', () => {
    expect(extractShotVariants('# Just a heading', 'd', 'p')).toEqual([]);
    expect(extractShotVariants('', 'd', 'p')).toEqual([]);
    const fence = '```';
    expect(
      extractShotVariants(`## G01 — Shot\n${fence}json\n{}\n${fence}`, 'd', 'p'),
    ).toEqual([]);
  });

  it('extracts Refs, Edit, CHECK per variant', () => {
    const markdown = `## G08 — Love, then greed
**Refs:** 1 \`@heroine\` · 2 \`@plate\`
**Edit:** keep under 2 s
**CHECK:** identity matches

\`\`\`muse
muse prompt
\`\`\``;
    /** @type {Shot[]} */
    const shots = extractShotVariants(markdown, 'd', 'p');
    expect(shots).toHaveLength(1);
    expect(shots[0].refs).toEqual(['@heroine', '@plate']);
    expect(shots[0].edit).toBe('keep under 2 s');
    expect(shots[0].check).toBe('identity matches');
  });
});

/* ------------------------------------------------------------------ */
/* extractShotFromMarkdown (documents.js delegation)                  */
/* ------------------------------------------------------------------ */

describe('extractShotFromMarkdown (G15b multi-variant)', () => {
  it('delegates to extractShotVariants and returns all variants', () => {
    const markdown = `## G08 — Shot
\`\`\`muse
muse variant
\`\`\`
\`\`\`kling
kling variant
\`\`\``;
    /** @type {Shot[]} */
    const shots = extractShotFromMarkdown(markdown, 'doc-1', 'P');
    expect(shots).toHaveLength(2);
    expect(shots[0].modelId).toBe('muse');
    expect(shots[1].modelId).toBe('kling');
  });
});

/* ------------------------------------------------------------------ */
/* stableShotId                                                       */
/* ------------------------------------------------------------------ */

describe('stableShotId', () => {
  it('is deterministic: same inputs → same id', () => {
    const a = stableShotId('doc-1', 'G08', 'muse');
    const b = stableShotId('doc-1', 'G08', 'muse');
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('differs when model differs', () => {
    expect(stableShotId('doc-1', 'G08', 'muse')).not.toBe(
      stableShotId('doc-1', 'G08', 'kling'),
    );
  });

  it('differs when document or shot differs', () => {
    expect(stableShotId('doc-1', 'G08', 'muse')).not.toBe(
      stableShotId('doc-2', 'G08', 'muse'),
    );
    expect(stableShotId('doc-1', 'G08', 'muse')).not.toBe(
      stableShotId('doc-1', 'G01', 'muse'),
    );
  });

  it('treats null and missing modelId as neutral', () => {
    expect(stableShotId('doc-1', 'G08', null)).toBe(
      stableShotId('doc-1', 'G08', undefined),
    );
  });
});

/* ------------------------------------------------------------------ */
/* isKnownModelVariant                                                */
/* ------------------------------------------------------------------ */

describe('isKnownModelVariant', () => {
  it('recognizes known models', () => {
    expect(isKnownModelVariant('muse')).toBe(true);
    expect(isKnownModelVariant('kling')).toBe(true);
    expect(isKnownModelVariant('seedance-2.5')).toBe(true);
  });

  it('treats empty info string as neutral (not a known model)', () => {
    expect(isKnownModelVariant('')).toBe(false);
  });

  it('rejects unknown info strings', () => {
    expect(isKnownModelVariant('json')).toBe(false);
    expect(isKnownModelVariant('text')).toBe(false);
    expect(isKnownModelVariant('unknown')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* linkPromptToDocument with stable id (re-save in place)             */
/* ------------------------------------------------------------------ */

describe('linkPromptToDocument stable id', () => {
  it('creates 4 linked prompts from G08 fixture with stable ids', () => {
    /** @type {Shot[]} */
    const shots = extractShotVariants(FIXTURE, 'doc-g8', 'GOLDHUNTER').filter(
      (s) => s.shotId === 'G08',
    );
    expect(shots).toHaveLength(4);

    const versionTag = 'v3';
    const prompts = shots.map((s) =>
      linkPromptToDocument({
        id: stableShotId(s.documentId, s.shotId, s.modelId),
        shotId: s.shotId,
        name: s.name,
        prompt: s.prompt,
        refs: s.refs,
        documentId: s.documentId,
        projectName: s.projectName,
        versionTag,
        modelId: s.modelId,
        edit: s.edit,
        check: s.check,
        categoryId: 'cat-goldhunter',
      }),
    );

    expect(prompts).toHaveLength(4);
    const ids = prompts.map((p) => p.id);
    expect(new Set(ids).size).toBe(4); // all distinct
    for (const p of prompts) {
      const comp = /** @type {{ documentId: string, shotId: string, modelId?: string|null }} */ (
        p.composition
      );
      expect(comp.documentId).toBe('doc-g8');
      expect(comp.shotId).toBe('G08');
      expect(p.tags).toContain('G08');
      expect(p.tags).toContain('GOLDHUNTER');
      expect(p.tags).toContain('v3');
      if (comp.modelId) expect(p.tags).toContain(comp.modelId);
    }
  });

  it('re-saving with the same shots keeps stable ids (no duplicates)', () => {
    const p1 = linkPromptToDocument({
      id: stableShotId('doc-1', 'G08', 'muse'),
      shotId: 'G08', name: 'Love, then greed', prompt: 'muse v1',
      refs: [], documentId: 'doc-1', projectName: 'GOLDHUNTER',
      versionTag: 'v3', modelId: 'muse',
    });
    const p2 = linkPromptToDocument({
      id: stableShotId('doc-1', 'G08', 'muse'),
      shotId: 'G08', name: 'Love, then greed', prompt: 'muse v2 (edited)',
      refs: [], documentId: 'doc-1', projectName: 'GOLDHUNTER',
      versionTag: 'v3', modelId: 'muse',
    });
    expect(p1.id).toBe(p2.id); // stable id across re-save
    expect(p2.text).toBe('muse v2 (edited)'); // updated text
  });
});

/* ------------------------------------------------------------------ */
/* parseRefs (re-exported)                                            */
/* ------------------------------------------------------------------ */

describe('parseRefs', () => {
  it('parses @reference tokens', () => {
    expect(parseRefs('1 `@lizard` · 2 `@plate`')).toEqual(['@lizard', '@plate']);
    expect(parseRefs('@char1, @char2 and @prop1')).toEqual([
      '@char1',
      '@char2',
      '@prop1',
    ]);
    expect(parseRefs('')).toEqual([]);
  });
});
