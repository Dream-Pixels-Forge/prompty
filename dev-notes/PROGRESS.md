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
  G2 palette is now the popup's first real UI. Still missing: library grid, prompt editor,
  categories manager, snippets tab, settings (incl. the **custom recipe editor** marked ✅ above).
- **background.js imports were commented out** (unclosed `/**` header): every background message,
  command and `mergeSettings` call threw `ReferenceError`. Fixed; ESLint `no-undef` now guards the file.
- **Seed presets never ran** (`seedPresets()` had no caller). Background now seeds on every start (idempotent).
- **Context-menu "Save Selection" has no `onClicked` listener**, and save-selection only records a
  snippet, never a prompt. Open.

### v0.3 progress
| Goal | Status |
|------|--------|
| G2 Ctrl+K command palette (`src/popup/palette.js` + popup UI) | ✅ prompts/snippets/commands ranked; insert/append/copy/promote keyboard-only; variable fill-in; category scope; compact/widget/export commands |

### Next wave: v0.3 "Differentiators" (ROADMAP.md)
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