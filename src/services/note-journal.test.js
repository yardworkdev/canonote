import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitNoteContent,
  draftKeyFor,
  noteIdFromDraftKey,
  parseDraft,
  planJournalReplay,
  replayJournal,
  serializeDraft,
} from './note-journal';

// The journal is what stands between "the tab was killed mid-save" and "the
// text is gone": a record written before the content it holds, cleared only
// once that content has landed, and replayed on the next open. These tests pin
// the write order, the replay decisions and the cases recovery must refuse
// (a deleted note, a record the notebook has newer state for).

const USER = 'local';

const createMemoryStore = () => {
  const map = new Map();
  return {
    map,
    get: vi.fn(async (key) => (map.has(key) ? { value: map.get(key) } : null)),
    set: vi.fn(async (key, value) => {
      map.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      map.delete(key);
    }),
    setMany: vi.fn(async (entries = [], { remove = [] } = {}) => {
      for (const [key, value] of entries) map.set(key, value);
      for (const key of remove) map.delete(key);
    }),
    entries: vi.fn(async () => Array.from(map.entries())),
    keys: vi.fn(async () => Array.from(map.keys())),
  };
};

const noteRow = (id, title, updated) => ({
  id,
  note_id: id,
  title,
  updated,
  isPinned: false,
  folder: 'private',
  revision: null,
});

describe('the journal record', () => {
  it('round-trips the text, the base revision and the time it was written', () => {
    const raw = serializeDraft({ noteId: 'note-1', content: '# Hi', baseRevision: 'rev-3' });
    const record = parseDraft(raw, 'note-1');
    expect(record.content).toBe('# Hi');
    expect(record.baseRevision).toBe('rev-3');
    expect(Number.isFinite(record.updatedAt)).toBe(true);
  });

  it('refuses a record that is not for the note being read', () => {
    const raw = serializeDraft({ noteId: 'note-1', content: 'mine' });
    expect(parseDraft(raw, 'note-2')).toBeNull();
  });

  it('refuses a record it cannot read rather than guessing', () => {
    expect(parseDraft('{not json', 'note-1')).toBeNull();
    expect(parseDraft(JSON.stringify({ noteId: 'note-1', content: 42 }), 'note-1')).toBeNull();
    expect(parseDraft(null, 'note-1')).toBeNull();
  });

  it('reads the note id back out of a draft key, and only out of its own', () => {
    expect(noteIdFromDraftKey('local:note-draft:note-42', USER)).toBe('note-42');
    expect(noteIdFromDraftKey('local:note-draft:', USER)).toBeNull();
    expect(noteIdFromDraftKey('local:note-42', USER)).toBeNull();
    expect(noteIdFromDraftKey('other:note-draft:note-42', USER)).toBeNull();
    expect(noteIdFromDraftKey(null, USER)).toBeNull();
  });

  it('builds the key through the store scoping it is given', () => {
    expect(draftKeyFor((key) => `local:${key}`, 'note-7')).toBe('local:note-draft:note-7');
    expect(draftKeyFor(undefined, 'note-7')).toBeNull();
  });
});

describe('planJournalReplay', () => {
  const record = (noteId, content, updatedAt = 200) => ({
    key: `local:note-draft:${noteId}`,
    noteId,
    draft: { noteId, content, baseRevision: null, updatedAt },
  });

  it('restores an interrupted save as a note with its text', () => {
    const plan = planJournalReplay({ records: [record('note-1', '# Recovered')], now: 999 });
    expect(plan.restore).toHaveLength(1);
    expect(plan.restore[0]).toMatchObject({
      id: 'note-1',
      title: 'Recovered',
      updated: 200,
      content: '# Recovered',
      recovered: true,
    });
    expect(plan.clear).toEqual(['local:note-draft:note-1']);
  });

  it('keeps the metadata the notebook already has for an older row', () => {
    const plan = planJournalReplay({
      records: [record('note-1', 'newer text', 500)],
      notesById: new Map([['note-1', { ...noteRow('note-1', 'Old title', 100), isPinned: true }]]),
    });
    expect(plan.restore[0]).toMatchObject({ isPinned: true, updated: 500, content: 'newer text' });
  });

  // The row's revision belongs to the server's text. Handing it to a recovered
  // draft that was written against an older one is how a local copy saves over
  // whatever the newer revision contained: on 2026-11-18, an agent's paragraph.
  it('a recovered draft keeps its own base revision, never the row’s newer one', () => {
    const plan = planJournalReplay({
      records: [
        {
          key: 'local:note-draft:note-1',
          noteId: 'note-1',
          draft: { noteId: 'note-1', content: 'older draft', baseRevision: '1', updatedAt: 500 },
        },
      ],
      notesById: new Map([['note-1', { ...noteRow('note-1', 'Title', 100), revision: '2' }]]),
    });
    expect(plan.restore[0].revision).toBe('1');
  });

  it('a recovered draft with no base revision claims none', () => {
    const plan = planJournalReplay({
      records: [record('note-1', 'unversioned', 500)],
      notesById: new Map([['note-1', { ...noteRow('note-1', 'Title', 100), revision: '2' }]]),
    });
    expect(plan.restore[0].revision).toBeNull();
  });

  it('consumes a record the notebook already committed', () => {
    const plan = planJournalReplay({
      records: [record('note-1', 'committed text', 100)],
      notesById: new Map([['note-1', noteRow('note-1', 'Committed', 400)]]),
    });
    expect(plan.restore).toEqual([]);
    expect(plan.clear).toEqual(['local:note-draft:note-1']);
  });

  it('never replays a record for a deleted note', () => {
    const plan = planJournalReplay({
      records: [record('note-1', 'deleted text')],
      isDeleted: (id) => id === 'note-1',
    });
    expect(plan.restore).toEqual([]);
    expect(plan.clear).toEqual(['local:note-draft:note-1']);
  });

  it('drops a record with nothing in it, or nothing readable', () => {
    const plan = planJournalReplay({
      records: [record('note-1', '   '), { key: 'local:note-draft:note-2', noteId: 'note-2', draft: null }],
    });
    expect(plan.restore).toEqual([]);
    expect(plan.clear).toHaveLength(2);
  });
});

describe('commitNoteContent — the one save path', () => {
  it('writes the content and consumes the record holding the same text', async () => {
    const store = createMemoryStore();
    store.map.set('local:note-draft:note-1', serializeDraft({ noteId: 'note-1', content: 'text' }));

    await commitNoteContent({
      store,
      noteId: 'note-1',
      noteKey: 'local:note-1',
      draftKey: 'local:note-draft:note-1',
      contentToSave: 'text',
    });

    expect(store.map.get('local:note-1')).toBe('text');
    expect(store.map.has('local:note-draft:note-1')).toBe(false);
    expect(store.setMany).toHaveBeenCalledTimes(1);
  });

  it('leaves a record written by a later keystroke alone', async () => {
    const store = createMemoryStore();
    store.map.set('local:note-draft:note-1', serializeDraft({ noteId: 'note-1', content: 'newer' }));

    await commitNoteContent({
      store,
      noteId: 'note-1',
      noteKey: 'local:note-1',
      draftKey: 'local:note-draft:note-1',
      contentToSave: 'older',
    });

    expect(store.map.get('local:note-1')).toBe('older');
    expect(store.map.has('local:note-draft:note-1')).toBe(true);
  });

  it('consumes a record the commit has already superseded', async () => {
    // The record holds an earlier state of the same text — the pane moved on
    // while the save was in flight, so the commit is a superset of the record.
    // Leaving it behind is what let a stale record truncate the note on the next
    // open: the replay found a record, and its text was a prefix of the note.
    const store = createMemoryStore();
    store.map.set(
      'local:note-draft:note-1',
      serializeDraft({ noteId: 'note-1', content: '# Alpha\n\nthe body' })
    );

    await commitNoteContent({
      store,
      noteId: 'note-1',
      noteKey: 'local:note-1',
      draftKey: 'local:note-draft:note-1',
      contentToSave: '# Alpha\n\nthe body of the note',
    });

    expect(store.map.get('local:note-1')).toBe('# Alpha\n\nthe body of the note');
    expect(store.map.has('local:note-draft:note-1')).toBe(false);
  });

  it('always clears when the content adopted supersedes the record', async () => {
    const store = createMemoryStore();
    store.map.set('local:note-draft:note-1', serializeDraft({ noteId: 'note-1', content: 'discarded' }));

    await commitNoteContent({
      store,
      noteId: 'note-1',
      noteKey: 'local:note-1',
      draftKey: 'local:note-draft:note-1',
      contentToSave: 'canonical',
      clearDraft: 'always',
    });

    expect(store.map.has('local:note-draft:note-1')).toBe(false);
  });

  it('falls back to set/delete on a store without setMany', async () => {
    const store = createMemoryStore();
    delete store.setMany;

    await commitNoteContent({
      store,
      noteId: 'note-1',
      noteKey: 'local:note-1',
      draftKey: 'local:note-draft:note-1',
      contentToSave: 'text',
    });

    expect(store.set).toHaveBeenCalledWith('local:note-1', 'text');
    expect(store.delete).toHaveBeenCalledWith('local:note-draft:note-1');
  });
});

describe('replayJournal', () => {
  let store;

  beforeEach(() => {
    store = createMemoryStore();
  });

  const seed = (noteId, content, updatedAt = 100) =>
    store.map.set(`local:note-draft:${noteId}`, serializeDraft({ noteId, content, updatedAt }));

  it('writes back an interrupted save and consumes its record', async () => {
    seed('note-1', '# Interrupted');
    const result = await replayJournal({
      store,
      userId: USER,
      notes: [],
      noteKeyFor: (noteId) => `local:${noteId}`,
    });

    expect(result.restored).toHaveLength(1);
    expect(store.map.get('local:note-1')).toBe('# Interrupted');
    expect(store.map.has('local:note-draft:note-1')).toBe(false);
  });

  it('does nothing on a second run — replay is idempotent', async () => {
    seed('note-1', '# Interrupted');
    await replayJournal({ store, userId: USER, notes: [], noteKeyFor: (id) => `local:${id}` });
    const second = await replayJournal({
      store,
      userId: USER,
      notes: [],
      noteKeyFor: (id) => `local:${id}`,
    });

    expect(second.restored).toEqual([]);
    expect(second.cleared).toBe(0);
  });

  it('reports a record it cannot read instead of throwing it away silently', async () => {
    store.map.set('local:note-draft:note-1', '{not json');
    const result = await replayJournal({ store, userId: USER, notes: [] });

    expect(result.discarded).toBe(1);
    expect(result.restored).toEqual([]);
  });

  it('keeps the record when the store refuses the write, so the text is not lost', async () => {
    seed('note-1', '# Interrupted');
    store.setMany.mockRejectedValueOnce(new Error('QuotaExceededError'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await replayJournal({
      store,
      userId: USER,
      notes: [],
      noteKeyFor: (id) => `local:${id}`,
    });

    expect(result.restored).toEqual([]);
    expect(store.map.has('local:note-draft:note-1')).toBe(true);
    warn.mockRestore();
  });

  it('ignores keys that are not journal records', async () => {
    store.map.set('local:note-1', '# A committed note');
    store.map.set('local:notes-cache', '[]');
    const result = await replayJournal({ store, userId: USER, notes: [] });

    expect(result.restored).toEqual([]);
    expect(result.cleared).toBe(0);
    expect(store.map.get('local:note-1')).toBe('# A committed note');
  });

  it('never writes a superseded record over text the note already holds', async () => {
    // A record left behind by a save that was overtaken: the note holds the full
    // text, the record an earlier prefix of it, and the record's timestamp is
    // the later one — so the list row looks older and the replay would take the
    // record at its word and truncate the note. The store's own content is the
    // evidence that settles it.
    store.map.set('local:note-1', '# Alpha\n\nthe body of the note');
    seed('note-1', '# Alpha\n\nthe body', 5000);

    const result = await replayJournal({
      store,
      userId: USER,
      notes: [noteRow('note-1', 'Alpha', 100)],
      noteKeyFor: (noteId) => `local:${noteId}`,
    });

    expect(result.restored).toEqual([]);
    expect(store.map.get('local:note-1')).toBe('# Alpha\n\nthe body of the note');
    expect(store.map.has('local:note-draft:note-1')).toBe(false);
  });

  it('still restores a record that holds text the note does not have', async () => {
    store.map.set('local:note-1', '# Alpha');
    seed('note-1', '# Alpha\n\nthe body of the note', 5000);

    const result = await replayJournal({
      store,
      userId: USER,
      notes: [noteRow('note-1', 'Alpha', 100)],
      noteKeyFor: (noteId) => `local:${noteId}`,
    });

    expect(result.restored).toHaveLength(1);
    expect(store.map.get('local:note-1')).toBe('# Alpha\n\nthe body of the note');
  });
});
