Read `dev-notes/GOAL.md`, `dev-notes/SPEC.md`, `dev-notes/SECURITY.md`, `dev-notes/subgoals/README.md`, `dev-notes/subgoals/G14-mcp-agent-bridge.md`, `dev-notes/subgoals/G13-share-packs.md`, `mcp/README.md` and `src/lib/storage.js` before writing any code.
Then save the spec below as `dev-notes/subgoals/G15-project-documents.md`, add it to the table in `dev-notes/subgoals/README.md`, and implement it as ONE PR following the "Rules for every subgoal". Ask me before any decision that contradicts GOAL.md or SECURITY.md.

---

## Goal: G15 — Projects & documents (markdown library + agent save)

### Objective

Let a creator keep a whole production in Prompty — screenplay, project card (locks), shot
breakdown, prompt sheets, anti-drift rules — as **markdown documents grouped by project**, and use
them in one click: read a document in the popup, insert any of its code blocks into the page, and
get every shot prompt it contains as a regular, insertable Prompty prompt. A coding agent (Claude
Code) saves and updates these documents through the G14 bridge, so the agent's deliverables land in
Prompty automatically instead of being copied by hand.

### Context

Real workflow this serves (AI short film "GOLDHUNTER", Muse Video via Meta AI):

- The agent produces 5–10 markdown files per project: `ANTI-DRIFT_MUSE.md`,
  `GOLDHUNTER_PROJECT_CARD.md`, `GOLDHUNTER_DECOUPAGE_v2.md`, `GOLDHUNTER_PROMPTS_G01-G17-v3.md`,
  the screenplay… They are revised many times (v1 → v2 → v3).
- A prompt sheet is a markdown file where each shot is a section:
  ```
  ## G02 — The lizard
  **Refs:** 1 `@lizard` · 2 `@plate`
  ```(fenced block = the prompt to paste)```
  **Edit:** keep ~2 s per shot …
  **CHECK:** lizard tiny in shot 3 · …
  ```
  The user needs the fenced block in the Meta AI input, the Refs list to attach images in order,
  and the CHECK list to judge the take.
- Today the agent exports a `prompty-pack` by hand and the user drags it in. Documents (non-prompt
  markdown) have nowhere to live, and every revision means a new import.

### Deliverables

- [ ] **Data model** (`src/lib/documents.js`, pure, tests first):
      `Project { id, name, color, icon, order, createdAt }` and
      `Document { id, projectId, title, kind, markdown, createdAt, updatedAt, versions? }` with
      `kind ∈ screenplay | project-card | breakdown | prompt-sheet | rules | notes`.
      New whitelisted storage keys; normalizers drop unknown fields (same pattern as
      `normalizePrompt`). Caps: 512 KB per document, 300 documents, 50 projects; refuse, never
      truncate silently. Document versions reuse the G5 history rules (max 20, newest first).
- [ ] **Prompt-sheet extraction** (`src/lib/prompt-sheet.js`, pure, tests first): parse
      `## <ID> — <name>` sections → `{ shotId, name, refs[], prompt, edit, check }`. Each extracted
      shot becomes (or updates) a Prompty prompt linked by `{ documentId, shotId }`, in a category
      named after the project, tagged `<project>`, `<shotId>`, and the document version tag (`v3`).
      Re-saving the same document **updates** linked prompts in place (stable ids), removes prompts
      for shots that disappeared (with undo), never duplicates. Variables in prompts keep working
      (`{var}` grammar unchanged); braces inside code blocks that are not valid variables stay text.
- [ ] **Popup — Projects view**: project list → document list (kind icon, updated date, version
      count) → document reader. The reader renders a **safe markdown subset** built with DOM
      nodes + `textContent` only (headings, paragraphs, bold/italic, lists, tables, blockquotes,
      fenced code, inline code, links shown as text). No `innerHTML`, no remote images, no HTML
      passthrough. Each fenced block gets **Insert · Append · Copy**; each shot section shows its
      Refs as a numbered checklist and its CHECK line as a checklist.
- [ ] **In-page `!` palette**: search across documents' shots (`G08`, `lizard`, `goldhunter v3`) and
      insert the shot prompt directly.
- [ ] **Version diff**: reuse the G5 diff view between two versions of a document.
- [ ] **MCP tools** (in `mcp/lib/tools.mjs`, same validation style as `save_prompt`):
      `save_document { project, title, kind, markdown, extractPrompts?: boolean }` (upsert by
      project + title; a new version when markdown changes),
      `list_projects`, `list_documents { project? }`, `get_document { id | project+title }`,
      `get_shot { project, shotId }` (returns prompt + refs + check),
      `delete_document` (tombstone). Server `instructions` (MCP initialize) tell agents: *"When you
      produce or revise a project file for the user (screenplay, project card, breakdown, prompt
      sheet, rules), save it with save_document and say so in one line."*
- [ ] **Bridge API**: documents travel through the existing pending → import → ack flow.
      Respect the 1 MB request cap: one document per pending item, and snapshots send document
      **metadata** in the main snapshot plus each changed document's body in its own request
      (design it, test it at the cap).
- [ ] **Packs**: `prompty-pack` gains optional `projects` and `documents` arrays. A v1 pack without
      them still imports exactly as before; an older Prompty given a pack with documents imports
      the prompts and reports the documents as skipped (no crash).
- [ ] i18n en + fr for every new string; a11y (keyboard, focus, roles) for the new views.
- [ ] Docs: README feature list, `mcp/README.md` tools table, CHANGELOG, SPEC Δ15, SECURITY note
      on the markdown renderer.

### Definition of Done

- [ ] End-to-end over a real MCP handshake: `save_document` with the real
      `GOLDHUNTER_PROMPTS_G01-G17-v3.md` (I will provide it) → sync → project GOLDHUNTER shows the
      document, 17 shot prompts + 1 template are extracted in the right category with tags,
      `get_shot GOLDHUNTER G08` returns the prompt, Refs and CHECK.
- [ ] Re-saving a revised document updates the 17 prompts in place (same ids), adds a version,
      and the diff view shows the change.
- [ ] Insert from the reader and from `!` works in a plain `<textarea>` and in a
      `contenteditable` field (headless Chromium test page).
- [ ] A hostile markdown fixture (`<script>`, `<img onerror>`, `javascript:` links, 600 KB body,
      10 000 headings) renders inert or is refused with a clear message.
- [ ] 50 documents × 100 KB: project view opens and search answers in < 150 ms (bench script).
- [ ] Gates green: `pnpm type-check && pnpm lint && pnpm test && pnpm package`, `web-ext lint`
      0/0/0, `pnpm validate`, `pnpm check:docs`, axe audit light + dark.

### Verification Steps

1. `node mcp/server.mjs`, pair the extension, call `save_document` from an MCP client.
2. Sync now → open Projects → GOLDHUNTER → the prompt sheet; insert G02 into a test page.
3. Edit the markdown, `save_document` again → versions = 2, prompts updated, no duplicates.
4. Export a pack with the project, import it into a fresh profile → identical project.
5. Screenshots of the Projects view and reader, light + dark.

### Anti-Drift Rules

- Local-first stays absolute: no new network surface beyond the G14 loopback bridge; documents
  live in `storage.local` (encrypted when Vault Mode is on — documents must go through the vault
  like prompts).
- The markdown renderer never uses `innerHTML` or a third-party HTML sanitizer as the safety
  layer; it builds nodes from a parsed AST with `textContent`.
- Extraction never rewrites the prompt text: what is inside the fenced block is stored
  byte-for-byte (trimmed of the fence only). The user's prompts are anti-drift contracts; a single
  changed word can break a generation.
- Do not add images/reference uploads in this PR (separate subgoal). Refs stay text.
- One PR, tests first for every pure function, no unrelated refactors.

### Estimated Effort

L
