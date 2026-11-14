# Docs

Landing page for Prompty: [index.html](index.html) — published at
<https://dream-pixels-forge.github.io/prompty/> via `.github/workflows/pages-deploy.yml`.

Single self-contained HTML file (inline CSS + a small scroll-reveal script),
dark brand theme, no build step and no external requests.

## Assets

`assets/` holds the copies the page needs so the published site is
self-contained (GitHub Pages serves `docs/` only):

| File | Use |
|------|-----|
| `icon-192.png` | favicon, apple-touch-icon, nav mark |
| `og.jpg` | Open Graph / Twitter card (1200×630) |
| `brand-palette-dark.png` | hero product shot |
| `brand-library-dark.png` | library bento tile |
| `brand-editor-light.png` | editor bento tile |
| `brand-palette-light.png` | command-palette bento tile |

The full-resolution originals live in the repo root `assets/`; these are
resized copies. To refresh a screenshot, regenerate the root asset and copy it
over here.

## Local preview

Open `index.html` directly, or serve the folder so relative paths behave like
production:

```sh
cd docs && python3 -m http.server 8790
```
