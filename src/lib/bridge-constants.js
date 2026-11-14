/**
 * Bridge constants shared by the extension and the sync client. Kept separate
 * from bridge.js so storage.js can default `mcpBridgeUrl` without a cycle.
 */

/** Wire protocol version of the loopback bridge. */
export const BRIDGE_PROTOCOL = 1;

/** Where `mcp/server.mjs` listens unless PROMPTY_BRIDGE_PORT says otherwise. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:47821';

/** Storage key for the pairing token (deliberately outside `settings`). */
export const BRIDGE_TOKEN_KEY = 'mcpBridgeToken';

/** Storage key for the last sync outcome. */
export const BRIDGE_STATUS_KEY = 'mcpBridgeStatus';

/** Alarm name for the periodic sync. */
export const BRIDGE_ALARM = 'prompty-bridge';

/** Sent by Settings → Agent bridge → Sync now. */
export const MSG_MCP_SYNC = 'PROMPTY_MCP_SYNC';
