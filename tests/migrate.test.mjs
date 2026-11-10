import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT,
  csvCandidates,
  detectFormat,
  parseCsv,
  planMigration,
  readFile,
  textKey,
  txtCandidates,
} from '../src/lib/migrate.js';
import { SEED_CATEGORIES, SEED_PROMPT_DEFS, createPresetsInstance } from '../src/lib/presets.js';

/** @param {string} name */
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/migrate/${name}`, import.meta.url), 'utf8');

const seeded = () =>
  createPresetsInstance({
    categoryIds: SEED_CATEGORIES.map((_, i) => `c${i}`),
    promptIds: SEED_PROMPT_DEFS.map((_, i) => `p${i}`),
  });
let n = 0;
const newId = () => `new${++n}`;
const empty = { prompts: [], categories: [] };

describe('detectFormat', () => {
  it.each([
    ['a.csv', 'x,y', 'csv'],
    ['a.tsv', 'x\ty', 'csv'],
    ['a.md', '# x', 'txt'],
    ['a.txt', 'hello', 'txt'],
    ['a.json', '{"prompts":[]}', 'envelope'],
    ['a.json', '[1]', 'json-list'],
    ['a.json', '{"foo":1}', 'unknown'],
    ['a.json', '{oops', 'unknown'],
    ['noext', '[ "x" ]', 'json-list'],
    ['noext', 'just text', 'txt'],
    ['noext', '   ', 'unknown'],
  ])('%s → %s', (name, text, format) => {
    expect(detectFormat(name, text).format).toBe(format);
  });
});

describe('parseCsv', () => {
  it.each([
    [
      'a,b\n1,2',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    ['"a,b","c""d"\r\n', [['a,b', 'c"d']]],
    ['"multi\nline",x', [['multi\nline', 'x']]],
    [
      'a;b;c\n1;2;3',
      [
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ],
    ],
    [
      'a\tb\n1\t2',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
    ['﻿a,b', [['a', 'b']]],
    [
      'a,b\n,\n\n1,2',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
    ],
  ])('%j', (text, rows) => {
    expect(parseCsv(text)).toEqual(rows);
  });

  it('headerless: 1 column = text, 2 columns = title, text', () => {
    expect(csvCandidates([['only text']])[0]).toMatchObject({ title: '', text: 'only text' });
    expect(csvCandidates([['T', 'body']])[0]).toMatchObject({ title: 'T', text: 'body' });
  });

  it('header aliases', () => {
    const [c] = csvCandidates([
      ['Name', 'Content', 'Folder', 'Labels', 'Starred'],
      ['N', 'C', 'F', 'a; b', 'TRUE'],
    ]);
    expect(c).toEqual({ title: 'N', text: 'C', category: 'F', tags: ['a', 'b'], isFavorite: true });
  });
});

describe('txtCandidates', () => {
  it('headings name categories, titles detected, bullets split, rules separate', () => {
    const out = txtCandidates(fixture('notes.md'));
    expect(out.map((c) => [c.title, c.category])).toEqual([
      ['Orbit reveal', 'Camera Movement'],
      ['', 'Camera Movement'],
      ['', 'Lighting'],
      ['', 'Lighting'],
      ['', 'Lighting'],
    ]);
    expect(out[0].text).toBe(
      'Slow 360° orbit around {subject} at chest height, ending on the face.',
    );
    expect(out[2].text).toBe('Hard noon sun, short shadows, bleached highlights');
  });

  it('a sentence-like first line is not a title', () => {
    expect(txtCandidates('A woman walks.\nThen she stops.')[0]).toMatchObject({
      title: '',
      text: 'A woman walks.\nThen she stops.',
    });
  });
});

describe('planMigration', () => {
  it('CSV fixture: quotes, ; delimiter, BOM, duplicate in file, empty rows', () => {
    const { candidates, format } = readFile('prompts.csv', fixture('prompts.csv'));
    expect(format).toBe('csv');
    const { prompts, categories, report } = planMigration(empty, candidates, { now: 5, newId });
    expect(report.added).toEqual(['Neon alley', 'Multiline']);
    expect(report.skipped).toEqual([{ title: 'Duplicate', reason: 'duplicate in file' }]);
    expect(report.categoriesAdded).toEqual(['Lighting']);
    expect(prompts[0]).toMatchObject({
      text: 'Rain-slicked alley, magenta neon; steam, "Blade" vibe',
      tags: ['night', 'neon'],
      isFavorite: true,
      categoryId: categories[0].id,
      createdAt: 5,
    });
    expect(prompts[1].text).toBe('Line one\nline two');
  });

  it('upstream export into a seeded library: no duplicate categories, seeds skipped or merged', () => {
    const lib = seeded();
    const before = lib.categories.length;
    const { candidates, format } = readFile(
      'higgsfield-prompts-2026-11-01.json',
      fixture('higgsfield-prompts-2026-11-01.json'),
    );
    expect(format).toBe('envelope');
    const { prompts, categories, report } = planMigration(lib, candidates, { newId });
    // Seed "Full-Body…" gains the favorite + tag → merged; "Character Design Sheet" is identical → skipped.
    expect(report.merged).toEqual(['Full-Body Character Portrait']);
    expect(report.skipped).toEqual([
      { title: 'Character Design Sheet', reason: 'already in library' },
    ]);
    expect(report.added).toEqual([
      'Brutalist Rooftop Dancer',
      'Salt Desert Monolith',
      'Glass Perfume Hero',
    ]);
    expect(report.categoriesAdded).toEqual(['Product Ads']);
    expect(categories).toHaveLength(before + 1);
    const names = categories.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const dancer = prompts.find((p) => p.title === 'Brutalist Rooftop Dancer');
    const characters = categories.find((c) => c.name === 'Characters');
    expect(dancer).toMatchObject({
      categoryId: characters?.id,
      useCount: 7,
      aspectRatio: '9:16',
      quality: 'ultra',
      createdAt: 1731000000000,
      isFavorite: true,
    });
    expect(dancer?.id).not.toBe('1731000000000');
    const ads = categories.find((c) => c.name === 'Product Ads');
    expect(ads).toMatchObject({ color: '#ef4444', icon: '🛍️' });
    const merged = prompts.find((p) => p.title === 'Full-Body Character Portrait');
    expect(merged).toMatchObject({ isFavorite: true, tags: ['portrait'] });
  });

  it('re-importing the same file adds nothing', () => {
    const file = fixture('higgsfield-prompts-2026-11-01.json');
    const once = planMigration(seeded(), readFile('x.json', file).candidates, { newId });
    const twice = planMigration(once, readFile('x.json', file).candidates, { newId });
    expect(twice.report.added).toEqual([]);
    expect(twice.report.merged).toEqual([]);
    expect(twice.report.categoriesAdded).toEqual([]);
    expect(twice.prompts).toHaveLength(once.prompts.length);
  });

  it('Markdown notes: categories joined case-insensitively, bullet dup skipped', () => {
    const lib = seeded();
    const { report, prompts, categories } = planMigration(
      lib,
      readFile('notes.md', fixture('notes.md')).candidates,
      { newId },
    );
    expect(report.added).toHaveLength(4);
    expect(report.skipped).toEqual([
      { title: 'Hard noon sun, short shadows, bleached highlights', reason: 'duplicate in file' },
    ]);
    expect(report.categoriesAdded).toEqual([]); // both headings exist in the seed
    const orbit = prompts.find((p) => p.title === 'Orbit reveal');
    expect(categories.find((c) => c.id === orbit?.categoryId)?.name).toBe('Camera Movement');
  });

  it('JSON list: strings and objects; empty and invalid items skipped', () => {
    const { report, prompts } = planMigration(
      empty,
      readFile('list.json', fixture('list.json')).candidates,
      {
        newId,
        colors: ['#123456'],
      },
    );
    expect(report.added).toEqual([
      'Underwater ballroom, chandeliers drifting, slow motion',
      'Drone over glacier',
    ]);
    expect(report.skipped.map((s) => s.reason)).toEqual(['empty', 'empty']);
    expect(prompts[1]).toMatchObject({ tags: ['aerial', 'ice'], isFavorite: true });
    expect(report.categoriesAdded).toEqual(['Landscapes']);
  });

  it('too long, whitespace/case duplicates, tag cap', () => {
    const lib = { prompts: [], categories: [] };
    const cands = [
      { title: 'big', text: 'x'.repeat(MAX_TEXT + 1), category: null, tags: [], isFavorite: false },
      { title: 'a', text: 'Hello   World', category: null, tags: [], isFavorite: false },
      { title: 'b', text: 'hello world', category: null, tags: [], isFavorite: false },
    ];
    const { report } = planMigration(lib, cands, { newId });
    expect(report.skipped.map((s) => s.reason)).toEqual(['too long', 'duplicate in file']);
    expect(textKey('  Hello\n\tWORLD ')).toBe('hello world');
  });
});
