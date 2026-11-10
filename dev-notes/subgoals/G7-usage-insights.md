## Goal: G7 — Local usage insights

### Objective

An "Insights" view shows what your library is doing, computed only from data already stored:

- most-used prompts and categories
- prompts never used, or dormant for 90+ days
- variables you fill most, with their most common values (from `variableMemory`)
- library growth by month

### Deliverables

- [ ] Pure `src/popup/insights.js` → `{ topPrompts, topCategories, dormant, neverUsed, growth, variables }`.
- [ ] Insights view: small accessible bar charts (inline SVG, `textContent` labels), each row
      linking to the prompt or category. Actions on dormant prompts: archive tag, delete with undo.

### Definition of Done

- [ ] Fixture tests for every metric; empty library state; gates green; screenshots light/dark.

### Anti-Drift Rules

- No new tracking: only `useCount`, `lastUsedAt`, `createdAt` and `variableMemory`, which already
  exist. No timestamps per use.

### Estimated Effort

S–M
