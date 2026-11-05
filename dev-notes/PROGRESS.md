# Pipeline Progress

- Project: prompty
- Started: 2026-11-05
- Current Phase: v0.1 complete → v0.2 wave ready

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

### Deliverables verified
- ✅ `dist/chrome/` — Chromium MV3 (service_worker) build
- ✅ `dist/firefox/` — Firefox MV3 (event page) build
- ✅ Both pass `web-ext@8 lint --warnings-as-errors` (Firefox) and `addons-linter` (Chrome)
- ✅ 88 tests passing (TDD: tests written before implementation)
- ✅ Zero network calls; `storage.local` only; no telemetry

### Next wave: v0.2 "Reflex" (ROADMAP.md)
Priority order per ROADMAP:
1. **G3** Site recipes pack (AI-aware save/insert anchors — data-driven, user-extensible)
2. **G1** Trigger-char quick-insert (`!` palette in any input — 150ms flow)
3. **G2** Ctrl+K command palette in popup
4. **G5** Prompt version history + diff + revert
5. **G4** Multi-select bulk ops + drag-to-category
6. **G6** Variables 2.0 (enums, ranges, session memory)
7. **G7** Local usage insights panel
8. **G8** Theming + a11y + i18n baseline