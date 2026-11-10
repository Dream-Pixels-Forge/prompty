## Goal: G10 — Vault Mode (opt-in encryption)

### Objective

An opt-in passphrase encrypts prompts, snippets, history and drafts at rest with AES-GCM. The key
is derived with PBKDF2-SHA-256 at 250k iterations from a random salt. Prompty locks after idle
time and asks for the passphrase on the next open.

### Deliverables

- [ ] `src/lib/vault.js`: `deriveKey`, `seal(json)`, `open(blob)`, `rekey`; a versioned envelope
      `{ v, salt, iv, ct }`.
- [ ] Storage adapter: while the vault is on, `prompts`, `snippets`, `variableMemory` and
      `composerDraft` are stored only as ciphertext. Settings stay plain so the lock screen can
      render.
- [ ] Lock screen in the popup. The in-page palette shows "Vault locked: open Prompty". The idle
      timer is configurable (default 15 min). Turning the vault off decrypts after confirmation.
- [ ] Export while unlocked offers "encrypted pack" or "plain JSON (warning)".

### Definition of Done

- [ ] Round-trip tests; a wrong passphrase fails cleanly; a scan of storage finds no plaintext
      prompt text while the vault is on; there is no passphrase recovery, and the UI says so; gates
      green.

### Anti-Drift Rules

- WebCrypto only, no crypto library. The passphrase and key are never persisted; the key lives in
  memory only.

### Estimated Effort

L
