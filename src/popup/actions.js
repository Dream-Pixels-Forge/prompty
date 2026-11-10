/**
 * Shared prompt/snippet actions used by cards, snippets and the palette:
 * insert/append into the page (PROMPTY_INSERT, SPEC Δ7), copy (Δ5a), and
 * usage tracking. Variable prompts go through the fill-in modal first.
 */
import browser from '../lib/browser.js';
import { MSG_INSERT_PROMPT } from '../lib/message.js';
import { appendSnippet } from '../lib/storage.js';
import { parseVariables, rememberValues } from '../lib/variables.js';
import { fillVariables, toast } from './modals.js';
import { markUsed } from './palette.js';
import { save, state } from './store.js';

/**
 * @typedef {import('../lib/storage.js').Prompt} Prompt
 * @typedef {'insert'|'append'|'copy'} DeliverMode
 */

/**
 * Resolve variables (asking the user when needed) then deliver a prompt.
 * @param {Prompt} prompt
 * @param {DeliverMode} mode
 * @returns {Promise<boolean>} true when delivered
 */
export async function usePrompt(prompt, mode) {
  let text = prompt.text;
  if (parseVariables(text).length > 0) {
    const filled = await fillVariables(prompt, mode, state.variableMemory);
    if (filled === null) return false;
    text = filled.text;
    // G6: remember what was used, so next time the form is already filled.
    await save({ variableMemory: rememberValues(state.variableMemory, filled.values) });
  }
  const ok = await deliverText(text, mode);
  if (ok) await save({ prompts: markUsed(state.prompts, prompt.id) });
  if (ok && mode !== 'copy') window.close();
  return ok;
}

/**
 * Deliver raw text. Insert/append target the active tab's focused editable.
 * @param {string} text
 * @param {DeliverMode} mode
 * @returns {Promise<boolean>}
 */
export async function deliverText(text, mode) {
  if (mode === 'copy') return copyText(text);

  /** @type {{ success?: boolean, error?: string } | null} */
  let response = null;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      response = await browser.tabs.sendMessage(tab.id, {
        type: MSG_INSERT_PROMPT,
        text,
        mode: mode === 'append' ? 'append' : 'insert',
      });
    }
  } catch {
    response = null;
  }
  if (!response) {
    toast("Can't reach this page (browser pages block extensions). Use Copy instead.", 'error');
    return false;
  }
  if (!response.success) {
    toast(`${response.error ?? 'Insert failed'}. Click a text field on the page first.`, 'error');
    return false;
  }
  return true;
}

/**
 * Copy to clipboard and record it in snippet history (Δ5c).
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    ok = document.execCommand('copy');
    area.remove();
  }
  if (!ok) {
    toast('Copy failed: clipboard unavailable.', 'error');
    return false;
  }
  await save({ snippets: appendSnippet(state.snippets, { text, sourceOrigin: 'prompty' }) });
  toast('Copied to clipboard.');
  return true;
}
