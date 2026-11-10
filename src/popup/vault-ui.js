/**
 * G10 — Vault UI: the lock screen, and the Settings → Vault section
 * (turn on with a passphrase, lock now, auto-lock time, turn off).
 */
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
      'aria-label': 'Vault passphrase',
      placeholder: 'Passphrase',
    })
  );
  const error = h('p', { class: 'field__error', role: 'alert' });
  const button = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Unlock');
  const form = h(
    'form',
    {
      class: 'vault-lock__card',
      on: {
        submit: async (e) => {
          e.preventDefault();
          error.textContent = '';
          /** @type {HTMLButtonElement} */ (button).disabled = true;
          button.textContent = 'Unlocking…';
          const ok = await unlock(input.value).catch(() => false);
          /** @type {HTMLButtonElement} */ (button).disabled = false;
          button.textContent = 'Unlock';
          if (!ok) {
            error.textContent = 'That passphrase does not open this vault.';
            input.select();
          }
        },
      },
    },
    h('img', { class: 'vault-lock__logo', src: '../icons/icon-128.png', alt: '' }),
    h('h1', { class: 'vault-lock__title', id: 'vault-lock-title' }, 'Prompty is locked'),
    h(
      'p',
      { class: 'muted' },
      'Your prompts, snippets and drafts are encrypted on this device. Enter your passphrase to open them.',
    ),
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
  [5, '5 minutes'],
  [15, '15 minutes'],
  [60, '1 hour'],
  [0, 'Only when the browser closes'],
]);

/**
 * @param {number} current
 * @param {(minutes: number) => void} onChange
 */
function idleSelect(current, onChange) {
  const select = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { class: 'select', 'aria-label': 'Lock automatically after' },
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
      mount(
        body,
        h(
          'p',
          { class: 'muted' },
          'This browser cannot keep a vault key in memory only, so Vault Mode is unavailable here.',
        ),
      );
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
            'Turn on Vault…',
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
          '🔒 Vault is on',
          h(
            'span',
            { class: 'muted setting__hint' },
            'Prompts, snippets, fill-ins and drafts are encrypted on disk.',
          ),
        ),
      ),
      h(
        'label',
        { class: 'setting' },
        h('span', { class: 'setting__text' }, 'Lock automatically after'),
        idleSelect(meta?.idleMinutes ?? 15, (m) => {
          void area.setIdleMinutes(m).then(() => toast('Auto-lock updated.'));
        }),
      ),
      h(
        'div',
        { class: 'inline-form' },
        h(
          'button',
          { class: 'btn', type: 'button', on: { click: () => void lockVault() } },
          'Lock now',
        ),
        h(
          'button',
          { class: 'btn btn--ghost', type: 'button', on: { click: () => void turnOff() } },
          'Turn off Vault…',
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
      title: 'Turn on Vault',
      body: h(
        'div',
        null,
        h(
          'p',
          { class: 'muted' },
          'Your prompts, snippets, fill-ins and Composer drafts will be encrypted on this device (AES-GCM, key derived from your passphrase). Categories and settings stay readable so Prompty can show the lock screen.',
        ),
        h(
          'p',
          { class: 'vault-warn' },
          '⚠ There is no recovery. If you forget the passphrase, the encrypted prompts cannot be opened by anyone, including you. Export a backup first if you are unsure.',
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, `Passphrase (${MIN_PASSPHRASE}+ characters)`),
          pass,
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, 'Type it again'),
          again,
          error,
        ),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, 'Lock automatically after'),
          idleSelect(idle, (m) => (idle = m)),
        ),
      ),
      submitLabel: 'Encrypt my library',
      onSubmit: () => {
        if (pass.value.length < MIN_PASSPHRASE) {
          error.textContent = `Use at least ${MIN_PASSPHRASE} characters.`;
          pass.focus();
          return null;
        }
        if (pass.value !== again.value) {
          error.textContent = 'The two passphrases differ.';
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
      toast('Vault on: your library is encrypted on this device.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not turn on the vault.', 'error');
    }
    void draw();
    rerender();
  };

  const turnOff = async () => {
    const ok = await confirmDialog(
      'Turn off Vault?',
      'Your prompts, snippets, fill-ins and drafts will be decrypted and stored as plain data on this device again.',
      { confirmLabel: 'Turn off', danger: true },
    );
    if (!ok) return;
    try {
      await secureArea().disable();
      await refreshVault();
      toast('Vault off. Your library is stored unencrypted again.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not turn off the vault.', 'error');
    }
    void draw();
    rerender();
  };

  void draw();
  return section(
    'Vault',
    'Optional encryption at rest for prompts on this device. The key is kept in memory only, never on disk.',
    body,
  );
}
