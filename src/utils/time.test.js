import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { formatRelativeTime } from './time';

// These cases compare a timestamp against the current clock, so the clock is
// frozen: with a real clock, "now + 5 minutes" can be a millisecond in the
// past by the time the function reads Date.now(), which makes the boundary
// cases (5 min, 1 hr, 2 days) fail at random.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeTime', () => {
  it('returns empty string for null', () => {
    expect(formatRelativeTime(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatRelativeTime(undefined)).toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(formatRelativeTime(NaN)).toBe('');
  });

  it('returns empty string for Infinity', () => {
    expect(formatRelativeTime(Infinity)).toBe('');
  });

  it('returns empty string for non-number', () => {
    expect(formatRelativeTime('2024-01-01')).toBe('');
  });

  it('returns "just now" for a very recent past timestamp', () => {
    expect(formatRelativeTime(Date.now() - 100)).toBe('just now');
  });

  it('returns "1 min ago" for 60 seconds ago', () => {
    expect(formatRelativeTime(Date.now() - 60 * 1000)).toBe('1 min ago');
  });

  it('returns "5 min ago" for 5 minutes ago', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60 * 1000)).toBe('5 min ago');
  });

  it('returns "1 hr ago" for 60 minutes ago', () => {
    expect(formatRelativeTime(Date.now() - 60 * 60 * 1000)).toBe('1 hr ago');
  });

  it('returns "1 day ago" for 24 hours ago', () => {
    expect(formatRelativeTime(Date.now() - 24 * 60 * 60 * 1000)).toBe('1 day ago');
  });

  it('returns "7 days ago" for exactly 7 days ago', () => {
    expect(formatRelativeTime(Date.now() - 7 * 24 * 60 * 60 * 1000)).toBe('7 days ago');
  });

  it('returns absolute date for 8 days ago', () => {
    const result = formatRelativeTime(Date.now() - 8 * 24 * 60 * 60 * 1000);
    // Should be a date string, not relative
    expect(result).not.toContain('ago');
    expect(result).not.toContain('day');
  });

  it('returns "in a moment" for 10 seconds in the future', () => {
    expect(formatRelativeTime(Date.now() + 10 * 1000)).toBe('in a moment');
  });

  it('returns "in 5 min" for 5 minutes in the future', () => {
    expect(formatRelativeTime(Date.now() + 5 * 60 * 1000)).toBe('in 5 min');
  });

  it('returns "in 1 hr" for 1 hour in the future', () => {
    expect(formatRelativeTime(Date.now() + 60 * 60 * 1000)).toBe('in 1 hr');
  });

  it('returns "in 2 days" for 2 days in the future', () => {
    expect(formatRelativeTime(Date.now() + 2 * 24 * 60 * 60 * 1000)).toBe('in 2 days');
  });

  it('returns absolute date for 8 days in the future', () => {
    const result = formatRelativeTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(result).not.toContain('in');
    expect(result).not.toContain('day');
  });

  it('handles timestamp of 0 (Unix epoch)', () => {
    const result = formatRelativeTime(0);
    expect(result).not.toContain('ago');
    expect(typeof result).toBe('string');
  });
});
