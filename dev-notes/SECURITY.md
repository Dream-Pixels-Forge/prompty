# SECURITY.md — Prompty

Threat model (extension, all-local):

| Surface | Risk | Mitigation |
|---|---|---|
| Storage injection | malicious JSON import with `__proto__` keys | import validation rejects non-object arrays; prototype-pollution-safe merge (no JSON.parse reviver merge; whitelist spread of allowed keys) |
| Content script DOM | site content treated as instruction | no innerHTML from untrusted site data; all text set via `textContent`; shadow DOM; strict CSP by default (MV3) |
| Clipboard | user prompt content exfiltration via scripts | extension never transmits data; no `navigator.clipboard` reads without user gesture; snippet history capped (50) |
| Message surface | unknown message types hang channel | every handler always `sendResponse({...})`; unknown → `{success:false,error:"unknown type"}` |
| Permissions | `<all_urls>` is sensitive | content script is passive except user-triggered actions; no auto-paste; settings allow per-site disable |
| Import of untrusted export | settings overwrite attack | confirm dialog for replace mode; settings whitelist spread |
| crypto | non-crypto IDs allowed but use `crypto.randomUUID()` | no Math.random UUIDs |

Rules enforced: no secrets in repo; no network fetch; no eval; PR gate runs lint+typecheck+tests.
