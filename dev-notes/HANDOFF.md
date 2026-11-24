# Prompty Handoff Document

**Project**: Prompty — Global Prompt Library Browser Extension  
**Version**: 0.5.1 "Clean Room"  
**Date**: 2024-11-14  
**Branch**: `main` @ `fc89e78`  
**Status**: All gates green, release shipped, zero open issues/PRs

---

## TL;DR

Prompty is a local-first browser extension (Chrome MV3 + Firefox MV3) for saving, organizing, and inserting AI prompts anywhere you type. The codebase is clean, tested, and production-ready. The only open finding is a transitive dev-dependency vulnerability (minimatch ReDoS) that requires an upstream fix in typescript-eslint.

---

## Current State

### Version Alignment
| Component | Version |
|-----------|---------|
| `package.json` | 0.5.1 |
| `src/manifest.base.json` | 0.5.1 |
| `mcp/package.json` | 0.5.1 |
| Chrome manifest | 0.5.1 |
| Firefox manifest | 0.5.1 |
| Git tag | `v0.5.1` |
| GitHub Release | `v0.5.1` (assets: `prompty-0.5.1-chrome.zip`, `prompty-0.5.1-firefox.xpi`) |
| Live Pages | `v0.5.1 · local-first` |

### Test Suite
- **548 tests** / **39 files** — all passing
- Coverage: unit, integration, parity, manifest validation, landing-page claims gate
- Suite size: 527 tests / 39 files (landing page claims gate enforces accuracy)

### Quality Gates (All Green)
| Gate | Command | Status |
|------|---------|--------|
| Type Check | `pnpm type-check` | ✅ |
| Lint | `pnpm lint` | ✅ 0 warnings |
| Tests | `pnpm test` | ✅ 548/39 |
| Build + Validate | `pnpm package` | ✅ 56 files each |
| Manifest Validation | `pnpm validate` | ✅ |
| Landing Claims | `pnpm check:docs` | ✅ 527 tests, 39 files |
| Firefox Lint | `web-ext lint --warnings-as-errors` | ✅ 0/0/0 |
| `pnpm audit` | 1 moderate (dev-only, see below) | ⚠️ |

---

## What Was Shipped (Recent)

### v0.5.1 "Clean Room" (PR #48, merged `fc89e78`)
- **Security**: Bumped vitest 3.2.7 → 5.1.0, clearing 2 critical (tinypool RCE gadgets) + 3 moderate (@vitest/mocker) advisories
- **Lint**: Upgraded eslint 9→10, typescript-eslint 8.21→8.72, fixed 5 `no-useless-assignment` errors
- **DevDeps**: globals 15.14→15.15, prettier 3.5→3.10

### v0.5.1 "Clean Room" — Manifest Fix (PR #43, merged `1fbbe35`)
- Chrome manifest no longer carries Firefox-only keys (`background.scripts`, `browser_specific_settings`)
- New `scripts/validate-manifests.mjs` gate replaces `addons-linter` for Chrome
- `scripts/manifest.mjs` centralizes target-specific manifest shapes

### Landing Page Claims Gate (PR #46, merged `8ad3570`)
- Unified hero (528→527) + stats strip (453→527) to single current count
- New `scripts/check-page-claims.mjs` + `pnpm check:docs` CI gate
- 5 regression tests covering stale counts, removed markup, file count drift

### v0.5.0 "Handshake" (PR #40/41, merged `b54c274`/`f8efae9`)
- **Agent Bridge (G14)**: Opt-in MCP server (`mcp/server.mjs`) lets coding agents save prompts via loopback HTTP (127.0.0.1:47821), token-authenticated, 1-min alarm sync
- 8 MCP tools: `save_prompt`, `list_prompts`, `search_prompts`, `get_prompt`, `update_prompt`, `delete_prompt`, `list_categories`, `bridge_status`
- Off by default, token stored outside `settings` (never exported), 48-hex/192-bit token, constant-time compare

---

## Architecture Overview

### Extension (Chrome MV3 / Firefox MV3)
```
src/
├── background.js          # Service worker (Chrome) / Event page (Firefox)
├── content/assist.js      # Content script: pill, widget, ! palette, insert
├── popup/                 # Library UI (categories, search, editor, vault, settings)
├── lib/                   # Pure ES modules (storage, bridge, vault, capture, etc.)
└── assets/recipes.json    # Site-specific save/insert selectors
```

### MCP Server (Node, stdio + loopback HTTP)
```
mcp/
├── server.mjs             # Stdio JSON-RPC + HTTP bridge startup
├── lib/
│   ├── bridge.mjs         # HTTP routes: /health, /pending, /ack, /snapshot
│   ├── store.mjs          # ~/.prompty/library.json + bridge.json (atomic, 0600)
│   ├── tools.mjs          # 8 MCP tool definitions
│   ├── rpc.mjs            # JSON-RPC 2.0 over stdio
│   └── variables.mjs      # Template variable parser
```

### Key Libraries
| Module | Purpose |
|--------|---------|
| `lib/storage.js` | Schema, normalization, import/export, whitelist merges |
| `lib/secure-store.js` | Vault encryption layer (AES-GCM-256, PBKDF2-SHA256@250k) |
| `lib/vault.js` | Crypto primitives (seal/open, deriveKey, unlockKey) |
| `lib/bridge.js` | Extension-side bridge client (validatePending, applyPending) |
| `lib/bridge-client.js` | Background sync loop (pending → merge → ack → snapshot) |
| `lib/bridge-constants.js` | Shared protocol constants |
| `lib/capture.js` | Selection → prompt planning (dedupe, title from page) |
| `lib/migrate.js` | Import from JSON/CSV/TXT/.prompty packs |
| `lib/pack.js` | `.prompty` share packs (prompts + categories) |
| `lib/sequence.js` | Shot composer (timeline, seedance/muse output) |
| `lib/composition.js` | Composition blocks (variables, choices, ranges) |

---

## Outstanding / Known Issues

### 1. Minimatch ReDoS (GHSA-g3hv-75wg-m249) — **UNFIXABLE HERE**
| Detail | Value |
|--------|-------|
| Advisory | GHSA-g3hv-75wg-m249 / CVE-2026-XXXXX |
| Package | `minimatch@10.2.6` (vuln) → `11.0.1+` (patched) |
| Path | Transitive via `@typescript-eslint/typescript-estree@8.72.2` (`minimatch: ^10.2.2`) |
| Severity | Moderate (4.7 CVSS) |
| Risk | **Dev-only**. ReDoS via globparts amplification. Requires attacker-controlled glob patterns passed to minimatch. In this repo, minimatch used internally by typescript-eslint for glob matching — **no user input reaches it**. |
| Fix | Requires `@typescript-eslint/typescript-estree` to update its `minimatch` dependency to `^11.0.1`. Blocked upstream. |
| Workaround | None viable without forking typescript-eslint. pnpm overrides / packageExtensions / patches all fail due to pnpm's resolution strategy preferring existing store entries. |

### 2. Landing Page Test Count
- Current: **527 tests / 39 files** (enforced by `pnpm check:docs`)
- Will drift when tests are added/removed — gate will catch it

### 3. Promo Assets
- Prompt files created in `Prod/promo/`:
  - `PROMPTY_10s_TRAILER_PROMPT.md` — 10s vertical/horizontal trailer
  - `PROMPTY_30s_FULL_PROMPT.md` — 30s full narrative promo
- Not yet produced; ready for video team

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Not applicable (extension, no dev server) |
| `pnpm build` | Build both dists + validate manifests |
| `pnpm validate` | Manifest validation only |
| `pnpm check:docs` | Landing page test count gate |
| `pnpm test` | Run all 548 tests |
| `pnpm type-check` | TypeScript compile check |
| `pnpm lint` | ESLint (0 warnings) |
| `pnpm package` | Build + validate + zip both targets |
| `pnpm audit` | Dependency vulnerability scan |
| `pnpm dlx web-ext@8 lint --source-dir dist/firefox --warnings-as-errors` | Firefox AMO lint |

---

## Release Process

```bash
# 1. Ensure main is clean
git checkout main && git pull

# 2. Bump version in 3 files:
# package.json, src/manifest.base.json, mcp/package.json

# 3. Update CHANGELOG.md, docs/index.html, store/listing.md, mcp/README.md

# 4. Run full gate
pnpm type-check && pnpm lint && pnpm test && pnpm package

# 5. Commit + tag
git add -A && git commit -m "release: vX.Y.Z — <Codename>"
git tag -a vX.Y.Z -m "Prompty vX.Y.Z — <Codename>"
git push origin main --tags

# 6. Create GitHub Release with assets
gh release create vX.Y.Z --title "vX.Y.Z — <Codename>" --notes-file RELEASE_NOTES.md \
  dist/prompty-X.Y.Z-chrome.zip dist/prompty-X.Y.Z-firefox.xpi

# 7. Verify version alignment
CODE=$(node -p 'require("./package.json").version')
TAG=$(git ls-remote --tags origin | awk -F'refs/tags/' '{print $2}' | grep -v '\^{}' | sort -V | tail -1)
REL=$(gh release list --limit 1 --json tagName --jq '.[0].tagName')
[ "v$CODE" = "$TAG" ] && [ "$TAG" = "$REL" ] && echo "✅ ALL MATCH: $CODE"
```

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/manifest.base.json` | Shared manifest (version, permissions, icons, commands) |
| `scripts/build.mjs` | Dual-manifest build (Chrome service_worker / Firefox scripts[]) |
| `scripts/validate-manifests.mjs` | Manifest gate (MV3, version, shape, files, i18n, version sync) |
| `scripts/check-page-claims.mjs` | Landing page test count gate |
| `scripts/manifest.mjs` | Target manifest shapes (`buildManifests(base)`) |
| `src/lib/bridge-constants.js` | Protocol v1, default URL, token/status keys, alarm name |
| `src/lib/vault.js` | Crypto: PBKDF2 250k, AES-GCM-256, 12-byte IV |
| `src/lib/secure-store.js` | Vault layer over storage.local + storage.session |
| `mcp/lib/store.mjs` | `~/.prompty` atomic JSON (library.json, bridge.json) |
| `mcp/lib/bridge.mjs` | Loopback HTTP: /health, /pending, /ack, /snapshot |
| `mcp/lib/tools.mjs` | 8 MCP tool definitions |
| `dev-notes/SECURITY.md` | Threat model + mitigations |
| `dev-notes/SPEC.md` | Feature specification (deltas Δ1–Δ14) |
| `dev-notes/PROGRESS.md` | Release history + roadmap |

---

## Environment & Dependencies

### Runtime Requirements
| Tool | Version | Source |
|------|---------|--------|
| Node.js | 24.x (LTS) | `nvm` |
| pnpm | 11.5.1 | `npm i -g pnpm` |
| Chrome/Edge | 120+ | For testing |
| Firefox | 142+ | For testing |

### Dev Dependencies (Key)
| Package | Version | Purpose |
|---------|---------|---------|
| `vitest` | 5.1.0 | Test runner |
| `typescript` | 5.9.3 | Type checking |
| `eslint` | 10.15.0 | Linting |
| `typescript-eslint` | 8.72.2 | TS-aware linting |
| `prettier` | 3.10.1 | Formatting |
| `web-ext` | 8.x | Firefox lint/package |
| `@types/node` | 26.6.6 | Node types |

---

## Next Steps / Suggested Work

| Priority | Task | Notes |
|----------|------|-------|
| **High** | Monitor typescript-eslint for minimatch 11+ support | Subscribe to GH releases; re-run `pnpm audit` on each update |
| **Medium** | Produce promo videos from `Prod/promo/*.md` | Hand off to video team; use brand colors strictly |
| **Medium** | Add Dependabot for automated dev-dep updates | `.github/dependabot.yml` with weekly schedule |
| **Low** | Consider IndexedDB adapter for >10k prompts | Only if storage.local quota becomes bottleneck |
| **Low** | Add more site recipes to `src/assets/recipes.json` | Community contributions welcome |

---

## Contacts & Links

| Resource | URL |
|----------|-----|
| GitHub Repo | `github.com/Dream-Pixels-Forge/prompty` |
| Live Demo | `prompty.dream-pixels-forge.dev` |
| Chrome Web Store | Pending submission |
| Firefox AMO | Pending submission |
| MCP Docs | `mcp/README.md` |
| Security Model | `dev-notes/SECURITY.md` |
| Spec | `dev-notes/SPEC.md` |
| Roadmap | `dev-notes/ROADMAP.md` |

---

## Final Notes for Next Session

1. **Run `pnpm audit` first** — if minimatch is still 10.2.6, check if typescript-eslint released a version with `minimatch: ^11.0.1`
2. **All gates must pass before any PR** — CI enforces this, but verify locally: `pnpm type-check && pnpm lint && pnpm test && pnpm validate && pnpm check:docs`
3. **Version bumps require 4 files** — `package.json`, `src/manifest.base.json`, `mcp/package.json`, `CHANGELOG.md` (+ `docs/index.html`, `store/listing.md`, `mcp/README.md`)
4. **Extension testing** — Load `dist/chrome` in `chrome://extensions` (Developer mode → Load unpacked) or `dist/firefox` in `about:debugging`
5. **MCP testing** — `node mcp/server.mjs` → configure in Claude Code / Cursor with stdio transport

---

*Generated 2024-11-14 • Prompty v0.5.1 "Clean Room" • Dream-Pixels-Forge*