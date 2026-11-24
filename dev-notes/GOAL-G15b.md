## Goal: G15b — One Project, Every Video Model (Multi-Model Prompt Sheets)

### Objective
Enable a single shot (`G08 — Love, then greed`) to be insertable into any video model (Muse, Seedance, Kling, MiniMax Hailuo, Veo, Runway, Wan, Luma, Higgsfield) by holding one variant per model in a prompt sheet, with model profiles defining limits/wrappers/dialects, and site-aware insert choosing the correct variant for the active site.

### Context
G9c writes sequences in two sourced dialects (Seedance 2.5, Muse) and detects meta.ai and Dreamina/Jimeng/BytePlus. Real constraint: on meta.ai an assistant rewrites prompts before Muse sees them, so Muse prompts need a pass-through wrapper (header + `<<<PROMPT … PROMPT>>>`). Kling, Hailuo, Dreamina take prompt directly. Models differ in prompt length, negative-prompt field, reference slots, durations, aspect ratios — these are generation parameters, not prompt text. G15b extends G15's prompt-sheet extraction to support multi-variant fenced blocks and adds model profiles, wrappers, site-aware insert, and structure-only conversion.

### Deliverables
- [ ] **Model profiles** (`src/assets/models.json` + `src/lib/models.js`, pure, tests first): One entry per model: `id`, `label`, `hosts[]` (origin patterns), `dialect` (`muse` | `seedance` | `timecoded` | `script` | `one-take`), `wrapper` (template id or none), `maxPromptChars`, `negativePrompt` (bool), `refSlots { images, videos, audio }`, `durations[]`, `aspectRatios[]`, `notes`, `source` (URL or "field-tested by owner, <date>"), `verified: boolean`. Ship: `muse`, `seedance-2.5`, `kling`, `minimax-hailuo`, `veo`, `runway`, `wan`, `luma`, `higgsfield`. Every number from vendor docs, cited in `source`; unsourced = `null` with `verified: false` — never guessed. Users can add/override profiles in Settings (JSON, validated like custom site recipes).
- [ ] **Multi-variant prompt sheets** (extend `src/lib/prompt-sheet.js`): Inside shot section, fenced block info string names model:
    ````
    ```muse
    …
    ```
    ```kling
    …
    ```
    ````
    No info string = **neutral** variant. Each variant becomes own Prompty prompt linked by `{ documentId, shotId, modelId }`, tagged `<shotId>` + `<modelId>`. Unknown info strings (e.g. `json`) not shot variants. Re-save updates in place (stable ids), as in G15.
- [ ] **Wrappers** (`src/lib/wrappers.js`): Named templates with one `{prompt}` slot. Ship `meta-ai-pass-through` (user's header verbatim). Profiles point to wrapper; user can turn off per site.
- [ ] **Site-aware insert**: `!` palette, reader's Insert button, `get_shot` choose variant for active site's profile → else neutral → else ask. Palette shows model badge per result. Add site recipes for verified profiles; otherwise generic fallback.
- [ ] **Convert (structure only)**: "Make Kling variant from Muse" rewrites **only cut syntax** between sourced dialects (`STOP. HARD CUT.` ↔ `At N seconds, hard cut.` ↔ neutral timecoded), via G9c writers. Never changes/removes shot content words. Result marked `auto-converted · review` until user edits/approves.
- [ ] **Model checks** (extend `lintSequence` / new `lintForModel`): Over `maxPromptChars`, more shots than dialect holds (Muse > 3), negative-prompt section on model without field, more refs than `refSlots`, duration/aspect in prompt where model takes as params. Warnings only; never block insert.
- [ ] **MCP**: `list_models` (profiles so agent writes within limits), `get_shot { project, shotId, model? }` returns right variant + wrapper applied + refs + check + model tips; `save_document` reports per-model variant counts and lint warnings.
- [ ] **Packs** carry user profiles and wrappers (optional arrays; older packs unaffected).
- [ ] i18n en + fr, a11y, docs (README, `mcp/README.md`, CHANGELOG, SPEC Δ15b).

### Definition of Done
- [ ] Fixture `tests/fixtures/goldhunter-g08-multimodel.md` with `muse`, `seedance`, `kling` and neutral variants for G08 → 4 linked prompts; re-save after edit → same ids, 1 new version.
- [ ] Headless Chromium with stubbed tab origins: on `meta.ai` `!G08` inserts Muse variant wrapped in pass-through header; on Kling host inserts Kling variant no wrapper; on unknown site inserts neutral variant.
- [ ] Convert Muse → Seedance changes only cut markers: word-level diff of shot content is empty (test asserts it).
- [ ] Every shipped profile number has a `source`; test fails if non-null limit has no source.
- [ ] Gates green: `pnpm type-check && pnpm lint && pnpm test && pnpm package`, `web-ext lint` 0/0/0, `pnpm validate`, `pnpm check:docs`, axe light + dark.

### Verification Steps
1. Import fixture through `save_document` (MCP) → Projects → GOLDHUNTER → G08 shows 4 variants with model badges and lint warnings.
2. Open test page per stubbed origin, type `!G08`, check inserted text byte-for-byte.
3. Settings → add custom profile for new model (e.g. "Pika"), point at neutral dialect, confirm `!G08` uses neutral variant there.

### Anti-Drift Rules
- **No invented model facts.** Limits, slots, durations, hosts, dialects are sourced or `null`. G9c rule: model gets own dialect only with written source.
- **Prompt text is sacred.** Extraction stores fenced content byte-for-byte; Convert touches cut markers only; wrappers only surround, never edit.
- Generation parameters stay out of prompt text; shown as tips.
- No network, no AI calls: site detection uses active tab origin only; profiles ship in bundle or from user.
- One PR; tests first for every pure function; no unrelated refactors.

### Estimated Effort
L (Large)

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