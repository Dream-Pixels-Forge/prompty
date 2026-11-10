## Goal: G11 — Migration Suite: bring your prompts from anywhere

> **Status: done, except the real-sample check.** Notes from the PR:
>
> - A CSV first row is a header only when every non-empty cell is a known column name, so a
>   headerless `title, body` row is not mistaken for one.
> - An export's prompt `id` is never reused (it could collide with a different prompt); counts,
>   dates, aspect/quality, history and compositions are kept.
> - The import is undoable for 10 s from the toast, like delete.
> - **Open:** verification against a real upstream `higgsfield-prompts-*.json`. The fixture follows
>   SPEC §1; drop a real export in `tests/fixtures/migrate/` and add it to the table to close this.

### Objective

One "Import from another tool…" button that accepts any of these:

- a Prompty or upstream **Higgsfield Prompt Saver** export
- a **CSV** (spreadsheet) or **TXT/Markdown** file
- a plain **JSON list** of prompts

It shows a report before anything is written: how many prompts will be added, merged, or skipped,
and why. Duplicates are detected by normalized text, so importing the same file twice adds nothing.
Categories are matched by name, so the upstream seed categories don't appear twice.

### Context

The existing "Import JSON…" is a backup restore: it merges by `id` or replaces everything. That is
right for your own backups and wrong for migration. An upstream export reuses the same seed
category _names_ with different ids, so merging by id duplicates "Characters" and the other
starters. Prompt lists kept in spreadsheets or notes files had no way in at all.

### Deliverables

- [x] Pure `src/lib/migrate.js`:
  - `detectFormat(fileName, text)` → `envelope | json-list | csv | txt | unknown`
  - `parseCsv(text)`:
    - RFC 4180 (quotes, escaped quotes, newlines in fields, BOM, `;` or `,` delimiters)
    - header aliases: `title|name`, `text|prompt|content|body`, `category|folder`, `tags|labels`,
      `favorite|starred`
    - no header: 1 column = text, 2 columns = title, text
  - `parseTxt(text)`: blocks separated by blank lines or `---`. A short first line becomes the
    title, and a Markdown `# heading` names the category for the blocks under it.
  - `parseJsonList(value)`: an array of strings or of objects with `text|prompt|content`.
  - `toCandidates(...)`: one shape `{ title, text, category?, tags[], isFavorite, createdAt? }`.
  - `planMigration(library, candidates, { now, newId })` → `{ prompts, categories, report }`:
    - dedupe by normalized text (trim, collapse whitespace, case-folded), within the file and
      against the library
    - a duplicate merges tags and favorite, and is reported as `merged` only if something changed,
      otherwise `skipped`
    - categories are joined by name (case-insensitive), and new ones are created with a palette
      color
    - every skip has a reason: empty, duplicate, too long (over `MAX_TEXT`)
- [x] Settings → Backup: "Import from another tool…" (`.json .csv .txt .md`), then a report modal
      (counts plus the first few titles per bucket), then Import. Nothing is written before the user
      confirms.
- [x] Fixtures: an upstream-shaped export (SPEC §1 fields and seed categories), CSV with
      quotes/newlines/`;`, TXT with headings, JSON list.

### Definition of Done

- [x] Table-driven tests per format; report counts exact; re-importing the same file → 0 added; an
      upstream export into a seeded library → no duplicate categories.
- [x] Gates green; e2e: import CSV → report → import → prompts visible in the right categories.
- [ ] Verified against a **real** upstream `higgsfield-prompts-*.json`. This needs a sample from the
      project owner; until then, the fixture is built from the SPEC §1 field contract.

### Anti-Drift Rules

- No network; files are read locally with `File.text()`.
- Imported strings pass through `normalizePrompt`/`normalizeCategory` (SECURITY.md); the UI uses
  `textContent` only.
- Backup restore ("Import JSON…", merge by id or replace) keeps its current behavior.

### Estimated Effort

M
