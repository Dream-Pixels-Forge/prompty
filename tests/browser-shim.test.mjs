import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('lib/browser.js shim', () => {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    // Re-evaluate the shim module for each test so the globals are read fresh.
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.browser = originalBrowser;
    globalThis.chrome = originalChrome;
  });

  it('prefers globalThis.browser when present', async () => {
    globalThis.browser = /** @type {any} */ ({ storage: { local: 'FX' } });
    globalThis.chrome = /** @type {any} */ ({ storage: { local: 'CR' } });
    const mod = await import('../src/lib/browser.js');
    expect(mod.default?.storage?.local).toBe('FX');
  });

  it('falls back to globalThis.chrome (MV3) when browser is absent', async () => {
    globalThis.browser = undefined;
    globalThis.chrome = /** @type {any} */ ({ storage: { local: 'CR' } });
    const mod = await import('../src/lib/browser.js');
    expect(mod.default?.storage?.local).toBe('CR');
  });

  it('exposes undefined cleanly when neither global exists', async () => {
    globalThis.browser = undefined;
    globalThis.chrome = undefined;
    const mod = await import('../src/lib/browser.js');
    expect(mod.default).toBeUndefined();
  });
});
