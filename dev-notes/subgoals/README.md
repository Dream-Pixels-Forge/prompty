# Subgoals — next wave (after #15)

Each file is one shippable subgoal in the ROADMAP format (Objective · Context ·
Deliverables · Definition of Done · Verification · Anti-Drift · Effort). One subgoal = one PR.
Everything stays 100% local: no network, no telemetry, `storage.local` only (GOAL.md).

## Order

| #   | Subgoal                                               | Why now                                       | Effort | Depends on       |
| --- | ----------------------------------------------------- | --------------------------------------------- | ------ | ---------------- |
| 1   | [S1 — Save Selection as Prompt](S1-save-selection.md) | A visible menu item that does nothing         | S      | —                |
| 2   | [S2 — In-page UI rebrand](S2-in-page-rebrand.md)      | Pill, widget and `!` palette are still purple | M      | —                |
| 3   | [S3 — 16/32px toolbar glyph](S3-toolbar-glyph.md)     | Mascot reads as a white blob at 16px          | S      | —                |
| 4   | [G5 — Prompt version history](G5-version-history.md)  | Never lose the take that worked               | M      | —                |
| 5   | [G6 — Variables 2.0](G6-variables-2.md)               | Prompts become mini shot-generators           | M      | —                |
| 6   | [G4 — Bulk operations](G4-bulk-ops.md)                | 52+ prompts outgrow per-card actions          | M      | —                |
| 7   | [G9 — Prompt Composer](G9-prompt-composer.md)         | Turns the library into a shot-design kit      | L      | G6 (recommended) |

S1–S3 fix what a user sees on day one; do them first. G5/G6/G4 are independent and can
run in parallel. G9 works without G6 but is far better with enum variables.

## Status

- [x] S1 · [x] S2 · [x] S3 · [x] G5 · [x] G6 · [ ] G4 · [x] G9

## Rules for every subgoal

- Tests first for every pure function; gates green: `pnpm type-check && pnpm lint && pnpm test && pnpm package`.
- Firefox `web-ext lint --warnings-as-errors` stays 0/0/0.
- Run the built extension in headless Chromium for any UI change; screenshot light + dark.
- UI text goes through `textContent` only (SECURITY.md). New storage keys are whitelisted.
- Brand: black/white + `#FF6A00`; orange as small text uses `#B84C00` on light (see `src/popup/popup.css`).
