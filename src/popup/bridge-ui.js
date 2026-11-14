/**
 * G14 — Settings → Agent bridge.
 *
 * The pairing token lives outside `settings` (storage key `mcpBridgeToken`) so
 * a JSON export of the library never ships it. Enabling the toggle is what
 * creates the background sync alarm; "Test" only pings `/health`.
 */
import { t, tn, uiLanguage } from '../lib/i18n.js';
import browser from '../lib/browser.js';
import {
  BRIDGE_STATUS_KEY,
  BRIDGE_TOKEN_KEY,
  DEFAULT_BRIDGE_URL,
  MSG_MCP_SYNC,
} from '../lib/bridge-constants.js';
import { normalizeBridgeUrl } from '../lib/bridge.js';
import { h, mount } from './dom.js';
import { toast } from './modals.js';
import { save, state } from './store.js';

/** @param {number} at */
function clock(at) {
  try {
    return new Date(at).toLocaleTimeString(uiLanguage(), { hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

/**
 * Human status line for the last sync attempt.
 * @param {unknown} status
 */
function statusLine(status) {
  if (!status || typeof status !== 'object') return t('setAgentNeverSynced');
  const entry = /** @type {Record<string, any>} */ (status);
  if (entry.ok === true) {
    const changed =
      Number(entry.added ?? 0) + Number(entry.updated ?? 0) + Number(entry.removed ?? 0);
    return changed > 0
      ? tn('setAgentImported', changed, clock(Number(entry.at) || Date.now()))
      : t('setAgentUpToDate', clock(Number(entry.at) || Date.now()));
  }
  switch (entry.reason) {
    case 'disabled':
      return t('setAgentDisabledState');
    case 'not-configured':
      return t('setAgentNoToken');
    case 'bad-url':
      return t('setAgentBadUrl');
    case 'vault-locked':
      return t('setAgentVault');
    case 'http':
    case 'network':
      return t('setAgentFailed', String(entry.error ?? entry.reason));
    default:
      return t('setAgentFailed', String(entry.reason ?? 'error'));
  }
}

/**
 * Settings → Agent bridge.
 * @param {(title: string, desc: string|null, ...rows: any[]) => HTMLElement} section
 * @param {() => void} rerender
 */
export function bridgeSection(section, rerender) {
  const local = browser.storage.local;
  const s = state.settings;

  const tokenInput = h('input', {
    type: 'text',
    class: 'input mono',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': t('setAgentToken'),
    placeholder: t('setAgentTokenPlaceholder'),
  });

  const urlInput = h('input', {
    type: 'text',
    class: 'input mono',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': t('setAgentUrl'),
    placeholder: DEFAULT_BRIDGE_URL,
    value: s.mcpBridgeUrl || DEFAULT_BRIDGE_URL,
  });

  const status = h('p', { class: 'muted bridge__status', role: 'status' });

  const refresh = async () => {
    const stored = await local.get([BRIDGE_TOKEN_KEY, BRIDGE_STATUS_KEY]);
    const token = typeof stored[BRIDGE_TOKEN_KEY] === 'string' ? stored[BRIDGE_TOKEN_KEY] : '';
    if (document.activeElement !== tokenInput) tokenInput.value = token;
    mount(status, statusLine(stored[BRIDGE_STATUS_KEY]));
  };

  const enable = h(
    'label',
    { class: 'setting' },
    h(
      'span',
      { class: 'setting__text' },
      h('span', null, t('setAgentEnable')),
      h('span', { class: 'muted setting__hint' }, t('setAgentEnableHint')),
    ),
    h('input', {
      type: 'checkbox',
      class: 'switch',
      checked: s.mcpBridgeEnabled === true,
      on: {
        change: async (e) => {
          const checked = /** @type {HTMLInputElement} */ (e.target).checked;
          await save({ settings: { mcpBridgeEnabled: checked } });
          if (checked) void syncNow();
          rerender();
        },
      },
    }),
  );

  urlInput.addEventListener('change', async () => {
    const normalized = normalizeBridgeUrl(urlInput.value);
    if (normalized === null) {
      toast(t('setAgentBadUrl'), 'error');
      urlInput.value = state.settings.mcpBridgeUrl || DEFAULT_BRIDGE_URL;
      return;
    }
    urlInput.value = normalized;
    await save({ settings: { mcpBridgeUrl: normalized } });
    void syncNow();
  });

  tokenInput.addEventListener('change', async () => {
    const token = tokenInput.value.trim();
    await local.set({ [BRIDGE_TOKEN_KEY]: token });
    tokenInput.value = token;
    toast(token === '' ? t('setAgentTokenCleared') : t('setAgentTokenSaved'));
    if (token !== '') void syncNow();
  });

  const testButton = h(
    'button',
    { class: 'btn btn--sm', type: 'button', on: { click: () => void testConnection() } },
    t('setAgentTest'),
  );
  const syncButton = h(
    'button',
    { class: 'btn btn--sm', type: 'button', on: { click: () => void syncNow() } },
    t('setAgentSync'),
  );

  async function testConnection() {
    const url = normalizeBridgeUrl(urlInput.value);
    if (url === null) return toast(t('setAgentBadUrl'), 'error');
    const token = tokenInput.value.trim();
    if (token === '') return toast(t('setAgentNoToken'), 'error');

    testButton.disabled = true;
    testButton.textContent = t('setAgentTesting');
    try {
      const response = await fetch(`${url}/health`, {
        headers: { 'X-Prompty-Token': token },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(t('setAgentHttpError', response.status));
      const health = await response.json();
      toast(
        t(
          'setAgentReachable',
          String(health?.version ?? '?'),
          String(health?.pending ?? 0),
          String(health?.prompts ?? 0),
        ),
      );
    } catch (error) {
      toast(
        t('setAgentUnreachable', error instanceof Error ? error.message : String(error)),
        'error',
      );
    } finally {
      testButton.disabled = false;
      testButton.textContent = t('setAgentTest');
      await refresh();
    }
  }

  async function syncNow() {
    syncButton.disabled = true;
    syncButton.textContent = t('setAgentSyncing');
    try {
      const result = await browser.runtime.sendMessage({ type: MSG_MCP_SYNC });
      const entry = /** @type {Record<string, any>} */ (result ?? {});
      if (entry.ok) toast(t('setAgentSyncDone'));
      else if (entry.reason === 'vault-locked') toast(t('setAgentVault'), 'error');
      else if (entry.reason === 'disabled') toast(t('setAgentDisabledState'), 'error');
      else toast(t('setAgentSyncFailed'), 'error');
    } catch {
      toast(t('setAgentSyncFailed'), 'error');
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = t('setAgentSync');
      await refresh();
    }
  }

  void refresh();

  return section(
    t('setAgent'),
    t('setAgentDesc'),
    enable,
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label' }, t('setAgentUrl')),
      urlInput,
      h('span', { class: 'field__hint' }, t('setAgentUrlHint')),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label' }, t('setAgentToken')),
      tokenInput,
      h('span', { class: 'field__hint' }, t('setAgentTokenHint')),
    ),
    h('div', { class: 'inline-form' }, testButton, syncButton),
    status,
    h('p', { class: 'muted settings__desc' }, t('setAgentSetup')),
  );
}
