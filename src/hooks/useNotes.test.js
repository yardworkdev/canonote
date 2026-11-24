import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useNotes } from './useNotes';
import { serializeDraft } from '../services/note-journal';

// The note list is where a notebook loses work: a row that comes back after a
// delete, a row that never appears after typing, a cache write that erases a
// neighbour. These tests pin those invariants at the unit level, next to the
// code that owns them.

const USER = { id: 'local', isLocal: true };

const createMemoryStorage = (userId = 'local') => {
  const store = new Map();
  return {
    store,
    scopedKey: (key) => `${userId}:${key}`,
    noteStorageKey: (noteId) =>
      `${userId}:${noteId.startsWith('note-') ? noteId : `note-${noteId}`}`,
    get: vi.fn(async (key) => (store.has(key) ? { value: store.get(key) } : null)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    setMany: vi.fn(async (entries = [], { remove = [] } = {}) => {
      for (const [key, value] of entries) store.set(key, value);
      for (const key of remove) store.delete(key);
    }),
    entries: vi.fn(async () => Array.from(store.entries())),
    keys: vi.fn(async () => Array.from(store.keys())),
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
  };
};

const noteRow = (id, title, updated, extra = {}) => ({
  id,
  note_id: id,
  title,
  updated,
  isPinned: false,
  folder: 'private',
  revision: null,
  ...extra,
});

let storage;

const mountNotes = async () => {
  const rendered = renderHook(() => useNotes(USER, storage));
  await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
  return rendered;
};

// The notes cache lives behind the storage seam (window.storage). In the browser
// the adapter writes to a real store; in these tests the seam is an in-memory
// double, so a test that wants the notebook to start with rows seeds the seam —
// the same thing `localStorage.setItem` used to stand in for.
const seedCache = (rows) => storage.store.set('local:notes-cache', JSON.stringify(rows));

describe('useNotes — the local notebook list', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storage = createMemoryStorage();
    window.storage = storage;
    delete window.BroadcastChannel;
  });

  it('loads the stored notes and keeps the newest first', async () => {
    seedCache([noteRow('note-1', 'Alpha', 1000), noteRow('note-2', 'Beta', 2000)]);

    const { result } = await mountNotes();

    expect(result.current.filteredNotes.map((note) => note.title)).toEqual(['Beta', 'Alpha']);
    // A note with no title has no row, so the sidebar never shows a blank one.
    expect(result.current.notes).toHaveLength(2);
  });

  it('starts with an empty notebook when there is nothing stored', async () => {
    const { result } = await mountNotes();

    expect(result.current.notes).toEqual([]);
    expect(result.current.filteredNotes).toEqual([]);
    expect(result.current.currentNoteId).toBe('note-default');
  });

  it('survives a corrupt notes cache', async () => {
    storage.store.set('local:notes-cache', '{not json at all');

    const { result } = await mountNotes();

    expect(result.current.notes).toEqual([]);
  });

  it('recovers a note whose cache row was lost, from its stored content', async () => {
    // The scan reads the store through the seam, so this seeds the seam — what
    // the notebook actually reads.
    storage.store.set(
      storage.noteStorageKey('note-orphan'),
      '# Recovered orphan\n\nbody with no cache row'
    );

    const { result } = await mountNotes();

    const recovered = result.current.filteredNotes.find((note) => note.id === 'note-orphan');
    expect(recovered?.title).toBe('Recovered orphan');
    // The same read gives the row its second line.
    expect(recovered?.preview).toBe('body with no cache row');
    // Recovery is persisted, so the next load does not have to scan again.
    expect(JSON.parse(storage.store.get('local:notes-cache')).map((note) => note.id)).toContain(
      'note-orphan'
    );
  });

  it('a recovered note replaces its row instead of listing twice', async () => {
    seedCache([noteRow('note-1', 'First words', 100)]);
    storage.store.set('local:note-1', '# First words\n\nolder committed text');
    storage.store.set(
      'local:note-draft:note-1',
      serializeDraft({ noteId: 'note-1', content: '# First words\n\ntyped but never committed', updatedAt: 500 })
    );

    const { result } = await mountNotes();

    const rows = result.current.notes.filter((note) => note.id === 'note-1');
    expect(rows).toHaveLength(1);
    // The journal's text is the newer one, and it is what the note now holds.
    expect(storage.store.get('local:note-1')).toBe('# First words\n\ntyped but never committed');
    expect(storage.store.has('local:note-draft:note-1')).toBe(false);
  });

  it('replays an interrupted save: the journal record becomes a listed note', async () => {
    storage.store.set(
      'local:note-draft:note-interrupted',
      serializeDraft({ noteId: 'note-interrupted', content: '# Interrupted save\n\nthe last words' })
    );

    const { result } = await mountNotes();

    const recovered = result.current.filteredNotes.find((note) => note.id === 'note-interrupted');
    expect(recovered?.title).toBe('Interrupted save');
    // The text was written back to the note's own key, not just listed…
    expect(storage.store.get('local:note-interrupted')).toBe('# Interrupted save\n\nthe last words');
    // …and the record is consumed, so the next open has nothing left to replay.
    expect(storage.store.has('local:note-draft:note-interrupted')).toBe(false);
  });

  it('creates a note, writes the cache and points the app at it', async () => {
    const { result } = await mountNotes();

    let newId;
    await act(async () => {
      newId = await result.current.createNewNote();
    });

    expect(result.current.notes.map((note) => note.id)).toEqual([newId]);
    expect(storage.store.get('local:notes-current-id')).toBe(newId);
    expect(JSON.parse(storage.store.get('local:notes-cache')).map((note) => note.id)).toEqual([
      newId,
    ]);
  });

  it('deletes a note from the list, the cache and storage', async () => {
    const { result } = await mountNotes();
    let id;
    await act(async () => {
      id = await result.current.createNewNote();
    });
    await act(async () => {
      await storage.set(storage.noteStorageKey(id), '# Doomed\n\nbody');
    });

    await act(async () => {
      await result.current.deleteNote(id);
    });

    await waitFor(() => expect(result.current.notes).toHaveLength(0));
    expect(storage.store.has(storage.noteStorageKey(id))).toBe(false);
    await waitFor(() =>
      expect(JSON.parse(storage.store.get('local:notes-cache'))).toEqual([])
    );
  });

  it('keeps a deleted note deleted when a rename arrives afterwards', async () => {
    // A save that was in flight when the user hit delete must not put the row
    // back. The guard exists in updateNoteInList; this is the proof it is armed.
    const { result } = await mountNotes();
    let id;
    await act(async () => {
      id = await result.current.createNewNote();
    });
    await act(async () => {
      await result.current.deleteNote(id);
    });

    act(() => {
      result.current.updateNoteInList(id, 'Doomed', Date.now());
    });

    expect(result.current.notes).toHaveLength(0);
  });

  it('adds a row for a note that was typed into before it existed', async () => {
    // The placeholder editor materialises a real note on the first keystroke;
    // this is that write path.
    const { result } = await mountNotes();

    act(() => {
      result.current.updateNoteInList('note-typed', 'Typed on open', 1234);
    });

    expect(result.current.notes.map((note) => note.id)).toContain('note-typed');
    expect(JSON.parse(storage.store.get('local:notes-cache')).map((note) => note.id)).toContain(
      'note-typed'
    );
  });

  it('ignores a rename with no title instead of listing a blank row', async () => {
    const { result } = await mountNotes();

    act(() => {
      result.current.updateNoteInList('note-blank', '   ', 1234);
    });

    expect(result.current.notes).toHaveLength(0);
  });

  it('pins a note to the top of the list, locally', async () => {
    seedCache([noteRow('note-old', 'Older', 1000), noteRow('note-new', 'Newer', 2000)]);
    const { result } = await mountNotes();

    await act(async () => {
      await result.current.togglePinNote('note-old');
    });

    expect(result.current.filteredNotes[0].id).toBe('note-old');
    expect(JSON.parse(storage.store.get('local:notes-cache'))[0].isPinned).toBe(true);
  });

  it('finds a note by text in its body, without a backend', async () => {
    seedCache([noteRow('note-1', 'Alpha', 1000)]);
    await storage.set(storage.noteStorageKey('note-1'), '# Alpha\n\ncontains the needle marker');
    const { result } = await mountNotes();

    act(() => {
      result.current.setSearchQuery('needle');
    });

    await waitFor(() => expect(result.current.filteredNotes.map((n) => n.id)).toEqual(['note-1']));
    await waitFor(() => expect(result.current.isSearching).toBe(false));
  });

  it('tells other tabs when the list changes', async () => {
    const postMessage = vi.fn();
    class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
      }
      postMessage(message) {
        postMessage(message);
      }
      close() {}
    }
    window.BroadcastChannel = FakeBroadcastChannel;

    const { result } = await mountNotes();
    await act(async () => {
      await result.current.createNewNote();
    });

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'notes-changed' }));
  });

  it('deletes several notes in one pass, with one cache write', async () => {
    seedCache([
      noteRow('note-1', 'Alpha', 1000),
      noteRow('note-2', 'Beta', 2000),
      noteRow('note-3', 'Gamma', 3000),
    ]);
    storage.store.set(storage.noteStorageKey('note-1'), '# Alpha\n\none');
    storage.store.set(storage.noteStorageKey('note-2'), '# Beta\n\ntwo');
    // A journal record for one of them: it must go with the content, or the
    // next open replays it and the deleted note comes back.
    storage.store.set(
      'local:note-draft:note-1',
      serializeDraft({ noteId: 'note-1', content: 'typed but never committed', updatedAt: 500 })
    );

    const { result } = await mountNotes();
    const cacheWrites = () =>
      storage.set.mock.calls.filter(([key]) => key === 'local:notes-cache').length;
    const before = cacheWrites();

    await act(async () => {
      await result.current.deleteNotes(['note-1', 'note-2']);
    });

    await waitFor(() => expect(result.current.notes.map((note) => note.id)).toEqual(['note-3']));
    // One write for the whole selection, not one per note: a loop would leave a
    // window where half of it is gone and rewrite the cache each time.
    expect(cacheWrites() - before).toBe(1);
    expect(JSON.parse(storage.store.get('local:notes-cache')).map((note) => note.id)).toEqual([
      'note-3',
    ]);
    expect(storage.store.has(storage.noteStorageKey('note-1'))).toBe(false);
    expect(storage.store.has(storage.noteStorageKey('note-2'))).toBe(false);
    expect(storage.store.has('local:note-draft:note-1')).toBe(false);
  });

  it('keeps a batch-deleted note deleted when a save arrives afterwards', async () => {
    seedCache([noteRow('note-1', 'Alpha', 1000), noteRow('note-2', 'Beta', 2000)]);
    const { result } = await mountNotes();

    await act(async () => {
      await result.current.deleteNotes(['note-1', 'note-2']);
    });
    act(() => {
      result.current.updateNoteInList('note-1', 'Back from the dead', Date.now());
    });

    expect(result.current.notes).toHaveLength(0);
  });

  it('tells other tabs which notes went', async () => {
    const postMessage = vi.fn();
    class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
      }
      postMessage(message) {
        postMessage(message);
      }
      close() {}
    }
    window.BroadcastChannel = FakeBroadcastChannel;
    seedCache([noteRow('note-1', 'Alpha', 1000), noteRow('note-2', 'Beta', 2000)]);
    const { result } = await mountNotes();

    await act(async () => {
      await result.current.deleteNotes(['note-1', 'note-2']);
    });

    const deleteMessage = postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.action === 'delete');
    expect(deleteMessage.noteIds).toHaveLength(2);
    expect(deleteMessage.noteIds).toEqual(expect.arrayContaining(['note-1', 'note-2']));
  });

  it('gives a row the note\u2019s second line, from the store read it already does', async () => {
    seedCache([noteRow('note-1', 'Alpha', 1000)]);
    storage.store.set(storage.noteStorageKey('note-1'), '# Alpha\n\nSecond line here\n\nmore text');

    const { result } = await mountNotes();

    expect(result.current.notes[0].preview).toBe('Second line here');
  });

  it('has no second line for a one-line note', async () => {
    seedCache([noteRow('note-1', 'Alpha', 1000)]);
    storage.store.set(storage.noteStorageKey('note-1'), '# Alpha');

    const { result } = await mountNotes();

    expect(result.current.notes[0].preview).toBe('');
  });
});
