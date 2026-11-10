/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Prompty background — context menus, command routing, message handlers.
 */
import browser from './lib/browser.js';
import { seedPresets } from './lib/presets.js';
import { planSave } from './lib/capture.js';
import {
  appendSnippet,
  mergeSettings,
  DEFAULT_SETTINGS,
  readAll,
  writeAll,
} from './lib/storage.js';
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
/* Save selection as prompt (S1, SPEC Δ5b)                             */
/* ------------------------------------------------------------------ */

/**
 * Tell the user what happened: page toast when our content script is there,
 * otherwise a system notification (PDFs, browser pages, restricted sites).
 */
async function notify(tab, message, isError, reachable) {
  if (reachable && tab?.id !== undefined) {
    await showToastOnTab(tab.id, message, isError);
    return;
  }
  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-128.png'),
      title: 'Prompty',
      message,
    });
  } catch {
    // notifications unavailable — nothing else to do
  }
}

/**
 * Save the tab's current selection as a prompt (title = page title).
 * Text source: the content script (keeps line breaks) → the context menu's
 * `selectionText` (works where content scripts can't run, e.g. PDFs).
 * @param {{ id?: number, title?: string, url?: string }|undefined} tab
 * @param {string} [selectionText] from contextMenus.onClicked
 * @returns {Promise<{ success: boolean, status: string, id?: string, title?: string, error?: string }>}
 */
async function saveSelection(tab, selectionText) {
  let text = typeof selectionText === 'string' ? selectionText : '';
  let pageTitle = tab?.title ?? '';
  let reachable = false;
  if (tab?.id !== undefined) {
    const response = await sendToTab(tab.id, { type: MSG_SAVE_SELECTION });
    if (response) reachable = true;
    if (response?.success && typeof response.text === 'string' && response.text.trim() !== '') {
      text = response.text;
      if (typeof response.title === 'string' && response.title.trim() !== '')
        pageTitle = response.title;
    }
  }

  try {
    const lib = await readAll();
    const plan = planSave({
      prompts: lib.prompts,
      text,
      pageTitle,
      url: tab?.url ?? '',
      id: crypto.randomUUID(),
    });
    if (plan.status === 'empty') {
      await notify(tab, 'Select some text first, then save it to Prompty.', true, reachable);
      return { success: false, status: 'empty', error: 'No selection' };
    }
    if (plan.status === 'duplicate') {
      await notify(tab, 'Already saved to Prompty.', false, reachable);
      return { success: true, status: 'duplicate' };
    }
    await writeAll(undefined, { prompts: [...lib.prompts, plan.prompt] });
    // Keep the clipboard-snippet record the old path produced (Δ5c).
    const raw = await browser.storage.local.get(['snippets']);
    const origin = (() => {
      try {
        return new URL(tab?.url ?? '').origin;
      } catch {
        return '';
      }
    })();
    await browser.storage.local.set({
      snippets: appendSnippet(Array.isArray(raw.snippets) ? raw.snippets : [], {
        text: plan.prompt.text,
        sourceOrigin: origin,
      }),
    });
    await notify(tab, `Saved “${plan.prompt.title}” to Prompty`, false, reachable);
    return { success: true, status: 'saved', id: plan.prompt.id, title: plan.prompt.title };
  } catch (error) {
    await notify(tab, 'Could not save to Prompty.', true, reachable);
    return {
      success: false,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
      // Extension pages may ask to save the active tab's selection (same path as the menu/shortcut).
      void (async () => {
        const tab = await getActiveTab();
        respond(await saveSelection(tab));
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
      await saveSelection(tab);
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
browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) void saveSelection(tab, info.selectionText);
});

// Log ready
console.log('[Prompty] Background service worker / event page ready');
