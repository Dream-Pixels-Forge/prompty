## Goal: G12 — IndexedDB engine for very large libraries

### Objective

Libraries of 5,000+ prompts stay instant. Prompts move into IndexedDB behind a storage adapter, the
grid is virtualized, and category counts are maintained incrementally. Small libraries keep the
`storage.local` fast path.

### Deliverables

- [ ] A `StorageAdapter` seam (`readAll`, `writeAll`, `watch`) with `local` and `idb`
      implementations. Migration from `local` to `idb` is automatic above 1,000 prompts and
      reversible.
- [ ] A virtualized grid (window of rows, kept scroll position), search over an in-memory index.
- [ ] The content script reads through the background worker when the adapter is `idb`.

### Definition of Done

- [ ] With a 5k-prompt fixture, first render is under 400 ms in headless Chromium. The whole test
      suite runs against both adapters, and gates are green.

### Anti-Drift Rules

- One source of truth at a time. No dual writes except during migration, which is atomic and
  resumable.

### Estimated Effort

L
