// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Prompty MCP — JSON-RPC 2.0 over stdio (newline-delimited JSON).
 *
 * Hand-rolled on purpose: the server has zero dependencies, so it can be
 * dropped into any agent config without an install step. Only the methods an
 * MCP client needs are implemented — initialize, ping, tools/list, tools/call.
 */

/** Newest protocol revision this server implements. */
export const LATEST_PROTOCOL = '2025-06-18';

const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', LATEST_PROTOCOL];

const INSTRUCTIONS =
  'Prompty keeps the user\'s prompt library. When the user asks you to save, add or keep a prompt (for example "add a camera movement"), call save_prompt. Search before saving near-duplicates, and use the template-variable grammar so Prompty can fill blanks later.';

/**
 * @param {{
 *   tools: { definitions: Array<Record<string, unknown>>, call: (name: string, args?: Record<string, unknown>) => Promise<unknown> },
 *   serverInfo: { name: string, version: string },
 * }} options
 */
export function createRpc({ tools, serverInfo }) {
  /**
   * Handle one decoded JSON-RPC message. Returns a response object, a promise
   * of one (tools/call), or null for notifications.
   * @param {any} message
   */
  function handle(message) {
    if (!isRecord(message)) return error(null, -32600, 'Invalid Request');
    const id = message.id ?? null;
    const isNotification = message.id === undefined || message.id === null;

    if (typeof message.method !== 'string') {
      return isNotification ? null : error(id, -32600, 'Invalid Request');
    }

    switch (message.method) {
      case 'initialize': {
        if (isNotification) return null;
        const requested = message.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
          ? requested
          : LATEST_PROTOCOL;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo,
            instructions: INSTRUCTIONS,
          },
        };
      }
      case 'ping':
        return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return isNotification ? null : { jsonrpc: '2.0', id, result: { tools: tools.definitions } };
      case 'tools/call': {
        if (isNotification) return null;
        const name = message.params?.name;
        if (typeof name !== 'string' || name === '') {
          return error(id, -32602, 'Invalid params: a tool name is required');
        }
        const args = isRecord(message.params?.arguments) ? message.params.arguments : {};
        return tools.call(name, args).then(
          (result) => ({ jsonrpc: '2.0', id, result }),
          (failure) =>
            error(id, -32602, `Invalid params: ${failure instanceof Error ? failure.message : String(failure)}`),
        );
      }
      default:
        return isNotification ? null : error(id, -32601, `Method not found: ${message.method}`);
    }
  }

  /**
   * Handle one stdio line: parse, dispatch, serialize.
   * @param {string} line
   * @returns {string | null | Promise<string | null>}
   */
  function handleLine(line) {
    if (typeof line !== 'string' || line.trim() === '') return null;
    /** @type {unknown} */
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return JSON.stringify(error(null, -32700, 'Parse error'));
    }
    const response = handle(message);
    if (response === null) return null;
    if (typeof (response)?.then === 'function') {
      return /** @type {Promise<any>} */ (response).then((value) =>
        value === null ? null : JSON.stringify(value),
      );
    }
    return JSON.stringify(response);
  }

  return { handle, handleLine };
}

/**
 * @param {unknown} id
 * @param {number} code
 * @param {string} message
 */
function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
