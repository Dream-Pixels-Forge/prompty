## Goal: G9 — Prompt Composer: build a shot from blocks

> **Status: done.** Notes from the PR:
>
> - Pure core lives in `src/lib/composition.js` (not `src/popup/`) so `lib/storage.js` can whitelist
>   `Prompt.composition` without importing popup code.
> - Slots: Subject & Action · Location · Camera · Lens · Composition · Lighting · Color Grade · Mood ·
>   Transition · Extra (any prompt). Each draws from library categories by name.
> - Picker is a native `<select>` (type-ahead) rather than a fuzzy search box: the per-slot lists are
>   short (≤ 8 starters); revisit if user libraries grow large.
> - The composition is held in memory while the popup is open (source of truth) and saved to
>   `composerDraft`, so storage live-sync never reverts typing and closing the popup keeps the draft.

### Objective

A **Compose** view where a shot is assembled the way a director briefs a crew: a vertical stack of
blocks in film-grammar order —

**Subject & Action → Location → Camera Movement → Lens → Composition → Lighting → Color Grade → Mood → Transition**

— each block filled from the library (that category's prompts) or free text. Blocks can be reordered,
muted or removed; a live preview shows the assembled prompt with every variable resolved once across
all blocks. The result can be inserted, copied, or saved as a new prompt that can be reopened in the
Composer later.

### Context

The v3 seed turned the library into film-craft ingredients (Camera Movement, Lighting, Lens & Optics,
Locations, Color Grading, Composition, Mood & Atmosphere, VFX & Transitions). Today users can only use
one prompt at a time, or append by hand. Composing is the step that turns a prompt list into a
shot-design tool — no other prompt manager does this, and it fits video models (Seedance, Veo, Kling…)
that reward structured, ordered shot descriptions.

### Deliverables

- [x] Pure core `src/popup/composer.js`:
  - `SLOTS` — ordered slot ids with labels and the category name each draws from (matched by name,
    case-insensitive; missing category → free-text only).
  - `compose(blocks, { joiner })` → `{ text, variables }`: skips muted/empty blocks, joins with
    `", "` (or `". "` per setting), merges variables so `{subject}` used in three blocks is asked once.
  - `serialize/deserialize` a composition: `{ blocks: [{ slot, promptId?, text?, muted }] }`.
- [x] Compose view (sidebar nav item "✦ Compose", palette command "Compose shot"):
  - each block: slot label, picker (search within its category via `lib/search.js`), inline text edit,
    mute, remove, drag handle; "+ Add block" for extra slots (e.g. a second subject, VFX);
  - live preview with variables highlighted; fill-in uses the shared variable modal (G6 controls when present);
  - actions: Insert · Append · Copy · **Save as prompt** (title prompt, category picker, stores
    `composition` on the prompt so "Open in Composer" rebuilds it).
- [x] Starter presets: 3 one-click shot templates built only from seed prompts
      (e.g. "Neon noir push-in", "Golden-hour crane reveal", "Impossible macro-to-wide").
- [x] `Prompt.composition?` whitelisted in `normalizePrompt`; export/import carry it.

### Definition of Done

- [x] Tests: slot ordering, muted/empty skipping, joiner, variable merge (shared and distinct names),
      deleted-source fallback (a block whose prompt was deleted keeps its last text), serialize round-trip.
- [x] Keyboard-only path: open Compose, add/choose blocks, reorder (Alt+↑/↓), Ctrl+Enter copy.
- [x] Gates green; e2e: compose a 5-block shot → preview matches expected string → save →
      reopen in Composer → identical blocks.

### Verification Steps

1. `pnpm test` — `composer.test.mjs`.
2. Headless Chromium: build "Neon noir push-in", fill `{subject}` once, copy; screenshot Compose view
   light/dark at 780×580.
3. Manual: insert the composed shot into a video-model prompt box via the real toolbar popup.

### Anti-Drift Rules

- No AI/LLM calls and no network: composition is deterministic string assembly.
- Reuse the existing insert/copy pipeline (`actions.js`) and variable modal — no parallel code paths.
- Multi-shot sequences (shot lists with hard cuts, timing per shot) are a separate goal (G9b).

### Estimated Effort

L (two to three sessions: core + tests, view, templates + polish)
