import { describe, expect, it } from 'vitest';
import { createThread } from '../../api/_lib/thread';

/**
 * A poll cursor is a timestamp, and two different things can make a message new
 * to a reader: it was written, or it was decided. The second is the one that
 * bites in practice — a proposal applied in one tab stayed on offer in the other
 * for ever, because the poll only ever scanned `created_at` and never looked at
 * the untouched older row again.
 *
 * These tests pin the query and the cursor; the browser half is in
 * `src/hooks/useThread.test.jsx`.
 */
function fakeClient(rows) {
  const calls = [];
  const builder = {
    select(columns) {
      calls.push(['select', columns]);
      return builder;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return builder;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return builder;
    },
    limit(count) {
      calls.push(['limit', count]);
      return builder;
    },
    or(expression) {
      calls.push(['or', expression]);
      return builder;
    },
    then(resolve) {
      resolve({ data: rows, error: null });
    }
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      return builder;
    }
  };
}

const row = (overrides = {}) => ({
  id: 'm-1',
  note_id: 'note-1',
  author_type: 'agent',
  author_name: 'promi',
  kind: 'proposal',
  body: 'text',
  base_revision: 3,
  created_at: '2026-11-12T10:00:00.000+00:00',
  applied_at: null,
  decided_at: null,
  ...overrides
});

describe('the thread poll looks at what changed, not only at what arrived', () => {
  it('asks for rows written or decided after the cursor', async () => {
    const client = fakeClient([]);
    const since = '2026-11-12T09:59:00.000Z';
    await createThread(client).list({ userId: 'u-1', noteId: 'note-1', since });

    const scan = client.calls.find((call) => call[0] === 'or');
    expect(scan, 'the poll must scan both columns').toBeTruthy();
    expect(scan[1]).toContain(`created_at.gt."${since}"`);
    expect(scan[1]).toContain(`decided_at.gt."${since}"`);
    expect(client.calls.some((call) => call[0] === 'eq' && call[1] === 'note_id')).toBe(true);
  });

  it('moves the cursor to the decision, so the row is not re-read every tick', async () => {
    const client = fakeClient([
      row({ decided_at: '2026-11-12T10:05:00.000+00:00', applied_at: '2026-11-12T10:05:00.000+00:00' })
    ]);
    const page = await createThread(client).list({ userId: 'u-1', noteId: 'note-1', since: '2026-11-12T09:59:00.000Z' });

    // The row was created at 10:00 and decided at 10:05; a cursor of 10:00 would
    // return it again on the next poll, for ever.
    expect(Date.parse(page.nextCursor)).toBe(Date.parse('2026-11-12T10:05:00.000+00:00'));
  });

  it('leaves the cursor alone when nothing came back', async () => {
    const client = fakeClient([]);
    const since = '2026-11-12T09:59:00.000Z';
    const page = await createThread(client).list({ userId: 'u-1', noteId: 'note-1', since });

    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBe(since);
  });
});
