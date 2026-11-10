## Goal: G13 — `.prompty` share packs

### Objective

Share a set of prompts, plus their categories and compositions, as one `.prompty` file. A creator
could publish "Neon noir kit" this way. Recipients drag it onto the popup, see a preview, and add
it. The schema is versioned, and the file is validated before anything is shown.

### Deliverables

- [ ] Pack schema `{ format: 'prompty-pack', v: 1, name, author?, description?, prompts, categories }`
      (JSON, size cap); export the selection (G4) or a category as a pack.
- [ ] Import by file picker or drag-drop, reusing the G11 report (dedupe, category join), with a
      pack preview card.

### Definition of Done

- [ ] Lossless export→import test, field by field; malicious packs (oversize, prototype keys,
      script in strings, wrong types) are rejected by table tests; gates green.

### Anti-Drift Rules

- Packs are data only: no code, no remote URLs fetched, no images except optional inline icons
  with a size cap.

### Estimated Effort

M
