// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
import { describe, expect, it } from 'vitest';
import { createRpc, LATEST_PROTOCOL } from '../mcp/lib/rpc.mjs';

const SERVER_INFO = { name: 'prompty-mcp', version: '0.5.0' };

/** Minimal tool registry for the transport tests. */
const tools = {
  definitions: [
    {
      name: 'echo',
      description: 'Echo text back.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  ],
  async call(name, args) {
    if (name !== 'echo') throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: 'text', text: String(args.text) }] };
  },
};

const rpc = () => createRpc({ tools, serverInfo: SERVER_INFO });

/** @param {Record<string, unknown>} msg */
const request = (msg) => ({ jsonrpc: '2.0', id: 1, ...msg });

describe('initialize', () => {
  it('echoes a supported protocol version and advertises tools', () => {
    const response = rpc().handle(request({ method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      },
    });
    expect(response.result.instructions).toMatch(/prompt/i);
  });

  it('falls back to the latest version for an unknown or missing one', () => {
    expect(
      rpc().handle(request({ method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result
        .protocolVersion,
    ).toBe(LATEST_PROTOCOL);
    expect(
      rpc().handle(request({ method: 'initialize' })).result.protocolVersion,
    ).toBe(LATEST_PROTOCOL);
  });

  it('ignores notifications', () => {
    expect(rpc().handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(null);
  });
});

describe('tools', () => {
  it('lists tools', () => {
    const response = rpc().handle(request({ method: 'tools/list' }));
    expect(response.result.tools).toEqual(tools.definitions);
  });

  it('calls a tool', async () => {
    const response = await rpc().handle(
      request({ method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }),
    );
    expect(response.result).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  it('maps an unknown tool to invalid params', async () => {
    const response = await rpc().handle(
      request({ method: 'tools/call', params: { name: 'nope', arguments: {} } }),
    );
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toMatch(/unknown tool/i);
  });

  it('rejects a missing tool name', async () => {
    const response = await rpc().handle(request({ method: 'tools/call', params: {} }));
    expect(response.error.code).toBe(-32602);
  });

  it('answers ping', () => {
    expect(rpc().handle(request({ method: 'ping' }))).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('rejects unknown methods with -32601', () => {
    const response = rpc().handle(request({ method: 'resources/list' }));
    expect(response.error).toMatchObject({ code: -32601 });
    expect(response.id).toBe(1);
  });
});

describe('framing', () => {
  it('parses a JSON line and returns a JSON line', async () => {
    const output = await rpc().handleLine('{"jsonrpc":"2.0","id":7,"method":"ping"}');
    expect(JSON.parse(output)).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('returns a parse error for invalid JSON and keeps the id null', () => {
    const output = rpc().handleLine('{ bad json');
    expect(JSON.parse(output)).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });

  it('returns nothing for blank lines and notifications', () => {
    expect(rpc().handleLine('')).toBe(null);
    expect(rpc().handleLine('   ')).toBe(null);
    expect(rpc().handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBe(null);
  });

  it('rejects a payload without a method', () => {
    expect(rpc().handleLine('{"jsonrpc":"2.0","id":3}')).toMatch(/-32600/);
  });
});
