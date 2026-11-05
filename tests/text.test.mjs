import { describe, expect, it } from 'vitest';
import { joinForAppend } from '../src/lib/text.js';

describe('joinForAppend', () => {
  it('joins trimmed existing and incoming with ", "', () => {
    expect(joinForAppend('  first prompt  ', 'second')).toBe(
      'first prompt, second',
    );
  });

  it('returns just the trimmed incoming when existing is empty', () => {
    expect(joinForAppend('', 'incoming')).toBe('incoming');
    expect(joinForAppend('   ', 'incoming  ')).toBe('incoming');
  });

  it('treats null/undefined existing as empty', () => {
    expect(joinForAppend(null, 'incoming')).toBe('incoming');
    expect(joinForAppend(undefined, ' incoming ')).toBe('incoming');
  });

  it('returns empty string when both sides empty', () => {
    expect(joinForAppend('', '  ')).toBe('');
    expect(joinForAppend(null, null)).toBe('');
  });
});
