// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Version of the MCP package, read from its own package.json so `npm version`
 * and the release checklist stay in one place.
 */
import { readFileSync } from 'node:fs';

/** @type {string} */
let version = '0.0.0';
try {
  const parsed = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version)) {
    version = parsed.version;
  }
} catch {
  // A missing package.json (copied single file) still yields a valid version.
}

export const VERSION = version;
