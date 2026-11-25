# prompty-mcp — let a coding agent write into your Prompty library

A small, zero-dependency MCP server that gives a coding agent (Claude Code, Cursor, Claude
Desktop, or any MCP client) the same library you see in the Prompty browser extension.

Ask the agent *"add a camera movement for a slow dolly zoom"* and it calls `save_prompt`; the
prompt lands in Prompty within a minute, categorized and tagged:

```
MCP client ──stdio──► prompty-mcp ──HTTP 127.0.0.1──► Prompty background ──► storage.local
                      (~/.prompty)     token-authed      (1-min alarm / Sync now)
```

- **Off by default.** The extension makes no request until you enable Settings → Agent bridge.
- **Loopback only.** The extension refuses any bridge URL that is not `127.0.0.1` or `localhost`.
- **Token-authed.** A 48-hex token is generated on first run (`~/.prompty/bridge.json`, mode 0600).
- **Works while the browser is closed.** Agent writes queue in `~/.prompty/library.json`; the
  extension imports them on its next sync.

## Quick start

1. **Run the server once** so it creates `~/.prompty` and prints its token:

   ```bash
   node mcp/server.mjs
   ```

   ```
   prompty-mcp 0.5.1
     library : /home/you/.prompty/library.json
     bridge  : http://127.0.0.1:47821  (enable Settings → Agent bridge in Prompty)
     token   : 3f9c…48 hex characters…
   ```

   Copy the token (or read it later from `~/.prompty/bridge.json`). Keep this process running
   while you want the agent bridge live; the agent will normally start it for you (step 2).

2. **Register it with your agent.** All clients use the same stdio command; substitute the
   absolute path to this folder.

   Claude Code:

   ```bash
   claude mcp add prompty -- node /absolute/path/to/prompty/mcp/server.mjs
   ```

   Cursor — `~/.cursor/mcp.json` (or a project `.cursor/mcp.json`):

   ```json
   {
     "mcpServers": {
       "prompty": {
         "command": "node",
         "args": ["/absolute/path/to/prompty/mcp/server.mjs"]
       }
     }
   }
   ```

   Claude Desktop — `claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "prompty": {
         "command": "node",
         "args": ["/absolute/path/to/prompty/mcp/server.mjs"]
       }
     }
   }
   ```

3. **Pair the extension.** Open Prompty → Settings → **Agent bridge**:

   - turn on **Enable the agent bridge**
   - leave **Bridge URL** at `http://127.0.0.1:47821` unless the server printed another port
   - paste the **Pairing token**
   - press **Test connection** — you should see `Bridge reachable — v0.5.1, 0 waiting, N in the library.`

   Prompty now checks the bridge once a minute while the browser is open. **Sync now** does the
   same on demand.

4. **Use it.** Tell the agent what you want:

   > Save a prompt called "Slow dolly zoom": a slow dolly zoom on `{subject}` with a
   > `{lens:24mm|50mm}` lens, category Camera Movement.

   The agent replies that it saved the prompt and that it will appear on the next sync.

## Tools

| Tool              | What it does                                                              |
| ----------------- | ------------------------------------------------------------------------- |
| `save_prompt`     | Add a prompt (`text` required; `title`, `category`, `tags`, `favorite`). Identical body updates in place. |
| `list_prompts`    | Newest first, filter by `category` or `tag`, cap with `limit`.            |
| `search_prompts`  | Typo-tolerant search over title, body and tags.                           |
| `get_prompt`      | One prompt in full, including parsed template variables.                  |
| `update_prompt`   | Edit title/body/tags/category/favorite by id; only passed fields change.  |
| `delete_prompt`   | Queue a deletion (a tombstone the extension applies on the next sync).     |
| `list_categories` | Categories with prompt counts, so the agent reuses names instead of inventing them. |
| `bridge_status`   | Running state, loopback URL, token, pending count, library path.          |
| `save_document`   | Save a markdown document to a project (`project`, `title`, `kind`, `markdown` required; `extractPrompts` optional). Upserts by project + title and creates a new version when the markdown changes. |
| `list_projects`   | Projects with color, icon and order.                                     |
| `list_documents`  | Documents in a project (or all), with id, title, kind, last-updated time.|
| `get_document`    | One document in full by id or by project + title, with markdown and versions. |
| `get_shot`        | One shot from a prompt-sheet: prompt, refs, edit and check lines.        |
| `delete_document` | Queue a deletion by id (tombstone applied on next sync).                 |

Template variables the popup already understands are parsed and reported back:

| Syntax                | Kind   |
| --------------------- | ------ |
| `{subject}`           | text   |
| `{mood=neutral}`      | text with default |
| `{lens:24mm\|50mm}`   | choice |
| `{seed:1-999}`        | range  |

## Files and environment

| Path                    | Contents                                                              |
| ----------------------- | --------------------------------------------------------------------- |
| `~/.prompty/library.json` | Prompts, categories, deletion tombstones. Atomic writes, mode 0600. |
| `~/.prompty/bridge.json`  | `{ token, port }` pairing secret. Mode 0600, rewritten on start.    |

| Variable              | Default            | Purpose                                  |
| --------------------- | ------------------ | ---------------------------------------- |
| `PROMPTY_HOME`        | `~/.prompty`       | Where the library and token live.        |
| `PROMPTY_BRIDGE_PORT` | `47821`            | Fixed port; if taken, the server falls back to a free one. |

Exit the server (Ctrl-C) to take the bridge offline. The extension keeps working; it just reports
a failed sync until the bridge is back.

## What syncs where

`save_prompt` writes to `~/.prompty` immediately. The extension imports on its next alarm:
it preserves the server's prompt ids, dedupes by normalized text, creates missing categories,
applies tombstones, then acks the ids it consumed and posts its library back as a snapshot. That
snapshot is what `list_prompts` / `search_prompts` / `get_prompt` read, so the agent can see prompts
you wrote in the browser too.

## Security

- Listener binds `127.0.0.1` only — never a LAN interface.
- Every request needs `X-Prompty-Token`; comparison is constant-time. A missing or wrong token
  gets `401` and learns nothing about the routes.
- Bodies are capped at 1 MB. Responses are `Cache-Control: no-store`, `X-Content-Type-Options:
  nosniff`, and carry no CORS headers, so web pages cannot read them.
- The token is never echoed in a response, never written into `library.json`, and never appears
  in a Prompty JSON export (the extension stores it outside `settings`).
- Prompts go through the extension's storage normalizers: unknown fields are dropped, and a
  bridge payload cannot write an arbitrary storage key.

Treat `~/.prompty/bridge.json` like an SSH key. If it leaks, stop the server, delete
`~/.prompty/bridge.json`, start it again, and paste the new token in Settings.

## Troubleshooting

| Symptom                                   | Fix                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------- |
| **Test connection** says "Cannot reach the bridge" | Start `node mcp/server.mjs`; check the printed port matches the Settings URL. |
| `401 unauthorized`                        | Token mismatch — copy it again from `~/.prompty/bridge.json`.        |
| Prompts saved but never appear            | Bridge toggle off, or the browser is closed. Open Prompty → Settings → Agent bridge → **Sync now**. |
| `reason: "vault-locked"`                  | Unlock the vault, then sync again.                                  |
| Agent does not call `save_prompt`         | Say "save this prompt" explicitly, or check the MCP server is connected in the client. |
| Port 47821 already used                   | Set `PROMPTY_BRIDGE_PORT` (and the Settings URL) or read the fallback port in `bridge_status`. |

## Development

The package is plain ESM with no dependencies. Its contract tests live in the extension repo:

```bash
pnpm vitest run tests/mcp-store.test.mjs tests/mcp-tools.test.mjs tests/mcp-rpc.test.mjs tests/mcp-bridge.test.mjs
```
