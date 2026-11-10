## Goal: G9c — Write the sequence for the model you're sending it to

> **Status: done.** Notes from the PR:
>
> - Dialects are extra `FORMATS` (group `model`), so storage, drafts and saved prompts needed no
>   new shape. A one-shot sequence still writes plain G9 text in every format.
> - Built-in detection covers only Seedance hosts. Muse has no host that is confirmed for it, so
>   Muse gets no built-in detection: pick it once on a site and the site remembers it.
> - The shared-variable line reuses the first full token (`{lens:35mm|85mm}`), so a bare `{lens}`
>   never turns a choice variable back into free text.
> - In e2e the popup runs as a tab, so `tabs.query` is stubbed to report a Dreamina URL; insert
>   itself is the unchanged G9 pipeline.

### Objective

The same three-shot scene has to be written differently for different video models. Seedance reads
consecutive time ranges with cuts stated as events at a time point. Muse holds hard cuts only when
every shot ends in `STOP.` G9c adds **model dialects** to the sequence formats. It also adds
**per-site detection**: the Composer sees which site the active tab is on, suggests that site's
dialect, and remembers your choice per site. **Dialect checks** warn when a sequence will fight the
model (too many cuts for Muse, transitions it can't do, shots too short).

### Context

G9b writes sequences in three model-neutral formats. Video models differ in what they reliably
follow. The conventions below come from the Seedance 2.5 prompt guide (BytePlus ModelArk) and from
field notes on Muse Video, both kept in the author's prompt skills. Insert already reaches the
focused prompt box on any site (recipes and the generic fallback), so the missing piece is the
_wording_, not the delivery.

### Deliverables

- [x] `src/lib/sequence.js`:
  - `FORMATS` gains a group and two dialects:
    - `seedance` (Seedance 2.5): `0–4 seconds: …`, then `At 4 seconds, match cut. 4–7 seconds: …`;
      a whip pan is written as "the camera whip-pans and completes the transition"; a closing
      consistency line names the variables shared between shots.
    - `muse` (Muse Video): `SHOT 1 (0–4 s): …. STOP. HARD CUT.`; the last shot ends with `STOP.`
      only. A match cut is written `HARD CUT on a matching shape`; other transitions become hard
      cuts. An opening continuity line names the shared variables, and a closing line bans other
      transitions.
  - `sharedVariables(seq)`: variable names used in two or more shots.
  - `lintSequence(seq)` → `{ level: 'warn'|'info', text }[]`:
    - Muse: more than 4 shots; a shot under 2 s; a transition that becomes a hard cut; over ~260
      words.
    - Seedance: set the duration on the generation page, not in the prompt.
    - One take: the cuts are ignored.
  - `suggestFormat(origin, remembered)` and `rememberFormat(map, origin, format)` (at most 50
    sites). Built-in hosts: only ones confirmed for a dialect (Dreamina, Jimeng and BytePlus
    console → Seedance).
- [x] Compose view:
  - a "Write for" select with two groups, "Any model" and "Model dialect"
  - a suggestion chip ("On dreamina.capcut.com: write for Seedance 2.5")
  - the active tab's host shown next to Insert
  - checks listed under the preview
- [x] Storage: `composerTargets` (origin → format) is read and written only by the Compose view and
      normalized on read.

### Definition of Done

- [x] Tests:
  - exact Seedance and Muse strings, every cut in each dialect
  - shared-variable lines, present only when variables are shared
  - each check rule
  - suggestion priority (remembered beats built-in), the memory cap, junk origins ignored
  - single-shot parity with G9 in every dialect
- [x] Gates green; e2e test: the three-shot sequence written as Seedance and as Muse matches the
      expected strings; the checks appear; a remembered target is suggested again.

### Anti-Drift Rules

- Encode only conventions with a written source. No guessed dialects for other models: Kling, Veo,
  Runway and the like use the model-neutral formats until there is a source.
- Generation parameters (duration, aspect ratio) are never written into the prompt for Seedance;
  they appear as a tip.
- No network, no AI calls; detection uses only the active tab's origin.

### Estimated Effort

M
