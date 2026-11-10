/**
 * Package the built extension into installable archives:
 *   dist/prompty-<version>-chrome.zip   (Chrome Web Store / "Load unpacked" source)
 *   dist/prompty-<version>-firefox.xpi  (Firefox AMO upload / about:debugging)
 *
 * Run `pnpm build` first (or use `pnpm package`, which builds then packages).
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectEntries, createZip } from './zip.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/** @type {{ dir: 'chrome'|'firefox', ext: string }[]} */
const targets = [
  { dir: 'chrome', ext: 'zip' },
  { dir: 'firefox', ext: 'xpi' },
];

for (const { dir, ext } of targets) {
  const srcDir = path.join(DIST, dir);
  try {
    await stat(path.join(srcDir, 'manifest.json'));
  } catch {
    process.stderr.write(`dist/${dir} missing — run \`pnpm build\` first\n`);
    process.exit(1);
  }
  /** @type {{ version: string }} */
  const manifest = JSON.parse(await readFile(path.join(srcDir, 'manifest.json'), 'utf8'));
  const outFile = path.join(DIST, `prompty-${manifest.version}-${dir}.${ext}`);
  const entries = await collectEntries(srcDir);
  await writeFile(outFile, createZip(entries));
  process.stderr.write(`packaged ${path.relative(ROOT, outFile)} (${entries.length} files)\n`);
}
