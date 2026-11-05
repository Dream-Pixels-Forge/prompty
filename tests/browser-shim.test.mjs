import { afterEach, describe, expect, it } from 'vitest';

describe('lib/browser.js shim', () => {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.browser = originalBrowser;
    globalThis.chrome = originalChrome;
  });

  it('prefers globalThis.browser when present', async () => {
    globalThis.browser = { storage: { local: 'FX' } };
    globalThis.chrome = { storage: { local: 'CR' } };
    const mod = await import(`../src/lib/browser.js?prefers-browser`);
    expect(mod.default).toEqual({ storage: { local: 'FX' } });
  });

  it('falls back to globalThis.chrome (MV3) when browser is absent', async () => {
    delete globalThis.browser;
    globalThis.chrome = { storage: { local: 'CR' } };
    const mod = await import(`../src/lib/browser.js?falls-back-chrome`);
    expect(mod.default).toEqual({ storage: { local: 'CR' } });
  });

  it('exposes undefined cleanly when neither global exists', async () => {
    delete globalThis.browser;
    delete globalThis.chrome;
    const mod = await import(`../src/lib/browser.js?neither`);
    expect(mod.default).toBeUndefined();
  });
});
