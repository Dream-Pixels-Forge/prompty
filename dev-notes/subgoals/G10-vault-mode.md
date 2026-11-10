## Goal: G10 — Vault Mode (opt-in encryption)

> **Status: done.** Notes from the PR:
>
> - **Layering:** `lib/vault.js` holds the crypto (PBKDF2-SHA-256 at 250k iterations with a 16-byte
>   salt, AES-GCM-256 with a fresh 12-byte IV per write, and a sealed check token, so a wrong
>   passphrase is told apart from corrupt data). `lib/secure-store.js` is an area with the same
>   get/set/remove shape as `storage.local`, so `readAll`/`writeAll` and preset seeding work
>   unchanged on top of it.
> - **Each secret key is its own blob** (`vault_prompts`, `vault_snippets`, `vault_variableMemory`,
>   `vault_composerDraft`), so concurrent writers of different keys can't clobber each other, just
>   as with plain storage. Categories and settings stay plain, so the lock screen and the in-page
>   settings work while locked.
> - **The key lives in `storage.session`** as a JWK. That store is memory-only, cleared on browser
>   restart, and hidden from content scripts by default. This lets the MV3 service worker restart
>   without asking again. Auto-lock is checked on every access, so no `alarms` permission is
>   needed.
> - **Content scripts never see the key:** while the vault is on, they read and write `prompts` and
>   `variableMemory` through `PROMPTY_VAULT_GET`/`PROMPTY_VAULT_SET`. The background accepts these
>   only from this extension, and only for those two keys. When locked, the `!` palette and widget
>   say "Vault locked — open Prompty to unlock".
> - **Turning the vault on or off** writes the new copies first and removes the old ones second, so
>   a crash in between leaves both copies, never neither.
> - **Export** while the vault is on asks for confirmation (the file is plain JSON). Encrypted
>   packs and passphrase change (rekey) are follow-ups.
> - **Composer drafts:** with the vault off, a draft is written synchronously on `pagehide`, as
>   before. With it on, the draft is encrypted and written on every edit, because an async write
>   at close may not finish.

### Objective

An opt-in passphrase encrypts prompts, snippets, history and drafts at rest with AES-GCM. The key
is derived with PBKDF2-SHA-256 at 250k iterations from a random salt. Prompty locks after idle
time and asks for the passphrase on the next open.

### Deliverables

- [x] `src/lib/vault.js`: `deriveKey`, `seal(json)`, `open(blob)`, `rekey`; a versioned envelope
      `{ v, salt, iv, ct }`.
- [x] Storage adapter: while the vault is on, `prompts`, `snippets`, `variableMemory` and
      `composerDraft` are stored only as ciphertext. Settings stay plain so the lock screen can
      render.
- [x] Lock screen in the popup. The in-page palette shows "Vault locked: open Prompty". The idle
      timer is configurable (default 15 min). Turning the vault off decrypts after confirmation.
- [x] Export while unlocked warns that the file is plain JSON (an encrypted pack is a follow-up).

### Definition of Done

- [x] Round-trip tests; a wrong passphrase fails cleanly; a scan of storage finds no plaintext
      prompt text while the vault is on; there is no passphrase recovery, and the UI says so; gates
      green.

### Anti-Drift Rules

- WebCrypto only, no crypto library. The passphrase and key are never persisted; the key lives in
  memory only.

### Estimated Effort

L
