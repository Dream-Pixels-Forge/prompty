/**
 * Seed presets: starter categories + prompts for a global, film-literate prompt
 * library. Seeding is idempotent via the `presetsInitialized` / `presetsVersion`
 * storage keys, and upgrades only add what a newer version introduced — a
 * starter prompt or category the user deleted never comes back.
 */
import browser from './browser.js';
import { mergePresets, normalizeCategory, normalizePrompt } from './storage.js';

/**
 * @typedef {import('./storage.js').Category} Category
 * @typedef {import('./storage.js').Prompt} Prompt
 *
 * @typedef {object} CategoryDef
 * @property {string} name
 * @property {string} color one of CATEGORY_COLORS
 * @property {string} icon one of CATEGORY_EMOJIS
 * @property {number} since seed version that introduced it
 *
 * @typedef {object} PromptDef
 * @property {string} title
 * @property {string} text
 * @property {string} category CategoryDef.name
 * @property {string|null} aspectRatio
 * @property {string} quality
 * @property {number} since seed version that introduced it
 */

/**
 * Seed history: v1 initial · v2 the 8 generic presets + 6 categories ·
 * v3 cinematic pack (camera movement, lighting, lens, locations, grading,
 * composition, mood, VFX & transitions, posters, logos) · v4 choice variables
 * (G6) in a few starters. Bump when adding.
 */
export const PRESETS_VERSION = 4;

/** @type {CategoryDef[]} */
export const SEED_CATEGORIES = [
  { name: 'Characters', color: '#8b5cf6', icon: '👤', since: 2 },
  { name: 'Landscapes', color: '#10b981', icon: '🏔️', since: 2 },
  { name: 'Objects', color: '#f59e0b', icon: '📦', since: 2 },
  { name: 'Styles', color: '#ec4899', icon: '🎨', since: 2 },
  { name: 'Abstract', color: '#6366f1', icon: '✨', since: 2 },
  { name: 'Camera Angles', color: '#06b6d4', icon: '🎬', since: 2 },
  { name: 'Camera Movement', color: '#ef4444', icon: '🎥', since: 3 },
  { name: 'Lighting', color: '#eab308', icon: '💡', since: 3 },
  { name: 'Lens & Optics', color: '#0ea5e9', icon: '🔭', since: 3 },
  { name: 'Locations', color: '#22c55e', icon: '📍', since: 3 },
  { name: 'Color Grading', color: '#d946ef', icon: '🎞️', since: 3 },
  { name: 'Composition', color: '#14b8a6', icon: '📐', since: 3 },
  { name: 'Mood & Atmosphere', color: '#64748b', icon: '🌫️', since: 3 },
  { name: 'VFX & Transitions', color: '#a855f7', icon: '🌀', since: 3 },
  { name: 'Posters', color: '#f43f5e', icon: '🖼️', since: 3 },
  { name: 'Logos', color: '#3b82f6', icon: '✒️', since: 3 },
];

/**
 * @param {string} category
 * @param {number} since
 * @param {string|null} aspectRatio
 * @param {[string, string][]} items [title, text]
 * @returns {PromptDef[]}
 */
const group = (category, since, aspectRatio, items) =>
  items.map(([title, text]) => ({ title, text, category, aspectRatio, quality: 'high', since }));

/** @type {PromptDef[]} */
const BASE_PROMPT_DEFS = [
  /* ---------------------------- v2 originals ---------------------------- */
  {
    title: 'Full-Body Character Portrait',
    text: 'Full-body portrait of {character}, {outfit}, standing in {environment}, soft rim lighting, sharp focus, highly detailed, professional photography',
    category: 'Characters',
    aspectRatio: '2:3',
    quality: 'high',
    since: 2,
  },
  {
    title: 'Character Design Sheet',
    text: 'Character design sheet for {character}, multiple views (front, side, back), expression thumbnails, clean lineart, flat colors, neutral background',
    category: 'Characters',
    aspectRatio: '1:1',
    quality: 'high',
    since: 2,
  },
  {
    title: 'Wide Scenic Landscape',
    text: 'Wide scenic landscape of {location} at {timeOfDay}, dramatic clouds, layered depth, atmospheric haze, epic scale, ultra-detailed nature photography',
    category: 'Landscapes',
    aspectRatio: '16:9',
    quality: 'high',
    since: 2,
  },
  {
    title: 'Minimalistic Landscape',
    text: 'Minimalistic landscape, {silhouette} against a {colorGradient} sky, large negative space, clean composition, muted palette, fine-art style',
    category: 'Landscapes',
    aspectRatio: '16:9',
    quality: 'standard',
    since: 2,
  },
  {
    title: 'Product-Style Object',
    text: 'Studio product shot of {object}, centered on a seamless {backgroundColor} backdrop, softbox lighting with gentle shadow, crisp reflections, commercial advertising quality',
    category: 'Objects',
    aspectRatio: '1:1',
    quality: 'high',
    since: 2,
  },
  {
    title: 'Watercolor Style',
    text: 'Watercolor painting of {subject}, loose expressive brush strokes, soft color bleeds on textured paper, white background accents, hand-painted feel',
    category: 'Styles',
    aspectRatio: '4:5',
    quality: 'standard',
    since: 2,
  },
  {
    title: 'Wide Shot',
    text: 'Wide establishing shot of {scene}, camera at eye level, subjects small in frame to establish scale and geography, cinematic composition, natural lighting',
    category: 'Camera Angles',
    aspectRatio: '16:9',
    quality: 'high',
    since: 2,
  },
  {
    title: 'Extreme Close-Up',
    text: 'Extreme close-up of {subject}, macro detail, shallow depth of field, minimal background bokeh, fine texture visible, directional soft light',
    category: 'Camera Angles',
    aspectRatio: '1:1',
    quality: 'high',
    since: 2,
  },

  /* ------------------------- v3 cinematic pack -------------------------- */
  ...group('Camera Movement', 3, '16:9', [
    [
      'Slow Push-In Reveal',
      'Slow dolly push-in on {subject} as {revealMoment}, starting wide and ending in a tight close-up, steady gimbal, foreground elements sliding past for parallax, background melting out of focus as the camera closes in, 24fps motion blur',
    ],
    [
      'Orbit 360°',
      'Smooth 360-degree orbit around {subject} at chest height, constant speed, the key light sweeping across the face as the camera circles, background streaking with parallax, ends exactly where it began for a seamless loop',
    ],
    [
      'Crane-Up Reveal',
      'Crane shot rising from ground level behind {subject}, up and over their shoulder to reveal {vista}, slight tilt down at the top, slow ease-in and ease-out, epic sense of scale',
    ],
    [
      'FPV Dive',
      'FPV drone dives off the edge of {location}, plunges down the face of the structure, banks through narrow gaps and pulls up inches above {ground} at the last second, fast and fluid, wide-angle lens',
    ],
    [
      'Dolly Zoom',
      'Dolly zoom on {subject}: the camera tracks backward while zooming in, the subject stays the same size while the background stretches away behind them, a visceral feeling of {emotion}',
    ],
    [
      'Impossible Macro-to-Wide',
      'One continuous impossible camera move: start in extreme macro on {microDetail}, pull back through it without a cut, out through a window, up above the rooftops to a wide aerial of {place}, seamless change of scale',
    ],
  ]),
  ...group('Lighting', 3, null, [
    [
      'Rembrandt Portrait',
      'Portrait of {subject} in Rembrandt lighting: a single key light high and 45° to the side, a small triangle of light on the shadow cheek, deep falloff into a dark background, painterly contrast',
    ],
    [
      'Neon Noir',
      '{subject} on a rain-slicked street at night, lit only by {neonColor} and cyan neon signs, hard colored rim light, wet reflections on the ground, deep blacks, haze catching the beams',
    ],
    [
      'Golden Hour Backlight',
      '{subject} backlit by a low golden-hour sun, a warm halo along the hair and shoulders, gentle lens flare, soft bounce fill on the face, long shadows stretching toward the camera',
    ],
    [
      'Single Practical Source',
      'Scene lit only by a {practicalLight} visible in the frame, fully motivated light, pools of warm light and deep shadow, faces half in darkness, intimate and quiet',
    ],
    [
      'Volumetric God Rays',
      'Volumetric light shafts cutting through {atmosphere} into {location}, dust particles glowing inside the beams, strong contrast between lit air and deep shadow',
    ],
  ]),
  ...group('Lens & Optics', 3, null, [
    [
      'Anamorphic Widescreen',
      '{scene}, shot on a 40mm anamorphic lens, 2.39:1 frame, oval bokeh, horizontal blue streak flares, gentle edge distortion, cinematic',
    ],
    [
      '85mm Portrait',
      '85mm f/1.4 portrait of {subject}, razor-thin depth of field, eyes tack sharp, creamy background bokeh, flattering natural compression',
    ],
    [
      'Ultra-Wide 14mm',
      '14mm ultra-wide shot of {scene} from very close to the ground, exaggerated perspective, leading lines rushing toward the vanishing point, towering sense of scale',
    ],
    [
      'Tilt-Shift Miniature',
      'Tilt-shift photograph of {scene} from high above, a narrow band of focus, heavy blur at the top and bottom of the frame, saturated colors, looks like a tiny model world',
    ],
    [
      'Vintage Swirl Bokeh',
      '{subject} photographed through a vintage lens, swirling bokeh in the background, soft glow blooming in the highlights, low contrast, fine film grain',
    ],
  ]),
  ...group('Locations', 3, '16:9', [
    [
      'Brutalist Interior',
      'Vast brutalist concrete interior, {feature}, raw board-formed concrete textures, a single shaft of daylight from a high slot window, one tiny human figure for scale',
    ],
    [
      'Rain-Soaked Night Market',
      'Crowded night market in the rain, steam rising from food stalls, string lights and umbrellas, reflections in every puddle, {detail}',
    ],
    [
      'Salt Flat Mirror',
      'Endless salt flat at {timeOfDay}, a thin layer of water mirroring the sky, a perfect horizon line, a lone {subject} standing dead center',
    ],
    [
      'Abandoned Grand Theater',
      'Abandoned grand theater, peeling gold leaf, collapsed velvet seats, a hole in the roof letting a beam of light onto the stage where {subject} stands',
    ],
    [
      'Fog Forest',
      'Dense pine forest in morning fog, layered tree silhouettes fading into white, a {element} glowing deep between the trunks',
    ],
  ]),
  ...group('Color Grading', 3, null, [
    [
      'Teal & Orange',
      '{scene}, teal and orange blockbuster grade: warm skin tones, cool teal shadows, punchy contrast, clean highlights',
    ],
    [
      'Bleach Bypass',
      '{scene}, bleach bypass look: desaturated color, crushed blacks, silvery highlights, harsh contrast and gritty texture',
    ],
    [
      'Pastel Film Stock',
      '{scene} on warm color negative film, soft pastel palette, glowing skin tones, gentle halation around the highlights, fine grain',
    ],
    [
      'High-Contrast Monochrome',
      '{scene} in high-contrast black and white, deep inky blacks, bright specular highlights, heavy grain, graphic shadows',
    ],
  ]),
  ...group('Composition', 3, null, [
    [
      'Symmetrical One-Point',
      'Perfectly symmetrical one-point perspective of {scene}, subject dead center, vanishing point at eye level, strong architectural lines converging',
    ],
    [
      'Frame Within a Frame',
      '{subject} framed through {frame} in the foreground, layered depth, the frame darker than the subject, guiding the eye inward',
    ],
    [
      'Negative Space',
      '{subject} small in the lower third, vast empty {space} filling the rest of the frame, minimalist, a feeling of isolation',
    ],
    [
      'Top-Down Overhead',
      'Directly overhead top-down shot of {subject}, flat-lay geometry, graphic shapes and long shadows, a clean deliberate arrangement',
    ],
  ]),
  ...group('Mood & Atmosphere', 3, null, [
    [
      'Dreamy Haze',
      '{scene} with soft diffusion and haze, blooming highlights, pastel light, floating particles, dreamlike and nostalgic',
    ],
    [
      'Storm Tension',
      '{scene} under a dark incoming storm, wind-whipped {element}, low green-gray light, electric tension in the moment before the first lightning strike',
    ],
    [
      'Quiet Melancholy',
      '{subject} alone by a rain-streaked window, cool blue ambient light, one warm lamp in the room, stillness, melancholy',
    ],
  ]),
  ...group('VFX & Transitions', 3, '16:9', [
    [
      'Match Cut',
      'Match cut: {objectA} in close-up becomes {objectB} in the next shot, identical framing, shape and direction of motion, seamless continuity',
    ],
    [
      'Through-the-Object',
      'The camera flies straight into {object} and passes through its surface into a completely different world: {newWorld}, one unbroken move',
    ],
    [
      'Time Freeze',
      'Frozen moment around {subject}: {action} suspended mid-air, the camera glides freely through the still scene, water droplets and debris hanging motionless',
    ],
    [
      'Mirror World Dive',
      'The camera tilts down into a puddle and keeps going into the reflected, upside-down world of {place}, gravity flips, seamless',
    ],
  ]),
  ...group('Posters', 3, '2:3', [
    [
      'Film Key Art',
      "Cinematic movie poster key art for '{title}': {hero} in dramatic silhouette against {backdrop}, strong central composition, space for the title at the top and a credits block at the bottom",
    ],
    [
      'Minimal Swiss Poster',
      'Minimalist Swiss-style poster for {event}, strict grid, one bold geometric shape, two colors only: black and {accentColor}, clean sans-serif typography, generous white space',
    ],
    [
      'Gig Poster',
      'Screen-printed gig poster for {artist}, limited three-color palette, bold hand-drawn illustration of {motif}, halftone texture, slight print misregistration',
    ],
    [
      'Teaser Poster',
      "Mysterious teaser poster: a single {object} on pure black, one thin rim of light, the tagline '{tagline}' in small caps at the bottom",
    ],
  ]),
  ...group('Logos', 3, '1:1', [
    [
      'Minimal Monogram',
      "Minimal monogram logo for '{brand}' built from the letters {letters}, geometric, single line weight, works in pure black and white, vector, centered on white",
    ],
    [
      '3D Mascot App Icon',
      'Friendly 3D mascot of a {character} for {brand}, soft rounded clay forms, glossy highlights, {accentColor} accents, on a dark rounded-square app icon',
    ],
    [
      'Emblem Badge',
      'Vintage emblem badge logo for {brand}, circular layout, {symbol} in the center, curved lettering around the edge, one-color vector',
    ],
    [
      'Custom Wordmark',
      "Custom wordmark logo '{brand}', {style} letterforms, tight kerning, one distinctive ligature, black on white, vector",
    ],
  ]),
];

/**
 * v4 (G6): turn free-text variables that are really a short list into choice
 * variables. Applied to fresh installs through SEED_PROMPT_DEFS, and on
 * upgrade only to prompts the user never edited (text still the original).
 * @type {{ title: string, find: string, replace: string, since: number }[]}
 */
const TEXT_UPGRADES = [
  {
    title: 'Wide Scenic Landscape',
    find: '{timeOfDay}',
    replace: '{timeOfDay:dawn|golden hour|blue hour|midday|night}',
    since: 4,
  },
  {
    title: 'Neon Noir',
    find: '{neonColor}',
    replace: '{neonColor:magenta|red|amber|electric blue}',
    since: 4,
  },
  {
    title: 'Anamorphic Widescreen',
    find: 'shot on a 40mm anamorphic lens',
    replace: 'shot on a {focal:32mm|40mm|50mm|75mm} anamorphic lens',
    since: 4,
  },
  {
    title: 'Salt Flat Mirror',
    find: '{timeOfDay}',
    replace: '{timeOfDay:dawn|golden hour|blue hour|night}',
    since: 4,
  },
  {
    title: 'Custom Wordmark',
    find: '{style}',
    replace: '{style:geometric|humanist|high-contrast serif|brutalist|script}',
    since: 4,
  },
];

/** Original → upgraded text for each starter that changed. */
export const SEED_TEXT_UPGRADES = TEXT_UPGRADES.map((u) => {
  const def = BASE_PROMPT_DEFS.find((d) => d.title === u.title);
  if (!def || !def.text.includes(u.find))
    throw new Error(`Prompty seed upgrade does not apply: ${u.title}`);
  return {
    title: u.title,
    from: def.text,
    to: def.text.replace(u.find, u.replace),
    since: u.since,
  };
});

/** @type {PromptDef[]} the current starter prompts (upgrades applied) */
export const SEED_PROMPT_DEFS = BASE_PROMPT_DEFS.map((def) => {
  const up = SEED_TEXT_UPGRADES.find((u) => u.title === def.title);
  return up ? { ...def, text: up.to } : def;
});

/**
 * Build normalized categories + prompts from defs. New categories are ordered
 * after `startOrder`; each prompt joins its category by name (case-insensitive)
 * among `categories` (existing + new), or stays uncategorized.
 * @param {CategoryDef[]} categoryDefs
 * @param {PromptDef[]} promptDefs
 * @param {{ categoryIds?: unknown[], promptIds?: unknown[], existingCategories?: Category[], now?: number }} [opts]
 * @returns {{ prompts: Prompt[], categories: Category[] }}
 */
function buildSeed(categoryDefs, promptDefs, opts = {}) {
  const { categoryIds = [], promptIds = [], existingCategories = [], now = Date.now() } = opts;
  let order = existingCategories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  const taken = new Set(existingCategories.map((c) => c.name.trim().toLowerCase()));
  /** @type {Category[]} */
  const categories = [];
  categoryDefs.forEach((def, i) => {
    // Never duplicate a category the user already has under any capitalization.
    if (taken.has(def.name.toLowerCase())) return;
    const category = normalizeCategory({
      name: def.name,
      color: def.color,
      icon: def.icon,
      id: categoryIds[i] ?? randomId(),
      order: order++,
    });
    if (category) categories.push(category);
  });
  /** @type {Map<string, string>} */
  const idByName = new Map();
  for (const c of [...existingCategories, ...categories]) {
    const key = c.name.trim().toLowerCase();
    if (!idByName.has(key)) idByName.set(key, c.id);
  }
  /** @type {Prompt[]} */
  const prompts = [];
  promptDefs.forEach((def, i) => {
    const prompt = normalizePrompt({
      title: def.title,
      text: def.text,
      aspectRatio: def.aspectRatio,
      quality: def.quality,
      categoryId: idByName.get(def.category.toLowerCase()) ?? null,
      id: promptIds[i] ?? randomId(),
      createdAt: now,
    });
    if (prompt) prompts.push(prompt);
  });
  return { prompts, categories };
}

/**
 * Pure factory: the full seed with injected ids (testable).
 * @param {{ categoryIds?: unknown[], promptIds?: unknown[] }} [seedIds]
 * @returns {{ prompts: Prompt[], categories: Category[] }}
 */
export function createPresetsInstance({ categoryIds = [], promptIds = [] } = {}) {
  return buildSeed(SEED_CATEGORIES, SEED_PROMPT_DEFS, { categoryIds, promptIds });
}

/**
 * Seed presets into a storage area — idempotent:
 * - never initialized → add every seed category + prompt (deduped by name/title)
 * - initialized at the current version → no-op (user data untouched)
 * - initialized at an older version → add only categories/prompts introduced
 *   after that version (deleted starters stay deleted), dedupe by name/title,
 *   join new prompts to categories by name, then bump the version
 * @param {{ get: Function, set: Function }} [area] defaults to browser.storage.local
 * @returns {Promise<void>}
 */
export async function seedPresets(area) {
  const store = area ?? browser?.storage?.local;
  if (!store) throw new Error('Prompty: storage.local is unavailable');
  const keys = ['prompts', 'categories', 'presetsInitialized', 'presetsVersion'];
  /** @type {Record<string, unknown>} */
  const raw = await store.get(keys);
  const initialized = raw.presetsInitialized === true;
  const version = typeof raw.presetsVersion === 'number' ? raw.presetsVersion : 0;

  if (initialized && version >= PRESETS_VERSION) return; // already seeded — no-op

  /** @type {Prompt[]} */
  const existingPrompts = [];
  for (const item of Array.isArray(raw.prompts) ? raw.prompts : []) {
    const normalized = normalizePrompt(item);
    if (normalized) existingPrompts.push(normalized);
  }
  /** @type {Category[]} */
  const existingCategories = [];
  for (const item of Array.isArray(raw.categories) ? raw.categories : []) {
    const normalized = normalizeCategory(item);
    if (normalized) existingCategories.push(normalized);
  }

  const since = initialized ? version : 0;
  const additions = buildSeed(
    SEED_CATEGORIES.filter((c) => c.since > since),
    SEED_PROMPT_DEFS.filter((p) => p.since > since),
    { existingCategories },
  );

  // Text upgrades only touch starters the user never edited.
  const upgraded = initialized
    ? existingPrompts.map((p) => {
        const up = SEED_TEXT_UPGRADES.find(
          (u) => u.since > since && u.title === p.title && u.from === p.text,
        );
        return up ? { ...p, text: up.to } : p;
      })
    : existingPrompts;

  await store.set({
    prompts: mergePresets(upgraded, additions.prompts),
    categories: mergePresets(existingCategories, additions.categories),
    presetsInitialized: true,
    presetsVersion: PRESETS_VERSION,
  });
}

/**
 * @returns {string}
 */
function randomId() {
  return globalThis.crypto.randomUUID();
}
