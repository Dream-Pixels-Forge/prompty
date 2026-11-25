// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Prompty MCP — loopback HTTP bridge for the browser extension.
 *
 * Four token-authenticated routes on 127.0.0.1 only:
 *   GET  /health    liveness + counts
 *   GET  /pending   prompts/categories/deletions the extension has not imported
 *   POST /ack       ids the extension consumed
 *   POST /snapshot  the extension's library, so the agent can search it
 *
 * Hardening: constant-time token compare, 1 MB body cap, no CORS headers,
 * `Cache-Control: no-store`, and the token is never echoed in a response.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { VERSION } from './version.mjs';

/** Wire protocol shared with `src/lib/bridge-constants.js`. */
export const PROTOCOL = 1;

/** Largest request body accepted, in bytes. */
export const MAX_BODY = 1_048_576;

const ROUTES = /** @type {const} */ ({
  '/health': 'GET',
  '/pending': 'GET',
  '/ack': 'POST',
  '/snapshot': 'POST',
});

/**
 * Start the bridge.
 * @param {{
 *   store: Awaited<ReturnType<typeof import('./store.mjs').openStore>>,
 *   token: string,
 *   port?: number,
 * }} options
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startBridge({ store, token, port }) {
  const requested = Number.isInteger(port) && port >= 0 ? port : store.port;

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) {
        send(response, 500, { error: 'internal error' });
      } else {
        response.end();
      }
    });
  });

  await new Promise((resolve, reject) => {
    /** @param {NodeJS.ErrnoException} error */
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(requested, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(undefined);
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : requested;

  return {
    port: boundPort,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve(undefined));
      }),
  };

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function handle(request, response) {
    // Auth first: an unauthenticated caller learns nothing, not even which
    // routes exist.
    const header = request.headers['x-prompty-token'];
    if (!authorized(header, token)) {
      send(response, 401, { error: 'unauthorized' });
      return;
    }

    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const method = ROUTES[/** @type {keyof typeof ROUTES} */ (path)];
    if (!method) {
      send(response, 404, { error: 'not found' });
      return;
    }
    if ((request.method ?? 'GET') !== method) {
      send(response, 405, { error: 'method not allowed' });
      return;
    }

    if (method === 'GET') {
      if (path === '/health') {
        send(response, 200, health());
        return;
      }
      send(response, 200, pendingPayload());
      return;
    }

    /** @type {unknown} */
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      const status = error && /** @type {{ status?: number }} */ (error).status === 413 ? 413 : 400;
      send(response, status, { error: status === 413 ? 'payload too large' : 'invalid json' });
      return;
    }

    if (path === '/ack') {
      const ids = isRecord(payload) ? payload.ids : null;
      const acked = await store.ack(ids);
      send(response, 200, { ok: true, acked });
      return;
    }

    const result = await store.snapshot(isRecord(payload) ? payload : {});
    send(response, 200, { ok: true, stored: result.stored });
  }

  function health() {
    const pending = store.pending();
    return {
      ok: true,
      name: 'prompty-mcp',
      protocol: PROTOCOL,
      version: VERSION,
      pending: pending.prompts.length,
      prompts: store.listPrompts().length,
    };
  }

  function pendingPayload() {
    const pending = store.pending();
    return {
      prompts: pending.prompts.map(wirePrompt),
      categories: pending.categories.map((category) => ({
        id: category.id,
        name: category.name,
        color: category.color,
        icon: category.icon,
        order: category.order,
      })),
      projects: pending.projects.map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
        icon: project.icon,
        description: project.description,
        order: project.order,
        createdAt: project.createdAt,
      })),
      documents: pending.documents.map((document) => ({
        id: document.id,
        projectId: document.projectId,
        title: document.title,
        kind: document.kind,
        markdown: document.markdown,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        versions: document.versions,
      })),
      deleted: pending.deleted,
    };
  }
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/**
 * Public prompt shape — bookkeeping (`source`, `syncedAt`) stays local.
 * @param {any} prompt
 */
function wirePrompt(prompt) {
  return {
    id: prompt.id,
    title: prompt.title,
    text: prompt.text,
    createdAt: prompt.createdAt,
    useCount: prompt.useCount,
    isFavorite: prompt.isFavorite,
    categoryId: prompt.categoryId,
    tags: prompt.tags,
    aspectRatio: prompt.aspectRatio,
    quality: prompt.quality,
    lastUsedAt: prompt.lastUsedAt,
  };
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

/**
 * @param {string|string[]|undefined} header
 * @param {string} token
 */
function authorized(header, token) {
  if (typeof header !== 'string' || typeof token !== 'string') return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(token);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/**
 * Read the body, rejecting anything over {@link MAX_BODY}. The stream is
 * always drained so a 413 is still delivered cleanly.
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
function readJson(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(/** @type {Buffer} */ (chunk));
    });
    request.on('end', () => {
      if (tooLarge) {
        const error = new Error('payload too large');
        /** @type {any} */ (error).status = 413;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        const failure = new Error('invalid json');
        /** @type {any} */ (failure).status = 400;
        reject(failure);
      }
    });
    request.on('error', reject);
  });
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
