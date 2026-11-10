## Goal: S2 — In-page UI in the Dream Pixels Forge brand

> **Status: done.** Decisions taken in the PR:
>
> - Tokens are CSS custom properties (`--pf-*`) in a `THEME_CSS` sheet inside the shadow root
>   instead of a JS `THEME` object + `matchMedia` listener: light/dark switches with zero JS, and
>   `all: initial` on the host does not reset custom properties.
> - The bubble mascot is **inline SVG built with `createElementNS`**, not `<img>` +
>   `web_accessible_resources`: page CSP `img-src` can't block it and no extension file is exposed
>   for sites to fingerprint.

### Objective

The smart-assist pill, floating widget, `!` quick-insert palette, variable mini-form and page
toasts use the same black/white + orange (`#FF6A00`) system as the popup, follow the page's light/dark
preference, and the widget bubble shows the mascot instead of a generic glyph.

### Context

The popup was rebranded in #15, but everything Prompty draws _on websites_ still uses the old
purple theme: `src/content/assist.js` styles its shadow-DOM UI from a hard-coded `STYLES` object
(≈ line 608) with `#8b5cf6` accents and `#f0f0f8`-on-dark glass. That is the surface users see most
(ChatGPT, Claude, Higgsfield…), so the brand is inconsistent exactly where it matters.
The content script is a standalone IIFE with no imports, so tokens must be duplicated there.

### Deliverables

- [x] A `THEME` token block at the top of `assist.js` mirroring `popup.css`
      (`accent #FF6A00`, `accentHover`, `accentInk #0E0E10`, `accentText` light `#B84C00` / dark `#FF8A33`,
      neutrals, `invertBg/invertFg`), with light + dark variants chosen by
      `matchMedia('(prefers-color-scheme: dark)')` and updated on change.
- [x] Every color in `STYLES` replaced by a token; zero hex literals left outside `THEME`.
- [x] Brand details: orange primary buttons with dark text; orange selection bar in the `!` palette
      (same as the popup palette); toasts inverted with an orange edge; orange focus rings.
- [x] Widget bubble shows the mascot (`icons/icon-48.png` via `runtime.getURL`, listed in
      `web_accessible_resources` for both builds) — or an inline SVG mark if WAR exposure is rejected
      in review; decide in the PR and document why.
- [x] Parity test `tests/theme-parity.test.mjs`: parses `popup.css` `:root` tokens and the
      `assist.js` `THEME` block and asserts the shared values are identical.

### Definition of Done

- [x] No `#8b5cf6` / purple values remain in `src/content/` (grep-checked in the parity test).
- [x] Text contrast ≥ 4.5:1 and UI marks ≥ 3:1 in both themes (contrast assertions in the test).
- [x] No style leaks: host page CSS unchanged (shadow DOM only), page cannot restyle our UI.
- [x] Gates green; Firefox lint 0/0/0; `web_accessible_resources` passes both linters.

### Verification Steps

1. `pnpm test` — theme parity + contrast.
2. Headless Chromium on a light and a dark test page with a `<textarea>`: screenshot pill, opened
   widget, `!` palette with a match highlighted, variable mini-form, success + error toast.
3. Manual on two real sites (one light, one dark UI) in Chrome and Firefox.

### Anti-Drift Rules

- Visual change only: no behavior, positioning, keyboard or message changes.
- Do not import popup CSS into the page or share a stylesheet file — the content script stays standalone.
- Category colors chosen by users stay as they are.

### Estimated Effort

M (one session; mostly the `STYLES` refactor + screenshots)
