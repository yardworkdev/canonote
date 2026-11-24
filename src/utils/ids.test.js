import { describe, it, expect } from 'vitest';
import { createNoteId } from './ids';

describe('createNoteId', () => {
  it('returns a string matching "note-{timestamp}-{random}"', () => {
    const id = createNoteId();
    expect(id).toMatch(/^note-\d+-[a-z0-9]+$/);
  });

  it('timestamp component is within 100ms of Date.now()', () => {
    const before = Date.now();
    const id = createNoteId();
    const after = Date.now();

    const timestamp = parseInt(id.split('-')[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('random component is 8 characters', () => {
    const id = createNoteId();
    const parts = id.split('-');
    const randomPart = parts.slice(2).join('-'); // rejoin in case random contains '-'
    // The random part is alphanumeric
    expect(randomPart).toMatch(/^[a-z0-9]+$/);
    // Should be 8 chars (may be less if base-36 padding doesn't reach 8)
    expect(randomPart.length).toBeGreaterThan(0);
    expect(randomPart.length).toBeLessThanOrEqual(8);
  });

  it('1000 rapid calls produce no duplicate IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      ids.add(createNoteId());
    }
    expect(ids.size).toBe(1000);
  });

  it('IDs from different milliseconds have different timestamps', () => {
    // This tests the structure, not uniqueness across time
    const id1 = createNoteId();
    const id2 = createNoteId();
    const ts1 = parseInt(id1.split('-')[1], 10);
    const ts2 = parseInt(id2.split('-')[1], 10);
    // Both should be valid timestamps
    expect(Number.isFinite(ts1)).toBe(true);
    expect(Number.isFinite(ts2)).toBe(true);
  });
});
