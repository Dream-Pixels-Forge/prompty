/**
 * Check that the landing page's test-suite claims match reality (issue #45).
 *
 * The page states the suite size in two places (hero + stats strip). Both
 * statements live in `CLAIMS` below. The check collects the test suite with
 * `vitest list --json` (collection only, nothing is executed, ~5s) and fails
 * when:
 *
 *   - a claim's regex does not match the page at all (markup changed),
 *   - a claim matches more than once with different values (inconsistent),
 *   - a claimed count differs from the collected count.
 *
 * Usage: `node scripts/check-page-claims.mjs` or `pnpm check:docs`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Regex patterns are built as strings so that HTML-like closing tags
// (`</span>`) do not confuse the JS parser.  Each entry: [where, regexSource].
const CLAIMS = [
  ['hero', '<span><i class="dot">' + '</' + 'i> (\\d+) tests passing</' + 'span>'],
  [
    'stats strip',
    '<div class="stat"><b>(\\d+)</' + 'b><span>tests passing · (\\d+) files</' + 'span></' + 'div>',
  ],
];

/**
 * Collect the suite with Vitest without executing anything.
 * @returns {{ tests: number, files: number }}
 */
function suiteSize() {
  const out = execFileSync('npx', ['vitest', 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const tests = /** @type {{ name: string; file: string }[]} */ (JSON.parse(out));
  return { tests: tests.length, files: new Set(tests.map((t) => t.file)).size };
}
const { tests: actual, files: actualFiles } = suiteSize();
const html = readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8');

/** @type {string[]} */
const errors = [];

for (const [where, source] of CLAIMS) {
  const regex = new RegExp(source, 'g');
  const matches = [...html.matchAll(regex)];

  if (matches.length === 0) {
    errors.push(
      `${where}: no match in docs/index.html — markup changed, update scripts/check-page-claims.mjs CLAIMS`,
    );
    continue;
  }

  const testCounts = [...new Set(matches.map((m) => m[1]))];
  if (testCounts.length > 1) {
    errors.push(
      `${where}: ${String(testCounts.length)} different test counts (${testCounts.join(', ')})`,
    );
  }
  if (testCounts[0] !== String(actual)) {
    errors.push(
      `${where}: claims ${testCounts[0]} tests, but the suite has ${String(actual)} — run \`pnpm check:docs\` after adding or removing tests`,
    );
  }

  if (source.includes('files')) {
    const fileCounts = [...new Set(matches.map((m) => m[2]))];
    if (fileCounts.length > 1) {
      errors.push(
        `${where}: ${String(fileCounts.length)} different file counts (${fileCounts.join(', ')})`,
      );
    }
    if (fileCounts[0] !== String(actualFiles)) {
      errors.push(
        `${where}: claims ${fileCounts[0]} files, but the suite has ${String(actualFiles)}`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`✗ docs claim: ${error}\n`);
  process.stderr.write(`\n${String(errors.length)} problem(s). Update docs/index.html to match.\n`);
  process.exit(1);
}

process.stderr.write(
  `✓ docs/index.html: ${String(actual)} tests in ${String(actualFiles)} files, ${String(CLAIMS.length)} claim(s) checked\n`,
);
