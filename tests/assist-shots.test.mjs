import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/** @typedef {{ shotId:string, name:string, modelId:string|null, refs:string[], prompt:string, edit:string, check:string, documentId:string, projectName:string }} Shot */

/**
 * Load assist.js in a vm sandbox (no document) so its sandbox hook exposes
 * the pure functions, then return them.
 * @returns {{ extractShotsFromMarkdown: Function, shotParseSection: Function, shotParseRefs: Function }}
 */
function loadAssistPure() {
  const source = readFileSync(
    new URL('../src/content/assist.js', import.meta.url),
    'utf8',
  );
  /** @type {{ extractShotsFromMarkdown?: Function, shotParseSection?: Function, shotParseRefs?: Function }|null} */
  let exposed = null;
  const sandbox = {
    self: {
      /** @param {Record<string, Function>} fns */
      __PROMPTY_TEST_HOOK__(fns) {
        exposed = fns;
      },
    },
  };
  const ctx = createContext(sandbox);
  runInContext(source, ctx);
  if (!exposed) throw new Error('assist.js sandbox hook did not fire');
  return exposed;
}

const { extractShotsFromMarkdown, shotParseSection, shotParseRefs } = loadAssistPure();

const sheet = `## G01 — Lizard plate
**Refs:** 1 \`@lizard\` · 2 \`@plate\`
**Edit:** tighten the cut
**CHECK:** eyes track

\`\`\`muse
A slow push in on the lizard as the plate shifts.
\`\`\`

## G08 — Love, then greed
\`\`\`seedance-2.5
Love, then greed — she reaches, he pulls back.
\`\`\`
Neutral block with no fence info below:

\`\`\`text
this should not be captured because it has an unknown info string
\`\`\`

\`\`\`kling
Honor the blade.
\`\`\`

## G12 — One take
A single continuous shot.
\`\`\` 
no closing fence
`;

describe('extractShotsFromMarkdown (G15 inline port)', () => {
  it('extracts shots with id, name, refs, edit, check', () => {
    /** @type {Shot[]} */
    const shots = extractShotsFromMarkdown(sheet, 'doc-1', 'GOLDHUNTER');
    // G01 (muse) + G08 (seedance-2.5 + kling) = 3 variants; G12 unterminated fence → none
    expect(shots).toHaveLength(3);
    const g01 = shots[0];
    expect(g01.shotId).toBe('G01');
    expect(g01.name).toBe('Lizard plate');
    expect(g01.refs).toEqual(['@lizard', '@plate']);
    expect(g01.edit).toBe('tighten the cut');
    expect(g01.check).toBe('eyes track');
    expect(g01.documentId).toBe('doc-1');
    expect(g01.projectName).toBe('GOLDHUNTER');
    expect(g01.modelId).toBe('muse');
    expect(g01.prompt).toContain('slow push in on the lizard');
  });

  it('tags model variants by info string', () => {
    /** @type {Shot[]} */
    const shots = extractShotsFromMarkdown(sheet, 'doc-1', 'GOLDHUNTER');
    const g08variants = shots.filter((s) => s.shotId === 'G08');
    expect(g08variants).toHaveLength(2);
    expect(g08variants.map((s) => s.modelId).sort()).toEqual([
      'kling',
      'seedance-2.5',
    ]);
    const seedance = g08variants.find((s) => s.modelId === 'seedance-2.5');
    expect(seedance?.prompt).toContain('Love, then greed');
    const kling = g08variants.find((s) => s.modelId === 'kling');
    expect(kling?.prompt).toBe('Honor the blade.');
  });

  it('treats unknown info strings (e.g. text) as non-shot variants', () => {
    /** @type {Shot[]} */
    const shots = extractShotsFromMarkdown(sheet, 'doc-1', 'GOLDHUNTER');
    const ids = shots.map((s) => s.shotId);
    expect(ids).not.toContain('text');
  });

  it('ignores a fenced block with no closing fence', () => {
    /** @type {Shot[]} */
    const shots = extractShotsFromMarkdown(sheet, 'doc-1', 'GOLDHUNTER');
    // G12 has an unterminated fence → no prompt extracted from it
    const g12 = shots.find((s) => s.shotId === 'G12');
    expect(g12).toBeUndefined();
  });

  it('returns empty for non-prompt-sheet content', () => {
    expect(extractShotsFromMarkdown('# Just a heading\n\nsome prose', 'd', 'p')).toEqual([]);
    expect(extractShotsFromMarkdown('', 'd', 'p')).toEqual([]);
    expect(extractShotsFromMarkdown('## NOTASHOT\n\njust text', 'd', 'p')).toEqual([]);
  });

  it('shotParseSection returns [] for a non-shot section', () => {
    expect(shotParseSection('just some text\n\nmore text', 'd', 'p')).toEqual([]);
  });

  it('shotParseRefs parses @ tokens', () => {
    expect(shotParseRefs('1 `@lizard` · 2 `@plate`')).toEqual(['@lizard', '@plate']);
    expect(shotParseRefs('@char1, @char2 and @prop1')).toEqual(['@char1', '@char2', '@prop1']);
    expect(shotParseRefs('')).toEqual([]);
  });
});
