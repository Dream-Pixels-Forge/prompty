# Prompty — Global Prompt Library

Save, organize, and paste prompts on **any** site. Prompty is a cross-browser
(Chromium MV3 + Firefox MV3) extension that keeps your prompt library one
keystroke away — in ChatGPT, Claude, Gemini, Perplexity, Higgsfield, or any
plain `<textarea>` on the web.

**100% local.** No servers, no accounts, no telemetry, zero network requests.
Everything lives in `browser.storage.local`.

## Features (v0.3)

What's new in each version: [`CHANGELOG.md`](CHANGELOG.md).

- **Prompt library popup** — browse by view or category, search (`/`), sort, star, and insert, append, copy, edit or delete (with undo) prompts; manage categories (drag to reorder).
- **Cinematic starter library** — 52 prompts in 16 categories: Characters, Landscapes, Objects, Styles, Abstract, Camera Angles, Camera Movement, Lighting, Lens & Optics, Locations, Color Grading, Composition, Mood & Atmosphere, VFX & Transitions, Posters and Logos. Every prompt has `{variables}` to fill in.
- **Bulk operations** — select many prompts (checkbox, Shift-click, Ctrl/Cmd+A, Space and Shift+arrows) and move, tag, star, copy, export or delete them at once; drag a selection onto a sidebar category to move it. Bulk delete has a 10-second undo.
- **Prompt Composer** — build a shot from film-grammar blocks (subject, location, camera, lens, composition, lighting, grade, mood, transition), each picked from your library or written by hand; variables shared across blocks are asked once. Three starter shot templates; save the result and reopen it with 🎛.
- **Shot sequences** — chain shots into a scene: each shot has a duration and the cut into the next (hard, match, smash, whip pan, dissolve, or no cut). The sequence is written as timecoded shots, a shot list, or one continuous take, and variables shared between shots (`{hero}`) are asked once.
- **Model dialects** — write the sequence the way the target model reads it: **Seedance 2.5** (`0–4 seconds: …`, then `At 4 seconds, match cut.`) or **Muse Video** (`SHOT 1 (0–4 s): … STOP. HARD CUT.`). The Composer suggests the dialect for the site you're on (Dreamina → Seedance, meta.ai → Muse), remembers your choice per site, and warns when a sequence fights the model (for example, more than 4 cuts for Muse).
- **Command palette (`Ctrl/Cmd+K`)** — one keyboard-only list of prompts, snippets and commands.
- **Settings** — default view, compact cards, floating widget, quick-insert trigger, sites to skip, custom site recipes, JSON import/export.
- **Template variables** — `{subject}` text, `{lens:24mm|50mm|85mm}` choices, `{seed:1-999}` ranges (with 🎲), `{mood=calm}` defaults. A fill-in form with live preview remembers what you used last, in the popup and the in-page `!` palette.
- **Smart assist pill + floating widget** — save the current input or insert a prompt on any page.
- **Clipboard snippets** — capped history of copied text you can promote to prompts.
- **Quick insert (`!` palette)** — type `!` in any input to open a fuzzy prompt palette at the caret.
- **Site recipes** — data-driven insert/save anchors for popular AI sites, plus your own custom recipes (paste JSON in settings).
- **Context menu + shortcuts** — `Alt+P` open library · `Alt+Shift+S` save selection · `Alt+Shift+W` toggle widget.

## Install (development)

Requirements: Node 22+, pnpm.

```bash
pnpm install
```

```bash
pnpm build
```

- **Chrome / Edge / Brave:** open `chrome://extensions`, enable _Developer mode_,
  click **Load unpacked**, choose `dist/chrome/`.
- **Firefox (142+):** open `about:debugging#/runtime/this-firefox`, click
  **Load Temporary Add-on…**, choose `dist/firefox/manifest.json`
  (or run `pnpm dlx web-ext@8 run --source-dir dist/firefox`).

## Packaging

```bash
pnpm package
```

Produces installable archives in `dist/`:

| File                            | Use                                    |
| ------------------------------- | -------------------------------------- |
| `prompty-<version>-chrome.zip`  | Chrome Web Store upload                |
| `prompty-<version>-firefox.xpi` | Firefox AMO upload / temporary install |

CI also attaches both archives to every run as the `prompty-packages` artifact.

## Scripts

| Command                              | What it does                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pnpm type-check`                    | `tsc --noEmit` over JS with JSDoc types                                                            |
| `pnpm lint`                          | ESLint, zero warnings allowed                                                                      |
| `pnpm test`                          | Vitest unit tests                                                                                  |
| `pnpm build`                         | Emit `dist/chrome` + `dist/firefox` from `src/manifest.base.json`                                  |
| `pnpm package`                       | Build, then zip both targets                                                                       |
| `node scripts/icons.mjs`             | Re-render the 16/32 px toolbar glyph from `src/icons/glyph.svg` (needs Playwright)                 |
| `node scripts/store-screenshots.mjs` | After `pnpm build`: regenerate the store screenshots and promo tile in `store/` (needs Playwright) |

CI (`.github/workflows/pr-validation.yml`) runs all gates plus `web-ext lint`
(Firefox) and `addons-linter` (Chrome) on every PR and every push to `main`.

## Project layout

```
src/
  background.js        service worker (Chrome) / event page (Firefox)
  content/assist.js    pill, floating widget, ! palette, insert handlers
  popup/               library UI
  lib/                 pure ES modules: storage, variables, composition, sequence, diff,
                       capture, presets, search, recipes, sites, text, message
  assets/recipes.json  seeded site recipes
scripts/               build + package
tests/                 vitest suites
dev-notes/             GOAL, SPEC, SECURITY, ROADMAP, PROGRESS, subgoals/
store/                 store screenshots, promo tile, listing copy
```

## Roadmap

v0.3 shipped the Ctrl+K palette, version history, bulk operations, Variables 2.0
and the Composer (shots, sequences, model dialects). Still open on the roadmap:
usage insights (G7), theming/a11y/i18n (G8), Vault Mode (G10), the Migration Suite
(G11), an IndexedDB engine for very large libraries (G12) and `.prompty` share packs
(G13). See [`dev-notes/ROADMAP.md`](dev-notes/ROADMAP.md) and the shipped subgoal specs
in [`dev-notes/subgoals/`](dev-notes/subgoals/README.md).

## License & attribution

MIT — see [`LICENSE`](LICENSE).

Prompty is ported from and inspired by **Higgsfield Prompt Saver v1.0.0**
(© JohnLaibach, MIT). The original's behavior was generalized from a single
site to the whole web; its notice is reproduced in `LICENSE`.
