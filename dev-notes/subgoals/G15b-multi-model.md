Read `dev-notes/subgoals/G15-project-documents.md` (must be merged first), `dev-notes/subgoals/G9c-model-dialects.md`, `src/lib/sequence.js`, `src/lib/sites.js` and `src/assets/recipes.json` before writing any code.
Then save the spec below as `dev-notes/subgoals/G15b-multi-model-sheets.md`, add it to `dev-notes/subgoals/README.md` (depends on G15 and G9c), and implement it as ONE PR following the "Rules for every subgoal". Ask me before encoding any model convention you cannot source.

---

## Goal: G15b — One project, every video model (Muse, Seedance, Kling, MiniMax Hailuo, Veo, Runway, Wan, Luma, Higgsfield…)

### Objective

The same shot (`G08 — Love, then greed`) must be insertable into whichever video model the user is
on today: Muse in Meta AI, Seedance in Dreamina, Kling, MiniMax Hailuo, Veo, Runway, Wan, Luma,
Higgsfield. A prompt sheet can hold **one variant per model** for each shot; Prompty knows each
model's **profile** (limits, wrapper, dialect, reference slots); and when the user types `!G08` on
a model's site, the **variant for that site** is inserted, wrapped the way that site needs.

### Context

- G9c already writes sequences in two sourced dialects (Seedance 2.5, Muse) and detects meta.ai and
  Dreamina/Jimeng/BytePlus. Its rule stays: **no guessed dialects**; unsourced models use the
  model-neutral formats.
- Real constraint from production: on meta.ai an assistant rewrites prompts before Muse sees them,
  so Muse prompts need a **pass-through wrapper** (header + `<<<PROMPT … PROMPT>>>`). Kling,
  Hailuo, Dreamina etc. take the prompt directly: no wrapper.
- Models differ in prompt length, negative-prompt field, number of reference images/videos/audio,
  durations and aspect ratios. Those are **generation parameters**, not prompt text: Prompty shows
  them as tips and checks, never writes them into the prompt (same rule as G9c for Seedance).

### Deliverables

- [ ] **Model profiles** (`src/assets/models.json` + `src/lib/models.js`, pure, tests first). One
      entry per model: `id`, `label`, `hosts[]` (origin patterns), `dialect` (`muse` | `seedance`
      | `timecoded` | `script` | `one-take`), `wrapper` (template id or none), `maxPromptChars`,
      `negativePrompt` (bool), `refSlots { images, videos, audio }`, `durations[]`,
      `aspectRatios[]`, `notes`, and **`source`** (URL or "field-tested by owner, <date>") plus
      `verified: boolean`. Ship: `muse`, `seedance-2.5`, `kling`, `minimax-hailuo`, `veo`, `runway`,
      `wan`, `luma`, `higgsfield`. Every number comes from the vendor's own documentation and is
      cited in `source`; anything you cannot source is `null` with `verified: false` — never a guess.
      Users can add or override a profile in Settings (JSON, validated like custom site recipes).
- [ ] **Multi-variant prompt sheets** (extend `src/lib/prompt-sheet.js`): inside a shot section,
      the fenced block's info string names the model:
      ````
      ```muse
      …
      ```
      ```kling
      …
      ```
      ````
      A block with no info string is the **neutral** variant. Each variant becomes its own Prompty
      prompt linked by `{ documentId, shotId, modelId }`, tagged `<shotId>` + `<modelId>`. Unknown
      info strings (e.g. `json`) are not shot variants. Re-save updates variants in place (stable
      ids), as in G15.
- [ ] **Wrappers** (`src/lib/wrappers.js`): named templates with one `{prompt}` slot. Ship
      `meta-ai-pass-through` (the user's header, provided verbatim in the fixture below). Profiles
      point to a wrapper; the user can turn a wrapper off per site.
- [ ] **Site-aware insert**: the `!` palette, the reader's Insert button and `get_shot` choose the
      variant for the active site's profile → else the neutral variant → else ask. The palette shows
      a model badge per result. Add site recipes for each profile host you can verify in a headless
      run; otherwise rely on the generic fallback and say so in the PR.
- [ ] **Convert (structure only)**: "Make a Kling variant from the Muse one" rewrites **only the cut
      syntax** between sourced dialects (`STOP. HARD CUT.` ↔ `At N seconds, hard cut.` ↔ neutral
      timecoded), via the G9c writers. It never changes, adds or removes a word of shot content.
      The result is marked `auto-converted · review` until the user edits or approves it.
- [ ] **Model checks** (extend `lintSequence` / new `lintForModel`): over `maxPromptChars`, more
      shots than the dialect holds (Muse > 3), a negative-prompt section on a model without the
      field, more references in `Refs` than the profile's `refSlots`, duration or aspect ratio
      written inside the prompt where the model takes them as parameters. Warnings only; never block
      insert.
- [ ] **MCP**: `list_models` (profiles, so the agent writes within limits), `get_shot { project,
      shotId, model? }` returns the right variant + wrapper applied + refs + check + model tips;
      `save_document` reports per-model variant counts and lint warnings in its reply.
- [ ] **Packs** carry user profiles and wrappers (optional arrays; older packs unaffected).
- [ ] i18n en + fr, a11y, docs (README, `mcp/README.md`, CHANGELOG, SPEC Δ15b).

### Definition of Done

- [ ] Fixture `tests/fixtures/goldhunter-g08-multimodel.md` with `muse`, `seedance`, `kling` and
      neutral variants for G08 → 4 linked prompts; re-save after an edit → same ids, 1 new version.
- [ ] Headless Chromium with stubbed tab origins: on `meta.ai` `!G08` inserts the Muse variant
      wrapped in the pass-through header; on a Kling host it inserts the Kling variant with no
      wrapper; on an unknown site it inserts the neutral variant.
- [ ] Convert Muse → Seedance changes only cut markers: a word-level diff of shot content is empty
      (test asserts it).
- [ ] Every shipped profile number has a `source`; a test fails if a non-null limit has no source.
- [ ] Gates green: `pnpm type-check && pnpm lint && pnpm test && pnpm package`, `web-ext lint`
      0/0/0, `pnpm validate`, `pnpm check:docs`, axe light + dark.

### Verification Steps

1. Import the fixture through `save_document` (MCP) → Projects → GOLDHUNTER → G08 shows 4 variants
   with model badges and lint warnings.
2. Open a test page per stubbed origin, type `!G08`, check the inserted text byte-for-byte.
3. Settings → add a custom profile for a new model (e.g. "Pika"), point it at the neutral dialect,
   confirm `!G08` uses the neutral variant there.

### Anti-Drift Rules

- **No invented model facts.** Limits, slots, durations, hosts and dialects are sourced or `null`.
  The G9c rule holds: a model gets its own dialect only with a written source.
- **Prompt text is sacred.** Extraction stores fenced content byte-for-byte; Convert touches cut
  markers only; wrappers only surround, never edit.
- Generation parameters stay out of prompt text; they are shown as tips.
- No network, no AI calls: site detection uses the active tab origin only; profiles ship in the
  bundle or come from the user.
- One PR; tests first for every pure function; no unrelated refactors.

### Estimated Effort

L

---

### Fixture: Meta AI pass-through wrapper (verbatim)

```
VIDEO GENERATION — PASS-THROUGH MODE.
The text between <<<PROMPT and PROMPT>>> is the final video prompt. Send it to the video model exactly as written: do not rewrite, summarize, shorten, translate, improve or add anything. Do not add characters, objects, camera moves, effects or events.
Use ONLY the images attached to THIS message as references, in the order they are attached. Never use any image or video generated earlier in this conversation as a reference.
First generate the start frame as a still image and show it to me before animating.
Before generating the video, show me the exact prompt you will send, word for word, and wait for my "GO".

<<<PROMPT
{prompt}
PROMPT>>>
```
