# ROADMAP — Next-Level Subgoals for Prompty

> Active, code-pinned subgoals live in [`subgoals/`](subgoals/README.md). This file keeps the full backlog.

Status marker: v0.1 = the clone+global build (issues #1–#4, in flight).
Everything below raises the bar beyond parity. Format per goal-writer.
All features stay **100% local** (no servers, no telemetry) — security baseline non-negotiable.

---

## Tier v0.2 — "Reflex" (makes Prompty the fastest path from thought → prompt)

## Goal: G1 — Trigger-character quick-insert ("/" palette in any input)

### Objective
Typing `!` or `/p` (configured, default `!`) inside ANY focused editable opens a shadow-DOM fuzzy palette of prompts; Enter inserts, arrow keys navigate, Esc cancels — in under 150ms locally.

### Context
Opening the toolbar/pill is a mode switch; a trigger char keeps flow state. This is the single biggest daily-use elevators (ChatGPT/Claude/any AI box users live in inputs).

### Deliverables
- [ ] Trigger-char detection anchored to caret (contenteditable + textarea/input) in `src/content/assist.js`
- [ ] Shadow palette with fuzzy search (subsequence match in `src/lib/search.js`, tested)
- [ ] Enter→insert via existing PROMPTY_INSERT path; variable prompts route through fill-in miniform
- [ ] Settings: `quickTrigger` (default `!`), toggle on/off

### Definition of Done
- [ ] `!` opens palette ≤150ms after keystroke on a focused textarea; keyboard-only flow works
- [ ] Unit tests for fuzzy matcher + trigger state machine; all gates green (type/lint/test/build)
- [ ] Works on textarea, input, contenteditable (smoke on 3 sites)

### Verification Steps
1. `pnpm test` — fuzzy + trigger tests pass
2. Manual: `!cr` on a plain textarea, Enter → "Character" prompt inserts
3. `pnpm type-check && pnpm lint && pnpm build` exit 0

### Anti-Drift Rules
- Palette reuses existing insertion pipeline; no new insert code path.
- Do not auto-open on every keystroke without trigger config; if ambiguous, report blocker.

### Estimated Effort
M (2 subagent sessions; ~60% in assist.js state machine + tests)

---

## Goal: G2 — Keyboard-first command palette in popup (Ctrl+K)

### Objective
Ctrl/Cmd+K opens a popup command palette that fuzzy-runs every action: search prompts, insert, append, copy, promote snippet, jump to category, toggle compact/theme.

### Context
Parity popup is click-driven; power users (goal: "next level") expect command-palette UX. Reuses G1's fuzzy matcher — zero new search code.

### Deliverables
- [ ] `src/popup/palette.js` + styles; pool of registered commands (id, label, hotkey)
- [ ] Prompt items + commands in one ranked list (recent-use weighted)
- [ ] Unit tests for ranking/matching

### Definition of Done
- [ ] Ctrl+K in popup → palette; insert/append/copy/promote all executable keyboard-only
- [ ] Ranking test passes (recency + subsequence score); all gates green

### Verification Steps
1. `pnpm test` — palette ranking tests
2. Manual: Ctrl+K → type "port" → Enter inserts "Product-Style Object"? (uses matcher output)
3. Gates all exit 0

### Anti-Drift Rules
- No mouse-dependent features smuggled in; palette closes pure-Esc.
- Palette shares `src/lib/search.js` only — no separate matching implementation.

### Estimated Effort
S–M (mostly popup-side; matcher comes free from G1)

---

## Goal: G3 — Site recipes pack (AI-aware save/insert anchors)

### Objective
Convert the original's hand-coded higgsfield behaviors into a data-driven **site recipes** system: a JSON registry maps origin patterns → selectors & settings (save button anchor, submit detection, aspect/quality selects), shipped with recipes for the top AI-generation sites, user-extensible in settings.

### Context
The original solved higgsfield via selectors like `#hf\\:image-form-submit` and placeholder heuristics. As a GLOBAL tool, Prompty needs that intelligence per site without recompiling: recipes as data.

### Deliverables
- [ ] `src/lib/recipes.js` — match(url) → recipe; schema `{originPattern, promptInput[], submit[], selects:{aspect,quality}, qualityValues, notes}`; fallback chain = heuristics (original) → recipe when both apply (recipe wins first-match)
- [ ] `assets/recipes.json` — ≥6 seeded recipes (higgsfield.ai ports original selectors + generic fallback)
- [ ] Settings UI: view recipes, add custom recipe (paste JSON), enable/disable per recipe
- [ ] Schema unit tests + a "recipe lint" test (all required fields, selector syntax valid)

### Definition of Done
- [ ] Recipe wins over heuristic where defined; tests prove override order
- [ ] `web-ext lint` clean with recipes.json in both dists (web_accessible_resources or bundled import — validation required)
- [ ] 6 recipes seed-validated by tests

### Verification Steps
1. `pnpm test` — recipes schema + priority tests
2. Manual: higgsfield.ai with recipe on → save/insert anchored as before
3. Gates exit 0

### Anti-Drift Rules
- No remote recipe fetching (local-only invariant). Custom recipes from user paste only.
- Do not hardcode new selectors outside recipes.json.

### Estimated Effort
M (data + matching logic mostly, small UI)

---

## Goal: G4 — Multi-select + drag-to-category bulk ops

### Objective
Cards support multi-select (Shift/click/`A` all); bulk: tag, categorize (including drag-drop onto sidebar), copy, export-JSON, delete with undo toast (10s).

### Context
Libraries grow fast; per-card actions don't scale. Bulk + undo = safety + speed in one move.

### Deliverables
- [ ] Selection state in popup (`selectedIds[]`, shifts supported)
- [ ] Bulk action bar (contextual) + drag-drop to categories
- [ ] Undo: staged delete with 10s restore toast (no deleted data leaves memory)
- [ ] Tests: selection reducer + bulk tag apply

### Definition of Done
- [ ] Keyboard: A toggles select-all, Del opens undoable delete; drag works into any category row
- [ ] Reducer tests pass; gates exit 0

### Verification Steps
1. `pnpm test` — selection/bulk/undo tests
2. Manual: select 3 → bulk tag "work" → all tagged; delete → undo restores
3. Gates exit 0

### Anti-Drift Rules
- Undo is memory-only; do not add a recycle-bin storage schema without a new goal.

### Estimated Effort
M

---

## Goal: G5 — Prompt version history + diff view + revert

### Objective
Every prompt edit (from popup or assist-save overwrite) appends to `versions[]` (cap 20); a History modal shows any two versions diffed (word-level) and reverts.

### Context
Prompts are iterated constantly; users fear losing a "that one worked" variant. Full history kills that fear — original extension has none.

### Deliverables
- [ ] `versions: [{text, editedAt}]` in prompt schema (populated via normalize-on-write)
- [ ] `src/lib/diff.js` (word-level LCS, tested)
- [ ] History modal: list + diff + revert (revert = new version entry, no data loss)
- [ ] Export includes versions; import normalizes

### Definition of Done
- [ ] LCS diff tests (identical/insert/reorder) pass; revert restores exactly
- [ ] Gates exit 0; storage quota-safe (versions capped)

### Verification Steps
1. `pnpm test` — diff + versioning tests
2. Manual: edit → history → diff visible → revert → old text restored
3. Gates exit 0

### Anti-Drift Rules
- Cap versions at 20 FIFO; never add a sync/removal semantic here.

### Estimated Effort
M

---

## Goal: G6 — Variables 2.0: enums, ranges, session value memory

### Objective
Variable values may be defined as `{style:watercolor|vector}` (enum) or `{seed:1-999}` (range); the fill-in form renders selects/inputs accordingly; per-variable last values are remembered per session (overlay `variableMemory`), one-click reuse.

### Context
The original's variables are free-text only. Enums/ranges turn prompts into mini-generators; memory removes retyping.

### Deliverables
- [ ] Grammar parser in `src/lib/variables.js` (backward compatible: plain `{name}` unchanged)
- [ ] Fill-in form renders enum→select, range→number input
- [ ] `variableMemory` in storage (cap 100 FIFO), prefill + "clear memory"
- [ ] Grammar/layout/burst tests (range: random pick)

### Definition of Done
- [ ] Old prompts with `{name}` behave identically (regression test)
- [ ] Enum dropdown restricts values; range accepts only in-range
- [ ] Gates exit 0

### Verification Steps
1. `pnpm test` — parser backward-compat + new forms
2. Manual: `{style:watercolor|vector}` → dropdown; remembered values prefilled next time
3. Gates exit 0

### Anti-Drift Rules
- Burst generation is a SEPARATE goal (G6b in backlog); do not add here.

### Estimated Effort
M

---

## Goal: G7 — Local usage insights panel

### Objective
A Stats view in popup: most-used prompts, prompts per day (14d sparkline), top sites by insertion (per origin from lastUsedAt context), category share — computed at render time from storage, zero new persistence.

### Context
Creators batch-generate; knowing what performs keeps the library curated. Local-only, no analytics ever sent anywhere.

### Deliverables
- [ ] `src/popup/stats.js` + panel markup, empty states
- [ ] Unit tests for aggregation (empty/mid/dense datasets)
- [ ] Export of stats CSV (simple string builder)

### Definition of Done
- [ ] Aggregations verified by table-driven tests
- [ ] Renders <50ms for 1k prompts (virtualization not required at this scale)
- [ ] Gates exit 0

### Verification Steps
1. `pnpm test` — stats aggregation tests
2. Manual: insert 3× on two sites → panel reflects both origins
3. Gates exit 0

### Anti-Drift Rules
- No new storage keys (derive from existing `useCount`/origin tracking added here? NO — origin is observable only at insert time: add `lastUsedOrigin` write path inside existing INSERT update, do not migrate history).

### Estimated Effort
S–M

---

## Goal: G8 — Theming, a11y & i18n baseline

### Objective
Light theme + high-contrast themes driven by CSS custom properties; full keyboard traversal + ARIA labels for interactive elements; reduced-motion respect; UI strings extracted into `src/lib/i18n.js` with en-US complete.

### Context
Ship-quality accessibility and theming are next-level table stakes; extraction now unlocks translations later without refactor.

### Deliverables
- [ ] `src/popup/tokens.css` light/high-contrast/dark; system-preference default
- [ ] aria-labels/roles on all buttons, focus rings visible; `prefers-reduced-motion` disables animations
- [ ] i18n extraction with en-US (≥95% strings), `t(key)` helper

### Definition of Done
- [ ] axe-style manual checklist passes (focus order, labels, contrast ≥4.5:1 all text)
- [ ] Zero raw strings outside i18n.js (grep gate added to CI: `tests/no-raw-strings.test.mjs`)
- [ ] Gates exit 0

### Verification Steps
1. `pnpm test` — i18n coverage gate
2. Manual: Tab through popup — visible focus, sensible order; theme toggle switches tokens
3. Gates exit 0

### Anti-Drift Rules
- Do not redesign layout; token swap + labels only.
- Other locales: out of scope (new goal when needed).

### Estimated Effort
M

---

## Tier v0.3 — "Differentiators"

| ID | Goal | Objective (condensed) | Key DoD | Effort |
|---|---|---|---|---|
| G9 | Prompt Composer | Block-based builder (Subject/Style/Camera/Lighting/Preset chips, drag-reorder) → composed text → save/insert; blocks as reusable snippets | Composer saves round-trip through prompts; reorder persists; gates green | L |
| G10 | Vault Mode | Opt-in passphrase AES-GCM encryption (WebCrypto, PBKDF2 250k iters) for stored prompts; auto-lock after idle; migration both ways with explicit export warnings | Round-trip encrypt/decrypt tests; locked vault unreadable without passphrase; no plaintext on disk in vault mode | L |
| G11 | Migration Suite | Import from CSV/TXT/JSON + competitor schemas (incl. upstream export format); auto-dedupe by text hash; merge report UI (added/merged/skipped counts) | Round-trip import of upstream `higgsfield-prompts-*.json` verified vs real sample; report accurate (table-driven tests) | M |
| G12 | IndexedDB engine | Storage backend swap: IndexedDB mirror for libraries >1k prompts; virtualized grid; lazy categories counts; storage.local keeps <100 items fast path | 5k-prompt fixture: first render <400ms; all existing features pass against new engine via a storage-adapter test seam | L |
| G13 | Pack sharing | `.prompty` single-file packs (prompts+categories+variables as zip64-safe JSON+icons), export/share/import with drag-drop onto popup; schema versioned | Sample pack exports→imports lossless (field-by-field test); malicious pack rejected by validation tests | M |

## Tier v0.4+ — "Moonshots"

| ID | Goal | Objective (condensed) | Why next-level |
|---|---|---|---|
| G14 | Smart library hygiene | Near-duplicate detection (normalized similarity), auto-tag suggestions from keyword rules, "archive dormant" review flow | Turns storage into a curated asset |
| G15 | Burst generator | From variables-with-enums/ranges: generate N combinations (cartesian or sampled), export batch as .txt/CSV, send-as-numbered lines | Pairs with bulk AI-gen workflows |
| G16 | Prompt hotkeys | Up to 4 user-bound prompts (Firefox/Chrome command slots) insert into active tab directly | Reflex-to-0 UI |
| G17 | Weekly auto-snapshot (opt-in) | Local JSON snapshot to Downloads with rotation cap 4; restore wizard | Safety net without servers |
| G18 | On-device rewrite assist | Local heuristics prompt-improver (checklist lint: subject presence, camera, negative terms) — NO cloud LLM | Differentiated "editor" feel, zero privacy cost |

## Sequencing

```
v0.1 (#1–#4, in flight) → v0.2: G3+G1 (parallel) → G2+G5 → G4+G6 → G7+G8
                        → v0.3: G11 (migration) unlocks onboarding of existing users
                        → v0.3: G12 perf → G9/G10/G13 by demand
```
