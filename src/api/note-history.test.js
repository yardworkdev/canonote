import { describe, expect, it } from 'vitest';
import { actorOf, countWords, lineDelta, shapeHistory } from '../../api/_lib/note-history.js';

describe('note history', () => {
  it('counts words the way the rest of the app does', () => {
    expect(countWords('one two  three\n')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('reports how many lines the agent added without shipping the bodies', () => {
    const before = 'a\nb\nc';
    const after = 'a\nb\nc\nd\ne';
    expect(lineDelta(before, after)).toEqual({ added: 2, removed: 0 });
  });

  it('counts a changed line as one removal and one addition', () => {
    expect(lineDelta('price is 10', 'price is 12')).toEqual({ added: 1, removed: 1 });
  });

  it('ignores blank lines so formatting alone does not read as an edit', () => {
    expect(lineDelta('a\nb', 'a\n\n\nb')).toEqual({ added: 0, removed: 0 });
  });

  it('names the author as a person or an agent, never as a raw id', () => {
    expect(actorOf({ actor_id: 'agent_rudi' })).toBe('agent');
    expect(actorOf({ actor_id: 'agent' })).toBe('agent');
    expect(actorOf({ actor_id: 'user-123' })).toBe('human');
    expect(actorOf({})).toBe('unknown');
  });

  it('orders newest first and drops the oldest past the limit', () => {
    const rows = [
      { revision: 1, created_at: '2026-11-01T10:00:00Z', content: 'one' },
      { revision: 3, created_at: '2026-11-03T10:00:00Z', content: 'one two three' },
      { revision: 2, created_at: '2026-11-02T10:00:00Z', content: 'one two' },
    ];
    const out = shapeHistory(rows, { limit: 2 });
    expect(out.items.map((v) => v.revision)).toEqual([3, 2]);
    expect(out.hasMore).toBe(true);
    expect(out.items[0].words).toBe(3);
  });

  it('compares each version with the one before it, newest first', () => {
    const rows = [
      { revision: 1, created_at: '2026-11-01T10:00:00Z', content: 'a\nb' },
      { revision: 2, created_at: '2026-11-02T10:00:00Z', content: 'a\nb\nc' },
    ];
    const out = shapeHistory(rows);
    expect(out.items[0]).toMatchObject({ revision: 2, added: 1, removed: 0 });
    expect(out.items[1].added).toBeNull();
  });

  it('has no delta when there is nothing to compare against', () => {
    const out = shapeHistory([{ revision: 1, created_at: '2026-11-01T10:00:00Z', content: 'a' }]);
    expect(out.items[0].added).toBeNull();
    expect(out.items[0].removed).toBeNull();
  });

  it('survives a note that has never been saved to the server', () => {
    expect(shapeHistory([])).toEqual({ count: 0, hasMore: false, items: [] });
    expect(shapeHistory(null).count).toBe(0);
  });
});
