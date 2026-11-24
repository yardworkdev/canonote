import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNotePersistence } from './useNotePersistence';
import { serializeDraft } from '../services/note-journal';

// The load path has two writers of note content in one function: the read that
// fetches a note and the write that puts back what it read. They are separate
// operations and nothing re-checks the store in between, so a save that lands
// while the read is in flight is newer than the text about to be written — and
// the write then puts the older, shorter text back. Measured under parallel load
// in the folder store: the `.md` file came back a character or two short although
// it provably held the full text when the reload started.
//
// These specs drive the hook's real load path with a store that answers its first
// read late, which is the only way to make that window deterministic.

const USER = { id: 'local', isLocal: true };

const NOTE_ID = 'note-1';
const READ_TEXT = '# Alpha\n\nthe body of the n';
const FULL_TEXT = '# Alpha\n\nthe body of the note';
const SHORT_TEXT = '# Alpha';

const createMemoryStorage = (userId = USER.id) => {
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

/**
 * Make the store answer its first read of `key` late, with the value it held when
 * the read was issued — which is what a real store does when a write lands while
 * the read is in flight.
 */
const holdFirstReadOf = (storage, key) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = false;
  const passThrough = storage.get;
  storage.get = vi.fn(async (targetKey) => {
    if (targetKey !== key || started) return passThrough(targetKey);
    started = true;
    const value = storage.store.has(targetKey) ? storage.store.get(targetKey) : null;
    await gate;
    return value === null ? null : { value };
  });
  return { release: () => release(), started: () => started };
};

const makeRefs = ({ content = '', last = '' } = {}) => ({
  contentRef: { current: content },
  editVersionRef: { current: 0 },
  lastContentRef: { current: last },
});

const buildProps = ({ storage, setContent, refs }) => ({
  paneId: 'pane-1',
  user: USER,
  storage,
  noteId: NOTE_ID,
  notes: { updateNoteInList: vi.fn() },
  resolvedNote: null,
  editorRef: { current: null },
  content: '',
  setContent,
  contentRef: refs.contentRef,
  contentEditVersionRef: refs.editVersionRef,
  lastContentRef: refs.lastContentRef,
  hasConflict: false,
  hasConflictRef: { current: false },
  conflictSnapshotRef: { current: null },
  conflictMessage: 'Reload this note before saving.',
  readPersistedConflictSnapshot: vi.fn(async () => null),
  applyConflictSnapshot: vi.fn(),
  setConflictRecovery: vi.fn(),
  clearConflictRecovery: vi.fn(),
  clearPersistedConflictSnapshot: vi.fn(async () => {}),
  restoreConflictDraftContent: vi.fn(() => false),
});

let storage;
let setContent;
let refs;

beforeEach(() => {
  storage = createMemoryStorage();
  setContent = vi.fn();
  refs = makeRefs();
  // The hook reads and writes through the seam, not through localStorage.
  window.storage = storage;
});

const mount = () => renderHook(() => useNotePersistence(buildProps({ storage, setContent, refs })));

describe('a load never writes back text the store has moved past', () => {
  it('a save that lands while the read is in flight is not undone by the load', async () => {
    const noteKey = storage.noteStorageKey(NOTE_ID);
    storage.store.set(noteKey, READ_TEXT);
    const held = holdFirstReadOf(storage, noteKey);

    mount();
    await waitFor(() => expect(held.started()).toBe(true));

    // The debounced save commits newer text while the load is still reading.
    storage.store.set(noteKey, FULL_TEXT);
    held.release();

    await waitFor(() => expect(setContent).toHaveBeenCalledWith(FULL_TEXT));
    // The note is not truncated, and the pane shows what the store holds.
    expect(storage.store.get(noteKey)).toBe(FULL_TEXT);
    expect(refs.lastContentRef.current).toBe(FULL_TEXT);
  });

  it('a read that is still current is written back, and the record it superseded goes', async () => {
    const noteKey = storage.noteStorageKey(NOTE_ID);
    const draftKey = storage.scopedKey('note-draft:note-1');
    storage.store.set(noteKey, FULL_TEXT);
    // A record from a save the commit already overtook: its text is an earlier
    // state of the same note, so the load consumes it rather than leaving a
    // record behind for the next open to replay.
    storage.store.set(
      draftKey,
      serializeDraft({ noteId: NOTE_ID, content: READ_TEXT, updatedAt: Date.now() })
    );

    mount();

    await waitFor(() => expect(setContent).toHaveBeenCalledWith(FULL_TEXT));
    expect(storage.store.get(noteKey)).toBe(FULL_TEXT);
    expect(storage.store.has(draftKey)).toBe(false);
  });

  it('a pane edit that shortens a note is still written, not mistaken for a stale read', async () => {
    const noteKey = storage.noteStorageKey(NOTE_ID);
    storage.store.set(noteKey, FULL_TEXT);
    const held = holdFirstReadOf(storage, noteKey);
    refs = makeRefs({ content: FULL_TEXT, last: FULL_TEXT });

    mount();
    await waitFor(() => expect(held.started()).toBe(true));

    // The user selects the body and deletes it while the read is in flight. That
    // text is shorter than the store's, and it is the user's own edit — the guard
    // asks what was written, not how long it is.
    refs.contentRef.current = SHORT_TEXT;
    refs.editVersionRef.current += 1;
    held.release();

    await waitFor(() => expect(storage.store.get(noteKey)).toBe(SHORT_TEXT));
  });
});
