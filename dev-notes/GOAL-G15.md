## Goal: G15 — Projects & Documents (Markdown Library + Agent Save)

### Objective
Implement a markdown document library grouped by projects in Prompty, with prompt-sheet extraction that creates insertable Prompty prompts from shot sections, and MCP tools so coding agents save/update documents through the G14 bridge automatically.

### Context
Real workflow: AI short film production (GOLDHUNTER, Muse Video). Agents produce 5–10 markdown files per project (screenplay, project card, breakdown, prompt sheets, anti-drift rules). Documents are revised many times (v1 → v2 → v3). Today agents export `prompty-pack` by hand; documents have nowhere to live, and every revision means a new import. G15 makes documents first-class in Prompty with versioning, extraction, and agent bridge integration.

### Deliverables
- [ ] **Data model** (`src/lib/documents.js`, pure, tests first):
    `Project { id, name, color, icon, order, createdAt }` and
    `Document { id, projectId, title, kind, markdown, createdAt, updatedAt, versions[] }` with
    `kind ∈ screenplay | project-card | breakdown | prompt-sheet | rules | notes`.
    New whitelisted storage keys; normalizers drop unknown fields. Caps: 512 KB/document, 300 documents, 50 projects; refuse, never truncate silently. Versions reuse G5 history rules (max 20, newest first).
- [ ] **Prompt-sheet extraction** (`src/lib/prompt-sheet.js`, pure, tests first): parse `## <ID> — <name>` sections → `{ shotId, name, refs[], prompt, edit, check }`. Each shot becomes/updates a Prompty prompt linked by `{ documentId, shotId }`, in project-named category, tagged `<project>`, `<shotId>`, document version tag. Re-save updates in place (stable ids), removes disappeared shots (with undo), never duplicates. Variables keep working; braces in code blocks that aren't valid variables stay text.
- [ ] **Popup — Projects view**: project list → document list (kind icon, updated date, version count) → document reader. Reader renders safe markdown subset via DOM nodes + `textContent` only (headings, paragraphs, bold/italic, lists, tables, blockquotes, fenced code, inline code, links as text). No `innerHTML`, no remote images, no HTML passthrough. Each fenced block gets Insert · Append · Copy; each shot section shows Refs as numbered checklist and CHECK as checklist.
- [ ] **In-page `!` palette**: search across documents' shots (`G08`, `lizard`, `goldhunter v3`) and insert shot prompt directly.
- [ ] **Version diff**: reuse G5 diff view between two document versions.
- [ ] **MCP tools** (`mcp/lib/tools.mjs`): `save_document { project, title, kind, markdown, extractPrompts? }` (upsert by project+title; new version when markdown changes), `list_projects`, `list_documents { project? }`, `get_document { id | project+title }`, `get_shot { project, shotId }` (returns prompt + refs + check), `delete_document` (tombstone). Server instructions tell agents: *"When you produce or revise a project file, save it with save_document and say so in one line."*
- [ ] **Bridge API**: documents travel through existing pending → import → ack flow. Respect 1 MB request cap: one document per pending item, snapshots send metadata in main snapshot + each changed document's body in its own request.
- [ ] **Packs**: `prompty-pack` gains optional `projects` and `documents` arrays. v1 pack without them imports as before; older Prompty given pack with documents imports prompts and reports documents as skipped (no crash).
- [ ] i18n en + fr for all new strings; a11y (keyboard, focus, roles) for new views.
- [ ] Docs: README feature list, `mcp/README.md` tools table, CHANGELOG, SPEC Δ15, SECURITY note on markdown renderer.

### Definition of Done
- [ ] End-to-end over real MCP handshake: `save_document` with real `GOLDHUNTER_PROMPTS_G01-G17-v3.md` → sync → project GOLDHUNTER shows document, 17 shot prompts + 1 template extracted in right category with tags, `get_shot GOLDHUNTER G08` returns prompt, Refs and CHECK.
- [ ] Re-saving revised document updates 17 prompts in place (same ids), adds version, diff view shows change.
- [ ] Insert from reader and from `!` works in plain `<textarea>` and `contenteditable` (headless Chromium test page).
- [ ] Hostile markdown fixture (`<script>`, `<img onerror>`, `javascript:` links, 600 KB body, 10000 headings) renders inert or refused with clear message.
- [ ] 50 documents × 100 KB: project view opens and search answers in < 150 ms (bench script).
- [ ] Gates green: `pnpm type-check && pnpm lint && pnpm test && pnpm package`, `web-ext lint` 0/0/0, `pnpm validate`, `pnpm check:docs`, axe audit light + dark.

### Verification Steps
1. `node mcp/server.mjs`, pair extension, call `save_document` from MCP client.
2. Sync now → open Projects → GOLDHUNTER → prompt sheet; insert G02 into test page.
3. Edit markdown, `save_document` again → versions = 2, prompts updated, no duplicates.
4. Export pack with project, import into fresh profile → identical project.
5. Screenshots of Projects view and reader, light + dark.

### Anti-Drift Rules
- Local-first stays absolute: no new network surface beyond G14 loopback bridge; documents live in `storage.local` (encrypted when Vault Mode on — documents go through vault like prompts).
- Markdown renderer never uses `innerHTML` or third-party HTML sanitizer; builds nodes from parsed AST with `textContent`.
- Extraction never rewrites prompt text: fenced content stored byte-for-byte (trimmed of fence only). User's prompts are anti-drift contracts; single changed word can break generation.
- No images/reference uploads in this PR (separate subgoal). Refs stay text.
- One PR, tests first for every pure function, no unrelated refactors.

### Estimated Effort
L (Large)