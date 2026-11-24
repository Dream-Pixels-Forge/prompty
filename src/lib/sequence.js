/**
 * G9b — Shot sequences (pure, no DOM). A sequence is a strip of shots; each
 * shot is a G9 composition plus its duration and the cut that leads OUT of
 * it into the next shot. composeSequence() writes the whole scene as one
 * prompt; {variables} shared between shots are asked once (continuity).
 */
import {
  addBlock,
  compose,
  fromTemplate,
  normalizeComposition,
  updateBlock,
} from './composition.js';
import { parseVariables } from './variables.js';

/**
 * @typedef {import('./composition.js').Composition} Composition
 *
 * @typedef {object} Shot
 * @property {string} id
 * @property {number} duration seconds, MIN_DURATION..MAX_DURATION
 * @property {string} cut one of CUT_IDS — the transition into the NEXT shot
 * @property {Composition} composition
 *
 * @typedef {object} Sequence
 * @property {string} format one of FORMAT_IDS
 * @property {Shot[]} shots
 */

/** How one shot hands over to the next. `phrase` opens the next shot in the timecoded format. */
export const CUTS = /** @type {const} */ ([
  { id: 'cut', label: 'Hard cut', phrase: 'Hard cut to', script: 'CUT TO:' },
  { id: 'match', label: 'Match cut', phrase: 'Match cut to', script: 'MATCH CUT TO:' },
  { id: 'smash', label: 'Smash cut', phrase: 'Smash cut to', script: 'SMASH CUT TO:' },
  { id: 'whip', label: 'Whip pan', phrase: 'Whip pan to', script: 'WHIP PAN TO:' },
  { id: 'dissolve', label: 'Dissolve', phrase: 'Slow dissolve to', script: 'DISSOLVE TO:' },
  {
    id: 'continuous',
    label: 'No cut (one take)',
    phrase: 'Without cutting, the camera flies on into',
    script: 'NO CUT — CAMERA CONTINUES:',
  },
]);
export const CUT_IDS = CUTS.map((c) => c.id);

/**
 * `any`: model-neutral (G9b). `model`: dialects (G9c) — only conventions with
 * a written source: the Seedance 2.5 prompt guide (BytePlus ModelArk) and the
 * field-tested Muse Video STOP rule.
 */
export const FORMATS = /** @type {const} */ ([
  {
    id: 'timecoded',
    group: 'any',
    label: 'Timecoded',
    hint: 'Shot 1 (0–4s): … Hard cut to Shot 2 (4–7s): …',
  },
  { id: 'script', group: 'any', label: 'Shot list', hint: 'SHOT 1 — 4s … CUT TO: …' },
  { id: 'one-take', group: 'any', label: 'One take', hint: 'One continuous take, cuts ignored' },
  {
    id: 'seedance',
    group: 'model',
    label: 'Seedance 2.5',
    hint: '0–4 seconds: … At 4 seconds, hard cut. 4–7 seconds: …',
  },
  {
    id: 'muse',
    group: 'model',
    label: 'Muse Video',
    hint: 'SHOT 1 (0–4 s): … STOP. HARD CUT.',
  },
]);
export const FORMAT_IDS = FORMATS.map((f) => f.id);

export const MAX_SHOTS = 12;
export const MIN_DURATION = 1;
export const MAX_DURATION = 60;
export const DEFAULT_DURATION = 4;

/** @param {unknown} n */
export function clampDuration(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_DURATION;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, v));
}

/** @returns {Composition} */
const blankComposition = () => ({ joiner: ', ', blocks: [] });

/**
 * @param {string} id
 * @param {Composition} [composition]
 * @returns {Shot}
 */
function makeShot(id, composition = blankComposition()) {
  return { id, duration: DEFAULT_DURATION, cut: 'cut', composition };
}

/**
 * @param {Composition} first the first shot's blocks (e.g. G9's emptyComposition)
 * @param {string} id
 * @returns {Sequence}
 */
export function emptySequence(first, id) {
  return { format: 'timecoded', shots: [makeShot(id, first)] };
}

/**
 * Any stored shape → a Sequence: a G9 composition becomes one shot.
 * @param {unknown} raw
 * @param {() => string} newId
 * @returns {Sequence|null}
 */
export function sequenceFrom(raw, newId) {
  const seq = normalizeSequence(raw);
  if (seq) return seq;
  const c = normalizeComposition(raw);
  return c ? { format: 'timecoded', shots: [makeShot(newId(), c)] } : null;
}

/**
 * Insert a new empty shot after `afterId` (or at the end).
 * @param {Sequence} seq
 * @param {string|null} afterId
 * @param {string} id
 * @param {Composition} [composition]
 * @returns {Sequence}
 */
export function addShot(seq, afterId, id, composition) {
  if (seq.shots.length >= MAX_SHOTS) return seq;
  const at = seq.shots.findIndex((s) => s.id === afterId);
  const shots = [...seq.shots];
  shots.splice(at === -1 ? shots.length : at + 1, 0, makeShot(id, composition));
  return { ...seq, shots };
}

/**
 * Coverage: the same setup again, right after it (new ids throughout).
 * @param {Sequence} seq
 * @param {string} id
 * @param {() => string} newId
 * @returns {Sequence}
 */
export function duplicateShot(seq, id, newId) {
  const at = seq.shots.findIndex((s) => s.id === id);
  if (at === -1 || seq.shots.length >= MAX_SHOTS) return seq;
  const src = seq.shots[at];
  const copy = {
    ...src,
    id: newId(),
    composition: {
      ...src.composition,
      blocks: src.composition.blocks.map((b) => ({ ...b, id: newId() })),
    },
  };
  const shots = [...seq.shots];
  shots.splice(at + 1, 0, copy);
  return { ...seq, shots };
}

/**
 * Remove a shot; the last remaining shot is never removed.
 * @param {Sequence} seq
 * @param {string} id
 * @returns {Sequence}
 */
export function removeShot(seq, id) {
  if (seq.shots.length <= 1) return seq;
  return { ...seq, shots: seq.shots.filter((s) => s.id !== id) };
}

/**
 * @param {Sequence} seq
 * @param {string} id
 * @param {number} delta -1 earlier, +1 later
 * @returns {Sequence}
 */
export function moveShot(seq, id, delta) {
  const from = seq.shots.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= seq.shots.length) return seq;
  const shots = [...seq.shots];
  const [s] = shots.splice(from, 1);
  shots.splice(to, 0, s);
  return { ...seq, shots };
}

/**
 * @param {Sequence} seq
 * @param {string} id
 * @param {{ duration?: unknown, cut?: string }} patch
 * @returns {Sequence}
 */
export function updateShot(seq, id, patch) {
  return {
    ...seq,
    shots: seq.shots.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s };
      if ('duration' in patch) next.duration = clampDuration(patch.duration);
      if (patch.cut !== undefined && CUT_IDS.includes(/** @type {any} */ (patch.cut)))
        next.cut = patch.cut;
      return next;
    }),
  };
}

/**
 * @param {Sequence} seq
 * @param {string} id
 * @param {Composition} composition
 * @returns {Sequence}
 */
export function setShotComposition(seq, id, composition) {
  return { ...seq, shots: seq.shots.map((s) => (s.id === id ? { ...s, composition } : s)) };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/** @param {string} text */
const sentence = (text) => `${text.trim().replace(/[\s.,;:]+$/, '')}.`;

/** @param {string} id */
const cutOf = (id) => CUTS.find((c) => c.id === id) ?? CUTS[0];

/**
 * Shots that have text, with their running timecodes.
 * @param {Sequence} seq
 * @returns {{ shot: Shot, text: string, n: number, start: number, end: number }[]}
 */
export function timeline(seq) {
  let t = 0;
  /** @type {{ shot: Shot, text: string, n: number, start: number, end: number }[]} */
  const out = [];
  for (const shot of seq.shots) {
    const text = compose(shot.composition).text;
    if (!text) continue;
    const start = t;
    t += clampDuration(shot.duration);
    out.push({ shot, text, n: out.length + 1, start, end: t });
  }
  return out;
}

/**
 * Write the whole sequence as one prompt. A one-shot sequence is exactly the
 * G9 shot (no timecodes), so single shots behave as before.
 * @param {Sequence} seq
 * @returns {{ text: string, used: number, duration: number, variables: import('./variables.js').VariableSpec[] }}
 */
export function composeSequence(seq) {
  const used = timeline(seq);
  const duration = used.length ? used[used.length - 1].end : 0;
  let text;
  if (seq.shots.length === 1) {
    text = used[0]?.text ?? '';
  } else if (seq.format === 'script') {
    text = used
      .map((u, i) => {
        const head = `SHOT ${u.n} — ${u.end - u.start}s\n${sentence(u.text)}`;
        return i === 0 ? head : `${cutOf(used[i - 1].shot.cut).script}\n\n${head}`;
      })
      .join('\n\n');
  } else if (seq.format === 'seedance') {
    text = seedanceText(seq, used);
  } else if (seq.format === 'muse') {
    text = museText(seq, used);
  } else if (seq.format === 'one-take') {
    text = used.length
      ? `One continuous take, ${duration}s, no cuts. ${used
          .map(
            (u, i) =>
              `${i === 0 ? '' : 'Then, without cutting, '}${u.start}–${u.end}s: ${sentence(u.text)}`,
          )
          .join(' ')}`
      : '';
  } else {
    text = used
      .map((u, i) => {
        const head = `Shot ${u.n} (${u.start}–${u.end}s): ${sentence(u.text)}`;
        return i === 0 ? head : `${cutOf(used[i - 1].shot.cut).phrase} ${head}`;
      })
      .join('\n');
  }
  return { text, used: used.length, duration, variables: parseVariables(text) };
}

/* ------------------------------------------------------------------ */
/* G9c: model dialects                                                 */
/* ------------------------------------------------------------------ */

/** Seedance: a cut is an event at a time point ("At 4 seconds, …"). */
const SEEDANCE_CUT = /** @type {Record<string, string>} */ ({
  cut: 'hard cut',
  match: 'match cut',
  smash: 'smash cut',
  whip: 'the camera whip-pans and completes the transition',
  dissolve: 'slow dissolve',
  continuous: 'no cut, the camera keeps moving',
});

/** Muse holds hard cuts only; a match cut names its cut point. */
const MUSE_HARD = new Set(['cut', 'match', 'smash']);

/**
 * Each shared variable written as its first full token in the shots, so a
 * choice/range/default spec is never shadowed by a bare {name}.
 * @param {string[]} texts
 * @param {string[]} names
 */
function tokensFor(texts, names) {
  const all = texts.join('\n');
  return names.map((name) => {
    const m = all.match(new RegExp(`\\{${name}(?:[:=][^{}]*)?\\}`));
    return m ? m[0] : `{${name}}`;
  });
}

/** @param {string[]} items */
const listOf = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * @param {Sequence} seq
 * @param {ReturnType<typeof timeline>} used
 */
function seedanceText(seq, used) {
  const lines = used.map((u, i) => {
    const range = `${u.start}–${u.end} seconds: ${sentence(u.text)}`;
    if (i === 0) return range;
    const cut = SEEDANCE_CUT[used[i - 1].shot.cut] ?? SEEDANCE_CUT.cut;
    return `At ${u.start} seconds, ${cut}. ${range}`;
  });
  const shared = sharedVariables(seq);
  if (shared.length && lines.length) {
    const tokens = tokensFor(
      used.map((u) => u.text),
      shared,
    );
    lines.push(
      `Keep ${listOf(tokens)} consistent in every shot: same identity, clothing, props and screen direction.`,
    );
  }
  return lines.join('\n');
}

/**
 * @param {Sequence} seq
 * @param {ReturnType<typeof timeline>} used
 */
function museText(seq, used) {
  if (used.length === 0) return '';
  const lines = used.map((u, i) => {
    const last = i === used.length - 1;
    const head = `SHOT ${u.n} (${u.start}–${u.end} s): ${sentence(u.text)} STOP.`;
    if (last) return head;
    return `${head} ${u.shot.cut === 'match' ? 'HARD CUT on a matching shape.' : 'HARD CUT.'}`;
  });
  const shared = sharedVariables(seq);
  if (shared.length) {
    const tokens = tokensFor(
      used.map((u) => u.text),
      shared,
    );
    lines.unshift(
      `The same ${listOf(tokens)} in every shot, exactly as first shown, never redesigned.`,
    );
  }
  if (used.length > 1) lines.push('Hard cuts only, no dissolves, no morphs, no whip transitions.');
  return lines.join('\n');
}

/**
 * Variable names used in two or more shots that have text (continuity).
 * @param {Sequence} seq
 * @returns {string[]}
 */
export function sharedVariables(seq) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const u of timeline(seq)) {
    for (const spec of parseVariables(u.text)) seen.set(spec.name, (seen.get(spec.name) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n >= 2).map(([name]) => name);
}

/** Muse starts dropping clauses above about this many words (field notes). */
export const MUSE_WORD_LIMIT = 260;

/**
 * Warnings and tips for the current format.
 * @param {Sequence} seq
 * @returns {{ level: 'warn'|'info', text: string, key: string, args: (string|number)[] }[]}
 *   `text` is English; `key`/`args` let the UI show it in the user's language.
 */
export function lintSequence(seq) {
  /** @type {{ level: 'warn'|'info', text: string, key: string, args: (string|number)[] }[]} */
  const out = [];
  const used = timeline(seq);
  if (seq.shots.length < 2 || used.length === 0) return out;
  const duration = used[used.length - 1].end;
  if (seq.format === 'muse') {
    if (used.length > 4)
      out.push({
        level: 'warn',
        key: 'lintMuseShots',
        args: [used.length],
        text: `${used.length} shots in one Muse clip: identity drifts with every cut. Keep it to 4, or generate the shots separately.`,
      });
    const short = used.filter((u) => u.end - u.start < 2).map((u) => u.n);
    if (short.length)
      out.push({
        level: 'warn',
        key: 'lintMuseShort',
        args: [short.join(', ')],
        text: `Shot ${listOf(short.map(String))} under 2 s: Muse reads shots of 2 s or more clearly.`,
      });
    const softCuts = used.slice(0, -1).filter((u) => !MUSE_HARD.has(u.shot.cut));
    const soft = softCuts.map((u) => cutOf(u.shot.cut).label.toLowerCase());
    if (soft.length)
      out.push({
        level: 'warn',
        key: 'lintMuseSoft',
        args: [[...new Set(softCuts.map((u) => u.shot.cut))].join(',')],
        text: `Muse holds hard cuts only: ${listOf([...new Set(soft)])} will be written as a hard cut.`,
      });
    const words = composeSequence(seq).text.split(/\s+/).filter(Boolean).length;
    if (words > MUSE_WORD_LIMIT)
      out.push({
        level: 'warn',
        key: 'lintMuseWords',
        args: [words, MUSE_WORD_LIMIT],
        text: `${words} words: above about ${MUSE_WORD_LIMIT} Muse starts dropping clauses. Trim the blocks.`,
      });
  } else if (seq.format === 'seedance') {
    out.push({
      level: 'info',
      key: 'lintSeedanceDuration',
      args: [duration],
      text: `Set the duration to ${duration} s on the generation page. Seedance takes it from the settings, not the prompt.`,
    });
  } else if (
    seq.format === 'one-take' &&
    used.slice(0, -1).some((u) => u.shot.cut !== 'continuous')
  ) {
    out.push({
      level: 'info',
      key: 'lintOneTake',
      args: [],
      text: 'One take: the cuts between shots are ignored.',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* G9c: which dialect for which site                                   */
/* ------------------------------------------------------------------ */

/** Hosts confirmed to run a dialect's model. Everything else is learned from the user's choices. */
export const DIALECT_HOSTS = /** @type {const} */ ([
  { host: 'dreamina.capcut.com', format: 'seedance' },
  { host: 'jimeng.jianying.com', format: 'seedance' },
  { host: 'console.byteplus.com', format: 'seedance' },
  { host: 'meta.ai', format: 'muse' }, // Meta's Muse Video (confirmed by the project owner)
  { host: 'www.meta.ai', format: 'muse' },
]);
export const MAX_REMEMBERED_SITES = 50;

/** @param {unknown} origin */
const isWebOrigin = (origin) => typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin);

/**
 * The format to suggest on a site: what the user picked there last, else a built-in host.
 * @param {string} origin e.g. "https://dreamina.capcut.com"
 * @param {unknown} remembered composerTargets from storage
 * @returns {string|null}
 */
export function suggestFormat(origin, remembered) {
  if (!isWebOrigin(origin)) return null;
  const map = normalizeTargets(remembered);
  if (map[origin]) return map[origin];
  const host = origin.replace(/^https?:\/\//, '');
  return DIALECT_HOSTS.find((d) => d.host === host)?.format ?? null;
}

/**
 * Remember the format picked on a site (most recent last; oldest dropped past the cap).
 * @param {unknown} remembered
 * @param {string} origin
 * @param {string} format
 * @returns {Record<string, string>}
 */
export function rememberFormat(remembered, origin, format) {
  const map = normalizeTargets(remembered);
  if (!isWebOrigin(origin) || !FORMAT_IDS.includes(/** @type {any} */ (format))) return map;
  delete map[origin];
  map[origin] = format;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_SITES))) delete map[k];
  return map;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeTargets(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (isWebOrigin(k) && FORMAT_IDS.includes(/** @type {any} */ (v)))
      out[k] = /** @type {string} */ (v);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Starter sequence (seed prompts, found by title)                     */
/* ------------------------------------------------------------------ */

/**
 * A three-beat scene told in cuts. {hero} is a continuity variable: asked
 * once, the same person in every shot. A raindrop on an eyelash (impossible
 * macro pull-out) match-cuts on its round shape to a neon sign in a night
 * market, then smash-cuts to silence: a tiny figure on a golden salt flat.
 */
export const SEQUENCE_TEMPLATES = /** @type {const} */ ([
  {
    id: 'three-beat-reveal',
    name: 'Three-beat reveal',
    shots: [
      {
        template: 'impossible-macro-to-wide',
        subject: "a single raindrop trembling on {hero}'s eyelash",
        duration: 4,
        cut: 'match',
      },
      {
        template: 'neon-noir-push-in',
        subject: '{hero} under a round flickering neon sign, rain sliding down the face',
        duration: 3,
        cut: 'smash',
      },
      {
        template: 'golden-hour-crane-reveal',
        subject: '{hero}, now tiny and utterly still, alone at the edge of the horizon',
        duration: 5,
        cut: 'cut',
      },
    ],
  },
]);

/**
 * Build a starter sequence from the user's current prompts (G9 templates per
 * shot, found by title) plus each shot's free-text subject block.
 * @param {string} id
 * @param {import('./storage.js').Prompt[]} prompts
 * @param {() => string} newId
 * @returns {Sequence|null}
 */
export function fromSequenceTemplate(id, prompts, newId) {
  const t = SEQUENCE_TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  /** @type {Shot[]} */
  const shots = t.shots.map((s) => {
    let c = fromTemplate(s.template, prompts, () => newId()) ?? blankComposition();
    // The starter prompts say {subject}; in this scene the subject is {hero}, so it's asked once.
    c = {
      ...c,
      blocks: c.blocks.map((b) => ({ ...b, text: b.text.replace(/\{subject(?=[}:=])/g, '{hero') })),
    };
    const blockId = newId();
    c = updateBlock(addBlock(c, 'subject', blockId), blockId, { text: s.subject });
    return { id: newId(), duration: s.duration, cut: s.cut, composition: c };
  });
  return { format: 'timecoded', shots };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/**
 * Whitelist a stored sequence. Shots keep empty compositions (a draft can
 * have blank shots). Null when the value is not a sequence.
 * @param {unknown} raw
 * @returns {Sequence|null}
 */
export function normalizeSequence(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (!Array.isArray(r.shots)) return null;
  /** @type {Shot[]} */
  const shots = [];
  r.shots.forEach((item, i) => {
    if (shots.length >= MAX_SHOTS || !item || typeof item !== 'object' || Array.isArray(item))
      return;
    const s = /** @type {Record<string, unknown>} */ (item);
    const comp = s.composition;
    const joiner =
      comp && typeof comp === 'object' && /** @type {any} */ (comp).joiner === '. ' ? '. ' : ', ';
    shots.push({
      id: typeof s.id === 'string' && s.id !== '' ? s.id : `s${i}`,
      duration: clampDuration(s.duration),
      cut: CUT_IDS.includes(/** @type {any} */ (s.cut)) ? /** @type {string} */ (s.cut) : 'cut',
      composition: normalizeComposition(comp) ?? { joiner, blocks: [] },
    });
  });
  if (shots.length === 0) return null;
  const format = FORMAT_IDS.includes(/** @type {any} */ (r.format))
    ? /** @type {string} */ (r.format)
    : 'timecoded';
  return { format, shots };
}

/**
 * `Prompt.composition` on disk: a G9 composition or a G9b sequence.
 * @param {unknown} raw
 * @returns {Composition|Sequence|null}
 */
export function normalizeStoredComposition(raw) {
  if (raw && typeof raw === 'object' && Array.isArray(/** @type {any} */ (raw).shots)) {
    const seq = normalizeSequence(raw);
    return seq && seq.shots.some((s) => s.composition.blocks.length > 0) ? seq : null;
  }
  return normalizeComposition(raw);
}

/**
 * What to store on a saved prompt: one shot stays a plain G9 composition
 * (older builds can still open it); several shots are stored as a sequence.
 * @param {Sequence} seq
 * @returns {Composition|Sequence}
 */
export function storedComposition(seq) {
  return seq.shots.length === 1 ? seq.shots[0].composition : seq;
}
