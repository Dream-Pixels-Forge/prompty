## Goal: S3 — A toolbar glyph that reads at 16 and 32 px

> **Status: done.** Notes from the PR:
>
> - Playwright is not a project dependency, so `scripts/icons.mjs` is a local dev tool and the PNGs
>   are committed. Byte-identical regeneration was checked locally (sha1), not in CI.
> - `tests/icons.test.mjs` decodes the PNGs (sizes, transparent corners, key glyph pixels), checks
>   the manifest maps and the glyph's colors/contrast.

### Objective

Ship pixel-aligned 16 px and 32 px icons drawn as a simplified glyph of the mascot (dark rounded
screen + white bezel + orange cursor) so the toolbar icon is recognizable at a glance; keep the full
mascot at 48 and 128 px.

### Context

`src/icons/icon-16.png` and `icon-32.png` are downscales of the 1920 px mascot render. At 16 px the
body, eyes and cursor collapse into a white blob on black, and on a dark browser toolbar the black
rounded square nearly disappears. Toolbar size is where the icon is seen most.

### Deliverables

- [x] `src/icons/glyph.svg` — source glyph on a 16-unit grid: rounded screen silhouette, two eye dots,
      orange `#FF6A00` cursor at top-right; strokes on whole pixels.
- [x] `scripts/icons.mjs` — rasterizes `glyph.svg` to `icon-16.png` / `icon-32.png` with headless
      Chromium (already available to tests) — reproducible, no new dependency.
- [x] Optional designer override: if `src/icons/icon-16.override.png` exists, it wins (lets the
      brand team hand-tune pixels).
- [x] `action.default_icon` keeps 16/32 glyph + 48/128 mascot (manifest already lists all four).

### Definition of Done

- [x] Preview sheet (light toolbar `#F1F3F4`, dark toolbar `#202124`, 1× and 2×) attached to the PR;
      glyph identifiable in all four.
- [x] Glyph-to-toolbar contrast ≥ 3:1 on both toolbars (outline/bezel provides the edge on dark).
- [x] Gates green; both linters accept the icons.

### Verification Steps

1. `node scripts/icons.mjs` regenerates identical PNGs (byte-compare in CI or a test).
2. Load the unpacked build in Chrome and Firefox, light and dark themes, pinned in the toolbar.

### Anti-Drift Rules

- Do not modify the 48/128 mascot or the brand colors.
- No icon fonts, no remote assets.

### Estimated Effort

S (a few hours; design iteration is the long pole — accept a designer-supplied PNG instead)
