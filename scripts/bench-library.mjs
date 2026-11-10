/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Playwright driver; the measured code runs inside the extension page.
/**
 * G12 — library performance benchmark. Seeds N prompts into the built
 * extension (dist/chrome), then reports, over 3 popup opens: time to first
 * card, raw storage read, cards in the DOM, search, star toggle and Ctrl+K.
 *
 *   pnpm build && node scripts/bench-library.mjs [count=5000]
 *
 * Use it before changing the storage engine: storage read vs. first card
 * tells whether storage or rendering is the bottleneck. Needs Playwright.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch {
  process.stderr.write('bench-library: Playwright is not installed (npm i -g playwright).\n');
  process.exit(1);
}
const ext = path.join(ROOT, 'dist/chrome');
const N = Number(process.argv[2] ?? 5000);
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 780, height: 580 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const url = `chrome-extension://${new URL(sw.url()).host}/popup/index.html`;
const page = await ctx.newPage();
await page.goto(url);
await page.waitForSelector('.card');
const bytes = await page.evaluate(async (n) => {
  const { prompts, categories } = await chrome.storage.local.get(['prompts', 'categories']);
  const out = [...prompts];
  const words =
    'neon rain cinematic dolly anamorphic golden hour macro wide portrait fog city desert ocean night dawn crane orbit'.split(
      ' ',
    );
  for (let i = out.length; i < n; i++) {
    const w = (k) => words[(i * 7 + k * 13) % words.length];
    out.push({
      id: `bench-${i}`,
      title: `${w(1)} ${w(2)} shot ${i}`,
      text: `A ${w(3)} ${w(4)} shot of {subject} in ${w(5)} ${w(6)}, ${w(7)} light, ${w(8)} lens, detailed, ${w(9)} mood, ${i}`,
      createdAt: Date.now() - i * 60000,
      useCount: i % 17,
      isFavorite: i % 23 === 0,
      categoryId: categories[i % categories.length].id,
      tags: [w(10), w(11)],
      aspectRatio: null,
      quality: null,
      lastUsedAt: i % 3 ? Date.now() - i * 1000 : null,
    });
  }
  await chrome.storage.local.set({ prompts: out });
  return JSON.stringify(out).length;
}, N);
console.log(`library: ${N} prompts, ${(bytes / 1024 / 1024).toFixed(2)} MB JSON`);
const runs = [];
for (let r = 0; r < 3; r++) {
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    window.__t0 = performance.now();
  });
  await p2.goto(url);
  await p2.waitForSelector('.card');
  const m = await p2.evaluate(async () => {
    const firstCard = performance.now() - window.__t0;
    const t1 = performance.now();
    await chrome.storage.local.get(['prompts']);
    const read = performance.now() - t1;
    return {
      firstCard,
      read,
      cards: document.querySelectorAll('.card').length,
      nav: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd,
    };
  });
  // interaction: type in search, then toggle a favorite (save path)
  const s0 = Date.now();
  await p2.locator('#search').fill('neon rain');
  await p2.waitForTimeout(50);
  const search = Date.now() - s0;
  await p2.locator('#search').fill('');
  await p2.locator('#search').dispatchEvent('input');
  const f0 = Date.now();
  await p2.locator('.card .star').first().click();
  await p2.waitForFunction(() => document.querySelector('.card .star')?.textContent);
  const fav = Date.now() - f0;
  await p2.keyboard.press('Escape');
  await p2.keyboard.press('Control+k');
  await p2.waitForSelector('.palette');
  const k0 = Date.now();
  await p2.keyboard.type('neon', { delay: 0 });
  await p2.waitForTimeout(30);
  const palette = Date.now() - k0;
  runs.push({ ...m, search, fav, palette });
  await p2.close();
}
for (const r of runs)
  console.log(
    `firstCard ${r.firstCard.toFixed(0)} ms · storage read ${r.read.toFixed(0)} ms · cards in DOM ${r.cards} · search ${r.search} ms · favorite ${r.fav} ms · palette 4 keys ${r.palette} ms`,
  );
await ctx.close();
