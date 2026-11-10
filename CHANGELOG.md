# Changelog

All notable changes to Prompty. Versions follow [Semantic Versioning](https://semver.org/);
before 1.0, minor versions may change stored data shapes, and every such change migrates silently.

## [Unreleased]

### Added

- **Insights** (G7): a new view with stat tiles, most-used prompts, uses by category, prompts
  added per month, never-used and dormant (90+ days) prompts, and recent fill-ins. **Select these**
  hands a list to the bulk bar. Only data Prompty already stores is used.
- **Share packs** (G13): select prompts and choose **Pack…** to save a `.prompty` file. It holds
  the prompts, their categories and Composer blocks, with a name, author and description; your use
  counts, favorites and history stay with you. Drop a pack (or any importable file) on the popup
  to see a preview card and the import report. Broken, oversized or future-version packs are
  refused with a message.
- **Import from another tool** (G11): Settings → Backup → "Import from another tool…" reads a
  Prompty or Higgsfield Prompt Saver export, a CSV (quotes, `,`/`;`/tab), a text or Markdown file
  (`# headings` become categories, bullets become prompts) or a JSON list.
  - A report lists what will be added, merged (tags and favorite) or skipped, with a reason for each
    skip, before anything is written.
  - Duplicates are found by normalized text, so re-importing a file adds nothing.
  - Categories are matched by name.
  - The import can be undone for 10 s.

## [0.3.0] — 2026-11-10 · "Director's cut"

Prompty grows from a prompt library into a shot-design tool: compose a shot from film-grammar
blocks, chain shots into a scene with cuts and timing, and write it the way the target video model
reads it.

### Added

- **Prompt Composer** (G9, #20): build a shot from blocks in film-grammar order (subject, location,
  camera, lens, composition, lighting, grade, mood, transition), each picked from the library or
  written by hand. Variables shared between blocks are asked once. Includes three starter shot
  templates; a saved shot reopens with 🎛.
- **Shot sequences** (G9b, #22): a strip of shots, each with a duration (1–60 s) and the cut into
  the next (hard, match, smash, whip pan, dissolve, or no cut). A sequence is written as timecoded
  shots, a shot list, or one continuous take. A variable like `{hero}` keeps the same character in
  every shot. Starter sequence: "Three-beat reveal".
- **Model dialects** (G9c, #23):
  - **Seedance 2.5**: `0–4 seconds: …`, then `At 4 seconds, match cut.`, and a consistency line.
  - **Muse Video**: `SHOT 1 (0–4 s): … STOP. HARD CUT.`, plus identity and no-transition lines.
  - The Composer suggests the dialect for the current site (Dreamina, Jimeng and BytePlus →
    Seedance; meta.ai → Muse) and remembers your choice per site.
  - Checks warn when a sequence fights the model (more than 4 cuts or very short shots for Muse).
- **Variables 2.0** (G6, #19):
  - `{lens:24mm|50mm|85mm}` choices
  - `{seed:1-999}` ranges with 🎲
  - `{mood=calm}` defaults
  - a fill-in form with live preview that remembers your last values, in the popup and the in-page
    `!` palette
- **Version history** (G5, #18): editing a prompt's title or text keeps the previous version (up to
  20). Compare any version word by word and restore it; restoring is itself undoable.
- **Bulk operations** (G4, #21):
  - Select many prompts (checkbox, Shift-click, Ctrl/Cmd+A, Space and Shift+arrows), then move,
    tag, star, copy, export or delete them.
  - Drag a selection onto a category to move it.
  - Bulk delete has a 10-second undo that restores the exact order.
- **Command palette** (G2, #15): `Ctrl/Cmd+K` gives one keyboard-only list of prompts, snippets and
  commands.
- **Full popup** (#15): library grid, prompt editor, categories (drag to reorder), snippets,
  settings (default view, compact cards, widget, quick-insert trigger, sites to skip, custom
  recipes, JSON import/export), and live sync across windows.
- **Cinematic starter library** (#15): 52 prompts in 16 categories, adding Camera Movement,
  Lighting, Lens & Optics, Locations, Color Grading, Composition, Mood & Atmosphere, VFX &
  Transitions, Posters and Logos. Upgrades add only new starters; starters you deleted stay
  deleted.
- **Save Selection** (S1, #16): the context menu and `Alt+Shift+S` save selected text as a prompt.
- **Brand** (#15, #16, #17): Dream Pixels Forge palette (black, white and orange `#FF6A00`),
  applied to the popup and the in-page UI. Mascot icon, plus a pixel-aligned 16/32 px toolbar
  glyph.

### Fixed

- Prompty's invisible in-page layer swallowed every click on every page (#16).
- In-page toasts never appeared, and the `!` palette rendered off-screen and moved two rows per
  arrow key (#16).
- The floating widget ran away from the cursor and its panel covered its own bubble (#16).
- Background messages, commands and preset seeding threw on start (#15).
- `quickTrigger` settings were reset on every save, and custom recipes never reached pages (#15).
- Importing a file without a `settings` section reset your settings to defaults (#21).
- After clicking a card's checkbox, Esc, Delete and Ctrl/Cmd+A did nothing (release pass).
- The "Three-beat reveal" starter sequence asked for both `{hero}` and `{subject}` for the same
  person; it now asks once (release pass).

## [0.2.0] — "Reflex"

### Added

- **Site recipes** (G3, #13): data-driven insert/save anchors for Higgsfield, ChatGPT, Claude,
  Gemini, Perplexity and a generic fallback, plus a custom recipe editor.
- **Quick insert** (G1, #14): type `!` in any input for a fuzzy prompt palette at the caret, with a
  variable fill-in form.

## [0.1.0]

### Added

- Project skeleton: dual Chromium/Firefox MV3 build, shared library, CI (#5).
- Popup logic and message contract (#8).
- Content script with smart assist pill, floating widget and insert handlers (#9).
- Background worker with context menu and keyboard shortcuts (#10).

[0.3.0]: https://github.com/Dream-Pixels-Forge/prompty/compare/1c5b492...89544db
