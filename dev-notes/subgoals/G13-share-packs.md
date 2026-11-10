## Goal: G13 — `.prompty` share packs

> **Status: done.** Notes from the PR:
>
> - A pack holds the prompts, the categories they use and their Composer blocks. Use counts,
>   last-used dates, favorites and version history are stripped on export and again on import.
> - Import reuses G11 end to end: the "Import from another tool…" button, the report with a pack
>   card, dedupe by text, categories joined by name, and the 10 s undo. Dropping any importable
>   file onto the popup opens the same flow.
> - Export from the bulk bar: **Pack…** opens name/author/description fields and downloads
>   `<name>.prompty`. In a category view, the name defaults to "<Category> kit".
> - Malicious-input coverage: oversize, bad JSON, wrong format or version, wrong types, too many
>   prompts or categories are refused; prototype keys and unknown fields are dropped; HTML in
>   strings stays inert text (rendered with `textContent`).

### Objective

Share a set of prompts, plus their categories and compositions, as one `.prompty` file. A creator
could publish "Neon noir kit" this way. Recipients drag it onto the popup, see a preview, and add
it. The schema is versioned, and the file is validated before anything is shown.

### Deliverables

- [x] Pack schema `{ format: 'prompty-pack', v: 1, name, author?, description?, prompts, categories }`
      (JSON, size cap); export the selection (G4) or a category as a pack.
- [x] Import by file picker or drag-drop, reusing the G11 report (dedupe, category join), with a
      pack preview card.

### Definition of Done

- [x] Lossless export→import test, field by field; malicious packs (oversize, prototype keys,
      script in strings, wrong types) are rejected by table tests; gates green.

### Anti-Drift Rules

- Packs are data only: no code, no remote URLs fetched, no images except optional inline icons
  with a size cap.

### Estimated Effort

M
