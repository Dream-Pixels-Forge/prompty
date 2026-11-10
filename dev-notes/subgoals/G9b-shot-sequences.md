## Goal: G9b — Shot sequences: from one shot to a scene

> **Status: done.** Notes from the PR:
>
> - A shot's `cut` is the transition _out of_ it; the last shot's cut is unused, and in the UI its
>   control only appears when a next shot exists ("Into shot N").
> - Empty shots stay in the strip (dashed tab) but are left out of the text and the timecodes.
> - The starter sequence "Three-beat reveal" chains the three G9 templates and adds a `{hero}`
>   subject block per shot: a raindrop on an eyelash, match-cut on the round shape to a neon sign,
>   then a smash cut to silence, a tiny figure on a golden salt flat.

### Objective

Grow the Composer from one shot into a **sequence**: a strip of shots, each composed from blocks as
in G9, with its own **duration** and the **cut** that leads into the next shot (hard cut, match cut,
smash cut, whip pan, dissolve, or no cut at all: the camera keeps going). The sequence assembles
into one prompt in the shape multi-shot video models read best, with every `{variable}` asked once
across all shots. A variable shared between shots (say `{hero}`) works as a **continuity variable**:
the same person or prop in every shot.

### Context

G9 turned the library into a shot-design kit, but video models such as Seedance, Kling and Veo now
take whole multi-shot prompts with timecodes and named transitions. A director thinks in cuts: what
happens _between_ shots (a match cut on a shape, a smash cut to silence, a one-take that flies
through a keyhole) is half the film language. Today that has to be typed by hand.

### Deliverables

- [x] Pure core `src/lib/sequence.js`:
  - `CUTS` (id, label, phrase): `cut`, `match`, `smash`, `whip`, `dissolve`, `continuous`.
  - `FORMATS`:
    - `timecoded`: `Shot 1 (0–4s): …` lines, each later shot opened by its cut phrase
    - `script`: `SHOT 1 — 4s` blocks with `CUT TO:`-style transitions
    - `one-take`: a single continuous take; the cuts are ignored
  - `emptySequence`, `sequenceFrom(Composition|Sequence)`, `addShot`, `duplicateShot`,
    `removeShot` (never below one), `moveShot`, `updateShot` (duration clamped 1–60 s),
    `setShotComposition`.
  - `composeSequence(seq)` → `{ text, used, duration, variables }`. Empty shots are skipped, and
    timecodes run over the shots actually used. A single-shot sequence composes exactly like G9.
  - `normalizeSequence` and `normalizeStoredComposition`, which accepts a G9 composition or a
    sequence. `storedComposition(seq)` stores a single shot as a plain G9 composition, for backward
    compatibility.
- [x] Storage: `Prompt.composition` accepts either shape; `composerDraft` stores a sequence. Old
      drafts and saved prompts open as one shot.
- [x] Compose view:
  - a shot strip above the blocks (`1 · 4s`, `2 · 3s`, … `+ Shot`)
  - per-shot duration and cut-out controls, Duplicate (coverage of the same setup) and Remove
  - a format switch, and a total running time in the output bar
  - Insert, Copy and Save as prompt deliver the whole sequence
- [x] One starter sequence template built from seed prompts.

### Definition of Done

- [x] Tests:
  - timecodes accumulate over used shots only
  - every cut phrase and every format
  - one-take ignores cuts
  - single-shot parity with G9 `compose`
  - variables merged across shots
  - normalize accepts G9 compositions and rejects junk
  - shot ops (never zero shots, clamps, MAX_SHOTS)
- [x] Keyboard: ←/→ move between shot tabs; Alt+←/→ reorders the active shot; Ctrl+Enter copies the
      sequence.
- [x] Gates green; e2e test: build 3 shots → set cuts and durations → preview matches the expected
      string → save → reopen with 🎛 → same shots.

### Verification Steps

1. `pnpm test` — `sequence.test.mjs`.
2. Headless Chromium e2e test above; screenshot Compose with 3 shots, light and dark, at 780×580.

### Anti-Drift Rules

- Deterministic string assembly only: no AI calls and no network.
- No timeline scrubbing or video preview; durations are numbers in the prompt, not playback.
- Reuse the G9 block editor and the shared fill-in, insert and copy pipeline; no second editor.

### Estimated Effort

M–L (core and tests; strip and controls; template and polish)
