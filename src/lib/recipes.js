/**
 * Site Recipes — data-driven save/insert anchors for AI generation sites.
 * Pure ES module, zero DOM/API. Exports schema, matching, validation.
 */

/**
 * @typedef {object} Recipe
 * @property {string} originPattern - Glob-style pattern to match origin (e.g. '*.higgsfield.ai', 'chat.openai.com/*')
 * @property {string[]} promptInput - CSS selectors for prompt input fields (ordered by priority)
 * @property {string[]} submit - CSS selectors for submit/generate buttons (ordered by priority)
 * @property {object} selects - Selectors for aspect ratio and quality dropdowns
 * @property {string} selects.aspect - CSS selector for aspect ratio select
 * @property {string} selects.quality - CSS selector for quality select
 * @property {string[]} qualityValues - Valid quality option values
 * @property {string} [notes] - Optional human-readable notes
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {string[]} errors
 */

/**
 * Validate a recipe object against the schema.
 * @param {unknown} recipe
 * @returns {ValidationResult}
 */
export function validateRecipe(recipe) {
  const errors = [];

  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    errors.push('Recipe must be an object');
    return { ok: false, errors };
  }

  const r = /** @type {Record<string, unknown>} */ (recipe);

  if (typeof r.originPattern !== 'string' || r.originPattern.trim() === '') {
    errors.push('originPattern is required and must be a non-empty string');
  }

  if (!Array.isArray(r.promptInput)) {
    errors.push('promptInput must be an array of strings');
  } else if (!r.promptInput.every((s) => typeof s === 'string' && s.trim() !== '')) {
    errors.push('promptInput must contain only non-empty strings');
  }

  if (!Array.isArray(r.submit)) {
    errors.push('submit must be an array of strings');
  } else if (!r.submit.every((s) => typeof s === 'string' && s.trim() !== '')) {
    errors.push('submit must contain only non-empty strings');
  }

  if (!r.selects || typeof r.selects !== 'object' || Array.isArray(r.selects)) {
    errors.push('selects must be an object with aspect and quality properties');
  } else {
    const selects = /** @type {Record<string, unknown>} */ (r.selects);
    if (typeof selects.aspect !== 'string' || selects.aspect.trim() === '') {
      errors.push('selects.aspect is required and must be a non-empty string');
    }
    if (typeof selects.quality !== 'string' || selects.quality.trim() === '') {
      errors.push('selects.quality is required and must be a non-empty string');
    }
  }

  if (!Array.isArray(r.qualityValues)) {
    errors.push('qualityValues must be an array of strings');
  } else if (!r.qualityValues.every((s) => typeof s === 'string' && s.trim() !== '')) {
    errors.push('qualityValues must contain only non-empty strings');
  }

  if (r.notes !== undefined && typeof r.notes !== 'string') {
    errors.push('notes must be a string if provided');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Check if a URL matches a glob-style pattern.
 * Matches against the host + pathname (without protocol) with minimatch-like logic.
 * Supports * at start, end, or both (e.g., '*.example.com/*', 'example.com/*', 'example.com').
 * @param {string} url - Full URL to test
 * @param {string} pattern - Glob-style pattern
 * @returns {boolean}
 */
export function matchOriginPattern(url, pattern) {
  if (typeof url !== 'string' || typeof pattern !== 'string') return false;

  let hostPath;
  try {
    const u = new URL(url);
    hostPath = u.host + u.pathname;
  } catch {
    return false;
  }

  // Escape regex special chars except *
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(hostPath);
}

/**
 * Find the first recipe that matches the given URL.
 * @param {string} url - Full URL to match
 * @param {Recipe[]} recipes - Array of recipe objects
 * @returns {Recipe|null} The first matching recipe, or null if none match
 */
export function matchRecipe(url, recipes) {
  if (!Array.isArray(recipes)) return null;

  for (const recipe of recipes) {
    if (matchOriginPattern(url, recipe.originPattern)) {
      return recipe;
    }
  }
  return null;
}

/**
 * Get the default generic fallback recipe (heuristic selectors from original).
 * @returns {Recipe}
 */
export function getDefaultRecipe() {
  return {
    originPattern: '*',
    promptInput: [
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="scene" i]',
      'textarea',
      'input[type="text"][placeholder*="prompt" i]',
      '[contenteditable="true"]',
    ],
    submit: [
      'button[type="submit"]',
      'button:has-text("Generate")',
      'button:has-text("Create")',
      'button:has-text("Submit")',
      '[role="button"]:has-text("Generate")',
    ],
    selects: {
      aspect: 'select[options*="1:1" i][options*="16:9" i][options*="9:16" i]',
      quality: 'select[options*="1k" i][options*="2k" i][options*="4k" i]',
    },
    qualityValues: ['1k', '2k', '4k'],
    notes: 'Generic fallback — heuristic chain from original behavior',
  };
}

/**
 * Recipe schema JSDoc typedef for external consumers.
 * @typedef {Recipe} RECIPE_SCHEMA
 */

/**
 * Validate all recipes in an array.
 * @param {unknown[]} recipes
 * @returns {{ valid: Recipe[], invalid: { recipe: unknown, errors: string[] }[] }}
 */
export function validateRecipes(recipes) {
  if (!Array.isArray(recipes)) {
    return { valid: [], invalid: [{ recipe: recipes, errors: ['Input must be an array'] }] };
  }

  const valid = [];
  const invalid = [];

  for (const recipe of recipes) {
    const result = validateRecipe(recipe);
    if (result.ok) {
      valid.push(/** @type {Recipe} */ (recipe));
    } else {
      invalid.push({ recipe, errors: result.errors });
    }
  }

  return { valid, invalid };
}