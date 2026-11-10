import { describe, expect, it } from 'vitest';
import {
  buildCommands,
  keyIntent,
  markUsed,
  moveSelection,
  preview,
  promoteSnippet,
  rankPalette,
  requiredVariables,
  resolveAction,
} from '../src/popup/palette.js';

/**
 * @typedef {import('../src/lib/storage.js').Prompt} Prompt
 */

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

/** @param {Partial<Prompt>} o @returns {Prompt} */
const prompt = (o) => ({
  id: 'p',
  title: 'Title',
  text: 'Body',
  createdAt: 0,
  useCount: 0,
  isFavorite: false,
  categoryId: null,
  tags: [],
  aspectRatio: null,
  quality: null,
  lastUsedAt: null,
  ...o,
});

const prompts = [
  prompt({ id: 'a', title: 'Product-Style Object', categoryId: 'c1' }),
  prompt({ id: 'b', title: 'Full-Body Character Portrait', categoryId: 'c2', tags: ['people'] }),
  prompt({ id: 'c', title: 'Wide Scenic Landscape', categoryId: 'c3' }),
];
const categories = [
  { id: 'c1', name: 'Products', color: '#000', icon: '📦', order: 1 },
  { id: 'c2', name: 'Characters', color: '#000', icon: '👤', order: 0 },
  { id: 'c3', name: 'Landscapes', color: '#000', icon: '🏔️', order: 2 },
];

describe('rankPalette', () => {
  it('subsequence-matches titles and drops non-matches ("prt")', () => {
    const ids = rankPalette({ prompts }, 'prt', { now: NOW }).map((i) => i.id);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('"port" finds Portrait only', () => {
    expect(rankPalette({ prompts }, 'port', { now: NOW }).map((i) => i.id)).toEqual(['b']);
  });

  it('recent use boosts an otherwise equal match', () => {
    const twins = [
      prompt({ id: 'old', title: 'Wide Shot' }),
      prompt({ id: 'new', title: 'Wide Shot', lastUsedAt: NOW - DAY, useCount: 3 }),
    ];
    expect(rankPalette({ prompts: twins }, 'wide', { now: NOW })[0].id).toBe('new');
  });

  it('empty query lists prompts (recent first), then snippets, then commands', () => {
    const recent = prompts.map((p) => (p.id === 'c' ? { ...p, lastUsedAt: NOW - 1000 } : p));
    const items = rankPalette(
      {
        prompts: recent,
        snippets: [{ id: 's1', text: 'copied text', sourceOrigin: 'https://x.dev' }],
        commands: buildCommands({ categories }),
      },
      '',
      { now: NOW },
    );
    expect(items[0].id).toBe('c');
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf('snippet')).toBeGreaterThan(kinds.lastIndexOf('prompt'));
    expect(kinds.indexOf('command')).toBeGreaterThan(kinds.lastIndexOf('snippet'));
  });

  it('matches tags and commands in one list', () => {
    const items = rankPalette({ prompts, commands: buildCommands({ categories }) }, 'people', {
      now: NOW,
    });
    expect(items[0].id).toBe('b');
    const cmd = rankPalette({ prompts, commands: buildCommands({ categories }) }, 'export', {
      now: NOW,
    });
    expect(cmd[0].kind).toBe('command');
    expect(cmd[0].command?.effect.type).toBe('export');
  });

  it('scope filters prompts to one category and hides snippets', () => {
    const items = rankPalette(
      { prompts, snippets: [{ id: 's', text: 'Wide', sourceOrigin: '' }] },
      '',
      { now: NOW, scopeCategoryId: 'c3' },
    );
    expect(items.map((i) => i.id)).toEqual(['c']);
  });

  it('returns highlight ranges on the label', () => {
    const [top] = rankPalette({ prompts }, 'wide', { now: NOW });
    expect(top.matches).toEqual([{ start: 0, end: 4 }]);
  });
});

describe('buildCommands', () => {
  it('orders category jumps by category order and reflects setting state', () => {
    const cmds = buildCommands({ categories, settings: { compactMode: true } });
    const jumps = cmds.filter((c) => c.effect.type === 'scope');
    expect(jumps.map((c) => c.effect.categoryId)).toEqual(['c2', 'c1', 'c3']);
    const compact = cmds.find((c) => c.id === 'cmd:compact');
    expect(compact?.label).toMatch(/off/);
    expect(compact?.effect.value).toBe(false);
  });

  it('offers "Show all categories" while scoped, and skips the current scope', () => {
    const cmds = buildCommands({ categories, scopeCategoryId: 'c1' });
    expect(cmds[0].id).toBe('cmd:scope-clear');
    expect(cmds.some((c) => c.effect.categoryId === 'c1')).toBe(false);
  });
});

describe('keyIntent', () => {
  it('maps the keyboard-only flow', () => {
    expect(keyIntent({ key: 'ArrowDown' })).toEqual({ type: 'move', delta: 1 });
    expect(keyIntent({ key: 'p', ctrlKey: true })).toEqual({ type: 'move', delta: -1 });
    expect(keyIntent({ key: 'Enter' })).toEqual({ type: 'act', action: 'default' });
    expect(keyIntent({ key: 'Enter', shiftKey: true })).toEqual({ type: 'act', action: 'append' });
    expect(keyIntent({ key: 'Enter', metaKey: true })).toEqual({ type: 'act', action: 'copy' });
    expect(keyIntent({ key: 'Enter', altKey: true })).toEqual({ type: 'act', action: 'promote' });
    expect(keyIntent({ key: 'Escape' })).toEqual({ type: 'escape' });
    expect(keyIntent({ key: 'K', ctrlKey: true })).toEqual({ type: 'reset' });
    expect(keyIntent({ key: 'a' })).toBeNull();
  });
});

describe('resolveAction / moveSelection', () => {
  const [item] = rankPalette({ prompts }, 'wide', { now: NOW });
  it('default resolves to the first action; unsupported → null', () => {
    expect(resolveAction(item, 'default')).toBe('insert');
    expect(resolveAction(item, 'copy')).toBe('copy');
    expect(resolveAction(item, 'promote')).toBeNull();
    expect(resolveAction(undefined, 'default')).toBeNull();
  });
  it('wraps single steps and clamps page steps', () => {
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(1, 5, 3)).toBe(2);
    expect(moveSelection(1, -5, 3)).toBe(0);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});

describe('helpers', () => {
  it('requiredVariables lists prompt tokens only', () => {
    const [item] = rankPalette(
      {
        prompts: [prompt({ id: 'v', title: 'Var', text: 'A {subject} in {style} and {subject}' })],
      },
      '',
      { now: NOW },
    );
    expect(requiredVariables(item)).toEqual(['subject', 'style']);
  });

  it('markUsed bumps one prompt immutably', () => {
    const next = markUsed(prompts, 'b', NOW);
    expect(next[1]).toMatchObject({ useCount: 1, lastUsedAt: NOW });
    expect(prompts[1].useCount).toBe(0);
    expect(next[0]).toBe(prompts[0]);
  });

  it('promoteSnippet titles from the first line', () => {
    const p = promoteSnippet(
      { id: 's', text: 'Line one\nline two', sourceOrigin: '' },
      {
        id: 'new',
        now: NOW,
      },
    );
    expect(p).toMatchObject({
      id: 'new',
      title: 'Line one',
      text: 'Line one\nline two',
      createdAt: NOW,
    });
  });

  it('preview flattens whitespace and truncates', () => {
    expect(preview('a\n  b')).toBe('a b');
    expect(preview('x'.repeat(10), 5)).toBe('xxxx…');
  });
});

describe('body text matching', () => {
  const longBody = prompt({
    id: 'long',
    title: 'Watercolor Style',
    text: 'soft pigment on paper, overlapping translucent washes',
  });
  it('does not fuzzy-match scattered letters across long body text', () => {
    expect(rankPalette({ prompts: [longBody] }, 'port', { now: NOW })).toEqual([]);
  });
  it('matches a literal substring in the body, below title matches', () => {
    const items = rankPalette(
      { prompts: [longBody, prompt({ id: 'w', title: 'Washes' })] },
      'washes',
      { now: NOW },
    );
    expect(items.map((i) => i.id)).toEqual(['w', 'long']);
  });
});
