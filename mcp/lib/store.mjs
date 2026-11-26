// @ts-nocheck — standalone Node package (not part of the extension bundle); covered by tests/mcp-*.test.mjs
/**
 * Prompty MCP — local prompt store.
 *
 * Two files under `~/.prompty`:
 *   library.json  prompts, categories, deletion tombstones (0600)
 *   bridge.json   `{ token, port }` pairing secret for the extension (0600)
 *
 * Prompt bookkeeping: `source` says who made it (`mcp` or `extension`),
 * `syncedAt === null` means "queued for the extension on its next sync".
 * Writes are atomic (tmp file + rename) so a crash cannot truncate the library.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Longest prompt body accepted (matches the extension-side bridge cap). */
export const MAX_TEXT = 100_000;
/** Longest document markdown accepted (matches the extension-side cap). */
export const MAX_DOCUMENT_MARKDOWN = 512 * 1024;
/** Maximum documents per project. */
export const MAX_DOCUMENTS_PER_PROJECT = 100;
/** Maximum projects total. */
export const MAX_PROJECTS = 50;
/** Tags kept per prompt. */
export const MAX_TAGS = 20;
/** Deletion tombstones retained; older ones fall off. */
export const TOMBSTONE_CAP = 500;
export const DEFAULT_PORT = 47821;

const PALETTE = [
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#6366f1',
  '#06b6d4',
  '#ef4444',
  '#84cc16',
  '#14b8a6',
  '#f97316',
  '#a855f7',
  '#0ea5e9',
];

/** Valid document kinds. */
export const KIND_VALUES = /** @type {const} */ (
  ['screenplay', 'project-card', 'breakdown', 'prompt-sheet', 'rules', 'notes']
);

/**
 * Extract every shot variant from a prompt-sheet markdown document.
 * One entry per fenced-block variant (known model or neutral). Unknown info
 * strings (e.g. `json`, `text`) are not shot variants.
 * @param {string} markdown
 * @returns {Array<{ shotId: string, name: string, prompt: string, refs: string[], check: string, edit: string, modelId: string|null }>}
 */
function extractShots(markdown) {
  /** @type {Array<{ shotId: string, name: string, prompt: string, refs: string[], check: string, edit: string, modelId: string|null }>} */
  const shots = [];

  const sections = markdown.split(/(?:^|\n)## /);
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const headingMatch = section.match(/^([A-Z]\d+)\s*(?:—\s*(.+))?/);
    if (!headingMatch) continue;

    const shotId = headingMatch[1].trim();
    const name = (headingMatch[2] || '').trim();
    const remaining = section.slice(headingMatch[0].length);

    const refsMatch = remaining.match(/\*\*Refs:\*\*\s*([\s\S]*?)(?:\n\*\*|\n```|\n##|$)/);
    const refs = parseRefs(refsMatch ? refsMatch[1] : '');

    const editMatch = remaining.match(/\*\*Edit:\*\*\s*([\s\S]*?)(?:\n\*\*|\n```|\n##|$)/);
    const edit = editMatch ? editMatch[1].trim() : '';

    const checkMatch = remaining.match(/\*\*CHECK:\*\*\s*([\s\S]*?)(?:\n\*\*|\n```|\n##|$)/);
    const check = checkMatch ? checkMatch[1].trim() : '';

    // Each recognized fenced block = one variant
    const fencedBlocks = [...remaining.matchAll(/```([a-zA-Z0-9-]*)\n([\s\S]*?)\n```/g)];
    let variantCount = 0;
    for (const block of fencedBlocks) {
      const info = /** @type {string} */ (block[1]).toLowerCase().trim();
      const content = block[2].trimEnd();
      if (!info || isKnownModel(info)) {
        shots.push({
          shotId,
          name,
          prompt: content,
          refs,
          check,
          edit,
          modelId: info || null,
        });
        variantCount++;
      }
    }
    if (variantCount === 0 && fencedBlocks.length > 0) {
      // Fall back to the first block only if nothing recognized matched.
      const info = /** @type {string} */ (fencedBlocks[0][1]).toLowerCase().trim();
      const content = fencedBlocks[0][2].trimEnd();
      shots.push({
        shotId,
        name,
        prompt: content,
        refs,
        check,
        edit,
        modelId: isKnownModel(info) ? info : null,
      });
    }
  }

  return shots;
}

/** Recognized model info strings (sourced dialects from G9c + G15b). */
const KNOWN_MODELS = new Set([
  'muse',
  'seedance',
  'seedance-2.5',
  'kling',
  'minimax-hailuo',
  'veo',
  'runway',
  'wan',
  'luma',
  'higgsfield',
  'timecoded',
  'script',
  'one-take',
]);

/**
 * Model profiles (inline copy of src/assets/models.json for the MCP store).
 * Only vendor-sourced numbers are kept; everything else is null.
 */
const MODEL_PROFILES = [
  {
    id: 'muse',
    label: 'Muse Video',
    hosts: ['meta.ai', 'www.meta.ai'],
    dialect: 'muse',
    wrapper: 'meta-ai-pass-through',
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'Field-tested by owner via meta.ai (Muse)',
    verified: false,
  },
  {
    id: 'seedance-2.5',
    label: 'Seedance 2.5',
    hosts: ['dreamina.capcut.com', 'jimeng.jianying.com', 'console.byteplus.com'],
    dialect: 'seedance',
    wrapper: null,
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'Seedance 2.5 prompt guide (BytePlus ModelArk)',
    verified: false,
  },
  {
    id: 'kling',
    label: 'Kling',
    hosts: ['kling.ai', 'www.kling.ai'],
    dialect: 'timecoded',
    wrapper: null,
    maxPromptChars: 8000,
    negativePrompt: true,
    refSlots: { images: 10, videos: 0, audio: 0 },
    durations: [3, 5, 10, 15, 20, 30],
    aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
    source: 'https://kling.ai/document-api/api/usage-guide/kling-4-0.md',
    verified: true,
  },
  {
    id: 'minimax-hailuo',
    label: 'MiniMax Hailuo',
    hosts: ['hailuo.ai', 'www.hailuo.ai'],
    dialect: 'timecoded',
    wrapper: null,
    maxPromptChars: 2000,
    negativePrompt: false,
    refSlots: { images: 1, videos: 1, audio: 0 },
    durations: [6, 10],
    aspectRatios: ['16:9', '9:16', '1:1'],
    source: 'https://platform.minimax.io/docs/api-reference/video-generation-fl2v',
    verified: true,
  },
  {
    id: 'veo',
    label: 'Google Veo',
    hosts: [],
    dialect: 'timecoded',
    wrapper: null,
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-text',
    verified: false,
  },
  {
    id: 'runway',
    label: 'Runway',
    hosts: ['runwayml.com', 'app.runwayml.com'],
    dialect: 'script',
    wrapper: null,
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'https://runway.com/research/introducing-gen-3-alpha',
    verified: false,
  },
  {
    id: 'wan',
    label: 'Wan',
    hosts: [],
    dialect: 'timecoded',
    wrapper: null,
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'Not sourced — placeholder profile pending vendor documentation.',
    verified: false,
  },
  {
    id: 'luma',
    label: 'Luma Dream Machine',
    hosts: ['lumalabs.ai', 'lumalabs.com'],
    dialect: 'timecoded',
    wrapper: null,
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'Not sourced — placeholder profile pending vendor documentation.',
    verified: false,
  },
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    hosts: ['higgsfield.ai', 'www.higgsfield.ai'],
    dialect: 'timecoded',
    wrapper: null,
    maxPromptChars: null,
    negativePrompt: false,
    refSlots: { images: 0, videos: 0, audio: 0 },
    durations: null,
    aspectRatios: null,
    source: 'Not sourced — placeholder profile pending vendor documentation.',
    verified: false,
  },
];

/**
 * List all model profiles.
 * @returns {object[]}
 */
function listModels() {
  return MODEL_PROFILES.map((m) => ({ ...m }));
}

/**
 * Look up a model profile by id.
 * @param {string} id
 * @returns {object|undefined}
 */
function getModelProfile(id) {
  return MODEL_PROFILES.find((m) => m.id === id);
}

/**
 * @param {string} info
 * @returns {boolean}
 */
function isKnownModel(info) {
  return KNOWN_MODELS.has(info);
}

/**
 * Parse Refs line into array of @reference tokens.
 * @param {string} refsText
 * @returns {string[]}
 */
function parseRefs(refsText) {
  /** @type {string[]} */
  const refs = [];
  const matches = refsText.match(/@([a-zA-Z0-9_-]+)/g);
  if (matches) {
    for (const m of matches) {
      const ref = m.startsWith('@') ? m : `@${m}`;
      if (!refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

/**
 * Lint a shot's prompt text against a model profile. Warnings only.
 * @param {{ text: string, refs?: string[] }} shot
 * @param {object} model
 * @returns {Array<{ key: string, text: string }>}
 */
function lintForModel(shot, model) {
  /** @type {Array<{ key: string, text: string }>} */
  const out = [];
  const text = typeof shot?.text === 'string' ? shot.text : '';
  const refs = Array.isArray(shot?.refs) ? shot.refs : [];

  if (model.maxPromptChars !== null && text.length > model.maxPromptChars) {
    out.push({
      key: 'lintModelChars',
      text: `${text.length} chars: ${model.label} accepts about ${model.maxPromptChars}; trim the prompt.`,
    });
  }

  const slots = model.refSlots ?? { images: 0, videos: 0, audio: 0 };
  for (const slot of ['images', 'videos', 'audio']) {
    const n = refs.filter((r) => r.startsWith('@' + slot.slice(0, 1))).length;
    const limit = slots[slot];
    if (limit !== null && n > limit) {
      out.push({
        key: 'lintModelRefs',
        text: `${n} ${slot} refs: ${model.label} takes ${limit} ${slot} reference slot(s).`,
      });
    }
  }

  if (/negative\s*prompt/i.test(text) && model.negativePrompt !== true) {
    out.push({
      key: 'lintModelNegative',
      text: `Negative-prompt section present but ${model.label} has no negative-prompt field.`,
    });
  }

  return out;
}

/** Duplicate key: whitespace collapsed, case-folded (same rule as the extension). */
export const textKey = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Open (or create) the store.
 * @param {{
 *   home: string,
 *   port?: number,
 *   now?: () => number,
 *   newId?: () => string,
 * }} options
 */
export async function openStore({ home, port = DEFAULT_PORT, now = Date.now, newId = randomUUID }) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const libraryPath = join(home, 'library.json');
  const bridgePath = join(home, 'bridge.json');

  const bridge = await readBridge(bridgePath);
  const token = bridge?.token ?? randomBytes(24).toString('hex');
  const activePort = Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;

  const loaded = await readLibrary(libraryPath, now);
  const state = {
    prompts: loaded.prompts,
    categories: loaded.categories,
    tombstones: loaded.tombstones,
    projects: loaded.projects,
    documents: loaded.documents,
  };

  /** @param {string} path @param {unknown} data */
  const writeJson = async (path, data) => {
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  };

  const persist = () =>
    writeJson(libraryPath, {
      version: 1,
      prompts: state.prompts,
      categories: state.categories,
      tombstones: state.tombstones,
      projects: state.projects,
      documents: state.documents,
      updatedAt: now(),
    });

  // Create both files on first run, and always re-assert bridge permissions.
  await persist();
  await writeJson(bridgePath, { token, port: activePort });

  /**
   * Find or create a category by display name.
   * @param {string} name
   * @returns {string} category id
   */
  const resolveCategory = (name) => {
    const clean = name.trim().replace(/\s+/g, ' ');
    const key = textKey(clean);
    const existing = state.categories.find((category) => textKey(category.name) === key);
    if (existing) return existing.id;
    const category = {
      id: newId(),
      name: clean,
      color: PALETTE[state.categories.length % PALETTE.length],
      icon: '📁',
      order: state.categories.length,
    };
    state.categories.push(category);
    return category.id;
  };

  /**
   * Save an agent-authored prompt. Identical body → update in place.
   * @param {{ title?: string, text: string, tags?: unknown, category?: string, favorite?: boolean }} input
   */
  const savePrompt = async (input) => {
    const text = typeof input?.text === 'string' ? input.text : '';
    if (text.trim() === '') throw new Error('Prompt text is required');
    if (text.length > MAX_TEXT) throw new Error(`Prompt text is too long (max ${MAX_TEXT})`);

    const key = textKey(text);
    const existing = state.prompts.find((prompt) => textKey(prompt.text) === key);
    if (existing) {
      if (typeof input.title === 'string' && input.title.trim() !== '') {
        existing.title = input.title.trim().slice(0, 200);
      }
      if (input.tags !== undefined) existing.tags = normalizeTags(input.tags);
      if (typeof input.category === 'string' && input.category.trim() !== '') {
        existing.categoryId = resolveCategory(input.category);
      }
      if (input.favorite === true) existing.isFavorite = true;
      existing.syncedAt = null;
      await persist();
      return { created: false, prompt: existing };
    }

    const categoryId =
      typeof input.category === 'string' && input.category.trim() !== ''
        ? resolveCategory(input.category)
        : null;

    const prompt = {
      id: newId(),
      title: titleFrom(input.title, text),
      text,
      createdAt: now(),
      useCount: 0,
      isFavorite: input.favorite === true,
      categoryId,
      tags: normalizeTags(input.tags),
      aspectRatio: null,
      quality: null,
      lastUsedAt: null,
      source: 'mcp',
      syncedAt: null,
    };
    state.prompts.push(prompt);
    await persist();
    return { created: true, prompt };
  };

  /** @param {string} id @param {Record<string, unknown>} patch */
  const updatePrompt = async (id, patch) => {
    const prompt = state.prompts.find((item) => item.id === id);
    if (!prompt) throw new Error(`Prompt not found: ${id}`);

    if (typeof patch.text === 'string') {
      if (patch.text.trim() === '') throw new Error('Prompt text is required');
      if (patch.text.length > MAX_TEXT) throw new Error(`Prompt text is too long (max ${MAX_TEXT})`);
      prompt.text = patch.text;
    }
    if (typeof patch.title === 'string' && patch.title.trim() !== '') {
      prompt.title = patch.title.trim().slice(0, 200);
    }
    if (patch.tags !== undefined) prompt.tags = normalizeTags(patch.tags);
    if (typeof patch.favorite === 'boolean') prompt.isFavorite = patch.favorite;
    if (typeof patch.category === 'string' && patch.category.trim() !== '') {
      prompt.categoryId = resolveCategory(patch.category);
    }
    if (patch.aspectRatio === null || typeof patch.aspectRatio === 'string') {
      prompt.aspectRatio = patch.aspectRatio;
    }
    if (patch.quality === null || typeof patch.quality === 'string') {
      prompt.quality = patch.quality;
    }
    prompt.syncedAt = null;
    await persist();
    return prompt;
  };

  /** @param {string} id */
  const deletePrompt = async (id) => {
    const index = state.prompts.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Prompt not found: ${id}`);
    state.prompts.splice(index, 1);
    state.tombstones.push({ id, deletedAt: now() });
    if (state.tombstones.length > TOMBSTONE_CAP) {
      state.tombstones = state.tombstones.slice(-TOMBSTONE_CAP);
    }
    await persist();
    return { deleted: true, id };
  };

  /* ------------------------------------------------------------------ */
  /* Projects                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Find or create a project by display name.
   * @param {string} name
   * @returns {string} project id
   */
  const resolveProject = (name) => {
    const clean = name.trim().replace(/\s+/g, ' ');
    const key = textKey(clean);
    const existing = state.projects.find((project) => textKey(project.name) === key);
    if (existing) return existing.id;
    if (state.projects.length >= MAX_PROJECTS) {
      throw new Error(`Project limit reached (max ${MAX_PROJECTS})`);
    }
    const project = {
      id: newId(),
      name: clean,
      color: PALETTE[state.projects.length % PALETTE.length],
      icon: '📁',
      description: '',
      order: state.projects.length,
      createdAt: now(),
    };
    state.projects.push(project);
    return project.id;
  };

  /**
   * Upsert a document by (projectId, title). When markdown changed, the old
   * content is archived as a version (capped at MAX_DOCUMENT_VERSIONS).
   * @param {{
   *   project: string,
   *   title: string,
   *   kind: string,
   *   markdown: string,
   *   extractPrompts?: boolean,
   * }} input
   * @returns {{
   *   document: { id: string, projectId: string, title: string, kind: string },
   *   created: boolean,
   *   versions: number,
   *   shots: number,
   * }}
   */
  const saveDocument = async (input) => {
    const projectName = typeof input?.project === 'string' && input.project.trim() !== '' ? input.project : null;
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const kind =
      typeof input?.kind === 'string' && KIND_VALUES.includes(input.kind) ? input.kind : 'notes';
    const markdown = typeof input?.markdown === 'string' ? input.markdown : '';
    const extractPrompts = input.extractPrompts === true;

    if (!projectName) throw new Error('Project name is required');
    if (title === '') throw new Error('Document title is required');
    if (markdown.length > MAX_DOCUMENT_MARKDOWN) {
      throw new Error(`Document markdown is too long (max ${MAX_DOCUMENT_MARKDOWN / 1024} KB)`);
    }

    const projectId = resolveProject(projectName);

    const existing = state.documents.find(
      (doc) => doc.projectId === projectId && textKey(doc.title) === textKey(title),
    );

    let variantCounts;
    let lintWarnings;
    if (extractPrompts) {
      const shots = extractShots(markdown);
      /** @type {Record<string, number>} */
      variantCounts = {};
      lintWarnings = [];
      for (const shot of shots) {
        const mid = shot.modelId ?? 'neutral';
        variantCounts[mid] = (variantCounts[mid] ?? 0) + 1;
        const model = getModelProfile(mid === 'neutral' ? 'timecoded' : mid);
        if (model) {
          lintWarnings.push(...lintForModel(shot, model));
        }
      }
    } else {
      variantCounts = {};
      lintWarnings = [];
    }

    if (existing) {
      if (existing.markdown !== markdown) {
        const version = { markdown: existing.markdown, updatedAt: existing.updatedAt };
        const versions = existing.versions ? [version, ...existing.versions] : [version];
        existing.versions = versions.slice(0, MAX_DOCUMENT_VERSIONS);
      }
      existing.markdown = markdown;
      existing.updatedAt = now();
      existing.kind = kind;
      await persist();
      return {
        document: { id: existing.id, projectId, title: existing.title, kind: existing.kind },
        created: false,
        versions: existing.versions ? existing.versions.length : 0,
        variantCounts,
        lintWarnings,
      };
    }

    if (state.documents.length >= MAX_DOCUMENTS_PER_PROJECT) {
      throw new Error(`Document limit reached per project (max ${MAX_DOCUMENTS_PER_PROJECT})`);
    }

    const document = {
      id: newId(),
      projectId,
      title,
      kind,
      markdown,
      createdAt: now(),
      updatedAt: now(),
    };
    state.documents.push(document);
    await persist();
    return {
      document: { id: document.id, projectId, title: document.title, kind: document.kind },
      created: true,
      versions: 0,
      variantCounts,
      lintWarnings,
    };
  };

  /** @returns {{ id: string, name: string, color: string, icon: string, order: number }[]} */
  const listProjects = () =>
    state.projects.map((project) => ({
      id: project.id,
      name: project.name,
      color: project.color,
      icon: project.icon,
      order: project.order,
    }));

  /**
   * @param {{ project?: string }} input
   * @returns {Array<{ id: string, projectId: string, title: string, kind: string, updatedAt: number }>}
   */
  const listDocuments = (input) => {
    const projectId =
      typeof input?.project === 'string' && input.project.trim() !== ''
        ? resolveProject(input.project)
        : null;
    const docs = projectId !== null
      ? state.documents.filter((doc) => doc.projectId === projectId)
      : state.documents;
    return docs.map((doc) => ({
      id: doc.id,
      projectId: doc.projectId,
      title: doc.title,
      kind: doc.kind,
      updatedAt: doc.updatedAt,
    }));
  };

  /**
   * @param {{ id?: string, project?: string, title?: string }} input
   * @returns {{ id: string, projectId: string, title: string, kind: string, markdown: string, updatedAt: number, versions: Array<{ markdown: string, updatedAt: number }> } | null }
   */
  const getDocument = (input) => {
    if (typeof input?.id === 'string' && input.id !== '') {
      return state.documents.find((doc) => doc.id === input.id) ?? null;
    }
    if (
      typeof input?.project === 'string' &&
      input.project.trim() !== '' &&
      typeof input?.title === 'string' &&
      input.title.trim() !== ''
    ) {
      const projectId = resolveProject(input.project);
      return (
        state.documents.find(
          (doc) => doc.projectId === projectId && textKey(doc.title) === textKey(input.title),
        ) ?? null
      );
    }
    return null;
  };

  /**
   * Extract shot summaries from a document's markdown (prompt-sheet kind).
   * @param {{ project: string, shotId: string }} input
   * @returns {{ shotId: string, name: string, prompt: string, refs: string[], check: string, edit: string } | null }
   */
  const getShot = (input) => {
    const projectName = typeof input?.project === 'string' ? input.project : '';
    const shotId = typeof input?.shotId === 'string' ? input.shotId : '';
    const modelId = typeof input?.model === 'string' ? input.model : null;
    if (!projectName || !shotId) return null;
    const projectId = resolveProject(projectName);
    const doc = state.documents.find(
      (d) => d.projectId === projectId && d.kind === 'prompt-sheet',
    );
    if (!doc) return null;
    const shots = extractShots(doc.markdown);
    const sameShot = shots.filter((s) => s.shotId === shotId);
    if (sameShot.length === 0) return null;
    if (sameShot.length === 1) return sameShot[0];
    // Model specified: prefer that variant, else neutral, else first.
    if (modelId) {
      const match = sameShot.find((s) => s.modelId === modelId);
      if (match) return match;
    }
    const neutral = sameShot.find((s) => s.modelId === null || s.modelId === undefined);
    if (neutral) return neutral;
    return sameShot[0];
  };

  /** @param {{ id: string }} input */
  const deleteDocument = async (input) => {
    const id = typeof input?.id === 'string' ? input.id : '';
    if (!id) throw new Error('Document id is required');
    const index = state.documents.findIndex((doc) => doc.id === id);
    if (index === -1) throw new Error(`Document not found: ${id}`);
    state.documents.splice(index, 1);
    state.tombstones.push({ id, deletedAt: now() });
    if (state.tombstones.length > TOMBSTONE_CAP) {
      state.tombstones = state.tombstones.slice(-TOMBSTONE_CAP);
    }
    await persist();
    return { deleted: true, id };
  };

  /** @param {unknown} ids */
  const ack = async (ids) => {
    const set = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
    if (set.size === 0) return 0;
    let acked = 0;
    for (const prompt of state.prompts) {
      if (prompt.syncedAt === null && set.has(prompt.id)) {
        prompt.syncedAt = now();
        acked++;
      }
    }
    state.tombstones = state.tombstones.filter((tombstone) => !set.has(tombstone.id));
    await persist();
    return acked;
  };

  /** Everything the extension has not imported yet. */
  const pending = () => ({
    prompts: state.prompts.filter((prompt) => prompt.syncedAt === null),
    categories: state.categories,
    documents: state.documents.filter((doc) => doc.syncedAt === null),
    projects: state.projects.filter((project) => project.syncedAt === null),
    deleted: state.tombstones.map((tombstone) => ({ id: tombstone.id })),
  });

  /**
   * Merge the extension's library back in. Synced prompts mirror the browser;
   * prompts still queued for the extension survive the merge.
   * @param {{ prompts?: unknown, categories?: unknown, projects?: unknown, documents?: unknown }} payload
   */
  const snapshot = async (payload) => {
    const incoming = [];
    for (const raw of asArray(payload?.prompts)) {
      const prompt = normalizeStored(raw, now);
      if (prompt) {
        prompt.source = 'extension';
        prompt.syncedAt = now();
        incoming.push(prompt);
      }
    }

    /** @type {Map<string, any>} */
    const byId = new Map(incoming.map((prompt) => [prompt.id, prompt]));
    for (const prompt of state.prompts) {
      if (prompt.syncedAt === null && !byId.has(prompt.id)) byId.set(prompt.id, prompt);
    }
    state.prompts = [...byId.values()];

    /** @type {Map<string, any>} */
    const categories = new Map();
    for (const raw of asArray(payload?.categories)) {
      if (!isRecord(raw)) continue;
      if (typeof raw.id !== 'string' || raw.id === '') continue;
      if (typeof raw.name !== 'string' || raw.name.trim() === '') continue;
      categories.set(raw.id, {
        id: raw.id,
        name: raw.name.trim(),
        color: typeof raw.color === 'string' ? raw.color : PALETTE[categories.size % PALETTE.length],
        icon: typeof raw.icon === 'string' ? raw.icon : '📁',
        order: Number.isFinite(raw.order) ? Number(raw.order) : categories.size,
      });
    }
    // Keep local categories that a still-pending prompt refers to.
    const used = new Set(state.prompts.map((prompt) => prompt.categoryId).filter(Boolean));
    for (const category of state.categories) {
      if (used.has(category.id) && !categories.has(category.id)) {
        categories.set(category.id, category);
      }
    }
    state.categories = [...categories.values()];

    // Merge projects from the extension (same id-based merge as categories).
    const projectsMap = new Map();
    for (const raw of asArray(payload?.projects)) {
      if (!isRecord(raw)) continue;
      if (typeof raw.id !== 'string' || raw.id === '') continue;
      if (typeof raw.name !== 'string' || raw.name.trim() === '') continue;
      projectsMap.set(raw.id, {
        id: raw.id,
        name: raw.name.trim(),
        color: typeof raw.color === 'string' ? raw.color : PALETTE[projectsMap.size % PALETTE.length],
        icon: typeof raw.icon === 'string' ? raw.icon : '📁',
        description: typeof raw.description === 'string' ? raw.description : '',
        order: Number.isFinite(raw.order) ? Number(raw.order) : projectsMap.size,
        createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now(),
      });
    }
    for (const project of state.projects) {
      if (project.syncedAt === null && !projectsMap.has(project.id)) projectsMap.set(project.id, project);
    }
    state.projects = [...projectsMap.values()];

    // Merge documents from the extension.
    const docsMap = new Map();
    for (const raw of asArray(payload?.documents)) {
      const doc = normalizeDocument(raw, now);
      if (doc) {
        doc.source = 'extension';
        doc.syncedAt = now();
        docsMap.set(doc.id, doc);
      }
    }
    for (const doc of state.documents) {
      if (doc.syncedAt === null && !docsMap.has(doc.id)) docsMap.set(doc.id, doc);
    }
    state.documents = [...docsMap.values()];

    await persist();
    return {
      stored: state.prompts.length,
      projects: state.projects.length,
      documents: state.documents.length,
    };
  };

  return {
    path: libraryPath,
    home,
    token,
    port: activePort,
    recovered: loaded.recovered,
    listPrompts: () => state.prompts,
    listCategories: () => state.categories,
    listProjects,
    listDocuments,
    savePrompt,
    updatePrompt,
    deletePrompt,
    saveDocument,
    getDocument,
    getShot,
    deleteDocument,
    listModels,
    ack,
    pending,
    snapshot,
  };
}

/* ------------------------------------------------------------------ */
/* files                                                               */
/* ------------------------------------------------------------------ */

/** @param {string} path */
async function readBridge(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (isRecord(parsed) && typeof parsed.token === 'string' && /^[a-f0-9]{48}$/.test(parsed.token)) {
      return { token: parsed.token };
    }
  } catch {
    // Missing or corrupt — a fresh token is generated below.
  }
  return null;
}

/**
 * @param {string} path
 * @param {() => number} now
 */
async function readLibrary(path, now) {
  /** @type {unknown} */
  let parsed = null;
  let recovered = false;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    recovered = !(error && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT');
  }
  if (!isRecord(parsed)) {
    return { prompts: [], categories: [], tombstones: [], projects: [], documents: [], recovered };
  }
  return {
    prompts: asArray(parsed.prompts).map((raw) => normalizeStored(raw, now)).filter(Boolean),
    categories: asArray(parsed.categories)
      .filter(
        (raw) =>
          isRecord(raw) && typeof raw.id === 'string' && raw.id !== '' && typeof raw.name === 'string',
      )
      .map((raw) => ({
        id: raw.id,
        name: String(raw.name).trim(),
        color: typeof raw.color === 'string' ? raw.color : PALETTE[0],
        icon: typeof raw.icon === 'string' ? raw.icon : '📁',
        order: Number.isFinite(raw.order) ? Number(raw.order) : 0,
      })),
    tombstones: asArray(parsed.tombstones)
      .filter((raw) => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '')
      .map((raw) => ({ id: raw.id, deletedAt: Number.isFinite(raw.deletedAt) ? raw.deletedAt : 0 }))
      .slice(-TOMBSTONE_CAP),
    projects: asArray(parsed.projects)
      .filter(
        (raw) =>
          isRecord(raw) && typeof raw.id === 'string' && raw.id !== '' && typeof raw.name === 'string',
      )
      .map((raw) => ({
        id: raw.id,
        name: String(raw.name).trim(),
        color: typeof raw.color === 'string' ? raw.color : PALETTE[0],
        icon: typeof raw.icon === 'string' ? raw.icon : '📁',
        description: typeof raw.description === 'string' ? raw.description : '',
        order: Number.isFinite(raw.order) ? Number(raw.order) : 0,
        createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now(),
      })),
    documents: asArray(parsed.documents)
      .filter((raw) => isValidDocument(raw))
      .map((raw) => normalizeDocument(raw, now)),
    recovered,
  };
}

/* ------------------------------------------------------------------ */
/* normalization                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {unknown} raw
 * @param {() => number} now
 */
export function normalizeStored(raw, now = Date.now) {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.text !== 'string' || raw.text.trim() === '') return null;
  if (raw.text.length > MAX_TEXT) return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim() : titleFrom('', raw.text),
    text: raw.text,
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now(),
    useCount: Number.isFinite(raw.useCount) ? Number(raw.useCount) : 0,
    isFavorite: raw.isFavorite === true,
    categoryId: typeof raw.categoryId === 'string' && raw.categoryId !== '' ? raw.categoryId : null,
    tags: normalizeTags(raw.tags),
    aspectRatio: typeof raw.aspectRatio === 'string' ? raw.aspectRatio : null,
    quality: typeof raw.quality === 'string' ? raw.quality : null,
    lastUsedAt: Number.isFinite(raw.lastUsedAt) ? Number(raw.lastUsedAt) : null,
    source: raw.source === 'extension' ? 'extension' : 'mcp',
    syncedAt: Number.isFinite(raw.syncedAt) ? Number(raw.syncedAt) : raw.syncedAt === null ? null : null,
  };
}

/** @param {unknown} value */
export function normalizeTags(value) {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const tag = item.trim();
    if (tag === '' || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * @param {unknown} title
 * @param {string} text
 */
export function titleFrom(title, text) {
  if (typeof title === 'string' && title.trim() !== '') return title.trim().slice(0, 200);
  const line = text.trim().split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

/**
 * Validate a raw document object (whitelist fields, refuse empty/oversized).
 * @param {unknown} raw
 * @returns {boolean}
 */
function isValidDocument(raw) {
  if (!isRecord(raw)) return false;
  if (typeof raw.id !== 'string' || raw.id === '') return false;
  if (typeof raw.projectId !== 'string' || raw.projectId === '') return false;
  if (typeof raw.title !== 'string' || raw.title.trim() === '') return false;
  if (!KIND_VALUES.includes(/** @type {any} */ (raw.kind))) return false;
  if (typeof raw.markdown !== 'string' || raw.markdown.trim() === '') return false;
  if (raw.markdown.length > MAX_DOCUMENT_MARKDOWN) return false;
  return true;
}

/**
 * Normalize a raw document object to the MCP store schema.
 * @param {unknown} raw
 * @param {() => number} now
 */
function normalizeDocument(raw, now = Date.now) {
  if (!isValidDocument(raw)) return null;
  const kind = /** @type {any} */ (raw.kind);
  return {
    id: raw.id,
    projectId: raw.projectId,
    title: raw.title.trim(),
    kind,
    markdown: raw.markdown,
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : now(),
    versions: raw.versions && Array.isArray(raw.versions)
      ? raw.versions
          .filter(
            (v) =>
              isRecord(v) &&
              typeof v.markdown === 'string' &&
              typeof v.updatedAt === 'number' &&
              Number.isFinite(v.updatedAt),
          )
          .map((v) => ({ markdown: v.markdown, updatedAt: v.updatedAt }))
          .slice(0, MAX_DOCUMENT_VERSIONS)
      : undefined,
    source: raw.source === 'extension' ? 'extension' : 'mcp',
    syncedAt: raw.syncedAt === null ? null : null,
  };
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/** @template T @param {unknown} value @returns {T[]} */
function asArray(value) {
  return Array.isArray(value) ? /** @type {T[]} */ (value) : [];
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
