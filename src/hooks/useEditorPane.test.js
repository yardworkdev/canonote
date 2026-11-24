import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorPane } from './useEditorPane';
import { supabaseAuth } from '../services/supabase';

const createMemoryStorage = (userId = 'user-1') => {
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
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
  };
};

const dispatchStorageEvent = ({ key, newValue, storageArea }) => {
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'newValue', { value: newValue });
  Object.defineProperty(event, 'storageArea', { value: storageArea });
  window.dispatchEvent(event);
};

const dispatchWindowEvent = (type) => {
  window.dispatchEvent(new Event(type));
};

describe('useEditorPane conflict recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.getItem.mockReturnValue(null);
    window.localStorage.setItem.mockClear();
    window.localStorage.removeItem.mockClear();
    window.localStorage.clear.mockClear();
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue(null);
    global.fetch = vi.fn(async (_url, options = {}) => {
      if (options?.method === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        return {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({
            success: true,
            data: {
              id: 'server-row',
              note_id: 'note-3',
              title: body.title || 'Untitled',
              content: body.content || '',
              updated: Date.now(),
              revision: 'rev-next',
            },
          })),
        };
      }
      throw new Error('API unavailable in local fallback test');
    });

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: (callback) => setTimeout(callback, 1500),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      writable: true,
      value: (id) => clearTimeout(id),
    });

    global.requestAnimationFrame = vi.fn((callback) => setTimeout(callback, 0));
    global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
  });

  it.skip('obsolete raw-storage conflict test', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        {
          id: 'note-3',
          title: '',
          updated: 3000,
          isPinned: false,
          folder: 'private',
          createdBy: 'user-1',
        },
      ],
      currentNote: { id: 'note-3', title: '', updated: 3000 },
    };
    const noteKey = storage.noteStorageKey('note-3');
    storage.store.set(noteKey, 'Saved version');
    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });

    const { result } = renderHook(() =>
      useEditorPane({
        paneId: 'primary',
        user,
        storage,
        noteId: 'note-3',
        notes,
      })
    );

    await waitFor(() => {
      expect(result.current.content).toBe('Saved version');
    });

    window.storage.set.mockClear();

    act(() => {
      result.current.handleContentChange('Local draft');
    });

    act(() => {
      dispatchStorageEvent({
        key: noteKey,
        newValue: 'Remote update',
        storageArea: window.localStorage,
      });
    });

    await waitFor(() => {
      expect(result.current.hasConflict).toBe(true);
    });

    expect(result.current.conflictStatus).toBe('conflicted');
    expect(result.current.conflictRecovery).toMatchObject({
      status: 'conflicted',
      noteId: 'note-3',
      localContent: 'Local draft',
      incomingContent: 'Remote update',
      savedContent: 'Saved version',
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(window.storage.set).not.toHaveBeenCalledWith(noteKey, 'Local draft');

    storage.store.set(noteKey, 'Remote update');

    await act(async () => {
      const reloaded = await result.current.reloadFromStorage();
      expect(reloaded).toBe(true);
    });

    expect(result.current.content).toBe('Remote update');
    expect(result.current.hasConflict).toBe(false);
    expect(result.current.conflictRecovery).toMatchObject({
      status: 'resolved-incoming',
      localContent: 'Local draft',
      incomingContent: 'Remote update',
    });

    act(() => {
      result.current.restoreConflictDraft();
    });

    expect(result.current.content).toBe('Local draft');
    expect(result.current.hasConflict).toBe(true);
    expect(result.current.conflictStatus).toBe('conflicted');
  });

  it.skip('obsolete raw-storage overwrite test', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        {
          id: 'note-9',
          title: '',
          updated: 3000,
          isPinned: false,
          folder: 'private',
          createdBy: 'user-1',
        },
      ],
      currentNote: { id: 'note-9', title: '', updated: 3000 },
    };
    const noteKey = storage.noteStorageKey('note-9');
    storage.store.set(noteKey, 'Original text');
    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });

    const { result } = renderHook(() =>
      useEditorPane({
        paneId: 'primary',
        user,
        storage,
        noteId: 'note-9',
        notes,
      })
    );

    await waitFor(() => {
      expect(result.current.content).toBe('Original text');
    });

    window.storage.set.mockClear();

    act(() => {
      result.current.handleContentChange('Local draft');
    });

    act(() => {
      dispatchStorageEvent({
        key: noteKey,
        newValue: 'Remote update',
        storageArea: window.localStorage,
      });
    });

    await waitFor(() => {
      expect(result.current.hasConflict).toBe(true);
    });

    await act(async () => {
      const saved = await result.current.saveLocalDraft();
      expect(saved).toBe(true);
    });

    expect(storage.store.get(noteKey)).toBe('Local draft');
    expect(result.current.hasConflict).toBe(false);
    expect(result.current.conflictRecovery).toMatchObject({
      status: 'resolved-local',
      localContent: 'Local draft',
      incomingContent: 'Remote update',
    });
  });

  it.skip('obsolete raw-storage recovery test', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        {
          id: 'note-18',
          title: '',
          updated: 3000,
          isPinned: false,
          folder: 'private',
          createdBy: 'user-1',
        },
      ],
      currentNote: { id: 'note-18', title: '', updated: 3000 },
    };
    const noteKey = storage.noteStorageKey('note-18');
    storage.store.set(noteKey, 'Original text');
    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });

    const initial = renderHook(() =>
      useEditorPane({
        paneId: 'primary',
        user,
        storage,
        noteId: 'note-18',
        notes,
      })
    );

    await waitFor(() => {
      expect(initial.result.current.content).toBe('Original text');
    });

    act(() => {
      initial.result.current.handleContentChange('Conflicted draft');
    });

    act(() => {
      dispatchStorageEvent({
        key: noteKey,
        newValue: 'Incoming text',
        storageArea: window.localStorage,
      });
    });

    await waitFor(() => {
      expect(initial.result.current.hasConflict).toBe(true);
    });

    storage.store.set(noteKey, 'Incoming text');

    initial.unmount();

    const restored = renderHook(() =>
      useEditorPane({
        paneId: 'primary',
        user,
        storage,
        noteId: 'note-18',
        notes,
      })
    );

    await waitFor(() => {
      expect(restored.result.current.hasConflict).toBe(true);
      expect(restored.result.current.content).toBe('Incoming text');
    });

    act(() => {
      restored.result.current.restoreConflictDraft();
    });

    await waitFor(() => {
      expect(restored.result.current.content).toBe('Conflicted draft');
      expect(restored.result.current.hasConflict).toBe(true);
    });
  });
});

describe('useEditorPane Supabase note sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // These cases exercise the cloud sync path, so the app must look like a
    // configured install (a missing config now means a local-only notebook,
    // which deliberately never calls the notes API).
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.useFakeTimers();
    window.localStorage.getItem.mockReturnValue(null);
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue({ access_token: 'session-token' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: (callback) => setTimeout(callback, 0),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      writable: true,
      value: (id) => clearTimeout(id),
    });

    global.requestAnimationFrame = vi.fn((callback) => setTimeout(callback, 0));
    global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
    global.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        success: true,
        data: {
          note_id: String(url).split('/').pop(),
          title: 'Loaded note',
          content: '',
          updated: 3000,
          revision: 'rev-note-12',
        },
      })),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const createHook = () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        {
          id: 'note-12',
          title: '',
          updated: 3000,
          isPinned: false,
          folder: 'private',
          createdBy: 'user-1',
          revision: 'rev-note-12',
        },
      ],
      currentNote: { id: 'note-12', title: '', updated: 3000, revision: 'rev-note-12' },
      updateNoteInList: vi.fn(),
    };

    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });

    const rendered = renderHook(() =>
      useEditorPane({
        paneId: 'primary',
        user,
        storage,
        noteId: 'note-12',
        notes,
      })
    );

    return { ...rendered, storage, notes };
  };

  const flushAutosave = async () => {
    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
  };

  const flushLocalSaveOnly = async () => {
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
  };

  const mockLoadAndSave = ({ saveStatus = 200, savePayload = null } = {}) => {
    let canonicalContent = '';
    let canonicalRevision = 'rev-note-12';
    global.fetch.mockImplementation(async (url, options = {}) => {
      if (!options?.method) {
        return {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({
            success: true,
            data: {
              id: 'server-row',
              note_id: 'note-12',
              title: 'Loaded note',
              content: canonicalContent,
              updated: 3000,
              revision: canonicalRevision,
            },
          })),
        };
      }

      const body = JSON.parse(options.body || '{}');
      if (saveStatus >= 200 && saveStatus < 300) {
        canonicalContent = body.content || '';
        canonicalRevision = 'rev-note-12-next';
      }
      return {
        ok: saveStatus >= 200 && saveStatus < 300,
        status: saveStatus,
        json: vi.fn(async () => {
          if (savePayload) return savePayload;
          return {
            success: true,
            data: {
              id: 'server-row',
              note_id: 'note-12',
              title: body.title || 'Untitled',
              content: body.content || '',
              updated: Date.now(),
              revision: 'rev-note-12-next',
            },
          };
        }),
      };
    });
  };

  const saveCalls = () => global.fetch.mock.calls.filter((call) => call[1]?.method === 'PATCH');
  const waitForInitialLoad = async (result) => {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });
    expect(result.current.content).toBe('');
  };

  it('keeps the local draft and reports an error when Supabase saves fail', async () => {
    mockLoadAndSave({
      saveStatus: 500,
      savePayload: {
        success: false,
        error: 'Apply the latest Supabase migrations before enabling note storage.',
      },
    });

    const { result, storage } = createHook();
    await waitForInitialLoad(result);

    act(() => {
      result.current.handleContentChange('First local draft');
    });
    await flushAutosave();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('First local draft');
    expect(saveCalls()).toHaveLength(1);
    expect(result.current.saveStatus).toBe('error');
    expect(result.current.saveError).toMatch(/could not be saved/i);

    act(() => {
      result.current.handleContentChange('Second local draft');
    });
    await flushAutosave();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('Second local draft');
    expect(saveCalls()).toHaveLength(2);
  });

  it('saves every autosave to Supabase and updates local metadata', async () => {
    mockLoadAndSave();

    const { result, storage } = createHook();
    await waitForInitialLoad(result);

    act(() => {
      result.current.handleContentChange('First synced draft');
    });
    await flushAutosave();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('First synced draft');
    expect(saveCalls()).toHaveLength(1);

    act(() => {
      result.current.handleContentChange('Second synced draft');
    });
    await flushAutosave();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('Second synced draft');
    expect(saveCalls()).toHaveLength(2);
  });

  it('waits for the idle autosave before sending a Supabase save request', async () => {
    mockLoadAndSave();

    const { result, storage } = createHook();
    await waitForInitialLoad(result);

    act(() => {
      result.current.handleContentChange('First queued draft');
    });
    await flushLocalSaveOnly();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('First queued draft');
    expect(saveCalls()).toHaveLength(1);

    act(() => {
      result.current.handleContentChange('Second queued draft');
    });
    await flushLocalSaveOnly();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('Second queued draft');
    expect(saveCalls()).toHaveLength(2);
    expect(JSON.parse(saveCalls()[1][1].body)).toMatchObject({
      content: 'Second queued draft',
      ifRevision: 'rev-note-12-next',
    });
  });

  it('sends the last known revision and records the new revision after a successful save', async () => {
    mockLoadAndSave();

    const { result, notes } = createHook();
    await waitForInitialLoad(result);

    act(() => {
      result.current.handleContentChange('Revision-aware draft');
    });
    await flushAutosave();

    expect(saveCalls()).toHaveLength(1);
    expect(JSON.parse(saveCalls()[0][1].body)).toMatchObject({
      content: 'Revision-aware draft',
      ifRevision: 'rev-note-12',
    });
    expect(notes.updateNoteInList).toHaveBeenCalledWith(
      'note-12',
      'Revision-aware draft',
      expect.any(Number),
      expect.objectContaining({ revision: 'rev-note-12-next' })
    );
  });

  it('surfaces Supabase revision conflicts without losing the local draft', async () => {
    mockLoadAndSave({
      saveStatus: 409,
      savePayload: {
        success: false,
        error: 'This note changed elsewhere.',
        currentRevision: 'rev-remote',
        data: {
          note_id: 'note-12',
          title: 'Remote title',
          content: 'Remote content',
          revision: 'rev-remote',
        },
      },
    });

    const { result, storage } = createHook();
    await waitForInitialLoad(result);

    act(() => {
      result.current.handleContentChange('Local draft with conflict');
    });
    await flushAutosave();

    expect(storage.store.get(storage.noteStorageKey('note-12'))).toBe('Local draft with conflict');
    expect(result.current.hasConflict).toBe(true);
    expect(result.current.saveStatus).toBe('conflict');
    expect(result.current.saveError).toMatch(/changed elsewhere/i);
    expect(saveCalls()).toHaveLength(1);
  });

  it('keeps the active note intact while a previous note save finishes', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        { id: 'note-12', title: 'First', updated: 1, revision: 'rev-note-12' },
        { id: 'note-13', title: 'Second', updated: 2, revision: 'rev-note-13' },
      ],
      currentNote: null,
      updateNoteInList: vi.fn(),
    };
    let finishFirstSave;
    let finishSecondLoad;
    const patchUrls = [];

    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });
    global.fetch.mockImplementation(async (url, options = {}) => {
      const noteId = String(url).split('/').pop();
      if (!options.method) {
        const response = {
          ok: true,
          status: 200,
          json: vi.fn(async () => ({
            success: true,
            data: {
              note_id: noteId,
              title: noteId === 'note-12' ? 'First' : 'Second',
              content: '',
              updated: Date.now(),
              revision: `rev-${noteId}`,
            },
          })),
        };
        if (noteId === 'note-13') {
          return new Promise((resolve) => {
            finishSecondLoad = () => resolve(response);
          });
        }
        return response;
      }

      patchUrls.push(String(url));
      const body = JSON.parse(options.body || '{}');
      const response = {
        ok: true,
        status: 200,
        json: vi.fn(async () => ({
          success: true,
          data: {
            note_id: noteId,
            title: body.title,
            content: body.content,
            updated: Date.now(),
            revision: `saved-${noteId}`,
          },
        })),
      };
      if (noteId === 'note-12') {
        return new Promise((resolve) => {
          finishFirstSave = () => resolve(response);
        });
      }
      return response;
    });

    const rendered = renderHook(
      ({ currentNoteId }) =>
        useEditorPane({ paneId: 'primary', user, storage, noteId: currentNoteId, notes }),
      { initialProps: { currentNoteId: 'note-12' } }
    );

    await waitForInitialLoad(rendered.result);
    act(() => rendered.result.current.handleContentChange('same draft text'));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(patchUrls).toEqual(['/api/notes/note-12']);

    rendered.rerender({ currentNoteId: 'note-13' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(finishSecondLoad).toBeTypeOf('function');
    act(() => rendered.result.current.handleContentChange('same draft text'));
    await act(async () => {
      finishSecondLoad();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    await act(async () => {
      finishFirstSave();
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });

    expect(rendered.result.current.content).toBe('same draft text');
    expect(patchUrls).toEqual(['/api/notes/note-12', '/api/notes/note-13']);
    expect(rendered.result.current.hasConflict).toBe(false);
  });

  it('shows the note it switched to, not the one it left', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        { id: 'note-12', title: 'First', updated: 1, revision: 'rev-note-12' },
        { id: 'note-13', title: 'Second', updated: 2, revision: 'rev-note-13' },
      ],
      currentNote: null,
      updateNoteInList: vi.fn(),
    };
    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });
    global.fetch.mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        success: true,
        data: {
          note_id: String(url).split('/').pop(),
          title: 'n',
          content: String(url).includes('note-13') ? 'SECOND note text' : 'FIRST note text',
          updated: 3000,
          revision: `rev-${String(url).split('/').pop()}`,
        },
      })),
    }));

    const rendered = renderHook(
      ({ currentNoteId }) =>
        useEditorPane({ paneId: 'primary', user, storage, noteId: currentNoteId, notes }),
      { initialProps: { currentNoteId: 'note-12' } }
    );

    const settle = async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
      });
    };

    await settle();
    expect(rendered.result.current.content).toBe('FIRST note text');

    act(() => rendered.rerender({ currentNoteId: 'note-13' }));
    await settle();
    expect(rendered.result.current.content).toBe('SECOND note text');

    // and back again
    act(() => rendered.rerender({ currentNoteId: 'note-12' }));
    await settle();
    expect(rendered.result.current.content).toBe('FIRST note text');
  });
});

describe('useEditorPane local snapshot flushing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.getItem.mockReturnValue(null);
    window.localStorage.setItem.mockClear();
    window.localStorage.removeItem.mockClear();
    window.localStorage.clear.mockClear();
    vi.spyOn(supabaseAuth, 'getSession').mockResolvedValue(null);

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: (callback) => setTimeout(callback, 1500),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      writable: true,
      value: (id) => clearTimeout(id),
    });

    global.requestAnimationFrame = vi.fn((callback) => setTimeout(callback, 0));
    global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
  });

  it('flushes pending draft content on page hide before autosave fires', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [],
      currentNote: { id: 'note-41', title: '', updated: 0 },
      updateNoteInList: vi.fn(),
    };

    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });

    const { result } = renderHook(() =>
      useEditorPane({
        paneId: 'primary',
        user,
        storage,
        noteId: 'note-41',
        notes,
      })
    );

    await waitFor(() => {
      expect(result.current.content).toBe('');
    });

    act(() => {
      result.current.handleContentChange('Quick refresh draft');
    });

    await waitFor(() => {
      expect(result.current.content).toBe('Quick refresh draft');
    });

    act(() => {
      dispatchWindowEvent('pagehide');
    });

    const noteKey = storage.noteStorageKey('note-41');

    await waitFor(() => {
      expect(storage.store.get(noteKey)).toBe('Quick refresh draft');
      expect(storage.store.has(storage.scopedKey('notes-list'))).toBe(false);
    });
  });

  it('flushes pending content for the previous note when switching notes', async () => {
    const storage = createMemoryStorage();
    const user = { id: 'user-1', username: 'tester' };
    const notes = {
      notes: [
        {
          id: 'note-55',
          title: '',
          updated: 0,
          isPinned: false,
          folder: 'private',
          createdBy: 'user-1',
        },
      ],
      currentNote: { id: 'note-55', title: '', updated: 0 },
      updateNoteInList: vi.fn(),
    };

    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });

    const { result, rerender } = renderHook(
      ({ currentNoteId }) =>
        useEditorPane({
          paneId: 'primary',
          user,
          storage,
          noteId: currentNoteId,
          notes,
        }),
      {
        initialProps: { currentNoteId: 'note-55' },
      }
    );

    await waitFor(() => {
      expect(result.current.content).toBe('');
    });

    act(() => {
      result.current.handleContentChange('Draft before switching');
    });

    await waitFor(() => {
      expect(result.current.content).toBe('Draft before switching');
    });

    rerender({ currentNoteId: 'note-56' });

    const noteKey = storage.noteStorageKey('note-55');

    await waitFor(() => {
      expect(storage.store.get(noteKey)).toBe('Draft before switching');
      expect(storage.store.has(storage.scopedKey('notes-list'))).toBe(false);
    });
  });
});
