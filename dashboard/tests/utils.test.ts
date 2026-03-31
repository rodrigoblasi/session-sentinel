import { describe, it, expect } from 'vitest';
import { formatTokens, shortenModel, formatDuration } from '../src/lib/utils.js';

describe('formatTokens', () => {
  it('formats millions', () => expect(formatTokens(1_500_000)).toBe('1.5M'));
  it('formats thousands', () => expect(formatTokens(42_300)).toBe('42.3K'));
  it('formats small numbers', () => expect(formatTokens(500)).toBe('500'));
});

describe('shortenModel', () => {
  it('shortens claude model names', () => expect(shortenModel('claude-opus-4-6')).toBe('opus-4-6'));
  it('strips date suffixes', () => expect(shortenModel('claude-sonnet-4-6-20260301')).toBe('sonnet-4-6'));
  it('handles null', () => expect(shortenModel(null)).toBe('—'));
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 45_000).toISOString();
    expect(formatDuration(start)).toBe('45s');
  });

  it('formats minutes', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 125_000).toISOString();
    expect(formatDuration(start)).toMatch(/^2m/);
  });
});
