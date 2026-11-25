/**
 * G15 — Projects view: project list → document list → document reader.
 * Pure UI over state.projects / state.documents (G15 data layer).
 * No DOM from markdown: the reader uses renderMarkdownToFragment (textContent only).
 */
import { t, tn } from '../lib/i18n.js';
import { deliverText } from './actions.js';
import { h, mount } from './dom.js';
import { openModal, documentHistoryModal, toast } from './modals.js';
import { renderMarkdownToFragment } from '../lib/markdown-renderer.js';
import { extractShotFromMarkdown, MAX_DOCUMENT_VERSIONS } from '../lib/documents.js';
import { save, state } from './store.js';
import { kindLabel, kindIcon, formatRelative, markdownPreview } from './projects-logic.js';

/** @typedef {import('../lib/documents.js').Project} Project */
/** @typedef {import('../lib/documents.js').Document} Document */
/** @typedef {import('../lib/documents.js').Shot} Shot */

const KIND_VALUES = [
  'prompt-sheet', 'screenplay', 'project-card', 'breakdown', 'rules', 'notes',
];

const DEFAULT_PROJECT_COLORS = [
  '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#84cc16',
];

const DEFAULT_PROJECT_ICONS = ['🎬', '📝', '🎭', '🎨', '📋', '🗂️', '📚', '🎯', '✨', '🔮'];

/**
 * @typedef {{ projectId: string|null, documentId: string|null,
 *   onSelectProject: (id: string) => void,
 *   onSelectDocument: (id: string) => void,
 *   onBackToProjects: () => void,
 *   onBackToDocuments: () => void,
 *   insertShot: (text: string) => void,
 *   appendShot: (text: string) => void,
 *   copyShot: (text: string) => void }} ProjectsHost
 */

/** @param {HTMLElement} root @param {ProjectsHost} host */
export function renderProjects(root, host) {
  const projectId = host.projectId;
  const documentId = host.documentId;

  if (!projectId) {
    renderProjectList(root, host);
    return;
  }

  const project = state.projects.find((p) => p.id === projectId);
  if (!project) {
    // Project vanished (deleted elsewhere): back to list.
    host.onBackToProjects();
    renderProjectList(root, host);
    return;
  }

  const docs = state.documents.filter((d) => d.projectId === projectId);

  if (!documentId) {
    renderDocumentList(root, host, project, docs);
    return;
  }

  const document = docs.find((d) => d.id === documentId);
  if (!document) {
    host.onBackToDocuments();
    renderDocumentList(root, host, project, docs);
    return;
  }

  renderDocumentReader(root, host, project, document);
}

/* ------------------------------------------------------------------ */
/* Project list                                                        */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} root @param {ProjectsHost} host */
function renderProjectList(root, host) {
  const projects = state.projects;
  const head = h(
    'div',
    { class: 'view__head' },
    h('h1', { class: 'view__title' }, `📂 ${t('navProjects')}`),
    h('span', { class: 'spacer' }),
    projects.length > 0
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            on: {
              click: async () => {
                const created = await newProjectDialog();
                if (created) host.onSelectProject(created.id);
              },
            },
          },
          t('newProjectButton'),
        )
      : h(
          'button',
          {
            class: 'btn btn--primary btn--sm',
            type: 'button',
            on: {
              click: async () => {
                const created = await newProjectDialog();
                if (created) host.onSelectProject(created.id);
              },
            },
          },
          t('newProjectButton'),
        ),
  );

  if (projects.length === 0) {
    mount(
      root,
      head,
      h(
        'div',
        { class: 'empty' },
        h('p', null, t('noProjectsYet')),
        h(
          'button',
          {
            class: 'btn btn--primary',
            type: 'button',
            on: {
              click: async () => {
                const created = await newProjectDialog();
                if (created) host.onSelectProject(created.id);
              },
            },
          },
          t('newProjectButton'),
        ),
      ),
    );
    return;
  }

  mount(
    root,
    head,
    h(
      'ul',
      { class: 'projects' },
      projects.map((p) => projectRow(p, host)),
    ),
  );
}

/** @param {import('../lib/documents.js').Project} project @param {ProjectsHost} host */
function projectRow(project, host) {
  const docCount = state.documents.filter((d) => d.projectId === project.id).length;
  const last = updatedAtOfProject(project.id);
  return h(
    'li',
    { class: 'project' },
    h(
      'button',
      {
        class: 'project__link',
        type: 'button',
        on: { click: () => host.onSelectProject(project.id) },
      },
      h('span', { class: 'project__dot', style: { background: project.color } }),
      h('span', { class: 'project__icon', 'aria-hidden': 'true' }, project.icon),
      h('span', { class: 'project__name' }, project.name),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted project__count' }, tn('documentsCount', docCount)),
      last ? h('span', { class: 'muted project__updated' }, t('updatedAgo', formatRelative(last))) : null,
    ),
  );
}

/** Latest updatedAt across a project's documents. @param {string} projectId */
function updatedAtOfProject(projectId) {
  let latest = 0;
  for (const d of state.documents) {
    if (d.projectId === projectId && d.updatedAt > latest) latest = d.updatedAt;
  }
  return latest || 0;
}

/* ------------------------------------------------------------------ */
/* New project dialog                                                  */
/* ------------------------------------------------------------------ */

/** @returns {Promise<{id:string,name:string,color:string,icon:string}|null>} */
async function newProjectDialog() {
  const name = h('input', {
    type: 'text',
    maxlength: '40',
    placeholder: t('projectNamePlaceholder'),
    'aria-label': t('projectName'),
  });
  const error = h('span', { class: 'field__error' });
  return openModal({
    title: t('newProject'),
    body: h('div', { class: 'stack' }, field(t('projectName'), name, error)),
    submitLabel: t('addProject'),
    onSubmit: () => {
      if (name.value.trim() === '') {
        error.textContent = t('projectNameRequired');
        name.focus();
        return null;
      }
      const id = crypto.randomUUID();
      return {
        id,
        name: name.value.trim(),
        color: DEFAULT_PROJECT_COLORS[state.projects.length % DEFAULT_PROJECT_COLORS.length],
        icon: DEFAULT_PROJECT_ICONS[state.projects.length % DEFAULT_PROJECT_ICONS.length],
        order: state.projects.length,
        createdAt: Date.now(),
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Document list                                                        */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} root @param {ProjectsHost} host @param {Project} project @param {Document[]} docs */
function renderDocumentList(root, host, project, docs) {
  const head = h(
    'div',
    { class: 'view__head' },
    h(
      'button',
      {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        on: { click: () => host.onBackToProjects() },
        'aria-label': t('backToProjects'),
      },
      '←',
    ),
    h('h1', { class: 'view__title' }, `${project.icon} ${project.name}`),
    h('span', { class: 'spacer' }),
    docs.length > 0
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            on: {
              click: async () => {
                const created = await newDocumentDialog(project.id);
                if (created) host.onSelectDocument(created.id);
              },
            },
          },
          t('newDocumentButton'),
        )
      : h(
          'button',
          {
            class: 'btn btn--primary btn--sm',
            type: 'button',
            on: {
              click: async () => {
                const created = await newDocumentDialog(project.id);
                if (created) host.onSelectDocument(created.id);
              },
            },
          },
          t('newDocumentButton'),
        ),
  );

  if (docs.length === 0) {
    mount(
      root,
      head,
      h(
        'div',
        { class: 'empty' },
        h('p', null, t('projectEmpty')),
        h(
          'button',
          {
            class: 'btn btn--primary',
            type: 'button',
            on: {
              click: async () => {
                const created = await newDocumentDialog(project.id);
                if (created) host.onSelectDocument(created.id);
              },
            },
          },
          t('newDocumentButton'),
        ),
      ),
    );
    return;
  }

  const shown = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
  mount(
    root,
    head,
    h(
      'ul',
      { class: 'documents' },
      shown.map((d) => documentRow(d, host)),
    ),
  );
}

/** @param {import('../lib/documents.js').Document} doc @param {ProjectsHost} host */
function documentRow(doc, host) {
  const versions = doc.versions ? doc.versions.length : 0;
  return h(
    'li',
    { class: 'document' },
    h(
      'button',
      {
        class: 'document__link',
        type: 'button',
        on: { click: () => host.onSelectDocument(doc.id) },
      },
      h('span', { class: 'document__icon', 'aria-hidden': 'true' }, kindIcon(doc.kind)),
      h('span', { class: 'document__title' }, doc.title),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted document__kind' }, kindLabel(doc.kind)),
      versions > 0
        ? h('span', { class: 'chip chip--doc' }, tn('versionCount', versions))
        : null,
      h('span', { class: 'muted document__updated' }, t('updatedAgo', formatRelative(doc.updatedAt))),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* New document dialog                                                 */
/* ------------------------------------------------------------------ */

/**
 * @param {string} projectId
 * @returns {Promise<{id:string}|null>}
 */
async function newDocumentDialog(projectId) {
  const kind = h('select', null,
    KIND_VALUES.map((k) =>
      h(
        'option',
        { value: k, selected: k === 'notes' },
        kindLabel(
          /** @type {import('../lib/documents.js').DocumentKind} */ (k),
        ),
      ),
    ),
  );
  const title = h('input', {
    type: 'text',
    maxlength: '120',
    placeholder: t('documentTitlePlaceholder'),
    'aria-label': t('documentTitle'),
  });
  const error = h('span', { class: 'field__error' });
  return openModal({
    title: t('newDocument'),
    body: h(
      'div',
      { class: 'stack' },
      field(t('documentTitle'), title, error),
      field(t('documentKind'), kind),
    ),
    submitLabel: t('addDocument'),
    onSubmit: () => {
      if (title.value.trim() === '') {
        error.textContent = t('documentTitleRequired');
        title.focus();
        return null;
      }
      const id = crypto.randomUUID();
      return {
        id,
        projectId,
        title: title.value.trim(),
        kind: /** @type {import('../lib/documents.js').DocumentKind} */ (kind.value),
        markdown: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Document reader                                                      */
/* ------------------------------------------------------------------ */

/** @param {HTMLElement} root @param {ProjectsHost} host @param {Project} project @param {Document} document */
function renderDocumentReader(root, host, project, document) {
  const versions = document.versions ? document.versions.length : 0;
  const head = h(
    'div',
    { class: 'view__head' },
    h(
      'button',
      {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        on: { click: () => host.onBackToDocuments() },
        'aria-label': t('backToDocuments'),
      },
      '←',
    ),
    h('h1', { class: 'view__title' }, document.title),
    h('span', { class: 'spacer' }),
    versions > 0
      ? h('span', { class: 'chip chip--doc' }, tn('versionCount', versions))
      : null,
    versions > 0
      ? h(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            'aria-label': t('documentVersions'),
            on: {
              click: async () => {
                const selected = await documentHistoryModal(document);
                if (selected !== null && selected !== undefined) {
                  await restoreDocumentVersion(document, selected);
                  toast(t('versionRestored'));
                }
              },
            },
          },
          '🕘',
        )
      : null,
    h('span', { class: 'muted document__kind' }, kindLabel(document.kind)),
  );

  const body = h('div', { class: 'document__body' });
  try {
    body.appendChild(renderMarkdownToFragment(document.markdown));
  } catch {
    body.appendChild(h('p', { class: 'error' }, t('documentTooLarge')));
  }
  mount(body, h('hr', { class: 'document__divider' }));

  const shots =
    document.kind === 'prompt-sheet'
      ? extractShotFromMarkdown(document.markdown, document.id, project.name)
      : [];

  if (shots.length > 0) {
    const shotsHead = h(
      'div',
      { class: 'view__head' },
      h('h2', { class: 'view__title' }, `📋 ${t('shotsIn', document.title)}`),
    );
    mount(body, shotsHead, h('ul', { class: 'shots' }, shots.map((s) => shotRow(s))));
  }

  mount(root, head, body);
}

/** @param {Shot} shot */
function shotRow(shot) {
  return h(
    'li',
    { class: 'shot' },
    h('div', { class: 'shot__head' },
      h('span', { class: 'shot__id', 'aria-hidden': 'true' }, shot.shotId),
      h('span', { class: 'shot__name' }, shot.name),
      h('span', { class: 'spacer' }),
      shot.modelId ? h('span', { class: 'chip chip--model' }, shot.modelId) : null,
    ),
    h('p', { class: 'shot__text' }, markdownPreview(shot.prompt)),
    h(
      'div',
      { class: 'shot__actions' },
      h(
        'button',
        { class: 'btn btn--primary btn--sm', type: 'button', on: { click: () => void putShot(shot.prompt, 'insert') } },
        t('insertShot'),
      ),
      h(
        'button',
        { class: 'btn btn--sm', type: 'button', on: { click: () => void putShot(shot.prompt, 'append') } },
        t('appendShot'),
      ),
      h(
        'button',
        { class: 'btn btn--sm', type: 'button', on: { click: () => void putShot(shot.prompt, 'copy') } },
        t('copyShot'),
      ),
      h('span', { class: 'spacer' }),
      shot.refs.length > 0 ? h('span', { class: 'muted shot__refs' }, `${t('shotRefs')}: ${shot.refs.join(', ')}`) : null,
      shot.edit ? h('span', { class: 'muted shot__edit' }, `${t('shotEdit')}: ${shot.edit}`) : null,
      shot.check ? h('span', { class: 'muted shot__check' }, `${t('shotCheck')}: ${shot.check}`) : null,
    ),
  );
}

/** @param {string} text @param {'insert'|'append'|'copy'} mode */
async function putShot(text, mode) {
  if (mode === 'copy') {
    void deliverText(text, 'copy');
    return;
  }
  const ok = await deliverText(text, mode);
  if (ok) window.close();
}

/**
 * Restore an older document version: the current markdown becomes a new
 * version and the selected version becomes current (G5-style versioning).
 * @param {import('../lib/documents.js').Document} document
 * @param {number} index index into document.versions (oldest = 0)
 */
async function restoreDocumentVersion(document, index) {
  const version = document.versions?.[index];
  if (!version) return;
  const updated = {
    ...document,
    markdown: version.markdown,
    updatedAt: Date.now(),
    versions: [{ markdown: document.markdown, updatedAt: document.updatedAt }]
      .concat(document.versions ?? [])
      .slice(0, MAX_DOCUMENT_VERSIONS),
  };
  const docs = state.documents.map((d) => (d.id === document.id ? updated : d));
  await save({ documents: docs });
}

/* ------------------------------------------------------------------ */
/* internals                                                           */

/** @param {string} label @param {HTMLElement} control @param {HTMLElement} [error] */
function field(label, control, error) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label' }, label),
    control,
    error,
  );
}
