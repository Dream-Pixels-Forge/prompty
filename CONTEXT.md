# CONTEXT.md — Prompty

## Project Identity

**Prompty** — cross-browser (Chromium MV3 + Firefox MV3) prompt-library extension.
Global: works on any site, not only higgsfield.ai. Inspired by MIT-licensed Higgsfield Prompt Saver v1.0.0.

## Core Domain Terms

| Term | Meaning |
|------|---------|
| **Prompt** | A reusable text template with optional `{variables}`, stored in `storage.local` |
| **Category** | User-defined grouping for prompts (color, emoji, order) |
| **Snippet** | Clipboard history entry (max 50, FIFO), auto-captured on user copy |
| **Project** | Container for markdown documents (screenplay, project-card, breakdown, prompt-sheet, rules, notes) |
| **Document** | Markdown file inside a project, versioned (max 20 versions), with kind classification |
| **Shot** | A section in a prompt-sheet document (`## G08 — Name`), extracted as an insertable prompt |
| **Model Profile** | Video generation model config: dialect, wrapper, limits, reference slots, verified specs |
| **Variant** | A shot's prompt for a specific model (Muse, Seedance, Kling, etc.) |
| **Wrapper** | Template that surrounds a prompt for a specific site (e.g., Meta AI pass-through) |
| **Bridge** | Opt-in MCP loopback bridge (127.0.0.1:47821) for coding agents to save prompts/documents |
| **Vault** | Opt-in encryption at rest for `storage.local` (G10) |
| **Pack** | Portable export format (`.prompty`): prompts, categories, settings, projects, documents, profiles |

## Architecture

- **Popup** — 780×580, sidebar navigation, grid cards, search, editor, snippets, settings
- **Content Script** — IIFE shadow-DOM, smart assist pill, floating widget, `!` palette, message handlers
- **Background** — Service worker (Chrome) / Event page (Firefox): context menus, commands, bridge sync
- **Lib** — Pure ES modules (storage, variables, sites, text, message, documents, prompt-sheet, models, wrappers, sequences)
- **MCP Server** — `mcp/server.mjs` (Node ≥20 stdio), tools for prompts, documents, projects, models

## Quality Gates (every PR)

`pnpm type-check && pnpm lint && pnpm test && pnpm package`
`web-ext lint` (Firefox) — 0 errors, 0 warnings
`pnpm validate` (manifests)
`pnpm check:docs`
axe audit (light + dark)

## Conventions

- **Tests first** (TDD): pure functions in `src/lib/` have `*.test.mjs` before implementation
- **No `innerHTML`**: markdown renderer builds DOM nodes with `textContent` only
- **No network**: except opt-in loopback bridge; `storage.local` only
- **Crypto IDs**: `crypto.randomUUID()` for all new entities
- **Message contract**: every handler responds `{success|error}`; unknown types → `{success:false,error:"unknown type"}`
- **Settings whitelist**: all keys in `SETTINGS_KEYS` (src/lib/storage.js); unknown keys dropped
- **i18n**: en + fr for all user-facing strings
- **A11y**: keyboard navigation, focus management, ARIA roles, contrast

## Current Version

v0.5.1 (released 2026-11-14) — Chrome-clean manifest, G14 MCP agent bridge complete

## Next Goals (ROADMAP)

- **G15** — Projects & documents (markdown library + agent save via bridge)
- **G15b** — Multi-model prompt sheets (one shot, many model variants)
- G19 — Smart library hygiene
- G16 — Prompt hotkeys
- G17 — Weekly auto-snapshot
- G18 — On-device rewrite assist