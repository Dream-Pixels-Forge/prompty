/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Playwright driver; most of it runs inside the extension page (chrome.*), which tsc cannot type here.
/**
 * Store screenshots: drives the built extension (dist/chrome) through five
 * states, then lays each capture onto a 1280×800 slide (Chrome Web Store /
 * AMO size) plus a 440×280 promo tile. Output: store/.
 *
 *   pnpm build && node scripts/store-screenshots.mjs
 *
 * Needs Playwright with a Chromium build (like scripts/icons.mjs). The popup
 * runs as a tab here, so `tabs.query` is stubbed to report a site URL —
 * that is what lets the Composer show its per-site dialect suggestion.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(ROOT, 'dist/chrome');
const outDir = path.join(ROOT, 'store');
const raw = mkdtempSync(path.join(tmpdir(), 'prompty-store-'));
const dir = raw;
copyFileSync(path.join(ROOT, 'src/icons/icon-128.png'), path.join(raw, 'icon.png'));

/** @type {any} */
let chromium;
try {
  chromium = createRequire(import.meta.url)('playwright').chromium;
} catch {
  process.stderr.write('store-screenshots: Playwright is not installed (npm i -g playwright).\n');
  process.exit(1);
}

/* ---------------------------- 1. capture ---------------------------- */
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 780, height: 580 },
  deviceScaleFactor: 2,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
let fakeUrl = 'https://dreamina.capcut.com/ai-tool/video/generate';
await page.exposeFunction('__fakeTabUrl', () => fakeUrl);
await page.addInitScript(() => {
  const q = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (info) =>
    (await q(info)).length ? [{ id: 999999, url: await window.__fakeTabUrl() }] : [];
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const open = async () => {
  await page.goto(`chrome-extension://${id}/popup/index.html`);
  await page.waitForSelector('.card');
  await page.waitForTimeout(300);
};
const clearToasts = () =>
  page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
const shot = async (name, dark = false) => {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await clearToasts();
  await page.mouse.move(0, 579);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${raw}/${name}.png` });
};

// 1 · Library (light): star a few, use a few, so the grid looks lived-in
await open();
for (const t of ['Slow Push-In Reveal', 'Neon Noir', 'Anamorphic Widescreen']) {
  await page
    .locator('.card', { hasText: t })
    .first()
    .locator('.star')
    .click()
    .catch(() => {});
}
await page.evaluate(async () => {
  const { prompts } = await chrome.storage.local.get('prompts');
  const now = Date.now();
  const used = {
    'Full-Body Character Portrait': 14,
    'Character Design Sheet': 6,
    'Wide Scenic Landscape': 9,
    'Minimalistic Landscape': 3,
  };
  for (const p of prompts)
    if (used[p.title]) {
      p.useCount = used[p.title];
      p.lastUsedAt = now - used[p.title] * 3600e3;
    }
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    prompts,
    popupSeenAt: now,
    settings: { ...settings, sortBy: 'mostUsed' },
  });
});
await open();
await shot('1-library');

// 2 · Compose: three-beat reveal, Seedance (dark)
await page.locator('.nav__item', { hasText: 'Compose' }).click();
await page.locator('.choice--seq').click();
await page.locator('.compose__format').selectOption('seedance');
await page.locator('.shots__tab').nth(1).click();
await page.locator('.view').evaluate((v) => (v.scrollTop = 0));
await shot('2-sequence', true);

// 3 · Muse dialect with a check (light), on meta.ai — a tight hand-written scene
fakeUrl = 'https://www.meta.ai/';
await open();
await page.locator('.nav__item', { hasText: 'Compose' }).click();
await page.getByRole('button', { name: 'Clear' }).click();
const writeShot = async (text, dur) => {
  await page.locator('.compose__text').first().fill(text);
  await page.locator('.shot-controls__num').fill(String(dur));
  await page.locator('.shot-controls__num').dispatchEvent('change');
};
await writeShot(
  "extreme macro on a raindrop trembling on {hero}'s eyelash, city neon refracted inside it",
  4,
);
await page.locator('.shots__add').click();
await writeShot(
  '{hero} under a round flickering neon sign, rain-soaked night market, slow push-in, anamorphic',
  3,
);
await page.locator('.shots__add').click();
await writeShot(
  '{hero}, tiny and utterly still, alone at the edge of a golden salt flat, crane up',
  5,
);
await page.waitForSelector('.compose__suggest');
await page.locator('.compose__suggest').click();
await page.locator('.shots__tab').nth(0).click();
await page.locator('.shot-controls select').selectOption('match');
await page.locator('.shots__tab').nth(1).click();
await page.locator('.shot-controls select').selectOption('whip');
await page.locator('.shots__tab').nth(0).click();
await shot('3-muse');

// 4 · Variables fill-in (dark)
fakeUrl = 'https://dreamina.capcut.com/ai-tool/video/generate';
await open();
await page.locator('#search').fill('Wide Scenic');
await page.locator('.card').first().getByRole('button', { name: 'Copy' }).click();
await page.waitForSelector('.modal');
await page.waitForTimeout(400);
const inputs = page.locator('.modal input[type=text]');
const n = await inputs.count();
const vals = ['a lone lighthouse on black volcanic cliffs', 'storm clouds breaking'];
for (let i = 0; i < n; i++) await inputs.nth(i).fill(vals[i] ?? 'rain');
await page
  .locator('.modal .choice')
  .nth(1)
  .click()
  .catch(() => {});
await shot('4-variables', true);
await page.keyboard.press('Escape');

// 5 · Ctrl+K palette over a bulk selection (light)
await open();
await page.locator('.nav__item', { hasText: 'Lighting' }).click();
const cards = page.locator('.card');
await cards.nth(0).hover();
await cards.nth(0).locator('.card__check').click();
await cards
  .nth(2)
  .locator('.card__check')
  .click({ modifiers: ['Shift'] });
await shot('5a-bulk');
await page.keyboard.press('Escape');
await page.locator('#search').click();
await page.keyboard.press('Control+k');
await page.waitForSelector('.palette');
await page.keyboard.type('neon');
await page.waitForTimeout(200);
await shot('5-palette');

await ctx.close();
if (errors.length) {
  process.stderr.write(`store-screenshots: page errors:\n${errors.join('\n')}\n`);
  process.exit(1);
}

/* ---------------------------- 2. slides ----------------------------- */
const slides = [
  {
    raw: '1-library',
    n: '01',
    head: 'Your prompts, one keystroke from any text box.',
    sub: 'Save, search and insert prompts on ChatGPT, Claude, Gemini, Higgsfield or any site. 52 cinematic starters in 16 categories. Nothing leaves your browser.',
  },
  {
    raw: '2-sequence',
    n: '02',
    head: 'Direct a scene, not a sentence.',
    sub: 'Stack film-grammar blocks into shots, then cut them together: match cuts, smash cuts, whip pans, timing for every shot.',
  },
  {
    raw: '3-muse',
    n: '03',
    head: 'Written the way the model reads it.',
    sub: 'Seedance 2.5 and Muse Video dialects, suggested for the site you are on, with checks before you spend a generation.',
  },
  {
    raw: '4-variables',
    n: '04',
    head: 'Prompts that become shot generators.',
    sub: 'Choices, ranges with a dice roll, defaults and memory. Fill once and watch the final prompt build live.',
  },
  {
    raw: '5-palette',
    n: '05',
    head: 'Everything is one keystroke away.',
    sub: 'Ctrl+K for prompts, snippets and commands. Bulk edits, version history, and undo for every delete.',
  },
];
const html = (s) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1280px; height: 800px; overflow: hidden; }
  body { background: #0e0e10; color: #f4f4f5; font-family: Inter, sans-serif; position: relative; }
  .glow { position: absolute; left: 520px; top: 60px; width: 900px; height: 700px;
    background: radial-gradient(closest-side, rgba(255,106,0,0.22), rgba(255,106,0,0) 70%); }
  .grain { position: absolute; inset: 0; background:
    repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 3px); }
  .text { position: absolute; left: 56px; top: 0; bottom: 0; width: 372px; display: flex;
    flex-direction: column; justify-content: center; gap: 22px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { width: 40px; height: 40px; border-radius: 9px; }
  .brand b { font-family: 'Inter Display', Inter; font-weight: 800; font-size: 19px; letter-spacing: -0.01em; }
  .brand span { display: block; font-size: 10.5px; letter-spacing: 0.16em; color: #8b8b93; font-weight: 600; }
  .n { font-family: 'JetBrains Mono', monospace; color: #FF8A33; font-size: 13px; letter-spacing: 0.2em; }
  h1 { font-family: 'Inter Display', Inter; font-weight: 800; font-size: 42px; line-height: 1.08;
    letter-spacing: -0.025em; }
  h1 em { font-style: normal; color: #FF6A00; }
  p { font-size: 16.5px; line-height: 1.55; color: #a6a6ae; }
  .foot { position: absolute; left: 56px; bottom: 34px; font-size: 12px; color: #6b6b73; letter-spacing: 0.04em; }
  .shot { position: absolute; left: 468px; top: 110px; width: 780px; height: 580px; }
  .shot img { width: 780px; height: 580px; border-radius: 10px; display: block;
    box-shadow: 0 30px 80px -20px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.08); }
  .c { position: absolute; width: 26px; height: 26px; border-color: #FF6A00; border-style: solid; }
  .tl { left: -14px; top: -14px; border-width: 2px 0 0 2px; }
  .tr { right: -14px; top: -14px; border-width: 2px 2px 0 0; }
  .bl { left: -14px; bottom: -14px; border-width: 0 0 2px 2px; }
  .br { right: -14px; bottom: -14px; border-width: 0 2px 2px 0; }
  .rec { position: absolute; right: 0; top: -40px; font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px; color: #8b8b93; letter-spacing: 0.14em; display: flex; align-items: center; gap: 8px; }
  .rec i { width: 8px; height: 8px; border-radius: 50%; background: #FF6A00; display: inline-block; }
</style></head><body>
  <div class="glow"></div><div class="grain"></div>
  <div class="text">
    <div class="brand"><img src="icon.png" alt=""><div><b>Prompty</b><span>DREAM PIXELS FORGE</span></div></div>
    <div class="n">${s.n} / 05</div>
    <h1>${s.head.replace(/([^ ]+)\.$/, '<em>$1</em>.')}</h1>
    <p>${s.sub}</p>
  </div>
  <div class="foot">Chrome · Edge · Brave · Firefox  —  100% local · no account · no telemetry</div>
  <div class="shot">
    <div class="rec"><i></i>SCENE ${s.n}</div>
    <img src="${s.raw}.png" alt="">
    <div class="c tl"></div><div class="c tr"></div><div class="c bl"></div><div class="c br"></div>
  </div>
</body></html>`;
const browser = await chromium.launch();
const slidePage = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
for (const s of slides) {
  const file = `${dir}/slide-${s.n}.html`;
  writeFileSync(file, html(s));
  await slidePage.goto(`file://${file}`);
  await slidePage.evaluate(() => document.fonts.ready);
  await slidePage.waitForTimeout(150);
  await slidePage.screenshot({ path: `${outDir}/screenshot-${s.n}.png` });
}
// small promo tile 440×280 (Chrome Web Store)
await slidePage.setViewportSize({ width: 440, height: 280 });
writeFileSync(
  `${dir}/tile.html`,
  `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box} html,body{width:440px;height:280px;overflow:hidden}
  body{background:#0e0e10;color:#f4f4f5;font-family:Inter,sans-serif;position:relative;display:flex;flex-direction:column;justify-content:center;padding:0 36px;gap:12px}
  .glow{position:absolute;right:-120px;top:-60px;width:420px;height:420px;background:radial-gradient(closest-side,rgba(255,106,0,.3),rgba(255,106,0,0) 70%)}
  img{width:56px;height:56px;border-radius:12px;position:relative}
  h1{font-family:'Inter Display',Inter;font-weight:800;font-size:30px;letter-spacing:-.02em;line-height:1.05;position:relative}
  h1 em{font-style:normal;color:#FF6A00}
  p{font-size:13.5px;color:#a6a6ae;position:relative}
</style></head><body><div class="glow"></div><img src="icon.png" alt=""><h1>Prompty<br>Direct the <em>prompt</em>.</h1><p>Prompt library + shot composer for AI video. 100% local.</p></body></html>`,
);
await slidePage.goto(`file://${dir}/tile.html`);
await slidePage.evaluate(() => document.fonts.ready);
await slidePage.screenshot({ path: `${outDir}/promo-tile-440x280.png` });
await browser.close();
process.stdout.write(`store-screenshots: wrote ${slides.length} slides + promo tile to store/\n`);
