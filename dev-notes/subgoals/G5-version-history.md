## Goal: G5 — Prompt version history, compare, restore

> **Status: done.** Notes from the PR:
>
> - `normalizePrompt` whitelists `versions` (omitted when empty) — without it, every background
>   `readAll → writeAll` (Save Selection, seeding) would have silently wiped history.
> - Diff readability pass: whitespace between changes is folded into the change and runs are grouped
>   (all deleted, then all added), so edits read as phrases; both sides still re-join exactly.
> - Open history from the card's 🕘 button, the editor's **History (N)** button, or the palette.

### Objective

Every change to a prompt's text keeps the previous text as a version (cap 20, newest first).
A History view on each prompt lists versions, shows any two side by side with word-level
highlights, and restores one in a click — restoring is itself a new version, so nothing is ever lost.

### Context

Prompt work is iterative: you tweak a lens, a light, a verb, and the take that worked is gone.
The editor (`promptEditor` in `src/popup/modals.js`) and `upsertPrompt` in `src/popup/library.js`
overwrite text in place today. Detailed in ROADMAP G5; this subgoal pins it to the current code.

### Deliverables

- [x] Schema: `Prompt.versions?: { text: string, title: string, editedAt: number }[]`.
      `normalizePrompt` (lib/storage.js) whitelists it: array of valid entries, max 20, strings only.
- [x] `upsertPrompt`: when `text` or `title` changes, prepend the _previous_ `{ text, title, editedAt }`
      (cap 20, FIFO). No version for a no-op save or favorite/category-only changes.
- [x] `src/lib/diff.js` (pure): word-level LCS diff → `[{ op: 'same'|'add'|'del', text }]`;
      whitespace-preserving so the result re-joins exactly.
- [x] History modal (from the card's ⋯/🕘 button and the editor header): version list
      (relative time, first words), two-column compare with `<ins>`/`<del>` styling built with
      `textContent` spans, **Restore** (writes current text as a version first, then applies).
- [x] Palette command "Show history: {title}" for the selected prompt.
- [x] Export includes `versions`; import normalizes and caps them; Replace/Merge semantics unchanged.

### Definition of Done

- [x] Tests: diff (identical, insertion, deletion, reorder, punctuation/whitespace round-trip);
      version capture rules; cap at 20; restore round-trip leaves N+1 versions and exact text.
- [x] A 20-version prompt with 2 KB text stays well under `storage.local` limits (assert size budget).
- [x] Gates green; e2e: edit twice → history shows 2 → compare highlights the change → restore.

### Verification Steps

1. `pnpm test` — `diff.test.mjs`, versioning tests in `library.test.mjs`, storage normalization.
2. Headless Chromium: edit "Dolly Zoom" twice, open History, screenshot compare, restore, verify text.
3. Export → re-import (merge) keeps versions.

### Anti-Drift Rules

- Versions only record title/text — not tags, category or favorite.
- No sync, no cross-device history, no unlimited storage permission.
- The content script's assist-save path may create versions later; out of scope here.

### Estimated Effort

M (one to two sessions; diff + modal are most of it)
