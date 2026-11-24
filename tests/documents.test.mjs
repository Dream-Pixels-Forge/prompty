import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENTS,
  MAX_PROJECTS,
  MAX_DOCUMENT_SIZE,
  MAX_DOCUMENT_VERSIONS,
  KIND_VALUES,
  normalizeProject,
  normalizeDocument,
  normalizeDocumentVersion,
  mergeDocumentsByProjectAndTitle,
  extractShotFromMarkdown,
  linkPromptToDocument,
  generateId,
} from '../src/lib/documents.js';

/**
 * @typedef {import('../src/lib/documents.js').Project} Project
 * @typedef {import('../src/lib/documents.js').Document} Document
 * @typedef {import('../src/lib/documents.js').DocumentVersion} DocumentVersion
 */

/* ------------------------------------------------------------------ */
/* ID generation                                                       */
/* ------------------------------------------------------------------ */

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('produces unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* Project normalization                                               */
/* ------------------------------------------------------------------ */

describe('normalizeProject', () => {
  it('fills all fields with defaults', () => {
    /** @type {Project} */
    const p = /** @type {Project} */ (normalizeProject({ name: 'GOLDHUNTER' }));
    expect(p).toEqual({
      id: expect.any(String),
      name: 'GOLDHUNTER',
      color: expect.any(String),
      icon: expect.any(String),
      order: 0,
      createdAt: expect.any(Number),
    });
  });

  it('keeps provided values and coerces types', () => {
    /** @type {Project} */
    const p = /** @type {Project} */ (
      normalizeProject({
        id: 'proj-1',
        name: 42,
        color: '#ff0000',
        icon: '🎬',
        order: '5',
        createdAt: '1000',
      })
    );
    expect(p.id).toBe('proj-1');
    expect(p.name).toBe('42');
    expect(p.color).toBe('#ff0000');
    expect(p.icon).toBe('🎬');
    expect(p.order).toBe(5);
    expect(p.createdAt).toBe(1000);
  });

  it('rejects non-object input', () => {
    expect(normalizeProject(null)).toBe(null);
    expect(normalizeProject('nope')).toBe(null);
  });

  it('uses valid color and icon defaults when invalid', () => {
    const p = /** @type {Project} */ (normalizeProject({ name: 'Test', color: 'invalid', icon: '' }));
    expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(typeof p.icon).toBe('string');
    expect(p.icon.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Document normalization                                              */
/* ------------------------------------------------------------------ */

describe('normalizeDocument', () => {
  it('fills all fields with defaults', () => {
    /** @type {Document} */
    const d = /** @type {Document} */ (
      normalizeDocument({
        projectId: 'proj-1',
        title: 'GOLDHUNTER_PROMPTS',
        kind: 'prompt-sheet',
        markdown: '# Test\n```\nprompt text\n```',
      })
    );
    expect(d).toEqual({
      id: expect.any(String),
      projectId: 'proj-1',
      title: 'GOLDHUNTER_PROMPTS',
      kind: 'prompt-sheet',
      markdown: '# Test\n```\nprompt text\n```',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      versions: undefined,
    });
  });

  it('keeps provided values and coerces types', () => {
    /** @type {Document} */
    const d = /** @type {Document} */ (
      normalizeDocument({
        id: 'doc-1',
        projectId: 'proj-1',
        title: 'Test',
        kind: 'screenplay',
        markdown: 'content',
        createdAt: '1000',
        updatedAt: '2000',
        versions: [{ markdown: 'old', updatedAt: 500 }],
      })
    );
    expect(d.id).toBe('doc-1');
    expect(d.createdAt).toBe(1000);
    expect(d.updatedAt).toBe(2000);
  });

  it('rejects unknown kind values', () => {
    const d = normalizeDocument({
      projectId: 'p',
      title: 'T',
      kind: 'unknown-kind',
      markdown: 'x',
    });
    expect(d).toBe(null);
  });

  it('accepts all valid kind values', () => {
    for (const kind of KIND_VALUES) {
      /** @type {Document} */
      const d = /** @type {Document} */ (normalizeDocument({ projectId: 'p', title: 'T', kind, markdown: 'x' }));
      expect(d).not.toBe(null);
      expect(d.kind).toBe(kind);
    }
  });

  it('rejects non-object input', () => {
    expect(normalizeDocument(null)).toBe(null);
    expect(normalizeDocument('nope')).toBe(null);
  });

  it('rejects missing required fields', () => {
    expect(normalizeProject({ name: 'x' })).not.toBe(null);
    // Document needs projectId, title, kind, markdown (non-empty)
    expect(normalizeDocument({ projectId: 'p', title: 't', kind: 'prompt-sheet', markdown: 'm' })).not.toBe(null);
    expect(normalizeDocument({ title: 't', kind: 'prompt-sheet', markdown: 'm' })).toBe(null);
    expect(normalizeDocument({ projectId: 'p', kind: 'prompt-sheet', markdown: 'm' })).toBe(null);
    expect(normalizeDocument({ projectId: 'p', title: 't', kind: 'prompt-sheet' })).toBe(null);
    expect(normalizeDocument({ projectId: 'p', title: 't', kind: 'prompt-sheet', markdown: '' })).toBe(null);
  });

  it('enforces MAX_DOCUMENT_SIZE limit (512 KB)', () => {
    const largeMarkdown = 'x'.repeat(MAX_DOCUMENT_SIZE + 1);
    const d = normalizeDocument({
      projectId: 'p',
      title: 'T',
      kind: 'notes',
      markdown: largeMarkdown,
    });
    expect(d).toBe(null);
  });

  it('accepts document at exactly MAX_DOCUMENT_SIZE', () => {
    const exactMarkdown = 'x'.repeat(MAX_DOCUMENT_SIZE);
    const d = normalizeDocument({
      projectId: 'p',
      title: 'T',
      kind: 'notes',
      markdown: exactMarkdown,
    });
    expect(d).not.toBe(null);
  });
});

/* ------------------------------------------------------------------ */
/* Document version normalization                                      */
/* ------------------------------------------------------------------ */

describe('normalizeDocumentVersion', () => {
  it('keeps valid versions, drops malformed entries, caps at MAX_DOCUMENT_VERSIONS (newest first)', () => {
    const many = Array.from({ length: MAX_DOCUMENT_VERSIONS + 5 }, (_, i) => ({
      markdown: `v${100 - i}`,
      updatedAt: 100 - i,
    }));
    const versions = normalizeDocumentVersion([null, 'x', { markdown: 3 }, ...many]);
    expect(versions).toHaveLength(MAX_DOCUMENT_VERSIONS);
    expect(versions[0].markdown).toBe('v100');
    expect(versions[0].updatedAt).toBe(100);
  });

  it('omits versions field when nothing valid', () => {
    expect(normalizeDocumentVersion([])).toEqual([]);
    expect(normalizeDocumentVersion([{ markdown: 'x' }])).toEqual([]);
    expect(normalizeDocumentVersion([{ updatedAt: 1 }])).toEqual([]);
    expect(normalizeDocumentVersion(null)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Document merge by project + title (upsert for save_document)       */
/* ------------------------------------------------------------------ */

describe('mergeDocumentsByProjectAndTitle', () => {
  /** @type {Document} */
  const doc1 = {
    id: 'd1',
    projectId: 'p1',
    title: 'PROMPTS',
    kind: 'prompt-sheet',
    markdown: 'v1',
    createdAt: 1000,
    updatedAt: 1000,
    versions: [],
  };
  /** @type {Document} */
  const doc2 = {
    id: 'd2',
    projectId: 'p1',
    title: 'SCREENPLAY',
    kind: 'screenplay',
    markdown: 'v1',
    createdAt: 1000,
    updatedAt: 1000,
    versions: [],
  };

  it('returns existing when markdown unchanged (no new version)', () => {
    const incoming = { ...doc1, markdown: 'v1', updatedAt: 2000 };
    const merged = mergeDocumentsByProjectAndTitle([doc1, doc2], incoming);
    expect(merged).toHaveLength(2);
    /** @type {Document} */
    const d1 = /** @type {Document} */ (merged.find((d) => d.id === 'd1'));
    expect(d1.updatedAt).toBe(1000); // unchanged
    expect(d1.versions ?? []).toHaveLength(0);
  });

  it('creates new version when markdown changes', () => {
    const incoming = { ...doc1, markdown: 'v2', updatedAt: 2000 };
    const merged = mergeDocumentsByProjectAndTitle([doc1, doc2], incoming);
    expect(merged).toHaveLength(2);
    /** @type {Document} */
    const d1 = /** @type {Document} */ (merged.find((d) => d.id === 'd1'));
    expect(d1.markdown).toBe('v2');
    expect(d1.updatedAt).toBe(2000);
    const versions = d1.versions ?? [];
    expect(versions).toHaveLength(1);
    expect(versions[0].markdown).toBe('v1');
    expect(versions[0].updatedAt).toBe(1000);
  });

  it('adds new document when project+title not found', () => {
    const incoming = { ...doc1, id: 'd3', projectId: 'p2', title: 'NEW', markdown: 'v1' };
    const merged = mergeDocumentsByProjectAndTitle([doc1], incoming);
    expect(merged).toHaveLength(2);
    /** @type {Document} */
    const d3 = /** @type {Document} */ (merged.find((d) => d.id === 'd3'));
    expect(d3.title).toBe('NEW');
    expect(d3.projectId).toBe('p2');
  });

  it('caps versions at MAX_DOCUMENT_VERSIONS (oldest dropped)', () => {
    let docs = [doc1];
    // Add MAX_DOCUMENT_VERSIONS + 2 changes (21 iterations for MAX=20)
    for (let i = 2; i <= MAX_DOCUMENT_VERSIONS + 2; i++) {
      const incoming = { ...doc1, markdown: `v${i}`, updatedAt: i * 1000 };
      docs = mergeDocumentsByProjectAndTitle(docs, incoming);
    }
    /** @type {Document} */
    const final = /** @type {Document} */ (docs[0]);
    const versions = final.versions ?? [];
    expect(versions).toHaveLength(MAX_DOCUMENT_VERSIONS);
    expect(versions[0].markdown).toBe(`v${MAX_DOCUMENT_VERSIONS + 2 - 1}`); // newest first (v21)
    expect(versions[MAX_DOCUMENT_VERSIONS - 1].markdown).toBe('v2'); // oldest kept (v2)
  });
});

/* ------------------------------------------------------------------ */
/* Shot extraction from markdown (prompt-sheet)                        */
/* ------------------------------------------------------------------ */

describe('extractShotFromMarkdown', () => {
  it('parses a single shot section with Refs, prompt, Edit, CHECK', () => {
    const markdown = `## G08 — The lizard
**Refs:** 1 \`@lizard\` · 2 \`@plate\`
\`\`\`muse
A lizard emerges from sand, golden hour, cinematic
\`\`\`
**Edit:** keep ~2 s per shot
**CHECK:** lizard tiny in shot 3`;
    const shots = extractShotFromMarkdown(markdown, 'doc-1', 'GOLDHUNTER');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toEqual({
      shotId: 'G08',
      name: 'The lizard',
      refs: ['@lizard', '@plate'],
      prompt: 'A lizard emerges from sand, golden hour, cinematic',
      modelId: 'muse',
      edit: 'keep ~2 s per shot',
      check: 'lizard tiny in shot 3',
      documentId: 'doc-1',
      projectName: 'GOLDHUNTER',
    });
  });

  it('parses multiple shot sections', () => {
    const markdown = `## G01 — Opening
\`\`\`
neutral prompt
\`\`\`
## G02 — Action
\`\`\`kling
kling variant
\`\`\`
## G03 — Climax
\`\`\`seedance
seedance variant
\`\`\``;
    const shots = extractShotFromMarkdown(markdown, 'doc-1', 'GOLDHUNTER');
    expect(shots).toHaveLength(3);
    expect(shots[0].shotId).toBe('G01');
    expect(shots[0].modelId).toBeUndefined(); // neutral
    expect(shots[1].modelId).toBe('kling');
    expect(shots[2].modelId).toBe('seedance');
  });

  it('handles shots without Refs/Edit/CHECK', () => {
    const markdown = `## G05 — Simple
\`\`\`
just a prompt
\`\`\``;
    const shots = extractShotFromMarkdown(markdown, 'doc-1', 'GOLDHUNTER');
    expect(shots).toHaveLength(1);
    expect(shots[0].refs).toEqual([]);
    expect(shots[0].edit).toBe('');
    expect(shots[0].check).toBe('');
  });

  it('ignores non-shot headings and unknown fence languages', () => {
    const markdown = `# Project Title
Some intro text.
## G01 — Shot
\`\`\`json
{ "not": "a variant" }
\`\`\`
\`\`\`muse
real variant
\`\`\`
## Not a shot
\`\`\`
ignored
\`\`\``;
    const shots = extractShotFromMarkdown(markdown, 'doc-1', 'GOLDHUNTER');
    expect(shots).toHaveLength(1);
    expect(shots[0].shotId).toBe('G01');
    expect(shots[0].modelId).toBe('muse');
    expect(shots[0].prompt).toBe('real variant');
  });

  it('handles Refs with various formats', () => {
    const markdown = `## G01 — Test
**Refs:** \`@char1\`, \`@char2\` and \`@prop1\`
\`\`\`
prompt
\`\`\``;
    const shots = extractShotFromMarkdown(markdown, 'doc-1', 'GOLDHUNTER');
    expect(shots[0].refs).toEqual(['@char1', '@char2', '@prop1']);
  });
});

/* ------------------------------------------------------------------ */
/* Prompt linking to document                                          */
/* ------------------------------------------------------------------ */

describe('linkPromptToDocument', () => {
  it('creates prompt with documentId, shotId, and project tags', () => {
    const prompt = linkPromptToDocument({
      shotId: 'G08',
      name: 'The lizard',
      prompt: 'A lizard emerges...',
      refs: ['@lizard'],
      documentId: 'doc-1',
      projectName: 'GOLDHUNTER',
      versionTag: 'v3',
      categoryId: 'cat-1',
    });
    expect(prompt).toMatchObject({
      title: 'G08 — The lizard',
      text: 'A lizard emerges...',
      categoryId: 'cat-1',
      tags: expect.arrayContaining(['GOLDHUNTER', 'G08', 'v3']),
    });
    expect(prompt.id).toMatch(/^[a-f0-9-]{36}$/); // crypto.randomUUID
    expect(prompt.useCount).toBe(0);
    expect(prompt.isFavorite).toBe(false);
  });

  it('includes modelId in tags when provided', () => {
    const prompt = linkPromptToDocument({
      shotId: 'G08',
      name: 'The lizard',
      prompt: '...',
      refs: [],
      documentId: 'doc-1',
      projectName: 'GOLDHUNTER',
      versionTag: 'v3',
      modelId: 'muse',
    });
    expect(prompt.tags).toContain('muse');
  });
});

/* ------------------------------------------------------------------ */
/* Cap enforcement                                                     */
/* ------------------------------------------------------------------ */

describe('cap enforcement', () => {
  it('MAX_DOCUMENTS = 300', () => {
    expect(MAX_DOCUMENTS).toBe(300);
  });
  it('MAX_PROJECTS = 50', () => {
    expect(MAX_PROJECTS).toBe(50);
  });
  it('MAX_DOCUMENT_SIZE = 512 KB', () => {
    expect(MAX_DOCUMENT_SIZE).toBe(512 * 1024);
  });
  it('MAX_DOCUMENT_VERSIONS = 20 (G5 history rules)', () => {
    expect(MAX_DOCUMENT_VERSIONS).toBe(20);
  });
});