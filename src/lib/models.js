/**
 * G15b — Model profiles (pure).
 *
 * One entry per video generation model: dialect, wrapper, limits, reference
 * slots, durations, aspect ratios. Every number comes from the vendor's own
 * documentation and is cited in `profile.source`; anything not sourced is
 * `null` with `verified: false` — never guessed (G15b anti-drift rule).
 *
 * The catalog ships in `src/assets/models.json` (bundled, no network). Users
 * can add or override profiles in Settings (validated like custom site
 * recipes); `normalizeModel` applies the same whitelist/coercion.
 */
import modelsCatalog from '../assets/models.json';

/**
 * @typedef {object} ModelProfile
 * @property {string} id
 * @property {string} label
 * @property {string[]} hosts
 * @property {string} dialect   // one of DIALECT_VALUES (validated at runtime)
 * @property {string|null} wrapper  // one of WRAPPER_VALUES or null (validated at runtime)
 * @property {number|null} maxPromptChars
 * @property {boolean} negativePrompt
 * @property {{ images: number, videos: number, audio: number }} refSlots
 * @property {number[]|null} durations
 * @property {string[]|null} aspectRatios
 * @property {string} notes
 * @property {string} source
 * @property {boolean} verified
 */

/** Recognized dialects (G9c + G15b). */
export const DIALECT_VALUES = /** @type {const} */ (
  ['muse', 'seedance', 'timecoded', 'script', 'one-take']
);

/** Wrapper template ids shipped with G15b. */
export const WRAPPER_VALUES = /** @type {const} */ (['meta-ai-pass-through', null]);

/**
 * All shipped model profiles (a copy, so callers cannot mutate the catalog).
 * @returns {ModelProfile[]}
 */
export function listModels() {
  return modelsCatalog.map((m) => ({ ...m }));
}

/**
 * Look up a profile by id.
 * @param {string} id
 * @returns {ModelProfile|undefined}
 */
export function getModel(id) {
  return modelsCatalog.find((m) => m.id === id);
}

/**
 * Match an active-tab origin to the profile whose `hosts[]` contains it
 * (exact origin match, case-insensitive, ignoring port). Returns undefined
 * when no profile claims the site.
 * @param {string|null|undefined} origin e.g. "https://meta.ai"
 * @returns {ModelProfile|undefined}
 */
export function modelForOrigin(origin) {
  if (typeof origin !== 'string' || origin === '') return undefined;
  // Accept a full URL or an origin; extract the host.
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    host = origin.replace(/^https?:\/\//, '');
  }
  const hostNoPort = host.toLowerCase().replace(/:.*$/, '');
  return modelsCatalog.find((m) =>
    Array.isArray(m.hosts)
      ? m.hosts.some((h) => h.toLowerCase().replace(/:.*$/, '') === hostNoPort)
      : false,
  );
}

/**
 * Whitelist and coerce a stored/user model profile. Invalid profiles return
 * null; unknown fields are dropped; numeric limits without a `source` are
 * coerced to null (anti-drift: never trust an unsourced number).
 * @param {unknown} raw
 * @returns {ModelProfile|null}
 */
export function normalizeModel(raw) {
  if (!isRecord(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = stringOr(r.id);
  if (!id) return null;
  const existing = getModel(id);
  const label = stringOr(r.label, id);
  const dialect =
    typeof r.dialect === 'string' &&
    DIALECT_VALUES.includes(/** @type {any} */ (r.dialect))
      ? r.dialect
      : (existing ? existing.dialect : 'timecoded');
  const wrapper =
    r.wrapper === null ||
    (typeof r.wrapper === 'string' &&
      WRAPPER_VALUES.includes(/** @type {any} */ (r.wrapper)))
      ? r.wrapper
      : (existing ? existing.wrapper : null);
  const hosts = stringArrayCoerce(r.hosts);
  const maxPromptChars = coerceLimit(r.maxPromptChars, stringOr(r.source));
  const negativePrompt = boolOr(r.negativePrompt, false);
  const refSlots = normalizeRefSlots(r.refSlots, existing);
  const durations = numberArrayCoerce(r.durations);
  const aspectRatios = stringArrayCoerce(r.aspectRatios);
  const notes = stringOr(r.notes);
  const source = stringOr(r.source);
  const verified = boolOr(r.verified, false);

  return {
    id,
    label,
    hosts,
    dialect,
    wrapper,
    maxPromptChars,
    negativePrompt,
    refSlots,
    durations,
    aspectRatios,
    notes,
    source,
    verified,
  };
}

/**
 * A numeric limit is only trusted when the profile cites a source.
 * @param {unknown} value
 * @param {string} source
 * @returns {number|null}
 */
function coerceLimit(value, source) {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : null;
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  return source === '' || source === null ? null : n;
}

/**
 * @param {unknown} value
 * @param {ModelProfile|undefined} existing
 * @returns {{ images: number, videos: number, audio: number }}
 */
function normalizeRefSlots(value, existing) {
  const fallback = existing ? existing.refSlots : { images: 0, videos: 0, audio: 0 };
  if (!isRecord(value)) return { ...fallback };
  const v = /** @type {Record<string, unknown>} */ (value);
  return {
    images: coerceRef(v.images, fallback.images),
    videos: coerceRef(v.videos, fallback.videos),
    audio: coerceRef(v.audio, fallback.audio),
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function coerceRef(value, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return n === null ? fallback : n;
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function numberArrayCoerce(value) {
  if (!Array.isArray(value)) return [];
  /** @type {number[]} */
  const out = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item) && item > 0) out.push(item);
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArrayCoerce(value) {
  if (!Array.isArray(value)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const s = stringOr(item).trim();
    if (s === '' || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function boolOr(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return fallback;
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function stringOr(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Model checks (lint)                                                */
/* ------------------------------------------------------------------ */

/**
 * Lint a shot's prompt text against a model profile. Warnings only; never
 * block insert. Generation parameters (duration, aspect ratio) are flagged
 * when written inside the prompt where the model takes them as parameters.
 * @param {{ text: string, refs?: string[], duration?: number | null, aspectRatio?: string | null }} shot
 * @param {ModelProfile | undefined} model
 * @returns {Array<{ key: string, text: string }>}
 */
export function lintForModel(shot, model) {
  if (!model) return [];
  /** @type {Array<{ key: string, text: string }>} */
  const out = [];
  const text = typeof shot?.text === 'string' ? shot.text : '';
  const refs = Array.isArray(shot?.refs) ? shot.refs : [];
  const duration = typeof shot?.duration === 'number' ? shot.duration : null;
  const aspectRatio = typeof shot?.aspectRatio === 'string' ? shot.aspectRatio : null;

  if (model.maxPromptChars !== null && text.length > model.maxPromptChars) {
    out.push({
      key: 'lintModelChars',
      text: `${text.length} chars: ${model.label} accepts about ${model.maxPromptChars}; trim the prompt.`,
    });
  }

  const imageRefs = refs.filter((r) => r.startsWith('@image') || r.startsWith('@img')).length;
  const videoRefs = refs.filter((r) => r.startsWith('@video') || r.startsWith('@vid')).length;
  const audioRefs = refs.filter((r) => r.startsWith('@audio') || r.startsWith('@snd')).length;
  const slots = model.refSlots ?? { images: 0, videos: 0, audio: 0 };
  if (imageRefs > slots.images) {
    out.push({
      key: 'lintModelRefs',
      text: `${imageRefs} image refs: ${model.label} takes ${slots.images} image reference slot(s).`,
    });
  }
  if (videoRefs > slots.videos) {
    out.push({
      key: 'lintModelRefs',
      text: `${videoRefs} video refs: ${model.label} takes ${slots.videos} video reference slot(s).`,
    });
  }
  if (audioRefs > slots.audio) {
    out.push({
      key: 'lintModelRefs',
      text: `${audioRefs} audio refs: ${model.label} takes ${slots.audio} audio reference slot(s).`,
    });
  }

  // Negative-prompt section on a model without the field.
  if (/negative\s*prompt/i.test(text) && model.negativePrompt !== true) {
    out.push({
      key: 'lintModelNegative',
      text: `Negative-prompt section present but ${model.label} has no negative-prompt field.`,
    });
  }

  // Duration / aspect written inside the prompt where the model takes them as parameters.
  if (model.durations != null && model.durations.length > 0 && duration === null) {
    if (/\b\d+\s*s(?:econds?)?\b/i.test(text)) {
      out.push({
        key: 'lintModelDuration',
        text: `${model.label} takes duration as a parameter — don't bake seconds into the prompt.`,
      });
    }
  }
  if (model.aspectRatios != null && model.aspectRatios.length > 0 && aspectRatio === null) {
    if (/\b\d+\s*:\s*\d+\b/.test(text)) {
      out.push({
        key: 'lintModelAspect',
        text: `${model.label} takes aspect ratio as a parameter — don't bake "X:Y" into the prompt.`,
      });
    }
  }

  return out;
}
