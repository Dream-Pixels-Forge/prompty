## Goal: G7 — Local usage insights

> **Status: done.** Notes from the PR:
>
> - "Variables you fill most, with their most common values" became **Recent fill-ins**. G6 memory
>   keeps only the last value per variable, and counting values would mean new tracking, which this
>   goal's own rule forbids.
> - Dormant and never-used actions reuse G4: **Select these** opens the library with exactly those
>   prompts selected, so the bulk bar can tag, move or delete them, with undo. There is no separate
>   archive flow.
> - Charts are HTML/CSS bars and columns in one hue, with values at the tip or cap and native hover
>   titles; every row is a button. Per the dataviz validator, the bar color is `#FF6A00` on light
>   (contrast WARN, satisfied by the always-visible values) and `#E65F00` on dark (`#FF6A00` fails
>   the dark lightness band).
> - "Never used" skips prompts added in the last 7 days.

### Objective

An "Insights" view shows what your library is doing, computed only from data already stored:

- most-used prompts and categories
- prompts never used, or dormant for 90+ days
- variables you fill most, with their most common values (from `variableMemory`)
- library growth by month

### Deliverables

- [x] Pure `src/popup/insights.js` → `{ topPrompts, topCategories, dormant, neverUsed, growth, variables }`.
- [x] Insights view: small accessible bar charts (inline SVG, `textContent` labels), each row
      linking to the prompt or category. Actions on dormant prompts: archive tag, delete with undo.

### Definition of Done

- [x] Fixture tests for every metric; empty library state; gates green; screenshots light/dark.

### Anti-Drift Rules

- No new tracking: only `useCount`, `lastUsedAt`, `createdAt` and `variableMemory`, which already
  exist. No timestamps per use.

### Estimated Effort

S–M
