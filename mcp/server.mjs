#!/usr/bin/env node
// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * prompty-mcp — stdio MCP server + loopback bridge for the Prompty extension.
 *
 *   node mcp/server.mjs
 *
 * stdout is the MCP channel (newline-delimited JSON-RPC); logs go to stderr.
 * State lives in ~/.prompty (override with PROMPTY_HOME); the bridge port is
 * 47821 unless PROMPTY_BRIDGE_PORT says otherwise.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { startBridge } from './lib/bridge.mjs';
import { createRpc } from './lib/rpc.mjs';
import { DEFAULT_PORT, openStore } from './lib/store.mjs';
import { createTools } from './lib/tools.mjs';
import { VERSION } from './lib/version.mjs';

const home = process.env.PROMPTY_HOME?.trim() || join(homedir(), '.prompty');
const requestedPort = Number.parseInt(process.env.PROMPTY_BRIDGE_PORT ?? '', 10);

const store = await openStore({
  home,
  port: Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : DEFAULT_PORT,
});

let bridge;
try {
  bridge = await startBridge({ store, token: store.token, port: store.port });
} catch (error) {
  if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EADDRINUSE') throw error;
  // Another agent already owns the configured port; keep serving MCP and pick
  // a free port so a second editor can still see bridge_status.
  bridge = await startBridge({ store, token: store.token, port: 0 });
  store.port = bridge.port;
}

const tools = createTools(store);
const rpc = createRpc({ tools, serverInfo: { name: 'prompty-mcp', version: VERSION } });

process.stderr.write(
  `prompty-mcp ${VERSION}\n` +
    `  library : ${store.path}${store.recovered ? ' (recovered from a corrupt file)' : ''}\n` +
    `  bridge  : http://127.0.0.1:${bridge.port}  (enable Settings → Agent bridge in Prompty)\n` +
    `  token   : ${store.token}\n`,
);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on('line', (line) => {
  Promise.resolve(rpc.handleLine(line))
    .then((response) => {
      if (response !== null) process.stdout.write(`${response}\n`);
    })
    .catch((error) => {
      process.stderr.write(`prompty-mcp: ${error instanceof Error ? error.stack : String(error)}\n`);
    });
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try {
    await bridge.close();
  } finally {
    process.exit(0);
  }
};

lines.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
