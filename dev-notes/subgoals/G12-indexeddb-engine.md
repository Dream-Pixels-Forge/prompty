## Goal: G12 — IndexedDB engine for very large libraries

> **Status: done, re-scoped by measurement.** The goal (5k prompts stay instant) is met **without** an
> IndexedDB engine. Measured with `scripts/bench-library.mjs`, 5,000 prompts (1.71 MB JSON), headless
> Chromium, popup 780×580:
>
> |                                | before         | after                               |
> | ------------------------------ | -------------- | ----------------------------------- |
> | first card visible             | 7,069–7,771 ms | 272–290 ms (cold first open 402 ms) |
> | cards in the DOM               | 5,000          | 60 (+60 per scroll batch)           |
> | search keystroke               | 525–659 ms     | 84–96 ms                            |
> | star toggle (save + re-render) | 3,975–4,268 ms | 161–176 ms                          |
> | raw `storage.local` read       | 74–90 ms       | 69–75 ms                            |
>
> **Why no IndexedDB:**
>
> - Storage was never the bottleneck. The whole library reads in about 80 ms. Filtering and sorting
>   5k prompts take under 6 ms, and normalizing them about 1 ms.
> - The cost was building 5,000 cards on every render. IndexedDB also goes through the browser
>   process, so it would not remove the read cost, and it would add a second storage path under
>   Vault (G10), the content script and the background.
> - **Revisit when** `bench-library.mjs` shows the storage read dominating, or libraries approach
>   the 10 MB `storage.local` quota (around 25–30k prompts at today's average size). The
>   `secure-store` area interface (`get`/`set`/`remove`) is the seam where an IndexedDB adapter
>   would plug in.
>
> **What shipped:**
>
> - **Incremental grid:** the full list is filtered and sorted, and only the first 60 cards are
>   built. More are appended when the end scrolls into view (IntersectionObserver, 400 px ahead),
>   with a "Showing N of M" status. A re-render of the same list (star, edit, sync) keeps the
>   drawn count and the scroll position; a new list (search, view, sort) starts at the top.
>   ArrowDown past the last drawn card draws the next batch. Ctrl+A and bulk actions work on all
>   matching ids, not just the drawn ones.
> - **Popup load:** the library read starts in parallel with the "new since" bookkeeping. Preset
>   seeding checks its version before reading the library, so it is no longer read twice. The
>   storage listener ignores keys that never change the view (`popupSeenAt`, positions, Composer
>   targets and drafts), so opening the popup no longer triggers a second full re-read.
> - The Ctrl+K palette was already capped at 50 results: about 35–70 ms per keystroke at 5k, left
>   as is.

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
