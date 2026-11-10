# Pipeline Progress

- Project: prompty
- Started: 2026-11-05
- Current Phase: v0.3 in progress — G2 command palette landed

## Phase completion
- [x] REA analysis of upstream artifact (ev_84b4661a…) + behavior spec ses_e568a18b…
- [x] Phase 2: GOAL.md, SPEC.md, SECURITY.md, ROADMAP.md
- [x] Phase 3: engineering issues → subagents → PRs (all merged)

### v0.1 Complete — Issues merged
| Issue | PR | Title | Status |
|-------|----|-------|--------|
| #1 | #5 | scaffold: project skeleton + shared lib + dual-manifest build + green CI | ✅ Merged |
| #2 | #8 | popup: global prompt library UI + clipboard pack UI | ✅ Merged |
| #3 | #9 | content: smart assist pill + floating widget + insert handlers (any site) | ✅ Merged |
| #4 | #10 | background: dual background + context menu + keyboard shortcuts | ✅ Merged |
| #6 | #7 | bug: CI red on main — tsc can't find node:fs/promises types | ✅ Merged |

### v0.2 "Reflex" Complete — Issues merged
| Issue | PR | Title | Status |
|-------|----|-------|--------|
| #11 | #13 | feat(G3): site recipes pack — data-driven save/insert anchors for AI sites | ✅ Merged |
| #12 | #14 | feat(G1): trigger-char quick-insert ('!' palette in any input) | ✅ Merged |

### Deliverables verified (v0.1 + v0.2)
- ✅ `dist/chrome/` — Chromium MV3 (service_worker) build
- ✅ `dist/firefox/` — Firefox MV3 (event page) build
- ✅ Both pass `web-ext@8 lint --warnings-as-errors` (Firefox) and `addons-linter` (Chrome)
- ✅ 191 tests passing (TDD: tests written before implementation)
- ✅ Zero network calls; `storage.local` only; no telemetry

### v0.2 Features Delivered
| Feature | Spec | Status |
|---------|------|--------|
| Site recipes pack (6 seeded: higgsfield, ChatGPT, Claude, Gemini, Perplexity, generic) | G3 | ✅ |
| Custom recipe editor in settings (paste JSON, validate, enable/disable) | G3 | ✅ |
| Recipe priority overrides heuristic selectors | G3 | ✅ |
| Trigger-char quick-insert (`!` opens fuzzy palette at caret) | G1 | ✅ |
| Subsequence fuzzy matching + recency boost | G1 | ✅ |
| Variable fill-in form in palette | G1 | ✅ |
| Shared `src/lib/search.js` (reusable by G2) | G1 | ✅ |
| Settings: `quickTrigger`, `quickTriggerEnabled`, `siteRecipes[]`, `enabledRecipes[]` | G1/G3 | ✅ |

### Audit findings (2026-11-09) — gaps behind earlier ✅ marks
- **Popup UI was never built**: #2/#8 shipped only `popup/logic.js`; `popup.js`/`index.html` were stubs.
  ✅ Now built (see v0.3 progress): library grid, editor, categories, snippets, settings, recipe editor.
- **Settings keys `quickTrigger`/`quickTriggerEnabled` were not whitelisted** (any settings write reset
  them) and **custom recipes had no path to the content script** (it reads top-level `siteRecipes`).
  ✅ Whitelisted; popup mirrors enabled user recipes to `siteRecipes` on every settings save.
- **background.js imports were commented out** (unclosed `/**` header): every background message,
  command and `mergeSettings` call threw `ReferenceError`. Fixed; ESLint `no-undef` now guards the file.
- **Seed presets never ran** (`seedPresets()` had no caller). Background now seeds on every start (idempotent).
- **Context-menu "Save Selection" had no `onClicked` listener**, and save-selection only recorded a
  snippet. ✅ Fixed in S1.

### Audit findings (S1, 2026-11-10) — in-page bugs that were live on every site
- **Prompty's invisible UI swallowed every click on every page.** The shadow host applied
  `all: initial` last (wiping `position: fixed`, 0×0 size, `pointer-events: none`), and `hidden`
  panels stayed in layout because inline `display` beats the UA `[hidden]` rule — so the hidden
  save-modal backdrop covered the viewport. ✅ `all` first + `[hidden]{display:none!important}` in
  the shadow root; guarded by `tests/content-host.test.mjs`.
- **No page toast ever showed** (`showToast` incremented an undeclared `toastSlotNumber`). ✅ Fixed.
- **`!` palette rendered ~10,000px off-screen** (caret measured on a detached mirror). ✅ Marker span
  measured while attached; palette unhidden before positioning.
- **`!` palette arrow keys threw** (undefined `count`) and, once fixed, **moved two rows per press**
  (duplicate keydown listener). ✅ Fixed.
- **Enter in the `!` variable form inserted blanks** (list handler ran first; no required check).
  ✅ Form owns its keys; every value required (SPEC §1).
- ESLint `no-undef` now also guards `src/content/assist.js` (it is `@ts-nocheck`).

### S2 (2026-11-10) — in-page rebrand + bugs it surfaced
- ✅ Pill, widget, `!` palette, variable form, save dialog and toasts use the brand tokens
  (`THEME_CSS`, light/dark), mascot SVG bubble; parity + contrast test `tests/theme-parity.test.mjs`.
- **Widget bubble ran away from the cursor**: `pointermove` dragged on plain hover (no button held),
  so clicks never registered as taps. ✅ Drag only while pressed; `pointercancel` handled.
- **Widget panel covered its own bubble** at the default right-edge position (clamped right-side
  panel), so it could not be closed or dragged. ✅ Opens on the side with room; `border-box` width.
- **Toasts rendered off-screen** (absolute right/bottom inside the 0×0 host). ✅ `position: fixed`.
- **Save dialog title field overflowed** the dialog. ✅ `box-sizing: border-box`.

### v0.3 progress
| Goal | Status |
|------|--------|
| G2 Ctrl+K command palette (`src/popup/palette.js` + `palette-ui.js` overlay) | ✅ prompts/snippets/commands ranked; insert/append/copy/promote keyboard-only; variable fill-in; jump-to-category/compact/widget/export commands |
| Brand + mascot | ✅ Dream Pixels Forge palette (black/white, orange #FF6A00 sampled from the icon); mascot icon at 16/32/48/128 with transparent corners; mascot in popup header |
| Seed v3 cinematic pack | ✅ +10 categories, +44 prompts; upgrades add only what a newer seed version introduced (deleted starters stay deleted), join prompts to existing categories by name, never duplicate a category |
| Popup screens (SPEC §1 parity) | ✅ 780×580 shell; sidebar views + categories CRUD/reorder (18 colors × 24 emoji); cards with favorite, ⚡vars, chips, stats, insert/append/copy/edit/delete (10s undo); search (`/`), sort; prompt editor; variable fill-in modal; snippets tab; settings (general, quick insert, disabled sites, recipes, import/export); live sync; light/dark |

### Next wave — see [`subgoals/`](subgoals/README.md)
Order: S1 Save Selection → S2 in-page rebrand → S3 toolbar glyph → G5 history → G6 variables 2.0 → G4 bulk ops → G9 Composer.

### v0.3 "Differentiators" backlog (ROADMAP.md)
Priority order per ROADMAP:
1. **G2** Ctrl+K command palette in popup
2. **G5** Prompt version history + diff + revert
3. **G4** Multi-select bulk ops + drag-to-category + undoable delete
4. **G6** Variables 2.0 (enums `{style:a\|b}`, ranges `{seed:1-999}`, session memory)
5. **G7** Local usage insights panel
6. **G8** Theming + a11y + i18n baseline
7. **G9** Prompt Composer (block builder)
8. **G10** Vault Mode (AES-GCM passphrase)
9. **G11** Migration Suite (import upstream export format)
10. **G12** IndexedDB engine for 5k+ prompts
11. **G13** `.prompty` share packs