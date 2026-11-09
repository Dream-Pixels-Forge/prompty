/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Prompty background — context menus, command routing, message handlers.
 */
import browser from './lib/browser.js';
import { seedPresets } from './lib/presets.js';
import { mergeSettings, DEFAULT_SETTINGS } from './lib/storage.js';
import {
  MSG_OPEN_POPUP,
  MSG_SAVE_SELECTION,
  MSG_SHOW_TOAST,
  MSG_TOGGLE_WIDGET,
} from './lib/message.js';

/* ------------------------------------------------------------------ */
/* Context menu                                                        */
/* ------------------------------------------------------------------ */

const CONTEXT_MENU_ID = 'prompty-save-selection';

/** Create the "Save Selection as Prompt" context menu on install/update. */
async function ensureContextMenu() {
  try {
    await browser.contextMenus.removeAll();
  } catch {
    // ignore if no menus exist
  }
  browser.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Prompty: Save Selection as Prompt',
    contexts: ['selection'],
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Get the active tab in the current window. */
async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/** Send a message to a tab and return the response (or null on error). */
async function sendToTab(tabId, message) {
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

/** Show a toast on a tab via content script's SHOW_TOAST handler. */
async function showToastOnTab(tabId, message, isError = false) {
  await sendToTab(tabId, { type: MSG_SHOW_TOAST, message, isError });
}

/* ------------------------------------------------------------------ */
/* Message routing                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {unknown} message
 * @param {{ id?: string }|undefined} sender
 * @param {(response: unknown) => void} sendResponse
 * @returns {boolean} true = async response
 */
function onMessage(message, sender, sendResponse) {
  /** @type {(response: unknown) => void} */
  const respond = (response) => {
    try {
      sendResponse(response);
    } catch {
      // channel closed
    }
  };

  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    respond({ success: false, error: 'unknown type' });
    return true;
  }

  switch (message.type) {
    case MSG_OPEN_POPUP: {
      // Content script asks background to open the popup (content scripts can't)
      void (async () => {
        try {
          await browser.action.openPopup();
        } catch {
          // Fallback: content script will show toast via its own SHOW_TOAST
          const tab = await getActiveTab();
          if (tab?.id) {
            await showToastOnTab(tab.id, 'Click the toolbar icon to open Prompty', true);
          }
        }
        respond({ success: true });
      })();
      return true;
    }

    case MSG_SAVE_SELECTION: {
      // Context menu / command: save current selection as prompt
      void (async () => {
        const tab = await getActiveTab();
        if (!tab?.id) {
          respond({ success: false, error: 'no active tab' });
          return;
        }
        const response = await sendToTab(tab.id, { type: MSG_SAVE_SELECTION });
        if (response?.success && response.text) {
          // Also append to clipboard snippets history (Δ5c) — best effort
          try {
            const store = browser.storage.local;
            const data = await store.get(['snippets']);
            const history = Array.isArray(data.snippets) ? data.snippets : [];
            const text = String(response.text).trim();
            if (text) {
              const mostRecent = history[history.length - 1];
              if (!mostRecent || mostRecent.text !== text) {
                const next = [
                  ...history,
                  {
                    id: crypto.randomUUID?.() ?? Date.now().toString(36),
                    text,
                    sourceOrigin: response.origin || new URL(tab.url ?? '').origin,
                  },
                ];
                if (next.length > 50) next.splice(0, next.length - 50);
                await store.set({ snippets: next });
              }
            }
          } catch {
            // non-fatal
          }
          respond({ success: true, text: response.text });
        } else {
          respond({ success: false, error: response?.error || 'selection capture failed' });
        }
      })();
      return true;
    }

    case MSG_TOGGLE_WIDGET: {
      // Toggle floating widget for the active tab's origin
      void (async () => {
        const tab = await getActiveTab();
        if (!tab?.id) {
          respond({ success: false, error: 'no active tab' });
          return;
        }
        const origin = new URL(tab.url ?? '').origin;
        const store = browser.storage.local;
        const data = await store.get(['settings']);
        const current = mergeSettings(DEFAULT_SETTINGS, data?.settings);
        const nextDisabled = current.disabledSites.includes(origin)
          ? current.disabledSites.filter((s) => s !== origin)
          : [...current.disabledSites, origin];
        await store.set({ settings: { ...current, disabledSites: nextDisabled } });
        await sendToTab(tab.id, { type: MSG_TOGGLE_WIDGET });
        respond({ success: true });
      })();
      return true;
    }

    default:
      // SECURITY.md: always respond, never leave channel open
      respond({ success: false, error: 'unknown type' });
      return true;
  }
}

/* ------------------------------------------------------------------ */
/* Commands (Alt+P, Alt+Shift+S, Alt+Shift+W)                         */
/* ------------------------------------------------------------------ */

async function onCommand(command) {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  switch (command) {
    case 'open-library':
      try {
        await browser.action.openPopup();
      } catch {
        await showToastOnTab(tab.id, 'Click the toolbar icon to open Prompty', true);
      }
      break;
    case 'save-selection':
      await sendToTab(tab.id, { type: MSG_SAVE_SELECTION });
      break;
    case 'toggle-widget':
      await sendToTab(tab.id, { type: MSG_TOGGLE_WIDGET });
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Install / startup                                                   */
/* ------------------------------------------------------------------ */

browser.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
});

browser.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
});

/* ------------------------------------------------------------------ */
/* Listeners                                                           */
/* ------------------------------------------------------------------ */

// Seed the 8 starter prompts whenever the background starts. Idempotent
// (no-op once seeded; repairs v1→v2), so it is safe on every wake-up and does
// not depend on onInstalled firing.
void seedPresets().catch(() => {});

browser.runtime.onMessage.addListener(onMessage);
browser.commands.onCommand.addListener(onCommand);

// Log ready
console.log('[Prompty] Background service worker / event page ready');
