# Pipeline Progress

- Project: prompty
- Started: 2026-11-05
- Current Phase: v0.5.0 released (2026-11-14) — see [`CHANGELOG.md`](../CHANGELOG.md) and [release v0.5.0](https://github.com/Dream-Pixels-Forge/prompty/releases/tag/v0.5.0)

## Phase completion

- [x] REA analysis of upstream artifact (ev_84b4661a…) + behavior spec ses_e568a18b…
- [x] Phase 2: GOAL.md, SPEC.md, SECURITY.md, ROADMAP.md
- [x] Phase 3: engineering issues → subagents → PRs (all merged)

### v0.1 Complete — Issues merged

| Issue | PR  | Title                                                                     | Status    |
| ----- | --- | ------------------------------------------------------------------------- | --------- |
| #1    | #5  | scaffold: project skeleton + shared lib + dual-manifest build + green CI  | ✅ Merged |
| #2    | #8  | popup: global prompt library UI + clipboard pack UI                       | ✅ Merged |
| #3    | #9  | content: smart assist pill + floating widget + insert handlers (any site) | ✅ Merged |
| #4    | #10 | background: dual background + context menu + keyboard shortcuts           | ✅ Merged |
| #6    | #7  | bug: CI red on main — tsc can't find node:fs/promises types               | ✅ Merged |

### v0.2 "Reflex" Complete — Issues merged

| Issue | PR  | Title                                                                      | Status    |
| ----- | --- | -------------------------------------------------------------------------- | --------- |
| #11   | #13 | feat(G3): site recipes pack — data-driven save/insert anchors for AI sites | ✅ Merged |
| #12   | #14 | feat(G1): trigger-char quick-insert ('!' palette in any input)             | ✅ Merged |

### Deliverables verified (v0.1 + v0.2)

- ✅ `dist/chrome/` — Chromium MV3 (service_worker) build
- ✅ `dist/firefox/` — Firefox MV3 (event page) build
- ✅ Both manifests validated — `web-ext@8 lint --warnings-as-errors` (Firefox) + `pnpm validate`
      (both; `addons-linter` retired in #42 — it is a Firefox linter and could not check Chrome)
- ✅ 191 tests passing (TDD: tests written before implementation)
- ✅ Zero network calls; `storage.local` only; no telemetry

### v0.2 Features Delivered

| Feature                                                                                | Spec  | Status |
| -------------------------------------------------------------------------------------- | ----- | ------ |
| Site recipes pack (6 seeded: higgsfield, ChatGPT, Claude, Gemini, Perplexity, generic) | G3    | ✅     |
| Custom recipe editor in settings (paste JSON, validate, enable/disable)                | G3    | ✅     |
| Recipe priority overrides heuristic selectors                                          | G3    | ✅     |
| Trigger-char quick-insert (`!` opens fuzzy palette at caret)                           | G1    | ✅     |
| Subsequence fuzzy matching + recency boost                                             | G1    | ✅     |
| Variable fill-in form in palette                                                       | G1    | ✅     |
| Shared `src/lib/search.js` (reusable by G2)                                            | G1    | ✅     |
| Settings: `quickTrigger`, `quickTriggerEnabled`, `siteRecipes[]`, `enabledRecipes[]`   | G1/G3 | ✅     |

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

| Goal                                                                         | Status                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G2 Ctrl+K command palette (`src/popup/palette.js` + `palette-ui.js` overlay) | ✅ prompts/snippets/commands ranked; insert/append/copy/promote keyboard-only; variable fill-in; jump-to-category/compact/widget/export commands                                                                                                                                                                                                 |
| Brand + mascot                                                               | ✅ Dream Pixels Forge palette (black/white, orange #FF6A00 sampled from the icon); mascot icon at 16/32/48/128 with transparent corners; mascot in popup header                                                                                                                                                                                  |
| Seed v3 cinematic pack                                                       | ✅ +10 categories, +44 prompts; upgrades add only what a newer seed version introduced (deleted starters stay deleted), join prompts to existing categories by name, never duplicate a category                                                                                                                                                  |
| Popup screens (SPEC §1 parity)                                               | ✅ 780×580 shell; sidebar views + categories CRUD/reorder (18 colors × 24 emoji); cards with favorite, ⚡vars, chips, stats, insert/append/copy/edit/delete (10s undo); search (`/`), sort; prompt editor; variable fill-in modal; snippets tab; settings (general, quick insert, disabled sites, recipes, import/export); live sync; light/dark |

### v0.3.0 — merged (subgoal specs in [`subgoals/`](subgoals/README.md))

| PR  | Subgoal                                                                      | Status    |
| --- | ---------------------------------------------------------------------------- | --------- |
| #15 | Popup screens, brand, Ctrl+K palette (G2), cinematic seed pack               | ✅ Merged |
| #16 | Fix: in-page UI blocked every click · S1 Save Selection · S2 in-page rebrand | ✅ Merged |
| #17 | S3 16/32 px toolbar glyph                                                    | ✅ Merged |
| #18 | G5 version history                                                           | ✅ Merged |
| #19 | G6 Variables 2.0                                                             | ✅ Merged |
| #20 | G9 Prompt Composer                                                           | ✅ Merged |
| #21 | G4 bulk operations                                                           | ✅ Merged |
| #22 | G9b shot sequences                                                           | ✅ Merged |
| #23 | G9c model dialects (Seedance, Muse)                                          | ✅ Merged |

Release pass: version 0.3.0, `CHANGELOG.md`, store screenshots and listing in `store/`.

### v0.4.0 — merged (release: [v0.4.0 — Sovereign](https://github.com/Dream-Pixels-Forge/prompty/releases/tag/v0.4.0))

| PR  | Subgoal / change                                                              | Status    |
| --- | ------------------------------------------------------------------------------ | --------- |
| #25 | G11 Migration Suite — import from another tool, with a report                  | ✅ Merged |
| #26 | G13 `.prompty` share packs                                                     | ✅ Merged |
| #27 | G7 Insights — what your library is doing                                       | ✅ Merged |
| #28 | G8a accessibility — 0 axe violations, light and dark                           | ✅ Merged |
| #29 | G10 Vault Mode — opt-in encryption at rest                                     | ✅ Merged |
| #30 | G8b popup localization — English + French                                      | ✅ Merged |
| #31 | G8c in-page UI translation — pill, widget, `!` palette, toasts                 | ✅ Merged |
| #32 | G12 5k-prompt libraries in ~0.3 s — incremental grid, no double reads          | ✅ Merged |
| #33 | brand assets + static landing page (`assets/`, `docs/`)                        | ✅ Merged |
| #34 | CI zero annotations — actions bumped off Node 20, quota-hit upload removed     | ✅ Merged |
| #35 | release v0.4.0 — versions, changelog, store listing, screenshots, mount fix    | ✅ Merged |

First tagged release: `v0.4.0` with `prompty-0.4.0-chrome.zip` / `prompty-0.4.0-firefox.xpi`
attached as release assets (CI no longer uploads run artifacts — the account hit its Actions
storage quota).

### v0.5.0 — agent bridge (issue #39)

| PR  | Subgoal / change                                                               | Status    |
| --- | ------------------------------------------------------------------------------ | --------- |
| #40 | G14 MCP agent bridge — coding agents save prompts straight into Prompty        | ✅ Merged |

A coding agent (Claude Code, Cursor, Claude Desktop, any MCP client) can add prompts to the
library: `save_prompt` writes to `~/.prompty`, the extension imports over a token-authed
`127.0.0.1` bridge on a one-minute `alarms` clock. Off by default; the extension refuses
non-loopback URLs and keeps the pairing token outside `settings` so exports never contain it.
Subgoal spec: [`subgoals/G14-mcp-agent-bridge.md`](subgoals/G14-mcp-agent-bridge.md).

### v0.5.1 — Chrome-clean manifest (issue #42)

| PR  | Subgoal / change                                                               | Status    |
| --- | ------------------------------------------------------------------------------ | --------- |
| #43 | Chrome-clean manifest + `scripts/validate-manifests.mjs` gate                  | ✅ Merged |

`dist/chrome/manifest.json` no longer carries `background.scripts` or `browser_specific_settings`
— Firefox-only keys that Chromium ignores and the Chrome Web Store reports as unrecognized. They
were there solely so `addons-linter` (Mozilla's Firefox linter) would accept the Chromium package,
which also meant the gate could never fail. Shapes now live in `scripts/manifest.mjs`; both targets
are checked by `scripts/validate-manifests.mjs` (target shape, cross-browser keys, referenced files,
`__MSG_*__` placeholders, version sync), wired into `pnpm build` and CI.

Release pass: version 0.5.1, `CHANGELOG.md`, store listing and landing-page version.

### v0.5.2 — G15b multi-model prompt sheets

| PR  | Subgoal / change                                                               | Status    |
| --- | ------------------------------------------------------------------------------ | --------- |
| —   | Model profiles with sourced limits (9 models)                                  | ✅ Merged |
| —   | Multi-variant prompt sheets (per-shot, per-model variants)                     | ✅ Merged |
| —   | Wrappers (`meta-ai-pass-through`) + site-aware insert                          | ✅ Merged |
| —   | Convert (structure only, cut-syntax rewrite)                                   | ✅ Merged |
| —   | MCP: `list_models`, `get_shot {model?}`, `save_document` variant counts        | ✅ Merged |
| —   | Packs carry models/wrappers                                                    | ✅ Merged |
| —   | Settings UI for custom models/wrappers                                         | ✅ Merged |
| —   | i18n (EN + FR) for all new strings                                             | ✅ Merged |

Release pass: version 0.5.2, `CHANGELOG.md`, store listing, landing-page version.

### Open backlog (ROADMAP.md)

1. **G19** Smart library hygiene — near-duplicate detection, auto-tag suggestions, archive dormant
2. **G15** Burst generator — N combinations from enums/ranges, batch export
3. **G16** Prompt hotkeys — up to 4 user-bound insert commands
4. **G17** Weekly auto-snapshot (opt-in, rotation cap 4)
5. **G18** On-device rewrite assist — local heuristics, no cloud LLM
6. **Deferred**: G12's IndexedDB adapter — only when the benchmark shows storage dominating, or
   libraries approach the 10 MB `storage.local` quota
7. **Optional**: publish `docs/index.html` (GitHub Pages) — committed but not deployed
