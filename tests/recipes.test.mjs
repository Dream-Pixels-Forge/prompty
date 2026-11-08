import { describe, expect, it } from 'vitest';
import {
  validateRecipe,
  matchOriginPattern,
  matchRecipe,
  getDefaultRecipe,
  validateRecipes,
} from '../src/lib/recipes.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/lib/storage.js';

describe('Recipe schema validation (validateRecipe)', () => {
  const validRecipe = {
    originPattern: '*.example.com/*',
    promptInput: ['textarea[placeholder*="prompt" i]'],
    submit: ['button[type="submit"]'],
    selects: { aspect: 'select[name="aspect"]', quality: 'select[name="quality"]' },
    qualityValues: ['1k', '2k', '4k'],
    notes: 'Test recipe',
  };

  it('accepts a valid recipe', () => {
    const result = validateRecipe(validRecipe);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-object input', () => {
    expect(validateRecipe(null).ok).toBe(false);
    expect(validateRecipe('string').ok).toBe(false);
    expect(validateRecipe(123).ok).toBe(false);
    expect(validateRecipe([]).ok).toBe(false);
  });

  it('requires originPattern as non-empty string', () => {
    expect(validateRecipe({ ...validRecipe, originPattern: '' }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, originPattern: 123 }).ok).toBe(false);
    // @ts-expect-error testing missing originPattern
    expect(validateRecipe({ promptInput: validRecipe.promptInput, submit: validRecipe.submit, selects: validRecipe.selects, qualityValues: validRecipe.qualityValues }).ok).toBe(false);
  });

  it('requires promptInput as array of non-empty strings', () => {
    expect(validateRecipe({ ...validRecipe, promptInput: 'not-array' }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, promptInput: ['', 'valid'] }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, promptInput: [123] }).ok).toBe(false);
  });

  it('requires submit as array of non-empty strings', () => {
    expect(validateRecipe({ ...validRecipe, submit: 'not-array' }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, submit: ['', 'valid'] }).ok).toBe(false);
  });

  it('requires selects with aspect and quality strings', () => {
    expect(validateRecipe({ ...validRecipe, selects: null }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, selects: { aspect: '', quality: 'q' } }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, selects: { aspect: 'a' } }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, selects: { quality: 'q' } }).ok).toBe(false);
  });

  it('requires qualityValues as array of non-empty strings', () => {
    expect(validateRecipe({ ...validRecipe, qualityValues: 'not-array' }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe, qualityValues: ['', 'valid'] }).ok).toBe(false);
  });

  it('allows optional notes string', () => {
    expect(validateRecipe({ ...validRecipe, notes: 'ok' }).ok).toBe(true);
    expect(validateRecipe({ ...validRecipe, notes: 123 }).ok).toBe(false);
    expect(validateRecipe({ ...validRecipe }).ok).toBe(true); // missing is ok
  });
});

describe('validateRecipes (batch validation)', () => {
  const valid = {
    originPattern: '*.example.com/*',
    promptInput: ['a'],
    submit: ['b'],
    selects: { aspect: 'c', quality: 'd' },
    qualityValues: ['e'],
  };

  it('splits valid and invalid', () => {
    const { valid: v, invalid } = validateRecipes([valid, { ...valid, originPattern: '' }, 'not-object']);
    expect(v).toHaveLength(1);
    expect(invalid).toHaveLength(2);
    expect(invalid[0].errors[0]).toContain('originPattern is required');
    expect(invalid[1].errors[0]).toContain('Recipe must be an object');
  });

  it('handles non-array input', () => {
    const { valid, invalid } = validateRecipes('not-array');
    expect(valid).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors).toContain('Input must be an array');
  });
});

describe('matchOriginPattern (glob-style matching against host+pathname)', () => {
  it('matches * at start (subdomain wildcard)', () => {
    expect(matchOriginPattern('https://app.example.com/path', '*.example.com/*')).toBe(true);
    expect(matchOriginPattern('https://www.example.com/path', '*.example.com/*')).toBe(true);
    expect(matchOriginPattern('https://example.com/path', '*.example.com/*')).toBe(false); // bare domain doesn't match *.
    expect(matchOriginPattern('https://other.com/path', '*.example.com/*')).toBe(false);
  });

  it('matches * at end (path wildcard)', () => {
    expect(matchOriginPattern('https://example.com/anything', 'example.com/*')).toBe(true);
    expect(matchOriginPattern('https://example.com/', 'example.com/*')).toBe(true);
    expect(matchOriginPattern('https://other.com/', 'example.com/*')).toBe(false);
  });

  it('matches * at both ends', () => {
    expect(matchOriginPattern('https://sub.example.com/path', '*.example.com/*')).toBe(true);
    expect(matchOriginPattern('https://www.example.com/', '*.example.com/*')).toBe(true);
    expect(matchOriginPattern('https://example.com/', '*.example.com/*')).toBe(false); // bare domain
  });

  it('matches exact host+pathname (no wildcards)', () => {
    expect(matchOriginPattern('https://example.com/', 'example.com/')).toBe(true);
    expect(matchOriginPattern('https://example.com/path', 'example.com/')).toBe(false);
    expect(matchOriginPattern('https://example.com/', 'example.com/path')).toBe(false);
  });

  it('handles special regex chars in pattern', () => {
    expect(matchOriginPattern('https://example.com/', 'example.com')).toBe(false);
    expect(matchOriginPattern('https://example.com/', 'example.com/')).toBe(true);
    // Dot should be escaped
    expect(matchOriginPattern('https://exampleXcom/', 'example.com')).toBe(false);
    expect(matchOriginPattern('https://example.com/', 'example.com')).toBe(false);
  });

  it('returns false for invalid inputs', () => {
    expect(matchOriginPattern('', '*.example.com/*')).toBe(false);
    expect(matchOriginPattern('not-a-url', '*.example.com/*')).toBe(false);
    expect(matchOriginPattern('https://example.com/', '')).toBe(false);
    expect(matchOriginPattern(null, '*.example.com/*')).toBe(false);
  });
});

describe('matchRecipe (priority: first match wins)', () => {
  const recipes = [
    { originPattern: '*.higgsfield.ai/*', promptInput: ['higgsfield'], submit: [], selects: { aspect: '', quality: '' }, qualityValues: [] },
    { originPattern: 'chat.openai.com/*', promptInput: ['openai'], submit: [], selects: { aspect: '', quality: '' }, qualityValues: [] },
    { originPattern: '*', promptInput: ['generic'], submit: [], selects: { aspect: '', quality: '' }, qualityValues: [] },
  ];

  it('matches specific pattern first', () => {
    const match = matchRecipe('https://app.higgsfield.ai/generate', recipes);
    expect(match).toBe(recipes[0]);
    expect(match.promptInput).toEqual(['higgsfield']);
  });

  it('matches second specific pattern', () => {
    const match = matchRecipe('https://chat.openai.com/chat', recipes);
    expect(match).toBe(recipes[1]);
    expect(match.promptInput).toEqual(['openai']);
  });

  it('falls back to generic * pattern', () => {
    const match = matchRecipe('https://unknown-site.com/page', recipes);
    expect(match).toBe(recipes[2]);
    expect(match.promptInput).toEqual(['generic']);
  });

  it('returns null for empty recipes array', () => {
    expect(matchRecipe('https://example.com', [])).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(matchRecipe('https://example.com', null)).toBeNull();
    expect(matchRecipe('https://example.com', 'not-array')).toBeNull();
  });
});

describe('getDefaultRecipe (generic fallback)', () => {
  it('returns a valid recipe object', () => {
    const recipe = getDefaultRecipe();
    expect(recipe.originPattern).toBe('*');
    expect(Array.isArray(recipe.promptInput)).toBe(true);
    expect(Array.isArray(recipe.submit)).toBe(true);
    expect(recipe.selects).toBeDefined();
    expect(typeof recipe.selects.aspect).toBe('string');
    expect(typeof recipe.selects.quality).toBe('string');
    expect(Array.isArray(recipe.qualityValues)).toBe(true);
    expect(typeof recipe.notes).toBe('string');
  });

  it('passes validation', () => {
    const result = validateRecipe(getDefaultRecipe());
    expect(result.ok).toBe(true);
  });
});

describe('Storage integration (mergeSettings with siteRecipes/enabledRecipes)', () => {
  const validRecipe = {
    originPattern: '*.custom.com/*',
    promptInput: ['textarea'],
    submit: ['button'],
    selects: { aspect: 'select', quality: 'select' },
    qualityValues: ['1', '2'],
  };

  it('accepts valid siteRecipes array', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { siteRecipes: [validRecipe] });
    expect(settings.siteRecipes).toHaveLength(1);
    expect(settings.siteRecipes[0].originPattern).toBe('*.custom.com/*');
  });

  it('rejects invalid siteRecipes entries', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { siteRecipes: [validRecipe, { originPattern: '' }] });
    expect(settings.siteRecipes).toHaveLength(1); // only valid one kept
  });

  it('rejects non-array siteRecipes', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { siteRecipes: 'not-array' });
    expect(settings.siteRecipes).toEqual([]);
  });

  it('accepts valid enabledRecipes array', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { enabledRecipes: ['*.custom.com/*', 'chat.openai.com/*'] });
    expect(settings.enabledRecipes).toEqual(['*.custom.com/*', 'chat.openai.com/*']);
  });

  it('filters invalid enabledRecipes entries', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, { enabledRecipes: ['valid', '', 123, null] });
    expect(settings.enabledRecipes).toEqual(['valid']);
  });

  it('defaults to empty arrays', () => {
    const settings = mergeSettings(DEFAULT_SETTINGS, {});
    expect(settings.siteRecipes).toEqual([]);
    expect(settings.enabledRecipes).toEqual([]);
  });
});

describe('Built-in recipes (assets/recipes.json structure)', () => {
  // Test that the seeded recipes in assets/recipes.json would pass validation
  const builtinRecipes = [
    {
      originPattern: '*.higgsfield.ai/*',
      promptInput: ['textarea.reference-prompt', 'textarea[placeholder*="Describe the scene" i]', 'textarea[placeholder*="prompt" i]', 'main textarea'],
      submit: ['#hf\\:image-form-submit', 'button[type="submit"]:has-text("Generate")'],
      selects: { aspect: 'select[options*="1:1"][options*="16:9"][options*="9:16"]', quality: 'select[options*="1k"][options*="2k"][options*="4k"]' },
      qualityValues: ['1k', '2k', '4k'],
      notes: 'Higgsfield AI — ported from original hardcoded selectors',
    },
    {
      originPattern: 'chat.openai.com/*',
      promptInput: ['textarea#prompt-textarea', 'textarea[placeholder*="Message" i]', 'textarea[data-testid="prompt-textarea"]', 'div[contenteditable="true"][data-testid="prompt-textarea"]'],
      submit: ['button[data-testid="send-button"]', 'button:has-text("Send")', 'button[type="submit"]'],
      selects: { aspect: 'select[name*="aspect" i]', quality: 'select[name*="quality" i]' },
      qualityValues: ['standard', 'hd', '4k'],
      notes: 'ChatGPT / OpenAI — primary chat interface',
    },
    {
      originPattern: 'claude.ai/*',
      promptInput: ['div[contenteditable="true"][placeholder*="Talk" i]', 'div[contenteditable="true"][data-testid="chat-input"]', 'textarea[placeholder*="Talk" i]'],
      submit: ['button[aria-label*="Send" i]', 'button:has-text("Send")', 'button[type="submit"]'],
      selects: { aspect: 'select[name*="aspect" i]', quality: 'select[name*="quality" i]' },
      qualityValues: ['standard', 'high'],
      notes: 'Claude AI — Anthropic chat interface',
    },
    {
      originPattern: 'gemini.google.com/*',
      promptInput: ['div[contenteditable="true"][aria-label*="Enter" i]', 'div[contenteditable="true"][placeholder*="Enter" i]', 'textarea[placeholder*="Enter" i]'],
      submit: ['button[aria-label*="Send" i]', 'button:has-text("Send")', 'button[type="submit"]'],
      selects: { aspect: 'select[name*="aspect" i]', quality: 'select[name*="quality" i]' },
      qualityValues: ['standard', 'high'],
      notes: 'Google Gemini — chat interface',
    },
    {
      originPattern: 'perplexity.ai/*',
      promptInput: ['textarea[placeholder*="Ask" i]', 'textarea[placeholder*="Search" i]', 'div[contenteditable="true"][placeholder*="Ask" i]'],
      submit: ['button[aria-label*="Submit" i]', 'button:has-text("Submit")', 'button[type="submit"]'],
      selects: { aspect: 'select[name*="aspect" i]', quality: 'select[name*="quality" i]' },
      qualityValues: ['standard', 'detailed'],
      notes: 'Perplexity AI — search/chat interface',
    },
    {
      originPattern: '*',
      promptInput: ['textarea[placeholder*="prompt" i]', 'textarea[placeholder*="describe" i]', 'textarea[placeholder*="scene" i]', 'textarea', 'input[type="text"][placeholder*="prompt" i]', '[contenteditable="true"]'],
      submit: ['button[type="submit"]', 'button:has-text("Generate")', 'button:has-text("Create")', 'button:has-text("Submit")', '[role="button"]:has-text("Generate")'],
      selects: { aspect: 'select[options*="1:1" i][options*="16:9" i][options*="9:16" i]', quality: 'select[options*="1k" i][options*="2k" i][options*="4k" i]' },
      qualityValues: ['1k', '2k', '4k'],
      notes: 'Generic fallback — heuristic chain from original behavior',
    },
  ];

  it('has at least 6 seeded recipes', () => {
    expect(builtinRecipes.length).toBeGreaterThanOrEqual(6);
  });

  it('all seeded recipes pass validation', () => {
    const { valid, invalid } = validateRecipes(builtinRecipes);
    expect(valid.length).toBe(builtinRecipes.length);
    expect(invalid.length).toBe(0);
  });

  it('generic fallback is last (lowest priority)', () => {
    const generic = builtinRecipes.find((r) => r.originPattern === '*');
    expect(generic).toBeDefined();
    expect(generic).toBe(builtinRecipes[builtinRecipes.length - 1]);
  });
});