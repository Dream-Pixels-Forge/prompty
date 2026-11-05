# GOAL.md — Prompty

## Goal

Build a **cross-browser (Chromium MV3 + Firefox MV3) prompt-library extension** called **Prompty**,
functionally inspired by the MIT-licensed `higgsfield_prompts@higgsfield.ai` (Higgsfield Prompt
Saver v1.0.0) — but **global**: it works on **any site**, not only higgsfield.ai.

## Source analysis basis

- REA evidence: `ev_84b4661a8f426bcfb65ead7278a782d76e2a5c4d9d45d1fcc24bf6e9d2573fe5`
  (analyze_javascript_application, authority = shipped-artifact).
- Complete behavior spec distilled in `dev-notes/SPEC.md`. Original code is MIT → lawful to
  port/extend with attribution (see LICENSE notes in README).

## Success criteria (objective & verifiable)

1. `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm build` all exit **0** (CI gate, every PR).
2. `web-ext lint` passes for both dist bundles (zero errors / approved warnings only).
3. Load in Chromium: popup lists 8 seed prompts, insert targets the focused input on a
   non-higgsfield site (e.g. a plain `<textarea>` on any test page), insert works — smoke test.
4. Load in Firefox (web-ext run): same smoke test.
5. No network requests anywhere; storage via `browser.storage.local` only.
6. All new features verified on both browsers: copy, save-selection, paste-from-library,
   clipboard snippets history.

## Deliverables

- `dist/prompty-cr.xpi`/`.zip` (Chromium build) & `dist/prompty-fx.xpi` (Firefox build)
- Installable unpacked for dev (`scripts/load-dev` instructions in README)
- GitHub CI enforcing gates on every PR

## Out of scope

- Sync/account features, external servers, analytics — the extension stays 100% local.
- Store publishing (listing assets) — separate release phase (versioning-releases skill).
