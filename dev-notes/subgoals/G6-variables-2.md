## Goal: G6 — Variables 2.0: choices, ranges, defaults, memory

### Objective

Prompt variables gain a richer grammar while staying backward compatible:

| Syntax                          | Fill-in control                     |
| ------------------------------- | ----------------------------------- |
| `{subject}`                     | text input (unchanged)              |
| `{lens:24mm\|35mm\|50mm\|85mm}` | choice (select / segmented)         |
| `{seed:1-999}`                  | number input with 🎲 random         |
| `{mood=melancholic}`            | text input prefilled with a default |

The last value used for each variable name is remembered and prefilled next time.

### Context

Variables are free text only (`VARIABLE_PATTERN` in `src/lib/variables.js` **and** a duplicate at
`src/content/assist.js` ≈ line 1988 for the `!` palette mini-form). The v3 cinematic seed prompts are
full of natural choice sets (focal lengths, times of day, grades) that users retype every time.
Detailed in ROADMAP G6.

### Deliverables

- [ ] `src/lib/variables.js`: `parseVariables(text)` → `[{ name, kind: 'text'|'choice'|'range', options?, min?, max?, default? }]`,
      first occurrence defines the spec; `extractVariables` keeps returning names (no caller breaks);
      `resolveVariables` replaces every token form of a name.
- [ ] Content script: same grammar in its standalone copy + a parity test that runs both parsers on
      a shared fixture list and asserts identical output.
- [ ] Popup fill-in modal (`fillVariables` in `modals.js`) and the `!` mini-form render the right control;
      range validates bounds; 🎲 picks uniformly.
- [ ] `variableMemory` storage key (`{ [name]: { value, usedAt } }`, cap 100 LRU), whitelisted;
      prefill order: memory → default → empty. "Clear remembered values" in Settings.
- [ ] Editor hint shows the parsed kinds ("⚡ lens · 4 choices").
- [ ] Optional seed v4: upgrade a few v3 prompts to choice syntax (e.g. focal length, time of day) using
      the existing version-aware seeding — **only for users who have not edited those prompts**.

### Definition of Done

- [ ] Regression: every existing seed prompt parses to the same names as before.
- [ ] Malformed tokens (`{a:}`, `{a:5-1}`, `{a|b}`) stay literal text and never throw.
- [ ] Choice restricts values; range rejects out-of-range; memory prefills across popup reopen.
- [ ] Gates green; parity test green.

### Verification Steps

1. `pnpm test` — grammar fixtures, backward compat, parity, memory LRU.
2. Headless Chromium: create `A {shot:wide|medium|close} of {subject} seed {seed:1-999}` → Copy →
   modal shows select + text + number; second run prefilled.
3. Manual: `!` palette on a textarea uses the same controls.

### Anti-Drift Rules

- "Burst" generation (render N combinations) is a separate goal (G6b) — not here.
- No nested tokens, no expressions, no conditionals.
- Memory is local and per-browser only.

### Estimated Effort

M (one to two sessions; the content-script copy is the risky part)
