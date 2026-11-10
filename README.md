# Prompty — Global Prompt Library

Save, organize, and paste prompts on **any** site. Prompty is a cross-browser
(Chromium MV3 + Firefox MV3) extension that keeps your prompt library one
keystroke away — in ChatGPT, Claude, Gemini, Perplexity, Higgsfield, or any
plain `<textarea>` on the web.

**100% local.** No servers, no accounts, no telemetry, zero network requests.
Everything lives in `browser.storage.local`.

## Features (v0.2)

- **Prompt library popup** — browse by view or category, search (`/`), sort, star, and insert, append, copy, edit or delete (with undo) prompts; manage categories (drag to reorder).
- **Cinematic starter library** — 52 prompts in 16 categories: Characters, Landscapes, Objects, Styles, Abstract, Camera Angles, Camera Movement, Lighting, Lens & Optics, Locations, Color Grading, Composition, Mood & Atmosphere, VFX & Transitions, Posters and Logos. Every prompt has `{variables}` to fill in.
- **Prompt Composer** — build a shot from film-grammar blocks (subject, location, camera, lens, composition, lighting, grade, mood, transition), each picked from your library or written by hand; variables shared across blocks are asked once. Three starter shot templates; save the result and reopen it with 🎛.
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

| Command                  | What it does                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm type-check`        | `tsc --noEmit` over JS with JSDoc types                                            |
| `pnpm lint`              | ESLint, zero warnings allowed                                                      |
| `pnpm test`              | Vitest unit tests                                                                  |
| `pnpm build`             | Emit `dist/chrome` + `dist/firefox` from `src/manifest.base.json`                  |
| `pnpm package`           | Build, then zip both targets                                                       |
| `node scripts/icons.mjs` | Re-render the 16/32 px toolbar glyph from `src/icons/glyph.svg` (needs Playwright) |

CI (`.github/workflows/pr-validation.yml`) runs all gates plus `web-ext lint`
(Firefox) and `addons-linter` (Chrome) on every PR and every push to `main`.

## Project layout

```
src/
  background.js        service worker (Chrome) / event page (Firefox)
  content/assist.js    pill, floating widget, ! palette, insert handlers
  popup/               library UI
  lib/                 pure ES modules: storage, variables, search, recipes, sites, text, message
  assets/recipes.json  seeded site recipes
scripts/               build + package
tests/                 vitest suites
dev-notes/             GOAL, SPEC, SECURITY, ROADMAP, PROGRESS
```

## Roadmap

v0.3 "Differentiators" is next: Ctrl+K command palette, prompt version history,
bulk ops, Variables 2.0, and more. See [`dev-notes/ROADMAP.md`](dev-notes/ROADMAP.md).

## License & attribution

MIT — see [`LICENSE`](LICENSE).

Prompty is ported from and inspired by **Higgsfield Prompt Saver v1.0.0**
(© JohnLaibach, MIT). The original's behavior was generalized from a single
site to the whole web; its notice is reproduced in `LICENSE`.
