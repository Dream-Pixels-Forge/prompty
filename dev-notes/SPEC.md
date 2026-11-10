# SPEC.md — Prompty (distilled behavior spec + deltas)

Basis: REA analysis `ev_84b4661a…` of Higgsfield Prompt Saver v1.0.0 (MIT) + full source read
(subagent session `ses_e568a18b4ffeWLRxFL8D5M3bw2`). Attribution: original © JohnLaibach, MIT.

## 1. What we keep from the original (behavior contract)

| Area | Contract |
|---|---|
| Storage | `storage.local` keys: `prompts[]`, `categories[]`, `settings{}`; prompt fields: `id,title,text,createdAt,useCount,isFavorite,categoryId,tags[],aspectRatio,quality,lastUsedAt`; category fields: `id,name,color,icon,order`; settings defaults `{defaultView:"all",sortBy:"recent",compactMode:false,autoUnlimited:false}` |
| Insert mechanics | Native prototype value setter + `input`,`change` bubbled events (React-proof). For selects: native setter + `change`. Contenteditable: textContent/DOM approach with `input` event. |
| Template variables | Regex `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g`, unique-in-order dedupe, fill-in modal with preview pills; all values required; unresolved tokens stay literal |
| Popup | 780×580; sidebar (All/Favorites/Recently/Settings + categories CRUD with 18-color × 36-emoji pickers (24 original + 12 film-craft)); grid cards (favorite star, 2-line preview, category dot, `⚡ N vars` badge, 2 tag chips, useCount, relative date); search (title/text/tags, Ctrl/⌘K focus); sorts `recent/created/name/mostUsed`; compact mode; live sync via `storage.onChanged` |
| Cards actions | Insert / Append (join `", "`) / Edit / Delete + favorite star toggle |
| Export/Import | JSON `{version,exportedAt,prompts,categories,settings}`; import = REPLACE (OK) or MERGE by id (Cancel) |
| Seeded data | v2: 8 generic presets + 6 categories. v3 cinematic pack: +10 categories (Camera Movement, Lighting, Lens & Optics, Locations, Color Grading, Composition, Mood & Atmosphere, VFX & Transitions, Posters, Logos) and 44 prompts. Upgrades add only what a newer seed version introduced. |
| Toasts | Bottom-right page toast; popup toasts for errors/success |
| Quirks fixed | no `window.prompt()` for titles (styled modal listeners instead); crypto-based `crypto.randomUUID()`; message handlers always respond (no hanging channel); failure toasts get ✗ icon; no dead dropdown CSS |

## 2. Deltas — what "global + copy/paste" adds (Δ = new feature)

| Δ ID | Feature | Contract |
|---|---|---|
| Δ1 Dual-manifest | `scripts/build.mjs` emits `dist/manifest.firefox.json` (`background.scripts[]` event page) and `dist/manifest.chrome.json` (`background.service_worker`); shared `src/lib/*` ES modules; single content script (IIFE, no imports) works on both | `pnpm build` outputs both dists; `web-ext lint` and `chromium --load-extension` both succeed |
| Δ2 Smart Assist | Content script on `<all_urls>`. Focused editable (textarea / `[contenteditable]`/input) gets a small floating pill (⌕ library + ⤒ save) anchored to it via cached positions; debounced (400ms) collapse; `esc` closes. Shadow DOM host to avoid style bleed. Per-site toggle stored in `settings.disabledSites[]`, one-click "disable on this site" in pill menu. Never alters the site's DOM beyond our own shadow container. | Works in any page with an editable, including SPAs; zero false-positive site breakage account (CSS only inside shadow root) |
| Δ3 Floating widget | Draggable floating bubble (persists per-origin position in `storage`), expands to mini-library with search; settings toggle `showFloatingWidget` (default ON, per-site-off honored). Keyboard shortcut (see Δ6) toggles it. | Draggable, saved position, SPA route changes tolerated |
| Δ4 Toolbar + shortcuts | `commands` API: `open-library` (Alt+P) opens popup; `save-selection` (Alt+Shift+S); `toggle-widget` (Alt+Shift+W). Open-popup fallback toast identical to original background. | Shortcuts registered in manifest, work in both browsers where supported |
| Δ5 Clipboard pack | (a) `⧉ Copy` card action → `navigator.clipboard.writeText` with fallback `execCommand('copy')` in popup context; (b) context-menu "Save Selection as Prompt" (title = document title, text = selection) auto-updates `useCount` untouched; (c) **Clipboard snippets**: popup tab where every user-triggered copy lands (`snippets[]` in storage, cap 50, FIFO, each `{id,text,sourceOrigin,emoji tag?}`); snippets searchable, copyable, promotable to a prompt; (d) paste-from-library: click snippet → writes text to active tab's focused editable via Δ7 messages. | All four actions verified in both browsers; no paste on sites that block synthetic focus (documented limitation) |
| Δ6 Background | Event page (FF) / service worker (CR): context-menu registration, command routing, `OPEN_POPUP` → `action.openPopup()` + toast fallback; badge count of unread snippets? (optional, OFF by default) | Both background variants share logic via `src/lib/` |
| Δ7 Insert targeted messages | Popup → tab: `{type:"PROMPTY_INSERT", text, mode:"insert"\|"append", origin?}`; content script responds `{success|error}` always (`error:"No editable target found"` when absent). Target = focused editable else smart-assist detected editable. | Unknown message types respond `{success:false,error:"unknown type"}` (fixes original bug #11) |

## 3. Non-goals

No sync, no servers, no telemetry, no permissions beyond `storage`, `tabs`, `activeTab`,
`contextMenus`, `scripting`, `notifications` and `<all_urls>` content script (why: global smart
assist + context menu save require broad host access; permission justification popup in store
listing phase).

## 4. Architecture

```
src/
├── background.js            # context menus, commands, openPopup routing (classic script shims ES via bundling? NO — keep ES module type)
├── content/assist.js        # IIFE shadow-DOM pill + widget + message handlers (no imports; standalone)
├── lib/ (ES modules, pure/JSDoc) storage.js, variables.js, sites.js, text.js, message.js
└── popup/ index.html, popup.css, popup.js
tests/ (vitest, unit: storage schema, variables, sites matching, text join)
scripts/build.mjs + .github/workflows/pr-validation.yml
```
