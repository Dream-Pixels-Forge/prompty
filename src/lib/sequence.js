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

export const FORMATS = /** @type {const} */ ([
  { id: 'timecoded', label: 'Timecoded', hint: 'Shot 1 (0–4s): … Hard cut to Shot 2 (4–7s): …' },
  { id: 'script', label: 'Shot list', hint: 'SHOT 1 — 4s … CUT TO: …' },
  { id: 'one-take', label: 'One take', hint: 'One continuous take, cuts ignored' },
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
  let text = '';
  if (seq.shots.length === 1) {
    text = used[0]?.text ?? '';
  } else if (seq.format === 'script') {
    text = used
      .map((u, i) => {
        const head = `SHOT ${u.n} — ${u.end - u.start}s\n${sentence(u.text)}`;
        return i === 0 ? head : `${cutOf(used[i - 1].shot.cut).script}\n\n${head}`;
      })
      .join('\n\n');
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
