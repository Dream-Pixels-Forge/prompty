/**
 * G10 — Vault UI: the lock screen, and the Settings → Vault section
 * (turn on with a passphrase, lock now, auto-lock time, turn off).
 */
import { t } from '../lib/i18n.js';
import { secureArea } from '../lib/secure.js';
import { MIN_PASSPHRASE } from '../lib/vault.js';
import { h, mount } from './dom.js';
import { confirmDialog, openModal, toast } from './modals.js';
import { lockVault, refreshVault, state, unlock } from './store.js';

/** @type {HTMLElement|null} */
let lockEl = null;

/** Show or hide the full-screen lock (called from render()). */
export function syncLockScreen() {
  if (state.vault !== 'locked') {
    lockEl?.remove();
    lockEl = null;
    return;
  }
  if (lockEl) return;
  const input = /** @type {HTMLInputElement} */ (
    h('input', {
      type: 'password',
      class: 'input',
      autocomplete: 'current-password',
      'aria-label': t('vaultPassphrase'),
      placeholder: t('passphrase'),
    })
  );
  const error = h('p', { class: 'field__error', role: 'alert' });
  const button = h('button', { class: 'btn btn--primary', type: 'submit' }, t('unlock'));
  const form = h(
    'form',
    {
      class: 'vault-lock__card',
      on: {
        submit: async (e) => {
          e.preventDefault();
          error.textContent = '';
          /** @type {HTMLButtonElement} */ (button).disabled = true;
          button.textContent = t('unlocking');
          const ok = await unlock(input.value).catch(() => false);
          /** @type {HTMLButtonElement} */ (button).disabled = false;
          button.textContent = t('unlock');
          if (!ok) {
            error.textContent = t('wrongPassphrase');
            input.select();
          }
        },
      },
    },
    h('img', { class: 'vault-lock__logo', src: '../icons/icon-128.png', alt: '' }),
    h('h1', { class: 'vault-lock__title', id: 'vault-lock-title' }, t('lockedTitle')),
    h('p', { class: 'muted' }, t('lockedBody')),
    h('div', { class: 'inline-form' }, input, button),
    error,
  );
  lockEl = h(
    'div',
    {
      // `backdrop` also tells the popup's global keys (Ctrl+K, /) to stand down.
      class: 'backdrop vault-lock',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'vault-lock-title',
    },
    form,
  );
  document.body.append(lockEl);
  input.focus();
}

const IDLE_OPTIONS = /** @type {const} */ ([
  [5, t('idle5')],
  [15, t('idle15')],
  [60, t('idle60')],
  [0, t('idleBrowserClose')],
]);

/**
 * @param {number} current
 * @param {(minutes: number) => void} onChange
 */
function idleSelect(current, onChange) {
  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { class: 'select', 'aria-label': t('lockAfter') },
      IDLE_OPTIONS.map(([m, label]) =>
        h('option', { value: String(m), selected: m === current }, label),
      ),
    )
  );
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
}

/**
 * Settings → Vault.
 * @param {(title: string, desc: string, ...rows: any[]) => HTMLElement} section
 * @param {() => void} rerender
 */
export function vaultSection(section, rerender) {
  const body = h('div', { class: 'vault-settings' });
  const draw = async () => {
    const area = secureArea();
    const status = await area.status();
    const meta = await area.meta();
    if (status === 'unsupported') {
      mount(body, h('p', { class: 'muted' }, t('vaultUnsupported')));
      return;
    }
    if (status === 'off') {
      mount(
        body,
        h(
          'div',
          { class: 'inline-form' },
          h(
            'button',
            { class: 'btn', type: 'button', on: { click: () => void turnOn() } },
            t('turnOnVaultEllipsis'),
          ),
        ),
      );
      return;
    }
    mount(
      body,
      h(
        'div',
        { class: 'setting' },
        h(
          'span',
          { class: 'setting__text' },
          t('vaultIsOn'),
          h('span', { class: 'muted setting__hint' }, t('vaultIsOnHint')),
        ),
      ),
      h(
        'label',
        { class: 'setting' },
        h('span', { class: 'setting__text' }, t('lockAfter')),
        idleSelect(meta?.idleMinutes ?? 15, (m) => {
          void area.setIdleMinutes(m).then(() => toast(t('autoLockUpdated')));
        }),
      ),
      h(
        'div',
        { class: 'inline-form' },
        h(
          'button',
          { class: 'btn', type: 'button', on: { click: () => void lockVault() } },
          t('lockNow'),
        ),
        h(
          'button',
          { class: 'btn btn--ghost', type: 'button', on: { click: () => void turnOff() } },
          t('turnOffVaultEllipsis'),
        ),
      ),
    );
  };

  const turnOn = async () => {
    const pass = /** @type {HTMLInputElement} */ (
      h('input', { type: 'password', autocomplete: 'new-password' })
    );
    const again = /** @type {HTMLInputElement} */ (
      h('input', { type: 'password', autocomplete: 'new-password' })
    );
    let idle = 15;
    const error = h('span', { class: 'field__error', role: 'alert' });
    const result = await openModal({
      title: t('turnOnVault'),
      body: h(
        'div',
        null,
        h('p', { class: 'muted' }, t('turnOnVaultBody')),
        h('p', { class: 'vault-warn' }, t('noRecoveryWarning')),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, t('passphraseLabel', MIN_PASSPHRASE)),
          pass,
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, t('typeItAgain')),
          again,
          error,
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, t('lockAfter')),
          idleSelect(idle, (m) => (idle = m)),
        ),
      ),
      submitLabel: t('encryptLibrary'),
      onSubmit: () => {
        if (pass.value.length < MIN_PASSPHRASE) {
          error.textContent = t('passphraseTooShort', MIN_PASSPHRASE);
          pass.focus();
          return null;
        }
        if (pass.value !== again.value) {
          error.textContent = t('passphrasesDiffer');
          again.focus();
          return null;
        }
        return { passphrase: pass.value, idle };
      },
    });
    if (!result) return;
    try {
      await secureArea().enable(result.passphrase, { idleMinutes: result.idle });
      await refreshVault();
      toast(t('vaultTurnedOn'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('vaultTurnOnFailed'), 'error');
    }
    void draw();
    rerender();
  };

  const turnOff = async () => {
    const ok = await confirmDialog(t('turnOffVaultTitle'), t('turnOffVaultBody'), {
      confirmLabel: t('turnOff'),
      danger: true,
    });
    if (!ok) return;
    try {
      await secureArea().disable();
      await refreshVault();
      toast(t('vaultTurnedOff'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('vaultTurnOffFailed'), 'error');
    }
    void draw();
    rerender();
  };

  void draw();
  return section(t('vaultSectionTitle'), t('vaultSectionDesc'), body);
}
