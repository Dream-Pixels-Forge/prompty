// Drives a real `vitest list` run; covered structurally, not mocked.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts/check-page-claims.mjs');
const PAGE = path.join(ROOT, 'docs/index.html');
const ORIGINAL_PAGE = readFileSync(PAGE, 'utf8');

/**
 * Run the check script, returning its stderr.
 * @returns {{ ok: boolean, stderr: string }}
 */
function runCheck() {
  const res = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60_000 });
  return { ok: res.status === 0, stderr: res.stderr ?? '' };
}

/**
 * @param {string} content
 * @returns {void}
 */
function swapPage(content) {
  writeFileSync(PAGE, content);
}

/** @returns {void} */
function restorePage() {
  writeFileSync(PAGE, ORIGINAL_PAGE);
}

describe('check-page-claims gate', () => {
  it('passes on the current page and suite', () => {
    const { ok, stderr } = runCheck();
    expect(ok).toBe(true);
    expect(stderr).toContain('tests in');
    expect(stderr).toContain('files');
  }, 30_000);

  it('catches a stale hero count (off by one)', () => {
    const stale = ORIGINAL_PAGE.replace('660 tests passing', '659 tests passing');
    expect(stale).not.toBe(ORIGINAL_PAGE);
    swapPage(stale);
    try {
      const { ok, stderr } = runCheck();
      expect(ok).toBe(false);
      expect(stderr).toContain('659');
      expect(stderr).toContain('hero');
    } finally {
      restorePage();
    }
  }, 30_000);

  it('catches a stale stats-strip test count', () => {
    const stale = ORIGINAL_PAGE.replace(
      '<b>660</b><span>tests passing · 46 files</span>',
      '<b>500</b><span>tests passing · 46 files</span>',
    );
    expect(stale).not.toBe(ORIGINAL_PAGE);
    swapPage(stale);
    try {
      const { ok, stderr } = runCheck();
      expect(ok).toBe(false);
      expect(stderr).toContain('500');
      expect(stderr).toContain('stats strip');
    } finally {
      restorePage();
    }
  }, 30_000);

  it('catches a stale file count', () => {
    const stale = ORIGINAL_PAGE.replace('tests passing · 46 files', 'tests passing · 12 files');
    expect(stale).not.toBe(ORIGINAL_PAGE);
    swapPage(stale);
    try {
      const { ok, stderr } = runCheck();
      expect(ok).toBe(false);
      expect(stderr).toContain('12');
    } finally {
      restorePage();
    }
  }, 30_000);

  it('reports a changed-markup error when the claim disappears', () => {
    const broken = ORIGINAL_PAGE.replace(
      /<span><i class="dot"><\/i> 660 tests passing<\/span>/,
      '',
    );
    expect(broken).not.toBe(ORIGINAL_PAGE);
    swapPage(broken);
    try {
      const { ok, stderr } = runCheck();
      expect(ok).toBe(false);
      expect(stderr).toContain('hero');
      expect(stderr).toContain('no match');
    } finally {
      restorePage();
      const restored = runCheck();
      expect(restored.ok).toBe(true);
    }
  }, 30_000);
});
