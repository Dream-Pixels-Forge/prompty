# SECURITY.md — Prompty

Threat model (extension, local-first; the agent bridge is the only network surface and is opt-in):

| Surface | Risk | Mitigation |
|---|---|---|
| Storage injection | malicious JSON import with `__proto__` keys | import validation rejects non-object arrays; prototype-pollution-safe merge (no JSON.parse reviver merge; whitelist spread of allowed keys) |
| Content script DOM | site content treated as instruction | no innerHTML from untrusted site data; all text set via `textContent`; shadow DOM; strict CSP by default (MV3) |
| Clipboard | user prompt content exfiltration via scripts | extension never transmits data; no `navigator.clipboard` reads without user gesture; snippet history capped (50) |
| Message surface | unknown message types hang channel | every handler always `sendResponse({...})`; unknown → `{success:false,error:"unknown type"}` |
| Permissions | `<all_urls>` is sensitive | content script is passive except user-triggered actions; no auto-paste; settings allow per-site disable |
| Import of untrusted export | settings overwrite attack | confirm dialog for replace mode; settings whitelist spread |
| crypto | non-crypto IDs allowed but use `crypto.randomUUID()` | no Math.random UUIDs |
| Agent bridge (G14) | a local process — or a web page — impersonates the MCP server or reads the library | off by default (no request until enabled); listener binds `127.0.0.1` only; every route requires `X-Prompty-Token` (48 hex, constant-time compare); the extension refuses any bridge URL that is not `127.0.0.1`/`localhost`; no CORS headers, `Cache-Control: no-store`, 1 MB body cap; the token is stored outside `settings` so exports never contain it; `~/.prompty/*.json` written atomically with mode 0600 |

Rules enforced: no secrets in repo; no network fetch except the opt-in loopback agent bridge
(`127.0.0.1` only, Δ14); no eval; PR gate runs lint+typecheck+tests.
