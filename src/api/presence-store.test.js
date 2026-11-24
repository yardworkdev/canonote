import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES_PER_NOTE, PRESENCE_TTL_MS, createPresenceStore } from '../../api/_lib/presence.js';

const setup = () => {
  let clock = 1_000_000;
  const store = createPresenceStore({ now: () => clock });
  return { store, tick: (ms) => (clock += ms) };
};

describe('server presence', () => {
  it('keeps who is in the note and what they are doing', () => {
    const { store } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', actorName: 'Rudi', mode: 'writing', from: 10, to: 42 });
    expect(store.list('u1', 'n1')).toEqual([
      expect.objectContaining({ kind: 'agent', id: 'a1', name: 'Rudi', mode: 'writing', from: 10, to: 42 }),
    ]);
  });

  it('drops an agent that stopped heartbeating, without a goodbye', () => {
    const { store, tick } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', actorName: 'Rudi', mode: 'reading' });
    tick(PRESENCE_TTL_MS);
    expect(store.list('u1', 'n1')).toHaveLength(1);
    tick(1);
    expect(store.list('u1', 'n1')).toEqual([]);
    expect(store.size()).toBe(0);
  });

  it('never leaks one user\u2019s presence into another\u2019s note', () => {
    const { store } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', actorName: 'Rudi' });
    expect(store.list('u2', 'n1')).toEqual([]);
    expect(store.list('u1', 'n2')).toEqual([]);
  });

  it('falls back to reading rather than inventing a mode', () => {
    const { store } = setup();
    const entry = store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', mode: 'thinking' });
    expect(entry.mode).toBe('reading');
  });

  it('caps a note at eight agents, dropping the oldest', () => {
    const { store, tick } = setup();
    for (let i = 0; i < MAX_ENTRIES_PER_NOTE + 2; i += 1) {
      store.announce({ userId: 'u1', noteId: 'n1', actorId: `a${i}`, actorName: `Agent ${i}` });
      tick(10);
    }
    const live = store.list('u1', 'n1');
    expect(live).toHaveLength(MAX_ENTRIES_PER_NOTE);
    expect(live.map((e) => e.id)).not.toContain('a0');
    expect(live[0].id).toBe(`a${MAX_ENTRIES_PER_NOTE + 1}`);
  });

  it('a heartbeat from the same agent replaces the old one', () => {
    const { store, tick } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', mode: 'reading', from: 0 });
    tick(500);
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', mode: 'writing', from: 90 });
    const live = store.list('u1', 'n1');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ mode: 'writing', from: 90 });
  });

  it('lets an agent leave politely, though nothing depends on it', () => {
    const { store } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1' });
    expect(store.leave({ userId: 'u1', noteId: 'n1', actorId: 'a1' })).toBe(true);
    expect(store.list('u1', 'n1')).toEqual([]);
    expect(store.leave({ userId: 'u1', noteId: 'n1', actorId: 'a1' })).toBe(false);
  });

  // The person's caret is stored beside the agents' so an agent can read where
  // they are typing. It is one entry, it has no invented mode, and it expires
  // exactly like an agent's when the tab stops beating.
  it('keeps the person’s caret without inventing a mode', () => {
    const { store } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', kind: 'person', actorId: 'person', actorName: 'Ves', from: 12 });
    const live = store.list('u1', 'n1');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ kind: 'person', id: 'person', name: 'Ves', from: 12, to: null });
    expect(live[0].mode).toBeUndefined();
  });

  it('keeps one person entry however many carets arrive', () => {
    const { store, tick } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', kind: 'person', actorId: 'person', from: 3 });
    tick(1000);
    store.announce({ userId: 'u1', noteId: 'n1', kind: 'person', actorId: 'person', from: 77 });
    const live = store.list('u1', 'n1');
    expect(live).toHaveLength(1);
    expect(live[0].from).toBe(77);
  });

  it('drops a person who closed the tab as quickly as an agent', () => {
    const { store, tick } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', kind: 'person', actorId: 'person', from: 5 });
    tick(PRESENCE_TTL_MS + 1);
    expect(store.list('u1', 'n1')).toEqual([]);
  });

  it('keeps the person and the agent as two entries in one note', () => {
    const { store } = setup();
    store.announce({ userId: 'u1', noteId: 'n1', kind: 'person', actorId: 'person', from: 5 });
    store.announce({ userId: 'u1', noteId: 'n1', actorId: 'a1', actorName: 'Rudi', mode: 'writing', from: 9 });
    const kinds = store.list('u1', 'n1').map((entry) => entry.kind).sort();
    expect(kinds).toEqual(['agent', 'person']);
  });
});
