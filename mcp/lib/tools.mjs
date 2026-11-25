// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Prompty MCP — the tools an agent sees.
 *
 * Trigger wording matters: a coding agent only calls `save_prompt` when the
 * description makes "save/add this prompt" unambiguous. Descriptions also
 * document the template-variable grammar the popup understands.
 *
 * `call()` never throws for user/agent mistakes; it returns an MCP error
 * result (`isError`). Only an unknown tool name rejects, which the JSON-RPC
 * layer maps to `-32602`.
 */
import { describeVariables, parseVariables } from './variables.mjs';

const VARIABLE_HELP =
  'Template variables: {subject} (text), {lens:24mm|50mm} (choice), {seed:1-999} (range), {mood=neutral} (text with default).';

/** @type {Array<{ name: string, description: string, inputSchema: Record<string, unknown> }>} */
export const toolDefinitions = [
  {
    name: 'save_prompt',
    description:
      'Save a prompt to the user\'s Prompty library. Call this whenever the user asks you to add, save, keep or remember a prompt, for example "add a camera movement for a slow dolly zoom". The prompt appears in the Prompty extension within a minute. ' +
      VARIABLE_HELP,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The full prompt body. Required.' },
        title: {
          type: 'string',
          description: 'Short display title. Defaults to the first line of the prompt.',
        },
        category: {
          type: 'string',
          description: 'Category name, e.g. "Camera Movement". Created if it does not exist.',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Up to 20 short tags.' },
        favorite: { type: 'boolean', description: 'Mark the prompt as a favorite.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_prompts',
    description:
      'List prompts in the user\'s Prompty library, newest first, with optional category, tag and result-limit filters. Use it to see what already exists before saving a near-duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Only prompts in this category (case-insensitive).' },
        tag: { type: 'string', description: 'Only prompts carrying this tag (case-insensitive).' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 50.' },
      },
    },
  },
  {
    name: 'search_prompts',
    description:
      'Search the Prompty library by title, body and tags (typo-tolerant). Use it to find an existing prompt before writing a new one, or when the user asks what they already have.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, e.g. "camera movement".' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_prompt',
    description:
      'Return one prompt in full by id, including its exact text, category, tags and template variables. Use it before updating a prompt so you keep the user\'s wording.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Prompt id from list/search results.' } },
      required: ['id'],
    },
  },
  {
    name: 'update_prompt',
    description:
      'Edit an existing prompt by id: title, body, tags, category or favorite. Only the fields you pass change. The updated prompt is queued for the Prompty extension.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' },
        favorite: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_prompt',
    description:
      'Delete a prompt by id from the Prompty library. The deletion is queued and applied by the extension on its next sync. Ask the user before deleting.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_categories',
    description:
      'List the user\'s Prompty categories with how many prompts each one holds. Check this before inventing a category name so prompts stay tidy.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bridge_status',
    description:
      'Report whether the Prompty bridge is running, its loopback URL and pairing token, and how many prompts are waiting to be imported. Use it when the user asks why saved prompts are not showing up.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'save_document',
    description:
      'Save a markdown document to a project in the user\'s Prompty library. Use it when the user produces or revises a project file (screenplay, project card, breakdown, prompt sheet, rules, notes). The document is versioned on change; if extractPrompts is true, prompt-sheet sections (## ID — Name with fenced code blocks) are extracted as insertable prompts.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project name, e.g. "GOLDHUNTER". Created if it does not exist.',
        },
        title: {
          type: 'string',
          description: 'Document title, e.g. "PROMPTS_G01-G17-v3".',
        },
        kind: {
          type: 'string',
          enum: ['screenplay', 'project-card', 'breakdown', 'prompt-sheet', 'rules', 'notes'],
          description: 'Document kind. Defaults to "notes".',
        },
        markdown: { type: 'string', description: 'Full markdown body. Required.' },
        extractPrompts: {
          type: 'boolean',
          description: 'If true and kind is "prompt-sheet", extract shot sections as Prompty prompts.',
        },
      },
      required: ['project', 'title', 'markdown'],
    },
  },
  {
    name: 'list_projects',
    description:
      'List the user\'s Prompty projects with their colors, icons, and order. Use it before saving a document so you pick the right project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_documents',
    description:
      'List documents in a project (or all documents if no project is given), with id, title, kind and last-updated time.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Only documents in this project (case-insensitive).' },
      },
    },
  },
  {
    name: 'get_document',
    description:
      'Return one document in full by id, or by project + title. Includes markdown, kind, updated time and version history.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id from list/search results.' },
        project: { type: 'string', description: 'Project name (used with title).' },
        title: { type: 'string', description: 'Document title (used with project).' },
      },
    },
  },
  {
    name: 'get_shot',
    description:
      'Return a single shot from a prompt-sheet document: prompt text, refs, edit and check lines. Use it to insert a specific shot into a generation.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name.' },
        shotId: { type: 'string', description: 'Shot id, e.g. "G08".' },
      },
      required: ['project', 'shotId'],
    },
  },
  {
    name: 'delete_document',
    description:
      'Delete a document by id from the Prompty library. The deletion is queued and applied by the extension on its next sync. Ask the user before deleting.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id.' } },
      required: ['id'],
    },
  },
];

/**
 * @param {Awaited<ReturnType<typeof import('./store.mjs').openStore>>} store
 */
export function createTools(store) {
  /** @param {string} name @param {Record<string, unknown>} [args] */
  async function call(name, args = {}) {
    const input = args ?? {};
    switch (name) {
      case 'save_prompt':
        return guard(() => savePrompt(input));
      case 'list_prompts':
        return guard(async () => listPrompts(input));
      case 'search_prompts':
        return guard(async () => searchPrompts(input));
      case 'get_prompt':
        return guard(async () => getPrompt(input));
      case 'update_prompt':
        return guard(async () => updatePrompt(input));
      case 'delete_prompt':
        return guard(async () => deletePrompt(input));
      case 'list_categories':
        return guard(async () => listCategories());
      case 'bridge_status':
        return guard(async () => bridgeStatus());
      case 'save_document':
        return guard(async () => saveDocument(input));
      case 'list_projects':
        return guard(async () => listProjects());
      case 'list_documents':
        return guard(async () => listDocuments(input));
      case 'get_document':
        return guard(async () => getDocument(input));
      case 'get_shot':
        return guard(async () => getShot(input));
      case 'delete_document':
        return guard(async () => deleteDocument(input));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** @param {Record<string, unknown>} input */
  async function savePrompt(input) {
    const saved = await store.savePrompt({
      text: input.text,
      title: input.title,
      tags: input.tags,
      category: input.category,
      favorite: input.favorite === true,
    });
    const prompt = saved.prompt;
    const category = categoryName(prompt.categoryId);
    const variables = parseVariables(prompt.text);
    const verb = saved.created ? 'Saved' : 'Already saved — updated';
    return result(
      `${verb} “${prompt.title}”${category ? ` in ${category}` : ''}. It will appear in Prompty on the next sync.`,
      {
        created: saved.created,
        id: prompt.id,
        title: prompt.title,
        category,
        tags: prompt.tags,
        pending: true,
        variables,
      },
    );
  }

  /** @param {Record<string, unknown>} input */
  async function listPrompts(input) {
    const limit = clampLimit(input.limit, 50, 200);
    const category = typeof input.category === 'string' ? textKey(input.category) : null;
    const tag = typeof input.tag === 'string' ? textKey(input.tag) : null;

    const matched = allPrompts().filter((prompt) => {
      if (category !== null) {
        const name = categoryName(prompt.categoryId);
        if (name === null || textKey(name) !== category) return false;
      }
      if (tag !== null && !prompt.tags.some((entry) => textKey(entry) === tag)) return false;
      return true;
    });
    const prompts = matched.slice(0, limit).map(summary);
    const text =
      matched.length === 0
        ? 'No prompts match that filter.'
        : `${matched.length} prompt${matched.length === 1 ? '' : 's'} (showing ${prompts.length}):\n${prompts
            .map((prompt) => `• ${prompt.title} [${prompt.id}]`)
            .join('\n')}`;
    return result(text, { total: matched.length, prompts });
  }

  /** @param {Record<string, unknown>} input */
  async function searchPrompts(input) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (query === '') throw new Error('A search query is required');
    const limit = clampLimit(input.limit, 20, 100);

    const scored = allPrompts()
      .map((prompt) => ({ prompt, score: scorePrompt(prompt, query) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || b.prompt.createdAt - a.prompt.createdAt)
      .slice(0, limit)
      .map((entry) => summary(entry.prompt));

    const text =
      scored.length === 0
        ? `No prompts match “${query}”.`
        : `${scored.length} match${scored.length === 1 ? '' : 'es'} for “${query}”:\n${scored
            .map((prompt) => `• ${prompt.title} [${prompt.id}]`)
            .join('\n')}`;
    return result(text, { query, prompts: scored });
  }

  /** @param {Record<string, unknown>} input */
  async function getPrompt(input) {
    const prompt = findPrompt(input.id);
    return result(fullText(prompt), full(prompt));
  }

  /** @param {Record<string, unknown>} input */
  async function updatePrompt(input) {
    const prompt = await store.updatePrompt(String(input.id ?? ''), {
      title: input.title,
      text: input.text,
      tags: input.tags,
      category: input.category,
      favorite: input.favorite,
      aspectRatio: input.aspectRatio,
      quality: input.quality,
    });
    return result(`Updated “${prompt.title}” [${prompt.id}]. It will sync on the next bridge run.`, full(prompt));
  }

  /** @param {Record<string, unknown>} input */
  async function deletePrompt(input) {
    const deleted = await store.deletePrompt(String(input.id ?? ''));
    return result(`Deleted prompt ${deleted.id}. The extension will remove it on the next sync.`, deleted);
  }

  async function listCategories() {
    const counts = new Map();
    for (const prompt of store.listPrompts()) {
      if (!prompt.categoryId) continue;
      counts.set(prompt.categoryId, (counts.get(prompt.categoryId) ?? 0) + 1);
    }
    const categories = [...store.listCategories()]
      .sort((a, b) => a.order - b.order)
      .map((category) => ({
        id: category.id,
        name: category.name,
        color: category.color,
        count: counts.get(category.id) ?? 0,
      }));
    const text =
      categories.length === 0
        ? 'No categories yet.'
        : categories.map((category) => `• ${category.name} (${category.count})`).join('\n');
    return result(text, { categories });
  }

  async function bridgeStatus() {
    const pending = store.pending();
    const url = `http://127.0.0.1:${store.port}`;
    const status = {
      running: true,
      url,
      port: store.port,
      token: store.token,
      pending: pending.prompts.length,
      prompts: store.listPrompts().length,
      categories: store.listCategories().length,
      libraryPath: store.path,
    };
    return result(
      `Prompty bridge is running at ${url} with ${status.pending} prompt(s) waiting and ${status.prompts} in the library.`,
      status,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Document tools                                                     */
  /* ---------------------------------------------------------------- */

  async function saveDocument(input) {
    const saved = await store.saveDocument({
      project: input.project,
      title: input.title,
      kind: input.kind,
      markdown: input.markdown,
      extractPrompts: input.extractPrompts === true,
    });
    const verb = saved.created ? 'Saved' : 'Updated';
    return result(
      `${verb} document “${saved.document.title}” in project “${input.project}” (${saved.versions} version${saved.versions === 1 ? '' : 's'}, ${saved.shots} shot${saved.shots === 1 ? '' : 's'}). It will appear in Prompty on the next sync.`,
      {
        created: saved.created,
        document: saved.document,
        versions: saved.versions,
        shots: saved.shots,
        pending: true,
      },
    );
  }

  async function listProjects() {
    const projects = store.listProjects();
    const text =
      projects.length === 0
        ? 'No projects yet.'
        : `${projects.length} project${projects.length === 1 ? '' : 's'}:\n${projects
            .map((p) => `• ${p.name} [${p.id}]`)
            .join('\n')}`;
    return result(text, { projects });
  }

  async function listDocuments(input) {
    const project = typeof input?.project === 'string' ? input.project : undefined;
    const docs = store.listDocuments({ project });
    const text =
      docs.length === 0
        ? project ? `No documents in project “${project}”.` : 'No documents yet.'
        : `${docs.length} document${docs.length === 1 ? '' : 's'}:\n${docs
            .map((d) => `• ${d.title} [${d.id}] (${d.kind})`)
            .join('\n')}`;
    return result(text, { documents: docs });
  }

  async function getDocument(input) {
    const doc = store.getDocument(input);
    if (!doc) throw new Error('Document not found');
    const versions = doc.versions ?? [];
    const text =
      `${doc.title} (${doc.kind}) — updated ${new Date(doc.updatedAt).toLocaleString()}\n` +
      `\n${doc.markdown}\n` +
      (versions.length > 0 ? `\n${versions.length} previous version${versions.length === 1 ? '' : 's'}` : '');
    return result(text, {
      id: doc.id,
      projectId: doc.projectId,
      title: doc.title,
      kind: doc.kind,
      markdown: doc.markdown,
      updatedAt: doc.updatedAt,
      versions,
    });
  }

  async function getShot(input) {
    const shot = store.getShot(input);
    if (!shot) throw new Error('Shot not found');
    const text =
      `**${shot.shotId} — ${shot.name}**\n` +
      `\n${shot.prompt}\n` +
      (shot.refs.length > 0 ? `\nRefs: ${shot.refs.join(', ')}` : '') +
      (shot.edit ? `\nEdit: ${shot.edit}` : '') +
      (shot.check ? `\nCHECK: ${shot.check}` : '');
    return result(text, shot);
  }

  async function deleteDocument(input) {
    const deleted = await store.deleteDocument(input);
    return result(`Deleted document ${deleted.id}. The extension will remove it on the next sync.`, deleted);
  }

  /* ---------------------------------------------------------------- */

  /** @param {string|null|undefined} categoryId */
  function categoryName(categoryId) {
    if (!categoryId) return null;
    return store.listCategories().find((category) => category.id === categoryId)?.name ?? null;
  }

  /** @param {any} prompt */
  function summary(prompt) {
    return {
      id: prompt.id,
      title: prompt.title,
      category: categoryName(prompt.categoryId),
      tags: prompt.tags,
      pending: prompt.syncedAt === null,
      createdAt: prompt.createdAt,
      preview: prompt.text.length > 280 ? `${prompt.text.slice(0, 277)}…` : prompt.text,
    };
  }

  /** @param {any} prompt */
  function full(prompt) {
    return {
      id: prompt.id,
      title: prompt.title,
      text: prompt.text,
      category: categoryName(prompt.categoryId),
      tags: prompt.tags,
      isFavorite: prompt.isFavorite,
      createdAt: prompt.createdAt,
      pending: prompt.syncedAt === null,
      variables: parseVariables(prompt.text),
    };
  }

  /** @param {any} prompt */
  function fullText(prompt) {
    const category = categoryName(prompt.categoryId);
    return `${prompt.title}${category ? ` — ${category}` : ''}\n\n${prompt.text}`;
  }

  function allPrompts() {
    return [...store.listPrompts()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** @param {unknown} id */
  function findPrompt(id) {
    const prompt = store.listPrompts().find((entry) => entry.id === id);
    if (!prompt) throw new Error(`Prompt not found: ${String(id)}`);
    return prompt;
  }

  /** @param {unknown} value */
  function clampLimit(value, fallback, max) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(Math.floor(n), max);
  }

  return { definitions: toolDefinitions, call };
}

/**
 * @param {string} text
 * @param {Record<string, unknown>} structuredContent
 */
function result(text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | { isError: true, content: Array<{ type: 'text', text: string }> }>}
 */
async function guard(fn) {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
  }
}

/** @param {string} text */
const textKey = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** @param {any} prompt @param {string} query */
function scorePrompt(prompt, query) {
  /** @param {string} target */
  const score = (target) => fuzzyScore(query, target);
  const title = score(prompt.title ?? '');
  const tags = Math.max(-1, ...prompt.tags.map((tag) => score(tag)));
  const body = score(prompt.text);
  return Math.max(title >= 0 ? title + 20 : -1, tags >= 0 ? tags + 10 : -1, body);
}

/**
 * Substring match beats a in-order subsequence; -1 means no match.
 * @param {string} query
 * @param {string} target
 */
function fuzzyScore(query, target) {
  const needle = query.toLowerCase();
  const haystack = target.toLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct !== -1) return 100 - Math.min(direct, 99);
  let cursor = 0;
  let gaps = 0;
  let previous = -1;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return -1;
    if (previous !== -1) gaps += found - previous - 1;
    previous = found;
    cursor = found + 1;
  }
  return 50 - Math.min(gaps, 50);
}

// Re-exported for docs/tests that want the variable summary.
export { describeVariables };
