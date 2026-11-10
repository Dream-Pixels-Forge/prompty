## Goal: G4 — Multi-select and bulk operations

> **Status: done.** Notes from the PR:
>
> - Reducer names are explicit (`selectOnly`, `toggleSelection`, `rangeSelection`,
>   `selectAllVisible`, `clearSelection`, `pruneSelection`) because `library.js` is a shared module.
>   `rangeSelection` keeps its anchor, so Shift+arrows grow _and_ shrink one range.
> - Arrow keys follow the grid: ←/→ step one card, ↑/↓ one row. Enter on a focused card inserts
>   (Shift+Enter appends). Ctrl/Cmd-click on a card body also toggles.
> - "Export selected" writes no `settings`; importing a file without `settings` now keeps the
>   importer's current settings (before, it reset them to defaults).
> - Bulk Copy joins raw texts with a blank line; `{variables}` stay as tokens (no multi-prompt fill-in).

### Objective

Select many prompts at once (click checkbox, Shift-click range, Ctrl/Cmd+A in the grid) and act on all
of them: move to category (menu or drag onto a sidebar category), add/remove tags, favorite,
copy (joined), export selected as JSON, delete with a 10-second undo.

### Context

The library now ships with 52 prompts in 16 categories, and every action is per card
(`card()` in `src/popup/popup.js`). Reorganizing the starter pack, or a big import, means dozens of
edit dialogs. Detailed in ROADMAP G4.

### Deliverables

- [x] Pure selection reducer in `src/popup/library.js`: `select`, `toggle`, `range(anchor, id, visibleIds)`,
      `all(visibleIds)`, `clear`; selection drops ids no longer visible after a filter change.
- [x] Pure bulk transforms: `bulkMove(prompts, ids, categoryId)`, `bulkTag(prompts, ids, add[], remove[])`,
      `bulkFavorite`, `removeMany` → `{ prompts, removed: [{ prompt, index }] }`, `restoreMany`.
- [x] Card checkbox (visible on hover/focus and whenever a selection exists) + selected styling (orange edge).
- [x] Contextual bulk bar replacing the toolbar while selecting: count · Move · Tag · ★ · Copy ·
      Export · Delete · ✕ clear. Esc clears.
- [x] Drag selected cards onto a sidebar category row → move. Use a distinct drag type
      (`application/x-prompty-prompts`) so it never collides with category reordering (`text/plain`).
- [x] Undo toast for bulk delete restores every prompt at its original index.

### Definition of Done

- [x] Keyboard-only: Space toggles focused card, Shift+↑/↓ extends, Ctrl/Cmd+A selects visible,
      Delete opens undoable delete, Esc clears.
- [x] Reducer + transform tests; undo restores order exactly.
- [x] Gates green; e2e: select 3 → move to "Lighting" → tag "client-x" → delete → undo.

### Verification Steps

1. `pnpm test` — selection reducer, bulk transforms, restore order.
2. Headless Chromium: the e2e above, plus drag 2 cards onto a category row; screenshot bulk bar light/dark.

### Anti-Drift Rules

- Undo stays in memory (no trash/recycle-bin storage).
- No bulk edit of prompt _text_ (that is G9/G5 territory).
- Category reordering behavior must not change.

### Estimated Effort

M (one to two sessions)
