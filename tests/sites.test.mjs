import { describe, expect, it } from 'vitest';
import { getOrigin, isSiteDisabled } from '../src/lib/sites.js';

describe('getOrigin', () => {
  it('returns the origin of a valid URL', () => {
    expect(getOrigin('https://example.com/path?q=1')).toBe('https://example.com');
    expect(getOrigin('http://sub.domain.example:3000/x')).toBe(
      'http://sub.domain.example:3000',
    );
  });

  it('returns "" for invalid or non-URL input', () => {
    expect(getOrigin('not a url')).toBe('');
    expect(getOrigin('')).toBe('');
    expect(getOrigin(null)).toBe('');
    expect(getOrigin(undefined)).toBe('');
  });
});

describe('isSiteDisabled', () => {
  it('matches by exact origin, ignoring path/query', () => {
    expect(isSiteDisabled('https://example.com/xyz?q=2', ['https://example.com'])).toBe(
      true,
    );
  });

  it('does not match different origins or wrong ports', () => {
    expect(isSiteDisabled('https://example.com', ['https://other.com'])).toBe(false);
    expect(isSiteDisabled('https://example.com:8443', ['https://example.com'])).toBe(
      false,
    );
  });

  it('is false for empty or invalid URLs', () => {
    expect(isSiteDisabled('garbage', ['https://example.com'])).toBe(false);
    expect(isSiteDisabled('', [])).toBe(false);
  });
});
