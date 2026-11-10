## Goal: S1 — "Save Selection as Prompt" actually saves

> **Status: done.** Also fixed the in-page bugs it uncovered (see PROGRESS.md).

### Objective

Right-clicking selected text → **Prompty: Save Selection as Prompt**, or pressing **Alt+Shift+S**,
saves the selection as a new prompt (title = page title, text = selection) and confirms with a
toast on the page — on any site, including pages where the content script cannot run.

### Context

Today both paths are dead ends:

- `background.js` creates the context menu (`CONTEXT_MENU_ID`) but registers **no
  `contextMenus.onClicked` listener**, so the click does nothing.
- The `save-selection` command (`onCommand`, `case 'save-selection'`) sends `MSG_SAVE_SELECTION`
  to the tab and **discards the response**. The `MSG_SAVE_SELECTION` message handler only appends a
  clipboard snippet; it never creates a prompt.
  SPEC Δ5b defines the contract: title = document title, text = selection, saved as a prompt.

### Deliverables

- [x] `src/lib/capture.js` (pure, tested): `promptFromSelection({ text, pageTitle, url, id, now })`
      → normalized `Prompt` — title = page title (≤ 80 chars) or the selection's first line,
      tag = site hostname, `categoryId: null`; returns `null` for blank selections.
- [x] `background.js`: one `saveSelection(tab, selectionText?)` used by both
      `contextMenus.onClicked` and the `save-selection` command.
  - Text source order: `info.selectionText` (works on PDFs and pages without the content
    script) → content-script `MSG_SAVE_SELECTION` response.
  - Duplicate guard: same text as the most recent saved prompt within 10 s → "Already saved".
  - Writes via `readAll`/`writeAll`; also records the snippet (existing behavior kept).
- [x] Feedback: content toast "Saved “{title}” to Prompty" (✗ variant on failure); if the tab has
      no content script (e.g. `chrome://`, PDF viewer), fall back to `browser.notifications`.
- [x] Popup: the new prompt appears via live sync; mark it with a "New" chip until first open.

### Definition of Done

- [x] Context menu and Alt+Shift+S both create exactly one prompt per action.
- [x] Works on a normal page, an SPA input selection, and a PDF (via `info.selectionText`).
- [x] Unit tests: `promptFromSelection` (blank, long title, no title, multi-line, hostname tag);
      duplicate guard.
- [x] Gates green; Firefox lint 0/0/0.

### Verification Steps

1. `pnpm test` — capture + duplicate-guard tests.
2. Headless Chromium: open a test page, select text, dispatch the context-menu save through the
   background (or the command) → storage has the prompt with the page title; toast text shows.
3. Manual in Firefox: right-click → Save Selection → popup shows it under All prompts.

### Anti-Drift Rules

- No new permissions (`contextMenus`, `notifications`, `activeTab` already exist).
- Saving never opens an editor or the popup — it is a one-gesture capture. Editing stays in the popup.
- Do not change the snippet history cap or schema.

### Estimated Effort

S (half a session; most of it the background wiring + tests)
