/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Playwright driver; the audited code runs inside the extension page.
/**
 * Accessibility audit: runs axe-core (WCAG 2.0/2.1 A + AA + best practice)
 * on every popup view of the built extension (dist/chrome), in light or dark.
 *
 *   pnpm build && node scripts/a11y-audit.mjs [light|dark]
 *
 * Needs Playwright and axe-core resolvable from here (e.g. npm i -g
 * playwright axe-core). Exits 1 when any view has a violation.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(ROOT, 'dist/chrome');
const require = createRequire(import.meta.url);
let chromium;
let axe;
try {
  chromium = require('playwright').chromium;
  axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
} catch {
  process.stderr.write(
    'a11y-audit: needs playwright and axe-core (npm i -g playwright axe-core).\n',
  );
  process.exit(1);
}
let total = 0;
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 780, height: 580 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/popup/index.html`);
await page.waitForSelector('.card');
const scheme = process.argv[2] ?? 'light';
await page.emulateMedia({ colorScheme: scheme });
const run = async (label) => {
  await page.waitForTimeout(300);
  await page.evaluate(axe);
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
      },
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length,
      help: v.help,
      targets: v.nodes
        .slice(0, 4)
        .map(
          (x) =>
            x.target.join(' ') + (x.any[0]?.message ? ` — ${x.any[0].message.slice(0, 110)}` : ''),
        ),
    }));
  });
  console.log(`\n=== ${label} (${scheme}) — ${res.length} rule(s)`);
  total += res.length;
  for (const v of res) {
    console.log(`[${v.impact}] ${v.id} ×${v.n}: ${v.help}`);
    v.targets.forEach((t) => console.log('    ', t));
  }
};
const nav = (t) => page.locator('.nav__item', { hasText: t }).first().click();
await run('library');
await page.locator('.card').first().hover();
await page.locator('.card__check').first().click();
await run('bulk bar');
await page.keyboard.press('Escape');
await page.locator('.card').first().getByRole('button', { name: 'Copy' }).click();
await page.waitForSelector('.modal');
await run('fill-in modal');
await page.keyboard.press('Escape');
await page.locator('.card').first().getByRole('button', { name: /^Edit/ }).click();
await page.waitForSelector('.modal');
await run('prompt editor');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
await run('palette');
await page.keyboard.press('Escape');
await nav('Compose');
await page.locator('.choice--seq').click();
await run('compose');
await nav('Insights');
await run('insights');
await nav('Snippets');
await run('snippets');
await nav('Settings');
await run('settings');
await ctx.close();
process.exit(total > 0 ? 1 : 0);
