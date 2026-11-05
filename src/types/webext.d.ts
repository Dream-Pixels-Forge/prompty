/**
 * Minimal ambient declarations for the WebExtension globals (browser / chrome).
 * Hand-declared — no runtime dependencies policy — only what src/lib uses.
 */
/**
 * Minimal shape of a storage.local area.
 */
interface PromptyStorageArea {
  get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/**
 * Minimal shape of the WebExtension APIs we call
 * (`browser` in Firefox, `chrome` in Chromium MV3).
 */
interface PromptyBrowserApi {
  runtime?: {
    onMessage?: {
      addListener(callback: (msg: unknown) => unknown): void;
    };
  };
  storage?: {
    local: PromptyStorageArea;
  };
}

declare var browser: PromptyBrowserApi | undefined;
declare var chrome: PromptyBrowserApi | undefined;
