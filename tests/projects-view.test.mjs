import { describe, expect, it } from 'vitest';
import { filterProjects, filterDocuments, sortProjects, sortDocuments } from '../src/popup/projects-logic.js';

/** @type {import('../src/popup/projects-logic.js').Project} */
const baseProject = {
  id: 'p1',
  name: 'GOLDHUNTER',
  color: '#8b5cf6',
  icon: '🎬',
  order: 0,
  createdAt: 1000,
};

/** @type {import('../src/popup/projects-logic.js').Document} */
const baseDocument = {
  id: 'd1',
  projectId: 'p1',
  title: 'PROMPTS',
  kind: 'prompt-sheet',
  markdown: '# Test',
  createdAt: 1000,
  updatedAt: 2000,
};

/** @param {Partial<typeof baseProject>} overrides */
const project = (overrides) => ({ ...baseProject, ...overrides });

/** @param {Partial<typeof baseDocument>} overrides */
const document = (overrides) => ({ ...baseDocument, ...overrides });

describe('sortProjects', () => {
  const projects = [
    project({ id: 'p1', name: 'Alpha', order: 0, createdAt: 1000 }),
    project({ id: 'p2', name: 'Beta', order: 1, createdAt: 2000 }),
    project({ id: 'p3', name: 'Gamma', order: 2, createdAt: 3000 }),
  ];

  it('sorts by order ascending by default', () => {
    const sorted = sortProjects(projects, 'order');
    expect(sorted.map((p) => p.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by name alphabetically', () => {
    const sorted = sortProjects(projects, 'name');
    expect(sorted.map((p) => p.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by createdAt descending (newest first)', () => {
    const sorted = sortProjects(projects, 'created');
    expect(sorted.map((p) => p.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });
});

describe('filterProjects', () => {
  const projects = [
    project({ id: 'p1', name: 'GOLDHUNTER', createdAt: 1000 }),
    project({ id: 'p2', name: 'SILVER', createdAt: 2000 }),
    project({ id: 'p3', name: 'BRONZE', createdAt: 3000 }),
  ];

  it('returns all for empty query', () => {
    expect(filterProjects(projects, '')).toHaveLength(3);
    expect(filterProjects(projects, '   ')).toHaveLength(3);
  });

  it('searches case-insensitively across name', () => {
    expect(filterProjects(projects, 'gold').map((p) => p.name)).toEqual(['GOLDHUNTER']);
    expect(filterProjects(projects, 'SILVER').map((p) => p.name)).toEqual(['SILVER']);
  });

  it('searches across multiple terms (AND)', () => {
    const projectsWithDesc = projects.map((p) => ({ ...p, description: `Project ${p.name}` }));
    expect(filterProjects(projectsWithDesc, 'gold project').map((p) => p.name)).toEqual(['GOLDHUNTER']);
  });
});

describe('sortDocuments', () => {
  const documents = [
    document({ id: 'd1', title: 'Alpha', updatedAt: 1000 }),
    document({ id: 'd2', title: 'Beta', updatedAt: 2000 }),
    document({ id: 'd3', title: 'Gamma', updatedAt: 3000 }),
  ];

  it('sorts by updatedAt descending (newest first) by default', () => {
    const sorted = sortDocuments(documents, 'updated');
    expect(sorted.map((d) => d.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('sorts by name alphabetically', () => {
    const sorted = sortDocuments(documents, 'name');
    expect(sorted.map((d) => d.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by kind then name', () => {
    const docs = [
      document({ id: 'd1', title: 'A', kind: 'notes', updatedAt: 1000 }),
      document({ id: 'd2', title: 'B', kind: 'prompt-sheet', updatedAt: 2000 }),
      document({ id: 'd3', title: 'C', kind: 'prompt-sheet', updatedAt: 3000 }),
    ];
    const sorted = sortDocuments(docs, 'kind');
    // Within same kind, sorts by name alphabetically
    expect(sorted.map((d) => `${d.kind}:${d.title}`)).toEqual(['prompt-sheet:B', 'prompt-sheet:C', 'notes:A']);
  });
});

describe('filterDocuments', () => {
  const documents = [
    document({ id: 'd1', title: 'GOLDHUNTER_PROMPTS', kind: 'prompt-sheet', markdown: '# Prompts\n```\nshot 1\n```' }),
    document({ id: 'd2', title: 'SCREENPLAY', kind: 'screenplay', markdown: 'FADE IN:' }),
    document({ id: 'd3', title: 'BREAKDOWN', kind: 'breakdown', markdown: '## G01 — Shot' }),
  ];

  it('returns all for empty query', () => {
    expect(filterDocuments(documents, '')).toHaveLength(3);
  });

  it('searches case-insensitively across title and markdown', () => {
    expect(filterDocuments(documents, 'prompt').map((d) => d.title)).toEqual(['GOLDHUNTER_PROMPTS']);
    expect(filterDocuments(documents, 'fade').map((d) => d.title)).toEqual(['SCREENPLAY']);
    expect(filterDocuments(documents, 'g01').map((d) => d.title)).toEqual(['BREAKDOWN']);
  });
});