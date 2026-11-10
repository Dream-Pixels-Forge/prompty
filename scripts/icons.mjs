/**
 * S3 — rasterize src/icons/glyph.svg to the toolbar sizes (16 and 32 px).
 *
 *   node scripts/icons.mjs
 *
 * Uses Playwright's Chromium when it is installed (not a project dependency:
 * the PNGs are committed, so builds and CI never need it). A designer can
 * hand-tune pixels by adding src/icons/icon-16.override.png or
 * icon-32.override.png — an override always wins over the rendered glyph.
 * The 48/128 px mascot icons are never touched.
 */
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ICONS = path.join(ROOT, 'src', 'icons');
const SIZES = [16, 32];

/** @param {string} file */
async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** @type {any} */
let chromium;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch {
  process.stderr.write(
    'icons: Playwright is not installed. Install it locally (npm i -g playwright) or add\n' +
      'src/icons/icon-<size>.override.png files. The committed PNGs are unchanged.\n',
  );
  process.exit(1);
}

const svg = await readFile(path.join(ICONS, 'glyph.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const out = path.join(ICONS, `icon-${size}.png`);
    const override = path.join(ICONS, `icon-${size}.override.png`);
    if (await exists(override)) {
      await copyFile(override, out);
      process.stderr.write(`icons: ${path.relative(ROOT, out)} ← designer override\n`);
      continue;
    }
    // Render at the target size so the browser rasterizes on the real pixel grid.
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const sized = svg.replace('width="16" height="16"', `width="${size}" height="${size}"`);
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`,
    );
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await writeFile(out, png);
    await page.close();
    process.stderr.write(`icons: ${path.relative(ROOT, out)} rendered from glyph.svg\n`);
  }
} finally {
  await browser.close();
}
