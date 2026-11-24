import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConflictRecovery } from './useConflictRecovery';

const createMemoryStorage = (userId = 'user-1') => {
  const store = new Map();
  return {
    store,
    scopedKey: (key) => `${userId}:${key}`,
    noteStorageKey: (noteId) =>
      `${userId}:${noteId.startsWith('note-') ? noteId : `note-${noteId}`}`,
    get: vi.fn(async (key) => (store.has(key) ? { value: store.get(key) } : null)),
    set: vi.fn(async (key, value) => { store.set(key, value); }),
    delete: vi.fn(async (key) => { store.delete(key); }),
  };
};

const createMockEditorRef = () => ({
  current: {
    focus: vi.fn(),
    setSelection: vi.fn(),
  },
});

describe('useConflictRecovery', () => {
  let storage;
  let contentRef;
  let lastContentRef;
  let editorRef;
  let setContent;

  beforeEach(() => {
    vi.restoreAllMocks();
    storage = createMemoryStorage();
    contentRef = { current: 'local draft' };
    lastContentRef = { current: 'saved version' };
    editorRef = createMockEditorRef();
    setContent = vi.fn();

    Object.defineProperty(window, 'storage', {
      configurable: true,
      writable: true,
      value: storage,
    });
  });

  const createHook = (overrides = {}) =>
    renderHook(() =>
      useConflictRecovery({
        noteId: 'note-1',
        storage,
        editorRef,
        contentRef,
        lastContentRef,
        setContent,
        ...overrides,
      })
    );

  it('starts with no conflict', () => {
    const { result } = createHook();
    expect(result.current.hasConflict).toBe(false);
    expect(result.current.conflictStatus).toBe('idle');
    expect(result.current.conflictSnapshot).toBeNull();
  });

  it('setConflictRecovery creates a snapshot and sets conflicted status', () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });

    expect(result.current.hasConflict).toBe(true);
    expect(result.current.conflictStatus).toBe('conflicted');
    expect(result.current.conflictSnapshot).toMatchObject({
      noteId: 'note-1',
      localContent: 'local draft',
      incomingContent: 'server version',
      savedContent: 'saved version',
    });
  });

  it('persists conflict snapshot to storage', async () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });

    // Wait for async persist
    await new Promise((r) => setTimeout(r, 10));

    expect(storage.set).toHaveBeenCalledWith(
      'user-1:conflict-draft:note-1',
      expect.any(String)
    );
    const stored = JSON.parse(storage.store.get('user-1:conflict-draft:note-1'));
    expect(stored.localContent).toBe('local draft');
    expect(stored.incomingContent).toBe('server version');
  });

  it('clearConflictRecovery resets all state', () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });
    expect(result.current.hasConflict).toBe(true);

    act(() => {
      result.current.clearConflictRecovery();
    });

    expect(result.current.hasConflict).toBe(false);
    expect(result.current.conflictStatus).toBe('idle');
    expect(result.current.conflictSnapshot).toBeNull();
  });

  it('clearConflictRecovery with clearPersisted removes from storage', async () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });
    await new Promise((r) => setTimeout(r, 10));

    act(() => {
      result.current.clearConflictRecovery({ clearPersisted: true });
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(storage.delete).toHaveBeenCalledWith('user-1:conflict-draft:note-1');
  });

  it('updateConflictDraft updates localContent in the snapshot', () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });

    act(() => {
      result.current.updateConflictDraft('edited local draft');
    });

    expect(result.current.conflictSnapshot.localContent).toBe('edited local draft');
    expect(result.current.hasConflict).toBe(true);
  });

  it('updateConflictDraft does nothing when no conflict is active', () => {
    const { result } = createHook();

    act(() => {
      result.current.updateConflictDraft('should not happen');
    });

    expect(result.current.conflictSnapshot).toBeNull();
  });

  it('restoreConflictDraftContent sets content to local draft', () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });

    let restored;
    act(() => {
      restored = result.current.restoreConflictDraftContent();
    });

    expect(restored).toBe(true);
    expect(setContent).toHaveBeenCalledWith('local draft');
  });

  it('restoreConflictDraftContent returns false when no snapshot exists', () => {
    const { result } = createHook();

    let restored;
    act(() => {
      restored = result.current.restoreConflictDraftContent();
    });

    expect(restored).toBe(false);
  });

  it('restoreConflictDraftContent focuses the editor when editorRef is set', () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });

    act(() => {
      result.current.restoreConflictDraftContent({ shouldFocus: true });
    });

    expect(editorRef.current.focus).toHaveBeenCalled();
    expect(editorRef.current.setSelection).toHaveBeenCalledWith('local draft'.length);
  });

  it('resolved-incoming status clears persisted snapshot', async () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });
    await new Promise((r) => setTimeout(r, 10));

    act(() => {
      result.current.setConflictRecovery('resolved-incoming');
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(storage.delete).toHaveBeenCalledWith('user-1:conflict-draft:note-1');
  });

  it('readPersistedConflictSnapshot reads from storage', async () => {
    const snapshot = {
      noteId: 'note-1',
      localContent: 'stored local',
      incomingContent: 'stored incoming',
      savedContent: 'stored saved',
      detectedAt: '2024-01-01T00:00:00Z',
    };
    storage.store.set('user-1:conflict-draft:note-1', JSON.stringify(snapshot));

    const { result } = createHook();

    let read;
    await act(async () => {
      read = await result.current.readPersistedConflictSnapshot('note-1');
    });

    expect(read).toMatchObject({
      noteId: 'note-1',
      localContent: 'stored local',
      incomingContent: 'stored incoming',
    });
  });

  it('readPersistedConflictSnapshot returns null for missing key', async () => {
    const { result } = createHook();

    let read;
    await act(async () => {
      read = await result.current.readPersistedConflictSnapshot('note-1');
    });

    expect(read).toBeNull();
  });

  it('copyConflictToClipboard copies local content', async () => {
    const { result } = createHook();

    act(() => {
      result.current.setConflictRecovery('conflicted', 'server version');
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    let copied;
    await act(async () => {
      copied = await result.current.copyConflictToClipboard();
    });

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith('local draft');
  });

  it('copyConflictToClipboard returns false when no snapshot', async () => {
    const { result } = createHook();

    let copied;
    await act(async () => {
      copied = await result.current.copyConflictToClipboard();
    });

    expect(copied).toBe(false);
  });
});
