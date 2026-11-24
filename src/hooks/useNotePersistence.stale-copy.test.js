import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// The reported bug, as a spec: an agent writes into a note while this device is
// away. The device comes back, its store still holds the older copy, and the
// server answers with the newer text and a higher revision. If the load prefers
// the store, the pane shows text that never had the agent's paragraph — and the
// very next save carries the *server's* revision, so the guard passes and the
// paragraph is deleted with no conflict and no word to the person. Measured in
// production on 2026-11-18: agent write → revision 2, tab reopened, reload, type,
// save → revision 3 with the agent's paragraph gone.
const state = vi.hoisted(() => ({
  configured: true,
  notes: new Map(),
  updates: [],
  getCalls: [],
}));

vi.mock('../services/supabase', () => ({
  isSupabaseConfigured: () => state.configured,
}));

vi.mock('../services/notes-api', () => {
  class NotesApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    NotesApiError,
    notesApi: {
      get: vi.fn(async (noteId) => {
        state.getCalls.push(noteId);
        return state.notes.get(noteId);
      }),
      update: vi.fn(async (noteId, body) => {
        state.updates.push({ noteId, body });
        const current = state.notes.get(noteId);
        // The server's own rule: a write with no revision claim on a note that has
        // one is refused, not applied.
        if (current && (body.ifRevision === undefined || body.ifRevision === null)) {
          throw new NotesApiError('Revision required.', 428, {
            currentRevision: current.revision,
            data: current,
          });
        }
        if (current && body.ifRevision !== current.revision) {
          throw new NotesApiError('Revision conflict.', 409, {
            currentRevision: current.revision,
            data: current,
          });
        }
        // An accepted write changes the server's note, so a clobber shows up in
        // the assertions below instead of only in a mock's call log.
        const next = {
          ...(current || { id: noteId }),
          content: body.content,
          revision: String(Number(body.ifRevision || 0) + 1),
        };
        state.notes.set(noteId, next);
        return next;
      }),
    },
  };
});

const { useNotePersistence } = await import('./useNotePersistence');

const USER = { id: 'user-1', email: 'person@example.com' };
const NOTE_ID = 'note-1';
const LOCAL = 'The person line.\n';
const SERVER = 'The person line.\nAGENT PARAGRAPH that must survive.\n';

const createMemoryStorage = () => {
  const store = new Map();
  return {
    store,
    scopedKey: (key) => `${USER.id}:${key}`,
    noteStorageKey: (noteId) => `${USER.id}:${noteId}`,
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

let storage;
let setContent;
let refs;

const makeRefs = () => ({
  contentRef: { current: '' },
  editVersionRef: { current: 0 },
  lastContentRef: { current: '' },
});

const buildProps = () => ({
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

const mount = () => renderHook(() => useNotePersistence(buildProps()));

beforeEach(() => {
  storage = createMemoryStorage();
  setContent = vi.fn();
  refs = makeRefs();
  window.storage = storage;
  state.notes.clear();
  state.updates.length = 0;
  state.getCalls.length = 0;
  state.configured = true;
});

describe('a note the server moved ahead of this device', () => {
  it('shows the server text, agent paragraph included, instead of the older local copy', async () => {
    storage.store.set(storage.noteStorageKey(NOTE_ID), LOCAL);
    // The previous page recorded which revision its copy came from; a reload forgets
    // the in-memory map, so this is the only way it can know it is behind.
    storage.store.set(storage.scopedKey('note-revisions'), JSON.stringify({ [NOTE_ID]: '1' }));
    state.notes.set(NOTE_ID, {
      id: NOTE_ID,
      content: SERVER,
      revision: '2',
      agentSpans: [{ start: 16, end: 54 }],
    });

    mount();

    await waitFor(() => expect(setContent).toHaveBeenCalledWith(SERVER));
    expect(setContent).not.toHaveBeenCalledWith(LOCAL);
    expect(refs.lastContentRef.current).toBe(SERVER);
    expect(storage.store.get(storage.noteStorageKey(NOTE_ID))).toBe(SERVER);
    // And the next reload can tell what its copy is, which is what lets it adopt
    // again without a hand-holding button.
    await waitFor(() =>
      expect(JSON.parse(storage.store.get(storage.scopedKey('note-revisions')))).toEqual({
        [NOTE_ID]: '2',
      })
    );
  });

  it('adopts the server text when the store holds text this page did not write', async () => {
    // The store says it is at the server's revision, but its text is not what this
    // page wrote and no journal draft accounts for it: a replay, or another tab.
    storage.store.set(storage.noteStorageKey(NOTE_ID), LOCAL);
    storage.store.set(storage.scopedKey('note-revisions'), JSON.stringify({ [NOTE_ID]: '2' }));
    state.notes.set(NOTE_ID, { id: NOTE_ID, content: SERVER, revision: '2', agentSpans: [] });

    mount();

    await waitFor(() => expect(setContent).toHaveBeenCalledWith(SERVER));
    expect(storage.store.get(storage.noteStorageKey(NOTE_ID))).toBe(SERVER);
  });

  it('a save of that adopted text carries the revision it came from', async () => {
    storage.store.set(storage.noteStorageKey(NOTE_ID), LOCAL);
    state.notes.set(NOTE_ID, { id: NOTE_ID, content: SERVER, revision: '2', agentSpans: [] });

    const { result } = mount();
    await waitFor(() => expect(setContent).toHaveBeenCalledWith(SERVER));

    refs.contentRef.current = `${SERVER}and one more line.\n`;
    refs.editVersionRef.current += 1;
    await result.current.flushPendingChanges?.();

    await waitFor(() => expect(state.updates.length).toBeGreaterThan(0));
    const sent = state.updates[state.updates.length - 1].body;
    expect(sent.ifRevision).toBe('2');
    expect(sent.content).toContain('AGENT PARAGRAPH');
  });

  it('a save from text written against an older revision is refused, not applied', async () => {
    storage.store.set(storage.noteStorageKey(NOTE_ID), LOCAL);
    state.notes.set(NOTE_ID, { id: NOTE_ID, content: SERVER, revision: '2', agentSpans: [] });

    const { result } = mount();
    await waitFor(() => expect(setContent).toHaveBeenCalledWith(SERVER));

    // The agent writes again after the pane was filled.
    const LATER = `${SERVER}And a second agent paragraph.\n`;
    state.notes.set(NOTE_ID, { id: NOTE_ID, content: LATER, revision: '3', agentSpans: [] });

    refs.contentRef.current = `${SERVER}and the person keeps typing.\n`;
    refs.editVersionRef.current += 1;
    await result.current.flushPendingChanges?.();

    await waitFor(() => expect(state.updates.length).toBeGreaterThan(0));
    expect(state.updates[state.updates.length - 1].body.ifRevision).toBe('2');
    // Refused: the server still holds what the agent wrote.
    expect(state.notes.get(NOTE_ID).content).toBe(LATER);
    // Whatever the status word is, the save did not land.
    expect(result.current.saveStatus).not.toBe('saved');
  });
});
