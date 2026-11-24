import { describe, expect, it } from 'vitest';
import { createPresenceRepository } from '../../api/_lib/presence-repository.js';
import { createSharedPresence } from '../../api/_lib/presence-shared.js';
import { MAX_ENTRIES_PER_NOTE, PRESENCE_TTL_MS, createPresenceStore } from '../../api/_lib/presence.js';

/**
 * A Supabase-shaped table that answers the four queries the repository makes:
 * a filtered delete, a filtered select with an order, a filtered delete by id
 * list, and an upsert that reads its row back. Enough to be wrong in the same
 * places a real database would be, without a database.
 */
function createFakeSupabase(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  const queries = [];

  const matches = (row, filters) =>
    filters.every(([column, operator, value]) => {
      const cell = row[column];
      if (operator === 'eq') return String(cell) === String(value);
      if (operator === 'in') return value.map(String).includes(String(cell));
      const left = column === 'at' ? Date.parse(cell) : cell;
      const right = column === 'at' ? Date.parse(value) : value;
      if (operator === 'lt') return left < right;
      if (operator === 'gte') return left >= right;
      throw new Error(`fake supabase: unsupported operator ${operator}`);
    });

  function builder(operation, payload) {
    const state = { operation, payload, filters: [], order: null, columns: null, single: false };

    const run = () => {
      const hits = rows.filter((row) => matches(row, state.filters));
      if (state.operation === 'delete') {
        for (const hit of hits) rows.splice(rows.indexOf(hit), 1);
        return { data: state.columns ? hits.map((row) => ({ ...row })) : null, error: null };
      }
      if (state.operation === 'upsert') {
        const existing = rows.find(
          (row) =>
            String(row.user_id) === String(payload.user_id) &&
            String(row.note_id) === String(payload.note_id) &&
            String(row.actor_id) === String(payload.actor_id)
        );
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
        const written = rows.find((row) => String(row.actor_id) === String(payload.actor_id));
        return { data: state.single ? { ...written } : [{ ...written }], error: null };
      }
      const sorted = state.order
        ? [...hits].sort((a, b) => {
            const direction = state.order[1] ? 1 : -1;
            return (Date.parse(a.at) - Date.parse(b.at)) * direction;
          })
        : hits;
      if (state.single) {
        return sorted.length === 0
          ? { data: null, error: { message: 'no rows' } }
          : { data: { ...sorted[0] }, error: null };
      }
      return { data: sorted.map((row) => ({ ...row })), error: null };
    };

    const api = {
      eq(column, value) {
        state.filters.push([column, 'eq', value]);
        return api;
      },
      lt(column, value) {
        state.filters.push([column, 'lt', value]);
        return api;
      },
      gte(column, value) {
        state.filters.push([column, 'gte', value]);
        return api;
      },
      in(column, value) {
        state.filters.push([column, 'in', value]);
        return api;
      },
      order(column, options = {}) {
        state.order = [column, options.ascending !== false];
        return api;
      },
      select(columns = '*') {
        state.columns = columns;
        return api;
      },
      single() {
        state.single = true;
        return api;
      },
      then(resolve, reject) {
        try {
          resolve(run());
        } catch (error) {
          reject(error);
        }
      },
    };
    return api;
  }

  return {
    rows,
    queries,
    from(table) {
      if (table !== 'note_presence') throw new Error(`fake supabase: unexpected table ${table}`);
      return {
        select: (columns) => {
          queries.push('select');
          return builder('select', null).select(columns);
        },
        delete: () => {
          queries.push('delete');
          return builder('delete', null);
        },
        upsert: (payload) => {
          queries.push('upsert');
          return builder('upsert', payload);
        },
      };
    },
  };
}

function setup(initial = []) {
  let clock = 1_000_000;
  const client = createFakeSupabase(initial);
  const store = createPresenceRepository(client, { now: () => clock });
  return { client, store, tick: (ms) => (clock += ms), at: () => clock };
}

describe('presence repository', () => {
  it('stores an agent heartbeat and reads the same shape the memory store returns', async () => {
    const { store } = setup();
    const entry = await store.announce({
      userId: 'u1',
      noteId: 'n1',
      actorId: 'a1',
      actorName: 'Rudi',
      mode: 'writing',
      from: 10,
      to: 42,
    });
    expect(entry).toMatchObject({ kind: 'agent', id: 'a1', name: 'Rudi', mode: 'writing', from: 10, to: 42 });
    expect(await store.list('u1', 'n1')).toEqual([expect.objectContaining({ id: 'a1', mode: 'writing' })]);
  });

  it('gives a person a caret and no mode', async () => {
    const { store } = setup();
    const entry = await store.announce({
      userId: 'u1',
      noteId: 'n1',
      actorId: 'person',
      actorName: 'Someone',
      kind: 'person',
      from: 7,
      to: 7,
    });
    expect(entry).toMatchObject({ kind: 'person', id: 'person', from: 7, to: 7 });
    expect(entry).not.toHaveProperty('mode');
  });

  it('never invents a mode an agent did not announce', async () => {
    const { store } = setup();
    const entry = await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', mode: 'thinking' });
    expect(entry.mode).toBe('reading');
  });

  it('drops a heartbeat older than the TTL, without a goodbye', async () => {
    const { store, tick } = setup();
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1' });
    tick(PRESENCE_TTL_MS);
    expect(await store.list('u1', 'n1')).toHaveLength(1);
    tick(1);
    expect(await store.list('u1', 'n1')).toEqual([]);
  });

  it('never leaks one user\u2019s presence into another note', async () => {
    const { store } = setup();
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1' });
    expect(await store.list('u2', 'n1')).toEqual([]);
    expect(await store.list('u1', 'n2')).toEqual([]);
  });

  it('answers newest heartbeat first', async () => {
    const { store, tick } = setup();
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1' });
    tick(100);
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a2' });
    const live = await store.list('u1', 'n1');
    expect(live.map((entry) => entry.id)).toEqual(['a2', 'a1']);
  });

  it('caps a note at eight actors, dropping the oldest', async () => {
    const { store, tick } = setup();
    for (let i = 0; i < MAX_ENTRIES_PER_NOTE + 2; i += 1) {
      await store.announce({ userId: 'u1', noteId: 'n1', actorId: `a${i}`, actorName: `Agent ${i}` });
      tick(10);
    }
    const live = await store.list('u1', 'n1');
    expect(live).toHaveLength(MAX_ENTRIES_PER_NOTE);
    expect(live.map((entry) => entry.id)).not.toContain('a0');
    expect(live.map((entry) => entry.id)).not.toContain('a1');
  });

  it('a heartbeat from the same actor replaces its row instead of adding one', async () => {
    const { store, client, tick } = setup();
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', from: 0 });
    tick(500);
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', from: 90, mode: 'writing' });
    expect(client.rows).toHaveLength(1);
    expect(await store.list('u1', 'n1')).toEqual([expect.objectContaining({ id: 'a1', from: 90, mode: 'writing' })]);
  });

  it('leaves when asked, and says whether anything was there', async () => {
    const { store } = setup();
    await store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1' });
    expect(await store.leave({ userId: 'u1', noteId: 'n1', actorId: 'a1' })).toBe(true);
    expect(await store.leave({ userId: 'u1', noteId: 'n1', actorId: 'a1' })).toBe(false);
    expect(await store.list('u1', 'n1')).toEqual([]);
  });

  it('says which query failed instead of returning an empty list', async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }) }) }) }) };
    const store = createPresenceRepository(failing);
    await expect(store.list('u1', 'n1')).rejects.toThrow(/relation does not exist/);
  });
});

describe('shared presence', () => {
  it('is per-instance memory when the deployment has no database', async () => {
    const memory = createPresenceStore();
    const presence = createSharedPresence({ client: null, memory });
    expect(presence.shared).toBe(false);
    await presence.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1' });
    expect(await presence.list('u1', 'n1')).toHaveLength(1);
  });

  it('answers from Postgres when it can', async () => {
    const client = createFakeSupabase();
    const presence = createSharedPresence({ client, memory: createPresenceStore() });
    expect(presence.shared).toBe(true);
    await presence.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', mode: 'writing' });
    expect(client.rows).toHaveLength(1);
    expect(await presence.list('u1', 'n1')).toEqual([expect.objectContaining({ id: 'a1', mode: 'writing' })]);
  });

  it('falls back to memory when the database refuses, so a caret never fails a request', async () => {
    const failing = { from: () => ({ upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) };
    const fallbacks = [];
    const presence = createSharedPresence({
      client: failing,
      memory: createPresenceStore(),
      onFallback: (operation, error) => fallbacks.push([operation, error.message]),
    });
    const entry = await presence.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', mode: 'writing' });
    expect(entry).toMatchObject({ id: 'a1', mode: 'writing' });
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0][0]).toBe('announce');
    expect(await presence.list('u1', 'n1')).toHaveLength(1);
  });
});
