# Prompty — Global Prompt Library

Save, organize, and paste prompts on **any** site. Prompty is a cross-browser
(Chromium MV3 + Firefox MV3) extension that keeps your prompt library one
keystroke away — in ChatGPT, Claude, Gemini, Perplexity, Higgsfield, or any
plain `<textarea>` on the web.

**Local by construction.** No accounts, no cloud, no telemetry, and no network requests unless
you opt into the agent bridge — a loopback-only connection that lets a coding agent save prompts
for you. Everything lives in `browser.storage.local`, encrypted at rest if you turn on Vault Mode.

## Features (v0.5)

What's new in each version: [`CHANGELOG.md`](CHANGELOG.md).

- **Prompt library popup** — browse by view or category, search (`/`), sort, star, and insert, append, copy, edit or delete (with undo) prompts; manage categories (drag to reorder).
- **Cinematic starter library** — 52 prompts in 16 categories: Characters, Landscapes, Objects, Styles, Abstract, Camera Angles, Camera Movement, Lighting, Lens & Optics, Locations, Color Grading, Composition, Mood & Atmosphere, VFX & Transitions, Posters and Logos. Every prompt has `{variables}` to fill in.
- **Bulk operations** — select many prompts (checkbox, Shift-click, Ctrl/Cmd+A, Space and Shift+arrows) and move, tag, star, copy, export or delete them at once; drag a selection onto a sidebar category to move it. Bulk delete has a 10-second undo.
- **Prompt Composer** — build a shot from film-grammar blocks (subject, location, camera, lens, composition, lighting, grade, mood, transition), each picked from your library or written by hand; variables shared across blocks are asked once. Three starter shot templates; save the result and reopen it with 🎛.
- **Shot sequences** — chain shots into a scene: each shot has a duration and the cut into the next (hard, match, smash, whip pan, dissolve, or no cut). The sequence is written as timecoded shots, a shot list, or one continuous take, and variables shared between shots (`{hero}`) are asked once.
- **Model dialects** — write the sequence the way the target model reads it: **Seedance 2.5** (`0–4 seconds: …`, then `At 4 seconds, match cut.`) or **Muse Video** (`SHOT 1 (0–4 s): … STOP. HARD CUT.`). The Composer suggests the dialect for the site you're on (Dreamina → Seedance, meta.ai → Muse), remembers your choice per site, and warns when a sequence fights the model (for example, more than 4 cuts for Muse).
- **Command palette (`Ctrl/Cmd+K`)** — one keyboard-only list of prompts, snippets and commands.
- **English and French** — the popup and the in-page pill, widget and `!` palette follow your browser language (French translation included); the text written for AI models stays English.
- **Vault Mode (opt-in)** — encrypt prompts, snippets, fill-ins and drafts on disk with a passphrase (AES-GCM, PBKDF2 250k). Auto-locks after idle time; the key is held in memory only. No recovery if the passphrase is lost.
- **Insights** — most-used prompts and categories, prompts added per month, never-used and dormant prompts (one click selects them for bulk tidy-up), and your recent fill-ins. Computed from what Prompty already stores; nothing new is tracked.
- **Share packs** — select prompts, then **Pack…** saves a `.prompty` file (prompts, categories, Composer blocks; no personal stats). Drop a pack on the popup to preview and add it.
- **Import from another tool** — bring a Higgsfield Prompt Saver export, a CSV, a text/Markdown file or a JSON list. A report shows what will be added, merged or skipped before anything changes; duplicates are skipped and categories matched by name.
- **Agent bridge (opt-in)** — point Claude Code, Cursor or any MCP client at `mcp/server.mjs` and ask it to *"add a camera movement"*. The agent writes to `~/.prompty`; Prompty imports it over `127.0.0.1` on a one-minute clock. Off by default, token-paired, loopback only. See [`mcp/README.md`](mcp/README.md).
- **Settings** — default view, compact cards, floating widget, quick-insert trigger, sites to skip, custom site recipes, agent bridge, JSON import/export.
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

CI builds and package-lints both archives on every run; it does not attach
them to the run (that hit the account's Actions storage quota). Attach them as
GitHub Release assets when cutting a version.

## Scripts

| Command                                     | What it does                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm type-check`                           | `tsc --noEmit` over JS with JSDoc types                                                                            |
| `pnpm lint`                                 | ESLint, zero warnings allowed                                                                                      |
| `pnpm test`                                 | Vitest unit tests                                                                                                  |
| `pnpm build`                                | Emit both dists from `src/manifest.base.json`, then validate                                                       |
| `pnpm validate`                             | Check both built manifests: shape, files, i18n, version                                                            |
| `pnpm check:docs`                           | Verify `docs/index.html` test-suite claims match the actual suite (no execution, ~5s)                              |
| `pnpm package`                              | Build, validate, then zip both targets                                                                             |
| `node scripts/icons.mjs`                    | Re-render the 16/32 px toolbar glyph from `src/icons/glyph.svg` (needs Playwright)                                 |
| `node scripts/bench-library.mjs [count]`    | After `pnpm build`: seed N prompts (default 5,000) and time first card, search, star and Ctrl+K (needs Playwright) |
| `node scripts/a11y-audit.mjs [light\|dark]` | After `pnpm build`: axe-core audit of every popup view; exits 1 on any violation (needs Playwright + axe-core)     |
| `node scripts/store-screenshots.mjs`        | After `pnpm build`: regenerate the store screenshots and promo tile in `store/` (needs Playwright)                 |

CI (`.github/workflows/pr-validation.yml`) runs all gates plus `web-ext lint
--warnings-as-errors` (Firefox, AMO rules), `pnpm validate` (both targets) and
`pnpm check:docs` (landing-page claims) on every PR and every push to `main`.

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
mcp/                   prompty-mcp: zero-dependency stdio MCP server + loopback bridge
tests/                 vitest suites
dev-notes/             GOAL, SPEC, SECURITY, ROADMAP, PROGRESS, subgoals/
store/                 store screenshots, promo tile, listing copy
```

## Roadmap

v0.4 shipped Vault Mode, Insights, share packs, the import suite, French, the
accessibility pass and 5k-prompt performance. v0.5 adds the agent bridge.
The remaining tier — library hygiene, a burst generator, prompt hotkeys,
snapshots and an on-device rewrite assist — is listed in
[`dev-notes/ROADMAP.md`](dev-notes/ROADMAP.md).
Shipped subgoal specs live in [`dev-notes/subgoals/`](dev-notes/subgoals/README.md).

## License & attribution

MIT — see [`LICENSE`](LICENSE).

Prompty is ported from and inspired by **Higgsfield Prompt Saver v1.0.0**
(© JohnLaibach, MIT). The original's behavior was generalized from a single
site to the whole web; its notice is reproduced in `LICENSE`.
